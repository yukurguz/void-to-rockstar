<#
Brings the Bluetooth MIDI bridge up and checks it in one run:

  keyboard --Bluetooth--> MIDIberry --> loopMIDI port --> music program

Step by step:
1. The keyboard is seen among the Bluetooth MIDI devices.
2. The Windows MIDI service is running.
3. The loopMIDI port is seen under its own name. Windows sometimes shows it as
   "loopMIDI Port": then programs lose the settings tied to the name.
   Restarting loopMIDI cures it.
4. The port passes data: a probe message goes in and must come back.
   (A port that loopMIDI has muted after a feedback loop will not return it.)
5. MIDIberry is running, with the input (the keyboard) and the output (the
   loopMIDI port) picked.
6. A note from the keyboard reaches the port: the script asks for a key and
   waits (Esc on the computer keyboard skips this check).

Run it from the desktop shortcut, by start-bridge.cmd (double click) or
  powershell -ExecutionPolicy Bypass -File start-bridge.ps1 [switches]

  -Port       name of the loopMIDI port, "SMK-37 BT" by default
  -Keyboard   mask of the input name in MIDIberry, "SMK-37*Bluetooth MIDI IN*" by default
  -Delay      wait this many seconds before starting (for autostart)
  -Reconnect  close MIDIberry and open it again (if notes stop after sleep)
  -KeyWait    how many seconds to wait for a key, 20 by default
  -NoKeyTest  do not ask for a key
  -Ableton    start Ableton Live after the check if it is not open yet
  -Shortcut   put a shortcut on the desktop; with -Ableton, one that opens
              Ableton after the check
  -Install    start the bridge at every Windows logon (with the same -Port and -Keyboard)
  -Uninstall  take the bridge out of autostart
  -Lang       ru or en: the language of the report. By default Russian where
              Windows or its regional format is Russian, English elsewhere.

What was found and done on every run is written to the log:
  %LOCALAPPDATA%\SMK37Bridge\bridge.log
#>
param(
    [string]$Port = 'SMK-37 BT',
    [string]$Keyboard = 'SMK-37*Bluetooth MIDI IN*',
    [int]$Delay = 0,
    [int]$KeyWait = 20,
    [switch]$Reconnect,
    [switch]$NoKeyTest,
    [switch]$Ableton,
    [switch]$Shortcut,
    [switch]$Install,
    [switch]$Uninstall,
    [ValidateSet('', 'ru', 'en')][string]$Lang = ''
)

$ErrorActionPreference = 'Stop'

# The language of the report: Russian if Windows speaks Russian or keeps Russian
# dates and numbers, English elsewhere.
if (-not $Lang) {
    $Lang = 'en'
    if ((Get-UICulture).TwoLetterISOLanguageName -eq 'ru' -or (Get-Culture).TwoLetterISOLanguageName -eq 'ru') { $Lang = 'ru' }
}

function L([string]$ru, [string]$en) {
    if ($Lang -eq 'ru') { return $ru }
    return $en
}

# --- Журнал и вывод -----------------------------------------------------------

$logFolder = Join-Path $env:LOCALAPPDATA 'SMK37Bridge'
$logFile = Join-Path $logFolder 'bridge.log'
$problems = 0
$fixes = 0

function Write-Log([string]$text) {
    try {
        if (-not (Test-Path $logFolder)) { [void](New-Item -ItemType Directory -Path $logFolder) }
        Add-Content -Path $logFile -Value ("{0:dd.MM.yyyy HH:mm:ss}  {1}" -f (Get-Date), $text) -Encoding UTF8
    } catch { }
}

