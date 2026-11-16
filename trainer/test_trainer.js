// Runs the trainer outside Max with stand-ins for the jsui globals (drawing,
// timers, the save file, the Live API) and plays through every lesson, so a
// typo, a lesson that cannot be finished or a stage that cannot be reached
// shows up here instead of in Ableton.
//
// Usage: node test_trainer.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const noop = () => {};
const SAVE_DIR = "C:/library/";
const files = {};           // the fake disk, shared by every trainer instance

function check(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

const OWN = "this_device canonical_parent";
const MASTER = "live_set master_track";
const RETURN_A = "live_set return_tracks 0";

// The state of the fake Ableton. Paths not listed here do not exist. The
// tempo is one no genre lesson asks for, so no tempo check holds by itself.
function freshLive() {
    const live = {
        "live_set": { metronome: 0, is_playing: 0, tempo: 200, record_mode: 0, loop: 0, scale_mode: 0,
                      midi_recording_quantization: 0, session_automation_record: 0,
                      counts: { tracks: 4, return_tracks: 2 } },
        "live_app view": { focused_document_view: "Session" },
        [OWN]: { arm: 0, mute: 0, solo: 0, is_frozen: 0, is_grouped: 0, counts: { clip_slots: 8 } },
        [MASTER]: { counts: {} },
        [RETURN_A]: { counts: {} },
        "live_set return_tracks 1": { counts: {} },
        "live_set tracks 0 mixer_device volume": { value: 0.85 },
        [OWN + " mixer_device sends 0"]: { value: 0 },
        [OWN + " mixer_device panning"]: { value: 0 },
    };
    for (let i = 0; i < 8; i++) {
        live[OWN + " clip_slots " + i] = { has_clip: 0 };
        live[OWN + " clip_slots " + i + " clip"] = { is_playing: 0, has_envelopes: 0 };
    }
    return live;
}

// Which knobs each device class needs, gathered from the lessons themselves
// (filled in once the first trainer exists). A pattern stands for one name.
const PATTERN_SAMPLES = {
    "^LP Mod Amt [12]$": "LP Mod Amt 1",
    "^(Osc 1 Oct|Transpose)$": "Osc 1 Oct",
    "^[LR] 16th$": "L 16th",
    "^[1-8] Gain A$": "3 Gain A",
    "^[1-8] Frequency A$": "3 Frequency A",
};
const KNOBS = {};
const SWITCHES = /On$|On\/Off$/;

function knobName(wanted) {
    if (wanted.charAt(0) !== "^") {
        return wanted.split(",")[0];
    }
    check(PATTERN_SAMPLES[wanted] && new RegExp(wanted).test(PATTERN_SAMPLES[wanted]), "no sample name for the pattern " + wanted);
    return PATTERN_SAMPLES[wanted];
}

function makeDevice(cls) {
    const names = ["Device On"].concat((KNOBS[cls] || []).filter((name) => name !== "Device On"));
    const device = {
        cls,
        params: names.map((name) => ({ name, original_name: name, min: 0, max: 1,
                                       value: name === "Device On" ? 1 : (SWITCHES.test(name) ? 0 : 0.5) })),
        chains: [],
    };
    if (cls === "DrumGroupDevice") {
        device.chains = [[makeDevice("DrumCell")], [makeDevice("DrumCell")]];
    }
    return device;
}

// A trainer and some instrument the lessons never ask for.
function freshDevices() {
    return { [OWN]: [makeDevice("MxDeviceMidiEffect"), makeDevice("Collision")], [MASTER]: [], [RETURN_A]: [], "live_set return_tracks 1": [] };
}

// Every device of the wanted classes on a track, racks opened one level.
function devicesOf(t, track, classes) {
    const out = [];
    for (const device of t.devices[track]) {
        out.push(device);
        for (const chain of device.chains) {
            out.push(...chain);
        }
    }
    return out.filter((device) => classes.split(",").indexOf(device.cls) >= 0);
}

function addDevice(t, track, classes) {
    const device = makeDevice(classes.split(",")[0]);
    // A MIDI effect dropped on a track may well land in front of the trainer.
    if (/^Midi/.test(device.cls)) {
        t.devices[track].unshift(device);
    } else {
        t.devices[track].push(device);
    }
}

function turnKnob(t, track, classes, wanted, direction) {
    const name = knobName(wanted);
    const devices = devicesOf(t, track, classes);
    check(devices.length > 0, "a knob step for " + classes + " comes before any step that adds the device");
    const knob = devices[0].params.filter((p) => p.name === name)[0];
    check(knob, classes + " has no knob " + name);
    if (direction === "up") {
        knob.value = Math.min(1, knob.value + 0.3);
    } else if (direction === "down") {
        knob.value = Math.max(0, knob.value - 0.3);
    } else if (direction === "on") {
        knob.value = 1;
    } else if (direction === "off") {
        knob.value = 0;
    } else if (direction === "changed") {
        knob.value += 1;
    } else {
        knob.value = knob.value > 0.5 ? knob.value - 0.3 : knob.value + 0.3;
    }
}

// How a player would satisfy the checks that take arguments.
const LIVE_ACTIONS = {
    tempo: (t, a) => { t.live["live_set"].tempo = (Number(a[0]) + Number(a[1])) / 2; },
    device: (t, a) => addDevice(t, OWN, a[0]),
    masterDevice: (t, a) => addDevice(t, MASTER, a[0]),
    returnDevice: (t, a) => addDevice(t, RETURN_A, a[0]),
    knob: (t, a) => turnKnob(t, OWN, a[0], a[1], a[2]),
    masterKnob: (t, a) => turnKnob(t, MASTER, a[0], a[1], a[2]),
    returnKnob: (t, a) => turnKnob(t, RETURN_A, a[0], a[1], a[2]),
    order: (t, a) => {
        const list = t.devices[OWN];
        const first = list.filter((d) => a[0].split(",").indexOf(d.cls) >= 0)[0];
        const second = list.filter((d) => a[1].split(",").indexOf(d.cls) >= 0)[0];
        check(first && second, "nothing to put in order for " + a.join(" before "));
        list.splice(list.indexOf(first), 1);
        list.splice(list.indexOf(second), 0, first);
    },
};

// How a player would satisfy each plain Ableton check.
const LIVE_SOLUTIONS = {
    clipAdded: (live) => {
        const free = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => !live[OWN + " clip_slots " + i].has_clip)[0];
        live[OWN + " clip_slots " + free].has_clip = 1;
    },
    clipAutomation: (live) => {
        live[OWN + " clip_slots 2"].has_clip = 1;
        live[OWN + " clip_slots 2 clip"].has_envelopes = 1;
    },
    automationArm: (live) => { live["live_set"].session_automation_record = 1; },
    loopOn: (live) => { live["live_set"].loop = 1; },
    scaleOn: (live) => { live["live_set"].scale_mode = 1; },
    quantizeOn: (live) => { live["live_set"].midi_recording_quantization = 5; },
    muted: (live) => { live[OWN].mute = 1; },
    unmuted: (live) => { live[OWN].mute = 0; },
    soloed: (live) => { live[OWN].solo = 1; },
    unsoloed: (live) => { live[OWN].solo = 0; },
    panMoved: (live) => { live[OWN + " mixer_device panning"].value = 0.4; },
    frozen: (live) => { live[OWN].is_frozen = 1; },
    grouped: (live) => { live[OWN].is_grouped = 1; },
    metronomeOn: (live) => { live["live_set"].metronome = 1; },
    playing: (live) => { live["live_set"].is_playing = 1; },
    stopped: (live) => { live["live_set"].is_playing = 0; },
    tempo90: (live) => { live["live_set"].tempo = 90; },
    armed: (live) => { live["this_device canonical_parent"].arm = 1; },
    hasClip: (live) => { live["this_device canonical_parent clip_slots 2"].has_clip = 1; },
    // a playing clip and the record button both start Ableton's transport
    clipPlaying: (live) => {
        live["this_device canonical_parent clip_slots 2"].has_clip = 1;
        live["this_device canonical_parent clip_slots 2 clip"].is_playing = 1;
        live["live_set"].is_playing = 1;
    },
    recordOn: (live) => { live["live_set"].record_mode = 1; live["live_set"].is_playing = 1; },
    arrangement: (live) => { live["live_app view"].focused_document_view = "Arranger"; },
    session: (live) => { live["live_app view"].focused_document_view = "Session"; },
    newTrack: (live) => { live["live_set"].counts.tracks++; },
    deviceAdded: (live, t) => addDevice(t, OWN, "Reverb"),
    volumeMoved: (live) => { live["live_set tracks 0 mixer_device volume"].value -= 0.2; },
    sendUp: (live) => { live["this_device canonical_parent mixer_device sends 0"].value = 0.5; },
};

