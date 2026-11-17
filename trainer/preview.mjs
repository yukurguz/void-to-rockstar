// Renders the trainer outside Max. The trainer draws only filled rectangles,
// so a tiny rasteriser standing in for mgraphics reproduces the picture pixel
// for pixel. Writes one PNG with several game states stacked.
//
// Usage: node preview.mjs <output.png> [scale]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import zlib from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const output = process.argv[2];
const scale = Number(process.argv[3] ?? 1);
if (!output) {
    console.error("usage: node preview.mjs <output.png> [scale]");
    process.exit(1);
}

// The size of the picture is the one the trainer declares.
const size = /var W = (\d+);[^\n]*\s*var H = (\d+);/.exec(readFileSync(join(HERE, "smk_trainer.js"), "utf8"));
const W = Number(size[1]), H = Number(size[2]);
let pixels = new Uint8ClampedArray(W * H * 4);
let colour = [0, 0, 0];
let pending = [];
let rectCount = 0;

const mgraphics = new Proxy({
    set_source_rgba(r, g, b) { colour = [r * 255, g * 255, b * 255]; },
    rectangle(x, y, w, h) { pending.push([Math.round(x), Math.round(y), Math.round(w), Math.round(h)]); rectCount++; },
    fill() {
        for (const [x, y, w, h] of pending) {
            for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++) {
                for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) {
                    pixels.set([colour[0], colour[1], colour[2], 255], (yy * W + xx) * 4);
                }
            }
        }
        pending = [];
    },
}, {
    get: (target, name) => (name in target ? target[name] : () => {}),
    set: () => true,
});

function Task() {
    this.repeat = this.schedule = this.cancel = () => {};
}

// No save file and no Live API here: the trainer starts as for a new player.
function File() {
    this.isopen = false;
    this.close = () => {};
}

const sandbox = { mgraphics, Task, File, patcher: { filepath: "C:/preview/SMK Trainer.amxd" }, outlet: () => {}, post: () => {} };
vm.createContext(sandbox);
for (const file of ["sprites_data.js", "smk_trainer.js"]) {
    vm.runInContext(readFileSync(join(HERE, file), "utf8"), sandbox, { filename: file });
}
const run = (code) => vm.runInContext(code, sandbox);
sandbox.paint(); // the first paint starts the trainer

function ticks(n) {
    for (let i = 0; i < n; i++) sandbox.tick();
}

function press(pitches) {
    pitches.forEach((p) => sandbox.note(p, 100));
}

function release(pitches) {
    pitches.forEach((p) => sandbox.note(p, 0));
}

// Opens a lesson by stage id and number, as if everything before it were done.
function open(id, start) {
    release(run("held.slice()"));
    run("vibe = 0; mood = 0; particles = []; popups = []; banner = ''; recentOns = [];");
    run("selectLesson(LESSONS.filter(function (l) { return l.id === '" + id + "'; })[0])");
    if (start) {
        run("phase = 'intro'; startLesson();");
    }
}

// Free play in one style, with the stage at the given level of liveliness.
function jam(style, level) {
    release(run("held.slice()"));
    run("vibe = 0; mood = 0; particles = []; popups = []; banner = ''; recentOns = []; jamLine = []; jamChord = null;");
    run("enterJam(); while (STYLES[jam.style].id !== '" + style + "') { jamStyle(1); }");
    run("vibe = " + [0, 0.45, 0.7, 0.97][level] + "; mood = " + level + "; lastOn = clock + 40; lastMelody = clock + 40; chordChange = clock + 40;");
}
function solve(count) {
    for (let i = 0; i < count; i++) {
        const s = run("currentStep()");
        if (s.live || s.manual || s.click) {
            run("completeStep()");
        } else {
            const keys = s.any ? [60] : s.show;
            press(keys);
            ticks(3);
            release(keys);
        }
        ticks(3); // a player does not answer faster than this
    }
}

function setVibe(value, wait) {
    run("vibe = " + value + "; lastOn = clock + " + wait + ";");
    ticks(wait);
}

