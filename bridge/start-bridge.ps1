<#
Поднимает и проверяет мост Bluetooth MIDI одним запуском:

  клавиатура --Bluetooth--> MIDIberry --> порт loopMIDI --> музыкальная программа

Шаг за шагом:
1. Клавиатура видна среди устройств Bluetooth MIDI.
2. Служба MIDI Windows работает.
3. Порт loopMIDI виден под своим именем. Иногда Windows показывает его как
   "loopMIDI Port": тогда программы теряют настройки, привязанные к имени.
   Лечится перезапуском loopMIDI.
4. Порт пропускает данные: в него уходит пробное сообщение и должно вернуться.
   (Порт, который loopMIDI заглушил из-за петли, его не вернёт.)
5. MIDIberry запущен, в нём выбраны вход (клавиатура) и выход (порт loopMIDI).
6. Нота с клавиатуры доходит до порта: скрипт просит нажать клавишу и ждёт
   (Esc на клавиатуре компьютера пропускает эту проверку).

Запуск: ярлык на рабочем столе, start-bridge.cmd (двойной щелчок) или
  powershell -ExecutionPolicy Bypass -File start-bridge.ps1 [ключи]

  -Port       имя порта loopMIDI, по умолчанию "SMK-37 BT"
  -Keyboard   маска имени входа в MIDIberry, по умолчанию "SMK-37*Bluetooth MIDI IN*"
  -Delay      подождать столько секунд перед началом (для автозагрузки)
  -Reconnect  закрыть и открыть MIDIberry заново (если после сна ноты не идут)
  -KeyWait    сколько секунд ждать нажатия клавиши, по умолчанию 20
  -NoKeyTest  не просить нажать клавишу
  -Ableton    после проверки запустить Ableton Live, если он ещё не открыт
  -Shortcut   положить на рабочий стол ярлык "SMK-37 мост"; вместе с -Ableton
              ярлык "SMK-37 и Ableton", который после проверки открывает Ableton
  -Install    запускать мост при каждом входе в Windows (с теми же -Port и -Keyboard)
  -Uninstall  убрать мост из автозагрузки

Что было найдено и сделано при каждом запуске, пишется в журнал:
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
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

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
    $labels = @{ ok = '[  OK  ]'; fixed = '[ИСПРАВ]'; fail = '[  !!  ]'; note = '        ' }
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
    Write-Host 'Мост добавлен в автозагрузку: он будет подниматься сам после входа в Windows.'
    Write-Host 'Если папку со скриптом перенесёте, запустите -Install ещё раз из нового места.'
    exit 0
}

if ($Uninstall) {
    Remove-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue
    Write-Host 'Мост убран из автозагрузки.'
    exit 0
}

if ($Shortcut) {
    $name = 'SMK-37 мост'
    $does = 'Двойной щелчок по нему поднимает и проверяет всю цепочку.'
    if ($Ableton) {
        $name = 'SMK-37 и Ableton'
        $does = 'Двойной щелчок по нему поднимает и проверяет цепочку, а потом открывает Ableton Live.'
    }
    $link = Join-Path ([Environment]::GetFolderPath('Desktop')) "$name.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $item = $shell.CreateShortcut($link)
    $item.TargetPath = Join-Path $PSScriptRoot 'start-bridge.cmd'
    if ($Ableton) { $item.Arguments = '-Ableton' }
    $item.WorkingDirectory = $PSScriptRoot
    $item.Description = 'Поднять и проверить мост Bluetooth MIDI клавиатуры SMK-37'
    $icon = Join-Path $PSScriptRoot 'smk37-bridge.ico'
    if (Test-Path $icon) { $item.IconLocation = "$icon,0" }
    $item.Save()
    Write-Host "Ярлык создан: $link"
    Write-Host $does
    Write-Host 'Если папку со скриптом перенесёте, создайте ярлык заново из нового места.'
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
        Write-Log "пробное сообщение: вход не открылся ($($_.Exception.Message))"
        return 'unknown'
    }
    try {
        Start-Sleep -Milliseconds 150
        [void]$listener.Take()
        for ($round = 1; $round -le 2; $round++) {
            $sent = [SmkBridge.Ports]::Send([uint32]$outputId, [uint32]0x00008F)
            if ($sent -ne 0) {
                Write-Log "пробное сообщение: выход не открылся (код $sent)"
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
        return "нота $($noteNames[$first % 12])$([Math]::Floor($first / 12) - 2), канал $channel, сила $second"
    }
    if ($status -eq 0xB0) { return "регулятор CC $first = $second, канал $channel" }
    if ($status -eq 0xE0) { return "колесо высоты тона, канал $channel" }
    if ($status -eq 0xA0 -or $status -eq 0xD0) { return "послекасание, канал $channel" }
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
        Write-Log "ожидание клавиши: $($_.Exception.Message)"
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
    Write-Host "Цепочка не в порядке: проблем $problems. Журнал: $logFile" -ForegroundColor Red
    Write-Log "итог: не в порядке, проблем $problems"
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
            Say fail 'MIDIberry не установлен. Поставьте его: winget install --id 9N39720H2M05 --source msstore'
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
        Say fail 'Окно MIDIberry не найдено. Откройте MIDIberry вручную и запустите мост ещё раз.'
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
        Say ok "MIDIberry, выход: $outputName"
    } else {
        Say fail "MIDIberry: в списке OUTPUT нет '$Port'."
    }

    # At logon the Bluetooth entry can take a while to show up.
    $waitInput = 20
    if ($unattended) { $waitInput = 120 }
    $inputName = Select-Device $window 'inputDevices' $Keyboard $waitInput
    if ($inputName) {
        Say ok "MIDIberry, вход: $inputName"
    } else {
        Say fail "MIDIberry: в списке INPUT нет '$Keyboard'. Включите клавиатуру и запустите мост ещё раз."
    }
    return [bool]($outputName -and $inputName)
}