// One trainer instance. withLive = false stands for a place without the Live API.
function createTrainer(withLive) {
    const t = { sent: [], rectangles: 0, live: freshLive(), devices: freshDevices() };
    const mgraphics = new Proxy({}, {
        get(target, name) {
            if (name === "rectangle") {
                return (x, y, w, h) => {
                    if (!(w > 0 && h > 0) || [x, y, w, h].some((v) => typeof v !== "number" || isNaN(v))) {
                        throw new Error("bad rectangle " + [x, y, w, h].join(","));
                    }
                    t.rectangles++;
                };
            }
            return name in target ? target[name] : noop;
        },
        set(target, name, value) {
            target[name] = value;
            return true;
        }
    });
    function Task() {
        this.schedule = this.repeat = this.cancel = noop;
    }
    function File(name, access) {
        this.isopen = access !== "read" || name in files;
        this.eof = 0;
        this.readstring = () => files[name];
        this.writestring = (text) => { files[name] = text; };
        this.close = noop;
    }
    // Devices, their chains and their knobs live in t.devices; everything else
    // is a plain path in t.live.
    function lookUp(objectPath) {
        const parts = /^(.+?) devices (\d+)(?: chains (\d+)(?: devices (\d+))?)?(?: parameters (\d+))?$/.exec(objectPath);
        if (!parts || !t.devices[parts[1]]) {
            return t.live[objectPath];
        }
        let device = t.devices[parts[1]][Number(parts[2])];
        if (device && parts[3] !== undefined) {
            const chain = device.chains[Number(parts[3])];
            if (!chain) {
                return undefined;
            }
            if (parts[4] === undefined) {
                return parts[5] === undefined ? { counts: { devices: chain.length } } : undefined;
            }
            device = chain[Number(parts[4])];
        }
        if (!device) {
            return undefined;
        }
        if (parts[5] !== undefined) {
            return device.params[Number(parts[5])];
        }
        return { class_name: device.cls, counts: { parameters: device.params.length, chains: device.chains.length } };
    }
    function LiveAPI(objectPath) {
        const object = () => lookUp(objectPath);
        this.id = object() ? "7" : "0";
        this.get = (property) => [object()[property]];
        this.getcount = (children) => (children === "devices" && t.devices[objectPath]
            ? t.devices[objectPath].length : object().counts[children]);
    }
    const sandbox = {
        mgraphics, Task, File,
        patcher: { filepath: SAVE_DIR + "SMK Trainer.amxd" },
        outlet: (...args) => t.sent.push(args),
        post: noop,
    };
    if (withLive) {
        sandbox.LiveAPI = LiveAPI;
    }
    vm.createContext(sandbox);
    for (const file of ["sprites_data.js", "smk_trainer.js"]) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, file), "utf8"), sandbox, { filename: file });
    }
    // Time stands still unless the test lets ticks pass: 83 ms each, as in Max.
    t.time = 1000000;
    sandbox.nowMs = () => t.time;
    t.box = sandbox;
    t.run = (code) => vm.runInContext(code, sandbox);
    t.press = (pitches) => { pitches.forEach((p) => sandbox.note(p, 100)); sandbox.paint(); };
    t.release = (pitches) => { pitches.forEach((p) => sandbox.note(p, 0)); sandbox.paint(); };
    t.releaseAll = () => t.release(t.run("held.slice()"));
    t.ticks = (n) => { for (let i = 0; i < n; i++) { t.time += 83; sandbox.tick(); } sandbox.paint(); };
    t.click = (button) => {
        const rect = t.run("BUTTONS." + button);
        sandbox.onclick(rect[0] + 3, rect[1] + 3);
    };
    t.clickWheel = (ring, index) => {
        const angle = (-90 + index * 30) * Math.PI / 180;
        const radius = ring === 0 ? 66 : 40;
        sandbox.onclick(86 + radius * Math.cos(angle), 85 + radius * Math.sin(angle));
    };
    sandbox.paint(); // the first paint loads the save file and starts the timer
    return t;
}

