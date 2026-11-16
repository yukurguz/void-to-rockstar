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

const W = 860, H = 169;
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
    ["mood 1: dance", () => { open("start/1", false); setVibe(0.45, 14); }],
    ["mood 2: fire", () => { open("start/1", false); setVibe(0.72, 34); }],
    ["mood 3: trip", () => { open("start/1", false); setVibe(0.97, 40); }],
    ["mood -1: trouble", () => { open("start/1", false); setVibe(-0.45, 12); }],
    ["mood -2: storm with a lightning flash", () => {
        open("start/1", false);
        setVibe(-0.97, 6);
        while (run("flash") !== 2) { run("lastOn = clock + 2;"); ticks(1); }
    }],
];

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