if ($Delay -gt 0) { Start-Sleep -Seconds $Delay }
$unattended = $Delay -gt 0      # started by Windows at logon: nobody is there to press a key

Write-Log "--- запуск$(if ($unattended) { ' из автозагрузки' })$(if ($Reconnect) { ', -Reconnect' })"
Write-Host "Мост SMK-37: клавиатура > Bluetooth > MIDIberry > порт '$Port' > программа"
Write-Host ''

# --- 1. Клавиатура в Bluetooth --------------------------------------------------

$bluetooth = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
    Where-Object { $_.FriendlyName -like $Keyboard } | Select-Object -First 1
if ($bluetooth) {
    Say ok "Клавиатура видна в Bluetooth: $($bluetooth.FriendlyName)"
} else {
    Say note 'Клавиатура пока не видна в Bluetooth. Включите её; подожду, пока она появится в MIDIberry.'
}

# --- 2. Служба MIDI Windows -----------------------------------------------------

# The first query wakes the Windows MIDI service; a port created before the service
# is ready is the one that comes up under the default name.
[void][SmkBridge.Ports]::Inputs()
if (Get-Service midisrv -ErrorAction SilentlyContinue) {
    if (Wait-Until { (Get-Service midisrv).Status -eq 'Running' } 30) {
        Say ok 'Служба MIDI Windows работает'
    } else {
        Say fail 'Служба MIDI Windows (midisrv) не запустилась. Перезагрузите компьютер.'
    }
}

# --- 3. Порт loopMIDI под своим именем ------------------------------------------

$configured = Get-ItemProperty 'HKCU:\Software\Tobias Erichsen\loopMIDI\Ports' -ErrorAction SilentlyContinue
if ($configured -and -not ($configured.PSObject.Properties.Name -contains $Port)) {
    Say fail "В loopMIDI нет порта '$Port'. Откройте loopMIDI, впишите это имя внизу окна и нажмите +."
    Stop-WithSummary
}

$liveWasRunning = [bool](Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'Ableton Live*' })
$loopMidi = Find-LoopMidi
$restarted = $false
if (Wait-Until { Test-Port } 3) {
    Say ok "Порт '$Port' на месте"
} else {
    if (-not $loopMidi) {
        Say fail 'loopMIDI не найден. Установите его: winget install --id TobiasErichsen.loopMIDI -e'
        Stop-WithSummary
    }
    $wasRunning = [bool](Get-Process loopMIDI -ErrorAction SilentlyContinue)
    $seen = ([SmkBridge.Ports]::Inputs() | Where-Object { $_ }) -join ', '
    Write-Log "порта '$Port' нет; видны входы: $seen; loopMIDI запущен: $wasRunning"
    for ($attempt = 1; $attempt -le 3 -and -not (Test-Port); $attempt++) {
        Restart-LoopMidi $loopMidi
        $restarted = $true
    }
    if (-not (Test-Port)) {
        Say fail "Порт '$Port' не появился и после трёх перезапусков loopMIDI. Сейчас видны входы: $(([SmkBridge.Ports]::Inputs() | Where-Object { $_ }) -join ', ')"
        Stop-WithSummary
    }
    if (-not $wasRunning) {
        Say fixed "loopMIDI не был запущен: запущен, порт '$Port' на месте"
    } elseif ($seen) {
        Say fixed "Порта '$Port' не было, Windows показывала входы: $seen. loopMIDI перезапущен, порт на месте"
    } else {
        Say fixed "Порта '$Port' не было, как и других входов MIDI. loopMIDI перезапущен, порт на месте"
    }
}