# One line of the report. Marks: ok, fixed, fail, note.
function Say([string]$mark, [string]$text) {
    $labels = @{ ok = '[  OK  ]'; fixed = (L '[ИСПРАВ]' '[FIXED ]'); fail = '[  !!  ]'; note = '        ' }
    $colours = @{ ok = 'Green'; fixed = 'Yellow'; fail = 'Red'; note = 'Gray' }
    Write-Host ("{0} {1}" -f $labels[$mark], $text) -ForegroundColor $colours[$mark]
    if ($mark -eq 'fail') { $script:problems++ }
    if ($mark -eq 'fixed') { $script:fixes++ }
    Write-Log ("{0} {1}" -f $labels[$mark], $text)
}

# --- Автозагрузка и ярлык -----------------------------------------------------

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runName = 'SMK37Bridge'

if ($Install) {
    # The pause lets loopMIDI and the Windows MIDI service come up first.
    $command = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Delay 20 -Port "{1}" -Keyboard "{2}"' -f $PSCommandPath, $Port, $Keyboard
    Set-ItemProperty -Path $runKey -Name $runName -Value $command
    Write-Host (L 'Мост добавлен в автозагрузку: он будет подниматься сам после входа в Windows.' 'The bridge is in autostart now: it will come up by itself after you log on to Windows.')
    Write-Host (L 'Если папку со скриптом перенесёте, запустите -Install ещё раз из нового места.' 'If you move the folder with the script, run -Install again from the new place.')
    exit 0
}

if ($Uninstall) {
    Remove-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue
    Write-Host (L 'Мост убран из автозагрузки.' 'The bridge is out of autostart.')
    exit 0
}

if ($Shortcut) {
    $name = (L 'SMK-37 мост' 'SMK-37 bridge')
    $does = (L 'Двойной щелчок по нему поднимает и проверяет всю цепочку.' 'A double click on it brings the whole chain up and checks it.')
    if ($Ableton) {
        $name = (L 'SMK-37 и Ableton' 'SMK-37 and Ableton')
        $does = (L 'Двойной щелчок по нему поднимает и проверяет цепочку, а потом открывает Ableton Live.' 'A double click on it brings the chain up, checks it and then opens Ableton Live.')
    }
    $link = Join-Path ([Environment]::GetFolderPath('Desktop')) "$name.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $item = $shell.CreateShortcut($link)
    $item.TargetPath = Join-Path $PSScriptRoot 'start-bridge.cmd'
    if ($Ableton) { $item.Arguments = '-Ableton' }
    $item.WorkingDirectory = $PSScriptRoot
    $item.Description = (L 'Поднять и проверить мост Bluetooth MIDI клавиатуры SMK-37' 'Bring up and check the Bluetooth MIDI bridge of the SMK-37 keyboard')
    $icon = Join-Path $PSScriptRoot 'smk37-bridge.ico'
    if (Test-Path $icon) { $item.IconLocation = "$icon,0" }
    $item.Save()
    Write-Host (L "Ярлык создан: $link" "Shortcut created: $link")
    Write-Host $does
    Write-Host (L 'Если папку со скриптом перенесёте, создайте ярлык заново из нового места.' 'If you move the folder with the script, create the shortcut again from the new place.')
    exit 0
}