// Does what the current step asks for, the way a player would.
function solveStep(t) {
    const s = t.run("currentStep()");
    const before = t.run("step");
    if (s.any) {
        t.press([60]);
        t.release([60]);
    } else if (s.click) {
        t.clickWheel(0, 0);
        t.box.stopPreview();
    } else if (s.live) {
        const parts = s.live.split(":");
        check(LIVE_SOLUTIONS[parts[0]] || LIVE_ACTIONS[parts[0]], "no way to solve the Ableton check " + s.live);
        t.ticks(18);
        // Two devices may happen to stand in the wanted order from the start;
        // every other check must wait for the player.
        if (t.run("step") === before) {
            if (LIVE_ACTIONS[parts[0]]) {
                LIVE_ACTIONS[parts[0]](t, parts.slice(1));
            } else {
                LIVE_SOLUTIONS[parts[0]](t.live, t);
            }
            t.ticks(7);
        } else {
            check(parts[0] === "order", "check " + s.live + " passed before anything was done");
        }
    } else if (s.manual) {
        check(t.run("mainAction()") === "ГОТОВО", "manual step without a confirm button");
        t.click("main");
    } else {
        t.press(s.show);
        check(t.run("achieved") === true, t.run("current.id") + " step " + before + " (" + s.label + "): its own notes " + s.show + " were rejected");
        if (s.hold) {
            // only the moving voice lets go; the held part stays down
            t.release([s.show[s.show.length - 1]]);
            check(t.run("step") === before + 1 || t.run("phase") === "done", "hold step did not advance when the moving note was released");
        }
        t.releaseAll();
    }
    check(t.run("step") === before + 1 || t.run("phase") === "done",
          t.run("current.id") + " step " + before + " (" + s.label + ") did not finish");
}

