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

// The state of the fake Ableton. Paths not listed here do not exist.
function freshLive() {
    const live = {
        "live_set": { metronome: 0, is_playing: 0, tempo: 120, record_mode: 0, counts: { tracks: 4 } },
        "live_app view": { focused_document_view: "Session" },
        "this_device canonical_parent": { arm: 0, counts: { clip_slots: 8, devices: 2 } },
        "live_set tracks 0 mixer_device volume": { value: 0.85 },
        "this_device canonical_parent mixer_device sends 0": { value: 0 },
    };
    for (let i = 0; i < 8; i++) {
        live["this_device canonical_parent clip_slots " + i] = { has_clip: 0 };
        live["this_device canonical_parent clip_slots " + i + " clip"] = { is_playing: 0 };
    }
    return live;
}

// How a player would satisfy each Ableton check.
const LIVE_SOLUTIONS = {
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
    deviceAdded: (live) => { live["this_device canonical_parent"].counts.devices++; },
    volumeMoved: (live) => { live["live_set tracks 0 mixer_device volume"].value -= 0.2; },
    sendUp: (live) => { live["this_device canonical_parent mixer_device sends 0"].value = 0.5; },
};

// One trainer instance. withLive = false stands for a place without the Live API.
function createTrainer(withLive) {
    const t = { sent: [], rectangles: 0, live: freshLive() };
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
    function LiveAPI(objectPath) {
        const object = () => t.live[objectPath];
        this.id = object() ? "7" : "0";
        this.get = (property) => [object()[property]];
        this.getcount = (children) => object().counts[children];
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
        check(LIVE_SOLUTIONS[s.live], "no way to solve the Ableton check " + s.live);
        t.ticks(15);
        check(t.run("step") === before, "check " + s.live + " passed before anything was done");
        LIVE_SOLUTIONS[s.live](t.live);
        t.ticks(3);
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

// The thresholds must also be reachable without the drum stage and without
// any bonus, by a player who makes mistakes everywhere.
const base = run(`GROUPS.map(function (g) {
    var sum = 0;
    for (var i = 0; i < g.lessons.length; i++) {
        if (g.lessons[i].kind !== 'free') { sum += g.lessons[i].pts || Math.max(50, buildSteps(g.lessons[i]).length * 10); }
    }
    return { id: g.id, need: g.need, sum: sum };
})`);
let earned = 0;
for (const group of base) {
    check(earned >= group.need, "without bonuses and drums stage " + group.id + " (" + group.need + ") is out of reach: " + earned);
    if (group.id !== "drums") {
        earned += group.sum;
    }
}

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