# --- Доступ к портам MIDI (WinMM) ---------------------------------------------

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace SmkBridge {
    public static class Ports {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct InCaps {
            public ushort Mid;
            public ushort Pid;
            public uint DriverVersion;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Name;
            public uint Support;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct OutCaps {
            public ushort Mid;
            public ushort Pid;
            public uint DriverVersion;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Name;
            public ushort Technology;
            public ushort Voices;
            public ushort Notes;
            public ushort ChannelMask;
            public uint Support;
        }

        [DllImport("winmm.dll")]
        static extern uint midiInGetNumDevs();

        [DllImport("winmm.dll")]
        static extern uint midiOutGetNumDevs();

        [DllImport("winmm.dll", CharSet = CharSet.Unicode, EntryPoint = "midiInGetDevCapsW")]
        static extern uint midiInGetDevCaps(UIntPtr id, out InCaps caps, uint size);

        [DllImport("winmm.dll", CharSet = CharSet.Unicode, EntryPoint = "midiOutGetDevCapsW")]
        static extern uint midiOutGetDevCaps(UIntPtr id, out OutCaps caps, uint size);

        [DllImport("winmm.dll")]
        static extern uint midiOutOpen(out IntPtr handle, uint id, IntPtr callback, IntPtr instance, uint flags);

        [DllImport("winmm.dll")]
        static extern uint midiOutShortMsg(IntPtr handle, uint message);

        [DllImport("winmm.dll")]
        static extern uint midiOutClose(IntPtr handle);

        public static string[] Inputs() {
            var names = new List<string>();
            uint count = midiInGetNumDevs();
            for (uint index = 0; index < count; index++) {
                InCaps caps;
                if (midiInGetDevCaps((UIntPtr)index, out caps, (uint)Marshal.SizeOf(typeof(InCaps))) == 0) {
                    names.Add(caps.Name);
                } else {
                    names.Add("");
                }
            }
            return names.ToArray();
        }

        public static string[] Outputs() {
            var names = new List<string>();
            uint count = midiOutGetNumDevs();
            for (uint index = 0; index < count; index++) {
                OutCaps caps;
                if (midiOutGetDevCaps((UIntPtr)index, out caps, (uint)Marshal.SizeOf(typeof(OutCaps))) == 0) {
                    names.Add(caps.Name);
                } else {
                    names.Add("");
                }
            }
            return names.ToArray();
        }

        // Sends one short message to an output port; 0 = sent.
        public static uint Send(uint id, uint message) {
            IntPtr handle;
            uint result = midiOutOpen(out handle, id, IntPtr.Zero, IntPtr.Zero, 0);
            if (result != 0) {
                return result;
            }
            result = midiOutShortMsg(handle, message);
            midiOutClose(handle);
            return result;
        }
    }

    // Listens to an input port and keeps the short messages that arrive.
    public sealed class Listener : IDisposable {
        delegate void MidiInProc(IntPtr handle, uint message, UIntPtr instance, UIntPtr first, UIntPtr second);

        [DllImport("winmm.dll")]
        static extern uint midiInOpen(out IntPtr handle, uint id, MidiInProc callback, UIntPtr instance, uint flags);

        [DllImport("winmm.dll")]
        static extern uint midiInStart(IntPtr handle);

        [DllImport("winmm.dll")]
        static extern uint midiInStop(IntPtr handle);

        [DllImport("winmm.dll")]
        static extern uint midiInClose(IntPtr handle);

        const uint CallbackFunction = 0x30000;
        const uint Data = 0x3C3;

        IntPtr handle;
        readonly MidiInProc keep;       // the callback must outlive the calls into it
        readonly List<uint> got = new List<uint>();

        public Listener(uint id) {
            keep = OnMessage;
            uint result = midiInOpen(out handle, id, keep, UIntPtr.Zero, CallbackFunction);
            if (result != 0) {
                handle = IntPtr.Zero;
                throw new InvalidOperationException("midiInOpen: " + result);
            }
            midiInStart(handle);
        }

        void OnMessage(IntPtr from, uint message, UIntPtr instance, UIntPtr first, UIntPtr second) {
            if (message == Data) {
                lock (got) {
                    got.Add((uint)first & 0xFFFFFF);
                }
            }
        }

        public uint[] Take() {
            lock (got) {
                uint[] all = got.ToArray();
                got.Clear();
                return all;
            }
        }

        public void Dispose() {
            if (handle != IntPtr.Zero) {
                midiInStop(handle);
                midiInClose(handle);
                handle = IntPtr.Zero;
            }
        }
    }
}
'@

$automation = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]

function Test-Port {
    return [SmkBridge.Ports]::Inputs() -contains $Port
}

function Wait-Until([scriptblock]$Test, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (& $Test) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return [bool](& $Test)
}