function playLesson(t, id, withMistake) {
    t.live = freshLive(); // every lesson meets Ableton in its default state
    t.devices = freshDevices();
    t.run("selectLesson(LESSONS.filter(function (l) { return l.id === '" + id + "'; })[0])");
    check(t.run("phase") === "intro", id + " should be open, got " + t.run("phase"));
    t.box.paint();
    t.click("main"); // START
    check(t.run("phase") === "run", id + " did not start");
    const total = t.run("steps.length");
    check(total > 0, id + " has no steps");
    for (let i = 0; i < total; i++) {
        const s = t.run("currentStep()");
        if (withMistake && i === 0 && (s.pcs.length > 0 || s.drums) && !s.any) {
            const wrongKey = s.drums ? 50 : [61, 63, 66, 68, 70, 60, 62].find((p) => s.pcs.indexOf(p % 12) < 0 && !(s.hold && s.hold.indexOf(p % 12) >= 0));
            t.press([wrongKey]);
            check(t.run("wrong") === true && t.run("mistakes") === 1, id + ": wrong key " + wrongKey + " not flagged");
            t.release([wrongKey]);
        }
        solveStep(t);
    }
    check(t.run("phase") === "done", id + " did not finish");
    t.ticks(2);
    return t.run("reward");
}

// ---------------------------------------------------------------- the run