const scenes = [
    ["new player: the tour's title card", () => { open("start/0", false); ticks(4); }],
    ["tour: find the note", () => { open("start/0", true); solve(1); ticks(2); }],
    ["tour: an Ableton step", () => { open("start/0", true); solve(5); ticks(2); }],
    ["tour finished: the reward", () => { open("start/0", true); solve(8); ticks(14); }],
    ["a locked stage", () => { open("harmony/0", false); ticks(2); }],
    ["chords: a wrong key", () => { open("chords/1", true); press([61]); ticks(1); }],
    ["harmony: a seventh chord, calm stage", () => { open("harmony/0", true); press([60, 64, 67, 71]); ticks(5); }],
    ["polyphony: chord held, melody above", () => { open("hands/4", true); press([57, 60, 64]); ticks(2); }],
    ["drums: a rock beat on the pads", () => { open("drums/5", true); solve(3); press([38]); ticks(1); }],
    ["mood 1: dance", () => { open("start/0", false); setVibe(0.45, 14); }],
    ["mood 2: fire", () => { open("start/0", false); setVibe(0.72, 34); }],
    ["mood 3: trip", () => { open("start/0", false); setVibe(0.97, 40); }],
    ["mood -1: trouble", () => { open("start/0", false); setVibe(-0.45, 12); }],
    ["mood -2: storm with a lightning flash", () => {
        open("start/0", false);
        setVibe(-0.97, 6);
        while (run("flash") !== 2) { run("lastOn = clock + 2;"); ticks(1); }
    }],
    ["synth: title card of the filter lesson", () => { open("synth/1", false); ticks(4); }],
    ["synth: a knob step", () => { open("synth/1", true); solve(1); ticks(2); }],
    ["fx: the order of two devices", () => { open("fx/9", true); solve(2); ticks(2); }],
    ["genre: house, the tempo step", () => { open("dance/0", true); ticks(2); }],
    ["genre: house beat on the pads", () => { open("dance/1", true); solve(2); ticks(1); }],
    ["studio: automation", () => { open("studio/4", true); solve(1); ticks(2); }],
    ["training: title card with today's key", () => { run("progress.done['drill/5'] = 120; progress.reps['drill/5'] = 3; recount();"); open("drill/5", false); ticks(4); }],
    ["training: a progression in another key", () => { open("drill/5", true); solve(2); ticks(2); }],
    ["training: the reward of a repeat", () => { open("drill/0", true); solve(12); ticks(14); }],
    ["training: genre tempos", () => { open("drill/13", true); ticks(2); }],
    ["path: a course is a stage like any other, the line of the path under the buttons", () => { run("progress.done['start/0'] = 3000; recount();"); open("c-notes/16", false); ticks(4); }],
    ["course: broken thirds", () => { open("c-notes/27", true); solve(3); ticks(2); }],
    ["course: a recipe on the synth", () => { open("c-knobs/27", true); solve(2); ticks(2); }],
    ["course: two hands, the bass walks", () => { open("c-hands/22", true); press([60, 64, 67]); ticks(2); }],
    ["free play: the panel, nothing played yet", () => { jam("trance", 0); ticks(2); }],
    ["free play: a melody note outside the chord, where to go next", () => { jam("trance", 1); press([64]); ticks(2); release([64]); run("onsetMs = 0;"); press([62]); ticks(2); }],
    ["free play: a chord held, its notes become the ones to lean on", () => { jam("lofi", 1); press([53, 57, 60]); ticks(3); press([74]); ticks(1); }],
    ["free play: a note outside the scale", () => { jam("psy", 1); press([66]); ticks(2); }],
    ...run("STYLES.map(function (s) { return s.id; })")
        .flatMap((style) => [1, 2, 3].map((level) => ["scenery of " + style + ", level " + level, () => { jam(style, level); ticks(9); }])),
    ["synths of Live: Operator, a knob step", () => { open("c-synths/6", true); solve(1); ticks(2); }],
    ["synths of Live: a layer, the second instrument goes into the rack", () => { open("c-synths/35", true); solve(4); ticks(2); }],
    ["sequencer: title card", () => { open("c-seq/19", false); ticks(4); }],
    ["sequencer: draw four notes", () => { open("c-seq/0", true); solve(1); ticks(2); }],
    ["song: record the scenes to the arrangement", () => { open("c-song/11", true); solve(1); ticks(2); }],
    ["song: the form of house", () => { open("c-song/30", true); ticks(2); }],
    ["masters: title card of the first lesson on Globular", () => { open("c-masters/0", false); ticks(4); }],
    ["masters: the squelch, a knob step", () => { open("c-masters/1", true); solve(5); ticks(2); }],
    ["free play: a tip on playing in the style while the keys sound", () => { jam("psydub", 2); press([62]); ticks(2); }],
    ["free play: the cosmic mood, a scale with a raised fifth", () => { jam("ambient", 1); run("while (MOODS[jam.mood][0] !== 'Космическое') { jamMood(1); }"); ticks(2); }],
    ["free play: the weightless mood, a scale of six whole tones", () => { jam("trance", 2); run("while (MOODS[jam.mood][0] !== 'Невесомое') { jamMood(1); }"); press([66]); ticks(2); }],
    ["free play: the coach asks for the scale, the next key is lit", () => { jam("disco", 1); run("progress.coach = 2; coachReset(); taskAt = clock;"); press([62]); ticks(1); release([62]); press([64]); ticks(1); release([64]); ticks(1); }],
    ["free play: notes outside the scale, the advice says so at once", () => { jam("acid", 0); for (const p of [61, 63, 66]) { press([p]); ticks(1); release([p]); } ticks(1); }],
    ["free play: at rest the advice is about the form of the track", () => { jam("triphop", 1); run("lastOn = clock - 200; styleAt = -1000; moodAt = -1000; taskAt = -1000; counselTurn = 3; counselPinned = clock + 500; counsel.key = \"\";"); ticks(2); }],
    ["free play: a legend, the gauge at its end, a combo", () => { jam("funk", 3); run("mastery = 1.1; updateRank(); combo = 37; lastOn = clock;"); ticks(2); run("mastery = 1.1; updateRank(); combo = 37;"); }],
    ["free play: cacophony costs points", () => { jam("gabber", 0); run("progress.done = { 'start/0': 180 }; recount(); shownPoints = 180; vibe = -0.9; updateMood(); stormFined = false; cacophony();"); ticks(3); }],
    ["free play: Ableton is seen, every part has its tag, the longest page", () => {
        jam("house", 1);
        ticks(2);
        run("project = { api: true, tempo: 124, tracks: 5, has: { drums: true, bass: true }, empty: { chords: true }, clips: 3, scenes: 12, arranged: 4, bars: 128, cues: 0, space: true, limiter: false, selectedPart: \"bass\" }; lastOn = clock - 200; styleAt = -1000; moodAt = -1000; taskAt = -1000; counsel.key = \"\"; counselTick();");
    }],
    ["free play: the cursor rests on the advice, it is held and has corners", () => {
        jam("house", 1);
        ticks(2);
        run("lastOn = clock - 200; styleAt = -1000; moodAt = -1000; taskAt = -1000; counsel.key = \"\"; counselTick(); onidle(KX + 80, KY + KEY_H + 30);");
    }],
    ["path: the stage is done, the next one waits for points", () => {
        open("novice/7", true);
        solve(3);
        run("GROUPS[current.group + 1].need = progress.points + 240;");
        ticks(14);
    }],
];

