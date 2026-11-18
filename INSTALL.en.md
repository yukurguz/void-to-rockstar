# Installation

[Русская версия](INSTALL.md)

You need Windows, Ableton Live 12 and an M-Vave SMK-37 keyboard. The trainer needs Live Suite or Max for Live.

Everyone's User Library folder is in a different place. You can find yours in Ableton: **Settings → Library → Location of User Library**.

## 1. Connecting over Bluetooth

Do everything in the guide [SMK-37-Bluetooth-MIDI.en.md](SMK-37-Bluetooth-MIDI.en.md). As a result a MIDI port called `SMK-37 BT` appears in the system. If the keyboard is connected with a USB cable, this step is not needed, and wherever `SMK-37 BT` is named below, choose the keyboard's own port instead.

From then on, before every start of Ableton, switch the keyboard on and run `start-bridge.cmd` from the `Bluetooth Bridge` folder. It goes through the whole chain from the keyboard to the port, repairs what it can and says for each link whether it is in order; at the end it asks you to press a key on the SMK-37 and checks that the note arrived. The command `start-bridge.cmd -Shortcut` puts a shortcut called "SMK-37 мост" (Russian for "SMK-37 bridge") on the desktop, so that one click starts the bridge. To have the bridge come up by itself when you sign in to Windows, run `start-bridge.cmd -Install` once.

## 2. The keyboard script