const trainer = createTrainer(true);
const run = trainer.run;

// What the lessons ask of Ableton: every check must be known to the trainer,
// and a knob step must come after a step that puts its device in place.
const liveSteps = run(`LESSONS.map(function (item) {
    return { id: item.id, checks: buildSteps(item).filter(function (s) { return s.live; }).map(function (s) { return s.live; }) };
})`);
for (const item of liveSteps) {
    let devicesSoFar = 0;
    for (const spec of item.checks) {
        const parts = spec.split(":");
        check(run("typeof LIVE_CHECKS['" + parts[0] + "']") === "function", item.id + " uses an unknown check " + spec);
        if (/[dD]evice$/.test(parts[0])) {
            devicesSoFar++;
        }
        if (/[kK]nob$/.test(parts[0])) {
            check(parts.length === 4, item.id + ": a knob check needs device, knob and direction: " + spec);
            check(devicesSoFar > 0, item.id + " turns a knob before any step asks for the device: " + spec);
            for (const cls of parts[1].split(",")) {
                KNOBS[cls] = KNOBS[cls] || [];
                if (KNOBS[cls].indexOf(knobName(parts[2])) < 0) {
                    KNOBS[cls].push(knobName(parts[2]));
                }
            }
        }
    }
}

// Everything printed in a fixed area has to fit into it.
const overflow = run(`(function () {
    var wide = TEXT_RIGHT - KX, bad = [];
    function fits(text, width, lines, what) {
        if (text && wrap(text, width).length > lines) { bad.push(what + " (" + wrap(text, width).length + " lines)"); }
    }
    for (var i = 0; i < LESSONS.length; i++) {
        var item = LESSONS[i];
        fits("ЗАЧЕМ: " + item.why, wide, 3, item.id + " why");
        fits("КАК: " + item.hint, wide, 2, item.id + " hint");
        fits(item.task, wide, 5, item.id + " task");
        fits(item.title, PW, 2, item.id + " title");
        var list = buildSteps(item);
        for (var k = 0; k < list.length; k++) { fits(list[k].text, wide, 5, item.id + " step " + (k + 1)); }
    }
    return bad.join("; ");
}())`);
check(overflow === "", "text does not fit: " + overflow);

// A fresh player: nothing earned, the tour is offered, the next stage is shut.
check(run("current.id") === "start/0" && run("phase") === "intro", "should begin on the tour");
check(run("progress.points") === 0, "should begin with no points");
check(run("groupOpen(1)") === false, "stage 2 must be locked at the start");
run("selectLesson(GROUPS[1].lessons[0])");
check(run("phase") === "locked", "a lesson of a locked stage must be locked");
trainer.box.paint();
trainer.click("main");
trainer.press([60]);
trainer.releaseAll();
check(run("phase") === "locked", "a locked lesson must not start");
run("selectLesson(GROUPS[0].lessons[0])");

// A key press on the title card starts the lesson.
trainer.press([62]);
check(run("phase") === "run" && run("step") === 0, "a key press should start the lesson");
trainer.releaseAll();

// Every stage in order, every lesson in order. Reaching each stage with the
// points earned so far proves the unlock thresholds can be met.
const groups = run("GROUPS.map(function (g) { return { id: g.id, need: g.need, lessons: g.lessons.map(function (l) { return { id: l.id, kind: l.kind }; }) }; })");
let played = 0;
for (const group of groups) {
    check(run("progress.points") >= group.need, "stage " + group.id + " needs " + group.need + " points but only " + run("progress.points") + " can be earned before it");
    for (const item of group.lessons) {
        if (item.kind === "free") {
            continue;
        }
        const reward = playLesson(trainer, item.id, played % 2 === 0);
        check(reward.gain > 0, item.id + " gave no points");
        check(run("progress.done['" + item.id + "']") === reward.total, item.id + " was not recorded");
        played++;
    }
}

