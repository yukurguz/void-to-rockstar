<#
Поднимает мост Bluetooth MIDI после перезагрузки или сна:

  клавиатура --Bluetooth--> MIDIberry --> порт loopMIDI --> музыкальная программа

1. Проверяет, что порт loopMIDI виден под своим именем. После перезагрузки
   Windows иногда показывает его как "loopMIDI Port": тогда программы теряют
   настройки, привязанные к имени. Лечится перезапуском loopMIDI.
2. Запускает MIDIberry, если он закрыт, и выбирает в нём вход (клавиатура)
   и выход (порт loopMIDI).

Запуск: start-bridge.cmd (двойной щелчок) или
  powershell -ExecutionPolicy Bypass -File start-bridge.ps1 [-Port имя] [-Keyboard маска]

  -Port       имя порта loopMIDI, по умолчанию "SMK-37 BT"
  -Keyboard   маска имени входа в MIDIberry, по умолчанию "SMK-37*Bluetooth MIDI IN*"
  -Delay      подождать столько секунд перед началом (для автозагрузки)
  -Reconnect  закрыть и открыть MIDIberry заново (если после сна ноты не идут)
  -Install    запускать мост при каждом входе в Windows (с теми же -Port и -Keyboard)
  -Uninstall  убрать мост из автозагрузки
#>
param(
    [string]$Port = 'SMK-37 BT',
    [string]$Keyboard = 'SMK-37*Bluetooth MIDI IN*',
    [int]$Delay = 0,
    [switch]$Reconnect,
    [switch]$Install,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

# --- Автозагрузка -----------------------------------------------------------

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

        [DllImport("winmm.dll")]
        static extern uint midiInGetNumDevs();

        [DllImport("winmm.dll", CharSet = CharSet.Unicode, EntryPoint = "midiInGetDevCapsW")]
        static extern uint midiInGetDevCaps(UIntPtr id, out InCaps caps, uint size);

        public static string[] Inputs() {
            var names = new List<string>();
            uint count = midiInGetNumDevs();
            for (uint index = 0; index < count; index++) {
                InCaps caps;
                if (midiInGetDevCaps((UIntPtr)index, out caps, (uint)Marshal.SizeOf(typeof(InCaps))) == 0) {
                    names.Add(caps.Name);
                }
            }
            return names.ToArray();
        }
    }
}
'@

$automation = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$problems = 0

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

if ($Delay -gt 0) { Start-Sleep -Seconds $Delay }

# --- 1. Порт loopMIDI -------------------------------------------------------

$configured = Get-ItemProperty 'HKCU:\Software\Tobias Erichsen\loopMIDI\Ports' -ErrorAction SilentlyContinue
if ($configured -and -not ($configured.PSObject.Properties.Name -contains $Port)) {
    Write-Host "В loopMIDI нет порта '$Port'. Откройте loopMIDI, впишите это имя внизу окна и нажмите +."
    exit 1
}

# The first query wakes the Windows MIDI service; a port created before the service
# is ready is the one that comes up under the default name.
[void][SmkBridge.Ports]::Inputs()
if (Get-Service midisrv -ErrorAction SilentlyContinue) {
    [void](Wait-Until { (Get-Service midisrv).Status -eq 'Running' } 30)
}

$liveWasRunning = [bool](Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'Ableton Live*' })
$restarted = $false
if (-not (Wait-Until { Test-Port } 3)) {
    $loopMidi = Find-LoopMidi
    if (-not $loopMidi) {
        Write-Host 'loopMIDI не найден. Установите его: winget install --id TobiasErichsen.loopMIDI -e'
        exit 1
    }
    for ($attempt = 1; $attempt -le 3 -and -not (Test-Port); $attempt++) {
        Get-Process loopMIDI -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 2
        Start-Process $loopMidi -WindowStyle Minimized
        [void](Wait-Until { Test-Port } 15)
        $restarted = $true
    }
}

if (Test-Port) {
    Write-Host "Порт '$Port': на месте$(if ($restarted) { ' (loopMIDI перезапущен)' })"
} else {
    Write-Host "Порт '$Port' не появился. Сейчас видны входы: $([SmkBridge.Ports]::Inputs() -join ', ')"
    exit 1
}

# --- 2. MIDIberry -----------------------------------------------------------

if ($Reconnect) {
    Get-Process MIDIberry -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
}

if (-not (Get-Process MIDIberry -ErrorAction SilentlyContinue)) {
    $app = Get-StartApps | Where-Object { $_.Name -eq 'MIDIberry' } | Select-Object -First 1
    if (-not $app) {
        Write-Host 'MIDIberry не установлен. Поставьте его: winget install --id 9N39720H2M05 --source msstore'
        exit 1
    }
    Start-Process "shell:AppsFolder\$($app.AppID)"
}

$window = Find-Window
for ($second = 0; -not $window -and $second -lt 30; $second++) {
    Start-Sleep -Seconds 1
    $window = Find-Window
}
if (-not $window) {
    Write-Host 'Окно MIDIberry не найдено. Откройте MIDIberry вручную и запустите скрипт ещё раз.'
    exit 1
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
    Write-Host "MIDIberry, выход: $outputName"
} else {
    Write-Host "MIDIberry: в списке OUTPUT нет '$Port'."
    $problems++
}

# At logon the Bluetooth entry can take a while to show up.
$waitInput = 20
if ($Delay -gt 0) { $waitInput = 120 }
$inputName = Select-Device $window 'inputDevices' $Keyboard $waitInput
if ($inputName) {
    Write-Host "MIDIberry, вход: $inputName"
} else {
    Write-Host "MIDIberry: в списке INPUT нет '$Keyboard'. Включите клавиатуру и запустите скрипт ещё раз."
    $problems++
}

if ($restarted -and $liveWasRunning) {
    Write-Host ''
    Write-Host 'Ableton был открыт, пока порт пересоздавался. В Settings -> Link, Tempo & MIDI'
    Write-Host "выберите у Control Surface заново Input: $Port."
}

if ($problems -gt 0) { exit 1 }
Write-Host 'Мост готов: нажмите клавишу, в MIDIberry должны побежать строки NoteOn.'
exit 0