1. Copy the `SMK37` folder from `SMK37 Remote Script` to `User Library\Remote Scripts\`. If there is no `Remote Scripts` folder, create it.
2. Restart Ableton.
3. Open **Settings → Link, Tempo & MIDI**.
4. In the first row choose: **Control Surface** → `SMK37`, **Input** → `SMK-37 BT`, **Output** → `None`.
5. In the list of ports, for the input `SMK-37 BT` switch on **Track** and **Remote**, and switch off Sync and MPE.
6. For the output `SMK-37 BT` clear every tick box. Otherwise the signal goes round in a circle and loopMIDI mutes the port.

## 3. Tracks

- On the keys track: **MIDI From** → `SMK-37 BT`, channel `Ch. 4`.
- On the drum track with a Drum Rack: **MIDI From** → `SMK-37 BT`, channel `Ch. 9`.
- To hear both at once, set **Monitor** → `In` on both.

## 4. The trainer

1. Copy both files from the `SMK Trainer` folder (`SMK Trainer.amxd` and `smk_trainer.js`) to `User Library\Presets\MIDI Effects\Max MIDI Effect\`. The two files must be next to each other.
2. In Ableton's browser open **User Library → Presets → MIDI Effects → Max MIDI Effect**.
3. Drag **SMK Trainer** onto the keys track.
4. Start with the lesson "Where to start": it explains what is where on the screen.

The language of the trainer is chosen with RU / EN in the bottom left corner of its right-hand panel, and the choice is remembered.

Drag the trainer onto the drum track as well: then it hears both the keys and the pads, whichever of the two tracks is selected. The two copies share their points.

The lessons on synths and effects name the encoders by number (K1–K8). The numbers are right when the `SMK37` script from step 2 is running and the device has been selected with a click on its title bar. You can turn the same knobs with the mouse too: the trainer watches the knob itself, not what turned it.

In the lessons on synths the instrument on the track is replaced. Save your own sound first with the floppy disk icon in the instrument's title bar.

All the lessons stand in one row of 40 levels. The NEXT button leads from lesson to lesson and from level to level; the upper arrows page through the levels. The PATH line on the panel shows how many of the 1061 lessons are done, and the yellow mark under it shows where the open lesson is. Levels open by points: if you do not have enough for the next one, the trainer says how many are left to earn. In the genre levels, in "Drills" and in the level "As the masters do" the lessons can be taken in any order; in the others they come one after another.

The lessons on the sequencer and on composition and those of the level "As the masters do" look at the clip that is open in the note editor and, if none is open, at the clips of the track the trainer is on.

The FREE PLAY button opens free play; the LESSONS button returns to the lesson you were on. In free play the upper arrows change the style and the lower ones the mood (there are 18 of them, from major and minor to cosmic, weightless and futuristic); a click on a note in the outer ring of the circle sets the tonic; the SCALE button plays the scale of the mood, and CHORD plays the main chord. Under the keys there are two columns. On the left are marks for what the project already has, and under them one tip: the trainer picks it itself from what you are doing (playing outside the mode, the rhythm stumbling, no left hand, a move to the bass track, listening to a loop). Point the cursor at the tip and it freezes (corner marks appear around it) until the cursor leaves: this lets you read it to the end. Click the tip to get another one. On the right is the coach's task: its keys are lit orange, and the cells at the bottom show how much is done; a click on the task explains what it is for. The trainer tells which part a track plays by its device (a Drum Rack means drums), by its name (bass, pad, lead, "бас", "аккорды", "мелодия" and so on) or by the notes of its first clip: low notes mean bass, three notes at once mean chords. If it gets this wrong, rename the track.

The device is wide: 986 pixels. If the right edge (the stage) is cut off after an update, delete the trainer from the track and drag it in from the browser again.

Ableton shows the devices of one track only, so the trainer is visible while its track is selected. To have it at hand everywhere, copy it to every MIDI track (select the device's title bar, Ctrl+C, then Ctrl+V on another track) or save the track with the trainer as the template for new ones: right-click the track's title bar, Save as Default MIDI Track. The copies behave as one trainer: the lesson, the step, the style and the points of one appear in the others a second later. Each copy hears the notes on its own track and passes them at once to the copy that is on the screen: that copy shows the keys and judges the playing, whichever track is selected. When you change track, the mood of the stage and the streak you have built pass to the new copy. If there are no devices on the screen at all (the clip editor is open), each copy judges the playing on its own track.

The trainer does not mistake pad hits on a track with a Drum Rack for keys. In free play only their rhythm counts: the keys in the picture do not light up, and a steady beat sets the stage rocking. A lesson for the keys does not hear pads from another track; a lesson for the pads does.

For cacophony the trainer takes points away: five at once and one more for every hit while it lasts. The score does not fall below the threshold of a level that is already open, so a level cannot be closed by noise. In a lesson the keys the step asks for do not count as noise.

The "Drills" level opens at 100 points. Its lessons can be taken as many times as you like: every run gives a new task, and a repeat earns 15 points.

The points are kept in the file `smk_trainer_progress.json` next to the device. To start from zero, delete this file.

## If something is wrong

| What happens | What to check |
|---|---|
| After a reboot the keyboard is silent, and the Input field of the Control Surface shows `None` | The port has come up under a different name. Run `start-bridge.cmd`, then choose Input → `SMK-37 BT` again |
| `SMK37` is not in the Control Surface list | The folder is at `User Library\Remote Scripts\SMK37`, and Ableton has been restarted |
| The encoders turn the wrong way | Change `ENCODER_LOW_VALUE_INCREASES` in `SMK37.py` |
| The pads or faders do not respond | Your keyboard uses different numbers: correct the constants at the top of `SMK37.py` |
| It is not clear which version of the trainer is loaded | The version number is written in the bottom right corner of the panel, under the coloured labels |
| Another track is selected, and the trainer on it does not see what I play | Fixed in version 0.9.3: the copy on the screen receives the notes from the copies on the other tracks. The trainer must also be on the track the notes arrive at (for the keys this is the track with channel `Ch. 4`), and all the copies must be the same version: it is written in the bottom right corner of the panel |
| Ableton stutters or freezes | Fixed in version 0.9.2. In free play the trainer used to create dozens of objects every second to talk to Ableton; now it manages with one, looks through the project once every few seconds and asks Ableton nothing while it is not on the screen. A still picture is redrawn 6 times a second instead of 12 |
| One click on an arrow turns two pages | Fixed in version 0.4.1. A mouse button often sends two presses instead of one, about 0.1 s apart, and the second arrives as a double click; the trainer used to count it as a separate press. If it happens again, put an empty file `smk_trainer_probe.txt` next to the device, reload the device and click around: everything Max sent will be in `smk_trainer_clicks.json` |
| Quick clicks on an arrow are skipped | Of two clicks less than 0.15 s apart only the first counts: this stops one press from turning two pages. Click a little more slowly or use the NEXT button |
| The panel used to have a COURSES button, and now it is gone | Since version 0.4.0 the courses stand in the common row of levels. The points and the completed lessons have been kept |
| A NOTES or CLIP step is not counted by itself | Open the clip you need with a double click: the trainer reads the clip that is shown in the note editor. An audio clip has no notes. If everything is done, press DONE |
| A DEVICE or KNOB step is not counted by itself | The device must be on the same track as the trainer (for drums, on the track with the Drum Rack). If everything is done and the step is still waiting, press DONE |
| An encoder turns a different knob from the one named in the lesson | The `SMK37` script is an old version: copy the new one and restart Ableton |
| The trainer shows an empty window | `smk_trainer.js` is not next to `SMK Trainer.amxd` |
| The trainer does not see the keys | The track is set to the wrong channel; it must be `Ch. 4` |
| The Mod wheel does not change the sound | In the instrument itself the wheel is not assigned to any parameter |
