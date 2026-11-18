# M-Vave SMK-37 over Bluetooth MIDI on Windows

[Русская версия](SMK-37-Bluetooth-MIDI.md)

A guide to connecting the M-Vave SMK-37 keyboard to a Windows laptop without a cable and setting it up in Ableton Live, FL Studio and Cubase.

Tested on: SMK-37 Elite, Windows 11 25H2, loopMIDI 1.0.16.27, MIDIberry 1.4.0.0. On Windows 10 the setup is the same, but I have not tested it there.

## Why the keyboard "won't connect"

Bluetooth pairing usually goes fine, but programs do not see the keyboard. The cause is in Windows: Bluetooth MIDI is available only through the new system interface, while most music programs (and M-Vave's own MidiSuite) take their list of MIDI devices from the old one. The keyboard is simply not in the old list.

The solution is a "bridge" made of two free programs:

- **loopMIDI** creates a virtual MIDI port that all programs can see.
- **MIDIberry** receives notes from the keyboard over Bluetooth and forwards them to that port.

```
Keyboard ──Bluetooth──> MIDIberry ──> loopMIDI port ──> Ableton / FL Studio / Cubase
```

If all you need is MidiSuite (keyboard settings, firmware), none of this is required: connect the keyboard with a USB cable. MidiSuite will not work through the Bluetooth bridge; see the "Limitations" section.

## Step 1. Pairing the keyboard with Windows

1. Switch the keyboard on. If its Bluetooth is turned on with a separate button, turn it on as the keyboard's manual describes.
2. Open **Settings → Bluetooth & devices → Add device → Bluetooth**.
3. Choose the device whose name ends in **`_BLE`**, for example `SMK-37 Elite_BLE`. This one is the MIDI device.

What you need to know:

- The list may show a second device with the same name without `_BLE`. That one is audio: the keyboard can work as a Bluetooth speaker. It is not needed for MIDI. If you connected it and the laptop's sound went to the keyboard, switch back to the speakers in the sound output settings.
- After pairing, the device is labelled **"Paired"**, not "Connected". This is normal: Bluetooth MIDI connects only at the moment a program opens the port.
- Over Bluetooth the keyboard works with only one device. If it is already connected to a phone or tablet, disconnect it there.

## Step 2. Installing loopMIDI and creating a port

1. Install loopMIDI. The easiest way is a command in the terminal (PowerShell):

   ```
   winget install --id TobiasErichsen.loopMIDI -e
   ```

   Or download the installer from the website of its author, Tobias Erichsen (tobias-erichsen.de). Windows will ask for administrator permission; agree, because the program installs a virtual port driver.
2. Start loopMIDI.
3. In the **New port-name** field at the bottom of the window, type a name for the port, for example `SMK-37 BT`.
4. Press the **+** button. The port appears in the "My loopback MIDI ports" list.

loopMIDI adds itself to Windows startup and remembers the port, so this step is done only once.

## Step 3. Installing and setting up MIDIberry

1. Install MIDIberry from the Microsoft Store (search by name) or with the command:

   ```
   winget install --id 9N39720H2M05 --source msstore
   ```

2. Start MIDIberry.
3. In the **INPUT** list, choose `SMK-37 ..._BLE (Bluetooth MIDI IN)`.
4. In the **OUTPUT** list, choose the port from step 2, `SMK-37 BT`.
5. Turn on the **MIDI MONITOR** switch to see the incoming notes.

A couple of seconds after you choose the input, Windows connects to the keyboard.

## Step 4. Checking

Press a few keys. At the bottom of MIDIberry, in the **INPUT MONITOR** block, lines like these should start scrolling:

```
NoteOn , Ch: 15, Note: 60, Velocity: 127
NoteOff, Ch: 15, Note: 60, Velocity:  64
```

If the lines are there, the bridge works and all that is left is to set up the music program.

## Step 5. Setting up the music program

Everywhere, choose the input **`SMK-37 BT`** (the loopMIDI port), not "Bluetooth MIDI IN". MIDIberry must already be running before you start the program.

Do not enable the output of the `SMK-37 BT` port: everything the program sends into it comes back to the program's own input, and notes start to double or loop.

The names of the menu items below may differ slightly depending on the program version. The bridge itself, up to the `SMK-37 BT` port, has been tested; the settings inside the programs were not tested on my computer.

### Ableton Live

1. Open **Settings** (Preferences in older versions), keys `Ctrl + ,`.
2. Go to the **Link, Tempo & MIDI** tab.
3. In the list of MIDI ports, find the input row **Input: SMK-37 BT** and tick **Track**. The **Remote** box is needed only if you want to assign the keyboard's knobs and buttons to Live's parameters.
4. In the **Output: SMK-37 BT** row, leave all the boxes unticked.
5. Create a MIDI track and put an instrument on it.
6. On the track, in the **MIDI From** block, leave `All Ins` and `All Channels`, and switch on the record button (Arm). The keyboard now plays this instrument.

### FL Studio

1. Open **Options → MIDI Settings**, key `F10`.
2. In the **Input** section, select `SMK-37 BT` in the list and press **Enable**.
3. Leave the controller type (Controller type) as `(generic controller)`.
4. In the **Output** section, do not enable the `SMK-37 BT` port.
5. Close the settings, select an instrument in the Channel Rack and play: FL Studio sends the notes to the selected channel.

If the device list is empty, press **Refresh device list** at the bottom of the window.

### Cubase

Method 1, through the bridge (as in the other programs):

1. Open **Studio → Studio Setup**.
2. On the left, select **MIDI Port Setup**.
3. Find the input row (In) `SMK-37 BT`. The **Visible** column should be ticked, and the **In 'All MIDI Inputs'** column too.
4. In the output row (Out) `SMK-37 BT`, untick **Visible** so that you do not pick it on a track by accident.
5. Press **OK**.
6. Create an instrument track (**Project → Add Track → Instrument**). In the track inspector, leave the input as `All MIDI Inputs` and switch on **Record Enable** or **Monitor**.

Method 2, without the bridge. The same **MIDI Port Setup** window in Cubase has a tick box **Use Device 'WinRT MIDI'**. It turns on the new Windows MIDI interface, and Cubase should then see `SMK-37 ..._BLE (Bluetooth MIDI IN)` directly, without loopMIDI and MIDIberry. I have not tested this method: if the keyboard has appeared in the list and notes come through, Cubase does not need the bridge; if not, use method 1. Do not use both methods at the same time: close MIDIberry when you turn on WinRT MIDI, otherwise two programs will be sharing one Bluetooth connection.

### Other programs

In the MIDI settings, choose the `SMK-37 BT` input.

## What to do each time before playing

1. Switch the keyboard on.
2. Start MIDIberry and make sure the input (`..._BLE`) and the output (`SMK-37 BT`) are selected. MIDIberry does not remember the selection: it has to be made again after every start.
3. Start the music program. The MIDIberry window can be minimised but must not be closed: without it no notes come through.

loopMIDI starts by itself together with Windows.

Step 2 is done for you by the script [start-bridge.cmd](bridge/start-bridge.cmd) (in the release archive it is in the `Bluetooth Bridge` folder). Double-click it before you start the music program.

## Starting and checking in one click

`start-bridge.cmd` goes through the whole chain from the keyboard to the port, fixes what it can, and reports for each link whether it is in order. The report is in English, or in Russian where Windows or its regional format is Russian; the `-Lang en` and `-Lang ru` switches choose it by hand:

1. The keyboard is visible in Bluetooth.
2. The Windows MIDI service is running.
3. The `SMK-37 BT` port is visible under its own name. If not, the script restarts loopMIDI.
4. The port passes data: a test message goes into it and should come back. If the port is muted, the script restarts loopMIDI.
5. MIDIberry is open, and the input and output are selected.
6. A note from the keyboard reaches the port: the script asks you to press any key on the SMK-37 and waits 20 seconds. If nothing arrives, it opens MIDIberry again and asks once more. The Esc key on the computer skips this check.

| Mark | What it means |
|---|---|
| `[  OK  ]` | In order: the link is fine |
| `[FIXED ]` | The link was broken and the script repaired it |
| `[  !!  ]` | Could not fix; what to do is written next to it |

If everything is in order, the window closes by itself after a few seconds. If there is a problem, it stays open until you press a key.

The test message in step 4 is a note-off for the lowest note on channel 16. An open music program will receive it, but it plays nothing.

What was found and done on each run is written to the log `%LOCALAPPDATA%\SMK37Bridge\bridge.log`. The run at Windows startup writes there too, so the log shows when and what broke.

A desktop shortcut is created with this command, run in the folder with the script:

```
start-bridge.cmd -Shortcut
```

A shortcut named "SMK-37 bridge" appears (on a Russian Windows it is called "SMK-37 мост"). The command `start-bridge.cmd -Shortcut -Ableton` creates a second shortcut, "SMK-37 and Ableton": after the check it opens Ableton Live if it is not already running. If you move the folder with the script, create the shortcuts again.

## After a restart the `SMK-37 BT` port is gone

On Windows 11 with the new MIDI service, the loopMIDI port sometimes comes up after a restart under the name `loopMIDI Port` instead of its own. The loopMIDI window still shows the right name, but programs see the wrong one. The consequences:

- in MIDIberry the OUTPUT list has no `SMK-37 BT`;
- the music program treats the port as a new one and loses its settings. In Ableton the Track and Remote ticks disappear, and the Input field of the Control Surface becomes `None`.

The cure is to restart loopMIDI: close it from its icon in the system tray (right-click → Exit) and open it again. The `start-bridge.cmd` script does this itself if it does not find a port with the right name.

Start the music program after the port has its name back. If it was already open, choose the `SMK-37 BT` input again in its settings (in Ableton: **Settings → Link, Tempo & MIDI**, the **Input** field of the Control Surface).

A different port name or a different keyboard is set with parameters:

```
start-bridge.cmd -Port "My port" -Keyboard "*Bluetooth MIDI IN*"
```

The other switches:

| Switch | What it does |
|---|---|
| `-Reconnect` | Closes MIDIberry and opens it again straight away, without waiting for the key check |
| `-NoKeyTest` | Does not ask you to press a key |
| `-Lang en` | Prints the report in English (`-Lang ru`: in Russian) |
| `-KeyWait 40` | Waits 40 seconds for a key press instead of 20 |
| `-Ableton` | After the check, opens Ableton Live if it is not already running |

### Startup

To have the bridge come up by itself every time you sign in to Windows, run this once in the folder with the script:

```
start-bridge.cmd -Install
```

The script adds itself to the current user's startup (with the same `-Port` and `-Keyboard`, if you gave them). Twenty seconds after sign-in it checks the port and opens MIDIberry; on such a run it does not ask you to press a key. The keyboard must be switched on by then; if it was off, run `start-bridge.cmd` by hand once you have switched it on.

To remove it from startup: `start-bridge.cmd -Uninstall`. If you move the folder with the script, run `-Install` again from the new location.

## Things to watch for

- **MIDI channel.** The keyboard may send on a channel other than the first (mine sent on channel 15). If the track listens only to channel 1, there will be no sound. Set the track to receive from all channels, or change the channel on the keyboard.
- **Velocity.** If every note arrives with Velocity 127, fixed velocity is switched on on the keyboard. This is changed in the keyboard's settings or in MidiSuite.
- **Latency.** With Bluetooth MIDI it is slightly higher than with a cable. For recording fast parts, USB is more reliable.

## Limitations

- The bridge works one way: from the keyboard to the computer. MidiSuite needs a connection in both directions, so for settings, and especially for firmware updates, use a USB cable.
- MIDIberry does not start automatically and does not remember the chosen input and output. The `start-bridge.cmd` script covers this.

## If something does not work

| What happens | What to check |
|---|---|
| The keyboard is not in the "Add device" list | The keyboard is switched on and not connected to a phone. In **Settings → Bluetooth & devices → Devices**, switch "Bluetooth devices discovery" to **Advanced**. |
| MIDIberry has no `..._BLE` input | Press **List All Input Devices**. If that does not help, remove the keyboard from the Windows Bluetooth devices and pair it again. |
| MIDIberry has no `SMK-37 BT` output | loopMIDI is not running or the port has not been created. Open loopMIDI and check the list of ports. If the port is there in loopMIDI but the list shows `loopMIDI Port` instead, see the section "After a restart the port is gone". |
| INPUT MONITOR is empty | Whether the `..._BLE` input is selected. Switch the keyboard off and on, and select the input again. |
| Notes show in MIDIberry but not in the music program | Whether MIDIberry is running with the output selected; whether the `SMK-37 BT` input is enabled in the program's settings; whether the MIDI channel matches. |
| Notes are doubled or loop | Disable `SMK-37 BT` as an output in the music program. |
| A note is "stuck" and sounds without end | The **All Note Off** button in MIDIberry. |
| It stopped working after sleep or a restart | Run `start-bridge.cmd` and press a key on the SMK-37 when it asks: if the note does not arrive, it opens MIDIberry again by itself. By hand: restart MIDIberry and select the input and output again. |
| The port is there but notes reach no program | loopMIDI has muted the port because of a feedback loop. `start-bridge.cmd` finds this with the test message and restarts loopMIDI. To stop it happening again, untick all the boxes for the `SMK-37 BT` output in the program. |
| After a restart the port settings in the program are lost | The port has come up under the name `loopMIDI Port`; see the section "After a restart the port is gone". |