// The thresholds must also be reachable without the pads (no drum stages, no
// beat lessons) and without any bonus, by a player who makes mistakes everywhere.
const base = run(`GROUPS.map(function (g) {
    var sum = 0;
    for (var i = 0; i < g.lessons.length; i++) {
        var kind = g.lessons[i].kind;
        if (kind !== 'free' && kind !== 'drums') { sum += g.lessons[i].pts || Math.max(50, buildSteps(g.lessons[i]).length * 10); }
    }
    return { id: g.id, need: g.need, sum: sum, pads: g.id === 'drums' || !!g.pads };
})`);
let earned = 0;
for (const group of base) {
    check(earned >= group.need, "without bonuses and pads stage " + group.id + " (" + group.need + ") is out of reach: " + earned);
    if (!group.pads) {
        earned += group.sum;
    }
}

// A shelf stage offers all its lessons at once; an ordinary one goes in order.
const beginner = createTrainer(true);
beginner.run("progress.done = { 'start/0': 2000 }; recount();");
check(beginner.run("lessonOpen(GROUPS.filter(function (g) { return g.id === 'dance'; })[0].lessons[5])") === true, "a shelf lesson should be open without the ones before it");
check(beginner.run("lessonOpen(GROUPS.filter(function (g) { return g.id === 'synth'; })[0].lessons[5])") === false, "an ordinary stage must keep its order");

// A knob that the device does not have never passes and is not searched for
// again and again; the confirm button stays.
trainer.live = freshLive();
trainer.devices = freshDevices();
trainer.devices[OWN].push({ cls: "Drift", params: [{ name: "Device On", original_name: "Device On", min: 0, max: 1, value: 1 }], chains: [] });
run("selectLesson(LESSONS.filter(function (l) { return l.id === 'synth/1'; })[0])");
trainer.click("main");
trainer.ticks(20);
check(run("step") === 1, "the device step should pass when Drift is already there, got step " + run("step"));
trainer.ticks(40);
check(run("step") === 1 && run("mainAction()") === "ГОТОВО", "a missing knob must leave the step waiting with a confirm button");
check(run("knobWatch.until") > run("clock"), "a device without the knob is being searched on every check");

// What one trainer earns, another one sees as soon as it moves to a lesson.
const keysTrainer = createTrainer(true);
const padsTrainer = createTrainer(true);
const before = padsTrainer.run("progress.points");
playLesson(keysTrainer, "synth/11", false);
padsTrainer.run("selectLesson(LESSONS[2])");
check(padsTrainer.run("progress.points") === keysTrainer.run("progress.points") && padsTrainer.run("progress.points") >= before,
      "the second trainer did not pick up the points of the first");

// Replaying a lesson pays only for beating the old score.
const again = playLesson(trainer, "novice/1", true);
check(again.gain === 0, "a worse replay must not pay again");

// The save file: a second trainer sees the same points and the same place.
const saved = JSON.parse(files[SAVE_DIR + "smk_trainer_progress.json"]);
check(saved.points === run("progress.points") && saved.points > 5000, "points were not saved");
const second = createTrainer(true);
check(second.run("progress.points") === saved.points, "the second trainer did not load the points");
check(second.run("groupOpen(GROUPS.length - 1)") === true, "the last stage should be open after everything");

// Without the Live API a mission still works through the confirm button.
for (const name of Object.keys(files)) {
    delete files[name];
}
const offline = createTrainer(false);
offline.click("main");
check(offline.run("phase") === "run", "tour did not start offline");
while (offline.run("phase") === "run") {
    const s = offline.run("currentStep()");
    if (s.live) {
        offline.ticks(6);
        check(offline.run("mainAction()") === "ГОТОВО", "no confirm button for an Ableton step");
        offline.click("main");
    } else {
        solveStep(offline);
    }
}
check(offline.run("phase") === "done", "tour did not finish offline");