# --- 4. Порт пропускает данные ---------------------------------------------------

$passes = Test-Loopback
if ($passes -eq 'ok') {
    Say ok 'Порт пропускает данные (пробное сообщение вернулось)'
} elseif ($passes -eq 'silent' -and $loopMidi) {
    # A port that loopMIDI has muted after a feedback loop passes nothing; a restart clears it.
    Restart-LoopMidi $loopMidi
    $restarted = $true
    if ((Test-Loopback) -eq 'ok') {
        Say fixed 'Порт не пропускал данные (заглушён или завис): loopMIDI перезапущен, теперь пропускает'
        Say note "Если порт глохнет снова, в программе у выхода '$Port' включён Track, Sync или Remote: выключите все три."
    } else {
        Say fail 'Порт не пропускает данные даже после перезапуска loopMIDI. Откройте окно loopMIDI и посмотрите, не помечен ли порт как заглушённый.'
    }
} elseif ($passes -eq 'silent') {
    Say fail 'Порт не пропускает данные, а loopMIDI не найден, чтобы его перезапустить.'
} else {
    Say note 'Не удалось проверить, пропускает ли порт данные: он не открылся для пробы. Иду дальше.'
}

# --- 5. MIDIberry ----------------------------------------------------------------

# MIDIberry keeps the old port open after loopMIDI has been restarted and then
# sends the notes nowhere: it is reopened together with the port.
[void](Connect-MidiBerry ($Reconnect -or $restarted))

# --- 6. Нота доходит ---------------------------------------------------------------

if ($problems -eq 0 -and -not $NoKeyTest -and -not $unattended) {
    Write-Host ''
    Write-Host "Нажмите любую клавишу на SMK-37 (жду $KeyWait с; Esc на компьютере - пропустить)..." -ForegroundColor Cyan
    $heard = Wait-Key $KeyWait
    if ($heard) {
        Say ok "Клавиатура слышна на порте: $heard"
    } elseif ($heard -eq '') {
        Say note 'Проверка нажатием клавиши пропущена.'
    } else {
        # After the keyboard or the computer has slept the notes can stop with everything
        # still looking picked: a freshly opened MIDIberry takes the keyboard up again.
        Say note 'С клавиатуры ничего не пришло. Открываю MIDIberry заново и жду ещё раз.'
        if (Connect-MidiBerry $true) {
            Write-Host "Нажмите клавишу на SMK-37 ещё раз (жду $KeyWait с; Esc - пропустить)..." -ForegroundColor Cyan
            $heard = Wait-Key $KeyWait
        }
        if ($heard) {
            Say fixed "MIDIberry открыт заново, клавиатура слышна на порте: $heard"
        } elseif ($heard -eq '') {
            Say note 'Проверка нажатием клавиши пропущена.'
        } else {
            Say fail 'С клавиатуры ничего не приходит. Проверьте, что она включена, заряжена и в Параметрах Windows > Bluetooth у неё написано «Подключено».'
        }
    }
}

# --- Итог ----------------------------------------------------------------------------

if ($restarted -and $liveWasRunning) {
    Write-Host ''
    Say note 'Ableton был открыт, пока порт пересоздавался. В Settings > Link, Tempo & MIDI'
    Say note "выберите у Control Surface заново Input: $Port."
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
        Say ok "Запускаю $($live.Name)"
    } else {
        Say note 'Ableton Live не найден в меню Пуск: запустите его сами.'
    }
}

Write-Host ''
Write-Host "Мост работает$(if ($fixes -gt 0) { " (исправлено: $fixes)" })." -ForegroundColor Green
Write-Log "итог: работает, исправлено $fixes"
exit 0