function Find-LoopMidi {
    $running = Get-Process loopMIDI -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($running -and $running.Path) { return $running.Path }
    $run = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).loopMIDI
    if ($run -and (Test-Path $run.Trim('"'))) { return $run.Trim('"') }
    foreach ($root in ${env:ProgramFiles(x86)}, $env:ProgramFiles) {
        if (-not $root) { continue }
        $candidate = Join-Path $root 'Tobias Erichsen\loopMIDI\loopMIDI.exe'
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

function Restart-LoopMidi([string]$path) {
    Get-Process loopMIDI -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    Start-Process $path -WindowStyle Minimized
    [void](Wait-Until { Test-Port } 15)
}

# Does the port hand back what is sent into it? A note-off of the lowest note
# on channel 16 goes in: nothing sounds anywhere, whoever else listens.
# Returns 'ok', 'silent' (sent, nothing came back) or 'unknown' (could not try).
function Test-Loopback {
    $inputId = [Array]::IndexOf([SmkBridge.Ports]::Inputs(), $Port)
    $outputId = [Array]::IndexOf([SmkBridge.Ports]::Outputs(), $Port)
    if ($inputId -lt 0 -or $outputId -lt 0) { return 'unknown' }
    $listener = $null
    try {
        $listener = New-Object SmkBridge.Listener ([uint32]$inputId)
    } catch {
        Write-Log (L "пробное сообщение: вход не открылся ($($_.Exception.Message))" "probe message: the input did not open ($($_.Exception.Message))")
        return 'unknown'
    }
    try {
        Start-Sleep -Milliseconds 150
        [void]$listener.Take()
        for ($round = 1; $round -le 2; $round++) {
            $sent = [SmkBridge.Ports]::Send([uint32]$outputId, [uint32]0x00008F)
            if ($sent -ne 0) {
                Write-Log (L "пробное сообщение: выход не открылся (код $sent)" "probe message: the output did not open (code $sent)")
                return 'unknown'
            }
            $deadline = (Get-Date).AddMilliseconds(1200)
            while ((Get-Date) -lt $deadline) {
                foreach ($message in $listener.Take()) {
                    # the note-off of note 0 on channel 16 (or the same as a note-on of zero force)
                    if (($message -band 0xFFEF) -eq 0x008F) { return 'ok' }
                }
                Start-Sleep -Milliseconds 40
            }
        }
        return 'silent'
    } finally {
        $listener.Dispose()
    }
}

$noteNames = 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'

# One message from the keyboard in words; $null for those that prove nothing
# (note-offs, clock). Octaves are numbered as in Ableton: note 60 is C3.
function Format-Message([uint32]$message) {
    $status = $message -band 0xF0
    $first = ($message -shr 8) -band 0x7F
    $second = ($message -shr 16) -band 0x7F
    $channel = ($message -band 0x0F) + 1
    if ($status -eq 0x90 -and $second -gt 0) {
        return (L "нота $($noteNames[$first % 12])$([Math]::Floor($first / 12) - 2), канал $channel, сила $second" "note $($noteNames[$first % 12])$([Math]::Floor($first / 12) - 2), channel $channel, velocity $second")
    }
    if ($status -eq 0xB0) { return (L "регулятор CC $first = $second, канал $channel" "controller CC $first = $second, channel $channel") }
    if ($status -eq 0xE0) { return (L "колесо высоты тона, канал $channel" "pitch wheel, channel $channel") }
    if ($status -eq 0xA0 -or $status -eq 0xD0) { return (L "послекасание, канал $channel" "aftertouch, channel $channel") }
    return $null
}

# Waits for anything played on the keyboard to arrive at the port. Returns what came
# in words, '' if the wait was skipped with Esc, or $null if nothing came.
function Wait-Key([int]$seconds) {
    $inputId = [Array]::IndexOf([SmkBridge.Ports]::Inputs(), $Port)
    if ($inputId -lt 0) { return $null }
    $listener = $null
    try {
        $listener = New-Object SmkBridge.Listener ([uint32]$inputId)
        $deadline = (Get-Date).AddSeconds($seconds)
        while ((Get-Date) -lt $deadline) {
            foreach ($message in $listener.Take()) {
                $heard = Format-Message $message
                if ($heard) { return $heard }
            }
            try {
                if ([Console]::KeyAvailable -and [Console]::ReadKey($true).Key -eq 'Escape') { return '' }
            } catch { }      # no console to read from: just keep waiting
            Start-Sleep -Milliseconds 60
        }
        return $null
    } catch {
        Write-Log (L "ожидание клавиши: $($_.Exception.Message)" "waiting for a key: $($_.Exception.Message)")
        return $null
    } finally {
        if ($listener) { $listener.Dispose() }
    }
}

function Find-Window {
    $byName = New-Object System.Windows.Automation.PropertyCondition($automation::NameProperty, 'MIDIberry')
    return $automation::RootElement.FindFirst($scope::Children, $byName)
}

function Get-ItemText($item) {
    if ($item.Current.Name) { return $item.Current.Name }
    $isText = New-Object System.Windows.Automation.PropertyCondition(
        $automation::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)
    $text = $item.FindFirst($scope::Descendants, $isText)
    if ($text) { return $text.Current.Name }
    return ''
}

# Picks the first list item matching the mask; returns its name, or $null if it never appeared.
function Select-Device($window, [string]$listId, [string]$mask, [int]$seconds) {
    $byId = New-Object System.Windows.Automation.PropertyCondition($automation::AutomationIdProperty, $listId)
    $deadline = (Get-Date).AddSeconds($seconds)
    do {
        $list = $window.FindFirst($scope::Descendants, $byId)
        if ($list) {
            foreach ($item in $list.FindAll($scope::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
                $name = Get-ItemText $item
                if ($name -notlike $mask) { continue }
                $selection = $item.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                if (-not $selection.Current.IsSelected) {
                    $selection.Select()
                    Start-Sleep -Milliseconds 800
                }
                return $name
            }
        }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    return $null
}

function Stop-WithSummary {
    Write-Host ''
    Write-Host (L "Цепочка не в порядке: проблем $problems. Журнал: $logFile" "The chain is not in order: $problems problem(s). Log: $logFile") -ForegroundColor Red
    Write-Log (L "итог: не в порядке, проблем $problems" "result: not in order, problems: $problems")
    exit 1
}

# Opens MIDIberry (closing it first if $fresh) and picks its output and input.
# Returns $true when both are picked.
function Connect-MidiBerry([bool]$fresh) {
    if ($fresh) {
        Get-Process MIDIberry -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 2
    }

    if (-not (Get-Process MIDIberry -ErrorAction SilentlyContinue)) {
        $app = Get-StartApps | Where-Object { $_.Name -eq 'MIDIberry' } | Select-Object -First 1
        if (-not $app) {
            Say fail (L 'MIDIberry не установлен. Поставьте его: winget install --id 9N39720H2M05 --source msstore' 'MIDIberry is not installed. Install it: winget install --id 9N39720H2M05 --source msstore')
            Stop-WithSummary
        }
        Start-Process "shell:AppsFolder\$($app.AppID)"
    }

    $window = Find-Window
    for ($second = 0; -not $window -and $second -lt 30; $second++) {
        Start-Sleep -Seconds 1
        $window = Find-Window
    }
    if (-not $window) {
        Say fail (L 'Окно MIDIberry не найдено. Откройте MIDIberry вручную и запустите мост ещё раз.' 'The MIDIberry window was not found. Open MIDIberry by hand and run the bridge again.')
        Stop-WithSummary
    }

    # A minimized window has no list contents to pick from.
    try {
        $state = $window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
        if ($state.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized) {
            $state.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Normal)
            Start-Sleep -Seconds 1
        }
    } catch { }

    $outputName = Select-Device $window 'outputDevices' "$Port*" 20
    if ($outputName) {
        Say ok (L "MIDIberry, выход: $outputName" "MIDIberry, output: $outputName")
    } else {
        Say fail (L "MIDIberry: в списке OUTPUT нет '$Port'." "MIDIberry: '$Port' is not in the OUTPUT list.")
    }

    # At logon the Bluetooth entry can take a while to show up.
    $waitInput = 20
    if ($unattended) { $waitInput = 120 }
    $inputName = Select-Device $window 'inputDevices' $Keyboard $waitInput
    if ($inputName) {
        Say ok (L "MIDIberry, вход: $inputName" "MIDIberry, input: $inputName")
    } else {
        Say fail (L "MIDIberry: в списке INPUT нет '$Keyboard'. Включите клавиатуру и запустите мост ещё раз." "MIDIberry: '$Keyboard' is not in the INPUT list. Switch the keyboard on and run the bridge again.")
    }
    return [bool]($outputName -and $inputName)
}

if ($Delay -gt 0) { Start-Sleep -Seconds $Delay }
$unattended = $Delay -gt 0      # started by Windows at logon: nobody is there to press a key

Write-Log (L "--- запуск$(if ($unattended) { ' из автозагрузки' })$(if ($Reconnect) { ', -Reconnect' })" "--- run$(if ($unattended) { ' from autostart' })$(if ($Reconnect) { ', -Reconnect' })")
Write-Host (L "Мост SMK-37: клавиатура > Bluetooth > MIDIberry > порт '$Port' > программа" "SMK-37 bridge: keyboard > Bluetooth > MIDIberry > port '$Port' > program")
Write-Host ''

# --- 1. Клавиатура в Bluetooth --------------------------------------------------

$bluetooth = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
    Where-Object { $_.FriendlyName -like $Keyboard } | Select-Object -First 1
if ($bluetooth) {
    Say ok (L "Клавиатура видна в Bluetooth: $($bluetooth.FriendlyName)" "The keyboard is seen in Bluetooth: $($bluetooth.FriendlyName)")
} else {
    Say note (L 'Клавиатура пока не видна в Bluetooth. Включите её; подожду, пока она появится в MIDIberry.' 'The keyboard is not seen in Bluetooth yet. Switch it on; I will wait for it to appear in MIDIberry.')
}

# --- 2. Служба MIDI Windows -----------------------------------------------------

# The first query wakes the Windows MIDI service; a port created before the service
# is ready is the one that comes up under the default name.
[void][SmkBridge.Ports]::Inputs()
if (Get-Service midisrv -ErrorAction SilentlyContinue) {
    if (Wait-Until { (Get-Service midisrv).Status -eq 'Running' } 30) {
        Say ok (L 'Служба MIDI Windows работает' 'The Windows MIDI service is running')
    } else {
        Say fail (L 'Служба MIDI Windows (midisrv) не запустилась. Перезагрузите компьютер.' 'The Windows MIDI service (midisrv) did not start. Restart the computer.')
    }
}

# --- 3. Порт loopMIDI под своим именем ------------------------------------------

$configured = Get-ItemProperty 'HKCU:\Software\Tobias Erichsen\loopMIDI\Ports' -ErrorAction SilentlyContinue
if ($configured -and -not ($configured.PSObject.Properties.Name -contains $Port)) {
    Say fail (L "В loopMIDI нет порта '$Port'. Откройте loopMIDI, впишите это имя внизу окна и нажмите +." "loopMIDI has no port '$Port'. Open loopMIDI, type this name at the bottom of its window and press +.")
    Stop-WithSummary
}

$liveWasRunning = [bool](Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'Ableton Live*' })
$loopMidi = Find-LoopMidi
$restarted = $false
if (Wait-Until { Test-Port } 3) {
    Say ok (L "Порт '$Port' на месте" "The port '$Port' is in place")
} else {
    if (-not $loopMidi) {
        Say fail (L 'loopMIDI не найден. Установите его: winget install --id TobiasErichsen.loopMIDI -e' 'loopMIDI was not found. Install it: winget install --id TobiasErichsen.loopMIDI -e')
        Stop-WithSummary
    }
    $wasRunning = [bool](Get-Process loopMIDI -ErrorAction SilentlyContinue)
    $seen = ([SmkBridge.Ports]::Inputs() | Where-Object { $_ }) -join ', '
    Write-Log (L "порта '$Port' нет; видны входы: $seen; loopMIDI запущен: $wasRunning" "no port '$Port'; inputs seen: $seen; loopMIDI running: $wasRunning")
    for ($attempt = 1; $attempt -le 3 -and -not (Test-Port); $attempt++) {
        Restart-LoopMidi $loopMidi
        $restarted = $true
    }
    if (-not (Test-Port)) {
        Say fail (L "Порт '$Port' не появился и после трёх перезапусков loopMIDI. Сейчас видны входы: $(([SmkBridge.Ports]::Inputs() | Where-Object { $_ }) -join ', ')" "The port '$Port' did not appear even after three restarts of loopMIDI. Inputs seen now: $(([SmkBridge.Ports]::Inputs() | Where-Object { $_ }) -join ', ')")
        Stop-WithSummary
    }
    if (-not $wasRunning) {
        Say fixed (L "loopMIDI не был запущен: запущен, порт '$Port' на месте" "loopMIDI was not running: started, the port '$Port' is in place")
    } elseif ($seen) {
        Say fixed (L "Порта '$Port' не было, Windows показывала входы: $seen. loopMIDI перезапущен, порт на месте" "There was no port '$Port', Windows showed the inputs: $seen. loopMIDI restarted, the port is in place")
    } else {
        Say fixed (L "Порта '$Port' не было, как и других входов MIDI. loopMIDI перезапущен, порт на месте" "There was no port '$Port' and no other MIDI input. loopMIDI restarted, the port is in place")
    }
}

# --- 4. Порт пропускает данные ---------------------------------------------------

$passes = Test-Loopback
if ($passes -eq 'ok') {
    Say ok (L 'Порт пропускает данные (пробное сообщение вернулось)' 'The port passes data (the probe message came back)')
} elseif ($passes -eq 'silent' -and $loopMidi) {
    # A port that loopMIDI has muted after a feedback loop passes nothing; a restart clears it.
    Restart-LoopMidi $loopMidi
    $restarted = $true
    if ((Test-Loopback) -eq 'ok') {
        Say fixed (L 'Порт не пропускал данные (заглушён или завис): loopMIDI перезапущен, теперь пропускает' 'The port passed no data (muted or stuck): loopMIDI restarted, now it does')
        Say note (L "Если порт глохнет снова, в программе у выхода '$Port' включён Track, Sync или Remote: выключите все три." "If the port goes mute again, your program has Track, Sync or Remote on for the output '$Port': switch all three off.")
    } else {
        Say fail (L 'Порт не пропускает данные даже после перезапуска loopMIDI. Откройте окно loopMIDI и посмотрите, не помечен ли порт как заглушённый.' 'The port passes no data even after loopMIDI was restarted. Open the loopMIDI window and see whether the port is marked as muted.')
    }
} elseif ($passes -eq 'silent') {
    Say fail (L 'Порт не пропускает данные, а loopMIDI не найден, чтобы его перезапустить.' 'The port passes no data, and loopMIDI was not found to restart it.')
} else {
    Say note (L 'Не удалось проверить, пропускает ли порт данные: он не открылся для пробы. Иду дальше.' 'Could not check whether the port passes data: it did not open for the probe. Going on.')
}

# --- 5. MIDIberry ----------------------------------------------------------------

# MIDIberry keeps the old port open after loopMIDI has been restarted and then
# sends the notes nowhere: it is reopened together with the port.
[void](Connect-MidiBerry ($Reconnect -or $restarted))

# --- 6. Нота доходит ---------------------------------------------------------------

if ($problems -eq 0 -and -not $NoKeyTest -and -not $unattended) {
    Write-Host ''
    Write-Host (L "Нажмите любую клавишу на SMK-37 (жду $KeyWait с; Esc на компьютере - пропустить)..." "Press any key on the SMK-37 (waiting $KeyWait s; Esc on the computer skips)...") -ForegroundColor Cyan
    $heard = Wait-Key $KeyWait
    if ($heard) {
        Say ok (L "Клавиатура слышна на порте: $heard" "The keyboard is heard on the port: $heard")
    } elseif ($heard -eq '') {
        Say note (L 'Проверка нажатием клавиши пропущена.' 'The key check was skipped.')
    } else {
        # After the keyboard or the computer has slept the notes can stop with everything
        # still looking picked: a freshly opened MIDIberry takes the keyboard up again.
        Say note (L 'С клавиатуры ничего не пришло. Открываю MIDIberry заново и жду ещё раз.' 'Nothing came from the keyboard. Opening MIDIberry again and waiting once more.')
        if (Connect-MidiBerry $true) {
            Write-Host (L "Нажмите клавишу на SMK-37 ещё раз (жду $KeyWait с; Esc - пропустить)..." "Press a key on the SMK-37 once more (waiting $KeyWait s; Esc skips)...") -ForegroundColor Cyan
            $heard = Wait-Key $KeyWait
        }
        if ($heard) {
            Say fixed (L "MIDIberry открыт заново, клавиатура слышна на порте: $heard" "MIDIberry was opened again, the keyboard is heard on the port: $heard")
        } elseif ($heard -eq '') {
            Say note (L 'Проверка нажатием клавиши пропущена.' 'The key check was skipped.')
        } else {
            Say fail (L 'С клавиатуры ничего не приходит. Проверьте, что она включена, заряжена и в Параметрах Windows > Bluetooth у неё написано «Подключено».' 'Nothing comes from the keyboard. Check that it is switched on and charged and that Windows Settings > Bluetooth shows it as Connected.')
        }
    }
}

# --- Итог ----------------------------------------------------------------------------

if ($restarted -and $liveWasRunning) {
    Write-Host ''
    Say note (L 'Ableton был открыт, пока порт пересоздавался. В Settings > Link, Tempo & MIDI' 'Ableton was open while the port was made again. In Settings > Link, Tempo & MIDI')
    Say note (L "выберите у Control Surface заново Input: $Port." "pick Input: $Port for the Control Surface once more.")
}

if ($problems -gt 0) { Stop-WithSummary }

if ($Ableton -and -not $liveWasRunning) {
    $live = Get-StartApps | Where-Object { $_.Name -like 'Ableton Live*' } | Select-Object -First 1
    if ($live) {
        # the Start menu knows a desktop program by the path of its file
        if (Test-Path -LiteralPath $live.AppID) {
            Start-Process -FilePath $live.AppID
        } else {
            Start-Process "shell:AppsFolder\$($live.AppID)"
        }
        Say ok (L "Запускаю $($live.Name)" "Starting $($live.Name)")
    } else {
        Say note (L 'Ableton Live не найден в меню Пуск: запустите его сами.' 'Ableton Live was not found in the Start menu: start it yourself.')
    }
}

Write-Host ''
Write-Host (L "Мост работает$(if ($fixes -gt 0) { " (исправлено: $fixes)" })." "The bridge works$(if ($fixes -gt 0) { " (fixed: $fixes)" }).") -ForegroundColor Green
Write-Log (L "итог: работает, исправлено $fixes" "result: works, fixed: $fixes")
exit 0