// Free play recognises chords and their place in the key.
const free = createTrainer(true);
free.run("selectLesson(GROUPS[0].lessons[1])");
check(free.run("phase") === "run", "free play should open at once");
const names = [[[60, 64, 67], "C"], [[57, 60, 64], "Am"], [[62, 65, 69, 72], "Dm7"], [[55, 59, 62, 65], "G7"], [[60, 65, 67], "Csus4"], [[66, 70, 73], "F#"]];
for (const [pitches, name] of names) {
    free.press(pitches);
    check(free.run("detectChord(unique(held.map(function (p) { return p % 12; })), held[0] % 12).name") === name, name + " not recognised");
    free.releaseAll();
}

// ------------------------------------------------- the mood of the stage

// Forgets everything the stage has heard so far.
const RESET = "vibe = 0; mood = 0; recentOns = []; recentPcs = []; pulse = 0; groove = 0; misses = 0; onsetMs = 0; "
    + "sameChord = 0; lastChord = ''; lastChordPcs = []; lastPitch = -1; lastMelody = -1000; chordChange = -1000;";

// Presses keys for some ticks, lets go, then waits.
function strike(t, pitches, holdTicks, restTicks) {
    t.press(pitches);
    t.ticks(holdTicks);
    t.releaseAll();
    t.ticks(restTicks);
}

const mood = (t) => t.run("mood");
const vibe = (t) => t.run("vibe");

// One note hammered in perfect time is not music.
free.run(RESET);
for (let i = 0; i < 40; i++) {
    strike(free, [60], 2, 2);
}
check(mood(free) === 0 && vibe(free) < 0.1, "one repeated note pleased the stage: mood " + mood(free) + ", vibe " + vibe(free));

// Two notes back and forth are not much either.
free.run(RESET);
for (let i = 0; i < 40; i++) {
    strike(free, [i % 2 ? 62 : 60], 2, 2);
}
check(mood(free) === 0, "two alternating notes started the dance: vibe " + vibe(free));

// A tune in the key, in steady time, does.
const tune = [60, 62, 64, 65, 67, 65, 64, 62];
free.run(RESET);
for (let i = 0; i < 48; i++) {
    strike(free, [tune[i % 8]], 2, 2);
}
const steadyTune = vibe(free);
check(mood(free) >= 1 && mood(free) < 3, "a steady tune should dance but not trip: mood " + mood(free) + ", vibe " + steadyTune);

// The same tune at random moments scores clearly lower: the stage feels rhythm.
free.run(RESET);
let dice = 7;
for (let i = 0; i < 48; i++) {
    dice = (dice * 1103 + 12345) % 2048;
    strike(free, [tune[i % 8]], 1, 1 + dice % 9);
}
check(vibe(free) < steadyTune - 0.15, "random timing scored " + vibe(free) + ", steady " + steadyTune);

// Chords in steady time: dance or fire, but not the top mood without a melody.
const triads = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [57, 60, 64]];
free.run(RESET);
for (let i = 0; i < 32; i++) {
    strike(free, triads[i % 4], 8, 4);
}
const changingChords = vibe(free);
check(mood(free) >= 1 && mood(free) <= 2, "a chord progression should reach dance or fire: mood " + mood(free) + ", vibe " + changingChords);

// One chord over and over cools down.
free.run(RESET);
for (let i = 0; i < 32; i++) {
    strike(free, triads[0], 8, 4);
}
check(vibe(free) < changingChords - 0.2 && mood(free) <= 1, "one repeated chord scored " + vibe(free) + ", a progression " + changingChords);