// DANCE=<style> in the environment shows the dance of that style instead:
// one frame for every pose of it.
if (process.env.DANCE) {
    const style = process.env.DANCE;
    const count = run("TROUPES['" + style + "'].poses.length");
    scenes.length = 0;
    for (let k = 0; k < count; k++) {
        scenes.push(["dance of " + style + ", pose " + (k + 1), () => { jam(style, 2); run("dance.phase = " + k + " * TROUPES['" + style + "'].dance[0];"); }]);
    }
}

// Optional third and fourth arguments pick a part of the list: first scene, how many.
const first = Number(process.argv[4] ?? 0);
const shown = scenes.splice(first, Number(process.argv[5] ?? scenes.length));
scenes.length = 0;
scenes.push(...shown);

const gap = 6;
const sheet = new Uint8ClampedArray(W * (H + gap) * scenes.length * 4);
scenes.forEach(([name, setup], index) => {
    setup();
    pixels = new Uint8ClampedArray(W * H * 4);
    rectCount = 0;
    sandbox.paint();
    sheet.set(pixels, index * (H + gap) * W * 4);
    console.log(String(rectCount).padStart(5), "rectangles:", name);
});

function png(width, height, rgba) {
    const chunk = (type, data) => {
        const body = Buffer.concat([Buffer.from(type), data]);
        const out = Buffer.alloc(body.length + 8);
        out.writeUInt32BE(data.length, 0);
        body.copy(out, 4);
        out.writeUInt32BE(zlib.crc32(body), body.length + 4);
        return out;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 6, 0, 0, 0], 8);
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
    }
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const sheetH = (H + gap) * scenes.length;
const big = new Uint8ClampedArray(W * scale * sheetH * scale * 4);
for (let y = 0; y < sheetH * scale; y++) {
    for (let x = 0; x < W * scale; x++) {
        const src = (Math.floor(y / scale) * W + Math.floor(x / scale)) * 4;
        const dst = (y * W * scale + x) * 4;
        big[dst] = sheet[src]; big[dst + 1] = sheet[src + 1]; big[dst + 2] = sheet[src + 2]; big[dst + 3] = 255;
    }
}
writeFileSync(output, png(W * scale, sheetH * scale, big));
console.log("wrote", output);