// Chords with a melody on top, in time: only this reaches the top mood.
const leftHand = [[48, 52, 55], [53, 57, 60], [55, 59, 62], [45, 48, 52]];
const rightHand = [[72, 74, 76], [72, 69, 77], [74, 71, 79], [72, 76, 69]];
free.run(RESET);
for (let round = 0; round < 10; round++) {
    for (let c = 0; c < 4; c++) {
        free.press(leftHand[c]);
        free.ticks(3);
        for (const melody of rightHand[c]) {
            free.press([melody]);
            free.ticks(2);
            free.release([melody]);
            free.ticks(1);
        }
        free.releaseAll();
    }
}
check(mood(free) === 3, "chords with a melody should reach the top mood, got " + mood(free) + " at vibe " + vibe(free));
free.ticks(40); // the stage in full swing: plasma, trails, rockets

// Seventh chords and wide two-hand chords are harmony, not clashes.
for (const [pitches, name] of [[[60, 64, 67, 71], "Cmaj7"], [[55, 59, 62, 65], "G7"], [[50, 62, 65, 69, 72, 76], "a two-hand Dm9"]]) {
    free.run(RESET);
    free.ticks(40);
    free.press(pitches);
    check(vibe(free) >= 0, name + " was taken for a clash: vibe " + vibe(free));
    free.releaseAll();
}

// On the pads only the rhythm counts: a steady kick lifts the mood, a
// stumbling one does not.
free.run("selectLesson(LESSONS.filter(function (l) { return l.id === 'drums/1'; })[0])");
free.run(RESET);
for (let i = 0; i < 24; i++) {
    strike(free, [36], 1, 3);
}
const steadyKick = vibe(free);
check(steadyKick > 0.3, "a steady kick did not lift the mood: " + steadyKick);
free.run(RESET);
for (let i = 0; i < 24; i++) {
    dice = (dice * 1103 + 12345) % 2048;
    strike(free, [36], 1, 1 + dice % 9);
}
check(vibe(free) < steadyKick - 0.2, "a stumbling kick scored " + vibe(free) + ", a steady one " + steadyKick);
free.run("selectLesson(GROUPS[0].lessons[1])");

// A fist on the keys brings the storm.
free.run(RESET);
free.ticks(40);
free.press([60, 61, 62, 63, 64, 65]);
check(free.run("mood") === -2, "a fist on the keys should bring the storm, got " + free.run("mood"));
free.releaseAll();
free.ticks(40); // lightning strikes during these
free.ticks(200);
check(free.run("mood") === 0 && free.run("vibe") === 0, "the mood should settle in silence");
check(free.run("particles.length") === 0, "particles never expire");

// Every character used anywhere has a glyph, so nothing falls back to "?".
const missing = run(`(function () {
    var texts = ["СТАРТ ДАЛЬШЕ ГОТОВО ПОСЛУШАТЬ ЗАНОВО ★ → % ?"], seen = {}, missing = [];
    for (var i = 0; i < LESSONS.length; i++) {
        var item = LESSONS[i];
        texts.push(item.title, item.why, item.hint, item.task || "", GROUPS[item.group].title);
        var list = buildSteps(item);
        for (var k = 0; k < list.length; k++) { texts.push(list[k].label, list[k].sub || "", list[k].sub2 || "", list[k].text || ""); }
    }
    for (var name in BANNERS) { texts.push(BANNERS[name]); }
    texts.push(NOTE_RU.join(""), KEY_RU.join(""));
    for (var t = 0; t < texts.length; t++) {
        for (var c = 0; c < texts[t].length; c++) {
            var ch = texts[t].charAt(c);
            if (ch !== " " && !GLYPHS[ch] && !GLYPHS[ch.toUpperCase()] && !seen[ch]) { seen[ch] = true; missing.push(ch); }
        }
    }
    return missing.join("");
}())`);
check(missing === "", "no glyph for: " + missing);

console.log("ok: " + groups.length + " stages, " + played + " lessons played, " + saved.points + " points, "
    + (trainer.rectangles + free.rectangles) + " rectangles drawn");
