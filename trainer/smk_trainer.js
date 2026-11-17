// SMK Trainer: a pixel-art keyboard school inside a Max for Live MIDI effect.
// Input:  "note <pitch> <velocity>" for every key press and release.
// Output: "<pitch> <velocity>" pairs for noteout (chord preview on click).
//
// Lessons are grouped into stages from first steps to virtuoso. Finishing a
// lesson earns points, points are saved to disk and open the next stages.
// Besides playing, there are Ableton missions that are checked through the
// Live API. The stage on the right reacts to how musical the playing is.
//
// Everything is drawn as axis-aligned rectangles in a fixed palette, text
// included, so the picture stays crisp and can be rendered outside Max
// (see preview.mjs). Written for the old jsui engine: ES5 only.
// SPRITES comes from sprites_data.js, which the build puts in front of this file.

autowatch = 1;
inlets = 1;
outlets = 1;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

// Shown in the corner of the panel, so it is plain which trainer Ableton has
// loaded. release.py refuses to pack a release under any other number.
var VERSION = "0.9.3";

var W = 986;      // wheel, keyboard, panel and stage side by side: see the geometry below
var H = 169;
var TICK_MS = 83; // 12 frames a second
var SAVE_NAME = "smk_trainer_progress.json";

// ---------------------------------------------------------------- palette

var COLORS = [];

function addColor(hex) {
    COLORS.push([parseInt(hex.substr(0, 2), 16) / 255,
                 parseInt(hex.substr(2, 2), 16) / 255,
                 parseInt(hex.substr(4, 2), 16) / 255]);
    return COLORS.length - 1;
}

var INK = addColor("10111c");
var NIGHT = addColor("1a1c2c");
var STEEL = addColor("333c57");
var SLATE = addColor("566c86");
var SILVER = addColor("94b0c2");
var WHITE = addColor("f4f4f4");
var RED = addColor("b13e53");
var ORANGE = addColor("ef7d57");
var YELLOW = addColor("ffcd75");
var LIME = addColor("a7f070");
var GREEN = addColor("38b764");
var TEAL = addColor("257179");
var NAVY = addColor("29366f");
var BLUE = addColor("3b5dc9");
var SKY = addColor("41a6f6");
var CYAN = addColor("73eff7");
var ORANGE_DIM = addColor("8f4a3d");
var GREEN_DIM = addColor("1f6b47");
var PLUM = addColor("5d275d");

function shiftHue(rgb, degrees) {
    var r = rgb[0], g = rgb[1], b = rgb[2];
    var max = Math.max(r, g, b), min = Math.min(r, g, b), spread = max - min;
    var hue = 0;
    if (spread > 0) {
        if (max === r) {
            hue = (g - b) / spread;
        } else if (max === g) {
            hue = (b - r) / spread + 2;
        } else {
            hue = (r - g) / spread + 4;
        }
        hue *= 60;
    }
    hue = (((hue + degrees) % 360) + 360) % 360;
    var second = spread * (1 - Math.abs((hue / 60) % 2 - 1));
    var out = hue < 60 ? [spread, second, 0] : hue < 120 ? [second, spread, 0]
            : hue < 180 ? [0, spread, second] : hue < 240 ? [0, second, spread]
            : hue < 300 ? [second, 0, spread] : [spread, 0, second];
    return [out[0] + min, out[1] + min, out[2] + min];
}

// Twelve saturated hues for the plasma of the "trip" mood, and the same
// twelve in the dark, for the scenery of free play.
var RAINBOW = [];
var DEEP = [];
(function () {
    var i;
    for (i = 0; i < 12; i++) {
        COLORS.push(shiftHue([0.95, 0.25, 0.35], i * 30));
        RAINBOW.push(COLORS.length - 1);
    }
    for (i = 0; i < 12; i++) {
        COLORS.push(shiftHue([0.42, 0.08, 0.16], i * 30));
        DEEP.push(COLORS.length - 1);
    }
}());

// Eight light, sweet hues for the gentler sceneries.
var PASTEL = [];
(function () {
    for (var i = 0; i < 8; i++) {
        COLORS.push(shiftHue([1, 0.66, 0.78], i * 45));
        PASTEL.push(COLORS.length - 1);
    }
}());

// Three skin tones for the dancers of free play.
var PEACH = addColor("f2c9a0");
var TAN = addColor("c68e5c");
var BROWN = addColor("7a4a2e");

// ------------------------------------------------------- rectangle batches

// Rectangles are collected per colour and filled once per colour, which is far
// cheaper than one fill per pixel. Within one batch the colours are painted in
// palette order, not in call order, so shapes that overlap must be separated
// by flush(): it ends a layer, and later layers paint over earlier ones.
var batches = [];

function px(x, y, w, h, colour) {
    var batch = batches[colour];
    if (!batch) {
        batch = batches[colour] = [];
    }
    batch.push(x, y, w, h);
}

function flush() {
    for (var colour = 0; colour < batches.length; colour++) {
        var batch = batches[colour];
        if (!batch || batch.length === 0) {
            continue;
        }
        var rgb = COLORS[colour];
        mgraphics.set_source_rgba(rgb[0], rgb[1], rgb[2], 1);
        for (var i = 0; i < batch.length; i += 4) {
            mgraphics.rectangle(batch[i], batch[i + 1], batch[i + 2], batch[i + 3]);
        }
        mgraphics.fill();
        batch.length = 0;
    }
}

// ------------------------------------------------------------- pixel font

// 5x7 glyphs, proportional width. Text is drawn in capitals; the few small
// letters exist for chord names (Am, Bb, Cmaj7, Gsus4, Bdim, Caug, Cadd9)
// and for roman numerals (ii - V - I).
var GLYPH_SOURCE = {
    "A": ".###.|#...#|#...#|#####|#...#|#...#|#...#",
    "B": "####.|#...#|#...#|####.|#...#|#...#|####.",
    "C": ".###.|#...#|#....|#....|#....|#...#|.###.",
    "D": "####.|#...#|#...#|#...#|#...#|#...#|####.",
    "E": "#####|#....|#....|####.|#....|#....|#####",
    "F": "#####|#....|#....|####.|#....|#....|#....",
    "G": ".###.|#...#|#....|#.###|#...#|#...#|.###.",
    "H": "#...#|#...#|#...#|#####|#...#|#...#|#...#",
    "I": "###|.#.|.#.|.#.|.#.|.#.|###",
    "J": "..###|...#.|...#.|...#.|...#.|#..#.|.##..",
    "K": "#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#",
    "L": "#....|#....|#....|#....|#....|#....|#####",
    "M": "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#",
    "N": "#...#|##..#|##..#|#.#.#|#..##|#..##|#...#",
    "O": ".###.|#...#|#...#|#...#|#...#|#...#|.###.",
    "P": "####.|#...#|#...#|####.|#....|#....|#....",
    "Q": ".###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#",
    "R": "####.|#...#|#...#|####.|#.#..|#..#.|#...#",
    "S": ".####|#....|#....|.###.|....#|....#|####.",
    "T": "#####|..#..|..#..|..#..|..#..|..#..|..#..",
    "U": "#...#|#...#|#...#|#...#|#...#|#...#|.###.",
    "V": "#...#|#...#|#...#|#...#|#...#|.#.#.|..#..",
    "W": "#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#",
    "X": "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
    "Y": "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..",
    "Z": "#####|....#|...#.|..#..|.#...|#....|#####",
    "0": ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.",
    "1": ".#.|##.|.#.|.#.|.#.|.#.|###",
    "2": ".###.|#...#|....#|...#.|..#..|.#...|#####",
    "3": ".###.|#...#|....#|..##.|....#|#...#|.###.",
    "4": "...#.|..##.|.#.#.|#..#.|#####|...#.|...#.",
    "5": "#####|#....|####.|....#|....#|#...#|.###.",
    "6": ".###.|#....|#....|####.|#...#|#...#|.###.",
    "7": "#####|....#|...#.|..#..|..#..|..#..|..#..",
    "8": ".###.|#...#|#...#|.###.|#...#|#...#|.###.",
    "9": ".###.|#...#|#...#|.####|....#|....#|.###.",
    ".": ".|.|.|.|.|.|#",
    ",": "..|..|..|..|..|.#|#.",
    ":": ".|.|#|.|.|#|.",
    "!": "#|#|#|#|#|.|#",
    "?": ".###.|#...#|....#|...#.|..#..|.....|..#..",
    "-": "....|....|....|####|....|....|....",
    "+": ".....|..#..|..#..|#####|..#..|..#..|.....",
    "/": "....#|....#|...#.|..#..|.#...|#....|#....",
    "%": "##..#|##..#|...#.|..#..|.#...|#..##|#..##",
    "(": ".#|#.|#.|#.|#.|#.|.#",
    ")": "#.|.#|.#|.#|.#|.#|#.",
    "<": "...#|..#.|.#..|#...|.#..|..#.|...#",
    ">": "#...|.#..|..#.|...#|..#.|.#..|#...",
    "#": ".#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.",
    "→": ".....|..#..|...#.|#####|...#.|..#..|.....",
    "°": ".#.|#.#|.#.|...|...|...|...",
    "★": "..#..|..#..|#####|.###.|.###.|##.##|#...#",
    "a": ".....|.....|.###.|....#|.####|#...#|.####",
    "b": "#...|#...|#...|###.|#..#|#..#|###.",
    "d": "....#|....#|.####|#...#|#...#|#...#|.####",
    "g": ".....|.....|.####|#...#|.####|....#|.###.",
    "i": "#|.|#|#|#|#|#",
    "j": ".#|..|.#|.#|.#|.#|#.",
    "m": ".....|.....|##.#.|#.#.#|#.#.#|#.#.#|#.#.#",
    "s": ".....|.....|.####|#....|.###.|....#|####.",
    "u": ".....|.....|#...#|#...#|#...#|#..##|.##.#",
    "v": ".....|.....|#...#|#...#|#...#|.#.#.|..#..",
    "Б": "#####|#....|#....|####.|#...#|#...#|####.",
    "Г": "#####|#....|#....|#....|#....|#....|#....",
    "Д": ".####|.#..#|.#..#|.#..#|.#..#|#####|#...#",
    "Ж": "#.#.#|#.#.#|.###.|..#..|.###.|#.#.#|#.#.#",
    "И": "#...#|#...#|#..##|#.#.#|##..#|#...#|#...#",
    "Й": ".#.#.|..#..|#...#|#..##|#.#.#|##..#|#...#",
    "Л": "..###|.#..#|.#..#|.#..#|.#..#|.#..#|#...#",
    "П": "#####|#...#|#...#|#...#|#...#|#...#|#...#",
    "У": "#...#|#...#|#...#|.####|....#|#...#|.###.",
    "Ф": "..#..|.###.|#.#.#|#.#.#|#.#.#|.###.|..#..",
    "Ц": "#..#.|#..#.|#..#.|#..#.|#..#.|#####|....#",
    "Ч": "#...#|#...#|#...#|.####|....#|....#|....#",
    "Ш": "#.#.#|#.#.#|#.#.#|#.#.#|#.#.#|#.#.#|#####",
    "Щ": "#.#.#.|#.#.#.|#.#.#.|#.#.#.|#.#.#.|######|.....#",
    "Ъ": "##...|.#...|.#...|.###.|.#..#|.#..#|.###.",
    "Ы": "#...#|#...#|#...#|##..#|#.#.#|#.#.#|##..#",
    "Ь": "#...|#...|#...|###.|#..#|#..#|###.",
    "Э": ".###.|#...#|....#|..###|....#|#...#|.###.",
    "Ю": "#..#.|#.#.#|#.#.#|###.#|#.#.#|#.#.#|#..#.",
    "Я": ".####|#...#|#...#|.####|..#.#|.#..#|#...#"
};

// Cyrillic letters that look exactly like a Latin one, and dashes.
var GLYPH_ALIAS = {
    "А": "A", "В": "B", "Е": "E", "Ё": "E", "З": "3", "К": "K", "М": "M", "Н": "H",
    "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "–": "-", "—": "-"
};

var GLYPHS = {};

// Splits a glyph into as few rectangles as a greedy scan finds: take the first
// free pixel, grow right, then grow down while the whole row is filled. A
// letter like H becomes 3 rectangles instead of 13 row segments.
function glyphRects(rows) {
    var taken = [];
    var rects = [];
    var x, y;
    for (y = 0; y < rows.length; y++) {
        taken.push([]);
    }
    function filled(cx, cy) {
        return cx < rows[cy].length && rows[cy].charAt(cx) === "#" && !taken[cy][cx];
    }
    for (y = 0; y < rows.length; y++) {
        for (x = 0; x < rows[y].length; x++) {
            if (!filled(x, y)) {
                continue;
            }
            var w = 1;
            while (filled(x + w, y)) {
                w++;
            }
            var h = 1;
            var grows = true;
            while (grows && y + h < rows.length) {
                for (var k = 0; k < w; k++) {
                    if (!filled(x + k, y + h)) {
                        grows = false;
                        break;
                    }
                }
                if (grows) {
                    h++;
                }
            }
            for (var ty = y; ty < y + h; ty++) {
                for (var tx = x; tx < x + w; tx++) {
                    taken[ty][tx] = true;
                }
            }
            rects.push(x, y, w, h);
        }
    }
    return rects;
}

(function () {
    var ch;
    for (ch in GLYPH_SOURCE) {
        var rows = GLYPH_SOURCE[ch].split("|");
        GLYPHS[ch] = { w: rows[0].length, rects: glyphRects(rows) };
    }
    for (ch in GLYPH_ALIAS) {
        GLYPHS[ch] = GLYPHS[GLYPH_ALIAS[ch]];
    }
}());

var WORD = /[A-Za-zА-Яа-яЁё#0-9\/]+/g;
var CHORD_NAME = /^[A-G][#b]?(maj|mMaj|m|dim|aug|sus|add)?[0-9]*(sus[24])?([b#][0-9]+)*(\/[A-G][#b]?)?$/;
var ROMAN = /^(i|ii|iii|iv|v|vi|vii)$/;

// Capitals for everything except chord names and roman numerals.
function caps(s) {
    return s.replace(WORD, function (word) {
        return CHORD_NAME.test(word) || ROMAN.test(word) ? word : word.toUpperCase();
    });
}

var layouts = {};

function layout(s) {
    var cached = layouts[s];
    if (cached) {
        return cached;
    }
    var rects = [];
    var x = 0;
    for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        if (ch === " ") {
            x += 4;
            continue;
        }
        var glyph = GLYPHS[ch] || GLYPHS[ch.toUpperCase()] || GLYPHS["?"];
        for (var k = 0; k < glyph.rects.length; k += 4) {
            rects.push(x + glyph.rects[k], glyph.rects[k + 1], glyph.rects[k + 2], glyph.rects[k + 3]);
        }
        x += glyph.w + 1;
    }
    cached = layouts[s] = { w: Math.max(0, x - 1), rects: rects };
    return cached;
}

var LEFT = 0;
var CENTER = 1;
var RIGHT = 2;

// Draws text with its top-left corner at (x, y); returns the width in pixels.
function label(s, x, y, scale, colour, align) {
    var line = layout(s);
    var left = x;
    if (align === CENTER) {
        left = Math.round(x - line.w * scale / 2);
    } else if (align === RIGHT) {
        left = x - line.w * scale;
    }
    for (var i = 0; i < line.rects.length; i += 4) {
        px(left + line.rects[i] * scale, y + line.rects[i + 1] * scale,
           line.rects[i + 2] * scale, line.rects[i + 3] * scale, colour);
    }
    return line.w * scale;
}

var wraps = {};

function wrap(s, maxWidth) {
    var key = maxWidth + "|" + s;
    var cached = wraps[key];
    if (cached) {
        return cached;
    }
    var words = s.split(" ");
    var lines = [];
    var line = "";
    for (var i = 0; i < words.length; i++) {
        var candidate = line === "" ? words[i] : line + " " + words[i];
        if (line !== "" && layout(candidate).w > maxWidth) {
            lines.push(line);
            line = words[i];
        } else {
            line = candidate;
        }
    }
    lines.push(line);
    wraps[key] = lines;
    return lines;
}

// Draws wrapped text and returns the y just below it.
function paragraph(s, x, y, maxWidth, colour, maxLines) {
    var lines = wrap(s, maxWidth);
    var count = Math.min(lines.length, maxLines);
    for (var i = 0; i < count; i++) {
        label(lines[i], x, y + i * 10, 1, colour, LEFT);
    }
    return y + count * 10;
}

// ---------------------------------------------------------------- sprites

// A washed-out, slightly purple version of a colour: a critter that feels ill.
function sicken(rgb) {
    var grey = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
    return [(rgb[0] * 0.25 + grey * 0.75) * 0.8 + 0.06,
            (rgb[1] * 0.25 + grey * 0.75) * 0.7,
            (rgb[2] * 0.25 + grey * 0.75) * 0.85 + 0.08];
}

// Adds a recoloured copy of a sprite's palette and returns where it starts.
function addVariant(sprite, recolour) {
    var start = COLORS.length;
    for (var c = 0; c < sprite.pal.length; c++) {
        COLORS.push(recolour(COLORS[sprite.base + c]));
    }
    return start;
}

function hueShifter(degrees) {
    return function (rgb) {
        return shiftHue(rgb, degrees);
    };
}

(function () {
    for (var name in SPRITES) {
        var sprite = SPRITES[name];
        sprite.base = COLORS.length;
        for (var c = 0; c < sprite.pal.length; c++) {
            addColor(sprite.pal[c]);
        }
        sprite.runs = [];
        for (var f = 0; f < sprite.frames.length; f++) {
            var packed = sprite.frames[f];
            var runs = [];
            for (var k = 0; k < packed.length; k += 2) {
                runs.push(parseInt(packed.substr(k, 2), 16));
            }
            sprite.runs.push(runs);
        }
    }
    // The two dancers also come in a sick palette and in six disco colours.
    var dancers = [SPRITES.slime, SPRITES.frog];
    for (var d = 0; d < dancers.length; d++) {
        dancers[d].sick = addVariant(dancers[d], sicken);
        dancers[d].disco = [];
        for (var step = 0; step < 6; step++) {
            dancers[d].disco.push(addVariant(dancers[d], hueShifter(step * 60)));
        }
    }
}());

var clock = 0;      // animation time in ticks of TICK_MS
var wobble = 0;     // how far sprite rows are shoved sideways (the "melting" look)
var clip = [0, 0, 0, 0]; // left, top, right, bottom limits for sprites

// Draws one frame with the sprite's origin at (x, y). base picks the palette
// (sprite.base, sprite.sick, ...); flip mirrors it around the origin column.
function drawSprite(sprite, frame, x, y, base, flip) {
    var runs = sprite.runs[frame];
    var top = y - sprite.oy;
    for (var i = 0; i < runs.length; i += 4) {
        var row = top + runs[i + 1];
        if (row < clip[1] || row >= clip[3]) {
            continue;
        }
        var x0 = flip ? x + sprite.ox - runs[i] - runs[i + 2] + 1 : x - sprite.ox + runs[i];
        if (wobble !== 0) {
            x0 += Math.round(Math.sin((row + clock * 2) / 4) * wobble);
        }
        var x1 = x0 + runs[i + 2];
        if (x0 < clip[0]) {
            x0 = clip[0];
        }
        if (x1 > clip[2]) {
            x1 = clip[2];
        }
        if (x1 > x0) {
            px(x0, row, x1 - x0, 1, base + runs[i + 3]);
        }
    }
}

function loopFrame(sprite, offset) {
    return (Math.floor(clock * sprite.fps * TICK_MS / 1000) + (offset || 0)) % sprite.runs.length;
}

// ------------------------------------------------------------ music theory

var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var NOTE_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
var NOTE_RU = ["ДО", "ДО#", "РЕ", "РЕ#", "МИ", "ФА", "ФА#", "СОЛЬ", "СОЛЬ#", "ЛЯ", "ЛЯ#", "СИ"];
var ROOT_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

// Circle of fifths, clockwise from the top. The inner ring holds the relative
// minor of every major chord.
var FIFTHS_PC = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
var MAJOR_NAMES = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"];
var MINOR_NAMES = ["Am", "Em", "Bm", "F#m", "C#m", "G#m", "D#m", "Bbm", "Fm", "Cm", "Gm", "Dm"];
var KEY_RU = ["ДО", "СОЛЬ", "РЕ", "ЛЯ", "МИ", "СИ", "ФА#", "РЕ-БЕМОЛЬ", "ЛЯ-БЕМОЛЬ", "МИ-БЕМОЛЬ", "СИ-БЕМОЛЬ", "ФА"];

// Chord qualities: intervals from the root. Order matters for recognition:
// plain triads are tried first.
var QUALITY_ORDER = ["", "m", "dim", "aug", "sus4", "sus2", "maj7", "7", "m7", "m7b5", "dim7",
                     "6", "m6", "add9", "9", "maj9", "m9", "5",
                     "7sus4", "mMaj7", "7b5", "7#5", "69", "7b9", "7#9", "maj7#11", "11", "m11", "13"];
var QUALITIES = {
    "": [0, 4, 7], "m": [0, 3, 7], "dim": [0, 3, 6], "aug": [0, 4, 8],
    "sus2": [0, 2, 7], "sus4": [0, 5, 7], "5": [0, 7],
    "7": [0, 4, 7, 10], "maj7": [0, 4, 7, 11], "m7": [0, 3, 7, 10],
    "m7b5": [0, 3, 6, 10], "dim7": [0, 3, 6, 9], "6": [0, 4, 7, 9], "m6": [0, 3, 7, 9],
    "add9": [0, 4, 7, 14], "9": [0, 4, 7, 10, 14], "maj9": [0, 4, 7, 11, 14], "m9": [0, 3, 7, 10, 14],
    // The rarer ones. The eleventh chord leaves out its third and the
    // thirteenth its fifth, as they are played.
    "7sus4": [0, 5, 7, 10], "mMaj7": [0, 3, 7, 11], "7b5": [0, 4, 6, 10], "7#5": [0, 4, 8, 10],
    "69": [0, 4, 7, 9, 14], "7b9": [0, 4, 7, 10, 13], "7#9": [0, 4, 7, 10, 15], "maj7#11": [0, 4, 7, 11, 18],
    "11": [0, 7, 10, 14, 17], "m11": [0, 3, 7, 10, 14, 17], "13": [0, 4, 10, 14, 21]
};

var SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11, 12],
    minor: [0, 2, 3, 5, 7, 8, 10, 12],
    harmonic: [0, 2, 3, 5, 7, 8, 11, 12],
    pentaMajor: [0, 2, 4, 7, 9, 12],
    pentaMinor: [0, 3, 5, 7, 10, 12],
    blues: [0, 3, 5, 6, 7, 10, 12],
    dorian: [0, 2, 3, 5, 7, 9, 10, 12],
    phrygian: [0, 1, 3, 5, 7, 8, 10, 12],
    lydian: [0, 2, 4, 6, 7, 9, 11, 12],
    mixolydian: [0, 2, 4, 5, 7, 9, 10, 12],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    wholeTone: [0, 2, 4, 6, 8, 10, 12]
};

var keyIndex = 0;                       // position of the current key on the circle
var scalePcs = [0, 2, 4, 5, 7, 9, 11];  // its seven notes

function unique(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
        if (out.indexOf(list[i]) < 0) {
            out.push(list[i]);
        }
    }
    return out;
}

function sameSet(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    for (var i = 0; i < a.length; i++) {
        if (b.indexOf(a[i]) < 0) {
            return false;
        }
    }
    return true;
}

function notePc(name) {
    var pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[name.charAt(0)];
    for (var i = 1; i < name.length; i++) {
        if (name.charAt(i) === "#") {
            pc++;
        } else if (name.charAt(i) === "b") {
            pc--;
        }
    }
    return (pc + 12) % 12;
}

function setKey(name) {
    var minor = name.length > 1 && name.charAt(name.length - 1) === "m";
    var root = notePc(minor ? name.substring(0, name.length - 1) : name);
    keyIndex = FIFTHS_PC.indexOf(minor ? (root + 3) % 12 : root);
    scalePcs = [];
    for (var i = 0; i < 7; i++) {
        scalePcs.push((FIFTHS_PC[keyIndex] + SCALES.major[i]) % 12);
    }
}

function sectorIndex(root, minor) {
    return FIFTHS_PC.indexOf(minor ? (root + 3) % 12 : root);
}

function isDiatonic(index) {
    var distance = (index - keyIndex + 12) % 12;
    return distance === 0 || distance === 1 || distance === 11;
}

// "Am", "F#m7b5", "Csus4", "G/B" -> chord object.
function parseChord(symbol) {
    var parts = /^([A-G][#b]?)([^\/]*)(?:\/([A-G][#b]?))?$/.exec(symbol);
    var root = notePc(parts[1]);
    var intervals = QUALITIES[parts[2]];
    var pcs = [];
    for (var i = 0; i < intervals.length; i++) {
        pcs.push((root + intervals[i]) % 12);
    }
    var third = intervals.indexOf(3) >= 0;
    return {
        name: symbol,
        root: root,
        minor: third,
        intervals: intervals,
        pcs: unique(pcs),
        bass: parts[3] ? notePc(parts[3]) : -1
    };
}

function sectorChord(ring, index) {
    return parseChord(ring === 0 ? MAJOR_NAMES[index] : MINOR_NAMES[index]);
}

function sameSector(a, b) {
    return a && b && a.root === b.root && a.minor === b.minor;
}

// Names what is on the keys, trying the lowest note as the root first.
function detectChord(pcs, bassPc) {
    if (pcs.length < 3) {
        return null;
    }
    var roots = [bassPc];
    for (var i = 0; i < pcs.length; i++) {
        if (pcs[i] !== bassPc) {
            roots.push(pcs[i]);
        }
    }
    // The same keys often make two chords: C E G A is C6 and Am7, C G Bb D F
    // is C11 and Bb69. The lowest key decides: first every kind of chord is
    // tried with it as the root, and only then the other keys.
    for (var pass = 0; pass < 2; pass++) {
        for (var q = 0; q < QUALITY_ORDER.length; q++) {
            var intervals = QUALITIES[QUALITY_ORDER[q]];
            if (unique(intervals.map(function (v) { return v % 12; })).length !== pcs.length) {
                continue;
            }
            for (var r = pass; r < (pass === 0 ? 1 : roots.length); r++) {
                var wanted = [];
                for (var k = 0; k < intervals.length; k++) {
                    wanted.push((roots[r] + intervals[k]) % 12);
                }
                if (sameSet(unique(wanted), pcs)) {
                    var quality = QUALITY_ORDER[q];
                    var name = quality === "" ? MAJOR_NAMES[sectorIndex(roots[r], false)]
                             : quality === "m" ? MINOR_NAMES[sectorIndex(roots[r], true)]
                             : ROOT_NAMES[roots[r]] + quality;
                    return parseChord(name);
                }
            }
        }
    }
    return null;
}

function noteList(pcs, names) {
    var parts = [];
    for (var i = 0; i < pcs.length; i++) {
        parts.push(names[pcs[i]]);
    }
    return parts.join(" - ");
}

// ------------------------------------------------------------------- steps

// A step is one thing to do. Playing steps describe what must be on the keys:
//   pcs     pitch classes that must all be held (any octave), nothing else
//   bass    pitch class of the lowest key, or -1
//   minKeys at least this many keys (bass + chord needs four)
//   hold    pitch classes of the part that stays down under (or, with
//           "under", above) the moving notes
//   drums   exact pad notes instead of pitch classes
// Other steps: any (press anything), click ("wheel"), live (an Ableton state
// checked through the Live API), manual (the player confirms).
// show = notes to light up, label/sub = what to print, text = explanation.

var DRUM_NOTES = { K: 36, R: 37, S: 38, C: 39, T: 41, H: 42, L: 43, O: 46, X: 49 };
var DRUM_NAMES = { 36: "БОЧКА", 37: "РИМ", 38: "СНЕЙР", 39: "КЛЭП", 41: "ТОМ", 42: "ХЭТ", 43: "ТОМ 2", 46: "ОТКР. ХЭТ", 49: "КРЭШ" };
var DRUM_TAGS = { 36: "БОЧ", 37: "РИМ", 38: "СНР", 39: "КЛП", 41: "ТОМ", 42: "ХЭТ", 43: "ТМ2", 46: "ОТК", 49: "КРШ" };

function parseNote(token) {
    var parts = /^([A-G][#b]?)(\d)?$/.exec(token);
    var pc = notePc(parts[1]);
    return { name: parts[1], pc: pc, pitch: parts[2] ? 12 * (Number(parts[2]) + 1) + pc : 60 + pc };
}

// "C" is one note, "C4+E4" is several at once with the first one lowest.
function noteStep(token) {
    var names = token.split("+");
    var pcs = [], show = [], labels = [];
    for (var i = 0; i < names.length; i++) {
        var n = parseNote(names[i]);
        pcs.push(n.pc);
        show.push(n.pitch);
        labels.push(n.name);
    }
    return {
        label: labels.join("+"),
        sub: noteList(pcs, NOTE_RU),
        pcs: unique(pcs),
        bass: names.length > 1 ? pcs[0] : -1,
        minKeys: names.length,
        show: show
    };
}

function chordPitches(chord, base) {
    var top = chord.intervals[chord.intervals.length - 1];
    var root = base + chord.root;
    if (root + top > 83) {
        root -= 12;
    }
    var pitches = [];
    for (var i = 0; i < chord.intervals.length; i++) {
        pitches.push(root + chord.intervals[i]);
    }
    return pitches;
}

function chordStep(symbol, withBass) {
    var chord = parseChord(symbol);
    var show = chordPitches(chord, 60);
    var bass = chord.bass >= 0 ? chord.bass : (withBass ? chord.root : -1);
    var pcs = chord.pcs.slice();
    if (bass >= 0) {
        show.unshift(48 + bass);
        // Am/G: the bass note is not part of the chord, so it is one more key.
        if (pcs.indexOf(bass) < 0) {
            pcs.push(bass);
        }
    }
    return {
        label: symbol,
        sub: noteList(chord.pcs, NOTE_NAMES),
        sub2: noteList(chord.pcs, NOTE_RU),
        pcs: pcs,
        bass: bass,
        minKeys: withBass ? chord.pcs.length + 1 : 0,
        show: show,
        chord: chord
    };
}

// One hand keeps "holdSymbol" down (a chord or a single note), the other
// plays "token". under = the moving note is below the held ones.
function holdStep(holdSymbol, token, under, asChord) {
    // A bare letter is one note (a bass pedal) unless the lesson is about
    // holding chords: then C means the chord of C major.
    var single = !asChord && /^[A-G][#b]?$/.test(holdSymbol);
    var chord = single ? null : parseChord(holdSymbol);
    var holdPcs = single ? [notePc(holdSymbol)] : chord.pcs;
    var moving = parseNote(token);
    var holdShow = single ? [(under ? 60 : 48) + holdPcs[0]] : chordPitches(chord, under ? 60 : 48);
    var pitch;
    if (under) {
        pitch = 48 + moving.pc;
        while (pitch >= holdShow[0]) {
            pitch -= 12;
        }
        if (pitch < 48) {
            pitch += 12; // out of the picture: show it folded, the rule still holds
        }
    } else {
        pitch = 60 + moving.pc;
        while (pitch <= holdShow[holdShow.length - 1]) {
            pitch += 12;
        }
    }
    return {
        label: moving.name,
        sub: (under ? "ПРАВАЯ ДЕРЖИТ " : "ЛЕВАЯ ДЕРЖИТ ") + holdSymbol,
        sub2: under ? "ЛЕВАЯ ИГРАЕТ БАС" : "ПРАВАЯ ИГРАЕТ МЕЛОДИЮ",
        pcs: [moving.pc],
        hold: holdPcs,
        under: !!under,
        bass: -1,
        show: holdShow.concat([pitch]),
        chord: chord
    };
}

function drumStep(token) {
    var drums = [], names = [];
    for (var i = 0; i < token.length; i++) {
        var pitch = DRUM_NOTES[token.charAt(i)];
        drums.push(pitch);
        names.push(DRUM_NAMES[pitch]);
    }
    return { label: names.join(" + "), drums: drums, show: drums, pcs: [], bass: -1 };
}

function words(s) {
    return s.split(" ");
}

// The headline of an Ableton step, by the kind of check behind it.
var LIVE_LABELS = {
    device: "УСТРОЙСТВО", masterDevice: "УСТРОЙСТВО", returnDevice: "УСТРОЙСТВО", order: "УСТРОЙСТВО",
    knob: "РУЧКА", masterKnob: "РУЧКА", returnKnob: "РУЧКА", voice: "РЕЖИМ", setting: "РЕЖИМ", simplerMode: "РЕЖИМ",
    tempo: "ТЕМП", tempo90: "ТЕМП", recordOn: "ЗАПИСЬ", sessionRecord: "ЗАПИСЬ", armed: "ЗАПИСЬ",
    clipAdded: "КЛИП", hasClip: "КЛИП", clipPlaying: "КЛИП", clipLength: "КЛИП", clipLoopOff: "КЛИП", clipLoopOn: "КЛИП",
    notesAdded: "НОТЫ", notesRemoved: "НОТЫ", clipStack: "НОТЫ", clipPitches: "НОТЫ", clipLong: "НОТЫ", clipVel: "НОТЫ",
    clipOffGrid: "НОТЫ", clipOnGrid: "НОТЫ", clipOffBeat: "НОТЫ",
    sceneAdded: "СЦЕНА", locatorAdded: "ЛОКАТОР", arrClips: "ЛЕНТА", arrClipAdded: "ЛЕНТА", arrangement: "ЛЕНТА",
    loopOn: "ПЕТЛЯ", loopOff: "ПЕТЛЯ", loopLength: "ПЕТЛЯ", songLonger: "ЛЕНТА", songLength: "ЛЕНТА"
};

// Several notes, chords or pads in a row under one explanation, for a tour.
function many(type, tokens, text) {
    var list = words(tokens);
    var out = [];
    for (var i = 0; i < list.length; i++) {
        out.push([type, list[i], text]);
    }
    return out;
}

// A tour from single steps and from lists of steps made by many().
function tour() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
        var item = arguments[i];
        if (item[0] instanceof Array) {
            for (var k = 0; k < item.length; k++) {
                out.push(item[k]);
            }
        } else {
            out.push(item);
        }
    }
    return out;
}

// Builds the step list of a lesson from its compact description.
function buildSteps(lesson) {
    var steps = [];
    var i, k, tokens;
    if (lesson.kind === "notes") {
        tokens = words(lesson.data);
        for (i = 0; i < tokens.length; i++) {
            steps.push(noteStep(tokens[i]));
        }
    } else if (lesson.kind === "chords" || lesson.kind === "bass") {
        tokens = words(lesson.data);
        for (i = 0; i < tokens.length; i++) {
            steps.push(chordStep(tokens[i], lesson.kind === "bass"));
        }
    } else if (lesson.kind === "hold" || lesson.kind === "walk") {
        // "Am: C E A E | F: A C F C"
        var blocks = lesson.data.split(" | ");
        // What is held is a chord when the bass walks under it, when the
        // lesson says so, or when any of its symbols can only be a chord.
        var chordsHeld = lesson.kind === "walk" || !!lesson.full;
        for (i = 0; i < blocks.length; i++) {
            if (!/^[A-G][#b]?$/.test(blocks[i].split(": ")[0])) {
                chordsHeld = true;
            }
        }
        for (i = 0; i < blocks.length; i++) {
            var halves = blocks[i].split(": ");
            tokens = words(halves[1]);
            for (k = 0; k < tokens.length; k++) {
                steps.push(holdStep(halves[0], tokens[k], lesson.kind === "walk", chordsHeld));
            }
        }
    } else if (lesson.kind === "drums") {
        tokens = words(lesson.data);
        for (i = 0; i < tokens.length; i++) {
            steps.push(drumStep(tokens[i]));
        }
    } else if (lesson.kind === "tour") {
        // [type, argument, explanation]
        for (i = 0; i < lesson.data.length; i++) {
            var spec = lesson.data[i];
            var step;
            if (spec[0] === "note") {
                step = noteStep(spec[1]);
            } else if (spec[0] === "chord") {
                step = chordStep(spec[1], false);
            } else if (spec[0] === "drum") {
                step = drumStep(spec[1]);
            } else if (spec[0] === "any") {
                step = { label: "ЛЮБАЯ КЛАВИША", any: true, pcs: [], bass: -1, show: [] };
            } else if (spec[0] === "click") {
                step = { label: "ЩЁЛКНИ КРУГ", click: spec[1], pcs: [], bass: -1, show: [] };
            } else if (spec[0] === "live") {
                var about = spec[1].split(":")[0];
                step = { label: LIVE_LABELS[about] || "ABLETON", live: spec[1], pcs: [], bass: -1, show: [] };
            } else {
                step = { label: "ABLETON", manual: true, pcs: [], bass: -1, show: [] };
            }
            step.text = caps(spec[2]);
            steps.push(step);
        }
    }
    return steps;
}

// Scale up and back down as note tokens with octaves, e.g. "C4 D4 ... C5 ... C4".
function scaleNotes(root, type, octave, flats) {
    var names = flats ? NOTE_FLAT : NOTE_NAMES;
    var start = 12 * (octave + 1) + notePc(root);
    var shape = SCALES[type];
    var out = [];
    var i;
    for (i = 0; i < shape.length; i++) {
        out.push(names[(start + shape[i]) % 12] + (Math.floor((start + shape[i]) / 12) - 1));
    }
    for (i = shape.length - 2; i >= 0; i--) {
        out.push(names[(start + shape[i]) % 12] + (Math.floor((start + shape[i]) / 12) - 1));
    }
    return out.join(" ");
}

// ------------------------------------------------------------------ drills

// A training lesson builds a new exercise of its kind every time it is
// opened, so it can be repeated for as long as the player likes.

var drillSeed = (new Date().getTime() % 2147483646) + 1;

// A whole number from 0 to n - 1.
function roll(n) {
    drillSeed = (drillSeed * 16807) % 2147483647;
    return drillSeed % n;
}

// "count" items of the pool, never the same one twice in a row. "dice" is
// the source of chance: the shared one unless a course brings its own.
function pickMany(pool, count, dice) {
    var out = [];
    var last = -1;
    while (out.length < count) {
        var index = (dice || roll)(pool.length);
        if (index !== last || pool.length === 1) {
            out.push(pool[index]);
            last = index;
        }
    }
    return out;
}

// "count" different items of the pool, in random order.
function pickDistinct(pool, count, dice) {
    var rest = pool.slice();
    var out = [];
    while (out.length < count && rest.length > 0) {
        out.push(rest.splice((dice || roll)(rest.length), 1)[0]);
    }
    return out;
}

var WHITE_NOTES = ["C", "D", "E", "F", "G", "A", "B"];
var HOME_CHORDS = ["C", "F", "G", "Am", "Dm", "Em"];
var HOME_SEVENTHS = ["Cmaj7", "Dm7", "Em7", "Fmaj7", "G7", "Am7"];
var DRILL_KEYS = [0, 1, 2, 3, 11, 10];   // C, G, D, A, F and Bb on the circle
var PROGRESSIONS = ["I V vi IV", "vi IV I V", "I vi IV V", "ii V I vi", "I IV vi V", "vi ii V I",
                    "I iii IV V", "IV V iii vi", "I V IV V", "vi V IV V", "I IV I V", "ii IV I V"];

// The six chords of a major key, by its place on the circle of fifths.
function keyChords(index) {
    function at(names, shift) {
        return names[(index + shift + 12) % 12];
    }
    return { I: at(MAJOR_NAMES, 0), IV: at(MAJOR_NAMES, -1), V: at(MAJOR_NAMES, 1),
             vi: at(MINOR_NAMES, 0), ii: at(MINOR_NAMES, -1), iii: at(MINOR_NAMES, 1) };
}

// Two white keys at once: thirds, fifths, sixths and octaves of C major.
function drillIntervals() {
    var out = [];
    var last = "";
    while (out.length < 10) {
        var low = roll(7);
        var high = low + [2, 4, 5, 7][roll(4)];
        var token = WHITE_NOTES[low] + "4+" + WHITE_NOTES[high % 7] + (4 + Math.floor(high / 7));
        if (token !== last) {
            out.push(token);
            last = token;
        }
    }
    return out.join(" ");
}

// A chord of the key with its third or its fifth in the bass.
function drillInversions() {
    var pool = [];
    for (var i = 0; i < HOME_CHORDS.length; i++) {
        var pcs = parseChord(HOME_CHORDS[i]).pcs;
        pool.push(HOME_CHORDS[i] + "/" + NOTE_NAMES[pcs[1]], HOME_CHORDS[i] + "/" + NOTE_NAMES[pcs[2]]);
    }
    return pickMany(pool, 8).join(" ");
}

function drillNewKey() {
    var index = DRILL_KEYS[1 + roll(DRILL_KEYS.length - 1)];
    var chords = keyChords(index);
    var middle = pickMany([chords.IV, chords.V, chords.vi, chords.ii, chords.iii], 6);
    return { data: [chords.I].concat(middle, [chords.I]).join(" "), key: chords.I,
             hint: "Тональность " + KEY_RU[index] + " мажор: шесть её аккордов подсвечены на круге. Зажимай клавиши вместе." };
}

function drillProgression() {
    var index = DRILL_KEYS[roll(DRILL_KEYS.length)];
    var chords = keyChords(index);
    var pattern = PROGRESSIONS[roll(PROGRESSIONS.length)];
    var names = words(pattern).map(function (degree) { return chords[degree]; });
    return { data: names.concat(names).join(" "), key: chords.I,
             hint: "Прогрессия " + pattern + " в тональности " + KEY_RU[index] + " мажор. Два круга подряд." };
}

// root, scale, octave, flats, key for the wheel, name
var DRILL_SCALES = [
    ["C", "major", 4, false, "C", "до мажор"], ["G", "major", 3, false, "G", "соль мажор"],
    ["F", "major", 3, true, "F", "фа мажор"], ["D", "major", 4, false, "D", "ре мажор"],
    ["A", "minor", 3, false, "Am", "ля минор"], ["E", "minor", 4, false, "Em", "ми минор"],
    ["D", "minor", 4, true, "Dm", "ре минор"], ["C", "pentaMajor", 4, false, "C", "мажорная пентатоника от до"],
    ["A", "pentaMinor", 3, false, "Am", "минорная пентатоника от ля"], ["E", "pentaMinor", 4, false, "Em", "минорная пентатоника от ми"],
    ["A", "blues", 3, false, "Am", "блюзовая гамма от ля"], ["D", "dorian", 4, false, "C", "дорийский лад от ре"],
    ["G", "mixolydian", 3, false, "C", "миксолидийский лад от соль"]
];

function drillScale() {
    var pick = DRILL_SCALES[roll(DRILL_SCALES.length)];
    return { data: scaleNotes(pick[0], pick[1], pick[2], pick[3]), key: pick[4],
             hint: "Сегодня " + pick[5] + ": вверх и обратно. Играй ровно, не торопясь." };
}

var DRILL_BEATS = [
    "KH H SH H KH H SH H KH H SH H KH H SH H",
    "KH H SH H H KH SH H KH H SH H H KH SH H",
    "KH O KS O KH O KS O KH O KS O KH O KS O",
    "KH H SH H KH KH SH H KH H SH H KH KH SH H",
    "KH H SH KH H KH SH H KH H SH KH H KH SH H",
    "KH H H H SH H H H KH H KH H SH H H H",
    "KH H SH H H KH SH KH KH H SH H H KH SH H",
    "KH KH SH H KH H SH H KH KH SH H KH H SH T",
    "KH H KC H KH H KC H KH H KC H KH KH KC H",
    "KH H H KH H H SH H KH H H KH H SH H H",
    "H H H H KR H H H H H H H KR H H H",
    "KH H CH H H KH CH H KH H CH KH H H CH H"
];

// knob, direction, what to do
var DRIFT_TASKS = [
    ["LP Freq", "down", "Прикрой фильтр: ручка Freq (K1) влево."],
    ["LP Freq", "up", "Открой фильтр: ручка Freq (K1) вправо."],
    ["LP Res", "up", "Прибавь резонанс: ручка Res (K2) вправо."],
    ["LP Res", "down", "Убавь резонанс: ручка Res (K2) влево."],
    ["Env 1 Attack", "up", "Сделай начало ноты плавным: Attack (K3) вправо."],
    ["Env 1 Attack", "down", "Сделай начало ноты резким: Attack (K3) влево."],
    ["Env 1 Decay", "moved", "Измени длину щипка: покрути Decay (K4)."],
    ["Env 1 Sustain", "down", "Убавь уровень удержания: Sustain (K5) влево."],
    ["Env 1 Sustain", "up", "Прибавь уровень удержания: Sustain (K5) вправо."],
    ["Env 1 Release", "up", "Удлини хвост ноты: Release (K6) вправо."],
    ["Env 1 Release", "down", "Укороти хвост ноты: Release (K6) влево."],
    ["Osc 1 Shape", "moved", "Измени тембр: покрути Shape у первого генератора."],
    ["Osc 1 Wave", "changed", "Смени волну первого генератора в списке Osc 1."],
    ["LFO Freq", "moved", "Измени скорость LFO: ручка Rate."]
];

function drillKnobs() {
    var out = [["live", "device:Drift", "Тренировка идёт на Drift. Если его нет на этой дорожке, перетащи его из раздела Instruments."]];
    var tasks = pickDistinct(DRIFT_TASKS, 6);
    for (var i = 0; i < tasks.length; i++) {
        out.push(["live", "knob:Drift:" + tasks[i][0] + ":" + tasks[i][1], tasks[i][2] + " Сыграй ноту и послушай, что изменилось."]);
    }
    return out;
}

// device classes, knob, direction, name in the browser, what happens
var FX_TASKS = [
    ["Reverb", "Dry/Wet", "up", "Reverb", "прибавь Dry/Wet (K8): звук уходит вглубь комнаты."],
    ["Delay", "Feedback", "up", "Delay", "прибавь Feedback (K3): эхо повторяется дольше."],
    ["Saturator", "Drive", "up", "Saturator", "прибавь Drive (K1): звук теплеет и рычит."],
    ["Chorus2", "Amount", "up", "Chorus-Ensemble", "прибавь Amount (K1): звук становится шире."],
    ["Redux2", "Bit Depth", "down", "Redux", "убавь Bits (K3): в звуке появляется зерно."],
    ["Compressor2", "Threshold", "down", "Compressor", "опусти Threshold (K1): громкое прижимается."],
    ["AutoFilter2,AutoFilter", "Frequency", "down", "Auto Filter", "закрой фильтр ручкой частоты (K1): звук уходит под воду."]
];

function drillEffects() {
    var out = [];
    var tasks = pickDistinct(FX_TASKS, 3);
    for (var i = 0; i < tasks.length; i++) {
        out.push(["live", "device:" + tasks[i][0], "Поставь на эту дорожку " + tasks[i][3] + " из раздела Audio Effects. Если он уже стоит, просто подожди."]);
        out.push(["live", "knob:" + tasks[i][0] + ":" + tasks[i][1] + ":" + tasks[i][2], tasks[i][3] + ": " + tasks[i][4] + " Сыграй ноту и послушай."]);
    }
    return out;
}

// genre, slowest and fastest tempo
var GENRE_TEMPOS = [
    ["Лоу-фай", 70, 90], ["Бум-бэп", 85, 95], ["Синтвейв", 80, 118], ["Хаус", 120, 128],
    ["Техно", 128, 140], ["Гэридж", 128, 136], ["Транс", 136, 142], ["Дабстеп", 138, 142],
    ["Трэп", 130, 150], ["Фонк", 130, 160], ["Фьюче-бейс", 140, 160], ["Драм-н-бейс", 170, 176]
];

// Five genres; two in a row never share a tempo, so each step needs a new one.
function drillTempos() {
    var out = [];
    var low = -100, high = -100;
    while (out.length < 5) {
        var pick = GENRE_TEMPOS[roll(GENRE_TEMPOS.length)];
        if (pick[1] > high + 2 || pick[2] < low - 2) {
            out.push(["live", "tempo:" + pick[1] + ":" + pick[2], pick[0] + ". Вспомни темп этого жанра и поставь его в Ableton. Подсказка: от " + pick[1] + " до " + pick[2] + " ударов в минуту."]);
            low = pick[1];
            high = pick[2];
        }
    }
    return out;
}

// Gives a training lesson its next exercise.
function renew(item) {
    if (!item.gen) {
        return;
    }
    var made = item.gen();
    if (typeof made === "string" || made instanceof Array) {
        item.data = made;
        return;
    }
    item.data = made.data;
    item.key = made.key;
    if (made.hint) {
        item.hint = caps(made.hint);
    }
}

var REPEAT_PAY = 15;   // points for every further run of a training lesson
var DRILL_TASK = "Жми заново: будет новое задание и ещё +" + REPEAT_PAY + " очков. Дальше ведёт к следующей тренировке.";

// title, kind, generator, what it trains
function drill(title, kind, gen, why, extra) {
    var out = lesson(title, kind, "", why, extra || {});
    out.gen = gen;
    out.task = DRILL_TASK;
    return out;
}

// -------------------------------------------------------------- curriculum

var DEFAULT_HINT = {
    notes: "Нажимай подсвеченную клавишу. Октава любая.",
    chords: "Зажми все подсвеченные клавиши вместе. Октава и порядок нот любые.",
    bass: "Левая рука берёт нижнюю ноту (бас), правая весь аккорд.",
    hold: "Левая рука держит звук и не отпускает. Правая играет мелодию по одной ноте.",
    walk: "Правая рука держит аккорд и не отпускает. Левая шагает по басу.",
    drums: "Бей по подсвеченным пэдам. Тренажёр должен стоять на дорожке барабанов.",
    tour: "Делай по шагам, тренажёр сам заметит, когда получилось.",
    free: "Играй что угодно: тренажёр назовёт аккорд и покажет его на круге. Щёлкни сектор круга, чтобы услышать аккорд."
};

// title, kind, data, why (what it is for), then optional fields.
function lesson(title, kind, data, why, extra) {
    var out = { title: title, kind: kind, data: data, why: why };
    for (var name in extra) {
        out[name] = extra[name];
    }
    return out;
}

var GROUPS = [
    { id: "start", title: "Старт", need: 0, lessons: [
        lesson("С чего начать", "tour", [
            ["any", "", "Это тренажёр: он показывает задание, ты играешь его на своей клавиатуре. Нажми любую клавишу, проверим связь."],
            ["note", "C", "Синяя клавиша на экране показывает, что нажать. Это нота до (C): белая клавиша слева от двух чёрных."],
            ["note", "G", "Ноты называют буквами: C D E F G A B. Теперь найди соль (G)."],
            ["chord", "C", "Аккорд это три клавиши сразу, через одну. Зажми C, E и G вместе. На круге слева загорится сектор C."],
            ["click", "wheel", "Круг слева это карта аккордов. Цветные секторы хорошо звучат вместе. Щёлкни мышью любой сектор и услышишь аккорд."],
            ["live", "metronomeOn", "Теперь Ableton. Вверху слева рядом с цифрой темпа есть кнопка метронома с двумя кружками. Включи её."],
            ["live", "playing", "Нажми пробел: Ableton пойдёт, метроном защёлкает. Под эти щелчки и играют."],
            ["live", "stopped", "Ещё раз пробел и стоп. За каждый урок дают очки, очки открывают новые ступени. Вперёд!"]
        ], "Знакомство: что где на экране, как тренажёр проверяет игру и как он связан с Ableton.", { pts: 100 })
    ] },
    { id: "novice", title: "Новичок", need: 100, lessons: [
        lesson("Ноты до мажора", "notes", scaleNotes("C", "major", 4),
               "Семь белых клавиш это вся тональность до мажор. Из них собрана половина популярной музыки.", { rhythm: 2 }),
        lesson("Найди ноту", "notes", "C E G B D F A C G E A F D B",
               "Чтобы играть не глядя, надо находить любую ноту сразу, а не считать от до.", {}),
        lesson("Две ноты: терции", "notes", "C4+E4 D4+F4 E4+G4 F4+A4 G4+B4 A4+C5 G4+B4 F4+A4 E4+G4 D4+F4 C4+E4",
               "Терция это две клавиши через одну. Из терций сложены все аккорды.", {}),
        lesson("Две ноты: квинты", "notes", "C4+G4 D4+A4 E4+B4 F4+C5 G4+D5 A4+E5 G4+D5 F4+C5 E4+B4 D4+A4 C4+G4",
               "Квинта это каркас аккорда. Она звучит мощно и пусто, на ней держится рок и электроника.", {}),
        lesson("Три главных аккорда", "chords", "C F G C F G C G F C",
               "C, F и G это три мажорных аккорда тональности. Тремя аккордами можно сыграть сотни песен.", {}),
        lesson("Мажор и минор", "chords", "C Am F Dm G Em C Am",
               "У каждого мажорного аккорда есть грустный минорный сосед. Слушай разницу в настроении.", {}),
        lesson("Миссия: метроном и темп", "tour", [
            ["live", "tempo90", "Темп это скорость музыки. Дважды щёлкни по цифре темпа вверху слева, набери 90 и нажми Enter."],
            ["live", "metronomeOn", "Включи метроном: кнопка с двумя кружками рядом с темпом."],
            ["live", "playing", "Пробел запускает Ableton. Сыграй под щелчки любые ноты."],
            ["live", "stopped", "Пробел ещё раз и стоп. Метроном это твой барабанщик: с ним ты учишься играть ровно."]
        ], "Темп и метроном в Ableton это основа: без ровного счёта клипы не сойдутся друг с другом.", { pts: 120 }),
        lesson("Миссия: Ableton подсказывает сам", "tour", [
            ["manual", "", "Наведи мышь на любую кнопку Ableton и посмотри в левый нижний угол: там написано, как она называется и что делает. Если этого окошка нет, нажми клавишу со знаком вопроса."],
            ["manual", "", "Ctrl+Z отменяет последнее действие, даже удалённую дорожку. Удали что-нибудь ненужное и верни обратно. Сломать тут ничего нельзя."],
            ["manual", "", "Tab переключает два главных вида: клипы и ленту времени. Shift+Tab переключает нижнюю панель между устройствами дорожки и нотами клипа. Попробуй и жми готово."]
        ], "В Ableton сотни кнопок, и помнить их не нужно: программа сама объясняет каждую. Три привычки, которые снимают страх.", { pts: 90 })
    ] },
    { id: "drill", title: "Тренировки", need: 100, shelf: true, lessons: [
        drill("Тренировка: ноты", "notes", function () { return pickMany(WHITE_NOTES, 12).join(" "); },
              "Двенадцать случайных белых клавиш. Пять минут в день, и рука находит ноту раньше, чем ты успеешь подумать."),
        drill("Тренировка: все двенадцать нот", "notes", function () { return pickMany(ROOT_NAMES, 12).join(" "); },
              "Теперь вместе с чёрными клавишами. Диез (#) это чёрная клавиша справа от ноты, бемоль (b) слева."),
        drill("Тренировка: интервалы", "notes", drillIntervals,
              "Две клавиши сразу: терции, квинты, сексты и октавы. Из интервалов сложены все аккорды и все мелодии.",
              { hint: "Нажимай обе подсвеченные клавиши вместе. Нижняя нота написана первой." }),
        drill("Тренировка: аккорды", "chords", function () { return pickMany(HOME_CHORDS, 10).join(" "); },
              "Шесть аккордов до мажора в случайном порядке. Цель: брать любой из них сразу, не разглядывая клавиши."),
        drill("Тренировка: новая тональность", "chords", drillNewKey,
              "Те же шесть аккордов, но в другой тональности: каждый раз новой. Так перестаёшь бояться чёрных клавиш."),
        drill("Тренировка: прогрессии", "chords", drillProgression,
              "Случайная ходовая прогрессия в случайной тональности. Цифры это ступени: I главный аккорд, V пятый, vi шестой минорный."),
        drill("Тренировка: обращения", "chords", drillInversions,
              "Аккорд с другой нотой внизу. С обращениями рука почти не прыгает между аккордами.",
              { hint: "Буква после черты это нижняя нота. C/E значит аккорд C, внизу E." }),
        drill("Тренировка: бас и аккорд", "bass", function () { return pickMany(HOME_CHORDS, 8).join(" "); },
              "Левая рука берёт бас, правая аккорд, порядок аккордов каждый раз новый. Главное упражнение для двух рук."),
        drill("Тренировка: септаккорды", "chords", function () { return pickMany(HOME_SEVENTHS, 10).join(" "); },
              "Аккорды из четырёх нот вразбивку. Они нужны в хаусе, лоу-фае, соуле и джазе."),
        drill("Тренировка: гаммы", "notes", drillScale,
              "Одна случайная гамма вверх и обратно. Гаммы это беглость пальцев и запас нот для мелодий.", { rhythm: 2 }),
        drill("Тренировка: биты", "drums", function () { return DRILL_BEATS[roll(DRILL_BEATS.length)]; },
              "Случайный бит из копилки: рок, хип-хоп, хаус, диско, брейк, регги. Держи ровный счёт от начала до конца.", { rhythm: 2 }),
        drill("Тренировка: ручки синтезатора", "tour", drillKnobs,
              "Шесть случайных заданий на Drift: фильтр, огибающая, генератор, LFO. Ручки должны находиться сами, как клавиши.", { pts: 120 }),
        drill("Тренировка: эффекты", "tour", drillEffects,
              "Три случайных эффекта: поставить на дорожку и повернуть главную ручку. Так запоминаешь, какой эффект что делает.", { pts: 120 }),
        drill("Тренировка: темпы жанров", "tour", drillTempos,
              "Пять жанров подряд: вспомнить темп каждого и выставить его в Ableton. Темп это первое, что определяет жанр.", { pts: 100 })
    ] },
    { id: "synth", title: "Синтезаторы", need: 300, lessons: [
        lesson("Миссия: первый синтезатор", "tour", [
            ["manual", "", "Сейчас на дорожке появится новый инструмент, а прежний исчезнет. Чтобы не потерять свой звук, сохрани его: в заголовке инструмента справа есть значок дискеты. Нажми его, потом Enter."],
            ["live", "device:Drift", "В браузере слева открой Instruments и перетащи Drift на эту дорожку. Он встанет на место прежнего инструмента."],
            ["note", "C", "Drift это синтезатор: звук рождается в генераторе, потом проходит фильтр и огибающую. Сыграй до и послушай, с чего мы начинаем."],
            ["chord", "Am", "Аккорды он тоже играет. Зажми A, C и E вместе."],
            ["manual", "", "Щёлкни по заголовку Drift. Теперь восемь энкодеров клавиатуры крутят его главные ручки: K1 и K2 фильтр, с K3 по K6 огибающая, K8 громкость. Покрути и жми готово."]
        ], "Синтезатор это инструмент, звук которого ты лепишь сам. Начнём с Drift: в нём всё главное на одном экране.", { pts: 120 }),
        lesson("Фильтр: тёмный и яркий звук", "tour", [
            ["live", "device:Drift", "Для урока нужен Drift на этой дорожке. Если его нет, перетащи его из раздела Instruments в браузере."],
            ["live", "knob:Drift:LP Freq:down", "Фильтр срезает верхние частоты. В блоке Filter поверни ручку Freq влево (энкодер K1) и играй ноты: звук темнеет, будто закрыли дверь."],
            ["live", "knob:Drift:LP Freq:up", "Теперь вправо: звук раскрывается и становится ярким. Плавное открывание фильтра это главный приём электронной музыки."],
            ["live", "knob:Drift:LP Res:up", "Ручка Res (K2) это резонанс: он подчёркивает частоту среза. Прибавь его."],
            ["live", "knob:Drift:LP Freq:moved", "С резонансом снова подвигай Freq, удерживая ноту: фильтр запел. Так звучит эйсид-бас."],
            ["chord", "Am", "Оставь фильтр прикрытым наполовину и возьми Am: мягкий аккорд для фона готов."]
        ], "Фильтр решает, тёмный звук или яркий. Это первая ручка, за которую хватается любой продюсер.", { pts: 130 }),
        lesson("Огибающая: атака и хвост", "tour", [
            ["live", "device:Drift", "Нужен Drift на этой дорожке. Если его нет, перетащи его из раздела Instruments."],
            ["live", "knob:Drift:Env 1 Attack:up", "Огибающая рисует громкость ноты во времени. Attack (K3) это время нарастания. Прибавь его и сыграй: нота вплывает, как у струнных."],
            ["live", "knob:Drift:Env 1 Attack:down", "Верни Attack влево до упора: звук снова бьёт сразу, как клавиша пианино."],
            ["live", "knob:Drift:Env 1 Release:up", "Release (K6) это хвост после того, как клавишу отпустили. Прибавь его: ноты тают, а не обрываются."],
            ["live", "knob:Drift:Env 1 Sustain:down", "Sustain (K5) это уровень, на котором нота держится, пока клавиша нажата. Убери его в ноль."],
            ["live", "knob:Drift:Env 1 Decay:moved", "Теперь нота это короткий щипок, а его длину задаёт Decay (K4). Покрути его: так делают плаки и басы."]
        ], "Четыре ручки Attack, Decay, Sustain и Release превращают один и тот же тембр в удар, щипок, пэд или орган.", { pts: 140 }),
        lesson("Генераторы: сырой тембр", "tour", [
            ["live", "device:Drift", "Нужен Drift на этой дорожке. Если его нет, перетащи его из раздела Instruments."],
            ["live", "knob:Drift:Osc 1 Wave:changed", "Генератор (Osc) даёт сырой тембр. В блоке Osc 1 открой список волн и выбери другую: Saw яркая и жужжит, Rectangle пустая и гнусавая, Sine чистая."],
            ["live", "knob:Drift:Osc 1 Shape:moved", "Ручка Shape рядом гнёт выбранную волну. Покрути её и смотри на картинку волны внизу: тембр плавно меняется."],
            ["live", "knob:Drift:Osc 2 Detune:changed", "Второй генератор звучит вместе с первым. Его ручка Detune сдвигает высоту по полутонам: поставь 7, и в каждой ноте зазвучит квинта."],
            ["live", "knob:Drift:Osc 2 Oct:changed", "Верни Detune в ноль и опусти Osc 2 на октаву ручкой Oct: у звука появится низ."],
            ["live", "voice:Unison", "Найди список Mode, обычно в нём стоит Poly. Выбери Unison: каждую ноту играют четыре слегка расстроенных голоса. Звук стал широким и жирным."]
        ], "Тембр начинается в генераторе: какая волна, сколько генераторов и как они настроены друг к другу.", { pts: 140 }),
        lesson("LFO: звук шевелится сам", "tour", [
            ["live", "device:Drift", "Нужен Drift на этой дорожке. Если его нет, перетащи его из раздела Instruments."],
            ["live", "knob:Drift:^LP Mod Amt [12]$:moved", "LFO это медленная волна, которая крутит ручки за тебя. В блоке Filter найди раздел Freq Mod: выбери в списке источник LFO и сдвинь ползунок рядом с ним вправо."],
            ["note", "A", "Зажми ля и подержи: фильтр качается сам. Это и называют модуляцией."],
            ["live", "knob:Drift:LFO Freq:moved", "В блоке LFO ручка Rate задаёт скорость качания. Медленно это дыхание пэда, быстро это дрожь и рычание баса. Покрути её."],
            ["live", "knob:Drift:LFO Wave:changed", "Там же выбери другую форму волны LFO: Square переключает резко, Sample and Hold скачет случайно, как компьютер в старом кино."],
            ["manual", "", "Ещё один источник движения у тебя под рукой: колесо Mod слева на клавиатуре. В блоке Mod его можно назначить на любую ручку. Жми готово."]
        ], "Живой звук всё время чуть меняется. LFO делает это сам, пока твои руки заняты клавишами.", { pts: 140 }),
        lesson("Рецепт: бас", "tour", tour(
            ["live", "device:Drift", "Нужен Drift на этой дорожке. Если его нет, перетащи его из раздела Instruments."],
            ["live", "voice:Mono", "Бас играет по одной ноте. В списке Mode выбери Mono: ноты перестанут накладываться друг на друга."],
            ["live", "knob:Drift:^(Osc 1 Oct|Transpose)$:changed", "Опусти звук на октаву: ручка Oct у Osc 1."],
            ["live", "knob:Drift:LP Freq:down", "Прикрой фильтр ручкой Freq (K1): басу яркий верх не нужен, ему нужен плотный низ."],
            many("note", "A3 A3 C4 A3 G3 A3 E3 A3", "Бас готов. Сыграй линию коротко и ровно: бас должен попадать вместе с бочкой.")
        ), "Бас это фундамент трека. Рецепт один на все жанры: один голос, низкая октава, прикрытый фильтр.", { pts: 150 }),
        lesson("Рецепт: пэд", "tour", tour(
            ["live", "device:Drift", "Нужен Drift на этой дорожке. Если его нет, перетащи его из раздела Instruments."],
            ["live", "voice:Stereo", "Пэд это мягкий фон из аккордов. В списке Mode выбери Stereo: голоса разойдутся по левой и правой колонке."],
            ["live", "knob:Drift:Env 1 Attack:up", "Прибавь Attack (K3): аккорд не бьёт, а вплывает."],
            ["live", "knob:Drift:Env 1 Release:up", "Прибавь Release (K6): аккорды перетекают друг в друга."],
            ["live", "knob:Drift:LP Freq:down", "Прикрой фильтр (K1), чтобы пэд не спорил с мелодией за верхние частоты."],
            many("chord", "Am F C G", "Сыграй прогрессию длинными аккордами и слушай, как они наплывают один на другой.")
        ), "Пэд заполняет пространство и склеивает трек. Его почти не замечают, но без него пусто.", { pts: 150 }),
        lesson("Рецепт: плак и лид", "tour", tour(
            ["live", "device:Drift", "Нужен Drift на этой дорожке. Если его нет, перетащи его из раздела Instruments."],
            ["live", "knob:Drift:Env 1 Sustain:down", "Плак это короткий щипок. Убери Sustain (K5) в ноль."],
            ["live", "knob:Drift:Env 1 Decay:moved", "Decay (K4) поставь коротким, примерно на четверть оборота."],
            many("note", "A4 C5 E5 C5 A4 C5 E5 A5", "Сыграй арпеджио: короткие ноты сыплются, как капли. Такой звук любят хаус и транс."),
            ["live", "knob:Drift:Env 1 Sustain:up", "Теперь лид, голос мелодии. Верни Sustain вправо, чтобы нота тянулась, пока держишь клавишу."],
            ["live", "knob:Drift:Glide Time:up", "В списке Mode выбери Mono, включи Legato и прибавь Glide."],
            ["manual", "", "Сыграй мелодию внахлёст: нажимай следующую клавишу, не отпуская прошлую. Ноты съезжают одна в другую, как голос. Наигрался, жми готово."]
        ), "Плак играет арпеджио и рифы, лид ведёт главную мелодию. Разница между ними в двух ручках огибающей.", { pts: 160 }),
        lesson("Operator: звук из частот", "tour", tour(
            ["live", "device:Operator", "Перетащи на дорожку Operator из Instruments, он заменит Drift. Operator устроен иначе: один генератор трясёт другой. Это FM-синтез."],
            ["note", "C", "Сейчас звучит один генератор A с чистой волной. Сыграй до: звук простой, как гудок."],
            ["live", "knob:Operator:Osc-B Level:up", "Включи генератор B (квадратик с буквой B) и прибавь его Level (энкодер K7). Сам B не слышен: он раскачивает A, и в звуке появляется металл."],
            ["live", "knob:Operator:B Coarse:changed", "Ручка Coarse у B (K5) задаёт, во сколько раз B быстрее A. Малые числа дают чистый тон, большие дают колокол. Попробуй разные."],
            ["live", "knob:Operator:Filter Freq:moved", "Фильтр есть и здесь: включи блок Filter, если он выключен, и поверни его частоту (K1). Резкий металл становится мягким электропиано."],
            many("chord", "Am F", "Возьми пару аккордов. На FM-синтезе сделаны электропиано, колокола и басы восьмидесятых.")
        ), "FM-синтез даёт металл, стекло и колокола: звуки, которые фильтром не вылепишь.", { pts: 150 }),
        lesson("Wavetable: живые волны", "tour", tour(
            ["live", "device:InstrumentVector", "Перетащи на дорожку Wavetable из Instruments. Его генератор хранит целую таблицу волн и умеет плавно скользить по ней."],
            ["live", "knob:InstrumentVector:Osc 1 Pos:moved", "Зажми ноту и крути энкодер K1: это позиция в таблице волн. Тембр перетекает из одного в другой, обычный генератор так не умеет."],
            ["live", "knob:InstrumentVector:Flt 1 Freq:down", "Фильтр тут на K5. Прикрой его: принцип тот же, что в Drift."],
            ["live", "setting:InstrumentVector:unison_mode:1", "Найди блок Unison и выбери в нём режим Classic: один голос превращается в хор. Так делают суперпилу для транса и фьюче-бейса."],
            many("chord", "Am F C G", "Сыграй аккорды широким звуком.")
        ), "Wavetable это звук современной электроники: тембр, который движется внутри одной ноты.", { pts: 150 }),
        lesson("Analog: тёплая классика", "tour", tour(
            ["live", "device:UltraAnalog", "Перетащи на дорожку Analog из Instruments. Он устроен как старые аналоговые синтезаторы: два генератора, два фильтра, два усилителя."],
            ["live", "knob:UltraAnalog:F1 Freq:down", "Энкодер K1 это частота первого фильтра. Прикрой его: знакомое действие, знакомый результат."],
            ["live", "knob:UltraAnalog:OSC2 Detune:moved", "K7 чуть расстраивает второй генератор относительно первого. Два почти одинаковых тона дают тёплое живое биение."],
            ["live", "knob:UltraAnalog:Vib On/Off:on", "В Analog есть вибрато: найди переключатель Vib и включи его. Теперь колесо Mod слева на клавиатуре добавляет ноте дрожание."],
            many("note", "A4 C5 E5", "Сыграй ноты и на длинной ноте подвигай колесо Mod: звук оживает, как голос певца.")
        ), "Одни и те же блоки стоят в любом синтезаторе. Поняв Drift, ты уже понимаешь Analog.", { pts: 150 }),
        lesson("Арпеджиатор: аккорд рассыпается сам", "tour", tour(
            ["live", "device:MidiArpeggiator", "В браузере открой MIDI Effects и перетащи Arpeggiator на эту дорожку."],
            ["live", "order:MxDeviceMidiEffect:MidiArpeggiator", "Arpeggiator должен стоять правее тренажёра и левее инструмента. Если он встал иначе, перетащи его за заголовок."],
            ["chord", "Am", "Зажми Am и держи: арпеджиатор сам перебирает его ноты по одной."],
            ["live", "knob:MidiArpeggiator:Synced Rate:changed", "Ручка Rate задаёт скорость в долях такта: 1/8 это спокойно, 1/16 это бодро. Поменяй её."],
            ["live", "knob:MidiArpeggiator:Style:changed", "В списке Style выбери другой рисунок: Up идёт вверх, UpDown туда и обратно, Random скачет случайно."],
            many("chord", "Am F C G", "Сыграй прогрессию, держа каждый аккорд по такту. Одной рукой ты играешь как секвенсор из восьмидесятых."),
            ["manual", "", "Арпеджиатор выключается кнопкой в левом углу его заголовка и удаляется клавишей Delete. Жми готово."]
        ), "Арпеджиатор превращает зажатый аккорд в бегущий рисунок. На нём стоят синтвейв, транс и половина саундтреков.", { pts: 160 }),
        lesson("Рецепт: саб-бас", "tour", tour(
            ["live", "device:Drift", "Перетащи на дорожку Drift из Instruments, если сейчас стоит другой инструмент."],
            ["live", "knob:Drift:Osc 1 Wave:is Sine", "Саб-бас это самый низ трека, его скорее чувствуют, чем слышат. В списке волн Osc 1 выбери Sine: чистый тон без призвуков."],
            ["live", "voice:Mono", "В списке Mode выбери Mono: в самом низу две ноты сразу дают только гул."],
            ["live", "knob:Drift:^(Osc 1 Oct|Transpose)$:changed", "Опусти звук на октаву или две ручкой Oct у Osc 1."],
            many("note", "A3 A3 F3 F3 D3 D3 E3 E3", "Сыграй линию длинными нотами. На маленьких колонках саб почти не слышен: проверяй его в наушниках.")
        ), "Саб-бас держит низ в трэпе, дабстепе и драм-н-бейсе. Он простой, но без него трек не качает.", { pts: 150 }),
        lesson("Рецепт: эйсид-бас", "tour", tour(
            ["live", "device:Drift", "Перетащи на дорожку Drift из Instruments, если сейчас стоит другой инструмент."],
            ["live", "voice:Mono", "Эйсид это визжащий бас из чикагских клубов. В списке Mode выбери Mono."],
            ["live", "knob:Drift:^Legato( On)?$:on", "Включи рядом переключатель Legato и прибавь Glide: ноты, сыгранные внахлёст, будут съезжать одна в другую."],
            ["live", "knob:Drift:LP Res:up", "Резонанс (K2) прибавь почти до упора: это и есть голос эйсида."],
            ["live", "knob:Drift:LP Freq:down", "Фильтр (K1) прикрой примерно до середины."],
            many("note", "A3 A3 C4 A3 A3 G3 A3 E4", "Сыграй риф быстрыми короткими нотами."),
            ["live", "knob:Drift:LP Freq:moved", "А теперь главное: играй риф одной рукой, а другой води фильтр туда и обратно. Бас запел и завизжал."]
        ), "Эйсид-бас это пара нот, резонанс и рука на фильтре. С него начались эйсид-хаус и техно.", { pts: 160 }),
        lesson("Рецепт: суперпила", "tour", tour(
            ["live", "device:Drift", "Перетащи на дорожку Drift из Instruments, если сейчас стоит другой инструмент."],
            ["live", "knob:Drift:Osc 1 Wave:is Saw", "В списке волн Osc 1 выбери Saw: пила самая яркая из волн."],
            ["live", "voice:Unison", "В списке Mode выбери Unison: каждую ноту играют четыре голоса."],
            ["live", "knob:Drift:Strength:up", "Ползунок Strength рядом расстраивает голоса между собой. Прибавь его: звук расползается вширь."],
            ["live", "knob:Drift:Env 1 Release:up", "Прибавь Release (K6), чтобы аккорды не обрывались."],
            many("chord", "Fmaj7 G6 Am7 Em7", "Сыграй большие аккорды. Это суперпила: звук транса, фьюче-бейса и стадионной электроники.")
        ), "Суперпила это много расстроенных пил сразу. Самый узнаваемый звук большой танцевальной музыки.", { pts: 160 })
    ] },
    { id: "fx", title: "Эффекты", need: 300, lessons: [
        lesson("Миссия: ревербератор", "tour", [
            ["live", "device:Reverb", "Эффекты стоят на дорожке после инструмента и меняют готовый звук. В браузере открой Audio Effects и перетащи Reverb на эту дорожку."],
            ["live", "knob:Reverb:Dry/Wet:up", "Reverb помещает звук в комнату. Ручка Dry/Wet (энкодер K8) смешивает чистый звук с отзвуком комнаты. Прибавь её и сыграй ноту."],
            ["live", "knob:Reverb:Decay Time:up", "Decay Time (K1) это сколько секунд тает хвост. Прибавь: комната превращается в собор."],
            ["live", "knob:Reverb:Device On:off", "Сравни: выключи эффект кнопкой в левом углу его заголовка. Звук снова сухой и близкий."],
            ["live", "knob:Reverb:Device On:on", "Включи обратно. Правило простое: чем больше ревера, тем дальше звук. Ведущим партиям его дают немного, фону много."]
        ], "Ревербератор даёт звуку пространство. Без него синтезатор звучит как в шкафу.", { pts: 130 }),
        lesson("Delay: эхо в ритм", "tour", tour(
            ["live", "device:Delay", "Перетащи Delay из Audio Effects на дорожку. Он повторяет звук через равные промежутки, как эхо в горах."],
            ["live", "knob:Delay:Dry/Wet:up", "Прибавь Dry/Wet (K8) и сыграй короткую ноту: за ней бегут повторы."],
            ["live", "knob:Delay:Feedback:up", "Feedback (K3) это сколько раз повторится эхо. Прибавь, но не до упора: на максимуме эхо не затихает никогда."],
            ["live", "knob:Delay:^[LR] 16th$:changed", "Кнопки с цифрами задают время повтора в шестнадцатых долях. Выбери 3: получится пунктирное эхо, любимое в хаусе и техно."],
            many("note", "A4 C5 E5", "Сыграй короткие ноты с паузами и послушай, как эхо само заполняет промежутки.")
        ), "Delay попадает в темп трека и превращает три ноты в целый рисунок.", { pts: 130 }),
        lesson("Auto Filter: фильтр как эффект", "tour", [
            ["live", "device:AutoFilter2,AutoFilter", "Перетащи Auto Filter из Audio Effects. Это тот же фильтр, что в синтезаторе, но его можно поставить на любой звук, даже на барабаны."],
            ["live", "knob:AutoFilter2,AutoFilter:Frequency:down", "Играй аккорд и закрывай фильтр ручкой частоты (K1): звук уходит под воду. Так делают вступления и переходы."],
            ["live", "knob:AutoFilter2,AutoFilter:Frequency:up", "Открой обратно: вот он, знаменитый подъём перед припевом."],
            ["live", "knob:AutoFilter2,AutoFilter:LFO Amount:up", "В блоке LFO прибавь Amount: фильтр начнёт качаться сам, в ритм трека."],
            ["manual", "", "Движение фильтра можно записать в клип, это называется автоматизация. До неё дойдём на ступени про приёмы Ableton. Жми готово."]
        ], "Фильтр как эффект это главный инструмент диджея и основа любого нарастания в треке.", { pts: 130 }),
        lesson("Saturator: тепло и грязь", "tour", [
            ["live", "device:Saturator", "Перетащи Saturator из Audio Effects. Он перегружает звук, как старый усилитель, и добавляет новые призвуки."],
            ["live", "knob:Saturator:Drive:up", "Прибавь Drive (K1): сначала звук теплеет и уплотняется, дальше начинает рычать."],
            ["live", "knob:Saturator:Output:down", "От перегруза звук стал громче. Убавь Output (K7), чтобы сравнивать честно: громкое всегда кажется лучше."],
            ["live", "knob:Saturator:Dry/Wet:down", "Перебор? Dry/Wet (K8) подмешивает чистый звук обратно. Убавь до половины."],
            ["manual", "", "Немного сатурации на басу и барабанах делает их слышными даже в маленьких колонках. Жми готово."]
        ], "Перегруз это не брак, а краска: от лёгкого тепла до рычащего баса.", { pts: 120 }),
        lesson("Chorus: ширина", "tour", tour(
            ["live", "device:Chorus2", "Перетащи Chorus-Ensemble из Audio Effects. Он добавляет к звуку его чуть расстроенные копии."],
            ["live", "knob:Chorus2:Amount:up", "Прибавь Amount (K1) и сыграй аккорд: звук стал шире и мягче, будто играют несколько синтезаторов."],
            ["live", "knob:Chorus2:Rate:moved", "Rate (K2) это скорость, с которой качаются копии. Медленно даёт плавный объём, быстро даёт дрожь."],
            many("chord", "Am F", "Сыграй два аккорда. Хорус на пэдах и электропиано это звук синтвейва и лоу-фая.")
        ), "Хорус делает из одного голоса ансамбль. Один поворот ручки, и плоский звук становится широким.", { pts: 120 }),
        lesson("EQ Eight: убрать лишнее", "tour", [
            ["live", "device:Eq8", "Перетащи EQ Eight из Audio Effects. Эквалайзер делает громче или тише отдельные частоты: низ, середину, верх."],
            ["live", "knob:Eq8:^[1-8] Gain A$:moved", "На графике стоят точки с цифрами. Потяни точку 3 вверх и вниз, играя аккорд: слышно, какую часть звука она держит."],
            ["live", "knob:Eq8:^[1-8] Frequency A$:moved", "Теперь двигай ту же точку влево и вправо: так выбирают частоту, которую правят."],
            ["manual", "", "Щёлкни точку 1 и под графиком выбери для неё первый тип в списке: обрез низа. Всё, что левее точки, исчезает."],
            ["manual", "", "Обрез низа ставят почти на всё, кроме бочки и баса: так они не тонут в гуле. Жми готово."]
        ], "Эквалайзер освобождает место: каждый инструмент получает свою полку частот, и трек перестаёт звучать кашей.", { pts: 140 }),
        lesson("Compressor: плотность", "tour", [
            ["live", "device:Compressor2", "Перетащи Compressor из Audio Effects. Он сам убавляет громкие места, и звук становится ровным и плотным."],
            ["live", "knob:Compressor2:Threshold:down", "Играй то одну ноту, то аккорд и опускай Threshold (K1), пока полоска GR не начнёт дёргаться вниз: это компрессор прижимает громкое."],
            ["live", "knob:Compressor2:Ratio:up", "Ratio (K2) это сила сжатия. 2 к 1 мягко, 4 к 1 заметно, 10 к 1 жёстко. Прибавь."],
            ["live", "knob:Compressor2:Output:up", "Звук стал тише: компрессор умеет только убавлять. Верни громкость ручкой Out (K8)."],
            ["manual", "", "Компрессор держит бас на одном уровне и склеивает барабаны. Не дави слишком: пережатый звук быстро утомляет. Жми готово."]
        ], "Компрессор выравнивает громкость. Самый непонятный эффект для новичка и самый нужный на сведении.", { pts: 140 }),
        lesson("Миссия: общий ревербератор", "tour", [
            ["live", "returnDevice:Reverb,Hybrid", "Справа в микшере есть дорожки A и B: это возвраты, общие эффекты для всех дорожек. На одной из них должен стоять Reverb. Если его нет, перетащи Reverb на дорожку A."],
            ["live", "sendUp", "На своей дорожке найди ручку Sends A и прибавь её: часть звука пойдёт в общий ревербератор."],
            ["manual", "", "Один ревербератор на все дорожки это общая комната: звуки склеиваются в одно пространство, а компьютеру легче. Подбери посыл на слух и жми готово."]
        ], "Посылы и возвраты это способ дать один эффект сразу многим дорожкам. Так работает любой микшерный пульт.", { pts: 150 }),
        lesson("Redux: старая приставка", "tour", tour(
            ["live", "device:Redux2", "Перетащи Redux из Audio Effects. Он портит звук нарочно: так звучали первые сэмплеры и игровые приставки."],
            ["live", "knob:Redux2:Bit Depth:down", "Убавь Bits (K3): звук становится зернистым и шумным."],
            ["live", "knob:Redux2:Sample Rate:down", "Убавь Rate (K1): верх рассыпается на металлический звон."],
            ["live", "knob:Redux2:Dry/Wet:down", "Подмешай чистый звук ручкой Dry/Wet (K8), чтобы грязь была приправой, а не блюдом."],
            many("chord", "Am7 Dm7", "Сыграй пару септаккордов: основа лоу-фай бита готова.")
        ), "Нарочно испорченный звук это характер. На нём держатся лоу-фай, чиптюн и половина хип-хопа.", { pts: 120 }),
        lesson("Порядок эффектов", "tour", [
            ["live", "device:Saturator", "Порядок эффектов меняет результат. Поставь на дорожку Saturator и прибавь ему Drive."],
            ["live", "device:Reverb", "Добавь на ту же дорожку Reverb и прибавь ему Dry/Wet."],
            ["live", "order:Saturator:Reverb", "Поставь Saturator левее Reverb: устройство перетаскивают за заголовок. Сигнал идёт слева направо, значит, ревер получает уже перегруженный звук."],
            ["chord", "Am", "Сыграй аккорд: грязный звук в чистой комнате."],
            ["live", "order:Reverb:Saturator", "Теперь перетащи Reverb левее Saturator: перегружается уже весь хвост ревера."],
            ["chord", "Am", "Сыграй снова: стена шума, как у гитарных групп. Ни один порядок не ошибка, это разные краски."]
        ], "Одни и те же эффекты в разном порядке дают разный звук. Цепочку читают слева направо.", { pts: 150 }),
        lesson("Миссия: громко, но без хрипа", "tour", [
            ["live", "masterDevice:Limiter", "Весь звук трека сходится на дорожке Main, она крайняя справа. Щёлкни по ней и перетащи туда Limiter из Audio Effects."],
            ["live", "masterKnob:Limiter:Input Gain,Gain:up", "Limiter не пускает звук выше потолка, так что трек не хрипит. Прибавь ему Gain: всё стало громче, а пики упёрлись в потолок."],
            ["manual", "", "Следи за индикатором дорожки Main: красный цвет означает перегруз. Пока сочиняешь, держи запас по громкости, её добирают в самом конце. Жми готово."]
        ], "Громкость трека ограничена потолком. Лимитер на главной дорожке спасает от хрипа и добавляет плотности.", { pts: 150 }),
        lesson("Echo: эхо с характером", "tour", tour(
            ["live", "device:Echo", "Перетащи Echo из Audio Effects. Это старший брат Delay: его эхо можно состарить, раскачать и утопить в ревере."],
            ["live", "knob:Echo:Dry Wet:up", "Прибавь Dry/Wet (K8) и сыграй короткую ноту."],
            ["live", "knob:Echo:Feedback:up", "Feedback (K6) решает, сколько раз повторится эхо. Прибавь."],
            ["live", "knob:Echo:Reverb Level:up", "Найди ручку Reverb: она добавляет повторам комнату. Прибавь её, и эхо уплывёт вдаль."],
            many("note", "A4 E5 C5", "Сыграй ноты с паузами. Такое эхо это основа даба и эмбиента.")
        ), "Echo это эхо с настроением: от чистого повтора до старой плёнки, которая плывёт и шумит.", { pts: 130 }),
        lesson("Phaser-Flanger: звук плывёт", "tour", tour(
            ["live", "device:PhaserNew", "Перетащи Phaser-Flanger из Audio Effects. Он вырезает в звуке движущиеся провалы, и тембр начинает плыть."],
            ["live", "knob:PhaserNew:LFO Amount:up", "Прибавь Amount (K1) и возьми аккорд: по звуку пошла волна."],
            ["live", "knob:PhaserNew:Feedback:up", "Feedback (K3) делает эффект острее и звонче. Прибавь."],
            ["live", "knob:PhaserNew:Mode:changed", "Вверху три режима: Phaser, Flanger и Doubler. Переключи и сравни: фленджер звучит как взлетающий самолёт."],
            many("chord", "Am F", "Сыграй пару длинных аккордов и послушай, как они переливаются.")
        ), "Фазер и фленджер дают звуку движение без единой новой ноты. Классика пэдов, гитар и хэтов.", { pts: 130 }),
        lesson("Utility: ширина и моно", "tour", [
            ["live", "device:StereoGain", "Перетащи Utility из Audio Effects. Он ничего не красит, а управляет самим сигналом: громкостью, шириной, балансом."],
            ["live", "knob:StereoGain:Stereo Width:down", "Убавь Width до нуля: звук собрался в точку посередине. Это моно. Так проверяют, не пропадает ли что-то в телефоне или в клубе."],
            ["live", "knob:StereoGain:Stereo Width:up", "Теперь прибавь Width выше 100: звук раздвинулся шире колонок."],
            ["manual", "", "Правило: бас и бочку держат в моно посередине, а пэды и эффекты разводят в стороны. Для баса в Utility есть кнопка Bass Mono. Жми готово."]
        ], "Ширина это ещё одно измерение сведения: что стоит в центре, а что по краям.", { pts: 130 })
    ] },
    { id: "chords", title: "Аккорды", need: 500, lessons: [
        lesson("Шесть аккордов тональности", "chords", "C F G Am Dm Em C Am F G Em Dm",
               "В тональности шесть рабочих аккордов. Они сочетаются в любом порядке, это твоя палитра.", {}),
        lesson("Прогрессия Am - F - C - G", "chords", "Am F C G Am F C G",
               "Самая знаменитая четвёрка аккордов. Прогрессия это аккорды по кругу, основа трека.", { task: "В Ableton: запиши эту прогрессию клипом, по одному аккорду на такт." }),
        lesson("Прогрессия C - G - Am - F", "chords", "C G Am F C G Am F",
               "Те же аккорды в другом порядке дают другое настроение. Порядок это и есть сочинение.", {}),
        lesson("Прогрессия Dm - G - C - Am", "chords", "Dm G C Am Dm G C Am",
               "Dm, G и C стоят на круге рядом. Движение по кругу звучит естественно.", {}),
        lesson("Прогрессия Am - Dm - G - C", "chords", "Am Dm G C Am Dm G C",
               "Каждый следующий аккорд на квинту ниже. Такое движение тянет музыку вперёд.", {}),
        lesson("Обращения: тот же аккорд иначе", "chords", "C C/E C/G F F/A F/C G G/B G/D C",
               "Ноты аккорда можно переставлять. Тогда рука почти не двигается между аккордами.", { hint: "Буква после черты это нижняя нота. C/E значит аккорд C, внизу E." }),
        lesson("Нисходящий бас", "chords", "C G/B Am Am/G F C/E Dm G C",
               "Бас идёт вниз по ступенькам, а аккорды меняются над ним. Приём из тысяч баллад.", { hint: "Буква после черты это нижняя нота. Следи, как бас шагает вниз." }),
        lesson("Блюз на трёх аккордах", "chords", "C C C C F F C C G F C G",
               "Двенадцать тактов блюза это схема, на которой вырос рок, фанк и хаус.", {}),
        lesson("Миссия: первый клип", "tour", [
            ["live", "armed", "Найди на своей дорожке внизу кнопку записи с кружком (Arm) и включи её: дорожка готова писать."],
            ["live", "hasClip", "В пустой ячейке этой дорожки нажми кружок записи и сыграй четыре аккорда. Потом нажми пробел."],
            ["live", "clipPlaying", "Получился клип. Запусти его треугольником слева от клипа: он играет по кругу."],
            ["live", "stopped", "Пробел останавливает всё. Клип это кирпич, из клипов собирают трек."]
        ], "Клип это записанный кусок игры. Трек в Ableton собирают из клипов, как из кубиков.", { pts: 150 }),
        lesson("Миссия: выровнять ноты", "tour", [
            ["manual", "", "Дважды щёлкни свой клип: внизу откроются ноты. Видно, что они стоят неровно."],
            ["manual", "", "Щёлкни по нотам, нажми Ctrl+A (выделить всё), потом Ctrl+U. Ноты встанут на сетку."],
            ["manual", "", "Это квантизация. Послушай клип ещё раз: он стал ровнее. Жми готово."]
        ], "Квантизация ставит ноты точно на доли. Так ровно звучит почти вся электронная музыка.", { pts: 90 }),
        lesson("Прогрессия F - C - G - Am", "chords", "F C G Am F C G Am",
               "Те же четыре аккорда, начатые с F: звучит как взлёт. Любимая прогрессия танцевальной музыки.", {}),
        lesson("Канон: восемь аккордов", "chords", "C G Am Em F C F G C G Am Em F C F G",
               "Последовательность из канона Пахельбеля. На ней написаны сотни поп-песен.", {}),
        lesson("Прогрессия Am - G - F - E", "chords", "Am G F E Am G F E",
               "Спуск из испанской музыки. Последний аккорд E мажорный, чужой для тональности, и оттого сильно тянет обратно в Am.", { key: "Am" })
    ] },
    { id: "drums", title: "Барабаны", need: 500, lessons: [
        lesson("Миссия: тренажёр на барабанах", "tour", [
            ["manual", "", "Барабаны играют пэдами. Перетащи SMK Trainer из браузера Ableton на дорожку с Drum Rack и продолжи там."],
            ["drum", "K", "Ударь по пэду бочки: нижний ряд, первый слева. Бочка это пульс трека."],
            ["drum", "S", "Теперь снейр: нижний ряд, третий пэд. Снейр отвечает бочке."],
            ["drum", "H", "И хэт: нижний ряд, седьмой пэд. Хэт заполняет место между ударами."]
        ], "У барабанов свои уроки и своя дорожка. Здесь разберёмся, где какой барабан.", { pts: 100 }),
        lesson("Бочка на каждую долю", "drums", "K K K K K K K K",
               "Ровная бочка это сердце танцевальной музыки. Главное тут ровность, а не скорость.", { rhythm: 1 }),
        lesson("Бочка и снейр", "drums", "K S K S K S K S",
               "Бочка на раз и три, снейр на два и четыре. На этом стоит весь поп и рок.", { rhythm: 1 }),
        lesson("Хэты восьмыми", "drums", "H H H H H H H H H H H H H H H H",
               "Хэт идёт вдвое чаще бочки и задаёт движение. Держи его ровным, как часы.", { rhythm: 2 }),
        lesson("Бочка вместе с хэтом", "drums", "KH H KH H KH H KH H",
               "Два пэда одним ударом: руки учатся работать вместе и по отдельности.", { rhythm: 2 }),
        lesson("Рок-бит", "drums", "KH H SH H KH H SH H KH H SH H KH H SH H",
               "Первый настоящий бит: бочка, снейр и хэт вместе. Под него можно играть что угодно.", { rhythm: 2, task: "В Ableton: запиши этот бит клипом на дорожке барабанов и зацикли его." }),
        lesson("Хаус: бочка в пол", "drums", "K O KC O K O KC O K O KC O K O KC O",
               "Бочка на каждую долю, клэп на вторую и четвёртую, открытый хэт между ними. Это хаус.", { rhythm: 2 }),
        lesson("Хип-хоп", "drums", "KH H SH H H KH SH H KH H SH H H KH SH H",
               "Бочка сдвинута с ровных долей, и бит начинает качать. Так звучит бум-бэп.", { rhythm: 2 }),
        lesson("Трэп: быстрые хэты", "drums", "KH H H H SH H H H KH H KH H SH H H H",
               "Хэты шестнадцатыми, редкая бочка и снейр. Узнаваемый рисунок трэпа.", { rhythm: 4 }),
        lesson("Брейкбит", "drums", "KH H SH H H KH SH KH KH H SH H H KH SH H",
               "Ломаный ритм из джангла и драм-н-бейса. Бочка и снейр перекликаются.", { rhythm: 2 }),
        lesson("Сбивка", "drums", "S S S S T T L L KX",
               "Сбивка это переход между частями трека: дробь по снейру и томам и удар с тарелкой.", { rhythm: 4 }),
        lesson("Диско", "drums", "KH O KS O KH O KS O KH O KS O KH O KS O",
               "Бочка на каждую долю, снейр на вторую и четвёртую, открытый хэт между ударами. Под этот бит танцуют с семидесятых.", { rhythm: 2 }),
        lesson("Регги: уан-дроп", "drums", "H H H H KR H H H H H H H KR H H H",
               "На первую долю пусто, бочка и рим падают вместе только на третью. От этой паузы бит и качается.", { rhythm: 2 }),
        lesson("Фанк", "drums", "KH H SH H KH KH SH KH H KH SH H KH H SH KH",
               "Бочка играет между долями и спорит со снейром. Фанк это ритм, в котором важна каждая шестнадцатая.", { rhythm: 2 })
    ] },
    { id: "beatlab", title: "Звук барабанов", need: 900, pads: true, lessons: [
        lesson("Миссия: Drum Rack изнутри", "tour", [
            ["live", "device:DrumGroupDevice", "Эта ступень идёт на дорожке барабанов: тренажёр должен стоять там же, где Drum Rack. Если набора ещё нет, перетащи на дорожку любой Kit из раздела Drums."],
            ["drum", "K", "Drum Rack это коробка, где на каждом пэде свой инструмент. Ударь бочку."],
            ["manual", "", "Щёлкни мышью по пэду бочки в окне Drum Rack: справа откроется её инструмент с картинкой звука. У каждого пэда он свой. Жми готово."],
            ["drum", "S", "Ударь снейр и посмотри на Drum Rack: подсветился другой пэд."],
            ["manual", "", "Перетащи на любой пэд другой звук из браузера, раздел Drums. Так собирают собственный набор. Жми готово."]
        ], "Набор барабанов это не один инструмент, а шестнадцать маленьких. Каждый можно заменить и настроить.", { pts: 120, hint: "Этот урок проходят в тренажёре на дорожке барабанов." }),
        lesson("Настрой бочку", "tour", tour(
            ["live", "device:DrumGroupDevice", "Нужен Drum Rack на этой дорожке и тренажёр рядом с ним."],
            ["drum", "K", "Ударь бочку, потом щёлкни её пэд мышью, чтобы открыть её инструмент."],
            ["live", "knob:DrumCell,OriginalSimpler:Transpose:moved", "Найди у инструмента бочки ручку высоты (Transpose) и покрути: бочка становится выше или ниже. Её подстраивают под бас, чтобы низ не гудел."],
            many("drum", "K K K K", "Послушай результат: четыре ровных удара."),
            ["live", "knob:DrumCell,OriginalSimpler:Decay,Ve Decay,Ve Release:moved", "Теперь длина звука: ручка Decay. Короткая бочка звучит сухо и чётко, длинная гудит, как в трэпе."],
            many("drum", "K K K K", "Ещё четыре удара. Высота и длина бочки задают характер всего трека.")
        ), "Бочка в электронной музыке главный звук. Две ручки, высота и длина, решают, какой будет весь трек.", { pts: 140, hint: "Этот урок проходят в тренажёре на дорожке барабанов." }),
        lesson("Drum Buss: набор звучит плотно", "tour", tour(
            ["live", "device:DrumBuss", "Перетащи Drum Buss из Audio Effects на дорожку барабанов. Этот эффект придуман специально для ударных."],
            ["live", "knob:DrumBuss:Drive:up", "Прибавь Drive (K1) и постучи по пэдам: набор звучит плотнее и злее."],
            ["live", "knob:DrumBuss:Boom Amt:up", "Boom (K4) добавляет бочке глубокий низ. Прибавь и ударь бочку."],
            ["live", "knob:DrumBuss:Transients:moved", "Transients решает, острые удары или мягкие. Вправо щелчок сильнее, влево удар глуше."],
            many("drum", "KH H SH H KH H SH H", "Сыграй бит и сравни, выключая и включая Drum Buss кнопкой в его заголовке.")
        ), "Барабаны обрабатывают все вместе, как один инструмент: тогда набор звучит как целое.", { pts: 140, hint: "Этот урок проходят в тренажёре на дорожке барабанов." }),
        lesson("Миссия: бит мышью", "tour", [
            ["live", "clipAdded", "Бит можно не играть, а нарисовать. Дважды щёлкни пустую ячейку на дорожке барабанов: появится пустой клип."],
            ["manual", "", "Внизу открылась сетка: строки это пэды, столбцы это доли. Двойным щелчком поставь бочку на 1, 1.2, 1.3 и 1.4."],
            ["manual", "", "Добавь снейр или клэп на 1.2 и 1.4 и хэты между бочками. Запусти клип треугольником."],
            ["manual", "", "Клавиша B превращает мышь в карандаш: им удобно рисовать длинные ряды хэтов. Попробуй и жми готово."]
        ], "Половину битов в мире не играют, а рисуют. Так проще попасть в сетку и легко менять рисунок.", { pts: 140, hint: "Этот урок проходят в тренажёре на дорожке барабанов." }),
        lesson("Миссия: свинг", "tour", [
            ["live", "hasClip", "Нужен клип с битом на этой дорожке: запиши его или возьми нарисованный в прошлом уроке."],
            ["manual", "", "В браузере слева открой раздел Grooves, найди любой Swing 16ths и перетащи его прямо на свой клип."],
            ["manual", "", "Запусти клип: каждая вторая шестнадцатая чуть опаздывает, и бит перестал быть машинным. Свинг это душа хип-хопа и хауса. Жми готово."]
        ], "Ровный бит звучит как машина. Свинг сдвигает ноты на волосок, и бит начинает качать.", { pts: 130, hint: "Этот урок проходят в тренажёре на дорожке барабанов." })
    ] },
    { id: "hands", title: "Две руки", need: 1200, lessons: [
        lesson("Бас и аккорд", "bass", "Am F C G Am F C G",
               "Левая берёт бас, правая аккорд. Звук сразу становится полным, как у целой группы.", {}),
        lesson("Бас и аккорд: C - G - Am - F", "bass", "C G Am F C G Am F",
               "Та же техника на другой прогрессии. Привыкай, что руки делают разное.", {}),
        lesson("Арпеджио: аккорд по одной ноте", "notes", "C4 E4 G4 C5 G4 E4 F4 A4 C5 F5 C5 A4 G4 B4 D5 G5 D5 B4 C4",
               "Арпеджио это аккорд, разложенный в мелодию. Любимый приём синтезаторной музыки.", { rhythm: 2 }),
        lesson("Бас держим, мелодия идёт", "hold", "C: E G A G | A: C E A E | F: A C F C | G: B D G D",
               "Одна рука держит ноту, другая играет. Это первый шаг к независимости рук.", {}),
        lesson("Аккорд левой, мелодия правой", "hold", "Am: C E A E | F: C F A F | C: E G C G | G: D G B G",
               "Так и играют на клавишах: слева гармония, справа мелодия.", {}),
        lesson("Аккорд правой, бас шагает", "walk", "C: C E G A | F: F A C D | G: G B D E | C: C G E C",
               "Теперь наоборот: правая держит, левая двигается. Шагающий бас оживляет аккорд.", {}),
        lesson("Миссия: вторая дорожка", "tour", [
            ["live", "newTrack", "Трек состоит из нескольких дорожек. Нажми Ctrl+Shift+T: появится новая MIDI-дорожка."],
            ["manual", "", "Перетащи на неё из браузера слева любой басовый звук: раздел Sounds, папка Bass."],
            ["manual", "", "Включи на новой дорожке запись (Arm) и запиши бас: по одной нижней ноте аккорда на такт. Жми готово."]
        ], "В треке каждая партия живёт на своей дорожке: аккорды, бас, барабаны, мелодия.", { pts: 150 })
    ] },
    { id: "scales", title: "Гаммы и лады", need: 1200, lessons: [
        lesson("До мажор вверх и вниз", "notes", scaleNotes("C", "major", 4),
               "Гамма это ноты тональности по порядку. Мелодии и соло собираются из гамм.", { rhythm: 2 }),
        lesson("Ля минор", "notes", scaleNotes("A", "minor", 3),
               "Те же белые клавиши, но от ля. Получается минор, грустный близнец до мажора.", { rhythm: 2, key: "Am" }),
        lesson("Мажорная пентатоника", "notes", scaleNotes("C", "pentaMajor", 4),
               "Пять нот, в которых нельзя ошибиться: любая звучит хорошо. С неё начинают импровизацию.", { rhythm: 2 }),
        lesson("Минорная пентатоника", "notes", scaleNotes("A", "pentaMinor", 3),
               "Главная гамма рока, блюза и хип-хопа. Запомни её как таблицу умножения.", { rhythm: 2, key: "Am" }),
        lesson("Блюзовая гамма", "notes", scaleNotes("A", "blues", 3),
               "Пентатоника плюс одна острая нота. Она даёт тот самый блюзовый привкус.", { rhythm: 2, key: "Am" }),
        lesson("Гармонический минор", "notes", scaleNotes("A", "harmonic", 3),
               "Минор с повышенной седьмой ступенью: восточная краска и сильная тяга к тонике.", { rhythm: 2, key: "Am" }),
        lesson("Соль мажор", "notes", scaleNotes("G", "major", 3),
               "Первая тональность с чёрной клавишей: фа-диез. На круге это следующий сектор.", { rhythm: 2, key: "G" }),
        lesson("Фа мажор", "notes", scaleNotes("F", "major", 3, true),
               "Тональность с одним бемолем: си-бемоль. На круге это шаг влево от C.", { rhythm: 2, key: "F" }),
        lesson("Дорийский лад", "notes", scaleNotes("D", "dorian", 4),
               "Минор со светлой шестой ступенью. На нём стоят фанк, хаус и многое у Daft Punk.", { rhythm: 2 }),
        lesson("Миксолидийский лад", "notes", scaleNotes("G", "mixolydian", 3),
               "Мажор с пониженной седьмой ступенью: звучит по-роковому и по-блюзовому.", { rhythm: 2 }),
        lesson("Лидийский лад", "notes", scaleNotes("F", "lydian", 3),
               "Мажор с повышенной четвёртой ступенью: мечтательная, космическая краска.", { rhythm: 2 }),
        lesson("Фригийский лад", "notes", scaleNotes("E", "phrygian", 4),
               "Минор с пониженной второй ступенью: тёмный испанский и техно-характер.", { rhythm: 2 }),
        lesson("Хроматическая гамма", "notes", scaleNotes("C", "chromatic", 4),
               "Все двенадцать клавиш подряд. Упражнение на беглость и на знание клавиатуры.", { rhythm: 4 }),
        lesson("Целотонная гамма", "notes", scaleNotes("C", "wholeTone", 4),
               "Шесть нот через тон: звук сна и невесомости, любимый приём в кино.", { rhythm: 2 }),
        lesson("Миссия: микшер", "tour", [
            ["live", "volumeMoved", "У каждой дорожки своя громкость. Подвигай первый фейдер на своей клавиатуре: он управляет дорожкой 1."],
            ["live", "sendUp", "На своей дорожке найди ручку Sends A и поверни вправо: звук уйдёт на общий ревербератор."],
            ["manual", "", "Баланс громкостей и немного эха это и есть сведение. Подбери громкость на слух и жми готово."]
        ], "Сведение это баланс: что громче, что тише, что дальше. Без него трек звучит кашей.", { pts: 150 })
    ] },
    { id: "studio", title: "Приёмы Ableton", need: 1000, lessons: [
        lesson("Миссия: сохрани и не теряй", "tour", [
            ["manual", "", "Несохранённый проект пропадает при сбое или перезагрузке. Нажми Ctrl+S, дай проекту имя и сохрани. Дальше нажимай Ctrl+S время от времени."],
            ["manual", "", "Теперь сделаем так, чтобы каждый новый проект открывался уже с твоими дорожками и тренажёром. Открой меню File и выбери Save Live Set as Default Set."],
            ["manual", "", "Звук инструмента сохраняют отдельно: значок дискеты в заголовке устройства. Он попадёт в User Library и будет под рукой в любом проекте. Жми готово."]
        ], "Три вида сохранения: проект, стартовый шаблон и отдельный звук. С ними ничего не придётся настраивать заново.", { pts: 120 }),
        lesson("Миссия: поймать сыгранное", "tour", tour(
            ["live", "armed", "Включи на дорожке кнопку записи (Arm), если она выключена."],
            many("chord", "Am F C G", "Просто поиграй. Запись не включена, и это не страшно."),
            ["live", "clipAdded", "Сыграл удачно, а запись не шла? Нажми Ctrl+Shift+C, это Capture MIDI: Ableton достанет из памяти то, что ты только что играл, и сделает клип."],
            ["manual", "", "Ableton всё время слушает включённые дорожки, так что хорошая идея не пропадёт. Кнопка Capture есть и вверху, рядом с записью. Жми готово."]
        ), "Лучшие идеи приходят, когда запись выключена. Capture достаёт их из памяти.", { pts: 140 }),
        lesson("Миссия: гамма под пальцами", "tour", [
            ["live", "scaleOn", "Вверху рядом с темпом есть кнопка Scale и название гаммы. Включи её: Ableton запомнит тональность трека."],
            ["manual", "", "Рядом выбери тонику A и гамму Minor. Открой любой клип с нотами: клавиши этой гаммы в редакторе подсвечены."],
            ["manual", "", "В редакторе нот включи кнопку Scale рядом с Fold: останутся только ноты гаммы, мимо уже не нарисуешь. Жми готово."]
        ], "Ableton умеет подсвечивать ноты гаммы и прятать чужие. С этим можно писать мелодии, ещё не зная теории наизусть.", { pts: 120 }),
        lesson("Миссия: запись сразу ровно", "tour", [
            ["live", "quantizeOn", "Открой меню Edit, пункт Record Quantization, и выбери Sixteenth-Note Quantization. Теперь сыгранные ноты сами встают на сетку."],
            ["live", "clipAdded", "Запиши новый клип в пустой ячейке: сыграй несколько нот под метроном и останови запись пробелом."],
            ["manual", "", "Открой клип: ноты стоят ровно, хотя ты играл как умеешь. Для живого звучания это отключают тем же пунктом меню. Жми готово."]
        ], "Запись с выравниванием прощает неточные пальцы. Удобно, пока рука ещё не набита.", { pts: 120 }),
        lesson("Автоматизация: ручка едет сама", "tour", [
            ["live", "clipPlaying", "Запусти на этой дорожке любой клип: пусть играет по кругу."],
            ["live", "automationArm", "Вверху рядом с кнопками записи включи Automation Arm. Не знаешь, какая это кнопка: наведи мышь, и внизу слева Ableton покажет название."],
            ["manual", "", "Нажми кружок записи вверху (Session Record) и медленно покрути фильтр синтезатора или ручку любого эффекта. Через пару тактов нажми кружок ещё раз."],
            ["live", "clipAutomation", "Движение ручки записалось в клип. Запусти его снова: ручка едет сама, а рядом с ней появилась красная точка."],
            ["manual", "", "Автоматизация оживляет трек: фильтр открывается к припеву, эхо растёт в конце фразы. Нарисовать её можно и мышью, во вкладке Envelopes клипа. Жми готово."]
        ], "Трек, в котором ничего не меняется, надоедает за минуту. Автоматизация двигает ручки за тебя по ходу музыки.", { pts: 170 }),
        lesson("Rack и макросы: свой пульт", "tour", [
            ["live", "device:InstrumentGroupDevice", "Щёлкни по заголовку своего инструмента и нажми Ctrl+G. Он завернётся в Rack: контейнер, который хранит инструмент вместе с его эффектами."],
            ["manual", "", "Слева у Rack включи кнопку Macro: появятся ручки. Щёлкни правой кнопкой мыши по фильтру инструмента и выбери Map to Macro 1."],
            ["live", "knob:InstrumentGroupDevice:Macro 1:moved", "Щёлкни по заголовку Rack и покрути энкодер K1: теперь это твоя личная ручка. На одну макроручку можно повесить сразу несколько параметров."],
            ["manual", "", "Сохрани Rack значком дискеты: получится свой пресет с пультом под пальцами. Жми готово."]
        ], "Rack собирает инструмент, эффекты и восемь главных ручек в один пресет. Так устроены почти все звуки из библиотеки.", { pts: 150 }),
        lesson("Сайдчейн: звук дышит под бочку", "tour", [
            ["live", "device:Compressor2", "Сайдчейн это когда один звук приглушает другой. Поставь Compressor на эту дорожку, с басом или пэдом."],
            ["live", "knob:Compressor2:S/C On:on", "Нажми треугольник в левом углу заголовка Compressor: откроется боковая панель. Включи в ней кнопку Sidechain."],
            ["manual", "", "В списке Audio From выбери дорожку с барабанами. Теперь компрессор слушает барабаны, а прижимает твой звук."],
            ["live", "knob:Compressor2:Threshold:down", "Запусти клип с барабанами и опускай Threshold, пока твой звук не начнёт нырять на каждый удар бочки."],
            ["manual", "", "Это знаменитая качка хауса и фьюче-бейса: бочка пробивает себе место, всё остальное дышит вокруг неё. Жми готово."]
        ], "Сайдчейн освобождает место для бочки и заставляет весь трек качаться в такт.", { pts: 180 }),
        lesson("Simpler: инструмент из любого звука", "tour", tour(
            ["manual", "", "Сейчас инструмент на дорожке сменится. Если нынешний звук жалко, сохрани его значком дискеты в заголовке."],
            ["live", "device:OriginalSimpler", "Перетащи на дорожку любой звук из раздела Samples в браузере. Ableton поставит Simpler: инструмент, который играет звуковой файл клавишами."],
            many("note", "C4 E4 G4", "Сыграй ноты: один и тот же звук идёт выше и ниже. Так любой шум, голос или стук становится инструментом."),
            ["live", "simplerMode:2", "Слева у Simpler три режима. Выбери Slice: файл порежется на кусочки, и каждый ляжет на свою клавишу."],
            ["manual", "", "Нажимай клавиши подряд, начиная с нижних: это кусочки файла по порядку. Так режут барабанные брейки и старые пластинки. Жми готово."]
        ), "Сэмплер превращает любую запись в инструмент. На нём выросли хип-хоп, джангл и хаус.", { pts: 150 }),
        lesson("Миссия: экспорт трека", "tour", [
            ["live", "arrangement", "Готовый трек живёт в аранжировке. Нажми Tab, чтобы открыть её."],
            ["live", "loopOn", "Выдели мышью кусок на ленте времени и нажми Ctrl+L: Ableton будет играть только его по кругу. Удобно, когда работаешь над одной частью."],
            ["manual", "", "Теперь выдели всю песню от начала до конца и нажми Ctrl+Shift+R: откроется окно экспорта."],
            ["manual", "", "Оставь формат WAV и нажми Export. Получится файл, который можно слушать где угодно и показывать друзьям. Жми готово."],
            ["live", "session", "Tab возвращает к клипам."]
        ], "Трек не закончен, пока его нельзя включить без Ableton. Экспорт превращает проект в обычный звуковой файл.", { pts: 150 })
    ] },
    { id: "harmony", title: "Гармония", need: 2000, lessons: [
        lesson("Септаккорды тональности", "chords", "Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Cmaj7",
               "Добавь к аккорду четвёртую ноту, и он звучит богаче. На септаккордах стоят джаз, соул, лоу-фай.", {}),
        lesson("Оборот ii - V - I", "chords", "Dm7 G7 Cmaj7 Dm7 G7 Cmaj7 Dm7 G7 Cmaj7",
               "Главный оборот джаза: подготовка, напряжение, разрешение. Он встречается повсюду.", {}),
        lesson("Аккорды sus", "chords", "Csus4 C Gsus4 G Asus2 Am Fsus2 F",
               "В sus-аккорде терция заменена соседней нотой: звук висит и просит разрешения.", {}),
        lesson("Уменьшённый и увеличенный", "chords", "C Caug F Bdim C Caug Am Bdim C",
               "Два острых аккорда для напряжения. Их ставят на миг, как специю.", {}),
        lesson("Шестые и add9", "chords", "Cadd9 G6 Am7 Fmaj7 Cadd9 G6 Am7 Fmaj7",
               "Мягкие краски для красивых аккордов: одна добавленная нота меняет всё настроение.", {}),
        lesson("Минор и доминанта E7", "chords", "Am Dm E7 Am Am F E7 Am",
               "В миноре пятую ступень делают мажорной, E7: она сильнее тянет домой, к Am.", { key: "Am" }),
        lesson("Блюз на септаккордах", "chords", "C7 C7 C7 C7 F7 F7 C7 C7 G7 F7 C7 G7",
               "Тот же блюз, но с септаккордами: вот теперь он звучит по-настоящему.", {}),
        lesson("Побочные доминанты", "chords", "C A7 Dm G7 C E7 Am D7 G7 C",
               "Перед любым аккордом можно поставить его собственную доминанту. Гармония оживает.", {}),
        lesson("Миссия: наложение партий", "tour", [
            ["live", "clipPlaying", "Запусти свой клип с аккордами: пусть играет по кругу."],
            ["manual", "", "Вверху включи кнопку наложения MIDI (значок плюса рядом с записью) и доиграй поверх мелодию."],
            ["manual", "", "Так слой за слоем и строят партию. Лишнее отменяет Ctrl+Z. Жми готово."]
        ], "Наложение позволяет собрать сложную партию из простых слоёв, по одному за раз.", { pts: 150 })
    ] },
    { id: "dance", title: "Жанры: танцпол", need: 600, shelf: true, lessons: [
        lesson("Хаус: паспорт жанра", "tour", tour(
            ["live", "tempo:120:128", "Хаус родился в клубах Чикаго. Его темп от 120 до 128 ударов в минуту: поставь 124."],
            many("chord", "Am7 Dm7 G7 Cmaj7", "Гармония хауса это септаккорды из соула и диско. Бери их коротко и отрывисто, как удары."),
            many("note", "A3 A3 C4 A3 D3 D3 F3 D3", "Бас играет между ударами бочки, на счёт и. Сыграй линию коротко и упруго."),
            ["manual", "", "Рецепт: бочка на каждую долю, клэп на 2 и 4, открытый хэт между бочками, короткие аккорды и сайдчейн от бочки. Бит разучи в соседнем уроке на пэдах. Жми готово."]
        ), "Хаус это прямая бочка, тёплые аккорды и грув, под который невозможно стоять на месте.", { pts: 160 }),
        lesson("Хаус: бит", "drums", "KH H O H KC H O H KH H O H KC H O H",
               "Бочка на каждую долю, клэп на вторую и четвёртую, открытый хэт точно между бочками. Шестнадцатые хэта дают движение.", { rhythm: 4 }),
        lesson("Техно: паспорт жанра", "tour", tour(
            ["live", "tempo:128:140", "Техно пришло из Детройта и Берлина: оно быстрее и суровее хауса. Поставь темп от 128 до 140."],
            many("note", "E3 E3 F3 E3 E3 G3 E3 F3", "В техно почти нет аккордов, есть риф из двух или трёх нот. Здесь фригийский лад: мрачный полутон между E и F."),
            ["manual", "", "Главный герой техно это фильтр: один и тот же риф минутами меняется только ручками Freq и Res. Покрути их, играя риф, и жми готово."],
            ["manual", "", "Рецепт: тяжёлая бочка на каждую долю, хэт между бочками, гул ревера под бочкой, один гипнотичный риф и медленное движение фильтра. Жми готово."]
        ), "Техно это гипноз: минимум нот, максимум звука. Меняется не мелодия, а тембр.", { pts: 150 }),
        lesson("Техно: бит", "drums", "K H O H K R O H K H O R K H O T",
               "Прямая бочка, открытый хэт между ударами и сухие щелчки рима в неожиданных местах. Том в конце закрывает круг.", { rhythm: 4 }),
        lesson("Драм-н-бейс: паспорт жанра", "tour", tour(
            ["live", "tempo:170:176", "Драм-н-бейс вырос из британского джангла. Темп от 170 до 176: барабаны летят, а бас и аккорды идут вдвое медленнее. Поставь 174."],
            many("chord", "Am7 Fmaj7 Dm7 Em7", "В мелодичном драм-н-бейсе над быстрым битом плывут длинные мягкие аккорды. Держи каждый подольше."),
            many("note", "A3 A3 G3 A3 C4 A3 E3 G3", "Бас низкий и певучий. В жёстких стилях его делают из двух расстроенных пил с прикрытым фильтром: это риз-бас."),
            ["manual", "", "Рецепт: бочка на 1, снейр на 2 и 4, между ними вторая бочка со сдвигом, быстрые хэты. Бит ломаный, а не прямой. Разучи его в соседнем уроке. Жми готово."]
        ), "Драм-н-бейс это скорость барабанов и глубина баса. Между ними много воздуха.", { pts: 160 }),
        lesson("Драм-н-бейс: бит", "drums", "KH H SH H H KH SH H KH H SH KH H KH SH H",
               "Тустеп: бочка, снейр, сдвинутая бочка, снейр. На темпе 174 этот рисунок превращается в полёт.", { rhythm: 2 }),
        lesson("Дабстеп: паспорт жанра", "tour", tour(
            ["live", "tempo:138:142", "Дабстеп пришёл из Лондона. Темп 140, но бит считают вдвое медленнее: бочка на 1, снейр на 3. Поставь 140."],
            ["manual", "", "Знак жанра это воббл: бас, у которого фильтр качается от LFO в ритм. В Drift выбери в разделе Freq Mod источник LFO, а сам LFO переключи в режим Sync. Попробуй и жми готово."],
            many("note", "E3 E3 G3 E3 F3 E3 D3 E3", "Бас играет длинные низкие ноты, а воббл рубит их на куски. Сыграй линию, держа каждую ноту подольше."),
            ["manual", "", "Рецепт: бит вполовину темпа, огромный снейр с ревером на 3, паузы и качающийся бас. Простор важнее количества нот. Жми готово."]
        ), "Дабстеп это бас, который разговаривает, и тишина, которая бьёт сильнее нот.", { pts: 160 }),
        lesson("Дабстеп: бит", "drums", "KH H H KH SH H H H KH H H H SH H H KH",
               "Бит вполовину темпа: снейр падает редко и тяжело. Всё место между ударами отдано басу.", { rhythm: 2 }),
        lesson("Гэридж: паспорт жанра", "tour", tour(
            ["live", "tempo:128:136", "Гэридж родом из Лондона девяностых. Темп от 128 до 136: поставь 132."],
            many("chord", "Fmaj7 Em7 Am7 G6", "Аккорды соула, сыгранные коротко и вразбивку, часто на органе или электропиано."),
            many("note", "A3 C4 A3 E3 G3 A3 C4 D4", "Бас прыгучий и упругий, он играет вокруг бочки, а не вместе с ней."),
            ["manual", "", "Рецепт: бочка на 1 и со сдвигом перед 3, клэп на 2 и 4, хэты со свингом, нарезанный вокал. Бит не прямой, он спотыкается и этим качает. Жми готово."]
        ), "Гэридж это свинг и прыгучий бас: танцевальная музыка, которая не марширует, а пританцовывает.", { pts: 160 }),
        lesson("Гэридж: бит", "drums", "KH H CH H H KH CH H KH H CH KH H H CH H",
               "Бочка стоит не там, где её ждёшь, а клэп держит счёт. Играй с лёгким свингом, чуть оттягивая каждый второй хэт.", { rhythm: 2 })
    ] },
    { id: "beats", title: "Жанры: бит", need: 600, shelf: true, lessons: [
        lesson("Бум-бэп: паспорт жанра", "tour", tour(
            ["live", "tempo:85:95", "Бум-бэп это классический хип-хоп Нью-Йорка девяностых. Темп от 85 до 95: поставь 90."],
            many("chord", "Dm7 G7 Cmaj7 Am7", "Гармонию брали с джазовых и соул-пластинок, отсюда септаккорды. Играй лениво, чуть позади бита."),
            many("note", "D3 D3 G3 G3 C3 C3 A3 A3", "Бас простой и круглый, он повторяет нижние ноты аккордов."),
            ["manual", "", "Рецепт: бум это бочка, бэп это снейр. Барабаны с пластинок, свинг на хэтах, пара аккордов по кругу и много места для голоса. Жми готово."]
        ), "Бум-бэп это качающий бит и кусочек старой пластинки. С него начался весь хип-хоп.", { pts: 160 }),
        lesson("Бум-бэп: бит", "drums", "KH H SH KH H KH SH H KH H SH H KH KH SH H",
               "Бочка стоит не на ровных долях, а чуть раньше или позже. От этого бит кивает головой.", { rhythm: 2 }),
        lesson("Трэп: паспорт жанра", "tour", tour(
            ["live", "tempo:130:150", "Трэп пришёл из Атланты. Темп ставят от 130 до 150, а бочку и снейр считают вдвое медленнее. Поставь 140."],
            many("note", "A4 C5 E5 C5 B4 C5 A4 E4", "Мелодия тёмная, минорная и короткая, её крутят по кругу. Сыграй её в верхней части клавиатуры."),
            many("note", "A3 A3 F3 F3 D3 D3 E3 E3", "Бас в трэпе это 808: бочка с длинным хвостом, которую играют нотами. Сыграй линию внизу длинными нотами."),
            ["manual", "", "Рецепт: длинный бас 808, хлёсткий снейр или клэп на 3, быстрые хэты с дробями, мрачная мелодия. Скольжение баса даёт ручка Glide. Жми готово."]
        ), "Трэп это бас 808, сыплющиеся хэты и мрачная мелодия из нескольких нот.", { pts: 160, key: "Am" }),
        lesson("Трэп: бит", "drums", "KH H H KH SH H H H H KH H H SH H KH H",
               "Хэты идут шестнадцатыми без остановки, снейр падает редко, бочка появляется там, где её не ждёшь.", { rhythm: 4 }),
        lesson("Лоу-фай: паспорт жанра", "tour", tour(
            ["live", "tempo:70:90", "Лоу-фай хип-хоп это музыка для учёбы и дождя за окном. Темп от 70 до 90: поставь 80."],
            many("chord", "Fmaj7 Em7 Dm7 Cmaj7", "Мягкие септаккорды идут вниз по ступенькам. Играй тихо и чуть неровно: здесь это достоинство."),
            ["live", "device:Redux2,Vinyl,Erosion2,Erosion", "Звук нарочно старят. Поставь на дорожку Redux или Vinyl Distortion из Audio Effects и слегка прибавь: появится пыль старой кассеты."],
            ["manual", "", "Рецепт: тёплое электропиано, прикрытый фильтр, шум пластинки, ленивые барабаны со свингом и никакой спешки. Жми готово."]
        ), "Лоу-фай это уют несовершенства: пыль, шорох и аккорды, которые никуда не торопятся.", { pts: 160 }),
        lesson("Лоу-фай: бит", "drums", "KH H SH H H KH SH H KH KH SH H H H SH H",
               "Тот же хип-хоп, только сонный. Играй мягко и чуть позади счёта, будто бит зевает.", { rhythm: 2 }),
        lesson("Фонк: паспорт жанра", "tour", tour(
            ["live", "tempo:130:160", "Фонк вырос из мемфисского рэпа девяностых, а дрифт-фонк разошёлся по миру из России. Темп от 130 до 160: поставь 140."],
            many("note", "A4 A4 C5 A4 E5 D5 C5 A4", "Визитная карточка это мелодия на ковбелле: звонкий короткий звук, минор, ноты рядом. Сыграй её коротко и резко."),
            ["live", "device:Saturator,Roar,Overdrive,Pedal", "Бас и бочку в фонке перегружают до хрипа. Поставь на дорожку Saturator из Audio Effects и прибавь Drive."],
            ["manual", "", "Рецепт: мелодия ковбелла, перегруженный бас 808, прямая бочка, быстрые хэты и хлопок. Ковбелл найдёшь в наборах 808 в разделе Drums. Жми готово."]
        ), "Фонк это ковбелл, перегруз и скорость. Музыка ночных дорог и коротких видео.", { pts: 160, key: "Am" }),
        lesson("Фонк: бит", "drums", "KH H KC H KH H KC H KH H KC H KH KH KC H",
               "Прямая бочка, как в хаусе, но с хлопком и злостью. Играй жёстко и ровно.", { rhythm: 2 }),
        lesson("Дрилл: паспорт жанра", "tour", tour(
            ["live", "tempo:138:144", "Дрилл вырос в Чикаго и заново родился в Лондоне. Темп около 140: поставь 142."],
            many("note", "A4 C5 B4 A4 E5 D5 C5 B4", "Мелодия холодная и тревожная, в миноре, часто на пианино или струнных."),
            many("note", "A3 A3 E3 A3 G3 G3 F3 E3", "Главный знак жанра это скользящий бас 808: ноты съезжают одна в другую. Сыграй линию, а скольжение даст ручка Glide."),
            ["manual", "", "Рецепт: скользящий бас 808, хэты тройками, снейр не на 3, а чуть позже, мрачная мелодия. От трэпа дрилл отличают ритм хэтов и съезжающий бас. Жми готово."]
        ), "Дрилл это холодная мелодия и бас, который скользит между нотами.", { pts: 160, key: "Am" }),
        lesson("Дрилл: бит", "drums", "KH H H KH H H SH H KH H H KH H SH H H",
               "Хэты и бочка группируются по три, три и два. От этого бит звучит как ломаный шаг.", { rhythm: 4 })
    ] },
    { id: "synths", title: "Жанры: синты", need: 600, shelf: true, lessons: [
        lesson("Синтвейв: паспорт жанра", "tour", tour(
            ["live", "tempo:80:118", "Синтвейв это ностальгия по восьмидесятым: неон, закат, видеокассеты. Темп от 80 до 118: поставь 100."],
            many("chord", "Am F C G", "Простые большие аккорды на широком пэде с хорусом. Держи каждый по такту."),
            many("note", "A3 A3 A3 A3 F3 F3 F3 F3", "Бас стучит ровными восьмыми на одной ноте и меняется вместе с аккордом. Играй как мотор."),
            ["manual", "", "Рецепт: бас восьмыми, арпеджио поверх, пэд с хорусом, снейр с большим ревером, мелодия на ярком лиде. Арпеджиатор и хорус ты уже знаешь. Жми готово."]
        ), "Синтвейв это кино, которого не было: простые аккорды, пульсирующий бас и много ревера.", { pts: 160 }),
        lesson("Синтвейв: бит", "drums", "KH H SH H KH KH SH H KH H SH H KH KH SH T",
               "Простой уверенный бит из восьмидесятых: бочка, большой снейр, ровные хэты и том в конце фразы.", { rhythm: 2 }),
        lesson("Фьюче-бейс: паспорт жанра", "tour", tour(
            ["live", "tempo:140:160", "Фьюче-бейс это яркие аккорды, которые дышат и пульсируют. Темп от 140 до 160, а бит идёт вполовину: поставь 150."],
            many("chord", "Fmaj7 G6 Am7 Em7", "Аккорды богатые и светлые, на широкой суперпиле. Бери их всеми пальцами."),
            ["manual", "", "Главный приём это пульсация: громкость аккордов качает LFO или сайдчейн от бочки. В Drift в блоке Mod назначь LFO на Main Volume, а LFO переключи в Sync. Попробуй и жми готово."],
            ["manual", "", "Рецепт: суперпила с юнисоном, качающаяся громкость, снейр на 3, звонкие вставки и долгий подъём перед кульминацией. Жми готово."]
        ), "Фьюче-бейс это большие аккорды, которые качаются, как волны.", { pts: 160 }),
        lesson("Фьюче-бейс: бит", "drums", "KH H H H SH H KH H KH H H KH SH H H H",
               "Бит вполовину темпа с прыгучей бочкой: снейр редкий, а бочка подталкивает аккорды.", { rhythm: 2 }),
        lesson("Транс: паспорт жанра", "tour", tour(
            ["live", "tempo:136:142", "Транс это подъём и эйфория: долгие нарастания и мелодия, которую поёт весь зал. Темп от 136 до 142: поставь 138."],
            many("chord", "Am F C G", "Гармония простая и торжественная. Сначала возьми аккорды целиком."),
            many("note", "A4 C5 E5 A5 E5 C5 F4 A4 C5 F5 C5 A4", "Теперь те же аккорды по одной ноте: такое арпеджио это мотор транса. Играй ровно, как машина."),
            ["manual", "", "Рецепт: прямая бочка, бас между ударами, арпеджио или плак с эхом, суперпила в кульминации и фильтр, который открывается весь подъём. Жми готово."]
        ), "Транс это долгая дорога вверх: арпеджио, нарастание и взрыв мелодии.", { pts: 160 }),
        lesson("Транс: бит", "drums", "KH O KC O KH O KC O KH O KC O KH S KC S",
               "Прямая бочка с открытым хэтом между ударами, как в хаусе, только быстрее. В конце снейр ведёт к следующему кругу.", { rhythm: 2 }),
        lesson("Эмбиент: паспорт жанра", "tour", tour(
            ["live", "tempo:60:90", "Эмбиент это музыка как пейзаж: без бита и без спешки. Темп тут почти не слышен, поставь от 60 до 90."],
            many("chord", "Csus2 Fmaj7 Am7 Gsus4", "Аккорды открытые и неопределённые, каждый звучит долго. Держи аккорд, пока не захочется сменить."),
            ["live", "device:Reverb,Hybrid", "Пространство тут главный инструмент. Поставь на дорожку Reverb, прибавь Decay Time почти до упора и Dry/Wet больше половины."],
            ["manual", "", "Рецепт: медленная атака и длинный хвост, огромный ревер и эхо, мало нот и много воздуха. Слушай тишину между звуками. Жми готово."]
        ), "Эмбиент учит главному: звук и пространство важнее количества нот.", { pts: 150 }),
        lesson("Чиптюн: паспорт жанра", "tour", tour(
            ["live", "tempo:120:160", "Чиптюн это музыка игровых приставок восьмидесятых. Темп бодрый, от 120 до 160: поставь 140."],
            ["manual", "", "Звук простой: в Drift выбери волну Pulse или Rectangle, открой фильтр полностью и убери Release. Получится писк старой приставки. Сделай и жми готово."],
            many("note", "C5 E5 G5 C5 E5 G5 A4 C5 E5 A4 C5 E5", "У приставок было мало голосов, поэтому аккорды играли быстрым арпеджио. Сыграй два аккорда как можно ровнее."),
            ["manual", "", "Рецепт: прямоугольная волна, быстрые арпеджио вместо аккордов, простой бас, шум вместо барабанов. Redux добавит хруста. Жми готово."]
        ), "Чиптюн учит обходиться малым: три голоса и шум, а мелодия запоминается на всю жизнь.", { pts: 160 }),
        lesson("Чиптюн: бит", "drums", "K H S H K K S H K H S H K S S S",
               "Барабаны приставки это щелчки и шум. Рисунок простой и быстрый, с дробью в конце.", { rhythm: 4 })
    ] },
    { id: "circle", title: "Круг квинт", need: 3000, lessons: [
        lesson("Круг квинт по часовой", "chords", "C G D A E B F# Db Ab Eb Bb F C",
               "Каждый шаг по кругу это квинта вверх и одна новая чёрная клавиша. Так устроены все тональности.", {}),
        lesson("Круг кварт против часовой", "chords", "C F Bb Eb Ab Db F# B E A D G C",
               "В обратную сторону идут кварты. Так движутся аккорды в джазе и соуле.", {}),
        lesson("Минорный круг", "chords", "Am Em Bm F#m C#m G#m D#m Bbm Fm Cm Gm Dm Am",
               "Внутреннее кольцо это минорные тональности. У каждой есть мажорная пара снаружи.", {}),
        lesson("Тональность соль мажор", "chords", "G C D Em Am Bm G D Em C",
               "Сдвинься на сектор вправо, и шесть рабочих аккордов сдвинутся вместе с тобой.", { key: "G" }),
        lesson("Тональность фа мажор", "chords", "F Bb C Dm Gm Am F C Dm Bb",
               "Сектор влево от C. Те же отношения между аккордами, другая высота.", { key: "F" }),
        lesson("Тональность ре мажор", "chords", "D G A Bm Em F#m D A Bm G",
               "Два сектора вправо: два диеза. Любимая тональность гитаристов и танцевальных треков.", { key: "D" }),
        lesson("Тональность ми минор", "chords", "Em C G D Em Am B7 Em",
               "Минорная пара соль мажора. Те же аккорды, но центр теперь Em.", { key: "Em" }),
        lesson("Одна прогрессия, четыре тональности", "chords", "C G Am F G D Em C D A Bm G F C Dm Bb",
               "Перенос в другую тональность называется транспонированием. Так подстраивают песню под голос.", {}),
        lesson("ii - V - I по кругу кварт", "chords", "Dm7 G7 Cmaj7 Cm7 F7 Bbmaj7 Bbm7 Eb7 Abmaj7",
               "Каждый оборот приводит в новую тональность на шаг против часовой. Это модуляция.", {}),
        lesson("Модуляция через общий аккорд", "chords", "C Am D7 G G Em A7 D",
               "Аккорд, общий для двух тональностей, служит дверью из одной в другую.", {}),
        lesson("Миссия: аранжировка", "tour", [
            ["live", "arrangement", "Нажми Tab: откроется вид аранжировки. Это лента времени, на ней трек идёт слева направо."],
            ["live", "recordOn", "Нажми кнопку записи вверху (большой кружок): Ableton запишет всё, что ты запускаешь."],
            ["live", "stopped", "Запускай клипы один за другим, как диджей, потом нажми пробел. Трек записан на ленту."],
            ["live", "session", "Tab возвращает к клипам. Аранжировка это готовая песня, клипы это заготовки."]
        ], "В аранжировке клипы превращаются в песню: вступление, развитие, кульминация, финал.", { pts: 180 })
    ] },
    { id: "poly", title: "Полифония", need: 4200, lessons: [
        lesson("Параллельные терции", "notes", "C4+E4 D4+F4 E4+G4 F4+A4 G4+B4 A4+C5 B4+D5 C5+E5",
               "Два голоса идут вместе на расстоянии терции. Так поют дуэтом.", { rhythm: 2 }),
        lesson("Параллельные сексты", "notes", "E4+C5 F4+D5 G4+E5 A4+F5 G4+E5 F4+D5 E4+C5",
               "Секста это перевёрнутая терция: звучит шире и теплее. Нижняя нота написана первой.", { rhythm: 2 }),
        lesson("Противоположное движение", "notes", "C4+C5 B3+D5 A3+E5 G3+F5 A3+E5 B3+D5 C4+C5",
               "Голоса расходятся в разные стороны. Это основа полифонии: каждый голос живёт сам.", {}),
        lesson("Педаль: бас стоит, мелодия поёт", "hold", "C: E F G A G F E D | C: E G C G E D E C",
               "Длинная нота в басу называется педалью. Над ней мелодия свободно гуляет.", {}),
        lesson("Аккорд и мелодия с проходящими", "hold", "Am: E D C D | F: C D C A | C: G F E D | G: D E D B",
               "Между нотами аккорда вставляют проходящие ноты, и мелодия становится плавной.", {}),
        lesson("Шагающий бас под аккордом", "walk", "Am: A C E G | Dm: D F A C | G: G B D F | C: C E G B",
               "Бас проходит по нотам аккорда, как в джазе. Левая рука играет свою мелодию.", {}),
        lesson("Хорал на четыре голоса", "chords", "C G/B Am Em/G F C/E Dm7 G C",
               "Каждая нота аккорда это отдельный голос. Следи, чтобы они двигались плавно.", { hint: "Буква после черты это нижняя нота. Меняй аккорд, двигая пальцы как можно меньше." }),
        lesson("Миссия: эффекты", "tour", [
            ["live", "deviceAdded", "Из браузера слева, раздел Audio Effects, перетащи на свою дорожку Reverb или Delay."],
            ["manual", "", "Покрути энкодеры на клавиатуре: они управляют параметрами выбранного устройства."],
            ["manual", "", "Эффекты это краски звука. Найди настройку, которая тебе нравится, и жми готово."]
        ], "Эффекты превращают сухой звук в пространство. Половина характера трека в них.", { pts: 150 })
    ] },
    { id: "virtuoso", title: "Виртуоз", need: 5500, lessons: [
        lesson("Арпеджио через две октавы", "notes", "C3 E3 G3 C4 E4 G4 C5 G4 E4 C4 G3 E3 C3",
               "Широкие арпеджио требуют переноса руки. Это уже концертная техника.", { rhythm: 2 }),
        lesson("Арпеджио септаккордов", "notes", "C4 E4 G4 B4 D4 F4 A4 C5 G3 B3 D4 F4 C4 E4 G4 B4 C5",
               "Разложенные септаккорды это язык джазовых соло и синтезаторных секвенций.", { rhythm: 2 }),
        lesson("Джазовые нонаккорды", "chords", "Dm9 G9 Cmaj9 A7 Dm9 G9 Cmaj9",
               "Пять нот в аккорде: играй двумя руками. Так звучат нео-соул и лоу-фай.", {}),
        lesson("Тритоновая замена", "chords", "Dm7 Db7 Cmaj7 Dm7 G7 Cmaj7 Dm7 Db7 Cmaj7",
               "Доминанту можно заменить аккордом через тритон. Бас красиво съезжает по полутонам.", {}),
        lesson("ii - V - I во всех тональностях", "chords", "Dm7 G7 Cmaj7 Gm7 C7 Fmaj7 Cm7 F7 Bbmaj7 Fm7 Bb7 Ebmaj7 Bbm7 Eb7 Abmaj7 Am7 D7 Gmaj7",
               "Свободно играть оборот в любой тональности значит свободно читать любую песню.", {}),
        lesson("Полиритмия три на два", "drums", "KH H K H KH H K H KH H K H",
               "Одна рука считает до двух, другая до трёх. Мозг сопротивляется, потом щёлкает.", { hint: "Бочка и хэт начинают вместе. Дальше считай вслух: раз, два-и, три." }),
        lesson("Быстрые хэты и бочка", "drums", "KH H H KH H H SH H H H KH H SH H KH H",
               "Сложный рисунок бочки под ровные шестнадцатые хэта. Так играют драм-н-бейс.", { rhythm: 4 }),
        lesson("Бас, аккорд и мелодия", "hold", "Am7: E G A C | Dm7: F A C D | G7: D F G B | Cmaj7: E G B C",
               "Левая держит септаккорд, правая ведёт мелодию по его нотам. Полная фактура одного музыканта.", {}),
        lesson("Миссия: свой трек", "tour", [
            ["manual", "", "Собери луп на 8 тактов: барабаны, бас, аккорды, мелодия. Каждая партия на своей дорожке."],
            ["live", "arrangement", "Открой аранжировку (Tab) и разложи клипы во времени: вступление, основная часть, финал."],
            ["manual", "", "Сохрани проект: Ctrl+S. Это твой первый трек, сделанный целиком своими руками. Жми готово."]
        ], "Итог пути: применить всё сразу и довести свою музыку до конца.", { pts: 300 })
    ] }
];

// ----------------------------------------------------------------- courses

// A course is forty lessons of one kind. Every lesson is fixed, the same
// today and tomorrow, and a little harder than the one before. Five lessons
// make a tier with its own theme. A course is a stage like any other: PATH
// puts it right after the stage that introduces its subject.

// A private source of chance, so that lesson 17 of a course is always the
// same lesson.
function makeDice(seed) {
    var state = seed % 2147483646 + 1;
    function next(n) {
        state = (state * 16807) % 2147483647;
        return state % n;
    }
    next(2);
    next(2);
    next(2);
    return next;
}

// Places in a list of "size" items: every next one is at most "leap" away.
function walk(dice, size, count, leap, start) {
    var out = [];
    var at = start;
    while (out.length < count) {
        out.push(at);
        var next = at;
        while (next === at) {
            next = at + dice(2 * leap + 1) - leap;
            if (next < 0 || next >= size) {
                next = at;
            }
        }
        at = next;
    }
    return out;
}

function namesAt(pool, places) {
    return places.map(function (place) { return pool[place]; }).join(" ");
}

function twice(text) {
    return text + " " + text;
}

// White keys over an octave and a half, so a line has somewhere to go.
var LONG_WHITE = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5", "E5", "F5", "G5"];

// A third, a fifth... of C major as two keys at once; size counts white keys.
function pairAt(low, size) {
    var high = low + size;
    return WHITE_NOTES[low % 7] + (4 + Math.floor(low / 7)) + "+" + WHITE_NOTES[high % 7] + (4 + Math.floor(high / 7));
}

// The notes of a chord as names, for melodies and bass lines over it.
function tonesOf(symbol) {
    return parseChord(symbol).pcs.map(function (pc) { return NOTE_NAMES[pc]; });
}

// The three positions of a triad: root, third or fifth in the bass.
function positions(symbol, flats) {
    var pcs = parseChord(symbol).pcs;
    var names = flats ? NOTE_FLAT : NOTE_NAMES;
    return [symbol, symbol + "/" + names[pcs[1]], symbol + "/" + names[pcs[2]]];
}

function allPositions(chords, flats) {
    var out = [];
    for (var i = 0; i < chords.length; i++) {
        out = out.concat(positions(chords[i], flats));
    }
    return out;
}

// A progression written in degrees, as the chords of a key.
function inKey(index, pattern, sevenths) {
    var chords = keyChords(index);
    return words(pattern).map(function (degree) {
        var name = chords[degree];
        if (!sevenths) {
            return name;
        }
        return name + (degree === "V" ? "7" : (degree === "I" || degree === "IV" ? "maj7" : "7"));
    }).join(" ");
}

function sixOf(index) {
    var chords = keyChords(index);
    return [chords.I, chords.ii, chords.iii, chords.IV, chords.V, chords.vi];
}

// name, why: eight tiers of five lessons
var NOTE_TIERS = [
    ["три клавиши", "До, ре и ми: три соседние белые клавиши. С них начинается вся клавиатура."],
    ["пять клавиш", "Пять клавиш под пятью пальцами. Рука стоит на месте, пальцы учатся работать по очереди."],
    ["вся октава", "Все семь белых клавиш. Дальше они только повторяются выше и ниже."],
    ["скачки", "Мелодии редко идут по соседним клавишам. Учимся прыгать через одну, две и три."],
    ["вразбивку", "Ноты в случайном порядке. Рука должна находить любую клавишу сразу, без счёта от до."],
    ["ломаные терции", "Вперёд через одну, шаг назад и снова вперёд. Классическое упражнение пианистов на ровность."],
    ["арпеджио", "Аккорды, разложенные по одной ноте. На арпеджио держится половина электронной музыки."],
    ["длинная фраза", "Длинные линии со скачками. Задача: доиграть до конца ровно и без единой ошибки."]
];

function makeNotes(tier, step, dice) {
    var data;
    var k;
    if (tier === 0) {
        data = namesAt(["C", "D", "E"], walk(dice, 3, 8 + step, 1, 0));
    } else if (tier === 1) {
        data = namesAt(["C", "D", "E", "F", "G"], walk(dice, 5, 10 + step, 2, 0));
    } else if (tier === 2) {
        data = namesAt(WHITE_NOTES, walk(dice, 7, 12 + step, 2, 0));
    } else if (tier === 3) {
        data = namesAt(LONG_WHITE, walk(dice, 12, 12 + step, 4, step));
    } else if (tier === 4) {
        data = pickMany(WHITE_NOTES, 14 + step, dice).join(" ");
    } else if (tier === 5) {
        var up = [], down = [];
        for (k = 0; k < 5; k++) {
            up.push(LONG_WHITE[step + k], LONG_WHITE[step + k + 2]);
            down.unshift(LONG_WHITE[step + k + 2], LONG_WHITE[step + k]);
        }
        data = up.concat(down).join(" ");
    } else if (tier === 6) {
        var roots = pickMany([0, 3, 4, 5, 1, 2, 7], 4, dice);
        var line = [];
        for (k = 0; k < roots.length; k++) {
            line.push(LONG_WHITE[roots[k]], LONG_WHITE[roots[k] + 2], LONG_WHITE[roots[k] + 4], LONG_WHITE[roots[k] + 2]);
        }
        data = line.join(" ");
    } else {
        data = namesAt(LONG_WHITE, walk(dice, 12, 20 + step, 5, dice(12)));
    }
    return { kind: "notes", data: data, rhythm: tier >= 2 ? 2 : 0 };
}

var BLACK_TIERS = [
    ["до-диез и ми-бемоль", "Две чёрные клавиши слева: до-диез и ми-бемоль. Диез выше белой соседки, бемоль ниже."],
    ["три чёрные справа", "Группа из трёх чёрных клавиш: фа-диез, ля-бемоль и си-бемоль."],
    ["только чёрные", "Пять чёрных клавиш это готовая пентатоника: на них нельзя сыграть фальшиво."],
    ["по полутонам", "Белые и чёрные подряд, шаг в один полутон. Так рука привыкает к рельефу клавиатуры."],
    ["диезы", "Одна и та же чёрная клавиша может называться по-разному. Здесь все названы диезами."],
    ["бемоли", "Те же пять чёрных клавиш, но под именами бемолей. В нотах встречаются оба имени."],
    ["хроматические пробежки", "Все клавиши подряд вверх и вниз. Упражнение на беглость и знание клавиатуры."],
    ["все двенадцать", "Любая из двенадцати нот под любым именем. После этого чужих клавиш не остаётся."]
];

function makeBlack(tier, step, dice) {
    var data;
    if (tier === 0) {
        data = namesAt(["C", "C#", "D", "Eb", "E"], walk(dice, 5, 8 + step, 2, 0));
    } else if (tier === 1) {
        data = namesAt(["F", "F#", "G", "Ab", "A", "Bb", "B"], walk(dice, 7, 10 + step, 2, 0));
    } else if (tier === 2) {
        data = pickMany(["C#", "Eb", "F#", "Ab", "Bb"], 10 + step, dice).join(" ");
    } else if (tier === 3) {
        data = namesAt(ROOT_NAMES, walk(dice, 12, 12 + step, 2, dice(8)));
    } else if (tier === 4) {
        data = pickMany(["C#", "D#", "F#", "G#", "A#", "C", "E", "G", "B"], 12 + step, dice).join(" ");
    } else if (tier === 5) {
        data = pickMany(["Db", "Eb", "Gb", "Ab", "Bb", "D", "F", "A", "C"], 12 + step, dice).join(" ");
    } else if (tier === 6) {
        var from = step;
        var run = [];
        for (var k = 0; k < 8; k++) {
            run.push(ROOT_NAMES[from + k]);
        }
        data = run.concat(run.slice(0, 7).reverse()).join(" ");
    } else {
        data = pickMany(["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"], 16 + step, dice).join(" ");
    }
    return { kind: "notes", data: data, rhythm: tier >= 3 ? 2 : 0 };
}

var INTERVAL_TIERS = [
    ["терции по порядку", "Терция это две клавиши через одну. Идём по ступенькам вверх и вниз."],
    ["терции вразбивку", "Те же терции в случайном порядке: рука запоминает расстояние, а не место."],
    ["квинты", "Квинта это каркас любого аккорда: большой и мизинец через три клавиши."],
    ["терции и квинты", "Два расстояния вперемешку. Рука учится менять раскрытие на лету."],
    ["сексты", "Секста это перевёрнутая терция: звучит шире и теплее."],
    ["кварты и октавы", "Кварта чуть уже квинты, октава это та же нота выше. Оба интервала звучат пусто и мощно."],
    ["секунды и септимы", "Самые острые интервалы: соседние клавиши и почти октава. На них держится напряжение."],
    ["все интервалы", "Любое расстояние от секунды до октавы. Так готовят руку к аккордам любой формы."]
];

function makeIntervals(tier, step, dice) {
    var sizes = [[2], [2], [4], [2, 4], [5], [3, 7], [1, 6], [1, 2, 3, 4, 5, 6, 7]][tier];
    var count = (tier === 0 ? 8 : 10) + step;
    var out = [];
    var last = "";
    var ladder = [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0];
    while (out.length < count) {
        var low = tier === 0 || (tier === 2 && step < 2) ? ladder[out.length] : dice(7);
        var token = pairAt(low, sizes[dice(sizes.length)]);
        if (token !== last) {
            out.push(token);
            last = token;
        }
    }
    return { kind: "notes", data: out.join(" "), hint: "Нажимай обе подсвеченные клавиши вместе. Нижняя нота написана первой." };
}

var CHORD_TIERS = [
    ["C и F", "Первые два аккорда. Между ними одна общая нота до: держи её и переставляй остальные пальцы."],
    ["C, F и G", "Три мажорных аккорда тональности. Ими одними играют сотни песен."],
    ["добавляем Am", "Первый минорный аккорд. С ним получается самая знаменитая четвёрка аккордов."],
    ["Dm и Em", "Ещё два минорных аккорда. Теперь в руках все шесть рабочих аккордов тональности."],
    ["все шесть", "Шесть аккордов в случайном порядке. Каждый должен браться сразу, одной формой руки."],
    ["sus и dim", "Аккорды с подвешенной нотой и уменьшённый. Они звучат неустойчиво и просят продолжения."],
    ["чужие аккорды", "Аккорды из соседних тональностей: с ними прогрессия перестаёт быть предсказуемой."],
    ["быстрая смена", "Все аккорды подряд и без пауз. Здесь важна ровность: считай про себя."]
];

function makeChords(tier, step, dice) {
    var pools = [
        ["C", "F"], ["C", "F", "G"], ["C", "F", "G", "Am"], ["Am", "Dm", "Em", "C", "Dm", "Em", "F", "G"], HOME_CHORDS,
        HOME_CHORDS.concat(["Csus4", "Gsus4", "Bdim", "Asus2"]), HOME_CHORDS.concat(["E", "D", "A", "Bb", "Fm"]), HOME_CHORDS
    ];
    var count = tier < 2 ? 8 + step : (tier === 7 ? 16 + step : 10 + step);
    return { kind: "chords", data: pickMany(pools[tier], count, dice).join(" "), rhythm: tier === 7 ? 1 : 0 };
}

// place on the circle, name, what is new
var KEY_ORDER = [
    [1, "соль мажор", "одна чёрная клавиша, фа-диез"], [11, "фа мажор", "одна чёрная клавиша, си-бемоль"],
    [2, "ре мажор", "два диеза: фа и до"], [10, "си-бемоль мажор", "два бемоля: си и ми"],
    [3, "ля мажор", "три диеза: фа, до и соль"], [9, "ми-бемоль мажор", "три бемоля: си, ми и ля"],
    [4, "ми мажор", "четыре диеза"], [8, "ля-бемоль мажор", "четыре бемоля"]
];
var KEY_TIERS = KEY_ORDER.map(function (key) {
    return [key[1], "Тональность " + key[1] + ": " + key[2] + ". Те же шесть аккордов, сдвинутые на новое место круга."];
});

function makeKeys(tier, step, dice) {
    var index = KEY_ORDER[tier][0];
    var patterns = ["I IV V I IV V I V IV I", "I vi IV V I vi IV V I", "I ii iii IV V vi V IV iii ii I", "", "I V vi IV I V vi IV ii V I"];
    var data = step === 3 ? pickMany(sixOf(index), 12, dice).join(" ") : inKey(index, patterns[step]);
    return { kind: "chords", data: data, key: keyChords(index).I,
             hint: "Тональность " + KEY_ORDER[tier][1] + ". Её аккорды подсвечены на круге, зажимай клавиши вместе." };
}

var MAIN_PATTERNS = ["I V vi IV", "vi IV I V", "I vi IV V", "I IV vi V", "vi V IV V"];
var SIDE_PATTERNS = ["ii V I vi", "I iii IV V", "IV V iii vi", "vi ii V I", "ii IV I V"];
var JAZZ_PATTERNS = ["I vi ii V", "ii V I vi", "I IV iii vi", "vi ii V I", "IV V iii vi"];
var PROGRESSION_TIERS = [
    ["три аккорда", "Первая, четвёртая и пятая ступени: I, IV и V. На этих трёх аккордах стоят блюз, рок и поп."],
    ["с минором", "Добавляем шестую ступень, минорную. Четвёрка I, V, vi, IV звучит в тысячах хитов."],
    ["вторая и третья", "Вторая и третья ступени делают движение мягче и неожиданнее."],
    ["соль мажор", "Те же прогрессии, но от соль. Ступени остаются прежними, меняются только клавиши."],
    ["фа мажор", "Теперь от фа. Чем больше тональностей под рукой, тем проще подобрать песню под голос."],
    ["ре и ля мажор", "Тональности с двумя и тремя диезами: любимые у гитаристов и в танцевальной музыке."],
    ["си-бемоль и ми-бемоль", "Бемольные тональности: в них играют духовые, соул и джаз."],
    ["с септаккордами", "Те же ступени, но каждый аккорд из четырёх нот. Так прогрессия звучит по-взрослому."]
];

function makeProgressions(tier, step) {
    var index = 0;
    var pattern;
    if (tier === 0) {
        pattern = ["I IV V I", "I V IV I", "I IV I V", "I V I IV", "IV V I I"][step];
    } else if (tier === 1 || tier === 3) {
        pattern = MAIN_PATTERNS[step];
        index = tier === 3 ? 1 : 0;
    } else if (tier === 2 || tier === 4) {
        pattern = SIDE_PATTERNS[step];
        index = tier === 4 ? 11 : 0;
    } else if (tier === 5) {
        pattern = (step % 2 ? SIDE_PATTERNS : MAIN_PATTERNS)[step];
        index = step < 3 ? 2 : 3;
    } else if (tier === 6) {
        pattern = (step % 2 ? MAIN_PATTERNS : SIDE_PATTERNS)[step];
        index = step < 3 ? 10 : 9;
    } else {
        pattern = JAZZ_PATTERNS[step];
        index = step < 3 ? 0 : 1;
    }
    return { kind: "chords", data: twice(inKey(index, pattern, tier === 7)), key: keyChords(index).I,
             hint: "Прогрессия " + pattern + " в тональности " + KEY_RU[index] + " мажор. Два круга подряд." };
}

var INVERSION_TIERS = [
    ["аккорд C", "Один аккорд в трёх положениях: внизу до, ми или соль. Ноты те же, звучание разное."],
    ["F и G", "То же для двух других мажорных аккордов. Буква после черты показывает нижнюю ноту."],
    ["минорные", "Обращения минорных аккордов Am, Dm и Em."],
    ["вразбивку", "Любой из шести аккордов в любом положении. Сначала найди нижнюю ноту, потом достраивай."],
    ["плавный бас", "Прогрессии, в которых нижняя нота идёт по ступенькам. Так аккорды перетекают, а не прыгают."],
    ["соль мажор", "Обращения в соль мажоре: появляется фа-диез."],
    ["фа мажор", "Обращения в фа мажоре: появляется си-бемоль."],
    ["рука почти не двигается", "Каждый аккорд взят в положении, ближайшем к предыдущему. Так играют клавишники в группах."]
];

function makeInversions(tier, step, dice) {
    var data;
    var key = "C";
    var smooth = ["C G/B Am Am/G F C/E Dm G C", "C C/E F G/B C Am/C Dm G/B C", "Am Am/G F C/E Dm Dm/F Em Am",
                  "F C/E Dm C G/B C F/A G C", "C/G G F/A G/B C Am/E F G C"];
    var close = ["C/E F G/D C/E F G/D C", "Am/E F/A G/B C Am/E F/A G/B C", "C G/B Am/C G/B C G/B Am/C G/D",
                 "F/C C G/B Am F/C C G/B C", "Dm/F C/E Dm/F G C/G G/B C Am/C"];
    if (tier === 0) {
        data = namesAt(positions("C"), walk(dice, 3, 8 + step, 2, 0));
    } else if (tier === 1) {
        data = namesAt(positions("F"), walk(dice, 3, 5, 2, 0)) + " " + namesAt(positions("G"), walk(dice, 3, 5 + step, 2, 0));
    } else if (tier === 2) {
        data = pickMany(allPositions(["Am", "Dm", "Em"]), 10 + step, dice).join(" ");
    } else if (tier === 3) {
        data = pickMany(allPositions(HOME_CHORDS), 10 + step, dice).join(" ");
    } else if (tier === 4) {
        data = smooth[step];
    } else if (tier === 5) {
        data = pickMany(allPositions(["G", "C", "D", "Em"]), 10 + step, dice).join(" ");
        key = "G";
    } else if (tier === 6) {
        data = pickMany(allPositions(["F", "Bb", "C", "Dm"], true), 10 + step, dice).join(" ");
        key = "F";
    } else {
        data = close[step];
    }
    return { kind: "chords", data: data, key: key, hint: "Буква после черты это нижняя нота. C/E значит аккорд C, внизу E." };
}

var BASS_TIERS = [
    ["C, F и G", "Левая рука берёт одну нижнюю ноту, правая весь аккорд. Сразу звучит как группа."],
    ["с минором", "К трём мажорным аккордам добавляется Am. Бас всегда равен первой букве аккорда."],
    ["по ступенькам", "Все шесть аккордов по порядку вверх и вниз. Левая рука шагает по соседним клавишам."],
    ["вразбивку", "Аккорды в случайном порядке: обе руки прыгают одновременно."],
    ["прогрессии", "Настоящие прогрессии двумя руками. Так аккомпанируют песням."],
    ["соль мажор", "Бас и аккорд в новой тональности."],
    ["фа и ре мажор", "Ещё две тональности для двух рук."],
    ["септаккорды с басом", "Слева бас, справа аккорд из четырёх нот. Полное звучание одного музыканта."]
];

function makeBass(tier, step, dice) {
    var data;
    var key = "C";
    var ladder = ["C", "Dm", "Em", "F", "G", "Am", "G", "F", "Em", "Dm", "C"];
    if (tier === 0) {
        data = pickMany(["C", "F", "G"], 8 + step, dice).join(" ");
    } else if (tier === 1) {
        data = pickMany(["C", "F", "G", "Am"], 8 + step, dice).join(" ");
    } else if (tier === 2) {
        data = ladder.slice(step).concat(ladder.slice(1, step + 1)).join(" ");
    } else if (tier === 3) {
        data = pickMany(HOME_CHORDS, 10 + step, dice).join(" ");
    } else if (tier === 4) {
        data = twice(inKey(0, MAIN_PATTERNS[step]));
    } else if (tier === 5) {
        data = pickMany(sixOf(1), 10, dice).join(" ");
        key = "G";
    } else if (tier === 6) {
        data = pickMany(sixOf(step < 3 ? 11 : 2), 10, dice).join(" ");
        key = step < 3 ? "F" : "D";
    } else {
        data = pickMany(HOME_SEVENTHS, 8 + step, dice).join(" ");
    }
    return { kind: "bass", data: data, key: key };
}

var SEVENTH_TIERS = [
    ["Cmaj7 и Fmaj7", "Мажорный септаккорд: к трём нотам добавляется четвёртая, через одну. Звук мечтательный."],
    ["доминанта G7", "G7 звучит напряжённо и тянет обратно к C. На этой тяге держится гармония."],
    ["минорные", "Am7, Dm7 и Em7: мягкие аккорды хауса, соула и лоу-фая."],
    ["все шесть", "Шесть септаккордов тональности вразбивку."],
    ["оборот ii V I", "Dm7, G7, Cmaj7: главный оборот джаза. Подготовка, напряжение, разрешение."],
    ["соль мажор", "Септаккорды новой тональности: Gmaj7, Cmaj7, D7 и минорные."],
    ["фа мажор", "Септаккорды фа мажора: появляется Bbmaj7."],
    ["краски", "Нонаккорды, add9, шестые и полууменьшённый. Одна добавленная нота меняет всё настроение."]
];

function makeSevenths(tier, step, dice) {
    var pools = [["Cmaj7", "Fmaj7"], ["Cmaj7", "Fmaj7", "G7"], ["Am7", "Dm7", "Em7"], HOME_SEVENTHS, null,
                 ["Gmaj7", "Cmaj7", "D7", "Em7", "Am7", "Bm7"], ["Fmaj7", "Bbmaj7", "C7", "Dm7", "Gm7", "Am7"],
                 ["Cadd9", "G6", "Am7", "Fmaj7", "Dm9", "G9", "Cmaj9", "Bm7b5", "Em7", "Csus4"]];
    var turns = ["Dm7 G7 Cmaj7 Cmaj7 Dm7 G7 Cmaj7 Cmaj7", "Dm7 G7 Cmaj7 Am7 Dm7 G7 Cmaj7 Am7", "Em7 Am7 Dm7 G7 Em7 Am7 Dm7 G7",
                 "Fmaj7 Em7 Dm7 Cmaj7 Fmaj7 Em7 Dm7 Cmaj7", "Cmaj7 Am7 Dm7 G7 Em7 Am7 Dm7 G7 Cmaj7"];
    var data = tier === 4 ? turns[step] : pickMany(pools[tier], (tier < 3 ? 8 : 10) + step, dice).join(" ");
    return { kind: "chords", data: data, key: tier === 5 ? "G" : (tier === 6 ? "F" : "C") };
}

// root, scale, octave, flats, key for the wheel, name
var COURSE_SCALES = [
    ["C", "major", 4, false, "C", "до мажор"], ["A", "minor", 3, false, "Am", "ля минор"],
    ["G", "major", 3, false, "G", "соль мажор"], ["E", "minor", 4, false, "Em", "ми минор"],
    ["F", "major", 3, true, "F", "фа мажор"], ["D", "minor", 4, true, "Dm", "ре минор"],
    ["D", "major", 4, false, "D", "ре мажор"], ["B", "minor", 3, false, "Bm", "си минор"],
    ["Bb", "major", 3, true, "Bb", "си-бемоль мажор"], ["G", "minor", 3, true, "Gm", "соль минор"],
    ["A", "major", 3, false, "A", "ля мажор"], ["F#", "minor", 3, false, "F#m", "фа-диез минор"],
    ["Eb", "major", 4, true, "Eb", "ми-бемоль мажор"], ["C", "minor", 4, true, "Cm", "до минор"],
    ["E", "major", 4, false, "E", "ми мажор"], ["C#", "minor", 4, false, "C#m", "до-диез минор"],
    ["Ab", "major", 3, true, "Ab", "ля-бемоль мажор"], ["F", "minor", 3, true, "Fm", "фа минор"],
    ["B", "major", 3, false, "B", "си мажор"], ["G#", "minor", 3, false, "G#m", "соль-диез минор"],
    ["C", "pentaMajor", 4, false, "C", "мажорная пентатоника от до"], ["A", "pentaMinor", 3, false, "Am", "минорная пентатоника от ля"],
    ["G", "pentaMajor", 3, false, "G", "мажорная пентатоника от соль"], ["E", "pentaMinor", 4, false, "Em", "минорная пентатоника от ми"],
    ["D", "pentaMinor", 4, true, "Dm", "минорная пентатоника от ре"], ["A", "blues", 3, false, "Am", "блюзовая гамма от ля"],
    ["E", "blues", 4, false, "Em", "блюзовая гамма от ми"], ["A", "harmonic", 3, false, "Am", "гармонический минор от ля"],
    ["E", "harmonic", 4, false, "Em", "гармонический минор от ми"], ["B", "harmonic", 3, false, "Bm", "гармонический минор от си"],
    ["D", "dorian", 4, false, "C", "дорийский лад от ре"], ["E", "phrygian", 4, false, "C", "фригийский лад от ми"],
    ["F", "lydian", 3, false, "C", "лидийский лад от фа"], ["G", "mixolydian", 3, false, "C", "миксолидийский лад от соль"],
    ["A", "dorian", 3, false, "G", "дорийский лад от ля"], ["C", "mixolydian", 4, true, "F", "миксолидийский лад от до"],
    ["C", "lydian", 4, false, "G", "лидийский лад от до"], ["C", "wholeTone", 4, false, "C", "целотонная гамма"],
    ["C", "chromatic", 4, false, "C", "хроматическая гамма"], ["F#", "major", 3, false, "F#", "фа-диез мажор"]
];
var SCALE_TIERS = [
    ["", "Первые гаммы: до мажор и его соседи по кругу. Гамма это запас нот, из которого строят мелодию."],
    ["", "Гаммы с одним и двумя знаками. У каждой мажорной гаммы есть минорная пара с теми же клавишами."],
    ["", "Три знака при ключе. Чёрных клавиш больше, но рисунок шагов тот же самый."],
    ["", "Четыре и пять знаков. После них любая тональность перестаёт пугать."],
    ["", "Пентатоники: пять нот, в которых нельзя ошибиться. Главный материал для соло и мелодий."],
    ["", "Блюзовая гамма и гармонический минор: одна острая нота меняет весь характер."],
    ["", "Лады: те же белые клавиши, но с другим центром. Каждый лад это своё настроение."],
    ["", "Необычные гаммы: целотонная, хроматическая и самые далёкие тональности."]
];

function makeScales(tier, step, dice, level) {
    var pick = COURSE_SCALES[level - 1];
    return { kind: "notes", data: scaleNotes(pick[0], pick[1], pick[2], pick[3]), key: pick[4], rhythm: 2, name: pick[5],
             hint: "Гамма: " + pick[5] + ". Вверх и обратно, ровно, не торопясь." };
}

var COURSE_BEATS = [
    "K K K K K K K K", "S S S S S S S S", "H H H H H H H H H H H H H H H H", "K K S S K K S S", "K S K S K S K S",
    "K K S K K K S K", "K S K K S K K S", "K S S K S S K S", "K K S K K S S S", "K S K S K K S S",
    "KH H KH H KH H KH H", "KH H H H KH H H H", "KH H H KH H H KH H", "KH KH H H KH KH H H", "KH H H H H H KH H",
    "KH H SH H KH H SH H", "KH H SH H KH KH SH H", "KH H SH KH KH H SH H", "KH KH SH H KH H SH H", "KH H SH H H KH SH H",
    "KH O SH O KH O SH O", "K O KC O K O KC O", "KH H KC H KH H KC O", "KH H SH O KH KH SH O", "KH O KS O KH O KS O",
    "KH H H H SH H H H KH H H H SH H H H", "KH H H KH SH H H H KH H KH H SH H H H", "KH H KH H SH H H KH H H KH H SH H H H",
    "KH H H H SH H H KH H KH H H SH H H H", "KH H H KH H H SH H KH H H KH H SH H H",
    "KH H SH H H KH SH KH KH H SH H H KH SH H", "KH H SH KH H KH SH H KH H SH H KH KH SH H", "H H H H KR H H H H H H H KR H H H",
    "KH H CH H H KH CH H KH H CH KH H H CH H", "KH KH SH H KH H SH KH H KH SH H KH H SH KH",
    "KH H SH H KH H SH H KH H SH H S S T L", "KH H SH H KH KH SH H S S S S T T L KX", "KH H KH H SH H KH H KH H KH H S S S S",
    "KH H H KH H H SH H KH H H KH S T L KX", "KX H SH H KH KH SH O KH H SH KH S S T KX"
];
var BEAT_TIERS = [
    ["один пэд", "Один пэд и ровный счёт. Барабанщик начинается не со скорости, а с ровности."],
    ["бочка и снейр", "Два главных барабана. Бочка спрашивает, снейр отвечает."],
    ["бочка и хэт", "Два пэда одним ударом: руки учатся бить вместе и по очереди."],
    ["рок-бит", "Бочка, снейр и хэт вместе. Основной бит и его близкие родственники."],
    ["открытый хэт и клэп", "Новые краски: шипящий открытый хэт и хлопок. С ними получаются хаус и диско."],
    ["шестнадцатые", "Хэт идёт вдвое чаще. Рука должна успевать и не зажиматься."],
    ["синкопы", "Удары между долями: бит перестаёт маршировать и начинает качать."],
    ["сбивки", "Переходы между частями трека: дробь по снейру и томам и удар в тарелку."]
];

function makeBeats(tier, step, dice, level) {
    return { kind: "drums", data: COURSE_BEATS[level - 1], rhythm: tier === 0 ? 1 : (tier === 5 ? 4 : 2) };
}

// The check behind a task of a synthesizer lesson. Most tasks turn a knob.
// "voice" (the voice mode of Drift) and "setting" are things Ableton does not
// count among the knobs of a device: they are read from the device itself.
function taskCheck(cls, task) {
    if (task[1] === "voice") {
        return "voice:" + task[0];
    }
    if (task[1] === "setting") {
        return "setting:" + cls + ":" + task[0];
    }
    return "knob:" + cls + ":" + task[0] + ":" + task[1];
}

// knob, direction, what to do
var KNOB_TASKS = {
    fDown: ["LP Freq", "down", "Прикрой фильтр: ручка Freq (K1) влево. Звук темнеет."],
    fUp: ["LP Freq", "up", "Открой фильтр: ручка Freq (K1) вправо. Звук светлеет."],
    fSweep: ["LP Freq", "moved", "Удерживая ноту, медленно поведи Freq (K1) из края в край."],
    rUp: ["LP Res", "up", "Прибавь резонанс: ручка Res (K2) вправо. На частоте среза появляется свист."],
    rDown: ["LP Res", "down", "Убавь резонанс: ручка Res (K2) влево."],
    hpUp: ["HP Freq", "up", "Срежь низ: ручка HP вправо. Звук становится тонким."],
    hpDown: ["HP Freq", "down", "Верни низ: ручка HP влево."],
    aUp: ["Env 1 Attack", "up", "Прибавь Attack (K3): нота не бьёт, а вплывает."],
    aDown: ["Env 1 Attack", "down", "Убавь Attack (K3): нота снова бьёт сразу."],
    dMove: ["Env 1 Decay", "moved", "Покрути Decay (K4): меняется длина щипка."],
    sDown: ["Env 1 Sustain", "down", "Убавь Sustain (K5): нота затухает, даже пока клавиша нажата."],
    sUp: ["Env 1 Sustain", "up", "Прибавь Sustain (K5): нота тянется, пока держишь клавишу."],
    relUp: ["Env 1 Release", "up", "Прибавь Release (K6): после отпускания нота тает."],
    relDown: ["Env 1 Release", "down", "Убавь Release (K6): нота обрывается сразу."],
    wave: ["Osc 1 Wave", "changed", "Смени волну в списке Osc 1 и сравни тембр."],
    saw: ["Osc 1 Wave", "is Saw", "В списке Osc 1 выбери Saw: яркая жужжащая пила."],
    sine: ["Osc 1 Wave", "is Sine", "В списке Osc 1 выбери Sine: чистый тон без призвуков."],
    rect: ["Osc 1 Wave", "is Rectangle", "В списке Osc 1 выбери Rectangle: пустой звук старых приставок."],
    tri: ["Osc 1 Wave", "is Triangle", "В списке Osc 1 выбери Triangle: мягкий тон, чуть ярче синуса."],
    shape: ["Osc 1 Shape", "moved", "Покрути Shape у Osc 1: волна гнётся, тембр плавно меняется."],
    octave: ["^(Osc 1 Oct|Transpose)$", "changed", "Опусти звук на октаву ручкой Oct у Osc 1."],
    osc2Oct: ["Osc 2 Oct", "changed", "Сдвинь второй генератор на октаву ручкой Oct у Osc 2."],
    detune: ["Osc 2 Detune", "changed", "Поставь Detune у Osc 2 на 7 полутонов: в каждой ноте зазвучит квинта."],
    wave2: ["Osc 2 Wave", "changed", "Смени волну второго генератора в списке Osc 2."],
    lfoRate: ["LFO Freq", "moved", "Измени скорость LFO ручкой Rate."],
    lfoWave: ["LFO Wave", "changed", "Смени форму волны LFO в его списке."],
    lfoFilter: ["^LP Mod Amt [12]$", "moved", "В разделе Freq Mod выбери источник LFO и сдвинь ползунок рядом: фильтр закачается."],
    lfoAmount: ["LFO Amount", "moved", "Покрути общую глубину LFO: ручка Amount (K7)."],
    mono: ["Mono", "voice", "В списке Mode выбери Mono: синтезатор играет по одной ноте."],
    poly: ["Poly", "voice", "В списке Mode выбери Poly: можно играть аккорды."],
    stereo: ["Stereo", "voice", "В списке Mode выбери Stereo: голоса расходятся по колонкам."],
    unison: ["Unison", "voice", "В списке Mode выбери Unison: каждую ноту играют четыре голоса."],
    glide: ["Glide Time", "up", "Прибавь Glide: ноты съезжают одна в другую."],
    legato: ["^Legato( On)?$", "on", "Включи Legato: при игре внахлёст нота не начинается заново."],
    strength: ["Strength", "up", "Прибавь Strength: голоса расходятся, звук ширится."],
    darker: ["LP Freq", "down", "Сделай звук темнее и глуше. Какую ручку крутить, реши сам."],
    brighter: ["LP Freq", "up", "Сделай звук ярче. Ручку выбери сам."],
    whistle: ["LP Res", "up", "Добавь звуку свиста и остроты."],
    fadeIn: ["Env 1 Attack", "up", "Пусть нота не бьёт, а вплывает."],
    punchy: ["Env 1 Attack", "down", "Пусть нота бьёт сразу, без разгона."],
    longTail: ["Env 1 Release", "up", "Пусть нота долго тает после того, как отпустишь клавишу."],
    cut: ["Env 1 Release", "down", "Пусть нота обрывается сразу, как отпустишь клавишу."],
    pluck: ["Env 1 Sustain", "down", "Преврати звук в короткий щипок."],
    organ: ["Env 1 Sustain", "up", "Пусть нота звучит ровно, пока держишь клавишу."],
    thin: ["HP Freq", "up", "Убери из звука низ, сделай его тонким."],
    fat: ["Unison", "voice", "Сделай звук толстым и широким, как хор."],
    oneVoice: ["Mono", "voice", "Сделай так, чтобы звучала только одна нота сразу."],
    slide: ["Glide Time", "up", "Пусть ноты съезжают одна в другую."],
    wobble: ["^LP Mod Amt [12]$", "moved", "Пусть фильтр качается сам, без твоей руки."]
};

// name (empty = the name of the tier), tasks, what to play at the end
var KNOB_PLANS = [
    ["", "fDown fUp", "A"], ["", "fDown rUp fUp", "A"], ["", "rUp fSweep rDown", "A"], ["", "hpUp hpDown fDown fUp", "A"], ["", "fDown rUp fSweep hpUp hpDown", "Am"],
    ["", "aUp aDown", "A"], ["", "relUp relDown", "A"], ["", "sDown dMove sUp", "A"], ["", "aUp relUp aDown relDown", "Am"], ["", "sDown dMove relUp aUp aDown", "Am"],
    ["", "wave shape", "A"], ["", "saw sine rect", "A"], ["", "octave osc2Oct", "A"], ["", "detune wave2 shape", "A"], ["", "tri shape osc2Oct detune", "Am"],
    ["", "lfoFilter lfoRate", "A"], ["", "lfoFilter lfoWave lfoRate", "A"], ["", "lfoRate lfoAmount", "A"], ["", "lfoFilter lfoRate lfoWave fDown", "Am"], ["", "lfoFilter lfoRate rUp lfoWave lfoAmount", "Am"],
    ["", "mono poly", "Am"], ["", "stereo unison", "Am"], ["", "mono legato glide", "A"], ["", "unison strength poly", "Am"], ["", "mono glide octave stereo", "Am"],
    ["бас", "mono octave fDown", "A"], ["саб-бас", "sine mono octave relDown", "A"], ["эйсид", "mono legato glide rUp fSweep", "A"],
    ["лид", "saw mono glide sUp", "A"], ["медные", "saw poly aUp fDown", "Am"],
    ["пэд", "stereo aUp relUp fDown", "Am"], ["плак", "poly sDown dMove relDown", "Am"], ["клавиши", "tri poly sDown dMove relUp", "Am"],
    ["суперпила", "saw unison strength relUp", "Am"], ["орган", "sine poly sUp aDown relDown", "Am"],
    ["", "darker brighter whistle", "A"], ["", "fadeIn longTail punchy cut", "Am"], ["", "pluck organ thin", "A"],
    ["", "fat oneVoice slide wobble", "A"], ["", "darker fadeIn longTail fat whistle", "Am"]
];
var KNOB_TIERS = [
    ["фильтр", "Фильтр решает, тёмный звук или яркий. Freq, Res и HP: три ручки, с которых начинается любой звук."],
    ["огибающая", "Attack, Decay, Sustain и Release рисуют жизнь ноты: как она начинается, держится и тает."],
    ["генераторы", "Сырой тембр: какая волна, в какой октаве и что делает второй генератор."],
    ["LFO", "LFO крутит ручки за тебя. Скорость, форма и глубина качания."],
    ["голоса", "Сколько нот звучит сразу и как они связаны: Poly, Mono, Stereo, Unison, скольжение."],
    ["рецепты: низ и соло", "Готовые звуки из знакомых ручек. Тот же Drift становится басом, сабом или лидом."],
    ["рецепты: аккорды", "Звуки для аккордов: пэд, плак, клавиши, суперпила и орган."],
    ["на слух", "Задание описано словами, а не названием ручки. Так и работает продюсер: слышит и знает, что крутить."]
];

function makeKnobs(tier, step, dice, level) {
    var plan = KNOB_PLANS[level - 1];
    var out = [["live", "device:Drift", "Курс идёт на Drift. Если его нет на этой дорожке, перетащи его из раздела Instruments."]];
    var tasks = words(plan[1]);
    for (var i = 0; i < tasks.length; i++) {
        var task = KNOB_TASKS[tasks[i]];
        out.push(["live", taskCheck("Drift", task), task[2] + (tier < 7 ? " Играй ноты и слушай." : "")]);
    }
    out.push([plan[2].length > 1 ? "chord" : "note", plan[2], plan[0] ? "Готово: это " + plan[0] + ". Сыграй и послушай, что получилось." : "Сыграй и послушай, что получилось."]);
    return { kind: "tour", data: out, name: plan[0],
             hint: tier === 7 ? "Вспомни: Freq это яркость, Attack это начало ноты, Release это хвост, Mode это число голосов."
                              : "Делай по шагам. Ручку можно крутить мышью или энкодером, тренажёр следит за самой ручкой." };
}

// class, name in the browser, what it is, tasks: knob, direction, what to do
var FX = {
    reverb: ["Reverb", "Reverb", "Он помещает звук в комнату.", {
        wet: ["Dry/Wet", "up", "прибавь Dry/Wet (K8): звук уходит вглубь комнаты."],
        dry: ["Dry/Wet", "down", "убавь Dry/Wet (K8): звук возвращается ближе."],
        longer: ["Decay Time", "up", "прибавь Decay Time (K1): хвост тает дольше."],
        shorter: ["Decay Time", "down", "убавь Decay Time (K1): комната становится маленькой."],
        pre: ["Predelay", "up", "прибавь Predelay (K3): отзвук приходит чуть позже, и нота остаётся чёткой."],
        size: ["Room Size", "moved", "покрути Size (K2): меняется размер комнаты."] }],
    delay: ["Delay", "Delay", "Он повторяет звук, как эхо.", {
        wet: ["Dry/Wet", "up", "прибавь Dry/Wet (K8): за нотой бегут повторы."],
        more: ["Feedback", "up", "прибавь Feedback (K3): повторов становится больше."],
        less: ["Feedback", "down", "убавь Feedback (K3): эхо затихает быстрее."],
        time: ["^[LR] 16th$", "changed", "смени время повтора кнопками с цифрами."],
        tone: ["Filter Freq", "moved", "покрути частоту фильтра (K4): повторы темнеют или светлеют."] }],
    filter: ["AutoFilter2,AutoFilter", "Auto Filter", "Это фильтр для любого звука.", {
        close: ["Frequency", "down", "закрой фильтр ручкой частоты (K1): звук уходит под воду."],
        open: ["Frequency", "up", "открой фильтр ручкой частоты (K1)."],
        res: ["Resonance", "up", "прибавь резонанс (K2): срез начинает свистеть."],
        lfo: ["LFO Amount", "up", "прибавь Amount в блоке LFO: фильтр качается сам."] }],
    sat: ["Saturator", "Saturator", "Он перегружает звук, как старый усилитель.", {
        drive: ["Drive", "up", "прибавь Drive (K1): звук теплеет и рычит."],
        calm: ["Drive", "down", "убавь Drive (K1): перегруз уходит."],
        out: ["Output", "down", "убавь Output (K7), чтобы громкость осталась прежней."],
        mix: ["Dry/Wet", "down", "убавь Dry/Wet (K8): чистый звук подмешивается обратно."] }],
    chorus: ["Chorus2", "Chorus-Ensemble", "Он добавляет к звуку его расстроенные копии.", {
        amount: ["Amount", "up", "прибавь Amount (K1): звук становится шире."],
        rate: ["Rate", "moved", "покрути Rate (K2): меняется скорость качания."],
        width: ["Width", "moved", "покрути Width (K4): эффект расходится по сторонам."],
        mix: ["Dry/Wet", "moved", "подбери долю эффекта ручкой Dry/Wet (K8)."] }],
    phaser: ["PhaserNew", "Phaser-Flanger", "Он вырезает в звуке движущиеся провалы.", {
        amount: ["LFO Amount", "up", "прибавь Amount (K1): по звуку идёт волна."],
        sharp: ["Feedback", "up", "прибавь Feedback (K3): эффект становится острее."],
        mode: ["Mode", "changed", "переключи режим: Phaser, Flanger или Doubler."] }],
    util: ["StereoGain", "Utility", "Он управляет шириной и громкостью сигнала.", {
        mono: ["Stereo Width", "down", "убавь Width до нуля: звук собирается в центр."],
        wide: ["Stereo Width", "up", "прибавь Width: звук раздвигается."] }],
    comp: ["Compressor2", "Compressor", "Он прижимает громкие места и делает звук плотным.", {
        thr: ["Threshold", "down", "опусти Threshold (K1), пока полоска GR не начнёт дёргаться."],
        ratio: ["Ratio", "up", "прибавь Ratio (K2): сжатие сильнее."],
        att: ["Attack", "moved", "покрути Attack (K3): быстрый съедает удар, медленный пропускает его."],
        rel: ["Release", "moved", "покрути Release (K4): как скоро компрессор отпускает звук."],
        out: ["Output", "up", "верни громкость ручкой Out (K8)."] }],
    eq: ["Eq8", "EQ Eight", "Он делает громче или тише отдельные частоты.", {
        gain: ["^[1-8] Gain A$", "moved", "потяни любую точку на графике вверх или вниз."],
        freq: ["^[1-8] Frequency A$", "moved", "сдвинь точку влево или вправо: так выбирают частоту."] }],
    redux: ["Redux2", "Redux", "Он нарочно портит звук, как старая приставка.", {
        bits: ["Bit Depth", "down", "убавь Bits (K3): звук становится зернистым."],
        rate: ["Sample Rate", "down", "убавь Rate (K1): верх рассыпается в звон."],
        mix: ["Dry/Wet", "down", "убавь Dry/Wet (K8): грязь становится приправой."] }],
    echo: ["Echo", "Echo", "Это эхо с характером старой плёнки.", {
        wet: ["Dry Wet", "up", "прибавь Dry/Wet (K8): появляются повторы."],
        more: ["Feedback", "up", "прибавь Feedback (K6): повторов больше."],
        verb: ["Reverb Level", "up", "прибавь Reverb: эхо уплывает вдаль."] }]
};

// Each lesson: effects in chain order, "effect:task,task"
var FX_PLANS = [
    "reverb:wet,longer", "reverb:wet,dry", "reverb:longer,shorter,wet", "reverb:wet,pre,size", "reverb:wet,longer,pre,size,dry",
    "delay:wet,more", "delay:wet,time", "delay:wet,more,less", "delay:wet,time,tone", "delay:wet,more,time,tone,less",
    "filter:close,open", "filter:close,res,open", "sat:drive,out", "sat:drive,mix,calm", "filter:close,res,lfo,open",
    "chorus:amount,rate", "chorus:amount,width,mix", "phaser:amount,sharp", "phaser:amount,mode,sharp", "util:mono,wide",
    "comp:thr,ratio", "comp:thr,ratio,out", "comp:thr,att,rel", "eq:gain,freq", "comp:thr,ratio,att,rel,out",
    "redux:bits,rate", "redux:bits,mix", "echo:wet,more", "echo:wet,more,verb", "redux:bits,rate,mix",
    "sat:drive reverb:wet", "filter:close delay:wet,more", "chorus:amount reverb:wet,longer", "comp:thr,ratio sat:drive", "redux:bits echo:wet,more",
    "sat:drive chorus:amount reverb:wet", "filter:close delay:wet reverb:wet", "comp:thr sat:drive delay:wet",
    "redux:bits filter:close echo:wet", "eq:gain comp:thr,ratio reverb:wet,longer"
];
var FX_TIERS = [
    ["ревербератор", "Reverb даёт звуку пространство. Доля эффекта, длина хвоста, размер комнаты."],
    ["эхо", "Delay повторяет звук в ритм трека. Сколько повторов, как часто и какого цвета."],
    ["фильтр и перегруз", "Auto Filter и Saturator: яркость и тепло для любого звука, не только для синтезатора."],
    ["ширина и движение", "Chorus, Phaser и Utility: звук становится шире и начинает плыть."],
    ["плотность и тон", "Compressor и эквалайзер: главные инструменты сведения."],
    ["грязь и характер", "Redux и Echo: нарочно испорченный звук, у которого появляется лицо."],
    ["два эффекта подряд", "Эффекты ставят цепочкой, и порядок важен: сигнал идёт слева направо."],
    ["цепочка из трёх", "Полная обработка одной дорожки: три эффекта, каждый на своём месте."]
];

function makeEffects(tier, step, dice, level) {
    var parts = words(FX_PLANS[level - 1]);
    var out = [];
    var before = null;
    for (var i = 0; i < parts.length; i++) {
        var halves = parts[i].split(":");
        var effect = FX[halves[0]];
        var tasks = halves[1].split(",");
        out.push(["live", "device:" + effect[0], "Поставь на эту дорожку " + effect[1] + " из раздела Audio Effects. " + effect[2]]);
        if (before) {
            out.push(["live", "order:" + before[0] + ":" + effect[0], before[1] + " должен стоять левее, чем " + effect[1] + ": сигнал идёт слева направо. Если порядок другой, перетащи устройство за заголовок."]);
        }
        for (var k = 0; k < tasks.length; k++) {
            var task = effect[3][tasks[k]];
            out.push(["live", "knob:" + effect[0] + ":" + task[0] + ":" + task[1], effect[1] + ": " + task[2]]);
        }
        before = effect;
    }
    out.push(["chord", "Am", "Сыграй аккорд и послушай, что получилось. Сравни, выключая эффект кнопкой в его заголовке."]);
    return { kind: "tour", data: out, hint: "Делай по шагам. Ручку можно крутить мышью или энкодером, тренажёр следит за самой ручкой." };
}

var TEMPO_ORDER = [
    ["Хаус", 120, 128], ["Драм-н-бейс", 170, 176], ["Лоу-фай", 70, 90], ["Фьюче-бейс", 140, 160],
    ["Бум-бэп", 85, 95], ["Техно", 128, 140], ["Транс", 136, 142], ["Синтвейв", 80, 118],
    ["Трэп", 130, 150], ["Дабстеп", 138, 142], ["Фонк", 130, 160], ["Гэридж", 128, 136]
];
var TEMPO_TIERS = [
    ["два жанра", "Темп это первое, что отличает один жанр от другого. Начнём с пары самых разных."],
    ["два жанра, новые имена", "Жанров в списке становится больше, а подсказка пока рядом."],
    ["три жанра", "Три темпа подряд. Заодно рука привыкает быстро менять темп в Ableton."],
    ["три жанра, шире выбор", "Ещё больше жанров. Медленные, средние и быстрые."],
    ["четыре жанра, подсказка короче", "Теперь подсказка называет только примерную цифру."],
    ["четыре жанра", "Почти весь список жанров и короткая подсказка."],
    ["пять жанров по памяти", "Подсказок больше нет. Темп каждого жанра надо помнить."],
    ["все жанры по памяти", "Любой жанр из списка, пять подряд, по памяти."]
];

function makeTempos(tier, step, dice) {
    var pool = TEMPO_ORDER.slice(0, Math.min(TEMPO_ORDER.length, 4 + tier + (tier > 3 ? 1 : 0)));
    var count = 2 + Math.floor(tier / 2);
    var out = [];
    var low = -100, high = -100;
    while (out.length < count) {
        var pick = pool[dice(pool.length)];
        if (pick[1] > high + 2 || pick[2] < low - 2) {
            var hint = tier < 4 ? " Подсказка: от " + pick[1] + " до " + pick[2] + " ударов в минуту."
                     : (tier < 6 ? " Подсказка: около " + Math.round((pick[1] + pick[2]) / 10) * 5 + "." : " Не помнишь? Загляни в паспорт жанра.");
            out.push(["live", "tempo:" + pick[1] + ":" + pick[2], pick[0] + ". Вспомни темп этого жанра и поставь его в Ableton." + hint]);
            low = pick[1];
            high = pick[2];
        }
    }
    return { kind: "tour", data: out, hint: "Дважды щёлкни по цифре темпа вверху слева, набери число и нажми Enter." };
}

var HAND_TIERS = [
    ["бас стоит", "Левая рука держит одну ноту, правая играет мелодию. Первый шаг к независимости рук."],
    ["бас в миноре", "То же с минорными басами. Левая рука держит и не отпускает, пока правая не закончит."],
    ["аккорд и мелодия", "Слева целый аккорд, справа мелодия по его нотам. Так играют почти все клавишники."],
    ["проходящие ноты", "Мелодия идёт не только по нотам аккорда, но и между ними. Она становится певучей."],
    ["бас шагает", "Наоборот: правая держит аккорд, левая ходит по его нотам."],
    ["бас шагает в миноре", "Шагающий бас под минорными аккордами, с заходом на септиму."],
    ["септаккорды и мелодия", "Слева аккорд из четырёх нот, справа мелодия. Звучит как готовая пьеса."],
    ["обе задачи", "Через урок меняется, какая рука держит. Обе руки должны уметь и то, и другое."]
];

function makeHands(tier, step, dice) {
    var blocks = [];
    var i;
    function melody(pool, count) {
        return pickMany(pool, count, dice).join(" ");
    }
    if (tier === 0 || tier === 1) {
        var basses = tier === 0 ? ["C", "F", "G"] : ["A", "D", "E", "C", "F"];
        var over = { C: ["E", "G", "A", "C", "D"], F: ["A", "C", "D", "F", "G"], G: ["B", "D", "E", "G", "A"],
                     A: ["C", "E", "D", "A", "G"], D: ["F", "A", "G", "D", "E"], E: ["G", "B", "A", "E", "D"] };
        var chosen = pickMany(basses, 2 + Math.floor((step + 1) / 2), dice);
        for (i = 0; i < chosen.length; i++) {
            blocks.push(chosen[i] + ": " + melody(over[chosen[i]], 4));
        }
        return { kind: "hold", data: blocks.join(" | ") };
    }
    var chords = [null, null, ["C", "F", "G"], ["Am", "F", "C", "G"], ["C", "F", "G"], ["Am", "Dm", "G", "C"],
                  ["Am7", "Dm7", "G7", "Cmaj7"], ["Am", "F", "C", "G", "Dm", "Em"]][tier];
    var bassWalks = tier === 4 || tier === 5 || (tier === 7 && step % 2 === 1);
    var picked = tier === 7 ? pickMany(chords, 4, dice) : chords;
    for (i = 0; i < picked.length; i++) {
        var tones = tonesOf(picked[i]);
        var line;
        if (bassWalks) {
            // The root first, then two of the other notes: of the chord itself
            // and, past the first tier, the white key that leads on (the sixth
            // of a major chord, the seventh of a minor one).
            var chord = parseChord(picked[i]);
            var leading = NOTE_NAMES[(chord.root + (chord.minor ? 10 : 9)) % 12];
            line = [tones[0]].concat(pickDistinct(tones.slice(1).concat(tier === 4 ? [] : [leading]), 2, dice));
            line.push(tones[dice(tones.length)]);
            line = line.join(" ");
        } else if (tier === 3) {
            line = namesAt(WHITE_NOTES, walk(dice, 7, 4, 2, WHITE_NOTES.indexOf(tones[1]) < 0 ? 0 : WHITE_NOTES.indexOf(tones[1])));
        } else {
            line = melody(tones, tier === 7 ? 5 : 4);
        }
        blocks.push(picked[i] + ": " + line);
    }
    return { kind: bassWalks ? "walk" : "hold", data: blocks.join(" | "), full: true };
}

// ---- course: the other synthesizers of Live

// classes, name in the browser, how it gets onto the track, tasks.
// A task is knob, direction, what to do. Other kinds of direction: "mode" is
// a playback mode of Simpler, "setting" a setting of the device that is not a
// knob (property:value or property:low:high), "manual" a step nothing checks.
var SYNTHS = {
    analog: ["UltraAnalog", "Analog", "Перетащи на эту дорожку Analog из раздела Instruments. Он устроен как синтезаторы семидесятых: два генератора, два фильтра, два усилителя.", {
        f1Down: ["F1 Freq", "down", "В блоке Fil1 убавь Freq: звук темнеет. Фильтр тут работает так же, как в Drift."],
        f1Up: ["F1 Freq", "up", "Прибавь Freq в блоке Fil1: звук раскрывается."],
        f1Res: ["F1 Resonance", "up", "Прибавь Reso в блоке Fil1: срез начинает петь."],
        f1Type: ["F1 Type", "changed", "В блоке Fil1 открой список типов и выбери другой: LP срезает верх, HP срезает низ, BP оставляет середину."],
        f1Env: ["F1 Freq < Env", "moved", "Щёлкни по названию Fil1: в середине появятся его подробности. Найди там Freq Mod и сдвинь ползунок Env: фильтр открывается на каждой ноте сам."],
        o1Shape: ["OSC1 Shape", "changed", "В блоке Osc1 смени форму волны: синус, пила, прямоугольник или шум."],
        bassShape: ["OSC1 Shape", "changed", "В блоке Osc1 выбери пилу или прямоугольник: басу нужны призвуки, чистый синус на маленьких колонках пропадает."],
        o2Oct: ["OSC2 Octave", "changed", "В блоке Osc2 опусти Octave на одну: у звука появляется низ."],
        o2Det: ["OSC2 Detune", "moved", "Чуть сдвинь Detune у Osc2: два генератора расходятся, звук теплеет и плывёт."],
        o2Semi: ["OSC2 Semi", "changed", "Поставь Semi у Osc2 на 7: второй генератор играет квинту над первым."],
        ampAtk: ["AEG1 Attack", "up", "Щёлкни по названию Amp1: в середине откроется его огибающая. Прибавь Attack: нота вплывает."],
        ampRel: ["AEG1 Rel", "up", "В огибающей Amp1 прибавь Release: нота тает после того, как клавишу отпустили."],
        ampSus: ["AEG1 Sustain", "down", "В огибающей Amp1 убавь Sustain: нота превращается в щипок."],
        lfo: ["F1 Freq < LFO", "moved", "Включи справа LFO1. Потом щёлкни по названию Fil1 и в разделе Freq Mod сдвинь ползунок LFO1: фильтр закачался сам."],
        lfoSpeed: ["LFO1 Speed", "moved", "Покрути Rate у LFO1: меняется скорость качания."],
        uni: ["Unison On/Off", "on", "Справа включи Uni: каждую ноту играют несколько расстроенных голосов, звук становится шире."],
        uniDet: ["Unison Detune", "up", "Прибавь Detune рядом с Uni: голоса расходятся сильнее."],
        vib: ["Vib On/Off", "on", "Справа включи Vib: нота начинает дрожать, как у скрипача."],
        glide: ["Glide Time", "up", "Справа включи Gli и прибавь Time: ноты съезжают одна в другую."]
    }],
    operator: ["Operator", "Operator", "Перетащи на эту дорожку Operator из раздела Instruments. В нём звук рождается иначе: один генератор трясёт другой. Это FM-синтез.", {
        bLevel: ["Osc-B Level", "up", "Слева четыре генератора: A, B, C и D. Сейчас звучит один A. Прибавь Level у B: сам B не слышен, он раскачивает A, и в звуке появляется металл."],
        bCoarse: ["B Coarse", "changed", "Смени Coarse у B: он задаёт, во сколько раз B быстрее A. Числа 1 и 2 дают плотный тон, 7 и больше дают звон."],
        bassCoarse: ["B Coarse", "changed", "Поставь Coarse у B на 1 или 2: басу нужен плотный низкий тон без звона."],
        bellCoarse: ["B Coarse", "changed", "Поставь Coarse у B на 7 или выше: высокие числа и дают колокол."],
        bFine: ["B Fine", "moved", "Сдвинь Fine у B: частоты перестают делиться нацело, и тон становится нестройным, как у гонга."],
        bSus: ["Be Sustain", "down", "Щёлкни по строке B: в середине появится его огибающая. Убавь Sustain до низа: металл слышен только в начале ноты, как удар молоточка."],
        bDecay: ["Be Decay", "moved", "В огибающей B покрути Decay: это длина удара. Короткий даёт электропиано, длинный даёт колокол."],
        cLevel: ["Osc-C Level", "up", "Прибавь Level у C: в дело вступает третий генератор."],
        algo: ["Algorithm", "changed", "Щёлкни по блоку справа внизу, где Volume: в середине появятся схемы из квадратиков. Это алгоритмы: кто кого раскачивает, а кто звучит сам. Выбери другую схему."],
        aRel: ["Ae Release", "up", "Щёлкни по строке A и прибавь Release в её огибающей: нота тает после отпускания."],
        wave: ["Osc-A Wave", "changed", "Щёлкни по строке A и смени волну в списке Wave: вместо синуса пила или прямоугольник. Так Operator работает как обычный синтезатор."],
        filtOn: ["Filter On", "on", "Включи справа блок Filter: кнопка рядом с его названием."],
        filtDown: ["Filter Freq", "down", "Убавь Freq в блоке Filter: резкий металл становится мягким."],
        filtRes: ["Filter Res", "up", "Прибавь Res в блоке Filter: срез подчёркнут."],
        lfoOn: ["LFO On", "on", "Включи справа блок LFO: он качает высоту ноты, получается вибрато."],
        lfoAmt: ["LFO Amt", "up", "Прибавь Amount у LFO: вибрато глубже."],
        peOn: ["Pe On", "on", "Включи справа блок Pitch Env."],
        peAmt: ["Pe Amount", "changed", "Сдвинь величину Pitch Env: нота начинается выше или ниже и съезжает на место. Так делают бочки, томы и лазеры."],
        spread: ["Spread", "up", "Прибавь Spread в блоке Pitch: звук раздвигается по колонкам и становится жирнее."],
        tone: ["Tone", "down", "Убавь Tone справа внизу: резкий верх смягчается."]
    }],
    wavetable: ["InstrumentVector", "Wavetable", "Перетащи на эту дорожку Wavetable из раздела Instruments. Его генератор хранит целую таблицу волн и умеет скользить по ней.", {
        pos: ["Osc 1 Pos", "moved", "Зажми ноту и двигай ползунок рядом с картинкой волны (K1): это позиция в таблице. Тембр перетекает из одного в другой."],
        table: ["", "manual", "Над картинкой волны два списка: раздел и таблица. Выбери другую таблицу, например из раздела Vintage, и снова подвигай позицию. Жми готово."],
        fx: ["Osc 1 Effect 1", "moved", "Справа от таблицы выбери эффект генератора: FM, Classic или Modern. Покрути первую из двух ручек под ним: волна гнётся."],
        osc2On: ["Osc 2 On", "on", "Открой вкладку Osc 2 и включи его: это второй слой звука."],
        osc2Transp: ["Osc 2 Transp", "changed", "У Osc 2 сдвинь высоту на 12 полутонов вверх или вниз: слои разошлись на октаву."],
        osc2Det: ["Osc 2 Detune", "moved", "Чуть расстрой Osc 2 ручкой Detune: слои плывут друг против друга."],
        sub: ["Sub Gain", "up", "Открой вкладку Sub, включи его и прибавь громкость: под звуком появился чистый низ."],
        fltDown: ["Flt 1 Freq", "down", "Прикрой фильтр (K5): принцип тот же, что в любом синтезаторе."],
        fltUp: ["Flt 1 Freq", "up", "Открой фильтр обратно."],
        fltRes: ["Flt 1 Res", "up", "Прибавь Res у фильтра: срез подчёркнут."],
        fltDrive: ["Flt 1 Drive", "up", "Прибавь Drive у фильтра: звук грубеет и рычит."],
        atk: ["Amp Attack", "up", "В огибающей Amp прибавь Attack: нота вплывает."],
        rel: ["Amp Release", "up", "В огибающей Amp прибавь Release: нота тает после отпускания."],
        uni: ["unison_mode:1", "setting", "В блоке Unison выбери режим Classic: один голос превращается в хор."],
        shimmer: ["unison_mode:2", "setting", "Смени режим Unison на Shimmer: голоса мерцают и переливаются."],
        uniAmt: ["Unison Amount", "up", "Прибавь Amount у Unison: хор расходится шире."],
        matrix: ["", "manual", "Открой справа вкладку Matrix. В строке LFO 1 потяни вверх ячейку под Osc 1 Pos: теперь позицию двигает LFO, и тембр шевелится сам. Жми готово."],
        lfoRate: ["^LFO 1 (Freq|Synced)$", "moved", "Покрути Rate у LFO 1: тембр шевелится быстрее или медленнее."]
    }],
    meld: ["InstrumentMeld", "Meld", "Перетащи на эту дорожку Meld из раздела Instruments. Это самый новый синтезатор Live: два движка с необычными генераторами и фильтрами.", {
        oscA: ["MeldVoice_EngineA_Oscillator_OscillatorType", "changed", "В Meld два движка, A и B. В движке A открой список генераторов и выбери другой: Swarm Saw это рой пил, Harmonic Fm это металл, Rain и Bubble это шумы природы."],
        m1: ["MeldVoice_EngineA_Oscillator_Macro1", "moved", "У каждого генератора Meld две свои ручки, и у каждого типа они значат своё. Покрути первую и слушай."],
        m2: ["MeldVoice_EngineA_Oscillator_Macro2", "moved", "Теперь вторую ручку генератора A."],
        fA: ["MeldVoice_EngineA_Filter_Frequency", "down", "В фильтре движка A убавь Freq: звук темнеет."],
        fType: ["MeldVoice_EngineA_Filter_FilterType", "changed", "Открой список фильтров движка A. Кроме обычных там есть Vowel (гласные), Comb (гребёнка) и Plate (пластина). Выбери необычный."],
        fM1: ["MeldVoice_EngineA_Filter_Macro1", "moved", "У фильтра тоже есть свои ручки. Покрути первую."],
        bVol: ["MeldVoice_EngineB_Volume", "up", "Включи движок B кнопкой с буквой B и прибавь его громкость в разделе Mix: теперь звучат два слоя."],
        oscB: ["MeldVoice_EngineB_Oscillator_OscillatorType", "changed", "Выбери для движка B другой генератор, не такой, как в A: слои должны отличаться."],
        bTransp: ["MeldVoice_EngineB_Oscillator_Pitch_Transpose", "changed", "Сдвинь движок B на октаву: Transpose +12 или -12."],
        bDet: ["MeldVoice_EngineB_Oscillator_Pitch_Detune", "moved", "Чуть расстрой движок B ручкой Detune: слои поплыли."],
        atk: ["MeldVoice_EngineA_AmpEnvelope_Times_Attack", "up", "На вкладке Envelopes движка A прибавь Attack у Amp: нота вплывает."],
        rel: ["MeldVoice_EngineA_AmpEnvelope_Times_Release", "up", "Там же прибавь Release: нота тает."],
        spread: ["MeldVoice_VoiceSpreadAmount", "up", "Справа прибавь Spread: голоса расходятся по колонкам."],
        drive: ["MeldVoice_Drive", "up", "Справа прибавь Drive: звук перегружается и грубеет."],
        stack: ["unison_voices:1:3", "setting", "Справа найди Stack и поставь 2 или 3: каждую ноту играют несколько голосов, звук толще."]
    }],
    electric: ["LoungeLizard", "Electric", "Перетащи на эту дорожку Electric из раздела Instruments. Это модель электропиано: молоточек бьёт по металлической вилке. Тёплый звук соула и лоу-фая.", {
        stiff: ["M Stiffness", "moved", "В блоке Mallet покрути Stiffness: мягкий молоточек даёт тёплый звук, жёсткий даёт звонкий."],
        force: ["M Force", "up", "Прибавь Force в блоке Mallet: молоточек бьёт сильнее, и звук начинает рычать."],
        color: ["F Tine Color", "moved", "В блоке Fork покрути Color у Tine: меняется звон в начале ноты."],
        decay: ["F Tine Decay", "moved", "Там же покрути Decay: как долго звенит вилка."],
        rel: ["F Release", "up", "Прибавь Release в блоке Fork: нота затихает не сразу после отпускания."],
        sym: ["P Symmetry", "moved", "В блоке Pickup покрути Symmetry: звукосниматель сдвигается, и тембр из мягкого становится гнусавым."],
        model: ["Pickup Model", "changed", "В блоке Pickup переключи тип: R звучит как Rhodes, W как Wurlitzer. Это два главных электропиано в истории."]
    }],
    collision: ["Collision", "Collision", "Перетащи на эту дорожку Collision из раздела Instruments. Он строит звук из удара и того, что от удара звенит: бруска, пластины, трубы, кожи.", {
        type: ["Res 1 Type", "changed", "В блоке Resonator 1 смени Type: Beam и Marimba это бруски, Membrane это барабан, Plate это пластина, Pipe и Tube это трубы."],
        decay: ["Res 1 Decay", "moved", "Покрути Decay у резонатора: как долго он звенит после удара."],
        material: ["Res 1 Material", "moved", "Покрути Material: звук меняется от дерева к металлу и стеклу."],
        bright: ["Res 1 Brightness", "moved", "Покрути Brightness: сколько в звоне верхних частот."],
        inharm: ["Res 1 Inharmonics", "moved", "Покрути Inharmonics: призвуки расходятся, и тон становится колокольным."],
        mallet: ["Mallet Stiffness", "moved", "В блоке Mallet покрути Stiffness: чем жёстче колотушка, тем звонче удар."],
        noise: ["Mallet Noise Amount", "up", "Прибавь Noise в блоке Mallet: в ударе слышен стук колотушки."]
    }],
    tension: ["StringStudio", "Tension", "Перетащи на эту дорожку Tension из раздела Instruments. Это модель струны: от скрипки и рояля до гитар, каких не бывает.", {
        exciter: ["Exciter Type", "changed", "В блоке Excitator выбери, чем играют на струне: Bow это смычок, Hammer это молоточек, Plectrum это медиатор."],
        decay: ["String Decay", "moved", "В блоке String покрути Decay: как долго звучит струна."],
        damp: ["Str Damping", "moved", "Там же покрути Damping: струна глохнет, будто её обмотали."],
        pos: ["E Pos", "moved", "В блоке Excitator покрути Position: это место, где струну трогают. Ближе к краю звук тоньше и острее."],
        body: ["Body Type", "changed", "В блоке Body выбери другой корпус: Piano, Guitar или Violin. Та же струна звучит в разных ящиках."],
        vib: ["Vibrato On/Off", "on", "Включи блок Vibrato: струна запела с дрожанием."]
    }],
    simpler: ["OriginalSimpler", "Simpler", "Перетащи на эту дорожку любой звук из раздела Samples в браузере. Ableton поставит Simpler: он играет звуковой файл клавишами.", {
        slice: ["2", "mode", "Слева у Simpler три режима: Classic, 1-Shot и Slice. Выбери Slice: звук порезан на кусочки, и каждый лёг на свою клавишу."],
        oneShot: ["1", "mode", "Выбери режим 1-Shot: звук играет целиком от одного нажатия, держать клавишу не надо. Так играют барабаны и разовые эффекты."],
        classic: ["0", "mode", "Вернись в Classic: звук играет, пока держишь клавишу, и меняет высоту по клавишам."],
        slices: ["", "manual", "Нажимай клавиши подряд, начиная с самых нижних: это кусочки записи по порядку. Сыграй их в другом порядке, и получится новый рисунок. Жми готово."],
        transp: ["Transpose", "changed", "На вкладке Controls сдвинь Transp на -12: звук опустился на октаву и стал вдвое медленнее."],
        filtOn: ["^(F On|Filter On)$", "on", "На вкладке Controls включи блок Filter."],
        filtDown: ["Filter Freq", "down", "Убавь Freq у фильтра: звук темнеет. Любую запись можно обработать как синтезатор."],
        atk: ["Ve Attack", "up", "В огибающей громкости прибавь Attack: удар в начале исчезает, звук вплывает."],
        rel: ["Ve Release", "up", "Прибавь Release: после отпускания звук тает."],
        spread: ["Spread", "up", "Прибавь Spread: звук раздваивается и расходится по колонкам."],
        start: ["^(S Start|Start)$", "up", "На вкладке Sample потяни левый флажок вправо: звук начинается не с начала записи, а с места, которое нравится."],
        loop: ["", "manual", "В режиме Classic включи кнопку Loop: пока держишь клавишу, кусок звука повторяется. Длину повтора задаёт ручка Length. Жми готово."],
        warp: ["", "manual", "Включи кнопку Warp: теперь на любой клавише звук длится одинаково и держит темп трека. Жми готово."]
    }],
    drift: ["Drift", "Drift", "Перетащи на эту дорожку Drift из раздела Instruments.", {
        sine: ["Osc 1 Wave", "is Sine", "В списке волн Osc 1 выбери Sine: чистый тон для самого низа."],
        oct: ["^(Osc 1 Oct|Transpose)$", "changed", "Опусти Drift на октаву ручкой Oct у Osc 1: он будет гудеть под первым синтезатором."]
    }]
};

// name of the lesson, synthesizers with their tasks, what to play at the end.
// Two synthesizers in one lesson make a layer: the first is wrapped into a
// Rack and the second is dropped into it.
var SYNTH_PLANS = [
    ["фильтр Analog", "analog:f1Down,f1Res,f1Up", "A"],
    ["два генератора Analog", "analog:o1Shape,o2Oct,o2Det", "A"],
    ["огибающая Analog", "analog:ampAtk,ampRel,ampSus", "Am"],
    ["Analog шевелится", "analog:lfo,lfoSpeed,vib,f1Type", "A"],
    ["толстый Analog", "analog:uni,uniDet,o2Semi,glide,f1Env", "Am"],
    ["металл в Operator", "operator:bLevel,bCoarse,bFine", "A"],
    ["удар и хвост в Operator", "operator:bLevel,bSus,bDecay,aRel", "Am"],
    ["алгоритмы Operator", "operator:bLevel,cLevel,algo", "A"],
    ["фильтр и волны Operator", "operator:wave,filtOn,filtDown,filtRes", "Am"],
    ["Operator шевелится", "operator:bLevel,lfoOn,lfoAmt,peOn,peAmt,spread", "A"],
    ["таблица волн", "wavetable:pos,table,fx", "A"],
    ["слои Wavetable", "wavetable:osc2On,osc2Transp,osc2Det,sub", "A"],
    ["фильтр Wavetable", "wavetable:fltDown,fltRes,fltDrive,fltUp", "Am"],
    ["хор в Wavetable", "wavetable:uni,uniAmt,shimmer,rel", "Am"],
    ["тембр шевелится сам", "wavetable:pos,matrix,lfoRate,atk", "Am"],
    ["генераторы Meld", "meld:oscA,m1,m2", "A"],
    ["необычные фильтры Meld", "meld:fA,fType,fM1", "Am"],
    ["два слоя Meld", "meld:bVol,oscB,bTransp,bDet", "Am"],
    ["воздух и ширина Meld", "meld:atk,rel,spread,stack", "Am"],
    ["грязный Meld", "meld:oscA,drive,fA,m1", "A"],
    ["молоточек Electric", "electric:stiff,force,color", "Am"],
    ["звукосниматель Electric", "electric:sym,model,rel,decay", "Am"],
    ["что звенит в Collision", "collision:type,decay,material", "A"],
    ["колокол в Collision", "collision:type,inharm,bright,mallet,noise", "A"],
    ["струна Tension", "tension:exciter,decay,pos,body,vib", "A"],
    ["режимы Simpler", "simpler:slice,oneShot,classic", "C4 E4 G4"],
    ["высота и фильтр Simpler", "simpler:transp,filtOn,filtDown", "C4 E4 G4"],
    ["огибающая Simpler", "simpler:atk,rel,spread", "Am"],
    ["начало и петля в Simpler", "simpler:start,loop,warp", "C4 G4 C4"],
    ["запись по кусочкам", "simpler:slice,slices,filtOn,filtDown", ""],
    ["бас на Analog", "analog:bassShape,o2Oct,f1Down,glide", "A3 A3 C4 A3 G3 A3 E3 A3"],
    ["бас на Operator", "operator:bLevel,bassCoarse,bSus,tone", "A3 A3 C4 A3 G3 A3"],
    ["пэд на Wavetable", "wavetable:atk,rel,uni,fltDown", "Am F C G"],
    ["колокол на Operator", "operator:bLevel,bellCoarse,bFine,aRel", "A4 E5 A5"],
    ["электропиано на Electric", "electric:stiff,sym,rel", "Am7 Dm7 G7 Cmaj7"],
    ["слой: удар и тело", "operator:bLevel,bSus wavetable:atk,rel", "Am F"],
    ["слой: бас и саб", "analog:bassShape,f1Down drift:sine,oct", "A3 A3 C4 A3"],
    ["слой: струна и пэд", "tension:exciter,decay wavetable:atk,rel,fltDown", "Am F C G"],
    ["слой: колокол и хор", "collision:type,inharm meld:oscA,spread", "Am F"],
    ["слой из трёх синтезаторов", "operator:bLevel,bSus wavetable:atk,rel electric:stiff", "Am F C G"]
];
var SYNTH_TIERS = [
    ["Analog", "Analog устроен как классические синтезаторы. Всё, что знаешь по Drift, здесь на своих местах, только блоков по два."],
    ["Operator", "Operator строит звук из частот: один генератор раскачивает другой. Так получают металл, колокола и электропиано."],
    ["Wavetable", "Wavetable скользит по таблице волн, и тембр движется внутри одной ноты. Это звук современной электроники."],
    ["Meld", "Meld это два движка с генераторами и фильтрами, каких больше нигде нет. Синтезатор для необычных звуков."],
    ["струны, вилки, пластины", "Electric, Collision и Tension не рисуют волну, а считают, как звучит настоящий предмет: вилка, брусок, струна."],
    ["Simpler", "Simpler делает инструмент из любой записи: ноты, шума, голоса, барабанной петли."],
    ["один звук, разные синты", "Бас, пэд и колокол можно собрать на разных синтезаторах. Рецепт тот же, только ручки называются иначе."],
    ["слои", "Большие звуки складывают из двух и трёх синтезаторов сразу: один даёт удар, другой тело, третий воздух."]
];

function makeSynths(tier, step, dice, level) {
    var plan = SYNTH_PLANS[level - 1];
    var parts = words(plan[1]);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
        var halves = parts[i].split(":");
        var synth = SYNTHS[halves[0]];
        if (i === 1) {
            out.push(["live", "device:InstrumentGroupDevice", "Теперь слой. Щёлкни по заголовку инструмента и нажми Ctrl+G: он завернётся в Rack, в котором могут звучать несколько инструментов сразу."]);
        }
        out.push(["live", "device:" + synth[0], i === 0 ? synth[2]
            : "Слева у Rack нажми кнопку со списком цепочек и перетащи " + synth[1] + " из браузера на пустое место под цепочкой, которая уже есть: инструменты зазвучат вместе."]);
        var tasks = halves[1].split(",");
        for (var k = 0; k < tasks.length; k++) {
            var task = synth[3][tasks[k]];
            if (task[1] === "manual") {
                out.push(["manual", "", task[2]]);
            } else if (task[1] === "mode") {
                out.push(["live", "simplerMode:" + task[0], task[2]]);
            } else {
                out.push(["live", taskCheck(synth[0], task), task[2]]);
            }
        }
    }
    var keys = words(plan[2]);
    if (plan[2] !== "") {
        var closing = many(/^[A-G][#b]?[0-9]$/.test(keys[0]) || keys[0].length === 1 ? "note" : "chord", plan[2],
                           parts.length > 1 ? "Сыграй и послушай слой целиком. Громкость каждого инструмента правится в списке цепочек."
                                            : "Сыграй и послушай, что получилось.");
        for (var c = 0; c < closing.length; c++) {
            out.push(closing[c]);
        }
    }
    return { kind: "tour", data: out, name: plan[0],
             hint: "Новый инструмент встанет на место прежнего. Жалко свой звук: сохрани его значком дискеты в заголовке." };
}

// ---- courses: the sequencer and the song

// A course written as plans: every lesson is a row of tasks from one table.
// A task is one step, or a list of steps made by many().
function fromPlans(tasks, plans, hint) {
    return function (tier, step, dice, level) {
        var plan = plans[level - 1];
        var keys = words(plan[1]);
        var out = [];
        for (var i = 0; i < keys.length; i++) {
            var task = tasks[keys[i]];
            if (!task) {
                throw new Error("no task " + keys[i]);
            }
            out = out.concat(task[0] instanceof Array ? task : [task]);
        }
        return { kind: "tour", data: out, name: plan[0], hint: hint };
    };
}

var SEQ_TASKS = {
    newClip: ["live", "clipAdded", "Дважды щёлкни по пустой ячейке этой дорожки: появится пустой MIDI-клип длиной в один такт, а внизу откроется редактор нот."],
    draw4: ["live", "notesAdded:4", "Нажми B: мышь станет карандашом. Щёлкни в сетке четыре раза, по ноте на каждую долю такта. Щелчок по ноте стирает её."],
    draw8: ["live", "notesAdded:8", "Карандашом (B) нарисуй восемь нот. Высоту выбирай по клавишам слева: щёлкни по клавише и услышишь ноту."],
    draw16: ["live", "notesAdded:16", "Нарисуй шестнадцать нот: заполни всю петлю. Можно вести карандаш с зажатой кнопкой мыши, ноты лягут подряд."],
    more4: ["live", "notesAdded:4", "Измени копию: добавь в неё ещё четыре ноты там, где рисунку не хватает движения."],
    play: ["live", "clipPlaying", "Запусти клип: треугольник слева от его названия в ячейке. Рисунок играет по кругу."],
    stop: ["live", "stopped", "Останови Ableton пробелом."],
    len2: ["live", "clipLength:8:8", "В панели клипа слева найди раздел Loop и поле Length. Поставь 2.0.0: петля стала длиной в два такта."],
    len4: ["live", "clipLength:16:16", "В разделе Loop поставь Length 4.0.0: четыре такта. Это обычная длина музыкальной фразы."],
    len1: ["live", "clipLength:4:4", "Поставь Length 1.0.0: играет только первый такт, а ноты второго ждут своего часа."],
    loopOff: ["live", "clipLoopOff", "В панели клипа выключи кнопку Loop: клип сыграет один раз и замолчит. Так делают разовые вставки."],
    loopOn: ["live", "clipLoopOn", "Включи Loop обратно: клип снова ходит по кругу."],
    grid: ["manual", "", "Сетка решает, куда встают ноты. Ctrl+1 делает её мельче, Ctrl+2 крупнее. Поставь 1/8 и посмотри, как изменились клетки. Жми готово."],
    grid16: ["manual", "", "Нажимай Ctrl+1, пока сетка не станет 1/16: это самая ходовая сетка для баса, хэтов и арпеджио. Жми готово."],
    melody: ["live", "clipPitches:5", "Нарисуй мелодию хотя бы из пяти разных по высоте нот. Соседние клавиши дают плавную линию, скачки дают характер."],
    chord: ["live", "clipStack:3", "Нарисуй аккорд: три ноты одна над другой в одном столбце сетки. Например A, C и E, это Am."],
    long: ["live", "clipLong:2", "Наведи мышь на правый край ноты и потяни: сделай её длиной в две доли или больше. Длинные ноты поют, короткие стучат."],
    soft: ["live", "clipVel:1:60", "Под нотами стоят столбики Velocity: сила удара. Опусти столбик одной ноты ниже середины: она зазвучит тише и мягче."],
    loud: ["live", "clipVel:120:127", "А столбик другой ноты подними до самого верха: это акцент. Разная сила нот и делает рисунок живым."],
    erase: ["live", "notesRemoved:2", "Сотри две ноты: выдели каждую щелчком и нажми Delete. Пауза тоже часть ритма."],
    copy: ["live", "notesAdded:3", "Выдели ноты рамкой и нажми Ctrl+D: копия встанет сразу за ними. Так рисунок продолжают без карандаша."],
    shift: ["manual", "", "Выдели ноты и подвигай их стрелками вверх и вниз: каждый шаг это полутон. Shift со стрелкой двигает сразу на октаву. Жми готово."],
    triplet: ["live", "clipOffGrid", "Нажми Ctrl+3: сетка стала триольной, доля делится на три. Нарисуй три ноты подряд внутри одной доли."],
    nudge: ["live", "clipOffGrid", "Нажми Ctrl+4: сетка перестала притягивать. Сдвинь одну ноту мышью чуть раньше или чуть позже её клетки."],
    quant: ["live", "clipOnGrid", "Снова Ctrl+4, чтобы сетка притягивала. Выдели все ноты (Ctrl+A) и нажми Ctrl+U: каждая встала на своё место. Это квантизация."],
    offbeat: ["live", "clipOffBeat", "Нарисуй ноты между долями, ровно посередине. Такой ритм называют синкопой: он качает."],
    bassLine: ["live", "notesAdded:4", "Напиши бас: по одной ноте в начале каждого такта, в нижней части клавиатуры. Возьми A, F, C и G: это основы аккордов Am, F, C и G."],
    bassLong: ["live", "clipLong:3", "Растяни басовые ноты почти на весь такт: бас должен гудеть под аккордами, а не тыкать."],
    octave: ["live", "notesAdded:4", "Оживи бас: после каждой ноты добавь ту же ноту октавой выше, коротко. Получится качающий октавный бас."],
    chords4: ["live", "notesAdded:12", "Напиши четыре аккорда, по одному на такт: Am, F, C и G. В каждом три ноты друг над другом, всего двенадцать."],
    stab: ["live", "clipOffBeat", "Сделай из аккорда стэб: укороти его и скопируй так, чтобы он звучал между долями. Короткие аккорды мимо сильной доли это приём хауса."],
    arpNotes: ["live", "clipPitches:3", "Разложи аккорд на ноты: нарисуй A, C и E по очереди, восьмыми, вверх и обратно. Это арпеджио."],
    answer: ["live", "notesAdded:3", "Вопрос и ответ: первая половина петли задаёт фразу, вторая отвечает похожей, но с другим концом. Допиши ответ хотя бы из трёх нот."],
    dupLoop: ["live", "clipLength:8:8", "В панели нот найди кнопку Duplicate (в старых версиях Dupl. Loop): петля стала длиной в два такта, а ноты скопировались во второй."],
    vary: ["live", "notesAdded:1", "Во втором такте измени конец: добавь ноту или две. Повтор с маленьким отличием держит внимание лучше, чем точная копия."],
    varyErase: ["live", "notesRemoved:1", "Во втором такте сотри последнюю ноту: пауза перед повтором работает как вдох."],
    dupClip: ["live", "clipAdded", "Щёлкни по клипу в ячейке и нажми Ctrl+D: копия появится ячейкой ниже. В ней можно менять что угодно, оригинал останется цел."],
    genRhythm: ["live", "notesAdded:1", "Слева от нот открой вкладку Generate, выбери в списке Rhythm и нажми кнопку Generate: Ableton сам набросает ритм. Ручки Steps и Density меняют его."],
    genSeed: ["live", "notesAdded:1", "На вкладке Generate выбери Seed: он сыплет случайные ноты в заданных пределах высоты и длины. Жми Generate, пока не понравится."],
    genStacks: ["live", "clipStack:3", "На вкладке Generate выбери Stacks: он строит аккорды по выбранной форме. Нажми Generate."],
    genShape: ["live", "notesAdded:1", "На вкладке Generate выбери Shape: нарисуй мышью линию, и ноты пойдут по ней вверх и вниз. Нажми Generate."],
    arpeggiate: ["manual", "", "Выдели аккорд, открой вкладку Transform и выбери Arpeggiate: аккорд рассыпался на ноты по одной. Ручка Rate задаёт их частоту. Жми готово."],
    strum: ["manual", "", "Выдели аккорд, на вкладке Transform выбери Strum и потяни линию: ноты аккорда берутся не разом, а перебором, как на гитаре. Жми готово."],
    humanize: ["manual", "", "Выдели все ноты и в панели Pitch and Time прибавь Humanize: ноты чуть сдвинутся с сетки, как у живого музыканта. Жми готово."],
    legato: ["live", "clipLong:1", "Выдели все ноты (Ctrl+A) и в панели Pitch and Time нажми Legato: каждая нота тянется до следующей, паузы исчезли."],
    scale: ["live", "scaleOn", "Вверху рядом с темпом включи кнопку Scale и выбери гамму, например A Minor. Редактор подсветит её ноты, а генераторы будут брать только их."],
    fold: ["manual", "", "В редакторе нот включи кнопку Scale рядом с Fold: в сетке остались только ноты гаммы. Теперь мимо не нарисуешь. Жми готово."],
    scene: ["live", "sceneAdded", "Сцена это строка клипов, которые играют вместе. Нажми Ctrl+I: под выбранной сценой появится новая, пустая."],
    capture: ["live", "sceneAdded", "Пока клип играет, нажми Ctrl+Shift+I: Ableton соберёт всё, что сейчас звучит, в новую сцену."],
    launchScene: ["live", "clipPlaying", "Справа, в столбце Main, у каждой сцены свой треугольник. Нажми его у сцены с клипом: все клипы строки стартуют разом."],
    quantFast: ["live", "quantChanged", "Вверху слева, рядом с метрономом, стоит список квантизации запуска, обычно в нём 1 Bar. Выбери 1/4: клип будет стартовать с ближайшей доли."],
    quantBar: ["live", "quantChanged", "Верни в списке 1 Bar: запущенный клип ждёт начала такта и всегда вступает ровно."],
    stopSlot: ["manual", "", "Квадратик в пустой ячейке останавливает клип своей дорожки, когда запускают сцену. Ctrl+E по ячейке убирает и возвращает его. Попробуй и жми готово."],
    follow: ["manual", "", "Открой клип и найди в его панели раздел Follow Action. Включи его и выбери Next: доиграв, клип сам запустит тот, что под ним. Жми готово."],
    rename: ["manual", "", "Выдели клип, нажми Ctrl+R и дай ему имя: бас, куплет, сбивка. Правой кнопкой мыши можно выбрать цвет. С именами в проекте не теряешься. Жми готово."],
    arm: ["live", "armed", "Включи на этой дорожке кнопку записи (Arm), если она выключена."],
    metro: ["live", "metronomeOn", "Включи метроном: с ним запись ляжет в сетку."],
    countIn: ["live", "countInOn", "Щёлкни по стрелке рядом с метрономом и выбери Count-In, 1 Bar: перед записью Ableton отсчитает такт, и ты успеешь поставить руки."],
    rec: ["live", "clipAdded", "Нажми кружок в пустой ячейке этой дорожки и сыграй два такта. Чтобы закончить запись, щёлкни по треугольнику клипа."],
    recQuant: ["live", "quantizeOn", "В меню Edit открой Record Quantization и выбери Sixteenth-Note Quantization: сыгранные ноты сразу встанут на сетку."],
    overdub: ["live", "sessionRecord", "Пусть клип играет. Нажми вверху пустой кружок Session Record, он правее кнопок стоп и запись: теперь всё сыгранное добавляется в клип."],
    layer: ["live", "notesAdded:4", "Сыграй поверх петли ещё хотя бы четыре ноты: второй слой ложится на первый. Так собирают партию по одному слою."],
    captureMidi: ["live", "clipAdded", "Поиграй что-нибудь без записи, а потом нажми Ctrl+Shift+C: Ableton достанет сыгранное из памяти и сделает клип."],
    stepRec: ["live", "notesAdded:4", "Запись по шагам: в редакторе нот включи значок наушников, зажми клавишу на клавиатуре и нажми стрелку вправо на компьютере. Нота легла, курсор шагнул. Набери так четыре ноты."]
};

// name of the lesson (empty = the name of the tier), tasks
var SEQ_PLANS = [
    ["первый клип", "newClip draw4 play stop"],
    ["сетка", "newClip grid draw8 play stop"],
    ["два такта", "newClip len2 draw8 play stop"],
    ["петля и разовый клип", "newClip draw4 loopOff loopOn play stop"],
    ["четыре такта шестнадцатыми", "newClip len4 grid16 draw16 play stop"],
    ["мелодия", "newClip melody play stop"],
    ["аккорд и длинная нота", "newClip chord long play stop"],
    ["тихо и громко", "newClip draw4 soft loud play stop"],
    ["стереть и передвинуть", "newClip draw8 erase shift"],
    ["копия нот", "newClip chord copy melody soft"],
    ["шестнадцатые с паузами", "newClip grid16 draw16 erase play stop"],
    ["синкопа", "newClip draw4 offbeat play stop"],
    ["триоли", "newClip triplet play stop"],
    ["квантизация", "newClip draw4 nudge quant"],
    ["акценты в синкопе", "newClip draw8 offbeat soft loud play stop"],
    ["бас", "newClip len4 bassLine bassLong play stop"],
    ["октавный бас", "newClip len4 bassLine octave play stop"],
    ["аккорды", "newClip len4 chords4 play stop"],
    ["стэбы", "newClip chord stab play stop"],
    ["мелодия: вопрос и ответ", "scale fold newClip len2 melody answer play stop"],
    ["удвоить петлю", "newClip draw4 dupLoop vary play stop"],
    ["пауза перед повтором", "newClip draw8 dupLoop varyErase play stop"],
    ["копия клипа", "newClip chord dupClip erase"],
    ["петля короче нот", "newClip len2 draw8 len1 len2 play stop"],
    ["арпеджио", "newClip arpNotes copy dupLoop vary play stop"],
    ["генератор Rhythm", "newClip genRhythm play stop"],
    ["генератор Seed", "scale newClip genSeed play stop"],
    ["генератор Stacks", "newClip genStacks play stop"],
    ["Strum и Arpeggiate", "newClip chord strum arpeggiate"],
    ["Shape, Legato, Humanize", "newClip genShape legato humanize play stop"],
    ["новая сцена", "newClip draw4 scene launchScene stop"],
    ["две версии клипа", "newClip draw4 dupClip more4 launchScene stop"],
    ["когда вступает клип", "quantFast newClip draw4 play quantBar stop"],
    ["собрать сцену из играющего", "newClip draw4 play capture stopSlot stop"],
    ["имена и цепочки клипов", "newClip draw4 rename dupClip follow play stop"],
    ["запись в ячейку", "arm metro rec play stop"],
    ["отсчёт перед записью", "arm countIn metro rec play stop"],
    ["запись сразу ровно", "recQuant arm rec play stop"],
    ["наложение слоёв", "arm rec play overdub layer stop"],
    ["по шагам и из памяти", "arm newClip stepRec captureMidi play stop"]
];
var SEQ_TIERS = [
    ["клип и сетка", "Секвенсор Ableton это клип с сеткой: ноты в нём не играют, а рисуют. Начнём с пустого клипа, карандаша и петли."],
    ["высота, длина, сила", "У ноты три свойства: какая клавиша, сколько длится и с какой силой взята. Все три правятся мышью."],
    ["ритм по сетке", "Ритм это то, где ноты стоят во времени. Мелкая сетка, синкопы, триоли и квантизация."],
    ["бас, аккорды, мелодия", "Три партии, из которых сложен почти любой трек. Каждую можно написать мышью, не играя."],
    ["длина и вариации", "Петля в один такт быстро надоедает. Удвоение, вариации и копии клипа растягивают идею."],
    ["генераторы Live 12", "Ableton умеет сам набросать ритм, мелодию и аккорды, а потом переделать их. Идеи появляются за секунды."],
    ["сцены", "Клипы стоят в сетке сцен. Сцена это готовый кусок трека: куплет, припев, пауза."],
    ["запись петли", "Сыграть бывает быстрее, чем рисовать. Отсчёт, запись в ячейку, наложение слоёв и запись по шагам."]
];

var SONG_TASKS = {
    haveClip: ["live", "hasClip", "Для урока на этой дорожке нужен хотя бы один клип с нотами. Если его нет, нарисуй или запиши любую петлю."],
    haveArr: ["live", "arrClips:1", "Для урока на ленте этой дорожки нужен клип. Если лента пуста, зажми мышью клип в сетке сцен, нажми Tab и отпусти его на ленте."],
    scene: ["live", "sceneAdded", "Каждая часть трека это сцена, строка клипов. Нажми Ctrl+I: появится новая сцена."],
    dupScene: ["live", "sceneAdded", "Щёлкни по сцене справа, в столбце Main, и нажми Ctrl+D: вся строка скопируется вниз. Новую часть удобнее делать из копии старой."],
    names: ["manual", "", "Выдели сцену справа и нажми Ctrl+R. Назови первую Intro, вторую Verse, третью Drop. Имена превращают набор петель в план трека. Жми готово."],
    nameOutro: ["manual", "", "Назови последнюю сцену Outro (Ctrl+R): это концовка. В ней трек не обрывается, а расходится по частям, как гости после праздника. Жми готово."],
    launch: ["live", "clipPlaying", "Запусти сцену треугольником справа: все её клипы вступают вместе."],
    stop: ["live", "stopped", "Останови Ableton пробелом."],
    order: ["manual", "", "Сыграй трек сценами: Intro, Verse, Drop, снова Verse и Drop, потом Outro. Стрелки вверх и вниз выбирают сцену, Enter запускает. Жми готово."],
    thin: ["manual", "", "В копии сцены удали один или два клипа клавишей Delete: получится тихая часть. Вступление почти всегда делают вычитанием, а не сочинением. Жми готово."],
    grow: ["live", "notesAdded:2", "Открой клип этой дорожки в копии сцены и добавь пару нот: часть стала плотнее. Так куплет подрастает к кульминации."],
    breakScene: ["manual", "", "Сделай сцену-паузу: в новой пустой сцене оставь один клип, например аккорды, без барабанов и баса. После паузы удар звучит вдвое сильнее. Жми готово."],
    mute: ["live", "muted", "Выключи эту дорожку: кнопка с её номером в микшере. Послушай трек без неё. Если стало не хуже, в этой части она лишняя."],
    unmute: ["live", "unmuted", "Включи дорожку обратно."],
    solo: ["live", "soloed", "Нажми на этой дорожке S: звучит только она. Так проверяют, что партия хороша сама по себе."],
    unsolo: ["live", "unsoloed", "Выключи S: дорожка вернулась в общий звук."],
    arr: ["live", "arrangement", "Нажми Tab: откроется аранжировка, лента времени слева направо. Здесь трек собирают от начала до конца."],
    sess: ["live", "session", "Tab возвращает к сценам."],
    recArr: ["live", "recordOn", "Нажми вверху кружок записи (Arrangement Record, клавиша F9): Ableton пойдёт и начнёт писать на ленту всё, что ты запускаешь."],
    playScenes: ["manual", "", "Пока идёт запись, запускай сцены одну за другой, каждую тактов на восемь: Intro, Verse, Drop, Outro. Ты играешь аранжировку вживую. Жми готово."],
    arrClips: ["live", "arrClips:1", "Всё сыгранное теперь лежит на ленте клипами. Если лента этой дорожки пуста, запиши ещё раз: клип должен играть во время записи."],
    back: ["manual", "", "Дорожки на ленте серые? Значит, ими всё ещё управляют клипы сцен. Нажми оранжевую кнопку Back to Arrangement над лентой справа: играет записанное. Жми готово."],
    playOver: many("chord", "Am F C G", "Запись идёт. Сыграй аккорды поверх того, что уже есть на ленте."),
    armed: ["live", "armed", "Включи на этой дорожке кнопку записи (Arm)."],
    locator: ["live", "locatorAdded", "Поставь курсор в начало части, щёлкни правой кнопкой мыши по линейке над лентой и выбери Add Locator. Дай ему имя части: Intro, Verse, Drop."],
    locator2: ["live", "locatorAdded", "Поставь ещё один локатор в начале следующей части. По локаторам видна вся форма трека, а двойной щелчок по локатору переносит туда."],
    loopPart: ["live", "loopOn", "Выдели мышью кусок ленты и нажми Ctrl+L: он играет по кругу. Так работают над одним местом, не слушая весь трек."],
    loop8: ["live", "loopLength:32:32", "Сделай петлю ровно в восемь тактов: выдели на ленте восемь тактов и нажми Ctrl+L. Длина видна вверху справа."],
    loop16: ["live", "loopLength:64:64", "Сделай петлю в шестнадцать тактов: это длина одной части во многих жанрах."],
    loopOff: ["live", "loopOff", "Выключи петлю кнопкой вверху, рядом с её длиной: трек снова идёт от начала до конца."],
    split: ["live", "arrClipAdded", "Щёлкни внутри клипа этой дорожки на ленте и нажми Ctrl+E: клип разрезан надвое. Половинки можно двигать и удалять отдельно."],
    consolidate: ["manual", "", "Выдели на ленте несколько клипов подряд и нажми Ctrl+J: они склеятся в один. Жми готово."],
    dupTime: ["live", "songLonger", "Выдели на ленте часть целиком, сверху донизу по всем дорожкам, и нажми Ctrl+Shift+D: копия встанет следом, а всё остальное сдвинется."],
    cutTime: ["manual", "", "Лишний кусок удаляют вместе со временем: выдели его и нажми Ctrl+Shift+Delete. Всё, что было справа, подъедет. Жми готово."],
    silence: ["live", "songLonger", "Выдели на ленте один такт и нажми Ctrl+I: в этом месте появится тишина, а всё, что справа, отодвинется. Так освобождают место для новой части."],
    autoMode: ["manual", "", "В аранжировке нажми A: дорожки покажут линии автоматизации. Это графики того, как ручки двигаются по ходу трека. Жми готово."],
    autoArm: ["live", "automationArm", "Включи вверху кнопку Automation Arm: теперь движения ручек записываются."],
    af: ["live", "device:AutoFilter2,AutoFilter", "Поставь на эту дорожку Auto Filter из раздела Audio Effects: им удобно управлять яркостью целой партии."],
    afDown: ["live", "knob:AutoFilter2,AutoFilter:Frequency:down", "Закрой фильтр ручкой частоты: партия ушла под воду. С такого звука начинают нарастание."],
    afUp: ["live", "knob:AutoFilter2,AutoFilter:Frequency:up", "Теперь медленно открой фильтр: звук выходит на свет. Восемь тактов такого движения, и слушатель ждёт удара."],
    sweep: ["manual", "", "Запиши это движение: нажми F9 и за восемь тактов медленно открой фильтр. Останови. На дорожке осталась красная линия: дальше фильтр открывается сам. Жми готово."],
    fade: ["manual", "", "Нарисуй затухание: нажми A, выбери на дорожке Mixer и Track Volume, поставь две точки в конце трека и опусти вторую до низа. Жми готово."],
    count: ["manual", "", "Посчитай дорожки, которые звучат в самой громкой части, и в самой тихой. Энергию делают числом партий: в начале две или три, на пике все. Жми готово."],
    fill: ["live", "notesAdded:3", "Открой клип этой дорожки и добавь в самом конце петли три быстрые ноты: это сбивка, она объявляет перемену."],
    gap: ["live", "notesRemoved:1", "Сотри в клипе последнюю ноту перед концом петли: короткая тишина перед ударом действует сильнее любого эффекта."],
    throwSend: ["live", "sendUp", "Пока клип играет, поверни вправо посыл A этой дорожки (Send A): хвост ревербератора заполняет паузу между частями."],
    sendBack: ["manual", "", "С началом новой части верни посыл влево. Такой бросок в эхо на последней ноте фразы называют delay throw. Жми готово."],
    crash: ["manual", "", "На первую долю новой части ставят удар тарелки (Crash), а перед ней тот же звук задом наперёд: в аудиоклипе это кнопка Rev. Найди её в любом аудиоклипе. Жми готово."],
    house: ["live", "tempo:120:128", "Хаус. Поставь его темп: от 120 до 128. Части длятся по 16 и 32 такта, а вступление из одних барабанов нужно диджею, чтобы свести треки."],
    techno: ["live", "tempo:128:140", "Техно. Поставь темп от 128 до 140. Ноты почти не меняются, развитие идёт тембром: фильтры, эхо, новые хэты каждые 16 тактов."],
    trap: ["live", "tempo:130:150", "Трэп. Поставь темп от 130 до 150. Вступление короткое, 4 или 8 тактов, хук 8 тактов, куплет 16. Перед хуком бит на такт выключают."],
    dnb: ["live", "tempo:170:176", "Драм-н-бейс. Поставь темп от 170 до 176. Вступление 16 или 32 такта без баса, потом нарастание и дроп с басом на 32 такта."],
    lofi: ["live", "tempo:70:90", "Лоу-фай. Поставь темп от 70 до 90. Трек короткий, минуты на две: петля аккордов, барабаны входят через 4 такта, в середине ненадолго уходят."],
    form: ["manual", "", "Теперь разметь форму: поставь локаторы там, где у этого жанра меняются части, и подпиши их. План готов раньше, чем написаны ноты. Жми готово."],
    reference: ["live", "newTrack", "Создай аудиодорожку (Ctrl+T) и перетащи на неё любимый трек того жанра, в котором пишешь. Это образец, по которому сверяют форму и громкость."],
    refQuiet: ["manual", "", "Убавь громкость образца, чтобы он не оглушал, и выключи на его клипе Warp, если он есть: трек должен звучать как в оригинале. Жми готово."],
    refMarks: ["manual", "", "Слушай образец и ставь локаторы там, где в нём что-то меняется. Получится готовый план: сколько тактов длится каждая часть. Жми готово."],
    rule8: ["manual", "", "Правило восьми тактов: каждые 8 тактов в треке что-то меняется. Вошёл хэт, ушёл бас, открылся фильтр. Найди место, где 16 тактов подряд ничего не происходит, и измени его. Жми готово."],
    ending: ["manual", "", "Сделай концовку: в последних 8 или 16 тактах убирай партии по одной, начиная с баса и бочки. Последней остаётся та, что была первой. Жми готово."],
    length: ["live", "songLength:128", "Проверь длину: набросок должен занять на ленте не меньше 32 тактов. Если он короче, продли части копированием (Ctrl+Shift+D)."],
    listen: ["manual", "", "Послушай трек от начала до конца, ничего не трогая, и запиши, где стало скучно. Именно там нужна перемена. Жми готово."],
    exportAll: ["manual", "", "Выдели весь трек на ленте (Ctrl+A) и нажми Ctrl+Shift+R. Формат WAV, кнопка Export. Послушай файл в наушниках и на телефоне: там слышно другое. Жми готово."],
    save: ["manual", "", "Сохрани проект (Ctrl+S). Через File и Collect All and Save Ableton сложит все использованные звуки в папку проекта: его можно переносить на другой компьютер. Жми готово."]
};

var SONG_PLANS = [
    ["части это сцены", "haveClip scene scene names launch stop"],
    ["куплет и кульминация", "haveClip dupScene grow launch stop"],
    ["вступление", "haveClip dupScene thin launch stop"],
    ["концовка", "haveClip dupScene thin nameOutro launch stop"],
    ["трек сценами", "haveClip launch order stop"],
    ["вычитание", "haveClip launch mute unmute stop"],
    ["партия сама по себе", "haveClip launch solo unsolo stop"],
    ["пауза перед ударом", "haveClip scene breakScene launch stop"],
    ["копия растёт", "haveClip dupScene grow dupScene grow launch stop"],
    ["четыре сцены", "haveClip dupScene dupScene dupScene names nameOutro order"],
    ["лента и сцены", "haveClip arr sess"],
    ["запись на ленту", "haveClip recArr launch stop arr arrClips back sess"],
    ["аранжировка вживую", "haveClip recArr launch playScenes stop arr arrClips sess"],
    ["доиграть поверх", "arr haveArr armed recArr playOver stop sess"],
    ["вернуться к записанному", "haveClip launch arr back stop sess"],
    ["локаторы", "arr locator locator2 sess"],
    ["петля на ленте", "arr loopPart loop8 loopOff sess"],
    ["разрезать и склеить", "arr haveArr split consolidate sess"],
    ["повторить часть", "arr haveArr dupTime cutTime sess"],
    ["место для новой части", "arr haveArr silence locator sess"],
    ["фильтр растит напряжение", "af afDown afUp"],
    ["записать движение ручки", "af afDown arr autoMode autoArm sweep sess"],
    ["энергия числом партий", "haveClip launch count mute unmute stop"],
    ["тишина перед ударом", "haveClip gap launch stop"],
    ["затухание в конце", "arr autoMode fade sess"],
    ["сбивка", "haveClip fill launch stop"],
    ["хвост эха", "haveClip launch throwSend sendBack stop"],
    ["фильтр на стыке", "af haveClip launch afDown afUp stop"],
    ["тарелка и реверс", "arr locator crash sess"],
    ["переход целиком", "af haveClip fill launch afDown throwSend afUp sendBack stop"],
    ["форма хауса", "house arr loop16 locator locator2 form sess"],
    ["форма техно", "techno arr loop16 locator form sess"],
    ["форма трэпа", "trap arr loop8 locator locator2 form sess"],
    ["форма драм-н-бейса", "dnb arr loop16 locator locator2 form sess"],
    ["форма лоу-фая", "lofi arr loop8 locator form sess"],
    ["образец", "reference refQuiet arr refMarks locator sess"],
    ["правило восьми тактов", "arr loopPart loop8 rule8 loopOff sess"],
    ["как закончить трек", "arr haveArr ending fade sess"],
    ["длина и свежие уши", "arr length listen sess"],
    ["готовый трек", "arr length loopPart loopOff exportAll save sess"]
];
var SONG_TIERS = [
    ["части трека", "Трек это не одна петля, а части: вступление, куплет, кульминация, концовка. В Ableton каждая часть это сцена."],
    ["из петли в части", "Новые части делают из одной петли: копируют сцену и убирают или добавляют партии. Сочинять заново почти не приходится."],
    ["запись на ленту", "Сцены играют вживую, а Ableton пишет это в аранжировку. Так набросок за пять минут получает начало и конец."],
    ["лента времени", "В аранжировке трек лежит слева направо. Локаторы, петля, разрезание и вставка времени это инструменты монтажа."],
    ["энергия", "Трек держит внимание, когда энергия растёт и спадает. Её двигают фильтром, громкостью и числом партий."],
    ["переходы", "Стык двух частей готовят заранее: сбивка, пауза, хвост эха. Без перехода новая часть сваливается как снег на голову."],
    ["форма по жанрам", "У каждого жанра свой привычный план: сколько тактов длится часть и когда приходит кульминация."],
    ["от наброска к треку", "Последние шаги: сверить форму с любимым треком, проверить длину, закончить, сохранить и выгрузить файл."]
];

// ---- course: the way four artists work

// Globular, Soulacybin, Symbolico and The Algorithm: five lessons on the
// sound and five on the composition of each. What the artists have said
// themselves is in the tier texts; where no account was found (of Symbolico and
// Soulacybin there is none about their tools), the lessons teach the craft of their
// genres with the devices of Live and say so.
var MASTER_TASKS = {
    // the instruments and effects a lesson needs
    drift: ["live", "device:Drift", "Для урока нужен Drift на этой дорожке. Если стоит другой инструмент, перетащи Drift из раздела Instruments."],
    operator: ["live", "device:Operator", "Перетащи на эту дорожку Operator из раздела Instruments."],
    wavetable: ["live", "device:InstrumentVector", "Перетащи на эту дорожку Wavetable из раздела Instruments."],
    collision: ["live", "device:Collision", "Перетащи на эту дорожку Collision из раздела Instruments: он звучит как дерево, металл и кожа."],
    tension: ["live", "device:StringStudio", "Перетащи на эту дорожку Tension из раздела Instruments: это струна, почти гитара."],
    echo: ["live", "device:Echo", "Поставь после инструмента Echo из раздела Audio Effects: в дабе эхо это второй инструмент."],
    reverb: ["live", "device:Reverb", "Поставь на дорожку Reverb из раздела Audio Effects."],
    saturator: ["live", "device:Saturator", "Поставь на дорожку Saturator из раздела Audio Effects."],
    repeat: ["live", "device:BeatRepeat", "Поставь на дорожку Beat Repeat из раздела Audio Effects: он ловит кусок звука и повторяет его."],
    grain: ["live", "device:GrainDelay", "Поставь на дорожку Grain Delay из раздела Audio Effects: он крошит звук на зёрна."],
    vowel: ["live", "device:AutoFilter2", "Поставь на дорожку Auto Filter из раздела Audio Effects."],
    amp: ["live", "device:Amp", "Поставь после инструмента Amp из раздела Audio Effects: это гитарный усилитель."],
    cabinet: ["live", "device:Cabinet", "Сразу за Amp поставь Cabinet: без колонки усилитель звучит как бритва."],
    pedal: ["live", "device:Pedal", "Поставь на дорожку Pedal из раздела Audio Effects: это педаль перегруза."],
    redux: ["live", "device:Redux2,Redux", "Поставь на дорожку Redux из раздела Audio Effects."],
    arp: ["live", "device:MidiArpeggiator", "Из раздела MIDI Effects перетащи Arpeggiator на эту дорожку."],
    arpOrder: ["live", "order:MxDeviceMidiEffect:MidiArpeggiator", "Arpeggiator должен стоять правее тренажёра и левее инструмента. Если он встал иначе, перетащи его за заголовок."],
    echoReturn: ["live", "returnDevice:Echo,Delay", "На дорожке возврата должно стоять эхо. Если там только Reverb, перетащи на возврат Echo или Delay."],
    // Drift
    mono: ["live", "voice:Mono", "В списке Mode у Drift выбери Mono: один голос, ноты не налезают друг на друга."],
    unison: ["live", "voice:Unison", "В списке Mode у Drift выбери Unison: каждую ноту играют четыре голоса."],
    sine: ["live", "knob:Drift:Osc 1 Wave:is Sine", "В списке волн Osc 1 выбери Sine: чистый круглый тон."],
    saw: ["live", "knob:Drift:Osc 1 Wave:is Saw", "В списке волн Osc 1 выбери Saw: яркая пила, фильтру будет что резать."],
    rect: ["live", "knob:Drift:Osc 1 Wave:is Rectangle", "В списке волн Osc 1 выбери Rectangle: пустой звук старых игровых приставок."],
    low: ["live", "knob:Drift:^(Osc 1 Oct|Transpose)$:changed", "Опусти звук на октаву ручкой Oct у Osc 1."],
    dark: ["live", "knob:Drift:LP Freq:down", "Прикрой фильтр: Freq влево (K1)."],
    squelch: ["live", "knob:Drift:LP Res:up", "Резонанс (K2) вправо, почти до упора: фильтр начинает хлюпать и петь."],
    sweep: ["live", "knob:Drift:LP Freq:moved", "Теперь води Freq (K1) туда и обратно: звук булькает. Это и есть сквелч."],
    glide: ["live", "knob:Drift:Glide Time:up", "Прибавь Glide: ноты съезжают одна в другую."],
    legato: ["live", "knob:Drift:^Legato( On)?$:on", "Включи Legato: если играть внахлёст, нота не начинается заново, а перетекает."],
    pluck: ["live", "knob:Drift:Env 1 Sustain:down", "Убери Sustain (K5) в ноль: звук становится коротким щипком."],
    short: ["live", "knob:Drift:Env 1 Release:down", "Убери Release (K6): нота обрывается сразу, как отпустишь клавишу."],
    lfo: ["live", "knob:Drift:^LP Mod Amt [12]$:moved", "В блоке Filter найди Freq Mod, выбери источник LFO и сдвинь ползунок: фильтр закачался сам."],
    lfoRate: ["live", "knob:Drift:^LFO (Freq|Ratio|Time|Synced)$:moved", "Смени скорость LFO ручкой Rate. В пси-басе её меняют всё время: четверти, восьмые, триоли."],
    wide: ["live", "knob:Drift:Strength:up", "Прибавь Strength: голоса расходятся, звук встаёт стеной."],
    // Echo and the other effects
    echoWet: ["live", "knob:Echo:Dry Wet:up", "Прибавь у Echo Dry/Wet: за каждой нотой побежали повторы."],
    echoLong: ["live", "knob:Echo:Feedback:up", "Прибавь Feedback: повторы живут дольше и наслаиваются. В дабе эту ручку крутят всю песню."],
    echoDark: ["live", "knob:Echo:LP Freq:down", "В блоке фильтра у Echo убавь LP: повторы темнеют и уходят вдаль, как на старой плёнке."],
    echoVerb: ["live", "knob:Echo:Reverb Level:up", "Прибавь Reverb у Echo: эхо расплывается в пространство."],
    echoWobble: ["live", "knob:Echo:Wobble Amt:up", "Включи у Echo Wobble и прибавь его: повторы плывут по высоте, как зажёванная лента."],
    revWet: ["live", "knob:Reverb:Dry/Wet:up", "Прибавь у Reverb Dry/Wet: звук уходит вглубь."],
    revLong: ["live", "knob:Reverb:Decay Time:up", "Прибавь Decay Time: хвост тянется несколько секунд."],
    drive: ["live", "knob:Saturator:Drive:up", "Прибавь Drive у Saturator: звук грубеет и рычит."],
    chance: ["live", "knob:BeatRepeat:Chance:up", "Прибавь Chance у Beat Repeat: чем правее, тем чаще он хватает звук и повторяет."],
    grid: ["live", "knob:BeatRepeat:Grid:changed", "Смени Grid: это длина куска. 1/16 даёт дробь, 1/32 даёт жужжание."],
    variation: ["live", "knob:BeatRepeat:Variation:up", "Прибавь Variation: длина куска каждый раз другая, и повтор перестаёт быть предсказуемым."],
    spray: ["live", "knob:GrainDelay:Spray:up", "Прибавь Spray у Grain Delay: зёрна разлетаются во времени, звук рассыпается в облако."],
    grainPitch: ["live", "knob:GrainDelay:Pitch:changed", "Сдвинь Pitch у Grain Delay на 12 вверх: над звуком повисает его призрак октавой выше."],
    grainWet: ["live", "knob:GrainDelay:DryWet:up", "Прибавь DryWet у Grain Delay, чтобы облако стало слышно."],
    vowelType: ["live", "knob:AutoFilter2:Filter Type:changed", "В списке типов фильтра у Auto Filter выбери Vowel: фильтр начинает выговаривать гласные."],
    vowelMove: ["live", "knob:AutoFilter2:^(Formant|Frequency|Filter Morph)$:moved", "Теперь двигай главную ручку фильтра, пока играешь: бас говорит а, о, у. Так делают говорящие басы."],
    bits: ["live", "knob:Redux2,Redux:Bit Depth:down", "Убавь Bits у Redux: звук становится зернистым, как из старого компьютера."],
    gain: ["live", "knob:Amp:^(Input Gain|Gain)$:up", "Прибавь Gain у Amp: звук перегружается, как гитара в тяжёлой музыке."],
    ampType: ["live", "knob:Amp:Amp Type:changed", "В списке типов усилителя выбери Heavy или Lead: самые злые в наборе."],
    pedalDrive: ["live", "knob:Pedal:^(Drive|Gain)$:up", "Прибавь Gain у Pedal: перегруз становится плотнее."],
    // the other instruments
    fm: ["live", "knob:Operator:Osc-B Level:up", "Включи у Operator генератор B и прибавь его Level: в тоне появляются стекло и металл."],
    fmRatio: ["live", "knob:Operator:B Coarse:changed", "Смени Coarse у B: малые числа дают тёплый тон, большие дают колокольчик."],
    drop: ["live", "knob:Operator:Pe On:on", "Включи у Operator блок Pitch Env: нота будет начинаться выше и падать."],
    dropAmt: ["live", "knob:Operator:Pe Amount:changed", "Сдвинь величину Pitch Env: получается капля, бип или лазер, смотря насколько."],
    wtSwell: ["live", "knob:InstrumentVector:Amp Attack:up", "В огибающей Amp у Wavetable прибавь Attack: звук вплывает."],
    wtTail: ["live", "knob:InstrumentVector:Amp Release:up", "Прибавь Release: аккорды перетекают один в другой."],
    wtMove: ["live", "knob:InstrumentVector:Osc 1 Pos:moved", "Двигай позицию в таблице волн (K1), пока держишь аккорд: тембр медленно меняется."],
    wood: ["live", "knob:Collision:Res 1 Type:changed", "В блоке Resonator 1 у Collision выбери Marimba или Beam: деревянный стук."],
    woodLong: ["live", "knob:Collision:Res 1 Decay:moved", "Покрути Decay у резонатора: короткий стук или долгий звон."],
    pick: ["live", "knob:StringStudio:Exciter Type:changed", "В блоке Excitator у Tension выбери Plectrum: струну щиплют медиатором."],
    stringLong: ["live", "knob:StringStudio:String Decay:moved", "Покрути Decay в блоке String: как долго звучит струна."],
    arpRate: ["live", "knob:MidiArpeggiator:Synced Rate:changed", "Поставь Rate у Arpeggiator на 1/16 или 1/32: аккорд рассыпается в быструю трель."],
    // playing
    bassLine: many("note", "D3 D3 F3 A3 G3 F3 D3 C3", "Сыграй бас как мелодию: не спеша, с паузами между нотами. В псидабе бас поёт."),
    squelchLine: many("note", "D3 D4 C4 D3 A3 C4 D4 A3", "Сыграй линию внахлёст и води фильтр: ноты съезжают и хлюпают."),
    skank: many("chord", "Dm Dm G G Dm Dm Am Am", "Скэнк: бери аккорд коротко, между долями, и сразу отпускай. Считай раз-и, два-и и играй на каждое и."),
    worldLine: many("note", "D4 E4 G4 A4 G4 E4 D4", "Сыграй напев из пяти нот: так звучала бы маримба, калимба или кото."),
    octaveLine: many("note", "E3 E4 E3 E3 G3 G4 E3", "Сыграй бас с прыжками на октаву: нижняя нота держит, верхняя подпрыгивает. Это от фанка."),
    padChords: many("chord", "Am F", "Возьми два аккорда и держи каждый подолгу: слушай, как звук живёт внутри."),
    bleeps: many("note", "E5 B5 E6 B5", "Сыграй несколько высоких нот: бипы и капли, которые разлетаются по эху."),
    lowNotes: many("note", "E3 E3 G3 E3 A3 G3 E3", "Сыграй длинные низкие ноты и слушай, как качается фильтр."),
    lead: many("note", "E5 G5 A5 B5 A5 G5 E5 D5", "Сыграй фразу в верхней октаве. Потом ещё раз, и оборви её на середине."),
    riff: many("note", "E3 E3 E3 F3 E3 E3 G3 E3 F3 E3", "Сыграй риф: одна нота долбит, соседние её перебивают. Коротко и жёстко."),
    riff7: many("note", "E3 E3 G3 E3 F3 E3 A3", "Риф из семи нот. Сыграй его и сразу начни заново, без паузы: счёт получится ломаный."),
    chipChord: many("chord", "Em C D Em", "Держи аккорд, а арпеджиатор сам превратит его в трель."),
    // the project
    tempoDub: ["live", "tempo:80:110", "Поставь темп псидаба: от 80 до 110. Это медленнее шага: музыка должна покачивать, а не гнать."],
    tempoMid: ["live", "tempo:85:110", "Поставь средний темп: от 85 до 110. На странице его альбома Stazi так и стоит метка: midtempo."],
    tempoHalf: ["live", "tempo:130:144", "Поставь темп от 130 до 144. Бит будет в половинном темпе: бочка на 1, снейр на 3, и трек качает вдвое медленнее цифры."],
    tempoFast: ["live", "tempo:140:180", "Поставь быстрый темп: от 140 до 180. В такой музыке ритм должен лететь."],
    offChord: ["live", "clipOffBeat", "Нарисуй в клипе аккорд между долями, на каждое и. Globular говорит, что почти не может написать трек без слабой доли."],
    bassWrite: ["live", "notesAdded:6", "Напиши бас на всю длину петли: певучую линию из шести-восьми нот, с паузами. Тут бас это мелодия."],
    bassLong: ["live", "clipLong:2", "Растяни пару нот баса на две доли и больше: линия должна петь, а не тыкать."],
    answerWrite: ["live", "notesAdded:3", "В копии допиши ответ: три-четыре ноты выше или ниже прежних. Фраза и ответ на неё: так строят и бас, и сквелч."],
    tuneWrite: ["live", "notesAdded:4", "Нарисуй мелодию из четырёх-пяти нот и больше ничего. Лейбл хвалит его треки за простую сильную мелодию."],
    riffWrite: ["live", "notesAdded:5", "Нарисуй риф на одной-двух низких нотах: пять-семь коротких ударов с неравными промежутками."],
    len7: ["live", "clipLength:3.5:3.5", "В разделе Loop поставь Length 0.3.2: три доли и две шестнадцатых, то есть семь восьмых. Петля короче такта и поедет против ровной бочки."],
    stages: ["manual", "", "Назови сцены (Ctrl+R): туман, грув, провал, второй грув, выход. Такие треки идут минут по восемь и растут медленно: в каждой сцене прибавляется одна партия. Жми готово."],
    nature: ["manual", "", "Перетащи на новую дорожку запись природы из раздела Samples (ищи rain, forest, water) и убавь её громкость: это воздух трека. Жми готово."],
    glitchRec: ["manual", "", "Запиши движение: нажми кружок Session Record и в последнем такте фразы подними Chance до упора, а потом верни в ноль. Глитч звучит только на стыке. Жми готово."],
    hole: ["manual", "", "Провал: на один-два такта остаётся только эхо и воздух, без баса и барабанов. Чем длиннее тишина, тем сильнее возвращение. Жми готово."],
    swing: ["manual", "", "В браузере слева открой раздел Grooves, найди Swing 16ths и перетащи любой из них на клип: каждая вторая шестнадцатая опаздывает, и ритм качает, как в хип-хопе. Жми готово."],
    halfBeat: ["manual", "", "На дорожке барабанов набей бит в половинном темпе: бочка на первую долю, снейр на третью, хэты шестнадцатыми и триолями. Жми готово."],
    twoStyles: ["manual", "", "Сделай две сцены с разными барабанами: в одной бит в половинном темпе, в другой прямая бочка на каждую долю, как в пситрансе. Бас и мелодия те же. Жми готово."],
    flip: ["manual", "", "Запусти первую сцену, через восемь тактов вторую, потом обратно. Трек меняет жанр, а остаётся собой: так и работает сплав стилей. Жми готово."],
    airEnds: ["manual", "", "Сделай сцену-вступление из одного пэда и редких нот, без бита. Ею же трек и закончится: из воздуха вышел, в воздух ушёл. Жми готово."],
    guitar: ["manual", "", "Если есть гитара, запиши риф ею: аудиодорожка, вход звуковой карты, на дорожке Amp и Cabinet. Гальего начинал именно с гитары. Нет гитары, жми готово."],
    insert: ["manual", "", "Сделай сцену-вставку на четыре такта: без рифа, только синтезатор или техно-бит. Гальего говорит, что электронные куски у него звучат недолго. Жми готово."],
    surprise: ["manual", "", "Запусти риф, через восемь тактов вставку, через четыре снова риф. Смена должна прийти без предупреждения: он сам называет своей целью удивлять слушателя. Жми готово."],
    drums7: ["manual", "", "Под петлю из семи восьмых поставь ровный бит на четыре четверти. Риф каждый такт сдвигается против бочки и сходится с ней через семь тактов. Жми готово."]
};

(function () {
    var from = [[SEQ_TASKS, "newClip draw4 draw8 draw16 grid16 len2 len4 play stop triplet offbeat erase dupClip"],
                [SONG_TASKS, "haveClip scene dupScene grow launch mute unmute arr sess locator autoArm throwSend sendBack"]];
    for (var f = 0; f < from.length; f++) {
        var keys = words(from[f][1]);
        for (var k = 0; k < keys.length; k++) {
            MASTER_TASKS[keys[k]] = from[f][0][keys[k]];
        }
    }
}());

var MASTER_PLANS = [
    ["певучий бас", "drift sine mono low dark bassLine"],
    ["сквелч", "drift saw mono legato glide squelch sweep squelchLine"],
    ["даб-эхо", "drift pluck echo echoWet echoLong echoDark skank"],
    ["плёнка плывёт", "drift pluck echo echoWet echoWobble echoVerb skank"],
    ["дерево и струна", "collision wood woodLong worldLine tension pick stringLong worldLine"],
    ["темп и слабая доля", "tempoDub newClip offChord play stop"],
    ["бас ведёт", "newClip len4 bassWrite bassLong play stop"],
    ["долгое развитие", "haveClip scene scene scene stages launch stop"],
    ["бросок в эхо", "haveClip echoReturn launch throwSend sendBack stop"],
    ["вопрос и ответ", "newClip len2 bassWrite dupClip answerWrite play stop"],
    ["бас с прыжком", "drift sine mono low dark octaveLine"],
    ["живая струна", "tension pick stringLong reverb revWet worldLine"],
    ["глитч-перкуссия", "collision wood repeat chance grid variation worldLine"],
    ["облако зёрен", "wavetable wtSwell grain spray grainPitch grainWet padChords"],
    ["бипы и капли", "operator fm drop dropAmt echo echoWet bleeps"],
    ["средний темп, простая мелодия", "tempoMid newClip tuneWrite play stop"],
    ["живое рядом с синтетикой", "haveClip nature reverb revWet revLong launch stop"],
    ["глитч на стыке", "haveClip repeat chance launch autoArm glitchRec stop"],
    ["трек раскрывается", "haveClip dupScene grow dupScene grow launch stop"],
    ["провал", "haveClip launch mute hole unmute stop"],
    ["пси-бас", "drift saw mono low dark lfo lfoRate lowNotes"],
    ["говорящий бас", "drift saw mono low vowel vowelType vowelMove lowNotes"],
    ["мелодия рассыпается", "drift saw pluck repeat chance grid lead"],
    ["кислотный лид", "drift saw mono legato glide squelch echo echoWet lead"],
    ["воздух", "wavetable wtSwell wtTail wtMove reverb revWet revLong padChords"],
    ["свинг", "newClip grid16 draw8 swing play stop"],
    ["триоли поверх ровного", "newClip draw4 triplet play stop"],
    ["половинный темп", "tempoHalf halfBeat newClip bassWrite play stop"],
    ["два жанра в одном треке", "haveClip dupScene twoStyles launch flip stop"],
    ["воздух до и после", "haveClip scene airEnds launch stop"],
    ["риф без гитары", "drift saw mono low short amp gain ampType cabinet riff guitar"],
    ["злой лид", "drift saw unison wide pedal pedalDrive lead"],
    ["чип-арпеджио", "drift rect pluck arp arpOrder arpRate chipChord"],
    ["бас из стали", "operator fm fmRatio saturator drive riff"],
    ["звук крошится", "drift saw mono low redux bits repeat chance grid riff"],
    ["счёт на семь", "newClip len7 riffWrite drums7 play stop"],
    ["ломаный риф", "newClip len2 riffWrite offbeat erase play stop"],
    ["резкая смена", "haveClip scene insert launch surprise stop"],
    ["быстро и точно", "tempoFast newClip grid16 draw16 erase play stop"],
    ["тяжёлая компьютерная музыка", "drift saw mono low amp gain cabinet riff7 arr locator sess"]
];
var MASTER_TIERS = [
    ["звук Globular", "Globular пишет в Ableton, в основном его встроенными устройствами. Его псидаб держится на певучем басе, слабой доле и эхе."],
    ["композиция Globular", "Globular называет себя автором песен, а не конструктором звуков. Строим псидаб так же: от баса и слабой доли, без спешки."],
    ["звук Soulacybin", "Лейбл описывает его звук как равновесие живого и синтетического: гитара, шум природы и струнные рядом с дабом и глитчем."],
    ["композиция Soulacybin", "Его треки лейбл хвалит за простую сильную мелодию. Учимся строить трек, который раскрывается постепенно."],
    ["звук Symbolico", "Symbolico сплавляет псистеп, псидаб, глитч и пситранс. Его рассказов об инструментах не нашлось, поэтому собираем звук приёмами жанра."],
    ["композиция Symbolico", "В его биографии рядом стоят свинг, хип-хоп, даб и пситранс. Учимся качать ритм и менять жанр внутри одного трека."],
    ["звук The Algorithm", "Реми Гальего начинал с гитары и программы-барабанщика, потом добавил синтезаторы. Тяжёлый риф и электроника в одном звуке."],
    ["композиция The Algorithm", "Он хочет, чтобы музыка была непредсказуемой: ритмы всё время меняются, а электронные куски звучат недолго."]
];

var PLAN_HINT = "Делай по шагам. Не знаешь, где кнопка: наведи на неё мышь, и Ableton покажет название внизу слева.";

// id, title, short name for lesson titles, points to open, tiers, generator
// ---- courses: rare chords, chromatic notes and chords, several voices

// These three are written out lesson by lesson: kind, what to play, and the
// key the wheel shows. Five lessons to a tier, as in every course.

var COLOUR_TIERS = [
    ["уменьшённый и увеличенный", "Уменьшённое трезвучие сжато и тревожно, увеличенное растянуто и тянет дальше. Оба проходящие: на них не останавливаются, через них идут."],
    ["sus и квинты", "В аккорде sus вместо терции стоит соседняя нота, и он просит разрешения. В квинтаккорде терции нет совсем: так звучат рок и синтвейв."],
    ["шестые", "Добавленная секста делает мажор мягким, а минор горьким. C69 это мажор с секстой и ноной: аккорд без единого острого угла."],
    ["уменьшённый септаккорд", "Уменьшённый септаккорд сложен из одних малых терций и ведёт на полтона вверх. Полууменьшённый открывает минорный оборот ii V i."],
    ["нонаккорды", "Нона это нота через одну после септимы. С ней аккорд становится шире и воздушнее: звук нео-соула, хауса и лоу-фая."],
    ["острые доминанты", "У доминанты можно сдвинуть квинту или нону на полтона. Аккорд становится острее и сильнее тянет домой: приём джаза и фанка."],
    ["минор с большой септимой", "Минор с большой септимой звучит как шпионское кино, а мажор с повышенной одиннадцатой как лидийский лад: светло и невесомо."],
    ["большие аккорды", "Одиннадцатая и тринадцатая ступени: пять и шесть нот сразу. Бери их двумя руками: бас и септиму левой, краски правой."]
];
var COLOUR_LESSONS = [
    ["chords", "C Caug F C C Caug F C"], ["chords", "Am Bdim C Bdim Am Bdim C C"], ["chords", "C Caug Am F C Caug Am G"],
    ["chords", "Dm Bdim C Am Dm Bdim C C"], ["chords", "F Faug Dm Bdim C Caug F G C"],
    ["chords", "Csus4 C Gsus4 G Fsus4 F Gsus4 G C"], ["chords", "Csus2 C Fsus2 F Asus2 Am Gsus4 G"], ["chords", "C5 F5 G5 C5 A5 F5 G5 C5"],
    ["chords", "G7sus4 G7 C G7sus4 G7 C Dm G7sus4 C"], ["chords", "Csus2 Csus4 C F5 G7sus4 G7 Asus2 Am C"],
    ["chords", "C6 F6 C6 G C6 F6 G C6"], ["chords", "Am6 Dm6 Am6 E Am6 Dm6 E Am"], ["chords", "C69 F69 C69 G C69 F69 G C"],
    ["chords", "Dm7 G7 C6 C6 Fmaj7 G7 C69 C69"], ["chords", "Fm6 C Fm6 C Dm6 E Am6 Am"],
    ["chords", "C C#dim7 Dm G7 C C#dim7 Dm G7"], ["chords", "Bm7b5 E7 Am Am Bm7b5 E7 Am Am"], ["chords", "Em7 Ebdim7 Dm7 G7 Em7 Ebdim7 Dm7 G7 C"],
    ["chords", "F F#dim7 C/G A7 Dm7 G7 C"], ["chords", "Dm7b5 G7 Cm Cm Bm7b5 E7 Am Am"],
    ["chords", "Cadd9 Fadd9 Cadd9 Gadd9 Cadd9 Fadd9 Gadd9 Cadd9"], ["chords", "Dm9 G9 Cmaj9 Cmaj9 Dm9 G9 Cmaj9 Cmaj9"], ["chords", "Am9 Dm9 G9 Cmaj9 Am9 Dm9 G9 Cmaj9"],
    ["chords", "Fmaj9 Em7 Dm9 Cmaj9 Fmaj9 Em7 Dm9 Cmaj9"], ["chords", "Cmaj9 Am9 Fmaj9 G9 Em7 Am9 Dm9 G9 Cmaj9"],
    ["chords", "Dm7 G7b9 Cmaj7 Cmaj7 Dm7 G7b9 Cmaj7 Cmaj7"], ["chords", "Dm7 G7#5 Cmaj7 Cmaj7 Dm7 G7#5 C6 C6"], ["chords", "E7#9 Am7 E7#9 Am7 Dm7 E7#9 Am7 Am7"],
    ["chords", "Dm7 G7b5 Cmaj7 A7b9 Dm7 G7b5 Cmaj7 Cmaj7"], ["chords", "Bm7b5 E7b9 Am7 A7#5 Dm7 G7#9 Cmaj7 C69"],
    ["chords", "Am AmMaj7 Am7 Am6 Am AmMaj7 Am7 Am6"], ["chords", "Dm DmMaj7 Dm7 G7 Cmaj7 Dm DmMaj7 Dm7 G7 Cmaj7"],
    ["chords", "Cmaj7#11 Cmaj7 Fmaj7#11 Fmaj7 Cmaj7#11 Cmaj7 Fmaj7#11 Fmaj7"], ["chords", "Fmaj7#11 Em7 Dm7 Cmaj7 Fmaj7#11 Em7 Dm7 Cmaj7"],
    ["chords", "Am AmMaj7 Am7 D9 Fmaj7#11 E7#9 Am Am"],
    ["chords", "G11 C G11 C F G11 C C"], ["chords", "Dm11 G13 Cmaj9 Cmaj9 Dm11 G13 Cmaj9 Cmaj9"], ["chords", "Am11 Dm11 Am11 Dm11 G13 G13 Cmaj9 Cmaj9"],
    ["chords", "C13 F13 C13 G13 C13 F13 G13 C13"], ["chords", "Dm11 G13 Cmaj9 A7b9 Dm11 G7#5 C69 C69"]
];
var COLOUR_HINTS = ["", "", "", "", "Пять нот бери двумя руками: две нижние левой, три верхние правой.",
                    "Пять нот бери двумя руками: бас и септиму левой, остальное правой.", "",
                    "Шесть нот: левая берёт три нижние, правая три верхние. Порядок и октава любые."];

var CHROMA_TIERS = [
    ["проходящие ноты", "Хроматическая нота стоит между двумя нотами гаммы и соединяет их по полутонам. Она чужая, но на ней не задерживаются, и мелодия становится гладкой."],
    ["вспомогательные ноты", "К ноте аккорда подходят с соседней клавиши на полтона ниже. Так играют джазовые и фанковые линии: чужая нота тут же разрешается в свою."],
    ["блюзовые ноты", "Пониженные третья, пятая и седьмая ступени. Между минорной и мажорной терцией живёт вся блюзовая интонация."],
    ["побочные доминанты", "К любому аккорду тональности можно подвести его собственную доминанту. Появляется чужая нота, и гармония начинает двигаться вперёд."],
    ["заёмные аккорды", "Аккорды, взятые у одноимённого минора: Fm, Ab, Bb, Eb в до мажоре. Мажорная песня на миг темнеет: любимый приём рока и кино."],
    ["хроматический бас", "Бас идёт по полутонам, а аккорды над ним меняются еле заметно. На таком басу держатся баллады и босса-нова."],
    ["медианты", "Аккорды на расстоянии терции с одной общей нотой: C и E, C и Ab. Тональность будто проваливается: звук фантастики и киномузыки."],
    ["модуляция", "Чужая доминанта уводит музыку в новую тональность. Всё, что было до неё, остаётся позади: трек поднимается на новый этаж."]
];
var CHROMA_LESSONS = [
    ["notes", "C4 C#4 D4 D#4 E4 F4 F#4 G4 E4 C4"], ["notes", "G4 F#4 F4 E4 D#4 D4 C#4 C4 E4 G4"], ["notes", "E4 F4 F#4 G4 A4 G#4 G4 E4 D4 C4"],
    ["notes", "A3 B3 C4 C#4 D4 D#4 E4 G4 F#4 F4 E4"], ["notes", "C4 D4 D#4 E4 G4 G#4 A4 A#4 B4 C5 G4 E4 C4"],
    ["notes", "B3 C4 D#4 E4 F#4 G4 B4 C5"], ["notes", "C4 B3 C4 E4 D#4 E4 G4 F#4 G4 C5"], ["notes", "D#4 E4 G#4 A4 B4 C5 A4 E4"],
    ["notes", "E4 D#4 E4 G4 F#4 G4 C5 B4 C5 G4 E4 C4"], ["notes", "F#4 G4 A#4 B4 C#5 D5 B4 G4"],
    ["notes", "C4 Eb4 E4 G4 A4 G4 Eb4 E4 C4"], ["notes", "A3 C4 D4 Eb4 E4 G4 E4 Eb4 D4 C4 A3"], ["notes", "G4 Gb4 F4 Eb4 C4 Eb4 F4 Gb4 G4"],
    ["notes", "C4 E4 G4 Bb4 A4 G4 Eb4 E4 C4"], ["notes", "E4 G4 A4 Bb4 B4 D5 B4 Bb4 A4 G4 E4"],
    ["chords", "C A7 Dm G7 C A7 Dm G7"], ["chords", "C E7 Am F C E7 Am G"], ["chords", "C D7 G7 C C D7 G7 C"],
    ["chords", "C C7 F G C C7 F C"], ["chords", "C E7 Am A7 Dm D7 G7 C"],
    ["chords", "C F Fm C C F Fm C"], ["chords", "C Ab Bb C C Ab Bb C"], ["chords", "C Eb F C C Eb F G"],
    ["chords", "C Bb F C C Bb F G"], ["chords", "C Ab Fm G C Eb Bb C"],
    ["chords", "Am Am/G# Am/G Am/F# F E7 Am"], ["chords", "C C#dim7 Dm D#dim7 Em A7 Dm G7 C"], ["chords", "C Caug C6 C7 F Fm C G7 C"],
    ["chords", "Dm7 Db7 Cmaj7 Cmaj7 Em7 Eb7 Dm7 Db7 Cmaj7"], ["chords", "Am Am/G# Am/G D/F# F E7 Am Am"],
    ["chords", "C E C Ab C E C Ab"], ["chords", "C Eb C A C Eb C A"], ["chords", "Am F Am C#m Am F Am C#m"],
    ["chords", "C Ab E C C Ab E C"], ["chords", "Cm Abm Cm Em Cm Abm Em Cm"],
    ["chords", "C F G C A7 D G A7 D", "C"], ["chords", "C Am Dm G7 C E7 A D E7 A", "C"], ["chords", "C F G C Ab7 Db Gb Ab7 Db", "C"],
    ["chords", "C G Am F D7 G D Em C G", "C"], ["chords", "C Am F G Bb7 Eb Cm Ab Bb7 Eb", "C"]
];
var CHROMA_HINTS = ["Чёрные и белые подряд, по полутонам. Играй ровно, не останавливаясь на чужих нотах.",
                    "Первая нота пары чужая, вторая своя. Чужую бери коротко и сразу съезжай на соседнюю.",
                    "", "", "", "Буква после черты это нижняя нота: левая рука ведёт бас по полутонам.", "", ""];

var VOICE_TIERS = [
    ["терции", "Два голоса идут вместе на расстоянии терции: так поют дуэтом. Нижняя нота написана первой, бери обе разом."],
    ["сексты, октавы, децимы", "Те же два голоса, но шире: секста теплее терции, октава удваивает мелодию, децима раскладывает её на две руки."],
    ["навстречу и врозь", "Голоса идут в разные стороны: один вверх, другой вниз. С этого начинается полифония: каждый голос живёт сам."],
    ["педаль", "Одна нота в басу стоит, а мелодия над ней гуляет. Педаль держит напряжение: приём органа, транса и техно."],
    ["поющий бас", "Правая рука держит аккорд, левая ведёт под ним свою мелодию. Бас это тоже голос, а не просто опора."],
    ["мелодия над аккордом", "Левая рука держит аккорд, правая поёт над ним и проходит через ноты, которых в аккорде нет."],
    ["хорал", "Четыре голоса, и каждый идёт к ближайшей ноте следующего аккорда. Буква после черты это нижняя нота."],
    ["канон", "Второй голос повторяет первый с опозданием. Сначала мелодия звучит одна, потом сама себе отвечает."]
];
var VOICE_LESSONS = [
    ["notes", "C4+E4 D4+F4 E4+G4 F4+A4 E4+G4 D4+F4 C4+E4"], ["notes", "E4+G4 F4+A4 G4+B4 A4+C5 G4+B4 F4+A4 E4+G4 D4+F4 C4+E4"],
    ["notes", "G3+B3 A3+C4 B3+D4 C4+E4 D4+F#4 C4+E4 B3+D4 A3+C4 G3+B3", "G"], ["notes", "A3+C4 B3+D4 C4+E4 D4+F4 E4+G4 D4+F4 C4+E4 B3+D4 A3+C4", "Am"],
    ["notes", "C4+E4 E4+G4 D4+F4 F4+A4 E4+G4 G4+B4 F4+A4 D4+F4 C4+E4"],
    ["notes", "E4+C5 D4+B4 C4+A4 D4+B4 E4+C5 F4+D5 E4+C5"], ["notes", "C4+A4 D4+B4 E4+C5 F4+D5 G4+E5 F4+D5 E4+C5 D4+B4 C4+A4"],
    ["notes", "C4+C5 D4+D5 E4+E5 F4+F5 G4+G5 F4+F5 E4+E5 D4+D5 C4+C5"], ["notes", "C3+E4 D3+F4 E3+G4 F3+A4 G3+B4 F3+A4 E3+G4 D3+F4 C3+E4"],
    ["notes", "C4+E4 C4+A4 D4+F4 D4+B4 E4+G4 E4+C5 D4+B4 C4+A4 C4+E4"],
    ["notes", "C4+C5 D4+B4 E4+A4 F4+G4 E4+A4 D4+B4 C4+C5"], ["notes", "F4+G4 E4+A4 D4+B4 C4+C5 B3+D5 A3+E5 B3+D5 C4+C5"],
    ["notes", "C4+E4 B3+F4 A3+G4 G3+A4 A3+G4 B3+F4 C4+E4"], ["notes", "E4+G4 D4+A4 C4+B4 B3+C5 C4+B4 D4+A4 E4+G4"],
    ["notes", "A3+A4 G3+B4 F3+C5 E3+D5 F3+C5 G3+B4 A3+A4", "Am"],
    ["hold", "C: G A B C B A G E | C: D E F G F E D C"], ["hold", "A: C D E F E D C B | A: E D C B A B C A", "Am"],
    ["hold", "G: B C D E D C B A | G: D E F G F E D B"], ["hold", "D: F G A Bb A G F E | D: A G F E D E F D", "Dm"],
    ["hold", "E: G A B C B A G F# | E: B A G F# E F# G E", "Em"],
    ["walk", "C: C B A G | F: F E D C | G: G F E D | C: C G E C"], ["walk", "Am: A G F E | Dm: D C B A | E: E D C B | Am: A E C A", "Am"],
    ["walk", "C: C D E G | Am: A B C E | F: F G A C | G: G A B D"], ["walk", "Dm7: D F A C | G7: G B D F | Cmaj7: C E G B | Am7: A C E G"],
    ["walk", "C: C E G A | F: F A C D | G: G B D E | C: C G E C"],
    ["hold", "C: E F G E | Am: C D E C | F: A G F A | G: B A G D"], ["hold", "Am: A B C E | F: A G F C | C: G F E C | G: D C B G", "Am"],
    ["hold", "Dm7: F G A C | G7: B A G F | Cmaj7: E D C B | Cmaj7: G E C E"], ["hold", "F: C D C A | G: D E D B | Em: B C B G | Am: C B A E"],
    ["hold", "C: E G A G | F: F A C A | Dm: D F A F | G: G B D B"],
    ["chords", "C F/C C G/B C F/A G/B C"], ["chords", "Am E/G# Am/G D/F# F C/E Dm E Am", "Am"], ["chords", "F C/E Dm Am/C Bb F/A Gm C F", "F"],
    ["chords", "G D/F# Em Bm/D C G/B Am D G", "G"], ["chords", "C G/B Am Am/G F C/E Dm G7 C"],
    ["notes", "C4 D4 E4 C4 C3+C4 D3+D4 E3+E4 C3+C4 C3+E4 D3+F4 E3+G4 C3+G4"], ["notes", "C4 D4 E4 C4 G3+E4 A3+F4 B3+G4 G3+E4 A3+F4 G3+D4 C3+C4"],
    ["notes", "C3 G4 E3 C5 G3 E4 C3 G4 E3 C5 G3 E4 C3+C5"], ["notes", "A3 B3 C4 A3 C4+A4 D4+B4 E4+C5 C4+A4 E4+C5 D4+B4 C4+A4 A3+A4", "Am"],
    ["notes", "C4+E4+G4 C4+F4+A4 B3+F4+G4 C4+E4+G4 A3+E4+A4 A3+D4+F4 G3+D4+B4 C4+E4+C5"]
];
var VOICE_HINTS = ["Две клавиши разом: нижняя написана первой. Октава любая.", "Две клавиши разом: нижняя написана первой. Широкие пары бери двумя руками.",
                   "Нижний голос левой рукой, верхний правой. Смотри, как они расходятся и сходятся.", "", "", "",
                   "Буква после черты это нижняя нота. Меняй аккорд, двигая пальцы как можно меньше.",
                   "Одна нота это один голос, пара нот это оба голоса сразу. Нижний левой рукой, верхний правой."];

// A course out of a table of lessons.
function fromTable(table, hints) {
    return function (tier, step, dice, level) {
        var row = table[level - 1];
        return { kind: row[0], data: row[1], key: row[2] || "C", rhythm: row[0] === "notes" ? 2 : 0, hint: hints[tier] };
    };
}

var COURSE_LIST = [
    ["c-notes", "Ноты", "Ноты", 100, NOTE_TIERS, makeNotes],
    ["c-black", "Чёрные клавиши", "Чёрные", 200, BLACK_TIERS, makeBlack],
    ["c-intervals", "Интервалы", "Интервалы", 300, INTERVAL_TIERS, makeIntervals],
    ["c-chords", "Аккорды: практика", "Аккорды", 500, CHORD_TIERS, makeChords],
    ["c-prog", "Прогрессии", "Прогрессии", 800, PROGRESSION_TIERS, makeProgressions],
    ["c-inv", "Обращения", "Обращения", 1000, INVERSION_TIERS, makeInversions],
    ["c-bass", "Бас и аккорд", "Бас и аккорд", 1200, BASS_TIERS, makeBass],
    ["c-hands", "Две руки: практика", "Две руки", 1200, HAND_TIERS, makeHands],
    ["c-keys", "Тональности", "Тональности", 1500, KEY_TIERS, makeKeys],
    ["c-sevenths", "Септаккорды", "Септаккорды", 2000, SEVENTH_TIERS, makeSevenths],
    ["c-scales", "Гаммы: практика", "Гаммы", 1200, SCALE_TIERS, makeScales],
    ["c-beats", "Биты", "Биты", 500, BEAT_TIERS, makeBeats],
    ["c-knobs", "Ручки синтезатора", "Ручки", 300, KNOB_TIERS, makeKnobs],
    ["c-fx", "Эффекты: практика", "Эффекты", 300, FX_TIERS, makeEffects],
    ["c-tempo", "Темпы жанров", "Темпы", 600, TEMPO_TIERS, makeTempos],
    ["c-synths", "Синтезаторы Live", "Синты", 800, SYNTH_TIERS, makeSynths],
    ["c-seq", "Секвенсор", "Секвенсор", 1000, SEQ_TIERS, fromPlans(SEQ_TASKS, SEQ_PLANS, PLAN_HINT)],
    ["c-song", "Композиция", "Композиция", 1200, SONG_TIERS, fromPlans(SONG_TASKS, SONG_PLANS, PLAN_HINT)],
    ["c-masters", "Как у мастеров", "Мастера", 1200, MASTER_TIERS, fromPlans(MASTER_TASKS, MASTER_PLANS, PLAN_HINT)],
    // New courses go to the end: the lessons of a course are rolled from its
    // place in this list.
    ["c-colours", "Редкие аккорды", "Редкие", 2000, COLOUR_TIERS, fromTable(COLOUR_LESSONS, COLOUR_HINTS)],
    ["c-chroma", "Хроматика", "Хроматика", 3000, CHROMA_TIERS, fromTable(CHROMA_LESSONS, CHROMA_HINTS)],
    ["c-voices", "Многоголосие", "Голоса", 4200, VOICE_TIERS, fromTable(VOICE_LESSONS, VOICE_HINTS)]
];
var COURSE_SIZE = 40;

// The one path through the trainer: every stage and every course in the order
// they are meant to be taken. A course follows the stage that introduces its
// subject, playing alternates with sound and with Ableton, and the points
// needed to open a stage never go down along the way.
var PATH = [
    "start", "novice", "c-notes", "drill", "c-black",
    "synth", "c-knobs", "c-intervals", "fx", "c-fx",
    "chords", "c-chords", "drums", "c-beats",
    "dance", "beats", "synths", "c-tempo",
    "c-prog", "c-synths", "beatlab",
    "studio", "c-seq", "c-inv",
    "hands", "c-bass", "c-hands", "scales", "c-scales",
    "c-song", "c-masters", "c-keys", "harmony", "c-sevenths", "c-colours",
    "circle", "c-chroma", "poly", "c-voices", "virtuoso"
];

(function () {
    for (var c = 0; c < COURSE_LIST.length; c++) {
        var spec = COURSE_LIST[c];
        var group = { id: spec[0], title: spec[1], need: spec[3], course: true, lessons: [] };
        if (spec[0] === "c-beats") {
            group.pads = true;
        }
        // The four artists of this course do not build on each other: its
        // lessons can be taken in any order.
        if (spec[0] === "c-masters") {
            group.shelf = true;
        }
        var seen = {};
        for (var level = 1; level <= COURSE_SIZE; level++) {
            var tier = Math.floor((level - 1) / 5);
            // No two lessons of a course are the same: a repeat is rolled again.
            var made, attempt = 0;
            do {
                made = spec[5](tier, (level - 1) % 5, makeDice(c * 7919 + level * 104729 + attempt * 31337), level);
                attempt++;
            } while (seen[JSON.stringify(made.data)] && attempt < 30);
            seen[JSON.stringify(made.data)] = true;
            var extra = { pts: 40 + level * 2 };
            if (made.hint) {
                extra.hint = made.hint;
            }
            if (made.key) {
                extra.key = made.key;
            }
            if (made.rhythm) {
                extra.rhythm = made.rhythm;
            }
            if (made.full) {
                extra.full = true;
            }
            group.lessons.push(lesson(spec[2] + " " + level + ": " + (made.name || spec[4][tier][0]), made.kind, made.data, spec[4][tier][1], extra));
        }
        GROUPS.push(group);
    }
}());

// Stages and courses become one row, in the order of the path. A group the
// path forgot stays at the end, where the tests will point at it.
(function () {
    var byId = {};
    var g;
    for (g = 0; g < GROUPS.length; g++) {
        byId[GROUPS[g].id] = GROUPS[g];
    }
    var ordered = [];
    for (var p = 0; p < PATH.length; p++) {
        if (byId[PATH[p]]) {
            ordered.push(byId[PATH[p]]);
            delete byId[PATH[p]];
        }
    }
    for (g = 0; g < GROUPS.length; g++) {
        if (byId[GROUPS[g].id]) {
            ordered.push(GROUPS[g]);
        }
    }
    GROUPS = ordered;
}());

// Flat list for the save file and the tests; texts are prepared once.
var LESSONS = [];
(function () {
    for (var g = 0; g < GROUPS.length; g++) {
        GROUPS[g].title = caps(GROUPS[g].title);
        for (var l = 0; l < GROUPS[g].lessons.length; l++) {
            var item = GROUPS[g].lessons[l];
            renew(item);
            item.id = GROUPS[g].id + "/" + l;
            item.group = g;
            item.index = l;
            item.place = LESSONS.length;    // how far along the path it stands
            item.title = caps(item.title);
            item.why = caps(item.why);
            item.hint = caps(item.hint || DEFAULT_HINT[item.kind]);
            if (item.task) {
                item.task = caps(item.task);
            }
            LESSONS.push(item);
        }
    }
}());

// ============================================================== free play

// Free play is not a lesson of the path. It is a mode of its own, behind a
// button of the panel. The player picks a style and a mood; the wheel and the
// keys then show which notes suit a melody, the stage puts on the scenery of
// the style, and the trainer reads the Live Set and says what the track needs
// next.

// name, what the scale is called, a tag for the middle of the wheel, the
// notes of the scale (semitones above the tonic), the note that gives the mood
// its colour (-1 = none), and the scale chords are built from when the scale
// itself has fewer than seven notes
var MOODS = [
    ["Светлое", "мажор", "МАЖОР", [0, 2, 4, 5, 7, 9, 11], 11, null],
    ["Мечтательное", "лидийский лад", "ЛИДИЙ", [0, 2, 4, 6, 7, 9, 11], 6, null],
    ["Тёплое", "миксолидийский лад", "МИКСОЛ", [0, 2, 4, 5, 7, 9, 10], 10, null],
    ["Задумчивое", "дорийский лад", "ДОРИЙ", [0, 2, 3, 5, 7, 9, 10], 9, null],
    ["Грустное", "минор", "МИНОР", [0, 2, 3, 5, 7, 8, 10], 8, null],
    ["Драматичное", "гармонический минор", "ГАРМ", [0, 2, 3, 5, 7, 8, 11], 11, null],
    ["Тёмное", "фригийский лад", "ФРИГ", [0, 1, 3, 5, 7, 8, 10], 1, null],
    ["Восточное", "фригийский доминантовый лад", "ВОСТОК", [0, 1, 4, 5, 7, 8, 10], 1, null],
    ["Простое", "минорная пентатоника", "ПЕНТА", [0, 3, 5, 7, 10], -1, [0, 2, 3, 5, 7, 8, 10]],
    ["Блюзовое", "блюзовая гамма", "БЛЮЗ", [0, 3, 5, 6, 7, 10], 6, [0, 2, 3, 5, 7, 8, 10]],
    // Moods of a place or a time rather than of a feeling. New ones go to the
    // end: the save file and the styles name a mood by its number.
    ["Космическое", "лидийский увеличенный лад", "КОСМОС", [0, 2, 4, 6, 8, 9, 11], 8, null],
    ["Невесомое", "целотонная гамма", "ЦЕЛОТ", [0, 2, 4, 6, 8, 10], 6, [0, 2, 4, 6, 8, 9, 11]],
    ["Футуристичное", "лидийский доминантовый лад", "ЛИД 7", [0, 2, 4, 6, 7, 9, 10], 6, null],
    ["Загадочное", "мелодический минор", "МЕЛМИН", [0, 2, 3, 5, 7, 9, 11], 9, null],
    ["Эпичное", "мелодический мажор", "МЕЛМАЖ", [0, 2, 4, 5, 7, 8, 10], 8, null],
    ["Зловещее", "локрийский лад", "ЛОКР", [0, 1, 3, 5, 6, 8, 10], 6, null],
    ["Беззаботное", "мажорная пентатоника", "МАЖ 5", [0, 2, 4, 7, 9], -1, [0, 2, 4, 5, 7, 9, 11]],
    ["Японское", "гамма хирадзёси", "ЯПОН", [0, 2, 3, 7, 8], 8, [0, 2, 3, 5, 7, 8, 10]]
];

// A style: its usual mood and tonic (the defaults keep to the white keys
// where the style allows), its tempo, how to play in it (shown while the
// player plays), the parts a track of this style is built from, in the order
// to make them, and what to do for each part (shown while the keys rest).
var STYLES = [
    { id: "classic", name: "Классика", mood: 0, tonic: 0, tempo: [60, 120], parts: ["chords", "melody", "bass"],
      play: ["Левая рука берёт аккорд по одной ноте снизу вверх, правая ведёт мелодию. Фразу кончай на опорной ноте и делай паузу, как вдох.",
             "Играй то тише, то громче: к середине фразы нарастай, к концу затихай. Сила удара здесь главная краска."],
      chords: "Начни с аккордов: поставь на новую дорожку Electric или рояль и запиши четыре аккорда, по одному на такт.",
      melody: "Запиши мелодию по подсвеченным нотам: фразы по два такта, каждая кончается на опорной ноте.",
      bass: "Добавь бас: на новой дорожке повтори нижние ноты аккордов длинными нотами, октавой ниже." },
    { id: "lofi", name: "Лоу-фай", mood: 3, tonic: 2, tempo: [70, 90], parts: ["chords", "drums", "bass", "melody"],
      play: ["Играй лениво, чуть позади доли. Аккорд бери не разом, а раскатом снизу вверх.",
             "Добавь к аккорду четвёртую ноту: Dm7, G7, Cmaj7. Мелодию играй тихо, в середине клавиатуры, с паузами."],
      chords: "Начни с аккордов: Electric, септаккорды Dm7, G7, Cmaj7, Am7. Сверху Redux или Saturator для шершавости.",
      drums: "Добавь ленивый бит: бочка на 1 и 3, снейр на 2 и 4, хэты восьмыми. Сдвинь снейр чуть позже сетки.",
      bass: "Добавь мягкий бас: синус в Drift или Operator, основные ноты аккордов, длинно.",
      melody: "Запиши короткую мелодию из трёх-четырёх нот и повторяй её с паузами: в лоу-фае тишина тоже играет." },
    { id: "ambient", name: "Эмбиент", mood: 1, tonic: 5, tempo: [60, 90], parts: ["chords", "melody"],
      play: ["Держи ноты подолгу и не торопись: одна нота на такт. Новый аккорд бери, пока тает прежний.",
             "Роняй редкие ноты в верхней октаве, как капли, и оставляй между ними тишину."],
      chords: "Начни с пэда: Wavetable или Drift с долгой атакой и хвостом, два аккорда по четыре такта. Reverb побольше.",
      melody: "Добавь редкие ноты поверх пэда: одна нота на такт, с эхом (Delay). Чем меньше нот, тем больше воздуха." },
    { id: "synthwave", name: "Синтвейв", mood: 4, tonic: 9, tempo: [80, 118], parts: ["drums", "bass", "chords", "melody"],
      play: ["Левая рука стучит восьмыми одну ноту баса, правая держит длинный аккорд.",
             "Мелодию играй длинными нотами и качай их колесом Mod. Конец фразы тяни дольше, чем хочется."],
      drums: "Начни с бита восьмидесятых: бочка на 1 и 3, громкий снейр с реверберацией на 2 и 4, хэты восьмыми.",
      bass: "Добавь бас восьмыми нотами на основной ноте аккорда: Analog или Drift, пила, фильтр прикрыт.",
      chords: "Добавь аккорды суперпилой или пэдом: Am, F, C, G, по такту на аккорд.",
      melody: "Запиши мелодию ярким лидом (пила и Glide): длинные ноты и арпеджио по опорным нотам." },
    { id: "house", name: "Хаус", mood: 3, tonic: 2, tempo: [120, 128], parts: ["drums", "bass", "chords", "melody"],
      play: ["Аккорды бери коротко и мимо сильной доли: раз-и, два-и, на каждое и. Левая рука качает одну ноту.",
             "Найди мотив из трёх нот и повторяй его, меняя только последнюю ноту."],
      drums: "Начни с бита: бочка на каждую долю, хлопок на 2 и 4, открытый хэт между долями.",
      bass: "Добавь бас между ударами бочки: короткие ноты на слабую долю, основная нота аккорда.",
      chords: "Добавь аккорды стэбами: короткие септаккорды мимо сильной доли, на Electric или Operator.",
      melody: "Запиши простой мотив из двух-трёх нот и повторяй его: хаус держится на повторе, а не на длинной мелодии." },
    { id: "techno", name: "Техно", mood: 6, tonic: 4, tempo: [128, 140], parts: ["drums", "bass", "melody"],
      play: ["Играй одну-две ноты ровными шестнадцатыми и крути фильтр энкодерами K1 и K2. Ноты не меняй, меняй тембр.",
             "Возьми тонику и ноту на полтона выше. Чередуй их редко, как сигнал тревоги."],
      drums: "Начни с бочки на каждую долю и хэтов шестнадцатыми. Хлопок на 2 и 4, остальное по вкусу.",
      bass: "Добавь бас: одна низкая нота шестнадцатыми с паузой на месте бочки. Фильтр води рукой.",
      melody: "Запиши риф из двух-трёх нот: тоника и краска лада рядом с ней. В техно меняется тембр, а не ноты." },
    { id: "trance", name: "Транс", mood: 4, tonic: 9, tempo: [136, 142], parts: ["drums", "bass", "chords", "melody"],
      play: ["Держи аккорд левой рукой, а правой перебирай его ноты шестнадцатыми вверх и вниз.",
             "Мелодию веди по опорным нотам. Верхнюю ноту каждой новой фразы бери на ступень выше прежней."],
      drums: "Начни с бочки на каждую долю, открытого хэта между долями и хлопка на 2 и 4.",
      bass: "Добавь бас на слабую долю: три шестнадцатые после каждой бочки, основная нота аккорда.",
      chords: "Добавь пэд или суперпилу: Am, F, C, G по два такта, фильтр медленно открывается.",
      melody: "Запиши мелодию плаком: арпеджио по опорным нотам шестнадцатыми, верхняя нота ведёт тему." },
    { id: "psy", name: "Пси-транс", mood: 7, tonic: 4, tempo: [140, 148], parts: ["drums", "bass", "melody"],
      play: ["Бас: три короткие ноты после каждой бочки на одной клавише. Ровно, как мотор.",
             "Лид: быстрые фразы из тоники и ноты-краски рядом с ней. На концах нот тяни колесо Pitch."],
      drums: "Начни с плотной бочки на каждую долю и хэта между долями. Больше почти ничего не нужно.",
      bass: "Добавь катящийся бас: три шестнадцатые после каждой бочки на одной ноте, тонике. Коротко и ровно.",
      melody: "Запиши кислотный лид: короткие фразы из тоники и ноты-краски на полтона выше, с эхом и резонансом." },
    { id: "tribal", name: "Трайбл", mood: 8, tonic: 9, tempo: [120, 132], parts: ["drums", "bass", "melody"],
      play: ["Сыграй короткий напев из трёх нот и ответь на него таким же, но ниже. Ритм здесь важнее нот.",
             "Стучи по одной клавише, как по барабану: меняй только силу удара и паузы."],
      drums: "Начни с барабанов: бочка на каждую долю, поверх неё томы и перкуссия в синкопах. Трёх разных хватит.",
      bass: "Добавь бас из одной-двух нот, который отвечает томам: коротко, в паузах между ударами.",
      melody: "Запиши напев из пяти нот пентатоники: короткая фраза и её ответ. Подойдёт флейта, голос или Collision." },
    { id: "dub", name: "Даб", mood: 4, tonic: 9, tempo: [60, 90], parts: ["drums", "bass", "chords", "melody"],
      play: ["Аккорд бери коротко на 2 и 4 и сразу отпускай: дальше работает эхо.",
             "Бас играй не спеша, с паузами. Нота, которую ты не сыграл, здесь весит больше сыгранной."],
      drums: "Начни с бита one drop: бочка и рим вместе на третью долю, хэты восьмыми. Пусто и неспешно.",
      bass: "Добавь бас, он здесь главный: глубокий синус, певучая линия из трёх-четырёх нот, много пауз.",
      chords: "Добавь аккорды на слабую долю: короткий удар на 2 и 4, а после него длинное эхо (Delay или Echo).",
      melody: "Запиши редкие ноты мелодии и отправляй их в эхо посылом: в дабе играют ручками эффектов." },
    { id: "rave", name: "Рейв", mood: 5, tonic: 9, tempo: [140, 160], parts: ["drums", "bass", "chords", "melody"],
      play: ["Возьми минорный аккорд и двигай всю руку по клавишам вверх и вниз, не меняя её формы.",
             "Риф играй в верхней октаве, отрывисто и громко. Каждые два такта повторяй его."],
      drums: "Начни с ломаного бита или прямой бочки на каждую долю: хэты шестнадцатыми, хлопок на 2 и 4.",
      bass: "Добавь бас: саб на длинных нотах или рычащая пила, основная нота аккорда.",
      chords: "Добавь рейв-стэбы: один минорный аккорд, который двигают целиком вверх и вниз по клавишам.",
      melody: "Запиши пронзительный риф в верхней октаве: три-четыре ноты, которые легко напеть." },
    { id: "dnb", name: "Драм-н-бейс", mood: 4, tonic: 9, tempo: [170, 176], parts: ["drums", "bass", "chords", "melody"],
      play: ["Играй вдвое медленнее барабанов: длинные ноты и аккорды на целый такт.",
             "Бас: две-три длинные ноты на четыре такта. Мелодию начинай не на первую долю, а сразу после неё."],
      drums: "Начни с брейка: бочка на 1 и между 3 и 4, снейр на 2 и 4, хэты восьмыми.",
      bass: "Добавь бас: длинный саб под бочкой или рычащий риз, две-три ноты на четыре такта.",
      chords: "Добавь пэд с долгой атакой: один-два аккорда на восемь тактов, чтобы было куда дышать.",
      melody: "Запиши короткую тему: на таком темпе хватает нот вдвое длиннее, чем кажется." },

    // ---- more of what fills dance floors and charts
    { id: "deephouse", name: "Дип-хаус", mood: 4, tonic: 9, tempo: [118, 124], parts: ["drums", "bass", "chords", "melody"],
      play: ["Аккорды из четырёх нот бери мягко и держи долго: Am7, Dm7. Правой рукой отвечай одной-двумя нотами в паузах.",
             "Бас играй на слабую долю, коротко и тихо: он должен качать, а не стучать."],
      drums: "Начни с мягкой бочки на каждую долю, хэта между долями и щелчка на 2 и 4. Всё негромко, без ярких тарелок.",
      bass: "Добавь тёплый бас: синус или треугольник, ноты аккорда на слабую долю, фильтр прикрыт.",
      chords: "Добавь септаккорды на Electric: два аккорда на четыре такта, с долгим Release и ревербератором.",
      melody: "Запиши мотив из трёх-четырёх нот в середине клавиатуры и повторяй его с эхом. В дип-хаусе мелодия шепчет." },
    { id: "techhouse", name: "Тек-хаус", mood: 6, tonic: 4, tempo: [122, 128], parts: ["drums", "bass", "melody"],
      play: ["Бас играй короткими нотами между ударами бочки, две-три ноты, с оттяжкой. Он здесь главный.",
             "Вместо мелодии один короткий звук или слово раз в два такта. Чем меньше, тем лучше качает."],
      drums: "Начни с бочки на каждую долю, хлопка на 2 и 4 и плотных хэтов шестнадцатыми со свингом. Добавь перкуссию в синкопах.",
      bass: "Добавь катящийся бас: короткие ноты на слабую долю, одна-две ноты, фильтр прикрыт. Сайдчейн от бочки обязателен.",
      melody: "Запиши крючок: нарезанный голос или короткий стэб, одна фраза на два такта. Длинных мелодий тут не бывает." },
    { id: "melodic", name: "Мелодик-техно", mood: 4, tonic: 2, tempo: [120, 126], parts: ["drums", "bass", "melody", "chords"],
      play: ["Перебирай ноты аккорда шестнадцатыми одной рукой и медленно открывай фильтр энкодером K1.",
             "Мелодию играй длинными нотами в верхней октаве: одна нота на такт, с долгим хвостом."],
      drums: "Начни с плотной бочки на каждую долю, хэта между долями и редкого хлопка. Барабаны здесь только каркас.",
      bass: "Добавь бас шестнадцатыми на одной ноте с паузой на месте бочки. Раз в восемь тактов меняй ноту.",
      melody: "Запиши арпеджио из нот аккорда и поставь на него длинный Delay: мелодия сложится из повторов сама.",
      chords: "Добавь пэд с очень долгой атакой: один аккорд на восемь тактов, фильтр открывается к кульминации." },
    { id: "dubstep", name: "Дабстеп", mood: 6, tonic: 4, tempo: [138, 142], parts: ["drums", "bass", "melody"],
      play: ["Бас держи одной длинной нотой и качай фильтр колесом Mod или энкодером K1: это и есть воббл.",
             "Играй вдвое медленнее темпа: снейр приходит только на третью долю, оставь ему место."],
      drums: "Начни с бита в половинном темпе: бочка на 1, снейр на 3, хэты восьмыми. Между ударами должно быть пусто.",
      bass: "Добавь воббл-бас: пила в Drift или Wavetable и LFO на фильтр. Скорость LFO меняй каждый такт: 1/4, 1/8, триоли.",
      melody: "Запиши для вступления тёмную мелодию из трёх-четырёх длинных нот. В дропе её сменит бас." },
    { id: "futurebass", name: "Фьюче-бейс", mood: 1, tonic: 5, tempo: [140, 160], parts: ["chords", "drums", "bass", "melody"],
      play: ["Бери большие аккорды обеими руками, по четыре-пять нот, и отпускай резко: звук должен обрываться.",
             "Мелодию играй высоко и отрывисто. Повторяй короткую фразу и меняй её конец."],
      chords: "Начни с аккордов суперпилой: Fmaj7, G, Am7, Em7. Громкость качай сайдчейном или LFO, чтобы аккорды дышали.",
      drums: "Добавь бит в половинном темпе: бочка на 1, громкий снейр на 3, хэты с быстрыми дробями.",
      bass: "Добавь саб: чистый синус на основной ноте каждого аккорда, длинными нотами.",
      melody: "Запиши высокую мелодию плаком или нарезанным голосом: короткие ноты, много повторов." },
    { id: "trap", name: "Трэп", mood: 4, tonic: 4, tempo: [130, 150], parts: ["drums", "bass", "melody"],
      play: ["Мелодию играй редкими нотами в миноре, тёмно и просто: три-четыре ноты на два такта.",
             "Бас 808 играй длинными нотами и съезжай с ноты на ноту колесом Pitch."],
      drums: "Начни с хэтов: ровные восьмые с дробями шестнадцатыми и тридцать вторыми. Хлопок на третью долю, бочка редко.",
      bass: "Добавь 808: длинный синус с ударом в начале, на тех же долях, что бочка. Включи Glide, чтобы ноты съезжали.",
      melody: "Запиши тёмную мелодию: колокольчик, флейта или пианино, три-четыре ноты в миноре по кругу." },
    { id: "hardstyle", name: "Хардстайл", mood: 4, tonic: 9, tempo: [150, 160], parts: ["drums", "melody", "chords"],
      play: ["Мелодию играй восьмыми, отрывисто и громко, двумя руками в октаву.",
             "В перерыве без бочки сыграй ту же мелодию медленно, длинными аккордами: так готовят удар."],
      drums: "Начни с бочки на каждую долю: длинной, перегруженной, с тоном. Поставь на неё Saturator или Pedal и прибавь Drive.",
      melody: "Запиши мелодию суперпилой: простую, как песня болельщиков, восьмыми нотами, в верхней октаве.",
      chords: "Добавь аккорды под мелодию для перерыва: Am, F, C, G длинными нотами, без барабанов." },
    { id: "garage", name: "Гэридж", mood: 3, tonic: 2, tempo: [130, 136], parts: ["drums", "bass", "chords", "melody"],
      play: ["Аккорды бери коротко и с оттяжкой, между ударами бочки. Вторая шестнадцатая в паре чуть опаздывает.",
             "Бас играй прыгучими короткими нотами через октаву, с паузами."],
      drums: "Начни с ломаного бита: бочка на 1 и перед 3, хлопок на 2 и 4, хэты со свингом. Поставь клипу грув Swing 16.",
      bass: "Добавь упругий бас: короткие ноты синусом или органом, скачки на октаву, пауза на сильной доле.",
      chords: "Добавь стэбы органом или Electric: короткие септаккорды мимо сильной доли.",
      melody: "Запиши нарезанный голос или короткий мотив: две-три ноты, которые отвечают басу." },
    { id: "edm", name: "Фестивальный EDM", mood: 4, tonic: 9, tempo: [126, 130], parts: ["drums", "melody", "chords", "bass"],
      play: ["В нарастании играй одну ноту всё чаще: четверти, восьмые, шестнадцатые. Потом пауза и удар.",
             "Мелодию дропа играй одним пальцем: четыре-пять нот, которые может спеть стадион."],
      drums: "Начни с бочки на каждую долю и хлопка на 2 и 4. Для нарастания нужен снейр, который учащается, и шум вверх.",
      melody: "Запиши мелодию дропа: один яркий звук, четыре-пять нот, ритм повторяется каждые два такта.",
      chords: "Добавь аккорды для перерыва: пианино или суперпила, Am, F, C, G, с долгим ревербератором.",
      bass: "Добавь бас под бочку: короткая нота на слабую долю, основная нота аккорда, с сайдчейном." },
    { id: "breaks", name: "Брейкбит", mood: 8, tonic: 9, tempo: [125, 140], parts: ["drums", "bass", "melody"],
      play: ["Играй короткие рифы из пентатоники и оставляй дыры: барабаны здесь говорят больше клавиш.",
             "Отвечай барабанам: после сбивки одна громкая нота или аккорд."],
      drums: "Начни с брейка: бочка на 1 и между 2 и 3, снейр на 2 и 4, хэты восьмыми. Или нарежь готовую петлю в Simpler.",
      bass: "Добавь бас, который идёт за бочкой: короткие ноты пилой, две-три ноты на такт.",
      melody: "Запиши риф: органный стэб, кислотная линия или нарезанный голос, одна фраза на два такта." },
    { id: "chillout", name: "Чилаут", mood: 2, tonic: 7, tempo: [90, 110], parts: ["chords", "drums", "bass", "melody"],
      play: ["Играй мягко и редко. Аккорд, пауза, две ноты мелодии, пауза.",
             "Мелодию веди плавно, соседними нотами, и кончай фразу на опорной ноте."],
      chords: "Начни с тёплых аккордов: Electric или пэд, два аккорда на четыре такта, Chorus и Reverb.",
      drums: "Добавь лёгкий бит: бочка на 1 и 3, рим на 2 и 4, шейкер шестнадцатыми. Тихо.",
      bass: "Добавь круглый бас: основные ноты аккордов, длинно, с редкими переходными нотами.",
      melody: "Запиши неторопливую мелодию: гитара, флейта или мягкий лид, фразы по два такта с паузами." },
    { id: "idm", name: "IDM", mood: 1, tonic: 0, tempo: [100, 160], parts: ["drums", "melody", "chords"],
      play: ["Ломай привычное: играй фразу из пяти или семи нот поверх ровного счёта на четыре.",
             "Повторяй фразу и каждый раз меняй в ней одну ноту на соседнюю."],
      drums: "Начни с дробного бита: бочка и снейр на своих местах, а между ними рассыпь щелчки и дроби. Попробуй Beat Repeat.",
      melody: "Запиши хрупкую мелодию колокольчиком на Operator или Collision: фраза из пяти-семи нот по кругу.",
      chords: "Добавь пэд под мелодию: один-два тёплых, чуть расстроенных аккорда. Контраст с ломаным битом и есть жанр." },
    { id: "hardtechno", name: "Хард-техно", mood: 6, tonic: 9, tempo: [145, 160], parts: ["drums", "bass", "melody"],
      play: ["Одна нота шестнадцатыми и рука на фильтре. Раз в восемь тактов поднимай ноту на полтона и возвращай.",
             "Играй сигналы: короткая высокая нота раз в такт, как сирена."],
      drums: "Начни с перегруженной бочки на каждую долю: Saturator или Pedal, Drive вправо. Хэт между долями, хлопок на 2 и 4.",
      bass: "Добавь гул под бочку: её собственный хвост или одна низкая нота шестнадцатыми с паузой на ударе.",
      melody: "Запиши сигнал: стэб или сирена из двух нот, раз в такт. Мелодий здесь почти нет." },
    { id: "amapiano", name: "Амапиано", mood: 3, tonic: 2, tempo: [110, 115], parts: ["drums", "bass", "chords", "melody"],
      play: ["Бас здесь играет мелодию: стучи низкие короткие ноты в синкопах, как по деревянному барабану.",
             "Аккорды бери мягко и редко, джазовыми септаккордами, и оставляй место басу."],
      drums: "Начни с шейкера шестнадцатыми и редкой бочки. Хлопки и рим в синкопах. Бочки на каждую долю здесь нет.",
      bass: "Добавь лог-драм, короткий ударный бас: синус в Operator или Drift с быстрым падением высоты. Играй им мелодию внизу.",
      chords: "Добавь джазовые аккорды на Electric: Dm9 и G13 по два такта, мягко.",
      melody: "Запиши короткий напев или свисток: две-три ноты, которые отвечают лог-драму." },
    { id: "afro", name: "Афро-хаус", mood: 8, tonic: 2, tempo: [118, 124], parts: ["drums", "bass", "melody", "chords"],
      play: ["Играй напев из пентатоники короткими фразами и повторяй его, как заклинание.",
             "Отбивай ритм одной нотой в синкопах: рука работает как перкуссия."],
      drums: "Начни с бочки на каждую долю, а поверх неё перкуссия: конги, шейкер, рим в синкопах. Перкуссии много.",
      bass: "Добавь тёплый бас из двух-трёх нот, который качается вместе с конгами.",
      melody: "Запиши напев маримбой, калимбой или голосом: короткая фраза из пентатоники с эхом.",
      chords: "Добавь пэд или пианино: один минорный аккорд на четыре такта, чтобы напеву было на что опереться." },

    // ---- what the young listen to
    { id: "phonk", name: "Фонк", mood: 6, tonic: 4, tempo: [130, 160], parts: ["melody", "drums", "bass"],
      play: ["Мелодию играй одним пальцем, отрывисто, как по колокольчику: от четырёх до восьми нот по кругу.",
             "Опирайся на тонику и ноту на полтона выше: от этой пары и идёт зловещий звук фонка.",
             "Бразильский фонк ещё проще: две-три ноты в ритме бочки, громко и с перегрузом."],
      melody: "Начни с мелодии ковбелла: короткий звонкий звук (Collision или сэмпл), восемь нот в тёмном ладу по кругу.",
      drums: "Добавь бит: жёсткие бочка и хлопок с перегрузом, хэты восьмыми. Поставь Saturator на всю группу барабанов.",
      bass: "Добавь перегруженный 808: длинные ноты на тонике, Saturator с Drive вправо, пока бас не зарычит." },
    { id: "hyperpop", name: "Гиперпоп", mood: 0, tonic: 0, tempo: [140, 180], parts: ["chords", "drums", "bass", "melody"],
      play: ["Играй мажорные аккорды высоко и быстро, как детскую песенку на удвоенной скорости.",
             "Мелодию играй отрывисто, с повторами одной ноты, и не бойся перебора: здесь всё через край."],
      chords: "Начни с ярких аккордов суперпилой или колокольчиками: C, G, Am, F по такту. Всё звонко и высоко.",
      drums: "Добавь бит: перегруженная бочка, громкий хлопок, хэты с дробями. Redux и Saturator на барабаны, чтобы хрустело.",
      bass: "Добавь 808 с перегрузом: он должен рычать и почти заглушать остальное.",
      melody: "Запиши мелодию голосом или плаком и подними её на октаву: сладкий, нарочно ненастоящий звук." },
    { id: "jersey", name: "Джерси-клаб", mood: 4, tonic: 9, tempo: [130, 140], parts: ["drums", "bass", "melody"],
      play: ["Играй короткие аккорды в ритме бочки: три удара подряд, пауза и ещё два быстрых.",
             "Разбей мотив на куски по две ноты и повторяй их, как заикание."],
      drums: "Начни с бочки в ритме джерси: пять ударов на такт, три ровных и два быстрых в конце. Хлопок на 2 и 4.",
      bass: "Добавь 808 на те же удары, что бочка: короткие ноты на тонике.",
      melody: "Запиши нарезку: короткие куски голоса или аккорда, которые повторяются в ритме бочки." },
    { id: "nightcore", name: "Найткор", mood: 0, tonic: 7, tempo: [150, 180], parts: ["chords", "drums", "melody", "bass"],
      play: ["Возьми знакомую мелодию и сыграй её на октаву выше и в полтора раза быстрее: в этом весь приём.",
             "Аккорды бей восьмыми, ровно и звонко, как на детском пианино."],
      chords: "Начни с простых аккордов в верхней октаве: G, D, Em, C по такту, ярким пианино или суперпилой.",
      drums: "Добавь прямой бит: бочка на каждую долю, хлопок на 2 и 4, открытый хэт между долями. Темп выше 150.",
      melody: "Запиши песенную мелодию и подними её на октаву: тонкий быстрый голос и есть найткор.",
      bass: "Добавь бас на слабую долю: короткая нота между ударами бочки, основная нота аккорда." },
    { id: "eurodance", name: "Евродэнс", mood: 4, tonic: 9, tempo: [130, 140], parts: ["drums", "bass", "melody", "chords"],
      play: ["Мелодию играй одним пальцем, синтезатором с резким началом: простая, на восемь нот, чтобы запомнилась с раза.",
             "Бас стучит на слабую долю: раз-и, два-и, нота на каждое и."],
      drums: "Начни с бочки на каждую долю, хлопка на 2 и 4 и открытого хэта между долями: бит девяностых.",
      bass: "Добавь бас на слабую долю: короткая нота между ударами бочки, через октаву.",
      melody: "Запиши припев-риф ярким синтезатором: восемь нот в миноре, ритм повторяется каждые два такта.",
      chords: "Добавь пианино или пэд под риф: Am, F, C, G, аккорд на такт." },    { id: "chiptune", name: "Чиптюн", mood: 0, tonic: 0, tempo: [120, 160], parts: ["melody", "bass", "drums"],
      play: ["Аккордов тут нет: перебирай их ноты очень быстро, по одной. Получится трель, как в старых играх.",
             "Мелодию играй чётко и отрывисто, со скачками на октаву."],
      melody: "Начни с мелодии прямоугольной волной: в Drift выбери Rectangle, атаку и хвост убери. Скачки, трели, повторы.",
      bass: "Добавь бас треугольной волной: Triangle в Drift, короткие ноты восьмыми через октаву.",
      drums: "Добавь барабаны из шума: короткий шум вместо хэта и снейра, низкий щелчок вместо бочки. Поставь Redux на всё." },

    // ---- the fields the four artists of the course "Как у мастеров" work in
    { id: "psydub", name: "Псидаб", mood: 3, tonic: 2, tempo: [80, 110], parts: ["drums", "bass", "chords", "melody"],
      play: ["Бас играй как мелодию: певучая линия из четырёх-пяти нот, не спеша, с паузами.",
             "Аккорд бери коротко между долями и отпускай: хвост доиграет эхо.",
             "Мелодию веди редкими длинными нотами и подтягивай их колесом Pitch: звук должен течь."],
      drums: "Начни с неспешного бита: бочка на 1 и 3, рим или снейр на 3, хэты восьмыми. Темп от 80 до 110, много воздуха.",
      bass: "Добавь бас, он здесь ведёт: синус или треугольник, один голос, певучая линия на четыре такта.",
      chords: "Добавь скэнк: короткий аккорд между долями, а на него Echo с долгим Feedback. Без слабой доли псидаба нет.",
      melody: "Запиши булькающую линию: пила в один голос, Glide, резонанс вправо и рука на фильтре. Или живой инструмент: гитара, флейта." },
    { id: "psybass", name: "Пси-бас", mood: 6, tonic: 4, tempo: [100, 144], parts: ["drums", "bass", "melody", "chords"],
      play: ["Играй со свингом: вторая шестнадцатая в паре опаздывает. Попробуй и триоли, по три ноты на долю.",
             "Бас держи длинной нотой и качай фильтр: скорость качания меняй каждый такт.",
             "Мелодию руби на куски: фраза, дыра, повтор последней ноты. Звук должен запинаться."],
      drums: "Начни с бита в половинном темпе со свингом: бочка на 1, снейр на 3, хэты шестнадцатыми и триолями.",
      bass: "Добавь пси-бас: пила, один голос, LFO на фильтр. Раз в такт меняй скорость LFO: 1/8, триоли, 1/16.",
      melody: "Запиши кислотную фразу и поставь на неё Beat Repeat: пусть она иногда рассыпается на повторы.",
      chords: "Добавь воздух: пэд с долгой атакой и большим ревербератором, один аккорд на восемь тактов." },
    { id: "metal", name: "Метал-электроника", mood: 6, tonic: 4, tempo: [120, 180], parts: ["drums", "bass", "melody", "chords"],
      play: ["Риф играй на нижних клавишах, одной-двумя нотами: главное тут ритм, ломаный и точный.",
             "Считай не по четыре: сыграй фразу из семи восьмых поверх ровной бочки и повторяй.",
             "После тяжёлого куска резко смени краску: четыре такта чистых арпеджио, потом снова удар."],
      drums: "Начни с быстрых плотных барабанов: бочка повторяет ритм рифа нота в ноту, снейр на третью долю, тарелки четвертями.",
      bass: "Добавь риф: низкие короткие ноты пилой через Amp и Pedal, в ломаном ритме. Или запиши гитару, если она есть.",
      melody: "Запиши быстрый синтезаторный лид или арпеджио поверх рифа: шестнадцатыми, в верхней октаве.",
      chords: "Добавь электронную вставку на четыре такта: чистый пэд или техно-бас без гитар. Контраст сильнее громкости." }
];

// The parts of a track by name: nominative for the list, genitive for "there
// is no ...".
// Styles that were the sound of their decade, from the seventies on.
STYLES.push(
    { id: "disco", name: "Диско 70-х", mood: 3, tonic: 2, tempo: [110, 125], parts: ["drums", "bass", "chords", "melody"],
      play: ["Левая рука прыгает басом по октавам: низкая нота, та же на октаву выше. Правая берёт короткий аккорд между долями.",
             "Мелодию играй как струнные: длинные ноты, которые плавно поднимаются к концу фразы."],
      drums: "Начни с бита: бочка на каждую долю, открытый хэт между долями, клэп на 2 и 4. Это и есть диско.",
      bass: "Добавь бас октавами: низкая нота на долю, верхняя между долями. Он должен подпрыгивать.",
      chords: "Добавь короткие аккорды гитарой или электропиано между долями, септаккорды: Dm7, G7, Cmaj7.",
      melody: "Запиши мелодию струнных: длинные ноты в верхней октаве, которые отвечают басу." },
    { id: "funk", name: "Фанк 70-х", mood: 2, tonic: 7, tempo: [95, 115], parts: ["drums", "bass", "chords", "melody"],
      play: ["Главное первая доля: бери её сильно, остальное играй тише и короче. Между нотами оставляй паузы.",
             "Аккорд бери коротко, как щелчок, шестнадцатыми с пропусками: чик, пауза, чик-чик."],
      drums: "Начни с бита: бочка на 1 и с синкопой перед 3, снейр на 2 и 4, хэты шестнадцатыми с акцентами.",
      bass: "Добавь бас: сильная нота на первую долю, потом короткие ноты и паузы. Прыжки на октаву.",
      chords: "Добавь короткие аккорды G7 и C7 шестнадцатыми с пропусками: ритм важнее нот.",
      melody: "Запиши духовые: короткие резкие фразы из двух-трёх нот в ответ басу." },
    { id: "kosmische", name: "Берлинская школа", mood: 4, tonic: 9, tempo: [100, 130], parts: ["bass", "chords", "melody"],
      play: ["Левая рука держит одну басовую ноту или повторяет её восьмыми. Правая медленно меняет аккорд раз в четыре такта.",
             "Сыграй фразу из восьми нот и повторяй её без остановки, меняя по одной ноте за раз."],
      bass: "Начни с секвенции: восемь нот шестнадцатыми по кругу, Arpeggiator или клип. Она идёт весь трек.",
      chords: "Добавь пэд: один аккорд на четыре или восемь тактов, медленный фильтр.",
      melody: "Запиши соло поверх: длинные ноты с Glide, которые поднимаются всё выше." },
    { id: "synthpop", name: "Синти-поп 80-х", mood: 4, tonic: 9, tempo: [110, 130], parts: ["drums", "bass", "chords", "melody"],
      play: ["Левая рука играет бас ровными восьмыми, правая ведёт простую мелодию из длинных нот.",
             "Мелодию строй из двух фраз: вопрос вверх, ответ вниз. Её должно хотеться напеть."],
      drums: "Начни с драм-машины: бочка на 1 и 3, снейр с эхом на 2 и 4, хэты восьмыми.",
      bass: "Добавь синтезаторный бас восьмыми: основная нота аккорда, иногда октава.",
      chords: "Добавь пэд или короткие аккорды: Am, F, C, G. По одному на такт.",
      melody: "Запиши мелодию-крючок из восьми нот ярким лидом. В припеве подними её на октаву." },
    { id: "italo", name: "Итало-диско 80-х", mood: 4, tonic: 9, tempo: [115, 128], parts: ["drums", "bass", "melody", "chords"],
      play: ["Левая рука: бас шестнадцатыми через октаву, низкая-высокая-высокая-низкая. Правая: мелодия восьмыми.",
             "Мелодия простая и сладкая, вся на опорных нотах. Повтори её дважды, второй раз закончи выше."],
      drums: "Начни с бита: бочка на каждую долю, клэп на 2 и 4, открытый хэт между долями.",
      bass: "Добавь бас шестнадцатыми с прыжком на октаву: он идёт без остановки весь трек.",
      melody: "Запиши мелодию ярким синтезатором: восемь нот, которые повторяются.",
      chords: "Добавь струнный пэд под мелодию: Am, F, G, Em." },
    { id: "electro", name: "Электро 80-х", mood: 8, tonic: 9, tempo: [105, 125], parts: ["drums", "bass", "melody"],
      play: ["Играй отрывисто, как машина: каждая нота одной длины, без нажима.",
             "Бас и мелодия перекликаются: два удара баса, два удара мелодии, пауза."],
      drums: "Начни с бита 808: бочка на 1, перед 2 и на 3 с синкопой, снейр на 2 и 4, ковбелл и хэты.",
      bass: "Добавь синтезаторный бас: короткие ноты в ритм бочки, прыжки на октаву.",
      melody: "Запиши роботную мелодию из пяти нот пентатоники. Или голос через Vocoder." },
    { id: "acid", name: "Эйсид-хаус 80-х", mood: 4, tonic: 9, tempo: [118, 128], parts: ["drums", "bass", "melody"],
      play: ["Играй шестнадцатыми на двух-трёх нотах: одна и та же, октава вверх, соседняя. Фильтр двигай второй рукой.",
             "Некоторые ноты бери внахлёст: с Glide они съезжают, и линия начинает визжать."],
      drums: "Начни с бита: бочка 909 на каждую долю, клэп на 2 и 4, открытый хэт между долями.",
      bass: "Добавь кислотную линию: шестнадцатые на одной-двух нотах с прыжками на октаву и съездами.",
      melody: "Запиши движение фильтра: Freq и Res автоматизацией, от глухого к визгу и обратно." },
    { id: "triphop", name: "Трип-хоп 90-х", mood: 3, tonic: 2, tempo: [70, 95], parts: ["drums", "bass", "chords", "melody"],
      play: ["Играй медленно и позже доли, будто нехотя. Между фразами долгие паузы.",
             "Левая рука держит один низкий аккорд, правая роняет две-три ноты и ждёт."],
      drums: "Начни с бита: тяжёлый медленный брейк, бочка на 1, снейр на 3. Пыльный и глухой.",
      bass: "Добавь бас: глубокий, из двух-трёх нот, с длинными паузами.",
      chords: "Добавь мрачные аккорды: струнные или электропиано, Dm7 и Gm7. Один на два такта.",
      melody: "Запиши мелодию: несколько нот пианино или голоса с большим эхом." },
    { id: "bigbeat", name: "Биг-бит 90-х", mood: 8, tonic: 4, tempo: [110, 140], parts: ["drums", "bass", "melody"],
      play: ["Играй риф, как гитарист: три-четыре ноты пентатоники, громко и одинаково каждый раз.",
             "Перед возвращением рифа сделай паузу на целую долю: тишина тут сильнее удара."],
      drums: "Начни с громкого брейка: живые барабаны с перегрузом, бочка на 1, снейр на 2 и 4.",
      bass: "Добавь бас: перегруженный, повторяет риф октавой ниже.",
      melody: "Запиши риф из четырёх нот и кислотную линию поверх. Риф повторяется весь трек." },
    { id: "gabber", name: "Габбер 90-х", mood: 6, tonic: 4, tempo: [160, 190], parts: ["drums", "melody"],
      play: ["Играй коротко и зло, восьмыми: одна нота долбит, соседняя на полтона её перебивает.",
             "Мелодия из трёх-четырёх нот в миноре, без украшений. Скорость делает всё остальное."],
      drums: "Начни с бочки: перегруженная до хрипа, на каждую долю. Она же играет бас.",
      melody: "Запиши резкую мелодию: короткие ноты яркой пилой, три-четыре ноты по кругу." },
    { id: "electrohouse", name: "Электро-хаус 2000-х", mood: 4, tonic: 9, tempo: [125, 130], parts: ["drums", "bass", "melody"],
      play: ["Бас это мелодия: играй его в нижней октаве отрывисто, с синкопами и съездами.",
             "Одна фраза на два такта, потом её же с изменённым концом."],
      drums: "Начни с бита: плотная бочка на каждую долю, клэп на 2 и 4, хэт между долями.",
      bass: "Добавь грязный бас: пила с перегрузом, ритмичный рисунок с паузами. Sidechain от бочки.",
      melody: "Запиши короткий лид или стаб: две-три ноты, которые отвечают басу." },
    { id: "minimal", name: "Минимал 2000-х", mood: 3, tonic: 2, tempo: [122, 128], parts: ["drums", "bass", "melody"],
      play: ["Играй мало: одна нота на такт, и та не на сильную долю. Слушай, как она встаёт между ударами.",
             "Повтори короткий щелчок или ноту много раз и меняй только место, куда он попадает."],
      drums: "Начни с бита: тихая бочка на каждую долю, щелчки и шорохи вместо снейра, хэт между долями.",
      bass: "Добавь бас: одна короткая нота между ударами бочки, почти без высоты.",
      melody: "Запиши одну деталь: щелчок, каплю или ноту, которая появляется раз в два такта." },
    { id: "tropical", name: "Тропикал-хаус", mood: 0, tonic: 0, tempo: [100, 115], parts: ["chords", "drums", "bass", "melody"],
      play: ["Правая рука играет мелодию коротко и звонко, как на маримбе, между долями.",
             "Аккорды бери мягко и держи: C, G, Am, F. Мелодию строй на их нотах."],
      chords: "Начни с аккордов: мягкий пэд или пианино, C, G, Am, F. По одному на такт.",
      drums: "Добавь лёгкий бит: бочка на каждую долю, щелчок на 2 и 4, шейкер шестнадцатыми.",
      bass: "Добавь бас: мягкий, на основных нотах аккордов, с синкопой.",
      melody: "Запиши мелодию маримбой или флейтой: короткие ноты между долями, светло." },
    { id: "vaporwave", name: "Вейпорвейв 2010-х", mood: 1, tonic: 5, tempo: [60, 90], parts: ["chords", "drums", "bass", "melody"],
      play: ["Играй медленно, как замедленная плёнка: длинные септаккорды, каждый держи целый такт.",
             "Мелодию играй мягко и чуть мимо доли, как музыку из торгового центра сквозь сон."],
      chords: "Начни с аккордов: электропиано, Fmaj7, Em7, Dm7, Cmaj7. Замедли и опусти на пару полутонов.",
      drums: "Добавь бит восьмидесятых: бочка на 1 и 3, снейр с большим эхом на 2 и 4. Медленно.",
      bass: "Добавь бас: мягкий синтезаторный, длинные ноты.",
      melody: "Запиши мелодию саксофоном или синтезатором: плавную, с эхом." },
    { id: "drill", name: "Дрилл 2020-х", mood: 4, tonic: 9, tempo: [138, 144], parts: ["melody", "drums", "bass"],
      play: ["Мелодию играй тёмно и редко: три-четыре ноты в миноре, в верхней октаве.",
             "Бас съезжает от ноты к ноте: бери следующую, не отпуская прежнюю."],
      melody: "Начни с мелодии: мрачное пианино или струнные, три-четыре ноты на два такта.",
      drums: "Добавь бит: хэты триолями с пропусками, снейр на 3 и перед 1, бочка редкая и с синкопой.",
      bass: "Добавь бас 808 со съездами: длинные ноты, которые скользят вверх и вниз." }
);

// Which shape a track of the style takes, as a family: see FORMS.
var FORM_OF = {
    classic: "classic", lofi: "loop", ambient: "long", synthwave: "song", house: "club", techno: "club", trance: "club",
    psy: "club", tribal: "club", dub: "long", rave: "club", dnb: "drop", deephouse: "club", techhouse: "club",
    melodic: "long", dubstep: "drop", futurebass: "drop", trap: "beat", hardstyle: "drop", garage: "club", edm: "drop",
    breaks: "club", chillout: "long", idm: "long", hardtechno: "club", amapiano: "long", afro: "club", phonk: "beat",
    hyperpop: "song", jersey: "beat", nightcore: "song", eurodance: "song", chiptune: "song", psydub: "long",
    psybass: "drop", metal: "riff", disco: "song", funk: "riff", kosmische: "long", synthpop: "song", italo: "song",
    electro: "beat", acid: "club", triphop: "loop", bigbeat: "drop", gabber: "drop", electrohouse: "drop",
    minimal: "club", tropical: "drop", vaporwave: "loop", drill: "beat"
};

// The shape of a whole track, part by part, and how it grows.
var FORMS = {
    club: ["16 тактов бочка и перкуссия, 16 с басом, основная часть 32, провал 16 без бочки, вторая основная 32 с новой деталью, выход 16: партии уходят по одной.",
           "Каждые 8 тактов добавляй или убирай один элемент: хэт, клэп, слой перкуссии. Бочку убирай только в провале, и её возвращение станет событием."],
    drop: ["Вступление 8-16 тактов, подводка 8 с дробью и шумом вверх, тишина на последнюю долю, дроп 16, передышка 8-16, вторая подводка и другой дроп, короткий выход.",
           "Вся сила в контрасте. Перед дропом убери низ и сузь звук, в дропе верни бас и ширину. Второй дроп не копия: смени ритм баса или добавь партию."],
    song: ["Вступление 4-8 тактов, куплет 16 из двух-трёх партий, припев 8-16 всем составом, второй куплет с новой деталью, припев, бридж 8 в другой краске, последний припев вдвое длиннее.",
           "Куплет рассказывает, припев поднимает: в нём мелодия выше, аккорды шире, барабаны плотнее. Перед припевом на такт оставь почти тишину."],
    loop: ["Петля на 4-8 тактов и её версии. Сначала одни аккорды, потом бит и бас. Каждые 8 тактов что-то уходит или приходит. Трек короткий: 2-3 минуты.",
           "Петля не должна надоесть: меняй мелочи. Убери бочку на такт, сдвинь мелодию на октаву, открой фильтр. Одна перемена на 8 тактов."],
    long: ["Дуга на 6-9 минут. Начало из воздуха и одной партии, каждые 16-32 такта входит ещё одна, в середине провал почти до тишины, потом полный состав и долгий уход.",
           "Не спеши. Новая партия входит тихо и растёт несколько тактов: рисуй громкость и фильтр автоматизацией. Заметен должен быть не вход, а перемена."],
    beat: ["Вступление 4-8 тактов: мелодия без баса. Основная часть 16, смена 8 (бит вполовину или без бочки), вторая основная 16 с новой перкуссией. Конец резкий, через 2-3 минуты.",
           "Бит держится на паузах. Выключи бочку на такт перед возвращением, оставь мелодию одну, верни всё разом. Хэты меняй чаще остального."],
    classic: ["Три части: тема 8-16 тактов, середина в другой краске (соседняя тональность или минор), снова тема, которая заканчивается на тонике.",
              "Повторяй тему с изменением: выше на октаву, тише, с другим басом. Перед возвращением темы сделай замедление или паузу."],
    riff: ["Риф один на 4 такта, куплет на рифе 8-16, вставка 4-8 с новым рифом, первый риф возвращается тяжелее, брейкдаун вдвое медленнее, финал на главном рифе.",
           "Риф повторяют, пока он не вбит в голову, а потом ломают: меняют последнюю долю, счёт или темп вдвое. Тишина перед ударом тяжелее удара."]
};
// What to think about at each stage of a track, whatever the style:
// 0 an idea, 1 the loop, 2 its versions, 3 scenes ready, 4 a short
// arrangement, 5 a long one, 6 marked, 7 with space, 8 finished.
var STAGE_NAMES = ["идея", "петля", "версии петли", "сцены", "первая лента", "форма", "переходы", "сведение", "финал"];
var STAGE_TIPS = [
    ["Начни с одной петли на 4 или 8 тактов. Пока она не качает сама по себе, длинный трек её не спасёт.",
     "Сначала сделай главное в этом стиле, остальные партии подстраивай под него. Одна сильная идея лучше пяти средних."],
    ["Партии не должны толкаться. Бас внизу, аккорды в середине, мелодия наверху: разведи их по октавам.",
     "Оставляй дыры. Если бас играет на первую долю, мелодии там лучше молчать: партии отвечают друг другу, а не говорят хором.",
     "Проверь петлю на слух: включи её по кругу на две минуты. Что надоело первым, то упрощай или убирай."],
    ["Сделай из петли три версии: бедную (одна-две партии), полную и другую (тот же бас, новые аккорды или мелодия). Это вступление, основная часть и середина.",
     "Версия это вычитание: копия сцены минус бочка, минус бас или минус мелодия. Новых нот почти не нужно.",
     "Придумай вторую мелодию или ответ на первую: она понадобится во второй половине трека."],
    ["Расставь сцены сверху вниз в порядке трека и назови их (Ctrl+R): вступление, нарастание, основная, провал, финал.",
     "Перед записью на ленту проиграй сцены по очереди и сосчитай такты: части длиной 8, 16 или 32 такта звучат естественно."],
    ["Смотри на ленту как на карту энергии: где мало клипов по высоте, там тихо. Хорошая карта похожа на горы с долиной посередине.",
     "Вступление и выход делай из тех же партий, что и основную часть, только по одной: трек собирается и разбирается у слушателя на глазах."],
    ["Проверь пропорции: главный подъём стоит примерно на двух третях трека, перед ним самое тихое место.",
     "Вторая половина не должна повторять первую: добавь новую партию, подними мелодию на октаву или смени аккорды."],
    ["Займись стыками частей: за такт до новой части сбивка на барабанах, шум вверх или обрыв всего на одну долю.",
     "Нарисуй автоматизацию: фильтр, который открывается 16 тактов, даёт движение даже там, где ноты не меняются."],
    ["Сравни громкость частей: провал заметно тише основной части, иначе подъёму некуда расти.",
     "Послушай трек целиком без остановок и запиши секунды, где стало скучно. Там нужна перемена или сокращение."],
    ["Дай треку отлежаться день и послушай свежими ушами на другом устройстве: в наушниках, на телефоне.",
     "Концовка тоже часть формы: резкий обрыв, затухание или последняя нота с эхом. Выбери одну и сделай её намеренно."]
];

// At which stage the track in the Live Set is.
function jamStage(found, style) {
    if (!found || !found.api) {
        return 1;
    }
    var missing = 0;
    for (var i = 0; i < style.parts.length; i++) {
        if (!found.has[style.parts[i]]) {
            missing++;
        }
    }
    if (missing === style.parts.length) {
        return 0;
    }
    if (missing > 0) {
        return 1;
    }
    if (found.arranged === 0) {
        return found.scenes < 3 ? 2 : 3;
    }
    return found.bars < 32 ? 4 : found.cues === 0 ? 5 : !found.space ? 6 : !found.limiter ? 7 : 8;
}

// Which instrument of Live to take for every part of every style, and how to
// set it. The names are the ones written on the devices.
var SOUNDS = {
    classic: { chords: "Рояль: набери в поиске браузера Grand Piano, или возьми Electric для мягкости. Ничего не крути, добавь Reverb: Decay 2-3 секунды, Dry/Wet 20%.",
               melody: "Тот же рояль октавой выше аккордов. Для струнного звука возьми Tension: в блоке Excitator выбери Bow.",
               bass: "Нижние ноты рояля. Или контрабас: Tension, Excitator Plectrum, на октаву ниже." },
    lofi: { chords: "Electric: звук электропиано. После него Redux (Bit Depth около 10) и Auto Filter: срежь верх до 3-4 кГц. Чуть Chorus-Ensemble.",
            drums: "808 Core Kit или любой набор Boom Bap из Drums. На дорожку Vinyl Distortion и Drum Buss: бит должен шуршать и быть глухим.",
            bass: "Drift: волна Sine, режим Mono, фильтр прикрыт. Ноты длинные. Громкость ниже, чем кажется нужным.",
            melody: "Electric или Collision (Mallet): короткие стеклянные ноты. Echo с включённым Wobble и Reverb, чтобы звук плыл." },
    ambient: { chords: "Wavetable или Drift: Attack 2-3 секунды, Release 4-5, фильтр полуприкрыт. Reverb: Decay 8-10 секунд, Dry/Wet 50%.",
               melody: "Operator: одна синусоида, короткий Decay. Echo: Feedback 60%, фильтр эха прикрыт. Каждая нота как капля." },
    synthwave: { drums: "707 Core Kit или 808 Core Kit. На снейр Reverb с большим Dry/Wet, после него Gate: это тот самый удар восьмидесятых.",
                 bass: "Analog или Drift: волна Saw, Mono, фильтр прикрыт, Res чуть-чуть, Sustain высокий. Играй восьмыми.",
                 chords: "Analog: два генератора Saw, второй слегка расстроен (Detune). Attack чуть длиннее, сверху Chorus-Ensemble и Reverb.",
                 melody: "Drift: Saw, режим Unison, небольшой Glide. Echo восьмыми с точкой, Reverb. Звук яркий и поющий." },
    house: { drums: "909 Core Kit: бочка на каждую долю, клэп на 2 и 4, открытый хэт между долями. Drum Buss: чуть Drive и Boom.",
             bass: "Drift: Saw или Sine, Mono, Sustain в ноль, Decay короткий: бас как щипок. Compressor с Sidechain от бочки.",
             chords: "Electric или Wavetable: короткие аккорды. Auto Filter срезает низ, немного Reverb. Устройство Chord даёт аккорд с одной клавиши.",
             melody: "Wavetable: плак с коротким Decay. Echo: 1/8 с точкой, Feedback 40%." },
    techno: { drums: "909 Core Kit. Бочку сделай длиннее и грязнее: Saturator (Drive 6-10 дБ) и Drum Buss. Хэты тихие, шестнадцатыми.",
              bass: "Operator: синусоида, одна нота между ударами бочки. Или низкий том из набора. Compressor с Sidechain от бочки.",
              melody: "Drift: Saw, Mono, Res высокий, Freq двигай рукой. Echo и Reverb на посыле. Одна-две ноты, вся музыка в фильтре." },
    trance: { drums: "909 Core Kit: бочка на каждую долю, открытый хэт между долями, клэп на 2 и 4. Перед сменой части дробь снейра.",
              bass: "Drift: Saw, Mono, Sustain в ноль: короткая нота между ударами бочки. Sidechain обязателен.",
              chords: "Wavetable: Saw, Unison 5-7 голосов: это суперпила. Attack чуть-чуть, Release длинный, Reverb большой.",
              melody: "Drift или Wavetable: плак, Decay 200-300 мс. Echo 1/8 с точкой, Feedback 50%. Arpeggiator 1/16 для перебора." },
    psy: { drums: "Бочка короткая и щёлкающая, без хвоста: убавь у неё Decay. Хэты шестнадцатыми, снейр на 2 и 4.",
           bass: "Drift: Saw, Mono, Sustain в ноль, Decay очень короткий, фильтр полузакрыт. Три шестнадцатых между ударами бочки, одной нотой.",
           melody: "Drift: Saw, Res высокий, Freq на LFO или крути рукой. Echo и Phaser-Flanger. Кислотные линии шестнадцатыми." },
    tribal: { drums: "Наборы с перкуссией: конги, бонги, шейкеры (ищи в Drums слова Perc и Latin). Несколько слоёв с разным рисунком.",
              bass: "Drift: Sine, Mono, короткий. Или низкий том как бас. Одна-две ноты: ритм важнее высоты.",
              melody: "Collision: резонатор Marimba или Membrane, деревянный стук. Фразы из трёх нот, Echo на слабую долю." },
    dub: { drums: "Сухой набор: 606 Core Kit или 808 Core Kit. Удар рима или снейра на третью долю. Отдельные удары бросай в Echo посылом.",
           bass: "Drift или Operator: Sine, Mono, фильтр почти закрыт. Бас громкий, круглый, без верхов.",
           chords: "Electric или орган: короткий аккорд на слабую долю. Echo: 1/4 с точкой, Feedback 60%, фильтр эха прикрыт.",
           melody: "Wavetable с мягкой атакой, как мелодика или духовые. Мало нот, много Echo и Reverb." },
    rave: { drums: "909 Core Kit и брейк: перетащи петлю из раздела Drums и ускорь. Drum Buss, Drive побольше.",
            bass: "Operator или Drift: Saw, Mono, Glide. Громкий, с Saturator. Низкая нота держится под аккордами.",
            chords: "Wavetable: яркий стаб, Attack в ноль, Decay короткий. Устройство Chord даёт весь аккорд с одной клавиши.",
            melody: "Drift: Saw, Unison. Или пианино с Reverb. Простая мажорная фраза, которую хочется кричать." },
    dnb: { drums: "Брейк из раздела Drums на темпе 170-174 или 909 Core Kit: бочка на 1, снейр на 2 и 4, ещё бочка перед третьей долей.",
           bass: "Operator: синусоида, длинные ноты. Для рычания второй слой: Drift, Saw, Mono, Saturator и Auto Filter с LFO.",
           chords: "Wavetable: пэд с длинными Attack и Release. Auto Filter срезает низ. Два аккорда на 8 тактов.",
           melody: "Electric или пианино с Reverb. Редкие ноты поверх быстрого бита: мелодия вдвое медленнее барабанов." },
    deephouse: { drums: "909 Core Kit или 707 Core Kit, мягко: бочка, хэт между долями, щелчок на 2 и 4. Немного свинга из Groove.",
                 bass: "Drift: Sine или Triangle, Mono, короткий. Тёплый, без верхов. Compressor с Sidechain от бочки.",
                 chords: "Electric или Wavetable: септаккорды с мягкой атакой. Auto Filter с медленным LFO, Reverb, Chorus-Ensemble.",
                 melody: "Обрывки голоса в Simpler или плак на Wavetable. Echo 1/8, Reverb." },
    techhouse: { drums: "909 Core Kit: плотная бочка, хэты с акцентом между долями, перкуссия вразбивку. Drum Buss.",
                 bass: "Drift: Saw или Rectangle, Mono, Sustain в ноль, Decay короткий, Res чуть выше. Рисунок из двух-трёх нот. Sidechain.",
                 melody: "Короткий стаб или обрывок голоса в Simpler. Одна-две ноты на такт, Echo, Auto Filter с автоматизацией." },
    melodic: { drums: "909 Core Kit, мягко: бочка, хэты, клэп. Много воздуха: Reverb на перкуссии, хэты тихие.",
               bass: "Drift: Saw, Mono, фильтр прикрыт, ноты длинные. Sidechain от бочки делает из них волну.",
               melody: "Wavetable или Drift: плак, Arpeggiator 1/16, фильтр медленно открывай автоматизацией. Echo и Reverb большие.",
               chords: "Wavetable: пэд, Attack 1 секунда, Release 3. Reverb: Decay 6 секунд. Аккорды минорные и меняются редко." },
    dubstep: { drums: "Половинный темп: бочка на 1, снейр на 3. Снейр тяжёлый, с Reverb. Подойдёт 808 Core Kit.",
               bass: "Wavetable или Operator: Mono, Auto Filter с LFO в ритм (1/4, 1/8, триоли), Saturator или Roar. Под ним отдельная синусоида.",
               melody: "Короткие стабы или колокольчики в провале: Operator. В дропе мелодия это сам бас." },
    futurebass: { chords: "Wavetable: Saw, Unison 7 голосов. Громкость качай устройством Auto Pan-Tremolo (Phase в ноль), 1/8 или 1/16.",
                  drums: "808 Core Kit: бочка, клэп на третью долю, хэты с дробями. Перед дропом дробь снейра.",
                  bass: "Operator: синусоида с длинным Decay. Повторяет нижние ноты аккордов.",
                  melody: "Обрывки голоса в Simpler, сдвинутые по высоте, или колокольчик на Operator. Reverb, Echo." },
    trap: { drums: "808 Core Kit: бочка редкая, клэп на третью долю, хэты восьмыми с дробями 1/16 и 1/32 и триолями.",
            bass: "Бас 808: Operator, синусоида, Pitch Env чуть вниз, Decay длинный, Saturator. Mono и Glide: ноты съезжают одна в другую.",
            melody: "Тёмный колокольчик или пианино: Operator или Electric. Минорная фраза в верхней октаве, Reverb." },
    hardstyle: { drums: "Бочка главный инструмент: длинная, перегруженная. Saturator с Drive до упора, потом EQ Eight. Клэп на 2 и 4.",
                 melody: "Wavetable: Saw, Unison, резкий звук. Мелодия в миноре восьмыми, Reverb. В провале та же мелодия на пианино.",
                 chords: "Суперпила на Wavetable под мелодией: длинные аккорды. Compressor с Sidechain от бочки." },
    garage: { drums: "909 Core Kit или 707 Core Kit: бочка на 1 и перед 3, снейр на 2 и 4, хэты со свингом (Groove, Swing 16ths).",
              bass: "Operator: синусоида с небольшим Osc-B Level, Mono, Glide. Короткие ноты с паузами и прыжками на октаву.",
              chords: "Electric или орган: короткие септаккорды со свингом. Auto Filter, Reverb.",
              melody: "Обрывки голоса в Simpler, порезанные и сдвинутые по высоте. Echo." },
    edm: { drums: "Бочка большая и чистая, на каждую долю. Клэп на 2 и 4. Перед дропом дробь снейра, которая учащается.",
           melody: "Wavetable: Saw, Unison, яркий лид. Фраза из 4-8 нот. Reverb и Compressor с Sidechain от бочки.",
           chords: "Суперпила: Wavetable, Unison 7 голосов. В провале те же аккорды на пианино, тихо.",
           bass: "Drift: Saw, Mono, повторяет ритм аккордов октавой ниже. Sidechain от бочки." },
    breaks: { drums: "Брейк из раздела Drums в Simpler, режим Slice: бочка на 1, снейр на 2 и 4, между ними ломаные удары.",
              bass: "Operator: синусоида. Или Drift: Saw с прикрытым фильтром, Mono. Бас отвечает бочке.",
              melody: "Стаб на Wavetable или кислотная линия на Drift (Saw, Res высокий). Echo." },
    chillout: { chords: "Electric или Wavetable: мягкий пэд, Attack полсекунды. Chorus-Ensemble, Reverb.",
                drums: "707 Core Kit или 808 Core Kit, тихо: шейкер, рим вместо снейра. Немного свинга из Groove.",
                bass: "Drift: Sine, Mono, длинные ноты. Тёплый и тихий.",
                melody: "Гитара или флейта: Tension (Plectrum) или Wavetable с мягкой атакой. Echo, Reverb." },
    idm: { drums: "Любой набор через Beat Repeat (Chance 30%, Variation побольше). Удары не на сетке, такты разной длины.",
           melody: "Operator: колокольчики (прибавь Osc-B Level). Или Collision. Короткие ноты, Grain Delay, Reverb.",
           chords: "Wavetable: пэд, позиция в таблице медленно едет. Тёплый фон под сломанным битом." },
    hardtechno: { drums: "909 Core Kit: бочка через Saturator или Roar до хрипа, хвост длинный, он же бас. Хэты и райд громкие.",
                  bass: "Отдельный бас не нужен: это хвост бочки. Или один гудящий тон: Operator, синусоида, Saturator.",
                  melody: "Drift: Saw, Res высокий, одна нота с движением фильтра. Или сирена: Glide и LFO на высоту." },
    amapiano: { drums: "Шейкер шестнадцатыми, рим и конги, бочка мягкая и редкая. 808 Core Kit и перкуссия.",
                bass: "Лог-драм: Operator, синусоида, Pitch Env вниз, Decay короткий, Saturator. Звук как удар по дереву с нотой.",
                chords: "Electric или пианино: септаккорды и нонаккорды, мягко. Reverb.",
                melody: "Пианино или флейта: короткие фразы с паузами. Echo." },
    afro: { drums: "Бочка на каждую долю, сверху слои перкуссии: конги, шейкер, ковбелл (ищи в Drums слова Perc и Latin).",
            bass: "Drift: Sine или Triangle, Mono, короткий. Ритм синкопами, отвечает перкуссии.",
            melody: "Collision: резонатор Marimba. Короткая фраза по кругу. Echo, Reverb.",
            chords: "Wavetable: пэд с медленным фильтром. Два аккорда на весь трек." },
    phonk: { melody: "Ковбелл из 808 Core Kit: перетащи его в Simpler и играй им мелодию. Или тёмное пианино. Redux и Saturator.",
             drums: "808 Core Kit: бочка, клэп на 2 и 4, хэты шестнадцатыми. Всё через Saturator, грязно.",
             bass: "Бас 808: Operator, синусоида, Decay длинный, Saturator с большим Drive, Glide." },
    hyperpop: { chords: "Wavetable: суперпила, очень ярко. После неё Multiband Dynamics с пресетом OTT. Sidechain от бочки.",
                drums: "Бочка перегружена до хрипа, снейр металлический, хэты с дробями. Redux на всю группу.",
                bass: "Бас 808 через Saturator до искажения. Или Drift: Saw, Mono, Glide.",
                melody: "Яркий лид или голос, сдвинутый вверх. Redux, Echo, Reverb. Здесь не бывает слишком." },
    jersey: { drums: "Бочка пять раз на такт: на 1, 2, 3 и два удара в конце. 808 Core Kit или 909 Core Kit, клэпы.",
              bass: "Бас 808: Operator, синусоида, короткий, повторяет ритм бочки.",
              melody: "Обрывки голоса в Simpler, порезанные в ритм бочки. Или простой плак." },
    nightcore: { chords: "Wavetable: суперпила или яркое пианино. Всё выше и быстрее обычного.",
                 drums: "909 Core Kit: бочка на каждую долю, клэп на 2 и 4, открытый хэт между долями.",
                 melody: "Яркий лид: Drift, Saw, Unison. Мелодия восьмыми и шестнадцатыми в верхней октаве. Echo.",
                 bass: "Drift: Saw, Mono, короткий, между ударами бочки. Sidechain." },
    eurodance: { drums: "909 Core Kit: бочка на каждую долю, открытый хэт между долями, клэп на 2 и 4.",
                 bass: "Drift или Operator: короткий бас между ударами бочки, октавами.",
                 melody: "Wavetable или Drift: Saw, яркий лид. Мелодия-крючок из 8 нот. Echo, Reverb.",
                 chords: "Пианино короткими аккордами или пэд на Wavetable." },
    chiptune: { melody: "Drift: волна Rectangle или Pulse, режим Mono, фильтр открыт до упора. После него Redux: Bit Depth 4-6.",
                bass: "Drift: Triangle, Mono, короткие ноты октавами.",
                drums: "606 Core Kit через Redux. Бочка это короткий падающий тон, хэт это шум." },
    psydub: { drums: "Мягкий набор, половинный темп: бочка на 1, рим или снейр на 3. Перкуссия с Echo.",
              bass: "Drift: Sine, Mono, Glide. Певучая линия, Sustain высокий, фильтр прикрыт.",
              chords: "Короткий аккорд на слабую долю: Electric или Wavetable. Echo: 1/4 с точкой, включи Wobble.",
              melody: "Сквелч: Drift, Saw, Res высокий, Freq двигай рукой. Или Collision. Grain Delay, Reverb." },
    psybass: { drums: "Половинный темп: бочка на 1, снейр на 3, хэты с триолями и свингом. Beat Repeat на стыках.",
               bass: "Drift или Wavetable: Saw, Mono, Auto Filter (тип Vowel или LFO), скорость LFO меняй каждый такт. Saturator.",
               melody: "Operator: бипы с Pitch Env. Echo, Grain Delay. Короткие фразы, которые рассыпаются.",
               chords: "Wavetable: пэд с длинным Attack, Reverb. Воздух в провалах." },
    metal: { drums: "Живой набор (ищи в Drums слова Acoustic и Rock): бочка шестнадцатыми, снейр на третью долю.",
             bass: "Drift: Saw, Mono, короткий, через Amp и Cabinet. Играет то же, что риф, октавой ниже.",
             melody: "Риф: Drift (Saw, Mono) или Tension через Amp (тип Heavy) и Cabinet. Для лида режим Unison и Pedal.",
             chords: "Синтезаторный слой: Wavetable, пэд или перебор через Arpeggiator 1/16 и Redux." },
    disco: { drums: "707 Core Kit или живой набор: бочка на каждую долю, открытый хэт между долями, клэп на 2 и 4. Сухо, без эффектов.",
             bass: "Бас-гитара: Tension (Plectrum) или Drift: Triangle, Mono, короткий. Октавы: низкая на долю, высокая между.",
             chords: "Electric: короткие септаккорды. Auto Filter с огибающей (Envelope) даёт квакающий звук, как у гитары.",
             melody: "Струнные: Wavetable, Saw, Unison, Attack 100 мс. Или духовые: короткие яркие ноты." },
    funk: { drums: "Живой набор (ищи в Drums слова Acoustic и Funk). Сухо, плотно: хэты шестнадцатыми с акцентами.",
            bass: "Бас-гитара: Tension (Plectrum) или Drift: Triangle, Mono, Sustain низкий. Auto Filter с огибающей для слэпа.",
            chords: "Electric через Auto Filter с огибающей: клавинет. Или гитарный чик: короткие аккорды в середине клавиатуры.",
            melody: "Духовые: Wavetable, Saw, быстрая атака, короткие ноты. Или орган." },
    kosmische: { bass: "Analog или Drift: Saw, Mono, Sustain в ноль, Decay короткий. Arpeggiator 1/16 или клип из восьми нот. Echo 1/8 с точкой.",
                 chords: "Wavetable или Analog: пэд, Attack 2 секунды, Release 4. Phaser-Flanger медленно, Reverb большой.",
                 melody: "Drift: Saw или Sine, Mono, Glide побольше. Длинные ноты с Echo: соло, которое плывёт." },
    synthpop: { drums: "707 Core Kit или 808 Core Kit. На снейр Reverb с большим Dry/Wet, после него Gate.",
                bass: "Analog или Drift: Saw или Pulse, Mono, фильтр прикрыт, Sustain низкий. Ровные восьмые.",
                chords: "Analog: два генератора Saw, Chorus-Ensemble. Короткие аккорды или пэд с Attack 200 мс.",
                melody: "Drift: Pulse или Saw, небольшой Glide. Echo 1/8, Reverb. Звук простой и ясный." },
    italo: { drums: "707 Core Kit: бочка на каждую долю, клэп на 2 и 4, открытый хэт между долями. Клэп с Reverb.",
             bass: "Drift или Analog: Saw, Mono, Sustain в ноль, Decay короткий. Шестнадцатые через октаву без остановки.",
             melody: "Drift: Saw, Unison. Или Wavetable. Echo 1/8 с точкой, Reverb. Сладко и ярко.",
             chords: "Wavetable: струнный пэд, Attack 300 мс. Chorus-Ensemble." },
    electro: { drums: "808 Core Kit: длинная бочка, сухой снейр, ковбелл, хэты шестнадцатыми. Никакого свинга.",
               bass: "Drift: Saw или Rectangle, Mono, короткий. Ноты в ритм бочки.",
               melody: "Drift: Rectangle, Mono. Или голос через Vocoder (Carrier: External, от синтезатора). Echo." },
    acid: { drums: "909 Core Kit: бочка на каждую долю, клэп на 2 и 4, открытый хэт между долями.",
            bass: "Drift: Saw или Rectangle, Mono, включи Legato, Glide небольшой, Res почти до упора, Sustain в ноль. После него Saturator.",
            melody: "Вся мелодия в ручке Freq: запиши её движение автоматизацией. Echo 1/8 с точкой на посыле." },
    triphop: { drums: "Брейк из раздела Drums, замедленный до 80-90. Drum Buss, Vinyl Distortion, срежь верх: бит глухой и тяжёлый.",
               bass: "Drift: Sine, Mono, длинные ноты, фильтр прикрыт. Громко и низко.",
               chords: "Electric или струнные на Wavetable с долгой атакой. Redux слегка, Reverb.",
               melody: "Пианино или обрывок голоса в Simpler. Echo с Feedback 50% и Reverb: далеко и одиноко." },
    bigbeat: { drums: "Брейк из раздела Drums через Drum Buss (Drive, Crunch) и Saturator. Громко и грязно.",
               bass: "Drift: Saw, Mono, через Saturator или Pedal. Повторяет риф.",
               melody: "Риф: Drift или Tension через Amp. Сверху кислотная линия: Drift, Saw, Res высокий, двигай Freq." },
    gabber: { drums: "909 Core Kit: бочку через Saturator (Drive до упора) и ещё раз через Pedal. Хвост бочки гудит как бас.",
              melody: "Wavetable или Drift: Saw, Unison, резко. Короткие ноты, Reverb немного. Звук как сирена." },
    electrohouse: { drums: "909 Core Kit: плотная бочка, клэп на 2 и 4, хэт между долями. Glue Compressor на группу.",
                    bass: "Wavetable или Drift: Saw, Mono, Saturator или Roar, Auto Filter с автоматизацией. Compressor с Sidechain от бочки.",
                    melody: "Wavetable: короткий стаб или лид, Unison. Отвечает басу в паузах." },
    minimal: { drums: "Тихая бочка, вместо снейра щелчки и шорохи: перетащи в Drum Rack короткие звуки Perc. Хэт между долями.",
               bass: "Operator: синусоида, очень короткая нота между ударами бочки. Sidechain.",
               melody: "Одна деталь: Collision (короткий стук) или Operator (бип). Echo с автоматизацией Feedback." },
    tropical: { chords: "Мягкий пэд на Wavetable или пианино. Compressor с Sidechain от бочки: аккорды покачиваются.",
                drums: "Лёгкая бочка на каждую долю, щелчок пальцами на 2 и 4, шейкер. 707 Core Kit и перкуссия.",
                bass: "Drift: Sine или Triangle, Mono, короткий, с синкопой.",
                melody: "Маримба: Collision, резонатор Marimba. Или флейта: Wavetable с мягкой атакой. Echo, Reverb." },
    vaporwave: { chords: "Electric: септаккорды. Chorus-Ensemble, Reverb большой. Всю дорожку опусти на 2-3 полутона и замедли.",
                 drums: "707 Core Kit: снейр с Reverb и Gate. Темп медленный, всё через Redux слегка.",
                 bass: "Drift или Analog: Saw, фильтр прикрыт, длинные ноты. Chorus-Ensemble.",
                 melody: "Wavetable: мягкий лид с Glide или саксофон из сэмплов. Echo и Reverb, как из соседнего зала." },
    drill: { melody: "Тёмное пианино или струнные: Electric с прикрытым верхом (Auto Filter) или Wavetable. Reverb.",
             drums: "808 Core Kit: хэты триолями с пропусками, снейр на третью долю и перед первой, бочка с синкопой.",
             bass: "Бас 808: Operator, синусоида, Decay длинный, Mono и Glide побольше: ноты съезжают. Saturator." }
};

var PART_NAMES = { drums: ["БАРАБАНЫ", "барабанов"], bass: ["БАС", "баса"], chords: ["АККОРДЫ", "аккордов"], melody: ["МЕЛОДИЯ", "мелодии"] };

// The page the trainer stands on while the player plays freely.
var FREE = lesson("Свободная игра", "free", "", "", {});
FREE.id = "free";
FREE.group = -1;
FREE.index = 0;
FREE.place = 0;
FREE.title = caps(FREE.title);
FREE.why = "";
FREE.hint = "";

var jam = { style: 0, mood: STYLES[0].mood, tonic: STYLES[0].tonic };
var backTo = null;          // the lesson to return to from free play
var jamLine = [];           // the latest notes of the melody, as pitches
var jamLineAt = -1000;      // tick of the latest of them
var jamChord = null;        // the chord held last
var jamChordAt = -1000;
var jamView = null;         // what the screen shows this frame: harmony, hint, notes to go to

function inJam() {
    return current === FREE;
}

function jamScale() {
    return MOODS[jam.mood][3];
}

// Makes the stage judge the playing by the chosen scale. For a scale of five
// or six notes it is lenient: the other notes of the minor around it are not
// wrong, they are just not suggested.
function applyJam() {
    var mood = MOODS[jam.mood];
    var intervals = (mood[5] || mood[3]).concat(mood[3]);
    scalePcs = [];
    var i;
    for (i = 0; i < intervals.length; i++) {
        var pc = (jam.tonic + intervals[i]) % 12;
        if (scalePcs.indexOf(pc) < 0) {
            scalePcs.push(pc);
        }
    }
    // The major key nearest to the scale tells home chords from foreign ones.
    var best = 0;
    var bestHits = -1;
    for (var k = 0; k < 12; k++) {
        var hits = 0;
        for (i = 0; i < 7; i++) {
            if (scalePcs.indexOf((FIFTHS_PC[k] + SCALES.major[i]) % 12) >= 0) {
                hits++;
            }
        }
        if (hits > bestHits) {
            bestHits = hits;
            best = k;
        }
    }
    keyIndex = best;
    wheelKey = "";
    coachReset();
}

function enterJam() {
    if (!inJam()) {
        backTo = current;
        selectLesson(FREE);
    }
}

function leaveJam() {
    var to = backTo || LESSONS[0];
    backTo = null;
    selectLesson(to);
}

function jamStyle(delta) {
    jam.style = (jam.style + delta + STYLES.length) % STYLES.length;
    jam.mood = STYLES[jam.style].mood;
    jam.tonic = STYLES[jam.style].tonic;
    styleAt = clock;
    applyJam();
    rememberJam();
}

function jamMood(delta) {
    jam.mood = (jam.mood + delta + MOODS.length) % MOODS.length;
    moodAt = clock;
    applyJam();
    rememberJam();
}

function jamTonic(pc) {
    jam.tonic = pc;
    moodAt = clock;
    applyJam();
    rememberJam();
}

// The choice goes into the save file, so the next session opens the same way.
function rememberJam() {
    var was = progress.jam || {};
    var on = inJam();
    if (was.on !== on || was.style !== STYLES[jam.style].id || was.mood !== jam.mood || was.tonic !== jam.tonic) {
        progress.jam = { on: on, style: STYLES[jam.style].id, mood: jam.mood, tonic: jam.tonic };
        if (ticker) {
            saveAt = clock + 6;
        }
    }
}

function recallJam(saved) {
    if (!saved) {
        return false;
    }
    for (var i = 0; i < STYLES.length; i++) {
        if (STYLES[i].id === saved.style) {
            jam.style = i;
            jam.mood = saved.mood >= 0 && saved.mood < MOODS.length ? saved.mood : STYLES[i].mood;
            jam.tonic = saved.tonic >= 0 && saved.tonic < 12 ? saved.tonic : STYLES[i].tonic;
        }
    }
    return !!saved.on;
}

// The chord a scale builds on one of its notes, as the wheel and the preview
// need it; null for a note outside the scale.
function jamDegreeChord(pc) {
    var scale = MOODS[jam.mood][5] || MOODS[jam.mood][3];
    var degree = scale.indexOf((pc - jam.tonic + 12) % 12);
    if (degree < 0 || scale.length !== 7) {
        return null;
    }
    var third = (scale[(degree + 2) % 7] - scale[degree] + 12) % 12;
    var fifth = (scale[(degree + 4) % 7] - scale[degree] + 12) % 12;
    var kind = third === 4 && fifth === 7 ? "" : third === 3 && fifth === 7 ? "m"
             : third === 3 && fifth === 6 ? "°" : third === 4 && fifth === 8 ? "+" : null;
    if (kind === null) {
        return null;
    }
    return { name: ROOT_NAMES[pc] + kind, root: pc, minor: third === 3, kind: kind, intervals: [0, third, fifth],
             pcs: [pc, (pc + third) % 12, (pc + fifth) % 12], bass: -1, jam: true };
}

// The notes the melody can lean on right now: those of the chord under it,
// or, while no chord sounds, those of the home chord.
function jamHarmony() {
    if (jamChord && clock - jamChordAt < 48) {
        return jamChord.pcs;
    }
    var home = jamDegreeChord(jam.tonic);
    return home ? home.pcs : [jam.tonic, (jam.tonic + 7) % 12];
}

// How well a note suits the melody: 3 = a note of the chord under it,
// 2 = the note that colours the mood, 1 = in the scale, 0 = outside.
function noteTier(pc, harmony) {
    var interval = (pc - jam.tonic + 12) % 12;
    if (jamScale().indexOf(interval) < 0) {
        return 0;
    }
    if (harmony.indexOf(pc) >= 0) {
        return 3;
    }
    return interval === MOODS[jam.mood][4] ? 2 : 1;
}

var TIER_COLOURS = [STEEL, SKY, YELLOW, LIME];

// The next note of the scale above or below a pitch.
function scaleStep(pitch, direction) {
    var scale = jamScale();
    for (var p = pitch + direction; Math.abs(p - pitch) <= 12; p += direction) {
        if (scale.indexOf(((p - jam.tonic) % 12 + 12) % 12) >= 0) {
            return p;
        }
    }
    return pitch;
}

// The nearest note of the harmony that is not the pitch itself.
function nearestRest(pitch, harmony) {
    for (var distance = 1; distance < 12; distance++) {
        if (harmony.indexOf((pitch - distance + 120) % 12) >= 0) {
            return pitch - distance;
        }
        if (harmony.indexOf((pitch + distance) % 12) >= 0) {
            return pitch + distance;
        }
    }
    return pitch;
}

function pitchNames(pitches) {
    var names = [];
    for (var i = 0; i < pitches.length; i++) {
        var name = ROOT_NAMES[((pitches[i] % 12) + 12) % 12];
        if (names.indexOf(name) < 0) {
            names.push(name);
        }
    }
    return names.length > 1 ? names.slice(0, names.length - 1).join(", ") + " ИЛИ " + names[names.length - 1] : names.join("");
}

// What to play next: a line of advice and the notes it points at. The rules
// are the plain ones of melody writing: lean on the notes of the chord, move
// by step, come back by step after a leap, do not stay long on passing notes.
function jamAdvice(harmony) {
    if (jamLine.length === 0 || clock - jamLineAt > 60) {
        return { text: "НАЧНИ С ОПОРНОЙ НОТЫ: " + pitchNames(harmony), next: harmony.slice() };
    }
    var last = jamLine[jamLine.length - 1];
    var before = jamLine.length > 1 ? jamLine[jamLine.length - 2] : last;
    var tier = noteTier(last % 12, harmony);
    var up = scaleStep(last, 1);
    var down = scaleStep(last, -1);
    var rest = nearestRest(last, harmony);
    if (tier === 0) {
        return { text: "НОТА " + ROOT_NAMES[last % 12] + " МИМО ЛАДА. РЯДОМ СВОИ: " + pitchNames([down, up]), next: [down, up] };
    }
    if (Math.abs(last - before) >= 5) {
        var back = last > before ? down : up;
        return { text: "ПОСЛЕ СКАЧКА ВЕРНИСЬ ШАГОМ: НА " + pitchNames([back]), next: [back] };
    }
    var passing = 0;
    for (var i = jamLine.length - 1; i >= 0 && noteTier(jamLine[i] % 12, harmony) < 3; i--) {
        passing++;
    }
    if (passing >= 3) {
        return { text: "ДОЛГО БЕЗ ОПОРЫ. ПРИЗЕМЛИСЬ НА " + pitchNames([rest]), next: [rest] };
    }
    if (tier === 2) {
        return { text: "ЭТО КРАСКА ЛАДА. РАЗРЕШИ ЕЁ В " + pitchNames([rest]), next: [rest] };
    }
    if (tier === 3) {
        return { text: "ОПОРА. ЗАДЕРЖИСЬ ИЛИ ШАГНИ НА " + pitchNames([down, up]), next: [down, up] };
    }
    return { text: "ПРОХОДЯЩАЯ. ШАГНИ НА " + pitchNames([down, up]) + ", ОПОРА РЯДОМ: " + pitchNames([rest]), next: [down, up, rest] };
}

// Called once per frame in free play: everything the drawing needs.
function jamLook() {
    var harmony = jamHarmony();
    var advice = jamAdvice(harmony);
    // the keys the task of the coach wants are lit in a colour of their own
    var goal = coachTargets() || [];
    var nextPcs = [];
    for (var i = 0; i < advice.next.length; i++) {
        nextPcs.push(((advice.next[i] % 12) + 12) % 12);
    }
    jamView = { harmony: harmony, text: advice.text, next: advice.next, nextPcs: nextPcs, goal: goal };
    return jamView;
}

// Remembers a note of the melody. A note that turns out to be the first of
// a chord is taken back by forgetJamNote().
function jamNote(pitch) {
    jamLine.push(pitch);
    if (jamLine.length > 8) {
        jamLine.shift();
    }
    jamLineAt = clock;
}

function forgetJamNote() {
    jamLine.pop();
}

// ---- what is in the Live Set

var INSTRUMENTS = ["Drift", "Operator", "UltraAnalog", "InstrumentVector", "InstrumentMeld", "LoungeLizard", "Collision",
                   "StringStudio", "OriginalSimpler", "MultiSampler", "InstrumentGroupDevice", "InstrumentImpulse",
                   "DrumGroupDevice", "DrumCell", "PluginDevice", "AuPluginDevice", "MxDeviceInstrument"];
var DRUM_BOXES = ["DrumGroupDevice", "DrumCell", "InstrumentImpulse"];
var SPACE_DEVICES = "Reverb,Hybrid,Delay,Echo,FilterDelay,GrainDelay";

// What a track is for, told by its name (in small letters).
var PART_WORDS = [
    ["drums", /drum|kit|beat|perc|kick|snare|hat|clap|808|909|707|бараб|ударн|бочк|бит|перк/],
    ["bass", /bass|sub|бас|саб/],
    ["chords", /pad|chord|keys|piano|organ|string|rhodes|пэд|аккорд|клав|пиан|орган|струн/],
    ["melody", /lead|melod|arp|pluck|vocal|vox|flute|лид|мелод|арп|плак|вокал|голос|флейт/]
];

// What a clip is for, told by its notes: stacked notes are chords, low notes
// are a bass, the rest is a melody.
function partOfNotes(notes) {
    var sum = 0;
    var starts = {};
    var stack = 1;
    for (var i = 0; i < notes.length; i++) {
        sum += Number(notes[i].pitch);
        var key = Math.round(Number(notes[i].start_time) * 50);
        starts[key] = (starts[key] || 0) + 1;
        stack = Math.max(stack, starts[key]);
    }
    return stack >= 3 ? "chords" : (sum / notes.length < 52 ? "bass" : "melody");
}

// One track of the Live Set: its part, its clips, the scenes they stand in.
var partMemo = {};      // what the notes of a track said about its part, until the track changes
var scanRound = 0;      // how many times the Live Set has been looked through

function lookAtTrack(index) {
    var path = "live_set tracks " + index;
    var track = liveAt(path);
    if (!track) {
        return null;
    }
    // everything the track itself tells is read here: the roamer moves on below
    var row = { name: liveText(track, "name"), part: "", clips: 0, arranged: 0, scenes: [], instrument: false, space: false,
                selected: looking.chosen !== "" && String(track.id) === looking.chosen };
    var slots = children(track, "clip_slots", 16);
    row.arranged = children(track, "arrangement_clips", 999);
    var devices = listDevices(path, false) || [];
    var drums = false;
    var i;
    for (i = 0; i < devices.length; i++) {
        row.instrument = row.instrument || INSTRUMENTS.indexOf(devices[i].cls) >= 0;
        drums = drums || DRUM_BOXES.indexOf(devices[i].cls) >= 0;
        row.space = row.space || SPACE_DEVICES.split(",").indexOf(devices[i].cls) >= 0;
    }
    var first = "";
    for (i = 0; i < slots; i++) {
        if (Number(liveGet(path + " clip_slots " + i, "has_clip")) === 1) {
            row.clips++;
            row.scenes.push(i);
            first = first || path + " clip_slots " + i + " clip";
        }
    }
    if (first === "" && row.arranged > 0) {
        first = path + " arrangement_clips 0";
    }
    var name = row.name.toLowerCase();
    if (drums) {
        row.part = "drums";
    }
    for (i = 0; i < PART_WORDS.length && row.part === ""; i++) {
        if (PART_WORDS[i][1].test(name)) {
            row.part = PART_WORDS[i][0];
        }
    }
    if (row.part === "" && first !== "") {
        // Reading the notes of a clip is the dearest question of all. It is
        // asked again only when the track looks different, now and then in
        // case the notes were rewritten, and a little sooner while the clip
        // is still empty.
        var sign = row.name + "|" + first + "|" + row.clips + "|" + row.arranged;
        var memo = partMemo[index];
        if (!memo || memo.sign !== sign || scanRound - memo.round >= (memo.part === "" ? 2 : 6)) {
            var notes = notesOf(first);
            memo = partMemo[index] = { sign: sign, round: scanRound, part: notes && notes.length > 0 ? partOfNotes(notes) : "" };
        }
        row.part = memo.part;
    }
    return row;
}
// The whole Live Set from its tracks: which parts exist (a track of that kind
// with a clip), which are only prepared (the track is there, the clip is not),
// how many scenes hold clips, how long the arrangement is.
function sumUpProject(rows) {
    var out = { api: true, tempo: Number(liveGet("live_set", "tempo")), tracks: rows.length, has: {}, empty: {},
                clips: 0, scenes: 0, arranged: 0, bars: 0, cues: liveCount("live_set", "cue_points") || 0,
                space: false, limiter: false, selectedPart: "" };
    var scenes = {};
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        out.clips += row.clips;
        out.arranged += row.arranged;
        out.space = out.space || row.space;
        for (var s = 0; s < row.scenes.length; s++) {
            if (!scenes[row.scenes[s]]) {
                scenes[row.scenes[s]] = true;
                out.scenes++;
            }
        }
        if (row.part !== "" && row.selected) {
            out.selectedPart = row.part;
        }
        if (row.part !== "") {
            if (row.clips + row.arranged > 0) {
                out.has[row.part] = true;
            } else {
                out.empty[row.part] = true;
            }
        }
    }
    if (out.arranged > 0) {
        out.bars = Math.floor(Number(liveGet("live_set", "song_length")) / 4);
    }
    var returns = findDevices("return", SPACE_DEVICES, false);
    out.space = out.space || !!(returns && returns.length > 0);
    var master = findDevices("master", "Limiter", false);
    out.limiter = !!(master && master.length > 0);
    return out;
}

var project = null;         // what the latest look at the Live Set found
var looking = { track: 0, rows: [], restAt: 0 };

// A little of the look on every tick, one track at a time, so that Ableton is
// never kept busy; then a pause, and round again.
function lookAtProject(atOnce) {
    if (typeof LiveAPI === "undefined") {
        project = { api: false };
        return;
    }
    if (!atOnce && (clock < looking.restAt || clock % 3 !== 0)) {
        return;
    }
    var count = liveCount("live_set", "tracks");
    if (count === null) {
        project = { api: false };
        return;
    }
    if (looking.track === 0) {
        var chosen = liveAt("live_set view selected_track");
        looking.chosen = chosen ? String(chosen.id) : "";
    }
    if (looking.track < Math.min(count, 16)) {
        var row = lookAtTrack(looking.track);
        if (row) {
            looking.rows.push(row);
        }
        looking.track++;
        return;
    }
    var before = project;
    project = sumUpProject(looking.rows);
    // a part that was not there a moment ago is news: the advice turns to it
    for (var part in PART_NAMES) {
        var was = before && before.api && (before.has[part] || before.empty[part]);
        if (before && before.api && !was && (project.has[part] || project.empty[part])) {
            projectNews = { part: part, at: clock };
        }
    }
    // so is the track the player has just gone to: the advice turns to its sound
    if (before && before.api && project.selectedPart !== "" && project.selectedPart !== before.selectedPart) {
        projectNews = { part: project.selectedPart, at: clock };
    }
    scanRound++;
    looking = { track: 0, rows: [], restAt: clock + 36 };
}

// The same look in one go, for the self-check and the tests.
function lookAtProjectNow() {
    looking = { track: 0, rows: [], restAt: 0 };
    project = null;
    for (var i = 0; i < 20 && project === null; i++) {
        lookAtProject(true);
    }
    return project;
}

// What the track needs next, for the chosen style. The order is the order
// tracks are usually built in: tempo, the parts one by one, scenes, the
// arrangement, its length and marks, space, loudness.
function nextStep(found, style) {
    if (!found || !found.api) {
        return style[style.parts[0]];
    }
    if (found.tempo < style.tempo[0] - 0.5 || found.tempo > style.tempo[1] + 0.5) {
        return "Темп сейчас " + Math.round(found.tempo) + ". Для стиля " + style.name + " поставь от " + style.tempo[0] + " до "
             + style.tempo[1] + ": дважды щёлкни по цифре темпа вверху слева и набери число.";
    }
    for (var i = 0; i < style.parts.length; i++) {
        var part = style.parts[i];
        if (!found.has[part]) {
            return (found.empty[part] ? "Дорожка для " + PART_NAMES[part][1] + " есть, но клипа в ней нет. "
                                      : (i === 0 ? "" : "Пока нет " + PART_NAMES[part][1] + ". ")) + style[part];
        }
    }
    if (found.scenes < 3 && found.arranged === 0) {
        return "Партии есть. Теперь сцены: выдели сцену справа, нажми Ctrl+D и удали в копии часть клипов. Нужны хотя бы три: вступление, основная часть и концовка. Сейчас сцен с клипами: " + found.scenes + ".";
    }
    if (found.arranged === 0) {
        return "Сцены готовы. Запиши их на ленту: нажми кружок записи вверху (F9) и запускай сцены по очереди, каждую тактов на восемь. Потом Tab.";
    }
    if (found.bars < 32) {
        return "На ленте " + found.bars + " тактов. Доведи хотя бы до 32: выдели часть целиком и нажми Ctrl+Shift+D, она повторится следом.";
    }
    if (found.cues === 0) {
        return "Разметь части локаторами: правый щелчок по линейке над лентой, Add Locator. По ним видно форму трека целиком.";
    }
    if (!found.space) {
        return "Добавь пространство: Reverb на дорожку возврата и немного посыла Send A у мелодии и аккордов.";
    }
    if (!found.limiter) {
        return "Поставь Limiter на дорожку Main: трек станет громче и перестанет хрипеть на пиках.";
    }
    return "Всё на месте. Сохрани проект (Ctrl+S) и выгрузи файл: Ctrl+A на ленте, потом Ctrl+Shift+R.";
}

// The line of tags over the advice: tempo, the parts, scenes, arrangement.
// The line is as wide as the keyboard and shares it with the counter of the
// pages of advice, so the parts go by short names here.
var TAG_NAMES = { drums: "БИТ", bass: "БАС", chords: "АККОРДЫ", melody: "МЕЛОДИЯ" };
var TAG_GAP = 6;

function projectTags(found, style) {
    var tags = [];
    if (!found || !found.api) {
        return [["ABLETON НЕ ВИДЕН: СОВЕТ ПО СТИЛЮ", SLATE]];
    }
    var inTempo = found.tempo >= style.tempo[0] - 0.5 && found.tempo <= style.tempo[1] + 0.5;
    tags.push(["ТЕМП " + Math.round(found.tempo), inTempo ? LIME : YELLOW]);
    for (var i = 0; i < style.parts.length; i++) {
        var part = style.parts[i];
        tags.push([TAG_NAMES[part], found.has[part] ? LIME : (found.empty[part] ? YELLOW : SLATE)]);
    }
    tags.push(["СЦЕН " + found.scenes, found.scenes >= 3 ? LIME : SLATE]);
    tags.push([found.arranged > 0 ? "ЛЕНТА " + found.bars : "ЛЕНТА", found.bars >= 32 ? LIME : (found.arranged > 0 ? YELLOW : SLATE)]);
    return tags;
}

// ---------------------------------------------------------------- progress

// done = the best score of every finished lesson; reps = how many more times
// a training lesson was run after its first.
var progress = { v: 1, points: 0, done: {}, reps: {}, last: "start/0" };

// How much of the path is behind: lessons finished, out of all that can be
// finished (the page for free play has nothing to finish).
var pathDone = 0;
var pathTotal = LESSONS.filter(function (item) { return item.kind !== "free"; }).length;

function savePath() {
    try {
        var file = this.patcher.filepath;
        var slash = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
        return slash < 0 ? "" : file.substring(0, slash + 1) + SAVE_NAME;
    } catch (error) {
        return "";
    }
}

function readProgress() {
    try {
        var path = savePath();
        if (path === "") {
            return null;
        }
        var file = new File(path, "read");
        if (!file.isopen) {
            return null;
        }
        var text = file.readstring(60000);
        file.close();
        var data = JSON.parse(text);
        if (!data || typeof data.points !== "number" || !data.done) {
            return null;
        }
        data.reps = data.reps || {}; // files written before the training lessons have none
        data.fines = data.fines || 0;
        return data;
    } catch (error) {
        return null;
    }
}

// Points are the sum of the best score of every finished lesson, plus a
// little for every repeat of a training lesson, minus the fines for noise.
function recount() {
    var total = 0;
    var id;
    progress.reps = progress.reps || {};
    for (id in progress.done) {
        total += progress.done[id];
    }
    for (id in progress.reps) {
        total += progress.reps[id] * REPEAT_PAY;
    }
    progress.points = Math.max(0, total + (progress.jamPts || 0) - (progress.fines || 0));
    pathDone = 0;
    for (var i = 0; i < LESSONS.length; i++) {
        if (LESSONS[i].kind !== "free" && progress.done[LESSONS[i].id] > 0) {
            pathDone++;
        }
    }
}

// Noise costs points. A fine never takes more than what has been earned
// since the last stage opened: a stage that is open stays open.
function fine(amount) {
    var floor = 0;
    for (var g = 0; g < GROUPS.length; g++) {
        if (GROUPS[g].need <= progress.points && GROUPS[g].need > floor) {
            floor = GROUPS[g].need;
        }
    }
    var taken = Math.min(amount, progress.points - floor);
    if (taken <= 0) {
        return 0;
    }
    progress.fines = (progress.fines || 0) + taken;
    recount();
    combo = 0;
    popups.push({ text: "-" + taken, age: 0, colour: RED });
    // the counter shakes and sheds red sparks
    pointsFlash = { until: clock + 8, colour: RED, shake: true };
    for (var i = 0; i < 5; i++) {
        spawn(DOT, SX + 8 + i * 5, SY + 12, (i - 2) * 0.5, 0.6, 0.35, 12, RED, null);
    }
    if (ticker) {
        saveAt = clock + 12;
    }
    return taken;
}

var FINE_STORM = 5;     // points lost when the playing turns into cacophony
var FINE_NOTE = 1;      // and for every further stroke while it lasts
var stormFined = false;

// Called after every key press. In a lesson only keys the step did not ask
// for count: a chromatic run or a cluster that the lesson wants is not noise.
// "single": the stroke is one hit for sure (a pad), whatever the count of
// the notes in the latest chord says.
function cacophony(single) {
    if (mood !== -2) {
        stormFined = false;
        return;
    }
    if (!inJam() && currentStep() && !wrong) {
        return;
    }
    if (!stormFined) {
        stormFined = true;
        fine(FINE_STORM);
    } else if (single || onsetNotes === 1) {
        fine(FINE_NOTE);
    }
}

var lastDiskStamp = 0;  // the mark of the latest save found in the file

// Takes over what another trainer (say, the one on the drum track) has
// earned in the meantime.
function mergeDisk() {
    var disk = readProgress();
    progress.reps = progress.reps || {};
    if (disk) {
        lastDiskStamp = disk.stamp || 0;
        if (disk.fines > (progress.fines || 0)) {
            progress.fines = disk.fines;
        }
        if (disk.jamPts > (progress.jamPts || 0)) {
            progress.jamPts = disk.jamPts;
        }
        if (disk.coach > (progress.coach || 0)) {
            progress.coach = disk.coach;
        }
        var id;
        for (id in disk.done) {
            if (!(progress.done[id] >= disk.done[id])) {
                progress.done[id] = disk.done[id];
            }
        }
        for (id in disk.reps) {
            if (!(progress.reps[id] >= disk.reps[id])) {
                progress.reps[id] = disk.reps[id];
            }
        }
    }
    recount();
}

// The file is read again before every save and merged, so a second trainer
// on another track does not wipe out what this one has earned.
function saveProgress() {
    recount();
    try {
        var path = savePath();
        if (path === "") {
            return;
        }
        mergeDisk();
        // Who wrote this and how far into the lesson they were: the other
        // copies of the trainer follow the one that was used last.
        progress.who = me;
        progress.stamp = Math.max(nowMs(), lastDiskStamp + 1, seenStamp + 1);
        progress.step = phase === "run" && current !== FREE && !current.gen ? step : -1;
        seenStamp = progress.stamp;
        var file = new File(path, "write", "TEXT");
        if (!file.isopen) {
            return;
        }
        file.eof = 0;
        file.writestring(JSON.stringify(progress));
        file.close();
    } catch (error) {
        post("SMK Trainer: could not save progress\n");
    }
}

// A trainer can stand on several tracks at once: Ableton shows the devices
// of one track at a time, so a copy on every track keeps the trainer in
// sight. The copies act as one. Each save carries the name of the copy that
// made it; once a second every other copy looks at the file and takes over
// the lesson, the step, the style of free play and the points.
var me = (new Date().getTime() % 1000000) * 1000 + Math.floor(Math.random() * 1000);
var seenStamp = 0;

function followOthers() {
    var disk = readProgress();
    if (!disk || !disk.who || disk.who === me || !(disk.stamp > seenStamp)) {
        return;
    }
    seenStamp = disk.stamp;
    var target = null;
    for (var i = 0; i < LESSONS.length; i++) {
        if (LESSONS[i].id === disk.last) {
            target = LESSONS[i];
        }
    }
    if (!target) {
        return;
    }
    mergeDisk();
    progress.last = disk.last;
    progress.jam = disk.jam;
    if (recallJam(disk.jam)) {
        backTo = target;
        if (inJam()) {
            applyJam();
        } else {
            selectLesson(FREE);
        }
    } else {
        backTo = null;
        var running = disk.step >= 0;
        if (inJam() || current !== target || (running ? phase !== "run" || step !== disk.step : phase === "run")) {
            selectLesson(target);
            if (running && phase === "intro") {
                phase = "run";
                step = Math.min(disk.step, steps.length - 1);
                rememberBaseline();
            }
        }
    }
    saveAt = -1;    // nothing of this was done here: there is nothing to write
}

function groupOpen(g) {
    return progress.points >= GROUPS[g].need;
}

function lessonOpen(item) {
    if (item === FREE) {
        return true;
    }
    if (!groupOpen(item.group)) {
        return false;
    }
    // A shelf is a stage whose lessons can be taken in any order.
    if (item.index === 0 || item.kind === "free" || GROUPS[item.group].shelf) {
        return true;
    }
    var previous = GROUPS[item.group].lessons[item.index - 1];
    return previous.kind === "free" || progress.done[previous.id] > 0;
}

// ------------------------------------------------------------------ state

var current = LESSONS[0];
var steps = [];
var phase = "intro";    // intro, run, done, locked
var step = 0;
var held = [];          // sorted MIDI pitches currently pressed
var achieved = false;   // the step was played, waiting for release
var wrong = false;      // a key outside the step is pressed
var stepMistake = false;
var mistakes = 0;
var streak = 0;         // steps in a row without a mistake
var stepTimes = [];     // ms of every finished step, for the evenness score
var baseline = {};      // Ableton values remembered when a mission step starts
var stepClock = 0;      // tick at which the current step began
var reward = null;      // what the finished lesson gave: {total, gain, lines, opened}
var shownPoints = 0;    // the counter on the stage, catching up with the real one
var preview = null;     // chord being previewed after a click
var previewNotes = [];
var previewTask = null;

// Animation state.
var slimeShift = 0;
var frogShift = 11;
var burstStart = -1000;
var confettiStart = -1000;
var notes = [];         // floating notes over the keyboard: {x, y, colour, age}
var popups = [];        // "+120" over the stage: {text, age}

// How good the playing sounds, judged note by note: -1 is cacophony, 1 is
// music. It fades back to 0 when nobody plays. The stage acts on the mood:
// -2 storm, -1 trouble, 0 calm, 1 dance, 2 fire, 3 trip.
var vibe = 0;
var mood = 0;
var moodClock = 0;      // tick of the last mood change
var recentOns = [];     // ticks of the latest key presses, to spot a mashed keyboard
var lastPitch = -1;
var lastOn = -1000;     // tick of the latest key press
var recentPcs = [];     // pitch classes of the latest key presses, for variety
var lastChord = "";     // the chord played last, and how often it came in a row
var lastChordPcs = [];
var sameChord = 0;
var onsetMs = 0;        // time of the latest onset: a note or a whole chord
var pulse = 0;          // length of the beat the player keeps, in ms; 0 = unknown
var groove = 0;         // onsets in a row that landed on the pulse grid
var misses = 0;         // onsets in a row that did not
var rhythm = 0;         // verdict on the latest onset: 1, -1 or 0
var beats = 0;          // onsets counted so far: the dance floor steps on each
var moodMs = 0;         // time of the last mood change
var onsetNotes = 0;     // keys in the current onset
var onsetCounted = false;
var lastMelody = -1000; // tick of the latest melody move
var melodyBefore = -1000;
var chordChange = -1000; // tick of the latest change to a different chord
var banner = "";
var bannerUntil = 0;
var particles = [];
var flash = 0;          // ticks left of the current lightning flash
var bolt = [];          // the lightning bolt as rectangles
var seed = 20261116;

// --------------------------------------------------------------- Live API

var liveObjects = {};

function liveObject(path) {
    if (typeof LiveAPI === "undefined") {
        return null;
    }
    try {
        var object = liveObjects[path];
        // An object that found nothing is asked again: the clip or the track
        // it was looking for may have appeared since.
        if (!object || String(object.id) === "0") {
            object = new LiveAPI(path);
            liveObjects[path] = object;
        }
        return String(object.id) === "0" ? null : object;
    } catch (error) {
        return null;
    }
}

function liveGet(path, property) {
    try {
        var object = liveObject(path);
        if (!object) {
            return null;
        }
        var value = object.get(property);
        return value instanceof Array ? value[0] : value;
    } catch (error) {
        return null;
    }
}

function liveCount(path, children) {
    try {
        var object = liveObject(path);
        return object ? object.getcount(children) : null;
    } catch (error) {
        return null;
    }
}

var TRACK = "this_device canonical_parent";

// Looks through the clip slots of the trainer's own track.
function trackClips(property) {
    var slots = liveCount(TRACK, "clip_slots");
    if (slots === null) {
        return null;
    }
    for (var i = 0; i < slots && i < 16; i++) {
        var slot = TRACK + " clip_slots " + i;
        if (Number(liveGet(slot, "has_clip")) === 1) {
            if (property === "" || Number(liveGet(slot + " clip", property)) === 1) {
                return true;
            }
        }
    }
    return false;
}

function countClips() {
    var slots = liveCount(TRACK, "clip_slots");
    if (slots === null) {
        return null;
    }
    var clips = 0;
    for (var i = 0; i < slots && i < 16; i++) {
        if (Number(liveGet(TRACK + " clip_slots " + i, "has_clip")) === 1) {
            clips++;
        }
    }
    return clips;
}

function truthy(value) {
    return value === null ? null : Number(value) === 1;
}

// ---- clips and their notes

// The clips a sequencer step looks at: the one open in the note editor, or,
// when none is open, the clips in the slots of the trainer's track.
// null = no Live API here.
function clipPaths() {
    var open = "live_set view detail_clip";
    if (liveFresh(open)) {
        return [open];
    }
    var slots = liveCount(TRACK, "clip_slots");
    if (slots === null) {
        return null;
    }
    var out = [];
    for (var i = 0; i < slots && i < 16; i++) {
        if (Number(liveGet(TRACK + " clip_slots " + i, "has_clip")) === 1) {
            out.push(TRACK + " clip_slots " + i + " clip");
        }
    }
    return out;
}

// True if one of those clips has the property at a value from low to high.
function clipWith(property, low, high) {
    var paths = clipPaths();
    if (paths === null) {
        return null;
    }
    for (var i = 0; i < paths.length; i++) {
        var clip = liveFresh(paths[i]);
        var value = clip ? liveNumber(clip, property) : NaN;
        if (value >= low - 0.01 && value <= high + 0.01) {
            return true;
        }
    }
    return false;
}

// The notes of a clip as Ableton hands them out: a text that holds a list of
// {pitch, start_time, duration, velocity}. null for an audio clip.
function notesOf(path) {
    var clip = liveFresh(path);
    if (!clip) {
        return null;
    }
    try {
        var raw = clip.call("get_notes_extended", 0, 128, 0, 2048);
        if (raw && typeof raw === "object" && !(raw instanceof Array) && raw.notes instanceof Array) {
            return raw.notes;
        }
        var parsed = JSON.parse(raw instanceof Array ? raw.join(" ") : String(raw));
        return parsed && parsed.notes instanceof Array ? parsed.notes : null;
    } catch (error) {
        return null;
    }
}

// All notes of the clips in view; null = cannot tell.
function seenNotes() {
    var paths = clipPaths();
    if (paths === null) {
        return null;
    }
    var all = [];
    var readable = paths.length === 0;
    for (var i = 0; i < paths.length; i++) {
        var notes = notesOf(paths[i]);
        if (notes) {
            readable = true;
            all = all.concat(notes);
        }
    }
    return readable ? all : null;
}

// How many notes pass the test; null = cannot tell.
function countNotes(test) {
    var notes = seenNotes();
    if (notes === null) {
        return null;
    }
    var count = 0;
    for (var i = 0; i < notes.length; i++) {
        if (test(notes[i])) {
            count++;
        }
    }
    return count;
}

// Whether a moment in beats lies on a step of the grid (0.125 = a 32nd).
function onGrid(time, unit) {
    var steps = Number(time) / unit;
    return Math.abs(steps - Math.round(steps)) < 0.02;
}

function atLeast(count, wanted) {
    return count === null ? null : count >= wanted;
}

// ---- devices and their knobs

// Devices come and go, and a kept object would go on pointing at whatever
// used to stand in that place, so these are looked up afresh every time.
function liveFresh(path) {
    if (typeof LiveAPI === "undefined") {
        return null;
    }
    try {
        var object = new LiveAPI(path);
        return String(object.id) === "0" ? null : object;
    } catch (error) {
        return null;
    }
}

// Looking through a Live Set means asking hundreds of objects, and a new
// LiveAPI object for each of them is what makes Ableton stutter: they pile up
// faster than they are thrown away. So one object, the roamer, is sent from
// path to path. What it returns is good until the next liveAt(): read what
// you need from it at once. Whether a LiveAPI object can be sent on at all
// (and how) is found out once; where it cannot, a new object is made after all.
var roamer = null;
var roams = "";         // "" = not tried yet, "goto" or "path" = how it moves, "no" = it does not

function learnToRoam() {
    roams = "no";
    try {
        var probe = new LiveAPI("live_set");
        var ways = ["goto", "path"];
        for (var i = 0; i < ways.length && roams === "no"; i++) {
            try {
                if (String(probe.type) !== "Song") {
                    return;
                }
                if (ways[i] === "goto") {
                    probe.goto("live_set master_track");
                } else {
                    probe.path = "live_set master_track";
                }
                var there = String(probe.type) === "Track";
                if (ways[i] === "goto") {
                    probe.goto("live_set");
                } else {
                    probe.path = "live_set";
                }
                if (there && String(probe.type) === "Song") {
                    roamer = probe;
                    roams = ways[i];
                }
            } catch (notThisWay) {
                probe = new LiveAPI("live_set");
            }
        }
    } catch (error) {
        roams = "no";
    }
}

function liveAt(path) {
    if (typeof LiveAPI === "undefined") {
        return null;
    }
    if (roams === "") {
        learnToRoam();
    }
    if (roams === "no") {
        return liveFresh(path);
    }
    try {
        if (roams === "goto") {
            roamer.goto(path);
        } else {
            roamer.path = path;
        }
        return String(roamer.id) === "0" ? null : roamer;
    } catch (error) {
        return null;
    }
}

// A name with spaces may come back split into several atoms.
function liveText(object, property) {
    try {
        var value = object.get(property);
        return value instanceof Array ? value.join(" ") : String(value);
    } catch (error) {
        return "";
    }
}

function liveNumber(object, property) {
    try {
        var value = object.get(property);
        return Number(value instanceof Array ? value[0] : value);
    } catch (error) {
        return NaN;
    }
}

function children(object, name, limit) {
    try {
        return Math.min(Number(object.getcount(name)) || 0, limit);
    } catch (error) {
        return 0;
    }
}

var RACK = /GroupDevice$/;

// The devices of a track as {path, cls}, in order; with "deep" also the ones
// inside the chains of a rack. null = no Live API here.
function listDevices(track, deep) {
    var owner = liveAt(track);
    if (!owner) {
        return null;
    }
    var out = [];
    var count = children(owner, "devices", 12);
    for (var i = 0; i < count; i++) {
        var path = track + " devices " + i;
        var device = liveAt(path);
        if (!device) {
            continue;
        }
        var cls = liveText(device, "class_name");
        out.push({ path: path, cls: cls });
        if (!deep || !RACK.test(cls)) {
            continue;
        }
        var chains = children(device, "chains", 16);
        for (var c = 0; c < chains; c++) {
            var chain = liveAt(path + " chains " + c);
            var inner = chain ? children(chain, "devices", 3) : 0;
            for (var d = 0; d < inner; d++) {
                var innerPath = path + " chains " + c + " devices " + d;
                var innerDevice = liveAt(innerPath);
                if (innerDevice) {
                    out.push({ path: innerPath, cls: liveText(innerDevice, "class_name") });
                }
            }
        }
    }
    return out;
}

// Where a check looks: the trainer's own track, the master or the returns.
function scopeTracks(scope) {
    if (scope === "master") {
        return ["live_set master_track"];
    }
    if (scope === "return") {
        var count = liveCount("live_set", "return_tracks");
        if (count === null) {
            return null;
        }
        var out = [];
        for (var i = 0; i < count && i < 6; i++) {
            out.push("live_set return_tracks " + i);
        }
        return out;
    }
    return [TRACK];
}

// classes = "Reverb,Hybrid": any of these device classes will do.
function findDevices(scope, classes, deep) {
    var tracks = scopeTracks(scope);
    if (tracks === null) {
        return null;
    }
    var wanted = classes.split(",");
    var found = [];
    for (var t = 0; t < tracks.length; t++) {
        var list = listDevices(tracks[t], deep);
        if (list === null) {
            return null;
        }
        for (var i = 0; i < list.length; i++) {
            if (wanted.indexOf(list[i].cls) >= 0) {
                found.push(list[i]);
            }
        }
    }
    return found;
}

// The top level of the track first; the slower look into racks only once in
// two seconds, so a waiting step does not keep Ableton busy.
var deepLookAt = -1000;

function findDevicesLazily(scope, classes) {
    var found = findDevices(scope, classes, false);
    if (found === null || found.length > 0 || clock - deepLookAt < 24) {
        return found;
    }
    deepLookAt = clock;
    return findDevices(scope, classes, true);
}

// wanted = "LP Freq", "Attack,Decay" or a pattern such as "^[1-8] Gain A$".
function nameMatches(name, wanted) {
    if (wanted.charAt(0) === "^") {
        return new RegExp(wanted).test(name);
    }
    return wanted.split(",").indexOf(name) >= 0;
}

// The knobs the current step listens to, with the place each one stood at
// when the trainer first saw it: the step is about turning it from there.
var knobWatch = null;

function watchKnobs(scope, classes, wanted) {
    var key = scope + ":" + classes + ":" + wanted;
    var i;
    if (knobWatch && knobWatch.key === key) {
        var alive = knobWatch.list.length > 0;
        for (i = 0; i < knobWatch.list.length; i++) {
            if (String(knobWatch.list[i].object.id) === "0") {
                alive = false;
            }
        }
        // A device without such a knob is not searched again for a while:
        // going through a hundred parameters is slow.
        if (alive || clock < knobWatch.until) {
            return knobWatch.list;
        }
    }
    var devices = findDevicesLazily(scope, classes);
    if (devices === null) {
        return null;
    }
    var list = [];
    for (var d = 0; d < devices.length && list.length < 24; d++) {
        var device = liveFresh(devices[d].path);
        var count = device ? children(device, "parameters", 200) : 0;
        for (var p = 0; p < count; p++) {
            var parameter = liveFresh(devices[d].path + " parameters " + p);
            if (!parameter) {
                continue;
            }
            var name = liveText(parameter, "original_name") || liveText(parameter, "name");
            if (!nameMatches(name, wanted)) {
                continue;
            }
            var low = liveNumber(parameter, "min");
            var high = liveNumber(parameter, "max");
            var raw = liveNumber(parameter, "value");
            if (isNaN(raw) || isNaN(low) || isNaN(high)) {
                continue;
            }
            list.push({ object: parameter, min: low, max: high, raw: raw, base: high > low ? (raw - low) / (high - low) : 0 });
        }
    }
    knobWatch = { key: key, list: list, until: devices.length > 0 && list.length === 0 ? clock + 60 : 0 };
    return list;
}

// What Ableton shows for a value of a list parameter, e.g. "Mono"; null if
// it cannot be asked.
function knobText(object, raw) {
    try {
        var text = object.call("str_for_value", raw);
        text = text instanceof Array ? text.join(" ") : String(text);
        return text === "" || text === "undefined" ? null : text;
    } catch (error) {
        return null;
    }
}

// direction: up, down, moved (either way), changed (a switch or a list was
// set to something else), "is Mono" (a list shows that entry), on, off.
// Positions are fractions of the knob's range.
function knobTurned(scope, classes, wanted, direction) {
    var list = watchKnobs(scope, classes, wanted);
    if (list === null) {
        return null;
    }
    for (var i = 0; i < list.length; i++) {
        var knob = list[i];
        var raw = liveNumber(knob.object, "value");
        if (isNaN(raw)) {
            continue;
        }
        var now = knob.max > knob.min ? (raw - knob.min) / (knob.max - knob.min) : 0;
        var done;
        if (direction === "up") {
            done = now >= Math.min(0.98, knob.base + 0.1);
        } else if (direction === "down") {
            done = now <= Math.max(0.02, knob.base - 0.1);
        } else if (direction === "on") {
            done = now >= 0.5;
        } else if (direction === "off") {
            done = now < 0.5;
        } else if (direction === "changed") {
            done = Math.abs(raw - knob.raw) > 0.000001;
        } else if (direction.substring(0, 3) === "is ") {
            // A list is set to the named entry. If Ableton will not tell the
            // name, any change of the list has to do.
            var shown = knobText(knob.object, raw);
            done = shown === null ? Math.abs(raw - knob.raw) > 0.000001
                                  : shown.toLowerCase().indexOf(direction.substring(3).toLowerCase()) >= 0;
        } else {
            done = Math.abs(now - knob.base) >= 0.1;
        }
        if (done) {
            return true;
        }
    }
    return false;
}

function hasDevice(scope, classes) {
    var found = findDevicesLazily(scope, classes);
    return found === null ? null : found.length > 0;
}

// The voice modes of Drift, in the order Ableton lists them.
var VOICE_MODES = ["Poly", "Mono", "Stereo", "Unison"];

// Every check answers true, false or null (cannot tell: no Live API here).
// A lesson names a check as "name" or "name:argument:argument".
var LIVE_CHECKS = {
    // tempo:120:128
    tempo: function (a) {
        var value = liveGet("live_set", "tempo");
        return value === null ? null : Number(value) >= Number(a[0]) - 0.5 && Number(value) <= Number(a[1]) + 0.5;
    },
    // device:Reverb,Hybrid = one of these is on the trainer's track
    device: function (a) { return hasDevice("", a[0]); },
    masterDevice: function (a) { return hasDevice("master", a[0]); },
    returnDevice: function (a) { return hasDevice("return", a[0]); },
    // knob:Drift:LP Freq:down = that knob was turned from where it stood
    knob: function (a) { return knobTurned("", a[0], a[1], a[2]); },
    masterKnob: function (a) { return knobTurned("master", a[0], a[1], a[2]); },
    returnKnob: function (a) { return knobTurned("return", a[0], a[1], a[2]); },
    // voice:Mono = Drift plays in that voice mode. Ableton keeps the mode as a
    // setting of the device, with the list of its names, not as a knob.
    voice: function (a) {
        var found = findDevicesLazily("", "Drift");
        if (found === null) {
            return null;
        }
        for (var i = 0; i < found.length; i++) {
            var device = liveFresh(found[i].path);
            if (!device) {
                continue;
            }
            var names = null;
            try {
                names = device.get("voice_mode_list");
            } catch (error) {
                names = null;
            }
            if (!(names instanceof Array) || names.length < 2) {
                names = VOICE_MODES;
            }
            if (String(names[liveNumber(device, "voice_mode_index")]).toLowerCase() === a[0].toLowerCase()) {
                return true;
            }
        }
        return false;
    },
    // setting:InstrumentVector:unison_mode:1 = a setting of the device stands
    // at that value; setting:InstrumentMeld:unison_voices:1:3 = within a range
    setting: function (a) {
        var found = findDevicesLazily("", a[0]);
        if (found === null) {
            return null;
        }
        var low = Number(a[2]);
        var high = a.length > 3 ? Number(a[3]) : low;
        for (var i = 0; i < found.length; i++) {
            var device = liveFresh(found[i].path);
            var value = device ? liveNumber(device, a[1]) : NaN;
            if (value >= low && value <= high) {
                return true;
            }
        }
        return false;
    },
    // order:Saturator:Reverb = the first stands before the second in the chain
    order: function (a) {
        var list = listDevices(TRACK, false);
        if (list === null) {
            return null;
        }
        var first = -1, second = -1;
        for (var i = 0; i < list.length; i++) {
            if (first < 0 && a[0].split(",").indexOf(list[i].cls) >= 0) {
                first = i;
            }
            if (a[1].split(",").indexOf(list[i].cls) >= 0) {
                second = i;
            }
        }
        return first >= 0 && second > first;
    },
    // simplerMode:2 = Simpler plays in that mode (0 classic, 1 one-shot, 2 slices)
    simplerMode: function (a) {
        var found = findDevicesLazily("", "OriginalSimpler");
        if (found === null) {
            return null;
        }
        for (var i = 0; i < found.length; i++) {
            var device = liveFresh(found[i].path);
            if (device && liveNumber(device, "playback_mode") === Number(a[0])) {
                return true;
            }
        }
        return false;
    },
    clipAdded: function () {
        var value = countClips();
        return value === null ? null : value > baseline.clips;
    },
    clipAutomation: function () { return trackClips("has_envelopes"); },
    automationArm: function () { return truthy(liveGet("live_set", "session_automation_record")); },
    loopOn: function () { return truthy(liveGet("live_set", "loop")); },
    scaleOn: function () { return truthy(liveGet("live_set", "scale_mode")); },
    quantizeOn: function () {
        var value = liveGet("live_set", "midi_recording_quantization");
        return value === null ? null : Number(value) > 0;
    },
    muted: function () { return truthy(liveGet(TRACK, "mute")); },
    unmuted: function () {
        var value = liveGet(TRACK, "mute");
        return value === null ? null : Number(value) === 0;
    },
    soloed: function () { return truthy(liveGet(TRACK, "solo")); },
    unsoloed: function () {
        var value = liveGet(TRACK, "solo");
        return value === null ? null : Number(value) === 0;
    },
    panMoved: function () {
        var value = liveGet(TRACK + " mixer_device panning", "value");
        return value === null ? null : Math.abs(Number(value) - baseline.pan) > 0.1;
    },
    frozen: function () { return truthy(liveGet(TRACK, "is_frozen")); },
    grouped: function () { return truthy(liveGet(TRACK, "is_grouped")); },
    metronomeOn: function () { return truthy(liveGet("live_set", "metronome")); },
    playing: function () { return truthy(liveGet("live_set", "is_playing")); },
    stopped: function () {
        var value = liveGet("live_set", "is_playing");
        return value === null ? null : Number(value) === 0;
    },
    tempo90: function () {
        var value = liveGet("live_set", "tempo");
        return value === null ? null : Math.abs(Number(value) - 90) < 0.6;
    },
    armed: function () { return truthy(liveGet(TRACK, "arm")); },
    hasClip: function () { return trackClips(""); },
    clipPlaying: function () { return trackClips("is_playing"); },
    recordOn: function () { return truthy(liveGet("live_set", "record_mode")); },
    arrangement: function () {
        var value = liveGet("live_app view", "focused_document_view");
        return value === null ? null : String(value) === "Arranger";
    },
    session: function () {
        var value = liveGet("live_app view", "focused_document_view");
        return value === null ? null : String(value) === "Session";
    },
    newTrack: function () {
        var value = liveCount("live_set", "tracks");
        return value === null ? null : value > baseline.tracks;
    },
    deviceAdded: function () {
        var value = liveCount(TRACK, "devices");
        return value === null ? null : value > baseline.devices;
    },
    volumeMoved: function () {
        var value = liveGet("live_set tracks 0 mixer_device volume", "value");
        return value === null ? null : Math.abs(Number(value) - baseline.volume) > 0.03;
    },
    sendUp: function () {
        var value = liveGet(TRACK + " mixer_device sends 0", "value");
        return value === null ? null : Number(value) > 0.1;
    },

    // ---- the sequencer: the clip that is open (or the clips of this track)
    // notesAdded:4 = four notes more than when the step began
    notesAdded: function (a) {
        var notes = seenNotes();
        return notes === null ? null : notes.length >= baseline.notes + Number(a[0]);
    },
    notesRemoved: function (a) {
        var notes = seenNotes();
        return notes === null ? null : notes.length <= baseline.notes - Number(a[0]);
    },
    // clipStack:3 = three notes begin at the same moment: a chord
    clipStack: function (a) {
        var notes = seenNotes();
        if (notes === null) {
            return null;
        }
        var starts = {};
        for (var i = 0; i < notes.length; i++) {
            var key = Math.round(Number(notes[i].start_time) * 50);
            starts[key] = (starts[key] || 0) + 1;
            if (starts[key] >= Number(a[0])) {
                return true;
            }
        }
        return false;
    },
    // clipPitches:5 = notes of five different pitches
    clipPitches: function (a) {
        var notes = seenNotes();
        if (notes === null) {
            return null;
        }
        var pitches = [];
        for (var i = 0; i < notes.length; i++) {
            pitches.push(Number(notes[i].pitch));
        }
        return unique(pitches).length >= Number(a[0]);
    },
    // clipLong:2 = a note two beats long or longer
    clipLong: function (a) {
        return atLeast(countNotes(function (n) { return Number(n.duration) >= Number(a[0]) - 0.01; }), 1);
    },
    // clipVel:1:60 = a note struck with a force from 1 to 60
    clipVel: function (a) {
        return atLeast(countNotes(function (n) { return Number(n.velocity) >= Number(a[0]) && Number(n.velocity) <= Number(a[1]); }), 1);
    },
    // a note that begins off the grid of 32nds: a triplet, or one moved by hand
    clipOffGrid: function () {
        return atLeast(countNotes(function (n) { return !onGrid(n.start_time, 0.125); }), 1);
    },
    clipOnGrid: function () {
        var notes = seenNotes();
        if (notes === null) {
            return null;
        }
        for (var i = 0; i < notes.length; i++) {
            if (!onGrid(notes[i].start_time, 0.125)) {
                return false;
            }
        }
        return notes.length > 0;
    },
    // a note that begins halfway between two beats
    clipOffBeat: function () {
        return atLeast(countNotes(function (n) { return onGrid(Number(n.start_time) + 0.5, 1); }), 1);
    },
    // clipLength:8:8 = the loop of the clip is from 8 to 8 beats long
    clipLength: function (a) { return clipWith("length", Number(a[0]), Number(a[1])); },
    clipLoopOff: function () { return clipWith("looping", 0, 0); },
    clipLoopOn: function () { return clipWith("looping", 1, 1); },
    quantChanged: function () {
        var value = liveGet("live_set", "clip_trigger_quantization");
        return value === null ? null : Number(value) !== baseline.quant;
    },
    sessionRecord: function () { return truthy(liveGet("live_set", "session_record")); },
    countInOn: function () {
        var value = liveGet("live_set", "count_in_duration");
        return value === null ? null : Number(value) > 0;
    },

    // ---- the song: scenes and the arrangement
    sceneAdded: function () {
        var value = liveCount("live_set", "scenes");
        return value === null ? null : value > baseline.scenes;
    },
    locatorAdded: function () {
        var value = liveCount("live_set", "cue_points");
        return value === null ? null : value > baseline.cues;
    },
    // arrClips:1 = this track has a clip in the arrangement
    arrClips: function (a) {
        var value = liveCount(TRACK, "arrangement_clips");
        return value === null ? null : value >= Number(a[0]);
    },
    arrClipAdded: function () {
        var value = liveCount(TRACK, "arrangement_clips");
        return value === null ? null : value > baseline.arranged;
    },
    loopOff: function () {
        var value = liveGet("live_set", "loop");
        return value === null ? null : Number(value) === 0;
    },
    // loopLength:32:32 = the loop of the arrangement is 32 beats long
    loopLength: function (a) {
        var value = liveGet("live_set", "loop_length");
        return value === null ? null : Number(value) >= Number(a[0]) - 0.01 && Number(value) <= Number(a[1]) + 0.01;
    },
    songLonger: function () {
        var value = liveGet("live_set", "song_length");
        return value === null ? null : Number(value) > baseline.song + 0.9;
    },
    // songLength:128 = the arrangement is at least 128 beats long
    songLength: function (a) {
        var value = liveGet("live_set", "song_length");
        return value === null ? null : Number(value) >= Number(a[0]);
    }
};

// "tempo:120:128" → the check called tempo with the arguments 120 and 128.
function checkLive(spec) {
    var parts = spec.split(":");
    var check = LIVE_CHECKS[parts[0]];
    return check ? check(parts.slice(1)) : null;
}

// Looking through devices costs more than reading one value, so those
// checks run less often.
function checkEvery(spec) {
    return /^(device|masterDevice|returnDevice|knob|masterKnob|returnKnob|order|simplerMode|voice|setting|notes|clip)/.test(spec) ? 6 : 3;
}

function rememberBaseline() {
    stepClock = clock;
    knobWatch = null;
    baseline = {
        tracks: liveCount("live_set", "tracks"),
        devices: liveCount(TRACK, "devices"),
        volume: Number(liveGet("live_set tracks 0 mixer_device volume", "value")),
        pan: Number(liveGet(TRACK + " mixer_device panning", "value")),
        clips: countClips(),
        scenes: liveCount("live_set", "scenes"),
        cues: liveCount("live_set", "cue_points"),
        arranged: liveCount(TRACK, "arrangement_clips"),
        quant: Number(liveGet("live_set", "clip_trigger_quantization")),
        song: Number(liveGet("live_set", "song_length")),
        notes: 0
    };
    var s = currentStep();
    // Reading notes takes a moment, so only a step about notes counts them.
    if (s && s.live && /^notes/.test(s.live)) {
        var notes = seenNotes();
        baseline.notes = notes === null ? 0 : notes.length;
    }
    // A knob step remembers where the knob stands before the player touches it.
    if (s && s.live && /[kK]nob:/.test(s.live)) {
        checkLive(s.live);
    }
}

// ---- self-check

// The tests play on a made-up Ableton, so they cannot tell whether the real
// one answers the questions the lessons ask. This can: if a file named
// smk_trainer_probe.txt lies next to the device, the trainer writes down,
// once after loading, what Ableton answers (smk_trainer_probe.json). It only
// reads; nothing in the Live Set is touched.
var PROBE_SONG = ["tempo", "clip_trigger_quantization", "session_record", "count_in_duration", "loop", "loop_length",
                  "song_length", "scale_mode", "midi_recording_quantization", "session_automation_record", "record_mode",
                  "is_playing", "current_song_time"];

var PROBE_CHECKS = ["device:Drift", "voice:Poly", "voice:Mono", "setting:Drift:voice_mode_index:0:3", "knob:Drift:LP Freq:moved",
                    "knob:Drift:^Legato( On)?$:on", "tempo:20:999", "hasClip", "session", "arrangement", "loopOff", "scaleOn",
                    "clipLength:0:9999", "clipStack:3", "clipOnGrid", "arrClips:1", "countInOn", "sessionRecord", "metronomeOn"];

function selfCheck() {
    try {
        var folder = savePath().replace(SAVE_NAME, "");
        if (folder === "") {
            return;
        }
        var asked = new File(folder + "smk_trainer_probe.txt", "read");
        if (!asked.isopen) {
            return;
        }
        asked.close();
        clickLog = [];
        var out = { version: VERSION, api: typeof LiveAPI !== "undefined", song: {}, counts: {}, clips: [], devices: [] };
        // the frame the picture is shown in: it should be as large as the picture
        // can one LiveAPI object be sent from place to place here, and how
        liveAt("live_set");
        out.roams = roams;
        out.band = bandReport();
        try {
            out.frame = { want: [W, H], size: [mgraphics.size[0], mgraphics.size[1]] };
        } catch (noSize) {
            out.frame = { want: [W, H], size: null };
        }        var i;
        for (i = 0; i < PROBE_SONG.length; i++) {
            out.song[PROBE_SONG[i]] = liveGet("live_set", PROBE_SONG[i]);
        }
        out.counts.tracks = liveCount("live_set", "tracks");
        out.counts.scenes = liveCount("live_set", "scenes");
        out.counts.cue_points = liveCount("live_set", "cue_points");
        out.counts.clip_slots = liveCount(TRACK, "clip_slots");
        out.counts.arrangement_clips = liveCount(TRACK, "arrangement_clips");
        out.view = String(liveGet("live_app view", "focused_document_view"));
        out.detailClip = !!liveFresh("live_set view detail_clip");
        var paths = clipPaths() || [];
        for (i = 0; i < paths.length && i < 4; i++) {
            var clip = liveFresh(paths[i]);
            var notes = notesOf(paths[i]);
            var raw = "";
            try {
                raw = clip.call("get_notes_extended", 0, 128, 0, 2048);
                raw = (typeof raw) + (raw instanceof Array ? " array" : "") + ": " + String(raw).substring(0, 90);
            } catch (error) {
                raw = "error: " + error;
            }
            out.clips.push({ path: paths[i], length: liveNumber(clip, "length"), looping: liveNumber(clip, "looping"),
                             midi: liveNumber(clip, "is_midi_clip"), notes: notes ? notes.length : null,
                             first: notes && notes.length > 0 ? notes[0] : null, raw: raw });
        }
        var devices = listDevices(TRACK, true) || [];
        for (i = 0; i < devices.length && i < 8; i++) {
            var device = liveFresh(devices[i].path);
            var names = [];
            var count = device ? children(device, "parameters", 200) : 0;
            for (var p = 0; p < count; p++) {
                var parameter = liveFresh(devices[i].path + " parameters " + p);
                if (parameter) {
                    names.push(liveText(parameter, "original_name") || liveText(parameter, "name"));
                }
            }
            var entry = { cls: devices[i].cls, parameters: names };
            if (devices[i].cls === "Drift" && device) {
                // the voice mode is a setting of the device, not one of its knobs
                entry.voiceMode = liveNumber(device, "voice_mode_index");
                entry.voiceModes = device.get("voice_mode_list");
            }
            out.devices.push(entry);
        }
        // What free play makes of the Live Set: every track with the part it
        // was taken for, and the sum of it all.
        var rows = [];
        var tracks = liveCount("live_set", "tracks") || 0;
        for (i = 0; i < tracks && i < 16; i++) {
            var row = lookAtTrack(i);
            if (row) {
                rows.push(row);
            }
        }
        out.tracks = rows;
        out.project = sumUpProject(rows);
        out.advice = nextStep(out.project, STYLES[jam.style]);
        out.jam = { on: inJam(), style: STYLES[jam.style].id, mood: jam.mood, tonic: jam.tonic };
        // What a few checks answer right now: true, false, or null for "cannot tell".
        out.checks = {};
        for (i = 0; i < PROBE_CHECKS.length; i++) {
            out.checks[PROBE_CHECKS[i]] = checkLive(PROBE_CHECKS[i]);
        }
        var text = JSON.stringify(out);
        var file = new File(folder + "smk_trainer_probe.json", "write", "TEXT");
        if (file.isopen) {
            file.eof = 0;
            for (i = 0; i < text.length; i += 1500) {
                file.writestring(text.substring(i, i + 1500));
            }
            file.close();
        }
    } catch (error) {
        post("SMK Trainer: self-check failed: " + error + "\n");
    }
}

// ----------------------------------------------------------------- lesson

function currentStep() {
    return phase === "run" ? steps[step] : null;
}

function selectLesson(item) {
    current = item;
    renew(item);
    if (item === FREE) {
        applyJam();
        jamLine = [];
        jamChord = null;
    } else {
        setKey(item.key || "C");
    }
    steps = buildSteps(item);
    step = 0;
    mistakes = 0;
    streak = 0;
    stepTimes = [];
    achieved = false;
    wrong = false;
    stepMistake = false;
    reward = null;
    confettiStart = -1000;
    // The lesson before this one may have been played in another trainer, so
    // the file is looked at; but not on every page while the player leafs
    // through them: once a second is enough.
    if (ticker && clock - mergedAt >= 12) {
        mergedAt = clock;
        mergeDisk();
    }
    phase = !lessonOpen(item) ? "locked" : (item.kind === "free" ? "run" : "intro");
    // Remember where the player is, so the next session opens on the same
    // lesson. Not during start-up: the save file has only just been read.
    // Free play is not a place on the path: it is remembered beside it.
    if (item !== FREE && progress.last !== item.id) {
        progress.last = item.id;
        if (ticker) {
            saveAt = clock + 6;    // half a second after the last page turned
        }
    }
    rememberJam();
}

// Turning a page writes nothing by itself: the place is saved once the
// player has stopped leafing, so a click never waits for the disk.
var saveAt = -1;        // tick at which the place is to be saved, -1 = nothing to save
var mergedAt = -1000;   // tick at which the save file was last looked at

function startLesson() {
    if (phase === "locked" || current.kind === "free") {
        return;
    }
    selectLesson(current);
    phase = "run";
    rememberBaseline();
    if (ticker) {
        saveAt = clock + 6;
    }
}

function moveLesson(delta) {
    var list = GROUPS[current.group].lessons;
    var index = current.index + delta;
    if (index >= 0 && index < list.length) {
        selectLesson(list[index]);
    }
}

// The first lesson of a group that is not finished yet.
function firstOpenLesson(g) {
    var list = GROUPS[g].lessons;
    for (var i = 0; i < list.length; i++) {
        if (list[i].kind !== "free" && !(progress.done[list[i].id] > 0)) {
            return list[i];
        }
    }
    return list[0];
}

function moveGroup(delta) {
    var place = current.group + delta;
    if (place >= 0 && place < GROUPS.length) {
        selectLesson(firstOpenLesson(place));
    }
}

// The lesson after this one on the path: the next of its stage, then the
// first of the next stage. null at the very end, and while the next stage is
// still shut (nextStageNeeds() tells the two apart).
function nextLesson() {
    var list = GROUPS[current.group].lessons;
    if (current.index + 1 < list.length) {
        return list[current.index + 1];
    }
    var next = current.group + 1;
    return next < GROUPS.length && groupOpen(next) ? GROUPS[next].lessons[0] : null;
}

// How many points the next stage is still waiting for; 0 if it is open or
// there is none.
function nextStageNeeds() {
    var next = current.group + 1;
    return next < GROUPS.length && !groupOpen(next) ? GROUPS[next].need - progress.points : 0;
}

// How even the steps were: 100 is a metronome. Uses the spread of the gaps
// between steps, so it does not depend on tempo or on audio latency.
function evenness() {
    if (stepTimes.length < 4) {
        return -1;
    }
    var gaps = [];
    var sum = 0;
    for (var i = 1; i < stepTimes.length; i++) {
        gaps.push(stepTimes[i] - stepTimes[i - 1]);
        sum += gaps[i - 1];
    }
    var mean = sum / gaps.length;
    if (mean <= 0) {
        return -1;
    }
    var spread = 0;
    for (var k = 0; k < gaps.length; k++) {
        spread += (gaps[k] - mean) * (gaps[k] - mean);
    }
    var deviation = Math.sqrt(spread / gaps.length);
    return Math.max(0, Math.round(100 - deviation / mean * 250));
}

function tempoPlayed() {
    if (stepTimes.length < 4 || !current.rhythm) {
        return -1;
    }
    var mean = (stepTimes[stepTimes.length - 1] - stepTimes[0]) / (stepTimes.length - 1);
    return Math.round(60000 / (mean * current.rhythm));
}

function finishLesson() {
    phase = "done";
    confettiStart = clock;
    var base = current.pts || Math.max(50, steps.length * 10);
    var lines = ["УРОК: " + base];
    var total = base;
    if (mistakes === 0) {
        var clean = Math.round(base / 2);
        total += clean;
        lines.push("БЕЗ ОШИБОК: +" + clean);
    }
    var even = current.rhythm ? evenness() : -1;
    if (even >= 85) {
        var steady = Math.round(base * 0.3);
        total += steady;
        lines.push("РОВНО " + even + "%: +" + steady);
    }
    var before = progress.points;
    var openBefore = [];
    for (var g = 0; g < GROUPS.length; g++) {
        openBefore.push(groupOpen(g));
    }
    var best = progress.done[current.id] || 0;
    if (total > best) {
        progress.done[current.id] = total;
    }
    // A training lesson pays a little every time, so repeating is never for nothing.
    if (current.gen && best > 0) {
        progress.reps[current.id] = (progress.reps[current.id] || 0) + 1;
        lines.push("ПОВТОР " + progress.reps[current.id] + ": +" + REPEAT_PAY);
    }
    saveProgress();
    var opened = [];
    var following = GROUPS[current.group].lessons[current.index + 1];
    if (best === 0 && following && !GROUPS[current.group].shelf) {
        opened.push("УРОК " + following.title);
    }
    for (g = 0; g < GROUPS.length; g++) {
        if (!openBefore[g] && groupOpen(g)) {
            opened.push("СТУПЕНЬ " + GROUPS[g].title);
        }
    }
    reward = { total: total, gain: progress.points - before, lines: lines, opened: opened, best: best };
    if (reward.gain > 0) {
        cheer(reward.gain);
    }
}

// 1 = the step is done, 0 = on the way, -1 = a wrong key is down.
function matchStep(s) {
    var i;
    if (s.any) {
        return 1;
    }
    if (s.click || s.live || s.manual) {
        return 0;
    }
    if (s.drums) {
        for (i = 0; i < held.length; i++) {
            if (s.drums.indexOf(held[i]) < 0) {
                return -1;
            }
        }
        return held.length === s.drums.length ? 1 : 0;
    }
    if (s.hold) {
        var count = s.hold.length;
        for (i = 0; i < held.length; i++) {
            if (s.hold.indexOf(held[i] % 12) < 0 && s.pcs.indexOf(held[i] % 12) < 0) {
                return -1;
            }
        }
        if (held.length <= count) {
            return 0;
        }
        // The held part is the lowest keys (or the highest, when the moving
        // voice is the bass); the rest is the moving voice.
        var holdKeys = s.under ? held.slice(held.length - count) : held.slice(0, count);
        var moveKeys = s.under ? held.slice(0, held.length - count) : held.slice(count);
        var holdPcs = unique(holdKeys.map(function (p) { return p % 12; }));
        var movePcs = unique(moveKeys.map(function (p) { return p % 12; }));
        return sameSet(holdPcs, s.hold) && sameSet(movePcs, s.pcs) ? 1 : 0;
    }
    var pcs = unique(held.map(function (p) { return p % 12; }));
    for (i = 0; i < pcs.length; i++) {
        if (s.pcs.indexOf(pcs[i]) < 0) {
            return -1;
        }
    }
    if (pcs.length !== s.pcs.length) {
        return 0;
    }
    if (s.bass >= 0 && held[0] % 12 !== s.bass) {
        return 0;
    }
    if (s.minKeys && held.length < s.minKeys) {
        return 0;
    }
    return 1;
}

function stepDone() {
    achieved = true;
    stepTimes.push(nowMs());
    if (!stepMistake) {
        streak++;
    }
    // a finished step cheers the stage up, but never into the top mood
    vibe = Math.max(vibe, Math.min(TRIP_AT - 0.01, vibe + 0.04));
    celebrate();
}

function advance() {
    achieved = false;
    wrong = false;
    stepMistake = false;
    step++;
    if (step >= steps.length) {
        finishLesson();
    } else {
        rememberBaseline();
        if (ticker) {
            saveAt = clock + 6;
        }
    }
}

// Steps that are not played on the keys: a click, an Ableton state, a
// confirmation. They are finished at once, there is nothing to release.
function completeStep() {
    if (phase !== "run" || !currentStep()) {
        return;
    }
    stepDone();
    advance();
}

function evaluate() {
    var s = currentStep();
    if (!s || current.kind === "free") {
        return;
    }
    if (achieved) {
        var stays = s.hold ? s.hold.length : 0;
        if (held.length === 0 || (stays > 0 && held.length <= stays)) {
            advance();
        }
        return;
    }
    if (held.length === 0) {
        wrong = false;
        return;
    }
    var result = matchStep(s);
    if (result < 0) {
        if (!wrong) {
            mistakes++;
            streak = 0;
            stepMistake = true;
            vibe = Math.max(-1, vibe - 0.08);
        }
        wrong = true;
        return;
    }
    wrong = false;
    if (result === 1) {
        stepDone();
    }
}

// Both critters start their jump on the next frames, and the sparkle plays.
function celebrate() {
    burstStart = clock;
    slimeShift = (9 - clock % SPRITES.slime.runs.length + SPRITES.slime.runs.length) % SPRITES.slime.runs.length;
    frogShift = (15 - clock % SPRITES.frog.runs.length + SPRITES.frog.runs.length) % SPRITES.frog.runs.length;
}

// ------------------------------------------------------------------- vibe

function rand() {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
}

function nowMs() {
    return new Date().getTime();
}

// Gaps between onsets that count as "in time", as multiples of the pulse:
// the beat itself, its halves and quarters, dotted and doubled values.
var GRID = [0.25, 0.5, 1, 1.5, 2, 3, 4];

// Compares the gap since the previous onset with the pulse the player has
// been keeping. Returns 1 when the onset lands on the grid, -1 when it does
// not, 0 when there is no pulse to compare with yet.
function feelRhythm(now) {
    var gap = now - onsetMs;
    onsetMs = now;
    beats++;
    if (gap > 2500) {
        pulse = 0;
        groove = 0;
        misses = 0;
        return 0;
    }
    if (pulse === 0) {
        pulse = gap;
        return 0;
    }
    var best = 1;
    var error = 9;
    for (var i = 0; i < GRID.length; i++) {
        var off = Math.abs(gap / pulse - GRID[i]) / GRID[i];
        if (off < error) {
            error = off;
            best = GRID[i];
        }
    }
    if (error <= 0.12) {
        groove++;
        misses = 0;
        pulse = pulse * 0.7 + gap / best * 0.3;
        return 1;
    }
    // One stumble costs some groove; two in a row mean a new tempo.
    groove = Math.max(0, groove - 2);
    misses++;
    if (misses >= 2) {
        pulse = gap;
        misses = 0;
    }
    return -1;
}

// Scores one key press. Music is harmony times variety times rhythm:
//   harmony  in-key notes, sweet intervals, melodic steps and real chords
//            add; out-of-key notes, semitone and tritone clashes and a
//            fistful of keys take away
//   variety  one note hammered over and over adds nothing, and one chord
//            repeated too long adds little
//   rhythm   what is played in steady time counts in full, what is played
//            at random moments counts for a third
// Drum pads have no harmony: there only the rhythm is judged.
// What free play listens to besides: the last eight strokes that could be
// compared with the pulse (1 = in time), how many in a row fell out of it,
// and how wild the playing is: leaps here and there in no rhythm at all.
var rhythmLog = [];
var chaos = 0;
var wild = 0;

// Is there too little rhythm in the last strokes to call it playing in time?
function unsteady() {
    return rhythmLog.length < 4 || tally(rhythmLog) < rhythmLog.length * 0.7;
}

// "pads": the stroke is a pad of a drum track in free play, judged for its
// rhythm alone.
function judge(pitch, pads) {
    lastOn = clock;
    // a note handed over by another copy is judged by the moment it was played
    var now = heardAt || nowMs();
    var fresh = now - onsetMs >= 70; // a new onset, not one more note of the same chord
    if (fresh) {
        if (now - onsetMs > 2500) {
            chaos = 0;                      // a pause: the count starts anew
            wild = Math.floor(wild / 2);
        }
        rhythm = feelRhythm(now);
        if (rhythm !== 0) {
            keepLast(rhythmLog, rhythm === 1 ? 1 : 0, 8);
        }
        chaos = rhythm === -1 ? chaos + 1 : rhythm === 1 ? 0 : chaos;
        danceOnset();
    }
    var gain = 0;
    var loss = 0;
    var drumming = !!pads || current.kind === "drums" || !!(currentStep() && currentStep().drums);
    if (drumming) {
        if (fresh && rhythm === 1 && groove >= 3) {
            gain = 0.05;
        } else if (fresh && rhythm === -1) {
            loss = -0.08;
        }
    } else {
        var pc = pitch % 12;
        recentPcs.push(pc);
        if (recentPcs.length > 6) {
            recentPcs.shift();
        }
        var different = unique(recentPcs).length;
        var variety = different <= 1 ? 0 : different === 2 ? 0.15 : different === 3 ? 0.4 : 1;
        if (scalePcs.indexOf(pc) >= 0) {
            gain += 0.04;
        } else {
            loss -= 0.15;
        }
        var chord = detectChord(unique(held.map(function (p) { return p % 12; })), held[0] % 12);
        // In free play a chord counts only if it is voiced like one. Keys
        // pressed side by side in a bunch are a cluster, whatever chord their
        // names add up to.
        var clean = chord;
        if (chord && inJam()) {
            var seconds = 0;
            for (var n = 1; n < held.length; n++) {
                if (held[n] - held[n - 1] <= 2) {
                    seconds++;
                }
            }
            if (seconds > (held.length >= 5 ? 2 : 1)) {
                clean = null;
            }
        }
        for (var i = 0; i < held.length; i++) {
            if (held[i] === pitch) {
                continue;
            }
            var distance = Math.abs(pitch - held[i]);
            var interval = distance % 12;
            if (interval === 0 || interval === 3 || interval === 4 || interval === 5
                    || interval === 7 || interval === 8 || interval === 9) {
                gain += 0.03;
            } else if (!clean) {
                // Clashes count only outside a real chord: the seventh of
                // Cmaj7 and the tritone inside G7 belong there.
                if (distance === 1) {
                    loss -= 0.25;
                } else if (distance === 2) {
                    loss -= inJam() ? 0.1 : 0.06;
                } else if (interval === 1 || interval === 6 || interval === 11) {
                    loss -= 0.08;
                }
            }
        }
        while (recentOns.length > 0 && clock - recentOns[0] > 3) {
            recentOns.shift();
        }
        recentOns.push(clock);
        if (recentOns.length >= 5) {
            // Five keys almost at once are a fist only if they are packed side
            // by side; a wide chord played with two hands is not.
            var packed = 0;
            for (var k = 1; k < held.length; k++) {
                if (held[k] - held[k - 1] <= 2) {
                    packed++;
                }
            }
            if (packed >= 3) {
                loss -= 0.4;
            }
        }
        if (fresh) {
            // A new onset moves the melody; if more notes join it within a
            // moment it was a chord after all, and this is undone below.
            onsetNotes = 1;
            onsetCounted = false;
            melodyBefore = lastMelody;
            if (inJam()) {
                jamNote(pitch);
            }
            if (lastPitch >= 0) {
                var leap = Math.abs(pitch - lastPitch);
                if (leap > 0 && leap <= 4) {
                    gain += 0.03;
                }
                if (leap > 0) {
                    lastMelody = clock;
                }
                // Free play: a leap of more than a fifth with no rhythm under
                // it is not a melody but a key hit at random; steps in time
                // make up for it.
                // Two hands in two registers leap all the time and are music
                // all the same: what tells them from noise is the rhythm. So a
                // leap counts against the player only once the strokes are
                // known to be out of time, and every stroke in time takes one
                // such leap back.
                if (inJam()) {
                    var astray = rhythmLog.length >= 4 && unsteady();
                    if (leap > 7 && astray) {
                        wild++;
                    } else if (rhythm === 1) {
                        wild = Math.max(0, wild - (astray ? 1 : 2));
                    }
                    if (wild >= 2 && astray) {
                        loss -= Math.min(0.2, 0.05 * wild);
                    }
                }
            }
            lastPitch = pitch;
        } else {
            onsetNotes++;
            lastMelody = melodyBefore;
            if (inJam() && onsetNotes === 3) {
                forgetJamNote();    // it was the first note of a chord, not of the melody
            }
        }
        if (clean && inJam()) {
            jamChord = chord;
            jamChordAt = clock;
        }
        if (clean) {
            gain += isDiatonic(sectorIndex(chord.root, chord.minor)) ? 0.1 : 0.03;
            if (onsetNotes >= 3 && !onsetCounted) {
                // a chord struck as a chord, not a melody note landing on one
                onsetCounted = true;
                if (chord.name === lastChord) {
                    sameChord++;
                } else {
                    sameChord = 0;
                    chordChange = clock;
                }
                lastChord = chord.name;
                lastChordPcs = chord.pcs;
                chordAt = clock;
                recentChords.push([chord.name, clock, chord.pcs.length]);
                if (recentChords.length > 8) {
                    recentChords.shift();
                }
            }
        } else if (lastChordPcs.indexOf(pc) < 0) {
            sameChord = 0; // a note from outside the chord: something new is going on
        }
        if (fresh && rhythm === 1 && groove >= 3) {
            gain += 0.02;
        } else if (fresh && rhythm === -1) {
            loss -= 0.02;
        }
        var steady = groove >= 3 ? 1 : groove >= 1 ? 0.6 : 0.3;
        if (inJam()) {
            // Free play weighs the last eight strokes: a lucky hit or two is
            // not yet a rhythm, and one stumble does not end a good one.
            var share = rhythmLog.length < 4 ? -1 : tally(rhythmLog) / rhythmLog.length;
            steady = share < 0 ? 0.3 : share >= 0.85 ? 1 : share >= 0.7 ? 0.6 : share >= 0.55 ? 0.3 : 0.12;
            // strokes that keep falling out of time pull the mood down a
            // little, but never into trouble: that takes noise, not a hand
            // that is still learning to keep time
            if (fresh && chaos >= 4 && vibe > -0.2) {
                loss -= Math.min(0.08, 0.02 * (chaos - 3));
            }
        }
        gain *= variety * steady * (sameChord >= 4 ? 0.15 : 1);
        // and without a rhythm the stage does not start to dance at all
        if (inJam() && unsteady() && vibe + gain > DANCE_AT - 0.02) {
            gain = Math.max(0, DANCE_AT - 0.02 - vibe);
        }
    }
    // The higher the vibe already is, the less a single good note adds, so
    // the top moods need rich playing kept up for a while, not three chords.
    if (vibe > 0) {
        gain *= 1 - vibe;
    }
    vibe = Math.max(-1, Math.min(1, vibe + gain + loss));
    // The top mood is for the real thing only: a melody over changing chords,
    // or on the pads a long unbroken groove.
    // A pad struck under a melody over changing chords takes nothing away.
    var melodic = clock - lastMelody < 36 && clock - chordChange < 120;
    var rich = drumming ? groove >= 16 || (!!pads && melodic) : melodic;
    if (!rich) {
        vibe = Math.min(vibe, TRIP_AT - 0.01);
    }
    updateMood();
    if (fresh && !drumming) {
        scorePlay(pitch, loss < 0, now);
    }
}

var DANCE_AT = 0.34;
var FIRE_AT = 0.62;
var TRIP_AT = 0.86;

var BANNERS = { "-2": "КАКОФОНИЯ!", "-1": "ОЙ...", "1": "КРУТО!", "2": "ОГОНЬ!", "3": "КОСМОС!", "4": "ВИРТУОЗ!", "5": "ЛЕГЕНДА!" };

// ---- mastery, combo and the points of free play

// Above the top mood there are two ranks for those who can really play.
// Mastery grows only at the top mood and only from playing that is steady,
// varied, wide, rich in chords, two-handed, fast and clean all at once: four
// of these seven are needed for it to grow at all, six for the last rank.
var mastery = 0;
var rank = 0;               // 0, 1 = virtuoso, 2 = legend
var VIRTUOSO_AT = 0.5;
var LEGEND_AT = 1;
var combo = 0;              // good strokes in a row in free play
var recentPitches = [];     // the latest melody notes, for their range
var recentChords = [];      // [name, tick, keys] of the latest chords
var onsetTimes = [];        // when the latest strokes came, for the speed
var handsAt = -1000;        // tick of the latest melody note over a held chord
var sourAt = -1000;         // tick of the latest sour stroke
var gaugePeak = 0;          // the best the gauge has shown lately
var pointsFlash = { until: -1, colour: 0, shake: false };

var SKILL_NAMES = ["ровного ритма", "разных нот", "широты", "смены аккордов", "второй руки", "скорости", "чистоты"];

// Steady, varied, wide, rich in chords, two-handed, fast, clean: which of
// the seven signs the playing shows right now.
function skillFlags(now) {
    var i;
    var low = 999;
    var high = 0;
    for (i = 0; i < recentPitches.length; i++) {
        low = Math.min(low, recentPitches[i]);
        high = Math.max(high, recentPitches[i]);
    }
    var names = [];
    for (i = 0; i < recentChords.length; i++) {
        if (clock - recentChords[i][1] <= 240 && names.indexOf(recentChords[i][0]) < 0) {
            names.push(recentChords[i][0]);
        }
    }
    return [groove >= 8, unique(recentPcs).length >= 5, high - low >= 12, names.length >= 3, clock - handsAt < 48,
            onsetTimes.length >= 16 && now - onsetTimes[0] <= 4000, clock - sourAt > 96];
}

function playSkill(now) {
    var flags = skillFlags(now);
    var count = 0;
    for (var i = 0; i < flags.length; i++) {
        count += flags[i] ? 1 : 0;
    }
    return count;
}

function skillsMissing(now) {
    var flags = skillFlags(now);
    var out = [];
    for (var i = 0; i < flags.length; i++) {
        if (!flags[i]) {
            out.push(SKILL_NAMES[i]);
        }
    }
    return out;
}
function updateRank() {
    var next = mood < 3 ? 0 : mastery >= (rank >= 2 ? 0.9 : LEGEND_AT) ? 2 : mastery >= (rank >= 1 ? 0.42 : VIRTUOSO_AT) ? 1 : 0;
    if (next > rank) {
        banner = BANNERS[String(3 + next)];
        bannerUntil = clock + 24;
        for (var i = 0; i < 2 + next; i++) {
            explode(SX + 24 + rand() * (SW - 48), SY + 26 + rand() * 40);
        }
    }
    rank = next;
}

function comboMult() {
    return 1 + Math.min(4, Math.floor(combo / 16));
}

// Points earned by playing: a pop on the stage, coins that fly to the counter.
function earn(amount) {
    progress.jamPts = (progress.jamPts || 0) + amount;
    recount();
    cheer(amount);
    if (ticker && saveAt < 0) {
        saveAt = clock + 36;
    }
}

function cheer(amount) {
    popups.push({ text: "+" + amount, age: 0, colour: LIME });
    pointsFlash = { until: clock + 6, colour: LIME, shake: false };
    for (var i = 0; i < 6; i++) {
        spawn(DOT, SX + 62 + i * 4, SY + 96, -5.6 + i * 0.25, -8.6 + (i % 3) * 0.5, 0, 10, YELLOW, null);
    }
}

// Called on every new stroke, after it has been judged.
function scorePlay(pitch, sour, now) {
    onsetTimes.push(now);
    if (onsetTimes.length > 16) {
        onsetTimes.shift();
    }
    recentPitches.push(pitch);
    if (recentPitches.length > 12) {
        recentPitches.shift();
    }
    if (sour) {
        sourAt = clock;
    }
    keepLast(recentSour, scalePcs.indexOf(pitch % 12) < 0 ? 1 : 0, 8);
    keepLast(recentTrips, rhythm === -1 ? 1 : 0, 8);
    keepLast(recentForce, lastVelocity, 8);
    if (held.length >= 4 && pitch === held[held.length - 1]) {
        handsAt = clock;        // a note on top of three keys held under it
    }
    if (mood === 3) {
        var skill = playSkill(now);
        mastery += skill >= 4 ? 0.012 * (skill - 3) : -0.02;
        mastery = Math.max(0, Math.min(skill >= 6 ? 1.2 : 0.8, mastery));
    }
    updateRank();
    if (!inJam()) {
        return;
    }
    coachOnset(pitch, sour, now);
    // The combo of free play: every stroke in the scale and in time adds to
    // it, a note outside the scale ends it, a stumble halves it. Every
    // sixteenth stroke pays, and every sixteen raise the multiplier.
    if (sour) {
        combo = noteTier(pitch % 12, jamHarmony()) === 0 ? 0 : Math.floor(combo / 2);
        return;
    }
    combo++;
    if (combo % 16 === 0) {
        if (combo <= 64) {
            banner = "X" + comboMult() + "!";
            bannerUntil = clock + 14;
        }
        if (mood >= 1) {
            earn(Math.ceil((mood + rank) * comboMult() / 2));
        }
    }
}

// The gauge as one number: the vibe up to the top mood, then the mastery.
var VIRTUOSO_MARK = 1.1;
var LEGEND_MARK = 1.35;
var GAUGE_END = 1.5;

function gaugeValue() {
    if (vibe < 0 || mood < 3 || mastery <= 0) {
        return Math.min(vibe, VIRTUOSO_MARK - 0.02);
    }
    var up = mastery < VIRTUOSO_AT ? TRIP_AT + (VIRTUOSO_MARK - TRIP_AT) * mastery / VIRTUOSO_AT
           : mastery < LEGEND_AT ? VIRTUOSO_MARK + (LEGEND_MARK - VIRTUOSO_MARK) * (mastery - VIRTUOSO_AT) / (LEGEND_AT - VIRTUOSO_AT)
           : LEGEND_MARK + (GAUGE_END - LEGEND_MARK) * Math.min(1, (mastery - LEGEND_AT) / 0.2);
    return Math.max(Math.min(vibe, VIRTUOSO_MARK - 0.02), up);
}

// The gauge along the bottom of the stage: a red stretch for noise on the
// left, then six stretches, one for every mood and rank, that light up as the
// playing climbs. A white cursor shows where it is now and swells on every
// stroke; a thin mark stays at the best of the last seconds.
function drawGauge() {
    var left = SX + 4;
    var red = 20;
    var zero = left + red;
    var top = SY + SH - 8;
    var span = (SW - 8 - red) / GAUGE_END;
    var marks = [0, DANCE_AT, FIRE_AT, TRIP_AT, VIRTUOSO_MARK, LEGEND_MARK, GAUGE_END];
    var dim = [STEEL, GREEN_DIM, ORANGE_DIM, TEAL, PLUM, ORANGE_DIM];
    var lit = [SLATE, LIME, ORANGE, CYAN, RAINBOW[10], YELLOW];
    var value = gaugeValue();
    var i, from, to;
    px(SX, top - 2, SW, 10, INK);
    flush();
    px(left, top, red - 1, 5, DEEP[0]);
    for (i = 0; i < 6; i++) {
        from = zero + Math.round(marks[i] * span);
        px(from, top, zero + Math.round(marks[i + 1] * span) - from - 1, 5, dim[i]);
    }
    flush();
    var noise = Math.round(-value * red);
    if (noise > 1) {
        px(zero - noise, top, noise - 1, 5, RED);
    }
    for (i = 0; i < 6 && value > marks[i]; i++) {
        from = zero + Math.round(marks[i] * span);
        to = zero + Math.round(Math.min(value, marks[i + 1]) * span) - (value >= marks[i + 1] ? 1 : 0);
        if (to > from) {
            px(from, top, to - from, 5, i === 5 ? RAINBOW[clock % RAINBOW.length] : lit[i]);
        }
    }
    flush();
    var head = zero + Math.round(value < 0 ? value * red : value * span);
    var swell = clock - lastOn < 2 ? 1 : 0;
    if (gaugePeak > value + 0.03) {
        px(zero + Math.round(gaugePeak * span), top - 1, 1, 7, YELLOW);
    }
    px(head - 1, top - 1 - swell, 2, 7 + swell * 2, WHITE);
    if (rank >= 1) {
        px(head - 4 + hash(clock) % 8, top - 3 + hash(clock * 3) % 10, 1, 1, rank === 2 ? YELLOW : WHITE);
        px(head - 4 + hash(clock + 5) % 8, top - 3 + hash(clock * 7) % 10, 1, 1, WHITE);
    }
    if (inJam() && combo >= 16) {
        label("X" + comboMult(), Math.max(SX + 10, Math.min(SX + SW - 10, head)), top - 10, 1, YELLOW, CENTER);
    }
}

// Moods switch with a little hysteresis so the stage does not flicker
// between two states at a threshold.
function updateMood() {
    var dance = DANCE_AT - (mood >= 1 ? 0.08 : 0);
    var fire = FIRE_AT - (mood >= 2 ? 0.08 : 0);
    var trip = TRIP_AT - (mood >= 3 ? 0.08 : 0);
    var trouble = mood <= -1 ? -0.22 : -0.3;
    var storm = mood <= -2 ? -0.55 : -0.65;
    var next = vibe >= trip ? 3 : vibe >= fire ? 2 : vibe >= dance ? 1
             : vibe <= storm ? -2 : vibe <= trouble ? -1 : 0;
    if (next === mood) {
        return;
    }
    // A banner only when things get more extreme, not on the way back to calm.
    banner = Math.abs(next) > Math.abs(mood) || next * mood < 0 ? (BANNERS[String(next)] || "") : "";
    bannerUntil = clock + 20;
    mood = next;
    moodClock = clock;
    moodMs = nowMs();
}

// ---------------------------------------------------------------- particles

var DOT = 0;
var NOTE = 1;
var ROCKET = 2;
var FIREWORKS = [
    [WHITE, YELLOW, ORANGE, RED],
    [WHITE, CYAN, SKY, BLUE],
    [WHITE, LIME, GREEN, TEAL],
    [WHITE, YELLOW, LIME, GREEN],
    [WHITE, CYAN, PLUM, PLUM]
];

function spawn(kind, x, y, vx, vy, gravity, life, colour, ramp) {
    if (particles.length < 140) {
        particles.push({ kind: kind, x: x, y: y, vx: vx, vy: vy, g: gravity, life: life, age: 0, colour: colour, ramp: ramp });
    }
}

function explode(x, y) {
    var ramp = FIREWORKS[Math.floor(rand() * FIREWORKS.length)];
    for (var i = 0; i < 22; i++) {
        var angle = (i + rand()) * Math.PI * 2 / 22;
        var speed = 1.2 + rand() * 1.6;
        spawn(DOT, x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, 0.07, 11 + Math.floor(rand() * 7), WHITE, ramp);
    }
}

// ------------------------------------------------------------- geometry

var CX = 86;
var CY = 85;
var R_OUT = 80;
var R_MID = 53;
var R_IN = 27;
var CELL = 2;        // the wheel is drawn in 2x2 pixel blocks

var KX = 180;        // keyboard left edge
var KY = 48;
var KEY_W = 22;
var KEY_H = 58;
var BLACK_W = 14;
var BLACK_H = 35;
var LOW_NOTE = 48;   // C3
var OCTAVES = 3;
var TEXT_RIGHT = KX + OCTAVES * 7 * KEY_W;
var PAD_W = Math.floor(OCTAVES * 7 * KEY_W / 8);     // eight pads take the place of the keys

var PX = TEXT_RIGHT + 12;    // right panel
var PW = 172;
var BUTTONS = {
    groupPrev: [PX, 4, 18, 14],
    groupNext: [PX + PW - 18, 4, 18, 14],
    prev: [PX, 32, 18, 14],
    next: [PX + PW - 18, 32, 18, 14],
    main: [PX, 74, 64, 17],
    restart: [PX + 68, 74, 44, 17],
    free: [PX + 116, 74, 56, 17]
};

var SX = PX + PW + 8;    // stage with the critters
var SY = 5;
var SW = 146;
var SH = 159;
var GROUND = SY + SH - 18;

var WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
var WHITE_INDEX = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; // for black keys: the white key on the left

function foldIntoRange(pitch) {
    var top = LOW_NOTE + OCTAVES * 12 - 1;
    while (pitch < LOW_NOTE) {
        pitch += 12;
    }
    while (pitch > top) {
        pitch -= 12;
    }
    return pitch;
}

function keyCentre(pitch) {
    var octave = Math.floor((pitch - LOW_NOTE) / 12);
    var pc = pitch % 12;
    var white = octave * 7 + WHITE_INDEX[pc];
    return WHITE_PCS.indexOf(pc) >= 0 ? KX + white * KEY_W + KEY_W / 2 - 1 : KX + (white + 1) * KEY_W;
}

function showsPads() {
    var s = currentStep();
    return current.kind === "drums" || !!(s && s.drums);
}

// Pads are drawn as on the keyboard: two rows of eight, the low notes below.
function padRect(pitch) {
    var index = pitch - 36;
    if (index < 0 || index > 15) {
        return null;
    }
    return [KX + (index % 8) * PAD_W, KY + (index < 8 ? 30 : 0), PAD_W - 2, 28];
}

function strike() {
    flash = 3;
    bolt = [];
    var x = SX + 30 + Math.floor(rand() * (SW - 60));
    var y = SY + 50;
    while (y < GROUND) {
        var h = Math.min(GROUND - y, 6 + Math.floor(rand() * 8));
        bolt.push(x, y, 2, h);
        var dx = Math.floor(rand() * 13) - 6;
        if (dx !== 0 && y + h < GROUND) {
            bolt.push(Math.min(x, x + dx), y + h - 2, Math.abs(dx) + 2, 2);
        }
        x = Math.max(SX + 4, Math.min(SX + SW - 6, x + dx));
        y += h;
    }
}

// What the current mood adds to the stage on this tick. The better it
// sounds, the more often notes fly and rockets go up.
function moodEffects() {
    var slimeX = SX + 42;
    var frogX = SX + 108;
    if (mood >= 1 && clock % (8 - mood * 2) === 0) {
        spawn(NOTE, (rand() < 0.5 ? slimeX : frogX) - 8 + rand() * 14, GROUND - 30,
              rand() * 0.8 - 0.4, -1.4, 0, 14, [CYAN, YELLOW, LIME][Math.floor(rand() * 3)], null);
    }
    if (mood >= 2 && clock % (mood === 3 ? 5 : 10) === 0) {
        spawn(ROCKET, SX + 18 + rand() * (SW - 36), GROUND - 4, 0, -(7 + rand() * 2), 0.3, 10 + Math.floor(rand() * 3), YELLOW, null);
    }
    if (mood <= -1 && clock % 4 === 0) {
        var from = rand() < 0.5 ? slimeX : frogX;
        spawn(DOT, from + (rand() < 0.5 ? -9 : 9), GROUND - 20, rand() * 2 - 1, -1.6, 0.35, 8, SKY, null);
    }
    if (mood === -2 && clock % 13 === 5) {
        strike();
    }
    if (flash > 0) {
        flash--;
    }
}

function updateParticles() {
    for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.age++;
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        if (p.age >= p.life) {
            particles.splice(i, 1);
            if (p.kind === ROCKET) {
                explode(p.x, p.y);
            }
        }
    }
}

// ------------------------------------------------------------------ input

// ---- the copies hear as one
//
// A trainer hears only the notes of its own track, and Ableton shows the
// devices of one track at a time. A copy on every track keeps the trainer in
// sight, but the copy on the screen would stay deaf while the keys play into
// another track. So the copies pass the notes on: what a hidden copy hears is
// handed to the one on the screen, which shows and judges it.
//
// They meet in a Global of Max, which all devices of a Live Set share. Only
// numbers and strings are kept there: nothing in it belongs to one copy, so
// nothing is left hanging when a copy is deleted.
var band = null;            // the Global; false where Max gives none
var bandSeq = 0;            // the last note of the others that was looked at
var heardAt = 0;            // when the note in hand was really played, if another copy heard it
var myDrums = false;        // this copy stands on a track of drums
var drumsAskedAt = -100000;

function theBand() {
    if (band === null) {
        try {
            band = new Global("smk_trainer_band");
        } catch (error) {
            band = false;
        }
    }
    return band || null;
}

function standsOnDrums() {
    var devices = listDevices(TRACK, false) || [];
    for (var i = 0; i < devices.length; i++) {
        if (DRUM_BOXES.indexOf(devices[i].cls) >= 0) {
            return true;
        }
    }
    return false;
}

// The mood of the stage and the rhythm the player keeps, as one line of
// numbers: the copy that comes into sight next goes on from here.
function playState() {
    return [vibe, mastery, combo, groove, pulse, onsetMs, chaos, wild, rhythmLog.join("")].join(",");
}

function takePlayState(text) {
    var parts = String(text).split(",");
    if (parts.length < 9) {
        return;
    }
    vibe = Number(parts[0]) || 0;
    mastery = Number(parts[1]) || 0;
    combo = Number(parts[2]) || 0;
    groove = Number(parts[3]) || 0;
    pulse = Number(parts[4]) || 0;
    onsetMs = Number(parts[5]) || 0;
    chaos = Number(parts[6]) || 0;
    wild = Number(parts[7]) || 0;
    rhythmLog = [];
    for (var i = 0; i < parts[8].length; i++) {
        rhythmLog.push(parts[8].charAt(i) === "1" ? 1 : 0);
    }
    if (vibe !== 0) {
        lastOn = clock;
    }
    updateMood();
    updateRank();
    bannerUntil = 0;        // the mood was reached on another track: no banner for it here
}

// Every paint says: this copy is the one on the screen. The first paint after
// another copy takes over where that one left off.
function claimStage() {
    var b = theBand();
    if (!b) {
        return;
    }
    var now = nowMs();
    if (b.shownWho && b.shownWho !== me) {
        b.many = 1;
        if (b.play && now - b.playAt < 3000) {
            takePlayState(b.play);
        }
    }
    b.shownWho = me;
    b.shownAt = now;
}

function passOn(b, pitch, velocity, now) {
    var text = String(b.notes || "");
    if (text.length > 2200) {
        text = text.substring(text.indexOf(";", text.length - 1500) + 1);
    }
    b.seq = (Number(b.seq) || 0) + 1;
    b.notes = (text === "" ? "" : text + ";") + [b.seq, me, pitch, velocity, now, myDrums ? 1 : 0].join(",");
}

// On every tick: what the other copies have heard since the last look. A key
// let go is taken by every copy that holds it; a key pressed only by the copy
// on the screen.
function hearOthers() {
    var b = theBand();
    if (!b) {
        return;
    }
    var mine = b.shownWho === me;
    if (mine && b.many && clock % 2 === 0) {
        b.play = playState();
        b.playAt = nowMs();
    }
    var seq = Number(b.seq) || 0;
    if (seq === bandSeq) {
        return;
    }
    if (seq < bandSeq) {
        bandSeq = seq;      // the count has started anew
        return;
    }
    var rows = String(b.notes || "").split(";");
    var now = nowMs();
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i].split(",");
        if (!(Number(row[0]) > bandSeq) || Number(row[1]) === me) {
            continue;
        }
        var pitch = Number(row[2]);
        var velocity = Number(row[3]);
        var known = held.indexOf(pitch) >= 0;
        if (velocity === 0) {
            if (known) {
                hear(pitch, 0, false, true);
            }
        } else if (mine && !known && now - Number(row[4]) < 1000) {
            heardAt = Number(row[4]);
            try {
                hear(pitch, velocity, row[5] === "1", true);
            } finally {
                heardAt = 0;
            }
        }
    }
    bandSeq = seq;
}

// What the self-check says about the copies.
function bandReport() {
    var b = theBand();
    if (!b) {
        return { there: false };
    }
    return { there: true, me: me, shown: b.shownWho === me, many: !!b.many, drums: standsOnDrums(), seq: Number(b.seq) || 0 };
}

// A key or a pad played into the track of this copy.
function note(pitch, velocity) {
    var now = nowMs();
    if (velocity > 0 && now - drumsAskedAt > 15000) {
        drumsAskedAt = now;
        myDrums = standsOnDrums();
    }
    var b = theBand();
    // another copy is on the screen: it has painted a moment ago
    if (velocity > 0 && b && b.shownWho && b.shownWho !== me && now - b.shownAt < 700) {
        b.many = 1;
        passOn(b, pitch, velocity, now);
        return;
    }
    hear(pitch, velocity, myDrums, false);
    // A key let go is told to the others as well: one of them may have been
    // handed its press while it was on the screen.
    if (velocity === 0 && b && b.many) {
        passOn(b, pitch, 0, now);
    }
}

// One key or pad. "pads": it was played into a track of drums. "foreign":
// another copy of the trainer heard it and handed it over.
function hear(pitch, velocity, pads, foreign) {
    var index = held.indexOf(pitch);
    if (pads && !showsPads() && (foreign || inJam()) && index < 0) {
        // A pad of a drum track is not a key of the piano. Free play counts
        // its rhythm; a lesson for the keys does not hear it at all.
        if (velocity > 0 && inJam()) {
            lastVelocity = velocity;
            judge(pitch, true);
            cacophony(true);
            mgraphics.redraw();
        }
        return;
    }
    if (velocity > 0) {
        if (index < 0) {
            held.push(pitch);
        }
    } else if (index >= 0) {
        held.splice(index, 1);
    }
    held.sort(function (a, b) { return a - b; });
    if (velocity > 0) {
        lastVelocity = velocity;
        judge(pitch, false);
        // On a lesson's title card the first key press starts the lesson and
        // is not judged as an answer.
        if (phase === "intro") {
            startLesson();
            mgraphics.redraw();
            return;
        }
        if (notes.length < 24 && !showsPads()) {
            var s = currentStep();
            var good = !s || current.kind === "free" || matchStep(s) >= 0;
            var tint = good ? LIME : RED;
            if (inJam()) {
                var tier = noteTier(pitch % 12, jamHarmony());
                tint = tier === 0 ? RED : TIER_COLOURS[tier];
            }
            notes.push({ x: keyCentre(foldIntoRange(pitch)) - 2, y: KY - 9, colour: tint, age: 0 });
        }
    }
    evaluate();
    if (velocity > 0) {
        cacophony(false);
    }
    mgraphics.redraw();
}

function bang() {
    mgraphics.redraw();
}

function stopPreview() {
    for (var i = 0; i < previewNotes.length; i++) {
        outlet(0, previewNotes[i], 0);
    }
    previewNotes = [];
    preview = null;
    runNotes = [];
    if (runTask) {
        runTask.cancel();
        runTask = null;
    }
    if (previewTask) {
        previewTask.cancel();
        previewTask = null;
    }
    mgraphics.redraw();
}

var runNotes = [];      // notes of a run still to be played
var runTask = null;

// Plays notes one after another, each lighting its key: the scale of a mood.
function playRun(pitches) {
    stopPreview();
    runNotes = pitches.slice();
    runStep();
}

function runStep() {
    for (var i = 0; i < previewNotes.length; i++) {
        outlet(0, previewNotes[i], 0);
    }
    previewNotes = [];
    runTask = null;
    if (runNotes.length > 0) {
        previewNotes = [runNotes.shift()];
        outlet(0, previewNotes[0], 96);
        runTask = new Task(runStep, this);
        runTask.schedule(190);
    }
    mgraphics.redraw();
}

function playNotes(pitches, chord) {
    stopPreview();
    previewNotes = pitches.slice();
    preview = chord || null;
    for (var i = 0; i < previewNotes.length; i++) {
        outlet(0, previewNotes[i], 96);
    }
    previewTask = new Task(stopPreview, this);
    previewTask.schedule(900);
    mgraphics.redraw();
}

function inside(rect, x, y) {
    return x >= rect[0] && x <= rect[0] + rect[2] && y >= rect[1] && y <= rect[1] + rect[3];
}

// What the big button does right now, and what is written on it.
function mainAction() {
    var s = currentStep();
    if (inJam()) {
        return "ГАММА";
    }
    if (phase === "intro") {
        return "СТАРТ";
    }
    if (phase === "done") {
        return nextLesson() ? "ДАЛЬШЕ" : "";
    }
    if (phase === "run" && s && (s.live || s.manual)) {
        return "ГОТОВО";
    }
    if (phase === "run" && s && s.show.length > 0) {
        return "ПОСЛУШАТЬ";
    }
    return "";
}

var lastTurnMs = -10000;    // when the latest turn of a page had been dealt with
var lastMainMs = -10000;    // the latest click on the big buttons
var TURN_GUARD_MS = 150;

// One press of the mouse is one action, and that takes care. A mouse button
// often sends two presses for one: the log of a real mouse (the self-check
// keeps one) shows a press followed some 90 to 135 ms later by a second one,
// which Max reports as a double click, and the arrows used to turn two pages
// for it. Clicks made by a script come differently again: the second of two
// is reported twice, as a click and as a double click. So:
// - a double click is never acted on: it is either the echo of a press or a
//   second report of a click that has come as a plain click as well;
// - an arrow turns one page and takes no other click for a moment after its
//   work is done (TURN_GUARD_MS), so a press never turns two pages even if
//   its echo comes as a plain click;
// - a big button, which changes its meaning when pressed, waits longer.
// The price: of two deliberate clicks closer than about a seventh of a
// second only the first counts.
function onclick(x, y) {
    busyAt = clock;
    var came = nowMs();
    logClick("click", x, y, came, act(x, y, came));
}

function ondblclick(x, y) {
    logClick("double", x, y, nowMs(), false);
}

// In self-check mode every call Max makes for the mouse is written down:
// when it came, what kind, where, whether the trainer acted on it, how long
// that took and which lesson is open afterwards (smk_trainer_clicks.json).
var clickLog = null;

function logClick(kind, x, y, came, taken) {
    if (!clickLog) {
        return;
    }
    clickLog.push([came % 10000000, kind, Math.round(x), Math.round(y), taken ? 1 : 0, nowMs() - came, current.id]);
    if (clickLog.length > 60) {
        clickLog.shift();
    }
    try {
        var file = new File(savePath().replace(SAVE_NAME, "") + "smk_trainer_clicks.json", "write", "TEXT");
        if (file.isopen) {
            file.eof = 0;
            var text = JSON.stringify(clickLog);
            for (var i = 0; i < text.length; i += 1500) {
                file.writestring(text.substring(i, i + 1500));
            }
            file.close();
        }
    } catch (error) {
        clickLog = null;
    }
}

// A click in free play: the upper arrows change the style, the lower ones
// the mood, the buttons play the scale and the home chord, a note of the
// wheel becomes the tonic, a chord of the wheel is played. Returns false when
// the click made a sound and needs no redraw of its own.
function actInJam(x, y) {
    if (inside(BUTTONS.groupPrev, x, y)) {
        jamStyle(-1);
    } else if (inside(BUTTONS.groupNext, x, y)) {
        jamStyle(1);
    } else if (inside(BUTTONS.prev, x, y)) {
        jamMood(-1);
    } else if (inside(BUTTONS.next, x, y)) {
        jamMood(1);
    } else if (inside(BUTTONS.main, x, y)) {
        var run = [];
        var scale = jamScale();
        for (var i = 0; i <= scale.length; i++) {
            run.push(60 + jam.tonic + (i < scale.length ? scale[i] : 12));
        }
        playRun(run);
        return false;
    } else if (inside(BUTTONS.restart, x, y)) {
        var home = jamDegreeChord(jam.tonic);
        if (home) {
            playNotes(chordPitches(home, 48), home);
        }
        return false;
    } else if (x >= TASK_X - 6 && x <= TEXT_RIGHT && y >= KY + KEY_H + 4) {
        taskShown = clock + 144;        // a click on the task: the advice says what it is for
        counselPinned = -1000;
        counsel.key = "";
    } else if (x >= KX && x < TASK_X - 6 && y >= KY + KEY_H + 4) {
        counselTurn++;                  // a click on the advice: another one
        counselPinned = clock + 240;
        taskShown = -1000;
        counsel.key = "";
    } else {
        var dx = x - CX;
        var dy = y - CY;
        var radius = Math.sqrt(dx * dx + dy * dy);
        if (radius >= R_IN && radius <= R_OUT) {
            var degrees = Math.atan2(dy, dx) * 180 / Math.PI + 90;
            var pc = FIFTHS_PC[((Math.round(degrees / 30) % 12) + 12) % 12];
            if (radius >= R_MID) {
                jamTonic(pc);
            }
            var chord = jamDegreeChord(radius >= R_MID ? jam.tonic : pc);
            if (chord) {
                playNotes(chordPitches(chord, 48), chord);
                return false;
            }
        }
    }
    return true;
}

// Does what a click at this place asks for; false if the click was not taken.
function act(x, y, now) {
    var big = inside(BUTTONS.free, x, y)
        || (!inJam() && (inside(BUTTONS.restart, x, y) || (inside(BUTTONS.main, x, y) && mainAction() !== "ПОСЛУШАТЬ")));
    if (big) {
        // The big buttons change their meaning when pressed (start becomes
        // done, next becomes start), so the second click of a double click
        // must not go to the new meaning.
        if (now - lastMainMs < 400) {
            return false;
        }
        lastMainMs = now;
    }
    var turn = inside(BUTTONS.groupPrev, x, y) || inside(BUTTONS.groupNext, x, y)
        || inside(BUTTONS.prev, x, y) || inside(BUTTONS.next, x, y);
    if (turn && now - lastTurnMs < TURN_GUARD_MS) {
        return false;
    }
    if (inside(BUTTONS.free, x, y)) {
        if (inJam()) {
            leaveJam();
        } else {
            enterJam();
        }
    } else if (inJam()) {
        if (!actInJam(x, y)) {
            return true;
        }
    } else if (inside(BUTTONS.groupPrev, x, y)) {
        moveGroup(-1);
    } else if (inside(BUTTONS.groupNext, x, y)) {
        moveGroup(1);
    } else if (inside(BUTTONS.prev, x, y)) {
        moveLesson(-1);
    } else if (inside(BUTTONS.next, x, y)) {
        moveLesson(1);
    } else if (inside(BUTTONS.restart, x, y)) {
        if (phase === "run" || phase === "done") {
            startLesson();
        }
    } else if (inside(BUTTONS.main, x, y)) {
        var action = mainAction();
        if (action === "СТАРТ") {
            startLesson();
        } else if (action === "ДАЛЬШЕ") {
            selectLesson(nextLesson());
        } else if (action === "ГОТОВО") {
            completeStep();
        } else if (action === "ПОСЛУШАТЬ") {
            playNotes(currentStep().show, currentStep().chord);
            return true;
        }
    } else {
        var dx = x - CX;
        var dy = y - CY;
        var radius = Math.sqrt(dx * dx + dy * dy);
        if (radius >= R_IN && radius <= R_OUT) {
            var degrees = Math.atan2(dy, dx) * 180 / Math.PI + 90;
            var index = ((Math.round(degrees / 30) % 12) + 12) % 12;
            var chord = sectorChord(radius >= R_MID ? 0 : 1, index);
            playNotes(chordPitches(chord, 60), chord);
            var s = currentStep();
            if (s && s.click === "wheel") {
                completeStep();
            }
            return true;
        }
    }
    if (turn) {
        // Counted from here, after the work: a click that piled up behind
        // this one is let in straight after it and must find the door shut.
        lastTurnMs = nowMs();
    }
    mgraphics.redraw();
    return true;
}

// -------------------------------------------------------------- animation

function tick() {
    clock++;
    hearOthers();
    if (clock === 24) {
        selfCheck();    // two seconds in: Ableton has finished loading the device
    }
    if (saveAt >= 0 && clock >= saveAt) {
        saveAt = -1;
        saveProgress();
    } else if (saveAt < 0 && clock % 36 === 6) {
        followOthers();
    }
    // Ableton shows the devices of one track only. A trainer that is not on
    // the screen is not painted, and then it asks Ableton nothing either.
    var shown = clock - paintedAt < 24;
    if (shown && !shownBefore) {
        // back in sight: what another copy has done and what is in the Live
        // Set are looked at right away, not when their turn comes
        if (saveAt < 0) {
            followOthers();
        }
        looking.restAt = 0;
    }
    shownBefore = shown;
    if (inJam() && !shown) {
        coachTick();        // the keys may still be played on its track
    }
    if (inJam() && shown) {
        lookAtProject();
        danceTick();
        coachTick();
        if (clock - lastOn > 60) {
            recentSour = [];        // what was played a while ago is no reason for advice now
            recentTrips = [];
            recentForce = [];
        }
        counselTick();
        if (jamChord && held.length >= 3) {
            jamChordAt = clock;     // the chord is still down
        }
    }
    // The vibe fades slowly while someone plays and quickly after two
    // seconds of silence.
    vibe *= clock - lastOn > 24 ? 0.97 : vibe > FIRE_AT ? 0.986 : 0.99;
    mastery *= mood < 3 ? 0.9 : clock - lastOn > 12 ? 0.97 : 0.996;
    if (mastery < 0.01) {
        mastery = 0;
    }
    if (clock - lastOn > 30) {
        combo = 0;
    }
    gaugePeak = Math.max(gaugeValue(), gaugePeak - 0.004);
    if (Math.abs(vibe) < 0.01) {
        vibe = 0;
    }
    updateMood();
    moodEffects();
    updateParticles();
    var i;
    for (i = notes.length - 1; i >= 0; i--) {
        notes[i].age++;
        notes[i].y -= 2;
        if (notes[i].age > 9) {
            notes.splice(i, 1);
        }
    }
    for (i = popups.length - 1; i >= 0; i--) {
        popups[i].age++;
        if (popups[i].age > 30) {
            popups.splice(i, 1);
        }
    }
    if (shownPoints !== progress.points) {
        var gap = progress.points - shownPoints;
        shownPoints += Math.abs(gap) < 4 ? gap : Math.round(gap / 4);
    }
    // Ableton missions are checked a few times a second. A step stays for at
    // least a second even if Ableton is already in the wanted state, so the
    // player can see what it was about.
    var s = currentStep();
    if (s && s.live && clock - stepClock >= 12 && clock % checkEvery(s.live) === 0 && checkLive(s.live) === true) {
        completeStep();
    }
    // Painting is the dearest thing the trainer does. Every tick only while
    // something is going on; a still picture is renewed six times a second
    // (its marks blink at that pace), a hidden one three times, to notice at
    // once when it comes back into sight.
    if (shown ? (lively() || clock % 2 === 0) : clock % 4 === 0) {
        mgraphics.redraw();
    }
}

var paintedAt = -1000;      // tick of the latest paint: the device is on the screen
var shownBefore = false;
var busyAt = -1000;         // tick of the latest click

// Is anything on the picture moving because of what the player does?
function lively() {
    return clock - lastOn < 120 || clock - busyAt < 60 || mood !== 0 || particles.length > 0 || popups.length > 0
        || notes.length > 0 || (inJam() && dance.live) || clock < bannerUntil || clock - burstStart < 30
        || clock - confettiStart < 60 || clock < pointsFlash.until || previewNotes.length > 0 || shownPoints !== progress.points;
}

var ticker = null;
// Started once, from the first paint: by then the device is fully loaded,
// which the file and the Live API need.
function startTicker() {
    if (ticker) {
        return;
    }
    var saved = readProgress();
    if (saved) {
        progress = saved;
        recount();
        shownPoints = progress.points;
        for (var i = 0; i < LESSONS.length; i++) {
            if (LESSONS[i].id === progress.last) {
                current = LESSONS[i];
            }
        }
        if (recallJam(progress.jam)) {
            backTo = current;
            current = FREE;
        }
    }
    selectLesson(current);
    // what the other copies heard before this one woke up is in the past
    var b = theBand();
    bandSeq = b ? Number(b.seq) || 0 : 0;
    ticker = new Task(tick, this);
    ticker.interval = TICK_MS;
    ticker.repeat();
}

function notifydeleted() {
    if (saveAt >= 0) {
        saveAt = -1;
        saveProgress();     // the place was not written yet
    }
    if (ticker) {
        ticker.cancel();
    }
    stopPreview();
}

// ---------------------------------------------------------------- drawing

// Colour of every sector for the current state: [outer 0..11, inner 0..11].
function sectorColours() {
    var s = currentStep();
    var target = s && s.chord ? s.chord : null;
    var pcs = unique(held.map(function (p) { return p % 12; }));
    var played = held.length > 0 ? detectChord(pcs, held[0] % 12) : null;
    var blink = clock % 8 < 4;
    var colours = [];
    for (var ring = 0; ring < 2; ring++) {
        for (var index = 0; index < 12; index++) {
            var chord = sectorChord(ring, index);
            var colour = STEEL;
            if (isDiatonic(index)) {
                if (target) {
                    colour = ring === 0 ? ORANGE_DIM : GREEN_DIM;
                } else {
                    colour = ring === 0 ? ORANGE : GREEN;
                }
            }
            if (sameSector(target, chord)) {
                colour = blink ? WHITE : YELLOW;
            }
            if (sameSector(preview, chord)) {
                colour = CYAN;
            }
            if (sameSector(played, chord)) {
                colour = LIME;
            }
            colours.push(colour);
        }
    }
    return colours;
}

var wheelKey = "";
var wheelRuns = [];

// The wheel as horizontal runs of 2x2 blocks. It is rebuilt only when a
// sector changes colour.
function buildWheel(colours) {
    var runs = [];
    var size = R_OUT * 2 / CELL;
    for (var gy = 0; gy < size; gy++) {
        var runStart = 0;
        var runColour = -1;
        for (var gx = 0; gx <= size; gx++) {
            var colour = -1;
            if (gx < size) {
                var dx = (gx + 0.5) * CELL - R_OUT;
                var dy = (gy + 0.5) * CELL - R_OUT;
                var radius = Math.sqrt(dx * dx + dy * dy);
                if (radius <= R_OUT && radius >= R_IN && Math.abs(radius - R_MID) >= 1.2) {
                    var angle = Math.atan2(dy, dx) * 180 / Math.PI + 105;
                    angle = ((angle % 360) + 360) % 360;
                    var index = Math.floor(angle / 30);
                    var within = angle - index * 30;
                    var edge = Math.min(within, 30 - within) * Math.PI / 180 * radius;
                    if (edge >= 1.1) {
                        colour = colours[(radius > R_MID ? 0 : 12) + index];
                    }
                }
            }
            if (colour !== runColour) {
                if (runColour >= 0) {
                    runs.push(CX - R_OUT + runStart * CELL, CY - R_OUT + gy * CELL, (gx - runStart) * CELL, runColour);
                }
                runStart = gx;
                runColour = colour;
            }
        }
    }
    return runs;
}

// The wheel of free play. Its outer ring is notes, not chords: lime for the
// notes of the chord under the melody, yellow for the note that colours the
// mood, blue for the rest of the scale, grey for what lies outside. On the
// circle of fifths the notes of a scale stand side by side, so the notes that
// suit show as one arc. The inner ring names the chord the scale builds on
// each note.
function jamColours(view) {
    var heldPcs = unique(held.map(function (p) { return p % 12; }));
    var blink = clock % 8 < 4;
    var colours = [];
    var index, pc;
    for (index = 0; index < 12; index++) {
        pc = FIFTHS_PC[index];
        var tier = noteTier(pc, view.harmony);
        var colour = TIER_COLOURS[tier];
        if (tier > 0 && blink && view.nextPcs.indexOf(pc) >= 0) {
            colour = CYAN;      // where the melody may go next
        }
        if (heldPcs.indexOf(pc) >= 0) {
            colour = tier > 0 ? WHITE : RED;
        }
        colours.push(colour);
    }
    for (index = 0; index < 12; index++) {
        pc = FIFTHS_PC[index];
        var chord = jamDegreeChord(pc);
        var shade = !chord ? STEEL : chord.kind === "" ? ORANGE : chord.kind === "m" ? GREEN : PLUM;
        if (chord && preview && preview.jam && preview.root === pc) {
            shade = CYAN;
        }
        if (chord && jamChord && clock - jamChordAt < 48 && jamChord.root === pc) {
            shade = LIME;
        }
        colours.push(shade);
    }
    return colours;
}

function drawWheel() {
    var free = inJam();
    var colours = free ? jamColours(jamView) : sectorColours();
    var key = colours.join(",");
    if (key !== wheelKey) {
        wheelKey = key;
        wheelRuns = buildWheel(colours);
    }
    for (var i = 0; i < wheelRuns.length; i += 4) {
        px(wheelRuns[i], wheelRuns[i + 1], wheelRuns[i + 2], CELL, wheelRuns[i + 3]);
    }
    flush();
    for (var ring = 0; ring < 2; ring++) {
        var radius = ring === 0 ? (R_MID + R_OUT) / 2 : (R_IN + R_MID) / 2;
        for (var index = 0; index < 12; index++) {
            var middle = (-90 + index * 30) * Math.PI / 180;
            var colour = colours[ring * 12 + index];
            var text = ring === 0 ? MAJOR_NAMES[index] : MINOR_NAMES[index];
            if (free && ring === 1) {
                var degree = jamDegreeChord(FIFTHS_PC[index]);
                text = degree ? degree.name : "";
            }
            label(text, CX + radius * Math.cos(middle), Math.round(CY + radius * Math.sin(middle)) - 3, 1,
                  colour === STEEL ? SLATE : colour === PLUM ? SILVER
                  : (colour === ORANGE_DIM || colour === GREEN_DIM ? INK : NIGHT), CENTER);
        }
    }
    if (free) {
        label(ROOT_NAMES[jam.tonic], CX, CY - 12, 2, WHITE, CENTER);
        label(MOODS[jam.mood][2], CX, CY + 6, 1, SILVER, CENTER);
    } else {
        label(MAJOR_NAMES[keyIndex], CX, CY - 12, 2, WHITE, CENTER);
        label(MINOR_NAMES[keyIndex], CX, CY + 6, 1, SILVER, CENTER);
    }
    flush();
}

// What colour each key or pad gets: preview, what to press, what is pressed.
function keyStates() {
    var states = {};
    var s = currentStep();
    var playing = s && current.kind !== "free" && !s.any;
    var pads = showsPads();
    var i;
    if (preview || previewNotes.length > 0) {
        for (i = 0; i < previewNotes.length; i++) {
            states[pads ? previewNotes[i] : foldIntoRange(previewNotes[i])] = CYAN;
        }
    }
    if (s) {
        for (i = 0; i < s.show.length; i++) {
            states[pads ? s.show[i] : foldIntoRange(s.show[i])] = SKY;
        }
    }
    for (i = 0; i < held.length; i++) {
        if (inJam()) {
            // in free play a key shows how well its note suits the mood
            var tier = noteTier(held[i] % 12, jamView.harmony);
            states[foldIntoRange(held[i])] = tier === 0 ? RED : TIER_COLOURS[tier];
            continue;
        }
        var good = true;
        if (playing) {
            good = s.drums ? s.drums.indexOf(held[i]) >= 0
                 : s.pcs.indexOf(held[i] % 12) >= 0 || (s.hold && s.hold.indexOf(held[i] % 12) >= 0);
        }
        states[pads ? held[i] : foldIntoRange(held[i])] = good ? LIME : RED;
    }
    return states;
}

function drawPads() {
    var states = keyStates();
    var pitch, rect, state;
    for (pitch = 36; pitch < 52; pitch++) {
        rect = padRect(pitch);
        state = states[pitch];
        px(rect[0], rect[1], rect[2], rect[3] - 3, state === undefined ? STEEL : state);
        px(rect[0], rect[1] + rect[3] - 3, rect[2], 3, NIGHT);
    }
    flush();
    for (pitch = 36; pitch < 52; pitch++) {
        rect = padRect(pitch);
        if (DRUM_TAGS[pitch]) {
            label(DRUM_TAGS[pitch], rect[0] + rect[2] / 2, rect[1] + 9, 1, states[pitch] === undefined ? SILVER : NIGHT, CENTER);
        }
    }
    flush();
}

function drawKeyboard() {
    if (showsPads()) {
        drawPads();
        return;
    }
    var states = keyStates();
    var octave, i, pitch, x, state;
    for (octave = 0; octave < OCTAVES; octave++) {
        for (i = 0; i < 7; i++) {
            pitch = LOW_NOTE + octave * 12 + WHITE_PCS[i];
            x = KX + (octave * 7 + i) * KEY_W;
            state = states[pitch];
            px(x, KY, KEY_W - 1, KEY_H - 3, state === undefined ? WHITE : state);
            px(x, KY + KEY_H - 3, KEY_W - 1, 3, state === undefined ? SILVER : STEEL);
        }
    }
    flush();
    for (octave = 0; octave < OCTAVES; octave++) {
        for (i = 0; i < 7; i++) {
            x = KX + (octave * 7 + i) * KEY_W;
            label(NOTE_NAMES[WHITE_PCS[i]], x + KEY_W / 2 - 1, KY + KEY_H - 13, 1, i === 0 ? NIGHT : SLATE, CENTER);
        }
        for (var pc = 0; pc < 12; pc++) {
            if (WHITE_PCS.indexOf(pc) >= 0) {
                continue;
            }
            pitch = LOW_NOTE + octave * 12 + pc;
            x = KX + (octave * 7 + WHITE_INDEX[pc] + 1) * KEY_W - BLACK_W / 2 - 1;
            state = states[pitch];
            // a dark outline on three sides, drawn as strips so it never covers the key
            px(x - 1, KY, 1, BLACK_H + 1, INK);
            px(x + BLACK_W, KY, 1, BLACK_H + 1, INK);
            px(x, KY + BLACK_H, BLACK_W, 1, INK);
            px(x, KY, BLACK_W, BLACK_H - 3, state === undefined ? NIGHT : state);
            px(x, KY + BLACK_H - 3, BLACK_W, 3, state === undefined ? STEEL : NIGHT);
        }
    }
    if (inJam()) {
        markKeys(states);
    }
    flush();
}

// Where the mark of a key goes: a small bar under the black keys for a white
// key, near the lower end for a black one.
function keyMark(pitch) {
    var octave = Math.floor((pitch - LOW_NOTE) / 12);
    var pc = pitch % 12;
    if (WHITE_PCS.indexOf(pc) >= 0) {
        return [KX + (octave * 7 + WHITE_PCS.indexOf(pc)) * KEY_W + 4, KY + 38, KEY_W - 9, 4];
    }
    return [KX + (octave * 7 + WHITE_INDEX[pc] + 1) * KEY_W - BLACK_W / 2 + 1, KY + BLACK_H - 10, BLACK_W - 4, 4];
}

// Free play marks every key by how well its note suits the melody, and makes
// the notes worth going to next stand out.
function markKeys(states) {
    var mark, pitch;
    for (pitch = LOW_NOTE; pitch < LOW_NOTE + OCTAVES * 12; pitch++) {
        var tier = noteTier(pitch % 12, jamView.harmony);
        if (tier > 0 && states[pitch] === undefined) {
            mark = keyMark(pitch);
            px(mark[0], mark[1], mark[2], mark[3], TIER_COLOURS[tier]);
        }
    }
    if (clock % 8 < 4) {
        for (var i = 0; i < jamView.next.length; i++) {
            pitch = foldIntoRange(jamView.next[i]);
            if (states[pitch] === undefined) {
                mark = keyMark(pitch);
                px(mark[0] - 1, mark[1] - 2, mark[2] + 2, mark[3] + 4, CYAN);
            }
        }
    }
    // the keys of the task: a bar of their own above the mark, so both show
    if (clock % 8 >= 2) {
        for (var k = 0; k < jamView.goal.length; k++) {
            pitch = foldIntoRange(jamView.goal[k]);
            if (states[pitch] === undefined) {
                mark = keyMark(pitch);
                px(mark[0] - 1, mark[1] - 9, mark[2] + 2, 5, ORANGE);
            }
        }
    }
}

// Big text that shrinks until it fits the width.
function headline(s, x, y, maxWidth, colour) {
    var scale = 3;
    while (scale > 1 && layout(s).w * scale > maxWidth) {
        scale--;
    }
    return label(s, x, y + (3 - scale) * 3, scale, colour, LEFT);
}

// Above the keys in free play: what is being played, what the melody can
// lean on, and where to go next.
function drawFreePlay() {
    var view = jamView;
    var mood = MOODS[jam.mood];
    var pcs = unique(held.map(function (p) { return p % 12; }));
    var played = held.length > 0 ? detectChord(pcs, held[0] % 12) : null;
    if (played) {
        headline(played.name, KX, 5, 150, LIME);
    } else if (pcs.length > 0) {
        headline(noteList(pcs, NOTE_NAMES), KX, 5, 200, WHITE);
    } else {
        label(ROOT_NAMES[jam.tonic] + " " + mood[2], KX, 8, 2, SLATE, LEFT);
    }
    label("ОПОРНЫЕ: " + noteList(view.harmony, ROOT_NAMES), TEXT_RIGHT, 6, 1, LIME, RIGHT);
    if (mood[4] >= 0) {
        label("КРАСКА ЛАДА: " + ROOT_NAMES[(jam.tonic + mood[4]) % 12], TEXT_RIGHT, 17, 1, YELLOW, RIGHT);
    }
    label(view.text, KX, 33, 1, CYAN, LEFT);
}

// ------------------------------------------------- the coach of free play

// Free play teaches too. The coach sets one small task after another, each
// in the scale and the key that are on the wheel: find the tonic, walk the
// scale, hold the chord, keep time, repeat a motif, play over a chord. It
// lights the keys to press, counts what is done and pays for every task.
// kind, pay, what to do and why. %T is the tonic, %H the notes of the home
// chord, %S the scale, %C the note that colours the mood.
var COACH = [
    ["tonic", 5, "Найди тонику: сыграй ноту %T.",
     "Тоника это дом лада: на ней мелодия успокаивается. С неё удобно начать фразу и к ней хорошо вернуться в конце."],
    ["home", 5, "Сыграй по очереди опорные ноты: %H.",
     "Из опорных нот сложен главный аккорд. Мелодия, которая останавливается на них, звучит устойчиво, а на остальных нотах гаммы просит продолжения."],
    ["up", 8, "Гамма вверх: от тоники %T до тоники, по одной ноте.",
     "Гамма это весь запас нот лада: %S. Пройди её пальцами, чтобы руки запомнили, где лежат свои ноты. Иди по оранжевым клавишам."],
    ["down", 8, "Гамма вниз: от верхней тоники к нижней.",
     "Вниз гамма звучит как спуск домой. Те же ноты, обратный порядок: начинай с верхней тоники."],
    ["chord", 8, "Возьми главный аккорд: %H вместе.",
     "Аккорд это три опорные ноты разом. На нём стоит вся гармония лада: с него начинают и им заканчивают."],
    ["steady", 10, "Восемь ударов подряд через равные промежутки.",
     "Ровный ритм важнее правильных нот: его слышит каждый. Играй не быстро, а одинаково, как шаги."],
    ["motif", 10, "Мотив из трёх нот и сразу его точный повтор.",
     "Повтор делает из случайных нот мелодию: ухо узнаёт рисунок. Сыграй три ноты гаммы и повтори их в точности."],
    ["landing", 10, "Фраза из четырёх нот с концом на тонике %T, потом пауза.",
     "Фраза должна чем-то кончаться. Тоника в конце и пауза после неё звучат как точка в предложении."],
    ["thirds", 10, "Четыре разные пары нот через одну, обе ноты разом.",
     "Две ноты через одну клавишу гаммы звучат вместе мягко: это терция. Так мелодию ведут в два голоса."],
    ["chords3", 12, "Три разных аккорда лада: смотри внутреннее кольцо круга.",
     "У каждого лада свои аккорды: они стоят на внутреннем кольце круга. Щёлкни сектор, чтобы услышать аккорд и увидеть его ноты на клавишах."],
    ["arp", 12, "Главный аккорд по одной ноте: вверх и обратно.",
     "Разложенный аккорд называется арпеджио: те же ноты, но по очереди. На нём держится половина электронной музыки."],
    ["over", 15, "Левой держи аккорд, правой сыграй над ним четыре разные ноты.",
     "Это и есть игра двумя руками: левая держит гармонию, правая поёт. Над аккордом лучше всего звучат его же ноты и соседние с ними."],
    ["colour", 12, "Нота-краска %C, а за ней соседняя опорная.",
     "Краска %C отличает этот лад от соседних: в ней его характер. Задержись на ней, потом шагни на соседнюю опорную ноту, и напряжение разрешится."],
    ["breath", 12, "Четыре ноты, секунда тишины, ещё четыре.",
     "Мелодия без пауз утомляет, как речь без точек. Сыграй короткую фразу, помолчи секунду, ответь второй фразой."],
    ["loud", 12, "Четыре ноты тихо, потом четыре громко.",
     "Сила удара это краска. Одни и те же ноты тихо звучат как вопрос, громко как утверждение. Клавиатура слышит, как сильно ты нажимаешь."],
    ["cadence", 15, "Любой аккорд лада, а сразу за ним главный.",
     "Любой другой аккорд лада создаёт ожидание, главный его снимает. На этой паре, напряжении и возвращении, стоит вся гармония."],
    ["bass", 15, "Тоника %T внизу левой, главный аккорд над ней правой.",
     "Бас под аккордом делает звук полным. Самая низкая нота решает, как называется аккорд: с тоникой внизу он звучит устойчивее всего."],
    ["wide", 15, "Восемь нот гаммы подряд, от края до края октавы и шире.",
     "Мелодия в пределах пяти клавиш быстро надоедает. Пройди за восемь нот целую октаву: вверх или вниз, без чужих нот."],
    ["sequence", 20, "Мотив из трёх нот, потом он же на ступень выше.",
     "Это секвенция: мотив повторяется на ступень выше. Мелодия растёт сама из себя, и слушатель угадывает продолжение."],
    ["combo", 15, "Комбо 16: удары в гамме и в ритме.",
     "Комбо растёт от каждого удара в гамме и в ритме. Чужая нота сбрасывает счёт, сбой ритма режет его вдвое. Каждый шестнадцатый удар платит."],
    ["fire", 20, "Доведи шкалу до огня.",
     "Шкала под сценой растёт, когда ноты разные, ритм ровный, а аккорды меняются. Один и тот же аккорд её не сдвинет."],
    ["fast", 20, "Шестнадцать нот гаммы за четыре секунды.",
     "Скорость приходит от ровности. Сначала сыграй гамму медленно и чисто, потом быстрее: четыре ноты в секунду."],
    ["combo2", 25, "Комбо 32.",
     "После шестнадцати ударов подряд очки за комбо удваиваются, после тридцати двух утраиваются."],
    ["space", 30, "Доведи шкалу до космоса.",
     "До космоса шкала доходит только от настоящей игры: мелодия правой рукой поверх аккордов левой, и аккорды должны меняться."],
    ["combo4", 40, "Комбо 64.",
     "Шестьдесят четыре удара без чужой ноты и без сбоя: множитель очков становится пятикратным."],
    ["virtuoso", 60, "Стань виртуозом.",
     "Виртуоз играет сразу ровно, разнообразно, широко, в две руки и чисто: нужны четыре признака из семи. Пока ты играешь, совет говорит, каких не хватает."],
    ["legend", 100, "Стань легендой.",
     "Легенде нужны шесть признаков из семи: к игре виртуоза прибавь скорость, четыре удара в секунду, и три разных аккорда."]
];
var COACH_COUNTS = { home: 3, up: 8, down: 8, steady: 8, thirds: 4, chords3: 3, arp: 5, over: 4, wide: 8, fast: 16 };

// What has been done of the task in hand: a count, a list, a stage.
var coach = { count: 0, list: [], stage: 0, at: -1000, last: -1 };
var lastVelocity = 100;

function coachReset() {
    coach = { count: 0, list: [], stage: 0, at: clock, last: -1 };
}

function coachTask() {
    return COACH[(progress.coach || 0) % COACH.length];
}

function homePcs() {
    var home = jamDegreeChord(jam.tonic);
    return home ? home.pcs : [jam.tonic, (jam.tonic + 7) % 12];
}

// The steps of the scale as pitches from the tonic up to the next tonic.
function coachScale() {
    var scale = jamScale();
    var out = [];
    for (var i = 0; i < scale.length; i++) {
        out.push(60 + jam.tonic + scale[i]);
    }
    out.push(72 + jam.tonic);
    return out;
}

// The pitches a task asks for in a row: the scale up or down, the arpeggio.
function coachRow(kind) {
    var row = coachScale();
    if (kind === "down") {
        return row.reverse();
    }
    if (kind === "arp") {
        var home = homePcs();
        var up = [];
        for (var i = 0; i < home.length; i++) {
            up.push(60 + jam.tonic + ((home[i] - jam.tonic + 12) % 12));
        }
        return up.concat(up.slice(0, up.length - 1).reverse());
    }
    return row;
}

function coachNames(pcs) {
    var names = [];
    for (var i = 0; i < pcs.length; i++) {
        names.push(ROOT_NAMES[((pcs[i] % 12) + 12) % 12]);
    }
    return names.join(" ");
}

// How much of the task is done and how much it takes; 0 where nothing is
// counted.
function coachProgress() {
    var kind = coachTask()[0];
    if (kind === "combo" || kind === "combo2" || kind === "combo4") {
        var target = kind === "combo" ? 16 : kind === "combo2" ? 32 : 64;
        return [Math.min(16, Math.floor(combo * 16 / target)), 16];
    }
    var need = kind === "up" || kind === "down" || kind === "arp" ? coachRow(kind).length
             : kind === "home" ? homePcs().length : (COACH_COUNTS[kind] || 0);
    var done = kind === "home" || kind === "thirds" || kind === "chords3" || kind === "over" ? coach.list.length : coach.count;
    return [Math.min(done, need), need];
}

// The notes of this mood and key put into a text of the coach.
function coachFill(text) {
    var colour = MOODS[jam.mood][4];
    return text.replace("%T", ROOT_NAMES[jam.tonic]).replace("%H", coachNames(homePcs()))
               .replace("%S", coachNames(coachScale().slice(0, -1))).replace("%C", colour < 0 ? "" : ROOT_NAMES[(jam.tonic + colour) % 12]);
}

function coachText() {
    return coachFill(coachTask()[2]);
}

function coachWhy() {
    return coachFill(coachTask()[3]);
}
// The keys the task wants next, for the wheel and the keyboard to light;
// null when the task leaves the choice of notes to the player.
function coachTargets() {
    var kind = coachTask()[0];
    var home = homePcs();
    var out = [];
    var i;
    if (kind === "tonic") {
        return [60 + jam.tonic];
    }
    if (kind === "home") {
        for (i = 0; i < home.length; i++) {
            if (coach.list.indexOf(home[i]) < 0) {
                out.push(60 + jam.tonic + ((home[i] - jam.tonic + 12) % 12));
            }
        }
        return out;
    }
    if (kind === "up" || kind === "down" || kind === "arp") {
        var row = coachRow(kind);
        return [row[Math.min(coach.count, row.length - 1)]];
    }
    if (kind === "chord" || kind === "bass") {
        for (i = 0; i < home.length; i++) {
            out.push(60 + jam.tonic + ((home[i] - jam.tonic + 12) % 12));
        }
        if (kind === "bass") {
            out.unshift(48 + jam.tonic);
        }
        return out;
    }
    if (kind === "colour" && MOODS[jam.mood][4] >= 0) {
        return coach.stage === 0 ? [60 + jam.tonic + MOODS[jam.mood][4]] : [nearestRest(coach.last, home)];
    }
    if (kind === "landing" && coach.count >= 3) {
        return [60 + jam.tonic];
    }
    return null;
}

// The task is done: points, a cheer, the next task.
function coachDone() {
    var pay = coachTask()[1];
    progress.coach = (progress.coach || 0) + 1;
    earn(pay);
    banner = "ЕСТЬ!";
    bannerUntil = clock + 18;
    confettiStart = clock;
    explode(SX + 40 + rand() * (SW - 80), SY + 30 + rand() * 30);
    coachReset();
    taskAt = clock;
    if (ticker) {
        saveAt = clock + 12;
    }
}

// The degree of a pitch in the scale, counted through the octaves; -1 for a
// note outside the scale.
function scaleDegree(pitch) {
    var scale = jamScale();
    var above = pitch - jam.tonic;
    var index = scale.indexOf(((above % 12) + 12) % 12);
    return index < 0 ? -1 : Math.floor(above / 12) * scale.length + index;
}

// Called on every new stroke of free play.
function coachOnset(pitch, sour, now) {
    var kind = coachTask()[0];
    var pc = pitch % 12;
    var inScale = scaleDegree(pitch) >= 0;
    var home = homePcs();
    var gap = clock - coach.at;
    var list = coach.list;
    var i;
    coach.at = clock;
    if (kind === "tonic") {
        if (pc === jam.tonic) {
            coachDone();
        }
    } else if (kind === "home") {
        if (home.indexOf(pc) >= 0 && list.indexOf(pc) < 0) {
            list.push(pc);
        }
        if (list.length >= home.length) {
            coachDone();
        }
    } else if (kind === "up" || kind === "down" || kind === "arp") {
        var row = coachRow(kind);
        if (pc === row[coach.count] % 12) {
            coach.count++;
        } else {
            coach.count = pc === row[0] % 12 ? 1 : 0;
        }
        if (coach.count >= row.length) {
            coachDone();
        }
    } else if (kind === "steady") {
        coach.count = !inScale || rhythm === -1 ? 0 : coach.count + 1;
        if (coach.count >= 8 && groove >= 4) {
            coachDone();
        }
    } else if (kind === "motif" || kind === "sequence") {
        if (!inScale) {
            coach.list = [];
            return;
        }
        list.push(pitch);
        if (list.length > 6) {
            list.shift();
        }
        if (list.length === 6 && !(list[0] === list[1] && list[1] === list[2])) {
            var shift = kind === "motif" ? 0 : 1;
            var same = true;
            for (i = 0; i < 3; i++) {
                same = same && (kind === "motif" ? list[i + 3] === list[i] : scaleDegree(list[i + 3]) - scaleDegree(list[i]) === shift);
            }
            if (same) {
                coachDone();
            }
        }
    } else if (kind === "landing") {
        coach.count = gap >= 12 ? 1 : coach.count + 1;
        coach.last = pc;
    } else if (kind === "over") {
        if (held.length >= 4 && pitch === held[held.length - 1] && inScale && list.indexOf(pc) < 0) {
            list.push(pc);
        }
        if (list.length >= 4) {
            coachDone();
        }
    } else if (kind === "colour") {
        if (coach.stage === 1 && home.indexOf(pc) >= 0 && Math.abs(pitch - coach.last) <= 2) {
            coachDone();
            return;
        }
        coach.stage = pc === (jam.tonic + MOODS[jam.mood][4]) % 12 ? 1 : 0;
        coach.last = pitch;
    } else if (kind === "breath") {
        if (gap >= 12) {
            coach.stage = coach.count >= 4 ? 1 : 0;     // a pause after a full phrase
            coach.count = 0;
        }
        coach.count++;
        if (coach.stage === 1 && coach.count >= 4) {
            coachDone();
        }
    } else if (kind === "loud") {
        var soft = lastVelocity < 56;
        var hard = lastVelocity > 96;
        if (coach.stage === 0) {
            coach.count = soft ? coach.count + 1 : 0;
            if (coach.count >= 4) {
                coach.stage = 1;
                coach.count = 0;
            }
        } else {
            coach.count = hard ? coach.count + 1 : 0;
            if (coach.count >= 4) {
                coachDone();
            }
        }
    } else if (kind === "wide") {
        if (!inScale) {
            coach.list = [];
            coach.count = 0;
            return;
        }
        list.push(pitch);
        if (list.length > 8) {
            list.shift();
        }
        coach.count = list.length;
        if (list.length === 8 && Math.max.apply(null, list) - Math.min.apply(null, list) >= 12) {
            coachDone();
        }
    } else if (kind === "fast") {
        if (!inScale) {
            coach.list = [];
            coach.count = 0;
            return;
        }
        list.push(now);
        if (list.length > 16) {
            list.shift();
        }
        coach.count = list.length;
        if (list.length === 16 && now - list[0] <= 4000) {
            coachDone();
        }
    }
}

// Called on every tick of free play: the tasks that are about what is held
// down, about silence, or about how far the playing has come.
function coachTick() {
    var kind = coachTask()[0];
    var home = homePcs();
    var list = coach.list;
    var i;
    var keys = unique(held.map(function (p) { return p % 12; }));
    if (kind === "colour" && MOODS[jam.mood][4] < 0) {
        progress.coach = (progress.coach || 0) + 1;     // this mood has no such note
        coachReset();
        taskAt = clock;
    } else if (kind === "chord") {
        if (held.length >= home.length && sameSet(keys, home)) {
            coachDone();
        }
    } else if (kind === "bass") {
        var above = unique(held.slice(1).map(function (p) { return p % 12; }));
        if (held.length > home.length && held[0] % 12 === jam.tonic && held[1] - held[0] >= 5 && sameSet(above, home)) {
            coachDone();
        }
    } else if (kind === "landing") {
        if (held.length === 0 && clock - lastOn >= 12 && coach.count >= 4) {
            if (coach.last === jam.tonic) {
                coachDone();
            } else {
                coach.count = 0;
            }
        }
    } else if (kind === "thirds") {
        if (held.length === 2 && scaleDegree(held[0]) >= 0 && scaleDegree(held[1]) - scaleDegree(held[0]) === 2) {
            if (list.indexOf(held[0]) < 0) {
                list.push(held[0]);
            }
            if (list.length >= 4) {
                coachDone();
            }
        }
    } else if (kind === "chords3") {
        if (jamChord && held.length >= 3 && clock - jamChordAt < 3) {
            var inMode = true;
            for (i = 0; i < jamChord.pcs.length; i++) {
                inMode = inMode && scaleDegree(60 + jamChord.pcs[i]) >= 0;
            }
            if (inMode && list.indexOf(jamChord.name) < 0) {
                list.push(jamChord.name);
            }
            if (list.length >= 3) {
                coachDone();
            }
        }
    } else if (kind === "over") {
        if (held.length < 3) {
            coach.list = [];
        }
    } else if (kind === "cadence") {
        var n = recentChords.length;
        if (n >= 2 && clock - recentChords[n - 2][1] < 120 && clock - recentChords[n - 1][1] < 3
                && coach.stage !== recentChords[n - 1][1]) {
            coach.stage = recentChords[n - 1][1];
            var now = parseChord(recentChords[n - 1][0]);
            var before = parseChord(recentChords[n - 2][0]);
            if (sameSet(now.pcs, home) && !sameSet(before.pcs, home)) {
                coachDone();
            }
        }
    } else if ((kind === "combo" && combo >= 16) || (kind === "combo2" && combo >= 32) || (kind === "combo4" && combo >= 64)
               || (kind === "fire" && mood >= 2) || (kind === "space" && mood >= 3)
               || (kind === "virtuoso" && rank >= 1) || (kind === "legend" && rank >= 2)) {
        coachDone();
    }
}

// ------------------------------------------------ the advice of free play

// Under the keys of free play stand two columns. On the right the task of
// the coach, always in sight. On the left one piece of advice: the one that
// fits what the player is doing right now. While the keys sound it is about
// the playing (notes outside the scale, a rhythm that stumbles, a melody
// stuck on two notes, a hand that is missing, what the next rank still
// wants); while they rest it is about the track (what has just changed, the
// next step, the stage, the form, the sound of a part). A click on the advice
// asks for another one; a click on the task explains the task.

var recentSour = [];        // each of the latest strokes: 1 = sour, 0 = not
var recentTrips = [];       // each of them: 1 = out of time
var recentForce = [];       // how hard each was struck
var chordAt = -1000;        // tick of the latest chord struck
var styleAt = -1000;        // tick of the latest change of style
var moodAt = -1000;         // tick of the latest change of mood or tonic
var taskAt = -1000;         // tick at which the task of the coach was set
var projectNews = { part: "", at: -1000 };   // a part that has just come into the Live Set
var counsel = { key: "", head: "", text: "", colour: 0, since: -1000, urgent: false };
var counselTurn = 0;        // which of the quiet pieces of advice comes next
var counselPinned = -1000;  // until this tick a click keeps the quiet advice up
var taskShown = -1000;      // until this tick a click on the task keeps its reason up
var TASK_W = 144;           // the column of the task
var TASK_X = TEXT_RIGHT - TASK_W;
var ADVICE_W = TASK_X - 12 - KX;

function tally(list) {
    var sum = 0;
    for (var i = 0; i < list.length; i++) {
        sum += list[i];
    }
    return sum;
}

function keepLast(list, value, most) {
    list.push(value);
    if (list.length > most) {
        list.shift();
    }
}

// Other chords of the mode to go to from the one that keeps sounding.
function otherChords(not) {
    var scale = MOODS[jam.mood][5] || MOODS[jam.mood][3];
    var names = [];
    var steps = [3, 4, 5, 1, 0];
    for (var i = 0; i < steps.length && names.length < 2; i++) {
        var chord = scale.length === 7 ? jamDegreeChord((jam.tonic + scale[steps[i]]) % 12) : null;
        if (chord && chord.name !== not) {
            names.push(chord.name);
        }
    }
    return names;
}

// The quiet advice: about the track, the style and the sounds. The order
// depends on what is going on: a part that has just appeared comes first,
// then the part of the track that is selected, then the road ahead.
function quietAdvice() {
    var style = STYLES[jam.style];
    var seen = project && project.api;
    var stage = jamStage(project, style);
    var form = FORMS[FORM_OF[style.id]];
    var list = [];
    var part = "";
    var i;
    var fresh = false;
    if (seen && clock - projectNews.at < 240 && SOUNDS[style.id][projectNews.part]) {
        part = projectNews.part;
        fresh = true;       // news does not wait for its turn
    } else if (seen && project.selectedPart && SOUNDS[style.id][project.selectedPart]) {
        part = project.selectedPart;
    }
    if (part !== "") {
        list.push(["sound-" + part, "Звук: " + PART_NAMES[part][0], SOUNDS[style.id][part], ORANGE]);
    }
    list.push(["next", "Дальше", nextStep(project, style), SILVER]);
    for (i = 0; i < STAGE_TIPS[stage].length; i++) {
        list.push(["stage-" + stage + "-" + i, "Стадия: " + STAGE_NAMES[stage], STAGE_TIPS[stage][i], LIME]);
    }
    list.push(["form", "Форма", form[0], CYAN]);
    list.push(["growth", "Развитие", form[1], CYAN]);
    for (i = 0; i < style.parts.length; i++) {
        if (style.parts[i] !== part) {
            list.push(["sound-" + style.parts[i], "Звук: " + PART_NAMES[style.parts[i]][0], SOUNDS[style.id][style.parts[i]], ORANGE]);
        }
    }
    for (i = 0; i < style.play.length; i++) {
        list.push(["play-" + i, "Как играть", style.play[i], WHITE]);
    }
    list.lead = fresh;
    return list;
}

// The one piece of advice that fits this moment best.
function bestAdvice() {
    var style = STYLES[jam.style];
    var lad = MOODS[jam.mood];
    var home = jamDegreeChord(jam.tonic);
    var scaleNames = coachNames(coachScale().slice(0, -1));
    var playing = clock - lastOn < 36;
    var quiet = quietAdvice();
    var pick = quiet[wrapTo(counselTurn, quiet.length)];
    var i;
    if (clock < counselPinned) {
        return { key: pick[0], head: pick[1], text: pick[2], colour: pick[3], urgent: false };
    }
    if (clock < taskShown) {
        return { key: "task-" + (progress.coach || 0), head: "Зачем задание", text: coachWhy(), colour: ORANGE, urgent: true };
    }
    if (playing) {
        if (tally(recentSour) >= 3) {
            return { key: "sour", head: "Мимо лада", colour: RED, urgent: true,
                     text: "Несколько нот подряд мимо лада. Гамма сейчас: " + scaleNames + ". Играй только клавиши с меткой, по одной и медленнее." };
        }
        if (tally(recentTrips) >= 3) {
            return { key: "trips", head: "Ритм", colour: ORANGE, urgent: true,
                     text: "Удары падают мимо доли. Играй вдвое реже и считай вслух: раз, два, три, четыре. Метроном включается кнопкой рядом с темпом в Ableton." };
        }
        if (recentPcs.length >= 6 && unique(recentPcs).length <= 2 && lastPitch >= 0) {
            return { key: "stuck", head: "Мелодия", colour: YELLOW, urgent: false,
                     text: "Ты кружишь на одной-двух нотах. Шагни на соседнюю ноту гаммы: " + pitchNames([scaleStep(lastPitch, -1), scaleStep(lastPitch, 1)])
                         + ". Мелодии нужны хотя бы три-четыре разные ноты." };
        }
        if (sameChord >= 3 && otherChords(lastChord).length > 0) {
            return { key: "samechord", head: "Гармония", colour: YELLOW, urgent: false,
                     text: "Аккорд " + lastChord + " звучит уже который раз подряд. Смени его: после него хорошо встанет " + otherChords(lastChord).join(" или ") + "." };
        }
        var low = 999;
        var high = 0;
        for (i = 0; i < recentPitches.length; i++) {
            low = Math.min(low, recentPitches[i]);
            high = Math.max(high, recentPitches[i]);
        }
        if (recentPitches.length >= 10 && high - low <= 4 && clock - chordAt > 60) {
            return { key: "narrow", head: "Мелодия", colour: YELLOW, urgent: false,
                     text: "Мелодия топчется на пяти клавишах. Сделай скачок на опорную ноту повыше, а потом вернись к началу шагами по гамме." };
        }
        if (home && recentPitches.length >= 6 && clock - lastMelody < 60 && clock - chordAt > 240) {
            return { key: "nochords", head: "Левая рука", colour: SKY, urgent: false,
                     text: "Мелодия есть, а опоры под ней нет. Левой рукой возьми аккорд " + home.name + " (" + coachNames(home.pcs)
                         + ") и держи, пока правая играет." };
        }
        if (clock - chordAt < 60 && clock - lastMelody > 180) {
            return { key: "nomelody", head: "Правая рука", colour: SKY, urgent: false,
                     text: "Аккорды есть, мелодии нет. Правой рукой сыграй ноты этого аккорда по одной, выше левой, а потом соедини их соседними нотами гаммы." };
        }
        var soft = 999;
        var hard = 0;
        for (i = 0; i < recentForce.length; i++) {
            soft = Math.min(soft, recentForce[i]);
            hard = Math.max(hard, recentForce[i]);
        }
        if (recentForce.length >= 8 && hard - soft <= 8 && hard > soft) {
            return { key: "flat", head: "Сила удара", colour: SKY, urgent: false,
                     text: "Все ноты одной силы. Первую ноту фразы возьми сильнее, последнюю тише: мелодия начнёт говорить." };
        }
        if (mood >= 3 && rank < 2) {
            var missing = skillsMissing(nowMs());
            var wanted = rank === 0 ? 4 : 6;
            return { key: "rank", head: rank === 0 ? "До виртуоза" : "До легенды", colour: CYAN, urgent: false,
                     text: "Признаков мастерства сейчас " + (7 - missing.length) + " из 7, нужно " + wanted + ". Не хватает: " + missing.join(", ") + "." };
        }
        if (mood === 2) {
            return { key: "climb2", head: "До космоса", colour: CYAN, urgent: false,
                     text: "Нужна мелодия правой рукой поверх аккордов левой, и чтобы аккорды менялись. Комбо сейчас " + combo + "." };
        }
        if (mood === 1) {
            return { key: "climb1", head: "До огня", colour: LIME, urgent: false,
                     text: "Играй разные ноты в ровном ритме и меняй аккорды: один и тот же аккорд шкалу не сдвинет. Комбо сейчас " + combo + "." };
        }
        var tip = Math.floor(clock / 144) % style.play.length;
        return { key: "play-" + tip, head: "Как играть", text: style.play[tip], colour: WHITE, urgent: false };
    }
    if (clock - taskAt < 120) {
        return { key: "task-" + (progress.coach || 0), head: "Зачем задание", text: coachWhy(), colour: ORANGE, urgent: false };
    }
    if (clock - styleAt < 120) {
        return { key: "style", head: "Как играть", text: style.play[0], colour: WHITE, urgent: false };
    }
    if (clock - moodAt < 120) {
        return { key: "mood", head: lad[0], colour: YELLOW, urgent: false,
                 text: "Лад: " + lad[1] + ". Гамма: " + scaleNames + "."
                     + (lad[4] >= 0 ? " Краска лада: " + ROOT_NAMES[(jam.tonic + lad[4]) % 12] + ". Эта нота отличает его от соседних ладов: задерживайся на ней." : "") };
    }
    if (quiet.lead) {
        pick = quiet[0];
    }
    return { key: pick[0], head: pick[1], text: pick[2], colour: pick[3], urgent: false };
}

// Where the cursor is over the device, and when it last moved there. Max
// tells of every move over the picture and of the cursor leaving it.
var hover = { x: -1, y: -1, at: -1000 };

function onidle(x, y) {
    var was = overAdvice();
    hover = { x: x, y: y, at: clock };
    if (was !== overAdvice()) {
        mgraphics.redraw();
    }
}

function onidleout() {
    var was = overAdvice();
    hover = { x: -1, y: -1, at: -1000 };
    if (was) {
        mgraphics.redraw();
    }
}

// The cursor rests on the advice of free play: the player is reading it. (A
// cursor that has not stirred for a minute is taken to be forgotten there.)
function overAdvice() {
    return inJam() && clock - hover.at < 720 && hover.x >= KX - 4 && hover.x < TASK_X - 8
        && hover.y >= KY + KEY_H + 16 && hover.y < H;
}

// Called on every tick of free play: the advice changes when the moment
// changes, but not more often than a person can read it, and not at all
// while the cursor rests on it.
function counselTick() {
    if (overAdvice() && counsel.key !== "") {
        return;
    }
    if (clock % 144 === 0) {
        counselTurn++;
    }
    if (clock % 6 !== 0 && counsel.key !== "" && tally(recentSour) < 3 && tally(recentTrips) < 3) {
        return;     // thought over twice a second; what is urgent does not wait
    }
    var want = bestAdvice();
    var shown = clock - counsel.since;
    if (want.key === counsel.key) {
        counsel.text = want.text;       // the figures in it may have moved on
        return;
    }
    if (counsel.key === "" || want.urgent || clock < counselPinned || shown >= (counsel.urgent ? 36 : 72)) {
        counsel = { key: want.key, head: want.head, text: want.text, colour: want.colour, since: clock, urgent: want.urgent };
    }
}

var jamHintRaw = "";
var jamHintText = "";
var jamTaskRaw = "";
var jamTaskText = "";

function drawJamHint() {
    var style = STYLES[jam.style];
    var y = KY + KEY_H + 8;
    var x = KX;
    var i;
    var tags = projectTags(project, style);
    for (i = 0; i < tags.length; i++) {
        x += label(tags[i][0], x, y, 1, tags[i][1], LEFT) + TAG_GAP;
    }
    // the advice of the moment
    if (counsel.key === "") {
        counselTick();
    }
    var raw = counsel.head + ": " + counsel.text;
    if (raw !== jamHintRaw) {
        jamHintRaw = raw;
        jamHintText = caps(raw);
    }
    paragraph(jamHintText, KX, y + 12, ADVICE_W, counsel.colour, 4);
    if (overAdvice()) {
        // the advice is held: corners around its field say so
        var left = KX - 5;
        var right = KX + ADVICE_W + 3;
        var top = y + 8;
        var bottom = H - 2;
        var arm = 7;
        px(left, top, arm, 1, WHITE);
        px(left, top, 1, arm, WHITE);
        px(right - arm, top, arm, 1, WHITE);
        px(right - 1, top, 1, arm, WHITE);
        px(left, bottom - 1, arm, 1, WHITE);
        px(left, bottom - arm, 1, arm, WHITE);
        px(right - arm, bottom - 1, arm, 1, WHITE);
        px(right - 1, bottom - arm, 1, arm, WHITE);
    }
    // the task of the coach, in a column of its own
    px(TASK_X - 7, y - 2, 1, H - y - 2, STEEL);
    var task = coachTask();
    var done = progress.coach || 0;
    var lap = Math.floor(done / COACH.length) + 1;
    label("ЗАДАНИЕ " + (done % COACH.length + 1) + "/" + COACH.length + (lap > 1 ? " КРУГ " + lap : ""), TASK_X, y, 1, ORANGE, LEFT);
    label("+" + task[1], TEXT_RIGHT, y, 1, LIME, RIGHT);
    var words = coachText();
    if (words !== jamTaskRaw) {
        jamTaskRaw = words;
        jamTaskText = caps(words);
    }
    paragraph(jamTaskText, TASK_X, y + 12, TASK_W, WHITE, 3);
    // how much of it is done, as a row of cells
    var steps = coachProgress();
    if (steps[1] > 0) {
        var cell = Math.floor(TASK_W / steps[1]);
        for (i = 0; i < steps[1]; i++) {
            px(TASK_X + i * cell, H - 8, cell - 1, 4, i < steps[0] ? ORANGE : STEEL);
        }
    }
}
// The area above the keys: what to do right now.
function drawTarget() {
    var width;
    if (phase === "locked") {
        label("ЗАКРЫТО", KX, 8, 2, RED, LEFT);
        var reason = !groupOpen(current.group)
            ? "СТУПЕНЬ ОТКРОЕТСЯ НА " + GROUPS[current.group].need + " ОЧКАХ. У ТЕБЯ " + progress.points
            : "СНАЧАЛА ПРОЙДИ УРОК: " + GROUPS[current.group].lessons[current.index - 1].title;
        paragraph(reason, KX, 28, TEXT_RIGHT - KX, SLATE, 2);
        return;
    }
    if (phase === "intro") {
        headline(current.title, KX, 5, TEXT_RIGHT - KX, WHITE);
        var status = progress.done[current.id] > 0 ? "ПРОЙДЕН. ЛУЧШИЙ СЧЁТ: " + progress.done[current.id] : "НАЖМИ СТАРТ ИЛИ ЛЮБУЮ КЛАВИШУ";
        if (current.gen) {
            var runs = (progress.done[current.id] > 0 ? 1 : 0) + (progress.reps[current.id] || 0);
            status = runs > 0 ? "ПРОЙДЕНА РАЗ: " + runs + ". ЗА КАЖДЫЙ ПОВТОР +" + REPEAT_PAY + " ОЧКОВ" : "КАЖДЫЙ РАЗ НОВОЕ ЗАДАНИЕ. НАЖМИ СТАРТ";
        }
        label(status, KX, 33, 1, clock % 12 < 8 ? YELLOW : ORANGE, LEFT);
        return;
    }
    if (phase === "done") {
        label("УРОК ПРОЙДЕН!", KX, 5, 2, clock % 8 < 4 ? LIME : YELLOW, LEFT);
        label("+" + reward.gain + " ОЧКОВ", TEXT_RIGHT, 5, 2, YELLOW, RIGHT);
        label(reward.lines.join("   "), KX, 24, 1, SILVER, LEFT);
        label(reward.gain === 0 && reward.best > 0 ? "ЛУЧШИЙ СЧЁТ " + reward.best + " НЕ ПОБИТ"
              : (reward.opened.length > 0 ? "ОТКРЫТО: " + reward.opened[0] : ""), KX, 35, 1, CYAN, LEFT);
        return;
    }
    if (current.kind === "free") {
        drawFreePlay();
        return;
    }
    var s = steps[step];
    width = headline(s.label, KX, 5, s.sub ? 170 : TEXT_RIGHT - KX - 120, achieved ? LIME : (wrong ? RED : WHITE));
    if (s.sub) {
        label(s.sub, KX + width + 10, 6, 1, WHITE, LEFT);
    }
    if (s.sub2) {
        label(s.sub2, KX + width + 10, 17, 1, SLATE, LEFT);
    }
    if (achieved) {
        label(s.hold ? "ВЕРНО! ДАЛЬШЕ" : "ВЕРНО! ОТПУСТИ", TEXT_RIGHT, 6, 1, LIME, RIGHT);
    } else if (wrong) {
        label(s.drums ? "НЕ ТОТ ПЭД" : "ЕСТЬ ЛИШНЯЯ НОТА", TEXT_RIGHT, 6, 1, RED, RIGHT);
    } else if (s.manual || (s.live && typeof LiveAPI === "undefined")) {
        label("СДЕЛАЛ? ЖМИ ГОТОВО", TEXT_RIGHT, 6, 1, YELLOW, RIGHT);
    } else if (s.live) {
        label("ЖДУ ABLETON...", TEXT_RIGHT, 6, 1, CYAN, RIGHT);
    } else if (s.bass >= 0 && !s.hold && held.length > 0 && matchStep(s) === 0
               && unique(held.map(function (p) { return p % 12; })).length === s.pcs.length) {
        label("ВНИЗУ ДОЛЖНА БЫТЬ " + NOTE_NAMES[s.bass], TEXT_RIGHT, 6, 1, YELLOW, RIGHT);
    }
    var even = current.rhythm ? evenness() : -1;
    if (even >= 0) {
        label("РОВНОСТЬ " + even + "%  ТЕМП " + tempoPlayed(), TEXT_RIGHT, 17, 1, even >= 85 ? LIME : SLATE, RIGHT);
    }
    var upcoming = [];
    for (var i = step + 1; i < steps.length && upcoming.length < 4; i++) {
        if (!steps[i].drums && steps[i].label.length < 8) {
            upcoming.push(steps[i].label);
        }
    }
    if (upcoming.length > 0 && current.kind !== "tour") {
        label("ДАЛЬШЕ: " + upcoming.join(" → "), KX, 33, 1, SLATE, LEFT);
    }
}

// The area under the keys: why, how, and the Ableton task.
function drawHint() {
    var y = KY + KEY_H + 8;
    var width = TEXT_RIGHT - KX;
    if (inJam()) {
        drawJamHint();
        return;
    }
    if (phase === "intro" || phase === "locked") {
        y = paragraph("ЗАЧЕМ: " + current.why, KX, y, width, SILVER, 3) + 2;
        paragraph("КАК: " + current.hint, KX, y, width, SLATE, 2);
    } else if (phase === "done") {
        var missing = nextStageNeeds();
        paragraph(current.task || (nextLesson() ? "ЖМИ ДАЛЬШЕ, ЧТОБЫ ПЕРЕЙТИ К СЛЕДУЮЩЕМУ УРОКУ. ЗАНОВО, ЧТОБЫ ПОБИТЬ СВОЙ СЧЁТ."
                  : (missing > 0 ? "СТУПЕНЬ ПРОЙДЕНА. СЛЕДУЮЩЕЙ НЕ ХВАТАЕТ " + missing + " ОЧКОВ: ПОВТОРИ УРОКИ БЕЗ ОШИБОК ИЛИ ЗАГЛЯНИ В ТРЕНИРОВКИ."
                                 : "ЭТО БЫЛ ПОСЛЕДНИЙ УРОК ПУТИ. ТЫ ПРОШЁЛ ВСЁ!")),
                  KX, y, width, YELLOW, 5);
    } else {
        var s = steps[step];
        paragraph(s && s.text ? s.text : current.hint, KX, y, width, SILVER, 5);
    }
}

// A button is a frame, a face and a shadow strip that do not overlap; its
// caption goes on top in a later layer.
function buttonBody(rect, bright) {
    var x = rect[0], y = rect[1], w = rect[2], h = rect[3];
    px(x, y, w, 1, bright ? YELLOW : SLATE);
    px(x, y + h - 1, w, 1, bright ? YELLOW : SLATE);
    px(x, y + 1, 1, h - 2, bright ? YELLOW : SLATE);
    px(x + w - 1, y + 1, 1, h - 2, bright ? YELLOW : SLATE);
    px(x + 1, y + 1, w - 2, h - 4, STEEL);
    px(x + 1, y + h - 3, w - 2, 2, NIGHT);
}

function buttonCaption(rect, text, enabled) {
    label(text, rect[0] + rect[2] / 2, rect[1] + Math.floor((rect[3] - 9) / 2), 1, enabled ? WHITE : SLATE, CENTER);
}

function legend(colour, text, x, y) {
    px(x, y, 7, 7, colour);
    label(text, x + 11, y, 1, SLATE, LEFT);
}

// The panel of free play: the style, the mood, three buttons, the passport
// of the scale and what the colours mean.
function drawJamPanel() {
    var style = STYLES[jam.style];
    var mood = MOODS[jam.mood];
    var names = ["groupPrev", "groupNext", "prev", "next", "main", "restart", "free"];
    var i;
    for (i = 0; i < names.length; i++) {
        buttonBody(BUTTONS[names[i]], false);
    }
    flush();
    buttonCaption(BUTTONS.groupPrev, "<", true);
    buttonCaption(BUTTONS.groupNext, ">", true);
    buttonCaption(BUTTONS.prev, "<", true);
    buttonCaption(BUTTONS.next, ">", true);
    buttonCaption(BUTTONS.main, "ГАММА", true);
    buttonCaption(BUTTONS.restart, "АККОРД", true);
    buttonCaption(BUTTONS.free, "УРОКИ", true);

    label("СТИЛЬ " + (jam.style + 1) + "/" + STYLES.length, PX + PW / 2, 4, 1, SLATE, CENTER);
    label(caps(style.name), PX + PW / 2, 13, 1, YELLOW, CENTER);
    label("НАСТРОЕНИЕ " + (jam.mood + 1) + "/" + MOODS.length, PX + PW / 2, 36, 1, SLATE, CENTER);
    var lines = wrap(caps(mood[0] + ": " + mood[1]), PW);
    for (i = 0; i < lines.length && i < 2; i++) {
        label(lines[i], PX, 51 + i * 10, 1, WHITE, LEFT);
    }

    var scale = [];
    for (i = 0; i < mood[3].length; i++) {
        scale.push(ROOT_NAMES[(jam.tonic + mood[3][i]) % 12]);
    }
    label("ГАММА: " + scale.join(" "), PX, 96, 1, SKY, LEFT);
    label("ТЕМП СТИЛЯ: " + style.tempo[0] + "-" + style.tempo[1], PX, 107, 1, SLATE, LEFT);
    label("ТОНИКА: ЩЁЛКНИ НОТУ НА КРУГЕ", PX, 118, 1, SLATE, LEFT);

    legend(LIME, "ОПОРНЫЕ", PX, 137);
    legend(SKY, "ГАММА", PX + 58, 137);
    legend(YELLOW, "КРАСКА", PX + 116, 137);
    legend(STEEL, "МИМО", PX, 149);
    legend(CYAN, "КУДА ИДТИ", PX + 42, 149);
    legend(ORANGE, "ЗАДАНИЕ", PX + 112, 149);
    label("ВЕРСИЯ " + VERSION, PX + PW, 160, 1, SLATE, RIGHT);
}

function drawPanel() {
    if (inJam()) {
        drawJamPanel();
        return;
    }
    var group = GROUPS[current.group];
    var action = mainAction();
    var canRestart = phase === "run" && current.kind !== "free" || phase === "done";
    buttonBody(BUTTONS.groupPrev, false);
    buttonBody(BUTTONS.groupNext, false);
    buttonBody(BUTTONS.prev, false);
    buttonBody(BUTTONS.next, false);
    buttonBody(BUTTONS.main, action !== "" && action !== "ПОСЛУШАТЬ" && clock % 12 < 8);
    buttonBody(BUTTONS.restart, false);
    buttonBody(BUTTONS.free, false);
    flush();
    buttonCaption(BUTTONS.free, "СВОБОДНО", true);
    buttonCaption(BUTTONS.groupPrev, "<", current.group > 0);
    buttonCaption(BUTTONS.groupNext, ">", current.group < GROUPS.length - 1);
    buttonCaption(BUTTONS.prev, "<", current.index > 0);
    buttonCaption(BUTTONS.next, ">", current.index < group.lessons.length - 1);
    buttonCaption(BUTTONS.main, action === "" ? "-" : action, action !== "");
    buttonCaption(BUTTONS.restart, "ЗАНОВО", canRestart);

    label("СТУПЕНЬ " + (current.group + 1) + "/" + GROUPS.length, PX + PW / 2, 4, 1, SLATE, CENTER);
    label(group.title, PX + PW / 2, 13, 1, groupOpen(current.group) ? YELLOW : RED, CENTER);
    label("УРОК " + (current.index + 1) + "/" + group.lessons.length, PX + PW / 2, 36, 1, SLATE, CENTER);
    var lines = wrap(current.title, PW);
    for (var n = 0; n < lines.length && n < 2; n++) {
        label(lines[n], PX, 51 + n * 10, 1, phase === "locked" ? SLATE : WHITE, LEFT);
    }

    // One block per step: done, current, still ahead.
    if (steps.length > 0 && phase !== "locked") {
        var total = steps.length;
        var done = phase === "done" ? total : (phase === "intro" ? 0 : step);
        var blockW = Math.max(3, Math.min(12, Math.floor(PW / total)));
        for (var i = 0; i < total; i++) {
            var colour = i < done ? LIME : (i === done && phase === "run" ? (clock % 8 < 4 ? YELLOW : ORANGE) : STEEL);
            px(PX + i * blockW, 96, blockW - 1, 6, colour);
        }
    }
    if (phase === "run" && current.kind !== "free") {
        label("ШАГ " + (step + 1) + "/" + steps.length + "  ОШИБОК: " + mistakes, PX, 105, 1, SLATE, LEFT);
    } else if (phase === "intro") {
        var prize = current.pts || Math.max(50, steps.length * 10);
        label("НАГРАДА: ДО " + Math.round(prize * (current.rhythm ? 1.8 : 1.5)) + " ОЧКОВ", PX, 105, 1, YELLOW, LEFT);
    }

    // The whole path as one line: what is behind, and where this lesson stands.
    label("ПУТЬ: " + pathDone + " ИЗ " + pathTotal + " УРОКОВ", PX, 118, 1, SLATE, LEFT);
    var passed = Math.round(PW * pathDone / pathTotal);
    if (passed > 0) {
        px(PX, 128, passed, 3, LIME);
    }
    if (passed < PW) {
        px(PX + passed, 128, PW - passed, 3, STEEL);
    }
    px(PX + Math.round((PW - 3) * current.place / Math.max(1, LESSONS.length - 1)), 131, 3, 2, YELLOW);

    legend(ORANGE, "МАЖОР", PX, 137);
    legend(GREEN, "МИНОР", PX + 58, 137);
    legend(STEEL, "ЧУЖИЕ", PX + 116, 137);
    legend(SKY, "НАЖАТЬ", PX, 149);
    legend(LIME, "ВЕРНО", PX + 58, 149);
    legend(RED, "ЛИШНЯЯ", PX + 116, 149);
    label("ВЕРСИЯ " + VERSION, PX + PW, 160, 1, SLATE, RIGHT);
}

var STARS = [[12, 10], [38, 22], [61, 8], [84, 30], [104, 14], [128, 26], [22, 44], [70, 50], [118, 52], [138, 70], [8, 76], [50, 84]];
var DANCE_FLOOR = [NAVY, PLUM, TEAL, BLUE];
var FIRE_FLOOR = [RED, ORANGE, YELLOW, LIME, SKY, PLUM];
var EYES = [[30, 30], [104, 24], [68, 58]];
var NOTE_SHAPE = [3, 0, 1, 3, 1, 2, 3, 2, 1, 3, 3, 1, 1, 4, 3, 0, 5, 4, 1, 6, 2]; // x, y, width

// Colours of the scenery for every mood: sky, far band, near band.
function scenery() {
    if (mood === 2) {
        return clock % 8 < 4 ? [NAVY, BLUE, PLUM] : [PLUM, NAVY, BLUE];
    }
    if (mood === 1) {
        return [NIGHT, NAVY, BLUE];
    }
    if (mood === -1) {
        return [INK, NIGHT, STEEL];
    }
    if (mood === -2) {
        return flash === 2 ? [SLATE, STEEL, STEEL] : [INK, NIGHT, NIGHT];
    }
    return [NIGHT, STEEL, NAVY];
}

// The sky of the top mood: slow rainbow plasma in 6x6 blocks.
function drawPlasma(top, bottom) {
    var cell = 6;
    var time = clock * 0.18;
    var columns = Math.ceil(SW / cell);
    for (var y = top; y < bottom; y += cell) {
        var runStart = 0;
        var runColour = -1;
        for (var i = 0; i <= columns; i++) {
            var colour = -1;
            if (i < columns) {
                var x = i * cell;
                var dx = x - SW / 2;
                var dy = y - (SY + 60);
                var value = Math.sin(x / 17 + time) + Math.sin(y / 11 - time * 1.3)
                          + Math.sin(Math.sqrt(dx * dx + dy * dy) / 9 - time * 2);
                colour = RAINBOW[Math.floor((value + 3) * 2 + clock / 3) % RAINBOW.length];
            }
            if (colour !== runColour) {
                if (runColour >= 0) {
                    var left = SX + runStart * cell;
                    px(left, y, Math.min(SX + SW, SX + i * cell) - left, Math.min(cell, bottom - y), runColour);
                }
                runStart = i;
                runColour = colour;
            }
        }
    }
}

// One dancer: calm loop, dance moves, or frozen and shaking. Returns its x.
// The beat the dancers move to: the player's pulse, doubled or halved into a
// comfortable jumping speed. 0 when the player keeps no steady pulse.
function danceBeat() {
    if (pulse <= 0) {
        return 0;
    }
    var beat = pulse;
    while (beat < 350) {
        beat *= 2;
    }
    while (beat > 900) {
        beat /= 2;
    }
    return beat;
}

function drawDancer(sprite, x, shift, from, to, calmFrame, side, echo) {
    var since = clock - moodClock - echo * 3;
    var frame = (clock + shift) % sprite.runs.length;
    var base = sprite.base;
    var dx = 0;
    var flip = false;
    if (mood >= 1) {
        var beat = danceBeat();
        var swing = since * Math.PI / 8;
        if (beat > 0) {
            // One jump per beat, starting again on every note the player
            // hits; the sway takes two beats.
            var time = nowMs() - echo * 90;
            frame = from + Math.floor((((time - onsetMs) % beat) + beat) % beat / beat * (to - from));
            swing = (time - moodMs) / beat * Math.PI;
        } else {
            frame = from + Math.floor(Math.max(0, since) * (mood >= 2 ? 1.5 : 1)) % (to - from);
        }
        dx = Math.round(Math.sin(swing) * (2 + mood * 4)) * side;
        flip = Math.cos(swing) * side < 0;
        if (mood >= 2) {
            base = sprite.disco[(Math.floor(clock / 2) + echo * 2) % sprite.disco.length];
        }
    } else if (mood <= -1) {
        frame = calmFrame;
        dx = (clock % 2 === 0 ? 1 : -1) * (mood === -2 ? 2 : 1);
        base = sprite.sick;
    }
    drawSprite(sprite, frame, x + dx, GROUND + 1, base, flip);
    return x + dx;
}

function drawEye(x, y, index) {
    var blink = (clock + index * 9) % 40 < 3;
    if (blink) {
        px(x - 4, y, 9, 1, WHITE);
        return;
    }
    px(x - 2, y - 2, 5, 1, WHITE);
    px(x - 3, y - 1, 7, 1, WHITE);
    px(x - 4, y, 9, 1, WHITE);
    px(x - 3, y + 1, 7, 1, WHITE);
    px(x - 2, y + 2, 5, 1, WHITE);
}

function drawPupil(x, y, index) {
    if ((clock + index * 9) % 40 < 3) {
        return;
    }
    var look = Math.round(Math.sin((clock + index * 20) / 7) * 2);
    px(x - 1 + look, y - 1, 3, 3, RAINBOW[(clock + index * 4) % RAINBOW.length]);
}

// ------------------------------------------------- the scenery of free play

// Every style of free play has a stage of its own. A scene is drawn in the
// coordinates of the stage (0, 0 is its top left corner, G is the ground the
// dancers stand on) and grows livelier with the level: 0 = nobody plays,
// 1 = it dances, 2 = it burns, 3 = the top. Colours are painted in the order
// of the palette, not in the order of the calls, so a scene says flush()
// wherever a later shape has to cover an earlier one.

var G = SH - 18;

// The dancers of free play are drawn larger than they are measured: every
// rectangle grows away from the spot on the ground where the dancer stands.
var zoom = 1;
var zoomX = 0;

// A rectangle of the scene, cut off at the edges of the stage.
function box(x, y, w, h, colour) {
    if (zoom !== 1) {
        x = zoomX + (x - zoomX) * zoom;
        y = G + (y - G) * zoom;
        w *= zoom;
        h *= zoom;
    }
    var left = Math.max(0, Math.round(x));
    var top = Math.max(0, Math.round(y));
    var right = Math.min(SW, Math.round(x + w));
    var bottom = Math.min(SH, Math.round(y + h));
    if (right > left && bottom > top) {
        px(SX + left, SY + top, right - left, bottom - top, colour);
    }
}

// A filled circle, as rows two pixels high.
function disc(cx, cy, r, colour) {
    for (var dy = -r; dy < r; dy += 2) {
        var half = Math.round(Math.sqrt(r * r - (dy + 1) * (dy + 1)));
        box(cx - half, cy + dy, half * 2, 2, colour);
    }
}

// A straight line from one height to another, as a staircase of runs: tall
// thin ones for a steep line, flat ones a pixel high for a shallow line.
function ray(x0, y0, x1, y1, colour) {
    var rise = Math.abs(y1 - y0);
    var tall = Math.abs(x1 - x0) > rise ? 1 : 4;
    var steps = Math.max(1, Math.ceil(rise / tall));
    for (var i = 0; i < steps; i++) {
        var xa = x0 + (x1 - x0) * i / steps;
        var xb = x0 + (x1 - x0) * (i + 1) / steps;
        var ya = y0 + (y1 - y0) * i / steps;
        var yb = y0 + (y1 - y0) * (i + 1) / steps;
        var left = Math.min(xa, xb);
        if (left < SW && left + Math.abs(xb - xa) + 1 > 0) {
            box(left, Math.min(ya, yb), Math.abs(xb - xa) + 1, Math.abs(yb - ya) + (tall > 1 ? 1 : 0), colour);
        }
    }
}

// A line in any direction, as a chain of small squares.
function line(x0, y0, x1, y1, colour, thick) {
    var steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / thick));
    for (var i = 0; i <= steps; i++) {
        box(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, thick, thick, colour);
    }
}

// A ring of small squares; "squash" flattens it into an ellipse.
function ring(cx, cy, r, count, colour, squash) {
    for (var i = 0; i < count; i++) {
        var a = Math.PI * 2 * i / count;
        box(cx + Math.cos(a) * r - 1, cy + Math.sin(a) * r * (squash || 1) - 1, 2, 2, colour);
    }
}

// A value brought into the range from 0 up to size, whichever way it runs.
function wrapTo(value, size) {
    return ((value % size) + size) % size;
}

// The same number for the same n, different for different n: where a star,
// a window or a spark goes.
function hash(n) {
    return ((n * 7919 + 104729) % 9973 + 9973) % 9973;
}

// Stars that come and go, in the upper part of the sky.
function twinkle(count, bottom, colour) {
    for (var i = 0; i < count; i++) {
        if ((clock + i * 7) % 26 < 19) {
            box(hash(i) % (SW - 4) + 2, hash(i * 5) % bottom + 2, 1, 1, colour);
        }
    }
}

// A dance floor of tiles that step on every note the player hits.
function tiles(colours, level) {
    var beat = beats + (level === 3 ? clock : 0);
    for (var x = 0; x < SW; x += 12) {
        box(x, G + 2, 12, 6, colours[(x / 12 + beat) % colours.length]);
        box(x, G + 8, 12, 10, colours[(x / 12 + beat + 2) % colours.length]);
    }
}

var SCENES = {
    // A concert hall: curtains, a chandelier with candles, the boards.
    classic: function (level) {
        var i, x;
        box(0, 0, SW, G, NIGHT);
        box(0, G, SW, SH - G, ORANGE_DIM);
        flush();
        for (x = 9; x < SW; x += 18) {
            box(x, G + 2, 1, SH - G, INK);
        }
        box(0, G, SW, 2, YELLOW);
        var sway = Math.round(Math.sin(clock / 14) * 2);
        for (i = 0; i < 5; i++) {
            var fall = 100 - i * 13 + (i % 2) * sway;
            box(i * 6, 9, 6, fall, i % 2 ? RED : ORANGE_DIM);
            box(SW - 6 - i * 6, 9, 6, fall, i % 2 ? RED : ORANGE_DIM);
        }
        box(0, 0, SW, 9, RED);
        for (x = 0; x < SW; x += 12) {
            box(x + 2, 9, 8, 3, RED);
        }
        box(72, 9, 2, 12, SLATE);
        box(53, 21, 40, 2, YELLOW);
        box(61, 23, 24, 2, YELLOW);
        for (i = -2; i <= 2; i++) {
            var flick = (clock + i * 3) % 5 < 2 ? 1 : 0;
            box(72 + i * 9, 15, 2, 6, WHITE);
            box(72 + i * 9, 11 + flick, 2, 4 - flick, flick ? ORANGE : YELLOW);
        }
        if (level >= 1) {
            for (i = 0; i < 6 + level * 5; i++) {
                if ((clock + i * 5) % 9 < 5) {
                    box(34 + hash(i) % 78, 26 + hash(i * 3 + Math.floor(clock / 9)) % 46, 1, 1, i % 2 ? YELLOW : WHITE);
                }
            }
        }
        if (level >= 2) {
            ray(36, 9, 42 + Math.sin(clock / 6) * 8, G, SILVER);
            ray(110, 9, 108 - Math.sin(clock / 6) * 8, G, SILVER);
        }
        if (level === 3) {
            for (i = 0; i < 14; i++) {
                box(32 + hash(i * 11) % 82, (hash(i) + clock * 4) % G, 1, 3, YELLOW);
            }
        }
    },

    // A room at night: rain on the window, a lamp, a record that turns.
    lofi: function (level) {
        var i;
        box(0, 0, SW, G, NIGHT);
        box(0, G, SW, SH - G, PLUM);
        box(78, 14, 56, 62, NAVY);
        for (i = 0; i < 8 + level * 5; i++) {
            box(79 + hash(i) % 54, 15 + (hash(i * 3) + clock * (3 + level)) % 56, 1, 4, SKY);
        }
        flush();
        box(76, 12, 60, 2, SLATE);
        box(76, 76, 60, 3, SLATE);
        box(76, 12, 2, 66, SLATE);
        box(134, 12, 2, 66, SLATE);
        box(105, 14, 2, 62, SLATE);
        box(78, 44, 56, 2, SLATE);
        box(18, 58, 2, G - 58, SLATE);
        box(12, 136, 14, 3, SLATE);
        box(14, 40, 10, 3, YELLOW);
        box(12, 43, 14, 3, YELLOW);
        box(10, 46, 18, 4, YELLOW);
        box(40, 100, 32, 2, SLATE);
        box(42, 88, 4, 12, RED);
        box(47, 90, 4, 10, TEAL);
        box(52, 86, 4, 14, ORANGE);
        box(62, 93, 7, 7, ORANGE_DIM);
        box(60, 84, 3, 9, GREEN);
        box(64, 81, 3, 12, GREEN);
        box(68, 86, 3, 7, GREEN);
        box(84, 124, 44, 3, SLATE);
        box(88, 127, 2, 14, SLATE);
        box(122, 127, 2, 14, SLATE);
        disc(106, 112, 12, STEEL);
        disc(106, 112, 4, ORANGE);
        var turn = clock * (0.15 + level * 0.1);
        box(105 + Math.cos(turn) * 8, 111 + Math.sin(turn) * 8, 2, 2, WHITE);
        if (level >= 1) {
            var lights = [YELLOW, CYAN, LIME, ORANGE];
            for (i = 0; i < 12; i++) {
                var lit = level >= 2 || (i + Math.floor(clock / 5)) % 3 === 0;
                box(4 + i * 12, 4 + (i % 2) * 3, 2, 2, lit ? lights[(i + Math.floor(clock / (7 - level))) % 4] : STEEL);
            }
        }
        if (level === 3) {
            for (i = 0; i < 9; i++) {
                box(8 + hash(i * 7) % 60, 60 - (hash(i) + clock * 2) % 50, 2, 2, RAINBOW[(i + Math.floor(clock / 3)) % 12]);
            }
        }
    },

    // Northern lights over mountains and still water.
    ambient: function (level) {
        var i, x, b;
        box(0, 0, SW, G, NIGHT);
        box(0, G, SW, SH - G, NAVY);
        flush();
        twinkle(16, 110, WHITE);
        for (b = 0; b <= Math.min(2, level); b++) {
            for (x = 0; x < SW; x += 4) {
                var top = 14 + b * 30 + Math.sin(x / 19 + clock / (18 - level * 3) + b * 2) * 7;
                var tall = 16 + Math.sin(x / 11 - clock / 23 + b) * 6;
                box(x, top, 4, 2, level >= 2 ? LIME : GREEN);
                box(x, top + 2, 4, tall * 0.4, GREEN);
                box(x, top + 2 + tall * 0.4, 4, tall * 0.6, TEAL);
            }
        }
        flush();
        var peaks = [[26, 34], [78, 48], [124, 30]];
        for (i = 0; i < peaks.length; i++) {
            for (var r = 0; r < peaks[i][1]; r += 2) {
                box(peaks[i][0] - r * 0.9, G - peaks[i][1] + r, r * 1.8 + 2, 2, INK);
            }
        }
        for (i = 0; i < 7; i++) {
            box((hash(i) + Math.floor(clock / 3) * (i % 2 ? 1 : -1)) % (SW - 30) + 4, G + 3 + i * 2, 14 + hash(i * 3) % 14, 1, i % 2 ? TEAL : GREEN_DIM);
        }
        if (level === 3) {
            var fall = (clock * 5) % 220;
            box(SW - fall, fall * 0.4, 7, 1, WHITE);
            for (i = 0; i < 10; i++) {
                box(hash(i * 13) % SW, 10 + (hash(i) + clock) % 90, 1, 1, CYAN);
            }
        }
    },

    // A striped sun going down behind a grid that runs towards the player.
    synthwave: function (level) {
        var i;
        var horizon = 100;
        box(0, 0, SW, 52, NIGHT);
        box(0, 52, SW, horizon - 52, PLUM);
        box(0, horizon, SW, SH - horizon, INK);
        flush();
        twinkle(12, 46, WHITE);
        var size = 30 + (level === 3 && clock % 6 < 3 ? 2 : 0);
        for (var dy = -size; dy < 20; dy += 2) {
            var half = Math.round(Math.sqrt(size * size - dy * dy));
            var gap = dy > -8 && (dy + 60 + Math.floor(clock / 3)) % 8 < 2 + (dy + 8) / 9;
            if (!gap) {
                box(73 - half, 80 + dy, half * 2, 2, dy < -14 ? YELLOW : (dy < 2 ? ORANGE : RED));
            }
        }
        var speed = (clock * (1 + level)) % 8 / 8;
        for (i = 0; i < 8; i++) {
            var far = (i + speed) / 8;
            box(0, horizon + far * far * (SH - horizon), SW, 1, level >= 2 ? CYAN : SKY);
        }
        for (i = -7; i <= 7; i++) {
            ray(73 + i * 5, horizon, 73 + i * 34, SH, level >= 2 ? CYAN : SKY);
        }
        if (level >= 2) {
            box(SW - (clock * 6) % 260, 8 + (clock * 2) % 30, 8, 1, WHITE);
        }
    },

    // A club: the mirror ball throws spots of light on the walls.
    house: function (level) {
        var i;
        box(0, 0, SW, G, NIGHT);
        box(0, G, SW, 2, WHITE);
        tiles(level >= 2 ? FIRE_FLOOR : DANCE_FLOOR, level);
        flush();
        var spots = [WHITE, CYAN, YELLOW, RAINBOW[10], LIME];
        for (i = 0; i < 8 + level * 6; i++) {
            var angle = i * 2.4 + clock * (0.04 + level * 0.03);
            box(73 + Math.cos(angle) * (22 + (i * 13) % 48), 70 + Math.sin(angle * 0.7 + i) * 52, 3, 3, spots[i % spots.length]);
        }
        box(2, 96, 18, 44, STEEL);
        box(126, 96, 18, 44, STEEL);
        var pump = level >= 1 && clock % 6 < 2 ? 1 : 0;
        disc(11, 110, 5 + pump, SLATE);
        disc(11, 128, 6 + pump, SLATE);
        disc(135, 110, 5 + pump, SLATE);
        disc(135, 128, 6 + pump, SLATE);
        box(72, 0, 2, 12, SLATE);
        for (var gy = -4; gy <= 4; gy++) {
            for (var gx = -4; gx <= 4; gx++) {
                if (gx * gx + gy * gy <= 18) {
                    var lit = ((gx * 3 + gy * 5 + Math.floor(clock / 2)) % 7 + 7) % 7;
                    box(72 + gx * 3, 24 + gy * 3, 3, 3, lit === 0 ? WHITE : (lit < 3 ? SILVER : SLATE));
                }
            }
        }
        if (level === 3) {
            for (i = 0; i < 6; i++) {
                ray(73, 38, 73 + Math.sin(clock / 7 + i * 1.05) * 70, G, RAINBOW[(i * 2 + Math.floor(clock / 4)) % 12]);
            }
        }
    },

    // A warehouse: bare pillars, tubes of light firing in turn, a red laser.
    techno: function (level) {
        var i;
        var flashing = level === 3 && clock % 12 === 0;
        box(0, 0, SW, G, flashing ? STEEL : INK);
        box(0, G, SW, SH - G, NIGHT);
        flush();
        box(8, 0, 10, G, NIGHT);
        box(128, 0, 10, G, NIGHT);
        box(0, 18, SW, 4, NIGHT);
        for (i = 0; i < SW; i += 8) {
            box(i, 19, 4, 2, STEEL);
        }
        var pace = Math.max(1, 4 - level);
        for (i = 0; i < 6; i++) {
            var on = level >= 1 && Math.floor(clock / pace) % 6 === i;
            box(30 + i * 17, 30, 3, 66, on ? WHITE : STEEL);
        }
        box(50, 104, 46, 34, NIGHT);
        var kick = level >= 1 && clock % 6 < 2 ? 2 : 0;
        disc(62, 121, 8 + kick, SLATE);
        disc(84, 121, 8 + kick, SLATE);
        var sweep = Math.abs((clock * (2 + level)) % 160 - 80);
        box(18, 34 + sweep, 110, 1, RED);
        if (level >= 2) {
            box(18, 114 - sweep, 110, 1, LIME);
            for (i = 0; i < 5; i++) {
                ray(73, 22, 73 + Math.sin(clock / 5 + i * 1.3) * 66, G, RED);
            }
        }
        for (i = 0; i < SW; i += 14) {
            box(i + 5, G + 6, 6, 1, STEEL);
        }
    },

    // A big stage in the open: rings rise from the horizon, lasers fan out.
    trance: function (level) {
        var i, k;
        box(0, 0, SW, G, NIGHT);
        box(0, G, SW, SH - G, INK);
        flush();
        twinkle(14, 60, WHITE);
        var rings = [BLUE, SKY, CYAN];
        for (k = 0; k < 3 + level; k++) {
            var radius = (clock * (1 + level * 0.5) + k * 24) % 96;
            for (i = 0; i <= 16; i++) {
                var arc = Math.PI * i / 16;
                box(73 + Math.cos(arc) * radius - 1, G - Math.sin(arc) * radius * 0.8 - 1, 2, 2, rings[k % 3]);
            }
        }
        for (i = 0; i < 3 + level * 2; i++) {
            ray(73, 6, 73 + Math.sin(clock / 9 + i * 0.9) * 90, G, i % 2 ? LIME : CYAN);
        }
        box(0, 0, SW, 5, STEEL);
        for (i = 10; i < SW; i += 21) {
            box(i, 5, 6, 4, SLATE);
        }
        if (level === 3) {
            for (i = 0; i < 12; i++) {
                box(hash(i * 17) % SW, G - (hash(i) + clock * 7) % G, 1, 6, WHITE);
            }
        }
        flush();
        for (i = 2; i < SW; i += 9) {
            var hands = 5 + hash(i) % 5 + (level >= 1 && (i / 9 + Math.floor(clock / 3)) % 2 < 1 ? 3 : 0);
            box(i, G - hands, 5, hands, INK);
            box(i + 1, G - hands - 3, 2, 3, INK);
        }
    },

    // A kaleidoscope: rings, rays and squares within squares, in every hue.
    psy: function (level) {
        var cell = 6;
        var hues = level >= 2 ? RAINBOW : DEEP;
        var columns = Math.ceil(SW / cell);
        var time = clock * (0.12 + level * 0.06);
        for (var y = 0; y < G; y += cell) {
            var runStart = 0;
            var runColour = -1;
            for (var i = 0; i <= columns; i++) {
                var colour = -1;
                if (i < columns) {
                    var ax = Math.abs(i * cell + 3 - 73);
                    var ay = Math.abs(y + 3 - 66);
                    var value = Math.sin(Math.sqrt(ax * ax + ay * ay) / 7 - time * 2) + Math.sin(Math.atan2(ay, ax) * 6 + time)
                              + ((((ax + clock) >> 3) & (ay >> 3) & 3) === 0 ? 1.5 : 0);
                    colour = hues[Math.floor((value + 3) * 2 + clock / 4) % 12];
                }
                if (colour !== runColour) {
                    if (runColour >= 0) {
                        box(runStart * cell, y, (i - runStart) * cell, cell, runColour);
                    }
                    runStart = i;
                    runColour = colour;
                }
            }
        }
        tiles(level >= 1 ? RAINBOW : DEEP, level);
        flush();
        var shrooms = [[16, 14, RED], [130, 18, RAINBOW[9]], [70, 9, ORANGE]];
        for (i = 0; i < shrooms.length; i++) {
            var grow = level >= 2 ? Math.round(Math.sin(clock / 4 + i) * 2) : 0;
            var tall = shrooms[i][1] + grow;
            box(shrooms[i][0] - 2, G - tall, 4, tall, WHITE);
            box(shrooms[i][0] - 8, G - tall - 5, 16, 5, shrooms[i][2]);
            box(shrooms[i][0] - 5, G - tall - 8, 10, 3, shrooms[i][2]);
        }
        if (level >= 1) {
            for (i = 0; i < EYES.length; i++) {
                drawEye(SX + EYES[i][0], SY + EYES[i][1], i);
            }
            flush();
            for (i = 0; i < EYES.length; i++) {
                drawPupil(SX + EYES[i][0], SY + EYES[i][1], i);
            }
        }
    },

    // A clearing in the jungle: a fire, two totems, the moon.
    tribal: function (level) {
        var i, k;
        box(0, 0, SW, G, NIGHT);
        box(0, G, SW, SH - G, ORANGE_DIM);
        flush();
        twinkle(10, 70, WHITE);
        disc(116, 26, 10, SILVER);
        box(112, 22, 3, 3, WHITE);
        box(119, 29, 2, 2, WHITE);
        for (i = 0; i < 6; i++) {
            box(i * 7, 0, 7, 14 - i * 2 + (i % 2) * 3, GREEN_DIM);
            box(SW - 7 - i * 7, 0, 7, 12 - i * 2 + (i % 2) * 4, GREEN_DIM);
        }
        for (k = 0; k < 4; k++) {
            box(4, 62 + k * 20, 14, 18, ORANGE_DIM);
            box(128, 62 + k * 20, 14, 18, ORANGE_DIM);
        }
        for (i = -5; i <= 5; i++) {
            var high = (24 + level * 9) * (1 - Math.abs(i) / 7) + hash(i * 3 + Math.floor(clock / 2)) % 9;
            box(71 + i * 4, G - high, 4, high, RED);
            box(72 + i * 4, G - high * 0.65, 3, high * 0.65, ORANGE);
            box(72 + i * 4, G - high * 0.33, 2, high * 0.33, YELLOW);
        }
        for (i = 0; i < 5 + level * 5; i++) {
            box(73 + hash(i) % 40 - 20 + Math.sin(clock / 5 + i) * 3, G - 30 - (hash(i * 7) + clock * 2) % 72, 1, 1 + i % 2, i % 2 ? YELLOW : ORANGE);
        }
        flush();
        box(56, G - 3, 34, 4, INK);
        var glow = level >= 2 && clock % 8 < 4 ? CYAN : WHITE;
        for (k = 0; k < 4; k++) {
            for (i = 0; i < 2; i++) {
                var left = i === 0 ? 4 : 128;
                box(left + 3, 66 + k * 20, 3, 3, glow);
                box(left + 9, 66 + k * 20, 3, 3, glow);
                box(left + 4, 73 + k * 20, 7, 3, k % 2 ? RED : INK);
            }
        }
        if (level === 3) {
            for (i = 0; i < 10; i++) {
                if ((clock + i * 3) % 7 < 4) {
                    box(22 + hash(i * 5) % 100, 20 + (hash(i) + Math.floor(clock / 3) * 5) % 90, 2, 2, LIME);
                }
            }
        }
    },

    // A sound system at sunset: speaker stacks, a flag, smoke.
    dub: function (level) {
        var i, x;
        var bands = level === 3 ? [RED, YELLOW, GREEN] : [NAVY, PLUM, ORANGE_DIM];
        var shift = level === 3 ? Math.floor(clock / 4) : 0;
        box(0, 0, SW, 46, bands[shift % 3]);
        box(0, 46, SW, 42, bands[(shift + 1) % 3]);
        box(0, 88, SW, G - 88, bands[(shift + 2) % 3]);
        box(0, G, SW, SH - G, NIGHT);
        flush();
        disc(73, 96, 16, ORANGE);
        for (i = 0; i < 3 + level * 2; i++) {
            var size = 3 + (i % 3) * 2;
            box(40 + hash(i) % 62 + Math.sin(clock / 9 + i) * 4, G - (hash(i * 5) + clock * (1 + i % 2)) % 122, size * 2, size, SLATE);
        }
        box(2, 58, 32, G - 58, INK);
        box(112, 58, 32, G - 58, INK);
        var pump = level >= 1 && clock % 8 < 3 ? level : 0;
        for (i = 0; i < 2; i++) {
            var cx = i === 0 ? 18 : 128;
            disc(cx, 80, 11 + pump, STEEL);
            disc(cx, 80, 4, SLATE);
            disc(cx, 118, 12 + pump, STEEL);
            disc(cx, 118, 5, SLATE);
        }
        for (x = 0; x < 42; x += 6) {
            var wave = Math.round(Math.sin(clock / 6 + x / 8) * 1.5);
            box(52 + x, 8 + wave, 6, 4, RED);
            box(52 + x, 12 + wave, 6, 4, YELLOW);
            box(52 + x, 16 + wave, 6, 4, GREEN);
        }
        box(50, 6, 2, 30, SLATE);
        for (i = 0; i < SW; i += 12) {
            box(i + 3, G + 7, 6, 1, STEEL);
        }
    },

    // A rave: the smiley, a grid of lasers, hazard stripes.
    rave: function (level) {
        var i, k;
        box(0, 0, SW, G, level >= 2 && clock % 4 < 2 ? DEEP[Math.floor(clock / 4) % 12] : INK);
        box(0, G, SW, SH - G, INK);
        flush();
        for (i = 0; i < 5; i++) {
            box((i * 31 + clock * 3) % SW, 0, 1, G, level >= 1 ? LIME : GREEN_DIM);
            box(0, (i * 29 + clock * 2) % G, SW, 1, level >= 1 ? LIME : GREEN_DIM);
        }
        for (i = -16; i < SW; i += 16) {
            box(i + clock % 16, G, 8, 4, YELLOW);
            box(i + 8 - clock % 16 + 8, G + 12, 8, 4, YELLOW);
        }
        var faces = level === 3 ? [[73, 20], [24, 9], [122, 9]] : [[73, 20]];
        for (k = 0; k < faces.length; k++) {
            var bounce = Math.abs(Math.sin(clock / (6 - level) + k)) * 12;
            var size = faces[k][1] + (level >= 1 && clock % 6 < 2 ? 2 : 0);
            faces[k].push(40 + bounce);
            disc(faces[k][0], 40 + bounce, size, YELLOW);
        }
        flush();
        for (k = 0; k < faces.length; k++) {
            var fx = faces[k][0];
            var fy = faces[k][2];
            var unit = faces[k][1] / 20;
            box(fx - 8 * unit, fy - 9 * unit, 4 * unit, 8 * unit, INK);
            box(fx + 4 * unit, fy - 9 * unit, 4 * unit, 8 * unit, INK);
            for (i = -10; i <= 8; i += 2) {
                box(fx + i * unit, fy + (9 - i * i / 12) * unit, 2 * unit + 1, 2 * unit + 1, INK);
            }
        }
    },

    // A city at night seen from a fast road.
    dnb: function (level) {
        var i, b, wx, wy;
        box(0, 0, SW, G, NAVY);
        box(0, G, SW, SH - G, INK);
        flush();
        disc(120, 18, 7, SILVER);
        for (i = 0; i < 5 + level * 6; i++) {
            box((hash(i) * 3 + clock * (5 + level * 2)) % (SW + 20) - 10, hash(i * 9) % (G - 20), 6 + level * 2, 1, SKY);
        }
        if (level === 3) {
            ray(30, G, 30 + Math.sin(clock / 8) * 60, 0, SILVER);
            ray(116, G, 116 - Math.sin(clock / 6) * 60, 0, SILVER);
        }
        flush();
        for (b = 0; b < 9; b++) {
            var high = 38 + hash(b * 3) % 62;
            box(b * 17 - 3, G - high, 15, high, b % 2 ? NIGHT : INK);
            for (wx = 0; wx < 3; wx++) {
                for (wy = 0; wy < Math.floor(high / 7) - 1; wy++) {
                    if (hash(b * 31 + wx * 7 + wy * 13 + Math.floor(clock / (14 - level * 3))) % 5 === 0) {
                        box(b * 17 + wx * 4, G - high + 4 + wy * 7, 2, 3, YELLOW);
                    }
                }
            }
            if (level >= 2) {
                var bar = 2 + hash(b * 5 + Math.floor(clock / 2)) % 10;
                box(b * 17, G - high - bar, 9, bar, CYAN);
            }
        }
        for (i = 0; i < SW + 24; i += 24) {
            box(i - (clock * (6 + level * 3)) % 24, G + 8, 12, 2, YELLOW);
        }
        box((clock * 9) % (SW + 60) - 40, G + 3, 22, 2, RED);
        box(SW - (clock * 11) % (SW + 60), G + 13, 22, 2, WHITE);
    },

    // A pool by night: the moon on the water, a palm, lanterns on a string.
    deephouse: function (level) {
        var i;
        box(0, 0, SW, 88, NAVY);
        box(0, 88, SW, G - 88, TEAL);
        box(0, G, SW, SH - G, ORANGE_DIM);
        flush();
        twinkle(10, 60, WHITE);
        disc(108, 26, 9, SILVER);
        for (i = 0; i < 6; i++) {
            box(102 + Math.sin(clock / 7 + i) * 4 + i, 93 + i * 8, 14 - i * 2, 2, SILVER);
        }
        for (i = 0; i < 5 + level * 3; i++) {
            box(wrapTo(hash(i) + clock * (i % 2 ? 1 : -1), SW - 16), 92 + hash(i * 3) % 46, 8 + hash(i * 7) % 12, 1, CYAN);
        }
        box(0, 86, SW, 3, INK);
        line(16, G, 24, 54, INK, 3);
        for (i = 0; i < 5; i++) {
            line(24, 54, 24 + Math.cos(i * 0.8 - 2.6) * 22, 60 + Math.sin(i * 0.8 - 2.6) * 10, INK, 2);
        }
        for (i = 0; i < 9; i++) {
            var lit = level >= 1 && (i + Math.floor(clock / 6)) % 3 !== 0;
            box(40 + i * 12, 8 + Math.abs(i - 4), 3, 4, lit ? (i % 2 ? YELLOW : ORANGE) : STEEL);
        }
        for (i = 10; i < SW; i += 20) {
            box(i, G + 2, 1, SH - G, INK);
        }
        if (level >= 2) {
            for (i = 0; i < 5; i++) {
                box(34 + hash(i * 5) % 90, 80 - (hash(i) + clock) % 76, 3, 4, ORANGE);
            }
        }
        if (level === 3) {
            for (i = 0; i < 9; i++) {
                if ((clock + i * 3) % 7 < 4) {
                    box(hash(i * 11) % SW, 30 + (hash(i) + Math.floor(clock / 3) * 3) % 100, 2, 2, LIME);
                }
            }
        }
    },

    // A wall of light behind the booth: tiles that fire in waves.
    techhouse: function (level) {
        var gx, gy, i;
        box(0, 0, SW, G, INK);
        box(0, G, SW, SH - G, NIGHT);
        flush();
        var pace = Math.max(1, 4 - level);
        for (gy = 0; gy < 5; gy++) {
            for (gx = 0; gx < 9; gx++) {
                var on = (gx + gy + Math.floor(clock / pace)) % 4 === 0
                    || (level >= 2 && hash(gx * 7 + gy * 13 + Math.floor(clock / 2)) % 6 === 0);
                var lamp = level === 3 ? RAINBOW[(gx + gy + Math.floor(clock / 3)) % 12] : (gy % 2 ? ORANGE : YELLOW);
                box(6 + gx * 15, 10 + gy * 15, 13, 13, on && level >= 1 ? lamp : (on ? STEEL : NIGHT));
            }
        }
        box(46, 98, 54, 14, STEEL);
        box(51, 94, 16, 4, SLATE);
        box(79, 94, 16, 4, SLATE);
        box(70, 95, 6, 3, level >= 1 && clock % 6 < 3 ? RED : SLATE);
        disc(wrapTo(clock * (2 + level), SW + 20) - 10, G - 8 - Math.abs(Math.sin(clock * 0.5)) * 8, 4, LIME);
        for (i = 0; i < SW; i += 14) {
            box(i + 4, G + 7, 7, 1, STEEL);
        }
    },

    // An eclipse over an empty plain: a dark disc in a ring of fire.
    melodic: function (level) {
        var i;
        box(0, 0, SW, G, INK);
        box(0, G, SW, SH - G, NIGHT);
        flush();
        twinkle(18, 124, SILVER);
        var breath = Math.sin(clock / 9) * 1.5;
        disc(73, 58, 27, NIGHT);
        ring(73, 58, 30 + breath, 44, ORANGE, 1);
        if (level >= 1) {
            ring(73, 58, 33 + breath, 44, YELLOW, 1);
        }
        if (level >= 2) {
            for (i = 0; i < 12; i++) {
                var a = i * Math.PI / 6 + clock / 40;
                var reach = 44 + hash(i + Math.floor(clock / 3)) % 10;
                line(73 + Math.cos(a) * 37, 58 + Math.sin(a) * 37, 73 + Math.cos(a) * reach, 58 + Math.sin(a) * reach, YELLOW, 1);
            }
        }
        if (level === 3) {
            ring(73, 58, 34 + (clock * 2) % 60, 40, CYAN, 1);
        }
        box(0, 104 + Math.sin(clock / 11) * 18, SW, 1, STEEL);
        box(0, G - 1, SW, 1, SLATE);
        for (i = 0; i < 8 + level * 4; i++) {
            box(hash(i) % SW, G - (hash(i * 3) + clock) % G, 1, 1, SILVER);
        }
    },

    // A speaker the size of a wall, and the wave that shakes it.
    dubstep: function (level) {
        var i, x;
        box(0, 0, SW, G, NIGHT);
        box(0, G, SW, SH - G, INK);
        flush();
        var wobble = Math.sin(clock * (0.3 + level * 0.22));
        var cone = 30 + wobble * (2 + level * 2);
        disc(73, 66, cone + 9, STEEL);
        disc(73, 66, cone, SLATE);
        disc(73, 66, cone * 0.4, SILVER);
        box(20, 16, 106, 2, STEEL);
        box(20, 114, 106, 2, STEEL);
        for (x = 0; x < SW; x += 3) {
            box(x, 126 + Math.sin(x / 9 + clock * 0.6) * (3 + level * 3) * wobble, 3, 2, LIME);
        }
        for (i = 0; i < 5 + level * 3; i++) {
            box(hash(i) % (SW - 4), G - 4 - Math.abs(Math.sin(clock * 0.4 + i)) * (5 + level * 6), 3, 3, i % 2 ? PLUM : SLATE);
        }
        if (level === 3) {
            for (i = 0; i < 4; i++) {
                var seed = i * 17 + Math.floor(clock / 2) * 31;
                box(hash(seed) % 100, hash(seed * 3) % G, 20 + hash(seed * 5) % 40, 2, RAINBOW[hash(seed) % 12]);
            }
        }
        for (i = 0; i < SW; i += 12) {
            box(i + 3, G + 7, 6, 1, STEEL);
        }
    },

    // A sweet sky: clouds, a rainbow, and chords that stand up like pillars.
    futurebass: function (level) {
        var i, k;
        box(0, 0, SW, G, PASTEL[5]);
        box(0, G, SW, SH - G, PASTEL[3]);
        flush();
        if (level === 3) {
            for (k = 0; k < 4; k++) {
                for (i = 0; i <= 24; i++) {
                    var arc = Math.PI * i / 24;
                    box(73 + Math.cos(arc) * (70 - k * 5) - 2, G - Math.sin(arc) * (70 - k * 5) - 2, 5, 5, RAINBOW[k * 3 + 1]);
                }
            }
        }
        for (i = 0; i < 4; i++) {
            var cx = wrapTo(hash(i) * 2 + Math.floor(clock * (1 + i % 2) / 2), SW + 50) - 40;
            box(cx, 14 + i * 15, 30, 6, WHITE);
            box(cx + 6, 10 + i * 15, 16, 4, WHITE);
        }
        for (i = 0; i < 7; i++) {
            var tall = 18 + Math.abs(Math.sin(clock / 4 + i)) * (8 + level * 14);
            box(8 + i * 19, G - tall, 14, tall, PASTEL[(i + (level >= 2 ? Math.floor(clock / 4) : 0)) % 8]);
        }
        for (i = 0; i < 6 + level * 4; i++) {
            if ((clock + i * 5) % 12 < 7) {
                var sx = hash(i * 7) % (SW - 6) + 3;
                var sy = hash(i * 3) % 80 + 4;
                box(sx - 2, sy, 5, 1, YELLOW);
                box(sx, sy - 2, 1, 5, YELLOW);
            }
        }
        box(0, G, SW, 2, WHITE);
    },

    // A neon sign, a diamond, and hi-hats that fall like rain.
    trap: function (level) {
        var i, r;
        box(0, 0, SW, G, DEEP[9]);
        box(0, G, SW, SH - G, INK);
        flush();
        for (i = 0; i < 4 + level * 2; i++) {
            var puff = 4 + (i % 3) * 3;
            box(10 + hash(i) % 120 + Math.sin(clock / 9 + i) * 4, G - (hash(i * 5) + clock * (1 + i % 2)) % 120, puff * 2, puff, PLUM);
        }
        for (r = 0; r < 12; r += 2) {
            box(59 - r, 30 + r, 28 + r * 2, 2, CYAN);
        }
        for (r = 0; r < 26; r += 2) {
            box(47 + r, 42 + r, 52 - r * 2, 2, r % 8 < 4 ? SKY : CYAN);
        }
        box(56 + (clock * 2) % 34, 34, 3, 3, WHITE);
        if (level >= 1 || clock % 20 < 14) {
            label("808", SX + 73, SY + 84, 2, level >= 2 && clock % 6 < 3 ? YELLOW : RED, CENTER);
        }
        for (i = 0; i < 8 + level * 6; i++) {
            box(hash(i) % SW, (hash(i * 3) + clock * (3 + level)) % G, 1, 3, YELLOW);
        }
        if (level === 3) {
            for (i = 0; i < 7; i++) {
                box(hash(i * 13) % (SW - 6), (hash(i * 2) + clock * 2) % G, 6, 3, GREEN);
            }
        }
        for (i = 0; i < SW; i += 16) {
            box(i + 4, G + 8, 8, 1, PLUM);
        }
    },

    // The main stage: a pyramid of screens and jets of fire.
    hardstyle: function (level) {
        var i, r;
        box(0, 0, SW, G, INK);
        box(0, G, SW, SH - G, NIGHT);
        flush();
        for (r = 0; r < 7; r++) {
            var wide = 20 + r * 17;
            var hot = (r + Math.floor(clock / 3)) % 3 === 0;
            box(73 - wide / 2, 16 + r * 12, wide, 10, hot && level >= 1 ? (level >= 2 ? ORANGE : RED) : DEEP[0]);
        }
        if (level >= 2) {
            for (i = 0; i < 6; i++) {
                ray(73, 16, 73 + Math.sin(clock / 6 + i * 1.1) * 80, G, i % 2 ? WHITE : RED);
            }
        }
        if (level >= 1 && clock % 8 < 4) {
            var jets = [12, 48, 98, 134];
            for (i = 0; i < jets.length; i++) {
                var high = 28 + level * 14 - (clock % 8) * 4 + hash(i + clock) % 8;
                box(jets[i] - 3, G - high, 6, high, RED);
                box(jets[i] - 2, G - high * 0.7, 4, high * 0.7, ORANGE);
                box(jets[i] - 1, G - high * 0.4, 2, high * 0.4, YELLOW);
            }
        }
        flush();
        for (i = 2; i < SW; i += 9) {
            var hands = 4 + hash(i) % 4 + (level >= 1 && clock % 6 < 3 ? 4 : 0);
            box(i, G - hands, 5, hands, INK);
            box(i + 1, G - hands - 3, 2, 3, INK);
        }
    },

    // Two decks and a mixer by a window on a rainy city.
    garage: function (level) {
        var i;
        box(0, 0, SW, G, NIGHT);
        box(0, G, SW, SH - G, INK);
        box(18, 8, 110, 38, NAVY);
        for (i = 0; i < 8 + level * 4; i++) {
            box(20 + hash(i) % 106, 9 + (hash(i * 3) + clock * (3 + level)) % 33, 1, 4, SKY);
        }
        flush();
        for (i = 0; i < 16; i++) {
            if (hash(i * 3 + Math.floor(clock / 14)) % 3 > 0) {
                box(22 + hash(i) % 102, 30 + hash(i * 7) % 14, 2, 2, YELLOW);
            }
        }
        box(16, 6, 114, 2, SLATE);
        box(16, 46, 114, 2, SLATE);
        box(16, 6, 2, 42, SLATE);
        box(128, 6, 2, 42, SLATE);
        box(72, 8, 2, 38, SLATE);
        box(6, 104, 134, 5, STEEL);
        var decks = [34, 112];
        for (i = 0; i < 2; i++) {
            disc(decks[i], 86, 19, STEEL);
            disc(decks[i], 86, 16, SLATE);
            disc(decks[i], 86, 5, i ? ORANGE : RED);
            var spin = clock * (0.25 + level * 0.1) + i * 2;
            box(decks[i] + Math.cos(spin) * 11 - 1, 86 + Math.sin(spin) * 11 - 1, 2, 2, WHITE);
            line(decks[i] + 16, 68, decks[i] + 8, 80, SILVER, 2);
        }
        box(62, 72, 22, 30, STEEL);
        box(66 + Math.sin(clock / 6) * 5 + 5, 96, 4, 3, WHITE);
        for (i = 0; i < 2; i++) {
            var loud = 2 + hash(i * 5 + Math.floor(clock / 2)) % (4 + level * 2);
            for (var k = 0; k < loud; k++) {
                box(66 + i * 9, 90 - k * 3, 5, 2, k > 6 ? RED : (k > 4 ? YELLOW : LIME));
            }
        }
        for (i = 0; i < SW; i += 14) {
            box(i + 4, G + 7, 7, 1, STEEL);
        }
    },

    // A festival: a wall of screens, fireworks, a sea of hands.
    edm: function (level) {
        var i, k;
        box(0, 0, SW, G, NIGHT);
        box(0, G, SW, SH - G, INK);
        flush();
        twinkle(8, 50, WHITE);
        for (i = 0; i < 18; i++) {
            var bar = 8 + hash(i + Math.floor(clock / 2) * 3) % (18 + level * 16);
            box(i * 8 + 1, G - bar, 6, bar, BLUE);
            box(i * 8 + 1, G - bar, 6, 2, CYAN);
        }
        for (k = 0; k <= level; k++) {
            var age = (clock + k * 13) % 36;
            var round = Math.floor((clock + k * 13) / 36);
            var fx = 22 + hash(k * 7 + round) % 102;
            var fy = 18 + hash(k * 3 + round * 5) % 40;
            if (age < 24) {
                for (i = 0; i < 14; i++) {
                    var spray = i * Math.PI / 7;
                    box(fx + Math.cos(spray) * age * 1.5, fy + Math.sin(spray) * age * 1.5 + age * age * 0.03, 2, 2,
                        age < 14 ? RAINBOW[(k * 4 + round * 5) % 12] : DEEP[(k * 4 + round * 5) % 12]);
                }
            }
        }
        if (level >= 2) {
            ray(4, G, 4 + Math.abs(Math.sin(clock / 9)) * 90, 0, SILVER);
            ray(142, G, 142 - Math.abs(Math.sin(clock / 7)) * 90, 0, SILVER);
        }
        if (level === 3) {
            for (i = 0; i < 24; i++) {
                box(hash(i * 13) % SW, (hash(i) + clock * 3) % G, 2, 2, RAINBOW[i % 12]);
            }
        }
        flush();
        for (i = 2; i < SW; i += 9) {
            var hands = 4 + hash(i) % 5 + (level >= 1 && (i / 9 + Math.floor(clock / 3)) % 2 < 1 ? 4 : 0);
            box(i, G - hands, 5, hands, INK);
            box(i + 1, G - hands - 3, 2, 3, INK);
        }
    },

    // A brick wall covered in paint, and a boombox on the pavement.
    breaks: function (level) {
        var i, row, x;
        box(0, 0, SW, G, ORANGE_DIM);
        box(0, G, SW, SH - G, STEEL);
        flush();
        for (row = 0; row < 14; row++) {
            box(0, row * 10 + 9, SW, 1, NIGHT);
            for (x = (row % 2) * 9; x < SW; x += 18) {
                box(x, row * 10, 1, 9, NIGHT);
            }
        }
        var paint = [LIME, CYAN, RAINBOW[10], YELLOW];
        var tag = [[14, 70], [30, 30], [46, 70], [62, 30], [78, 70], [94, 30], [110, 70], [128, 34]];
        for (i = 0; i + 1 < tag.length; i++) {
            if (level >= 1 || i < 4) {
                line(tag[i][0], tag[i][1], tag[i + 1][0], tag[i + 1][1], paint[(i + (level >= 2 ? Math.floor(clock / 5) : 0)) % 4], 4);
            }
        }
        for (i = 0; i < 6; i++) {
            box(20 + i * 20, 72, 2, 6 + hash(i) % 14, paint[i % 4]);
        }
        box(50, G - 26, 46, 24, NIGHT);
        box(58, G - 30, 30, 4, SLATE);
        var pump = level >= 1 && clock % 6 < 2 ? 2 : 0;
        disc(61, G - 12, 7 + pump, SLATE);
        disc(85, G - 12, 7 + pump, SLATE);
        box(69, G - 23, 8, 5, SILVER);
        if (level === 3) {
            for (i = 0; i < 16; i++) {
                box(hash(i * 13) % SW, 76 + (hash(i) + clock * 2) % 60, 2, 2, paint[i % 4]);
            }
        }
    },

    // A beach as the sun goes into the sea.
    chillout: function (level) {
        var i, dy;
        box(0, 0, SW, 40, NAVY);
        box(0, 40, SW, 30, PLUM);
        box(0, 70, SW, 26, ORANGE);
        box(0, 96, SW, G - 96, TEAL);
        box(0, G, SW, SH - G, ORANGE_DIM);
        flush();
        if (level >= 1) {
            twinkle(8 + level * 3, 34, WHITE);
        }
        for (dy = -18; dy < 0; dy += 2) {
            var half = Math.round(Math.sqrt(324 - dy * dy));
            box(73 - half, 96 + dy, half * 2, 2, YELLOW);
        }
        for (i = 0; i < 6; i++) {
            box(66 + Math.sin(clock / 6 + i) * 5 + i, 99 + i * 7, 16 - i * 2, 2, YELLOW);
            box(wrapTo(hash(i) + clock * (i % 2 ? 1 : -1), SW + 20) - 10, 101 + i * 7, 22, 1, CYAN);
        }
        for (i = 0; i < 2; i++) {
            var bx = wrapTo(clock / 2 + i * 60, SW + 20) - 10;
            var flap = clock % 12 < 6 ? 2 : -2;
            line(bx, 26 + i * 12, bx + 5, 26 + i * 12 + flap, INK, 1);
            line(bx + 5, 26 + i * 12 + flap, bx + 10, 26 + i * 12, INK, 1);
        }
        line(126, G, 118, 62, INK, 3);
        for (i = 0; i < 5; i++) {
            line(118, 62, 118 + Math.cos(i * 0.8 - 2.7) * 24, 68 + Math.sin(i * 0.8 - 2.7) * 10, INK, 2);
        }
        if (level >= 2) {
            for (i = 0; i < 10; i++) {
                if ((clock + i * 3) % 8 < 3) {
                    box(hash(i * 7) % SW, 100 + hash(i * 3 + Math.floor(clock / 8)) % 38, 2, 1, WHITE);
                }
            }
        }
        if (level === 3) {
            box(SW - (clock * 5) % 240, 6 + (clock * 2) % 26, 7, 1, WHITE);
        }
    },

    // Broken data: scan lines, blocks that come and go, a cube of wire.
    idm: function (level) {
        var i, y;
        box(0, 0, SW, G, INK);
        box(0, G, SW, SH - G, NIGHT);
        flush();
        for (y = 0; y < G; y += 6) {
            box(0, y, SW, 1, NIGHT);
        }
        var junk = [STEEL, SLATE, CYAN, PLUM];
        for (i = 0; i < 4 + level * 4; i++) {
            var seed = i * 17 + Math.floor(clock / 3) * 31;
            box(hash(seed) % SW, hash(seed * 3) % G, 6 + hash(seed * 5) % 40, 2 + hash(seed * 7) % 8,
                level === 3 && i % 3 === 0 ? RAINBOW[hash(seed) % 12] : junk[hash(seed * 11) % 4]);
        }
        var turn = clock * (0.06 + level * 0.02);
        var corners = [];
        for (i = 0; i < 8; i++) {
            var vx = i & 1 ? 1 : -1;
            var vy = i & 2 ? 1 : -1;
            var vz = i & 4 ? 1 : -1;
            var rx = vx * Math.cos(turn) - vz * Math.sin(turn);
            var rz = vx * Math.sin(turn) + vz * Math.cos(turn);
            corners.push([73 + rx * 26, 62 + (vy * 0.88 - rz * 0.48) * 26]);
        }
        var edges = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
        for (i = 0; i < edges.length; i += 2) {
            line(corners[edges[i]][0], corners[edges[i]][1], corners[edges[i + 1]][0], corners[edges[i + 1]][1], WHITE, 2);
        }
        label(String(100000 + hash(Math.floor(clock / 4)) * 7).substring(1), SX + 6, SY + 124, 1, GREEN, LEFT);
        label(String(100000 + hash(Math.floor(clock / 5) + 9) * 3).substring(1), SX + SW - 6, SY + 124, 1, GREEN, RIGHT);
    },

    // A tunnel that rushes at you, under a turning red lamp.
    hardtechno: function (level) {
        var k;
        box(0, 0, SW, SH, INK);
        flush();
        var strobe = level === 3 && clock % 6 < 2;
        for (k = 0; k < 6; k++) {
            var near = ((clock * (1 + level) + k * 14) % 84) / 84;
            var w = 16 + near * near * 170;
            var h = 12 + near * near * 170;
            var frame = strobe ? WHITE : (k % 2 ? RED : (level >= 1 ? SLATE : STEEL));
            box(73 - w / 2, 66 - h / 2, w, 1, frame);
            box(73 - w / 2, 66 + h / 2, w, 1, frame);
            box(73 - w / 2, 66 - h / 2, 1, h, frame);
            box(73 + w / 2, 66 - h / 2, 1, h + 1, frame);
        }
        box(66, 2, 14, 6, RED);
        if (level >= 1) {
            ray(73, 8, 73 + Math.sin(clock / 3) * 90, G, RED);
        }
        if (level >= 2) {
            ray(73, 8, 73 - Math.sin(clock / 3) * 90, G, RED);
        }
        box(0, G, SW, 1, STEEL);
    },

    // The savanna at dusk: an acacia, a huge sun, rings from the log drum.
    amapiano: function (level) {
        var i, dy, k;
        box(0, 0, SW, 44, PLUM);
        box(0, 44, SW, 36, RED);
        box(0, 80, SW, 30, ORANGE);
        box(0, 110, SW, G - 110, ORANGE_DIM);
        box(0, G, SW, SH - G, NIGHT);
        flush();
        if (level === 3) {
            twinkle(10, 40, WHITE);
        }
        for (dy = -24; dy < 0; dy += 2) {
            var half = Math.round(Math.sqrt(576 - dy * dy));
            box(84 - half, 110 + dy, half * 2, 2, YELLOW);
        }
        for (k = 0; k < 1 + level; k++) {
            var grow = (clock + k * 9) % 22;
            ring(30 + k * 30, 126, 4 + grow, 16, YELLOW, 0.35);
        }
        line(30, 110, 32, 78, INK, 3);
        line(31, 88, 44, 74, INK, 2);
        line(31, 92, 18, 76, INK, 2);
        box(8, 66, 48, 4, INK);
        box(3, 70, 58, 5, INK);
        box(12, 75, 38, 3, INK);
        box(112, 92, 2, 18, INK);
        box(100, 84, 26, 4, INK);
        box(104, 88, 18, 3, INK);
        for (i = 0; i < 3; i++) {
            var bx = wrapTo(clock / 3 + i * 44, SW + 20) - 10;
            box(bx, 20 + i * 9, 3, 1, INK);
            box(bx + 3, 21 + i * 9 - (clock % 10 < 5 ? 2 : 0), 3, 1, INK);
        }
        for (i = 0; i < SW; i += 7) {
            box(i, 108 - hash(i) % 3, 1, 3 + hash(i) % 3, INK);
        }
    },

    // A night in the village: the moon, a baobab, three drums, bright cloth.
    afro: function (level) {
        var i, x;
        box(0, 0, SW, G, NIGHT);
        box(0, G, SW, SH - G, ORANGE_DIM);
        flush();
        twinkle(12, 70, WHITE);
        disc(106, 50, 22, YELLOW);
        var cloth = [RED, YELLOW, GREEN];
        var shift = level >= 2 ? Math.floor(clock / 4) : 0;
        for (x = 0; x < SW; x += 12) {
            box(x, 0, 6, 8, cloth[(x / 12 + shift) % 3]);
            box(x + 6, 0, 6, 8, cloth[(x / 12 + shift + 1) % 3]);
            box(x + 3, 8, 6, 4, ORANGE);
        }
        flush();
        box(22, 70, 10, G - 70, INK);
        box(6, 62, 42, 6, INK);
        box(2, 56, 20, 6, INK);
        box(30, 54, 24, 8, INK);
        line(27, 72, 44, 60, INK, 3);
        line(27, 76, 8, 62, INK, 3);
        for (i = 0; i < 3; i++) {
            var dx = 58 + i * 24;
            var hit = level >= 1 && (Math.floor(clock / 3) + i) % 3 === 0;
            box(dx, G - 20, 16, 4, hit ? WHITE : SILVER);
            box(dx + 1, G - 16, 14, 6, RED);
            box(dx + 3, G - 10, 10, 5, RED);
            box(dx + 5, G - 5, 6, 5, RED);
            if (hit) {
                box(dx + 6, G - 26 - (clock % 3) * 3, 4, 3, YELLOW);
            }
        }
        if (level === 3) {
            for (i = 0; i < 12; i++) {
                if ((clock + i * 3) % 7 < 4) {
                    box(hash(i * 5) % SW, 20 + (hash(i) + Math.floor(clock / 3) * 5) % 100, 2, 2, LIME);
                }
            }
        }
    },

    // A night road: tail lights going sideways under a red moon.
    phonk: function (level) {
        var i, k;
        box(0, 0, SW, 72, DEEP[9]);
        box(0, 72, SW, SH - 72, INK);
        flush();
        twinkle(8, 50, SILVER);
        disc(112, 24, 11, RED);
        ray(73, 72, -40, SH, SLATE);
        ray(73, 72, 186, SH, SLATE);
        for (k = 0; k < 5; k++) {
            var far = (k + ((clock * (1 + level)) % 6) / 6) / 5;
            box(72 - far * 2, 72 + far * far * (SH - 72), 2 + far * 4, 2 + far * 7, YELLOW);
        }
        var slide = Math.sin(clock / 7) * (10 + level * 6);
        var cx = 73 + slide;
        for (i = 0; i < 3 + level * 3; i++) {
            var puff = 3 + (i % 3) * 2;
            box(cx - slide * (0.4 + i * 0.25) - puff + hash(i + Math.floor(clock / 2)) % 6, 120 - i * 2, puff * 2, puff, i % 2 ? STEEL : SLATE);
        }
        flush();
        box(cx - 22, 106, 44, 13, STEEL);
        box(cx - 14, 96, 28, 10, STEEL);
        box(cx - 11, 98, 22, 6, SLATE);
        box(cx - 21, 108, 8, 3, RED);
        box(cx + 13, 108, 8, 3, RED);
        box(cx - 20, 117, 40, 2, SLATE);
        box(cx - 20, 119, 7, 4, INK);
        box(cx + 13, 119, 7, 4, INK);
        if (level >= 2) {
            for (i = 0; i < 6; i++) {
                box(wrapTo(hash(i) * 3 - clock * 9, SW + 30) - 15, 6 + hash(i * 9) % 60, 12, 1, PLUM);
            }
        }
    },

    // Too much of everything: hearts, sparkles, stripes of candy.
    hyperpop: function (level) {
        var i, x;
        box(0, 0, SW, G, PASTEL[0]);
        tiles([PASTEL[4], WHITE, PASTEL[6], PASTEL[2]], level);
        box(0, G, SW, 2, WHITE);
        flush();
        for (x = -60; x < SW; x += 30) {
            ray(x + clock % 30, 0, x + clock % 30 + 46, G, PASTEL[6]);
        }
        for (i = 0; i < 5 + level * 3; i++) {
            var hx = hash(i * 7) % (SW - 12) + 2;
            var hy = G - 10 - (hash(i) + clock * (1 + i % 3)) % (G - 14);
            var love = i % 3 === 0 ? WHITE : (level >= 2 ? RAINBOW[(i + Math.floor(clock / 3)) % 12] : RED);
            box(hx, hy, 3, 3, love);
            box(hx + 4, hy, 3, 3, love);
            box(hx, hy + 2, 7, 3, love);
            box(hx + 2, hy + 5, 3, 2, love);
        }
        for (i = 0; i < 6 + level * 5; i++) {
            if ((clock + i * 5) % 10 < 6) {
                var sx = hash(i * 13) % (SW - 6) + 3;
                var sy = hash(i * 3 + Math.floor(clock / 10)) % 110 + 6;
                box(sx - 2, sy, 5, 1, YELLOW);
                box(sx, sy - 2, 1, 5, YELLOW);
            }
        }
        if (level === 3) {
            for (i = 0; i < 4; i++) {
                var seed = i * 17 + Math.floor(clock / 2) * 31;
                box(0, hash(seed) % G, SW, 2, RAINBOW[hash(seed * 3) % 12]);
            }
        }
    },

    // A club where everything bounces: balls on springs in the rhythm of the kick.
    jersey: function (level) {
        var i;
        box(0, 0, SW, G, NIGHT);
        tiles(level >= 2 ? FIRE_FLOOR : DANCE_FLOOR, level);
        box(0, G, SW, 2, WHITE);
        flush();
        var neon = clock % 10 < 5 ? PLUM : CYAN;
        box(4, 4, SW - 8, 2, neon);
        box(4, 4, 2, 60, neon);
        box(SW - 6, 4, 2, 60, neon);
        var beat = [0, 0.25, 0.5, 0.69, 0.84];
        for (i = 0; i < 5; i++) {
            var phase = (clock * (0.045 + level * 0.012) + 1 - beat[i]) % 1;
            var jump = Math.abs(Math.sin(phase * Math.PI)) * (22 + level * 12);
            var bx = 18 + i * 27;
            var top = 112 - jump;
            for (var k = 0; k < 5; k++) {
                box(bx - 4 + (k % 2) * 5, top + 9 + k * (G - top - 12) / 5, 4, 2, SILVER);
            }
            disc(bx, top, 8, level >= 1 ? RAINBOW[(i * 2 + (level === 3 ? Math.floor(clock / 3) : 0)) % 12] : SLATE);
        }
    },

    // Everything faster: streaks of light, a thin moon, sparks.
    nightcore: function (level) {
        var i;
        box(0, 0, SW, G, DEEP[10]);
        box(0, G, SW, SH - G, INK);
        flush();
        disc(110, 30, 14, YELLOW);
        for (i = 0; i < 10 + level * 8; i++) {
            var long = 8 + hash(i * 5) % (10 + level * 10);
            box(wrapTo(hash(i) * 3 - clock * (6 + level * 4 + i % 4), SW + 60) - 30, hash(i * 9) % (G - 6) + 2, long, 1,
                level >= 2 ? PASTEL[i % 8] : (i % 2 ? PASTEL[0] : PASTEL[5]));
        }
        for (i = 0; i < 6 + level * 4; i++) {
            if ((clock + i * 5) % 8 < 5) {
                var sx = hash(i * 13 + Math.floor(clock / 8)) % (SW - 6) + 3;
                var sy = hash(i * 3) % 110 + 6;
                box(sx - 2, sy, 5, 1, WHITE);
                box(sx, sy - 2, 1, 5, WHITE);
            }
        }
        for (i = 0; i < SW + 20; i += 20) {
            box(i - (clock * (8 + level * 4)) % 20, G + 8, 10, 2, PASTEL[0]);
        }
        flush();
        disc(104, 26, 12, DEEP[10]);
    },

    // The nineties: lasers from the corners and shapes that fly about.
    eurodance: function (level) {
        var i;
        box(0, 0, SW, G, NIGHT);
        tiles([BLUE, PLUM, NAVY, TEAL], level);
        box(0, G, SW, 2, WHITE);
        flush();
        var bright = [YELLOW, CYAN, RAINBOW[10], LIME, ORANGE];
        for (i = 0; i < 6 + level * 3; i++) {
            var sx = wrapTo(hash(i) + clock * (1 + i % 3) * (i % 2 ? 1 : -1), SW + 20) - 10;
            var sy = 14 + hash(i * 7) % 96 + Math.sin(clock / 6 + i) * 4;
            var paint = bright[i % 5];
            if (i % 3 === 0) {
                disc(sx, sy, 5, paint);
            } else if (i % 3 === 1) {
                for (var r = 0; r < 10; r += 2) {
                    box(sx - r / 2, sy + r, r + 1, 2, paint);
                }
            } else {
                line(sx, sy, sx + 5, sy + 6, paint, 2);
                line(sx + 5, sy + 6, sx + 10, sy, paint, 2);
                line(sx + 10, sy, sx + 15, sy + 6, paint, 2);
            }
        }
        if (level >= 1) {
            for (i = 0; i < 2 + level; i++) {
                ray(2, 2, 2 + (0.5 + Math.sin(clock / 8 + i * 0.8) * 0.5) * 150, G, LIME);
                ray(SW - 2, 2, SW - 2 - (0.5 + Math.sin(clock / 8 + i * 0.8 + 1) * 0.5) * 150, G, CYAN);
            }
        }
        box(0, 0, 8, 6, SLATE);
        box(SW - 8, 0, 8, 6, SLATE);
    },

    // An eight-bit night: mountains sliding by, coins, a score.
    chiptune: function (level) {
        var i, k;
        box(0, 0, SW, G, NAVY);
        flush();
        twinkle(10, 60, WHITE);
        box(112, 12, 12, 12, YELLOW);
        var ranges = [[STEEL, 46, 0.5, 52], [SLATE, 34, 1, 40], [GREEN_DIM, 22, 2, 30]];
        for (k = 0; k < 3; k++) {
            for (i = -1; i < 6; i++) {
                var peak = i * ranges[k][3] - wrapTo(Math.floor(clock * ranges[k][2] * (1 + level * 0.5)), ranges[k][3]);
                for (var r = 0; r < ranges[k][1]; r += 4) {
                    box(peak + ranges[k][3] / 2 - r * 0.6, G - ranges[k][1] + r, r * 1.2 + 4, 4, ranges[k][0]);
                }
            }
            flush();
        }
        for (i = 0; i < 4 + level; i++) {
            var cx = wrapTo(i * 36 - clock * (2 + level), SW + 30) - 10;
            var thin = Math.abs(Math.cos(clock / 3 + i)) * 6 + 1;
            box(cx - thin / 2, 66 + (i % 2) * 14, thin, 8, YELLOW);
        }
        for (i = 0; i < SW + 24; i += 12) {
            box(i - (clock * (2 + level)) % 24, G, 12, SH - G, (i / 12) % 2 ? GREEN : GREEN_DIM);
        }
        label("SCORE " + String(1000000 + (beats * 10 + (level === 3 ? clock : 0)) % 1000000).substring(1), SX + SW - 5, SY + 5, 1, WHITE, RIGHT);
    },

    // A swamp of glowing mushrooms: drops fall, rings spread, spores rise.
    psydub: function (level) {
        var i, k;
        box(0, 0, SW, G, DEEP[5]);
        box(0, G, SW, SH - G, NAVY);
        flush();
        if (level === 3) {
            for (i = 0; i < 44; i++) {
                var a = i * 0.5 + clock * 0.05;
                box(73 + Math.cos(a) * i * 1.6, 58 + Math.sin(a) * i * 1.3, 2, 2, RAINBOW[(i + Math.floor(clock / 3)) % 12]);
            }
        }
        for (i = 0; i < 7; i++) {
            var sway = Math.sin(clock / 12 + i) * 3;
            line(8 + i * 22, 0, 8 + i * 22 + sway, 16 + hash(i) % 22, GREEN_DIM, 2);
        }
        var shrooms = [[22, 44, 20], [124, 54, 16], [74, 30, 12]];
        for (k = 0; k < shrooms.length; k++) {
            var hue = (k * 4 + Math.floor(clock / (14 - level * 3))) % 12;
            var glow = level >= 1 ? RAINBOW[hue] : DEEP[(hue + 6) % 12];
            var swell = level >= 2 ? Math.round(Math.sin(clock / 5 + k) * 2) : 0;
            box(shrooms[k][0] - 3, G - shrooms[k][1], 6, shrooms[k][1], SILVER);
            for (i = 0; i < shrooms[k][2]; i += 2) {
                box(shrooms[k][0] - shrooms[k][2] - swell + i * 0.4, G - shrooms[k][1] - 4 - i * 0.7, (shrooms[k][2] + swell - i * 0.4) * 2, 2, glow);
            }
        }
        for (i = 0; i < 3 + level * 2; i++) {
            var fall = (hash(i * 5) + clock * (2 + i % 2)) % (G + 30);
            var dx = 12 + hash(i) % 122;
            if (fall < G) {
                box(dx, fall, 2, 4, CYAN);
            } else {
                ring(dx, G + 8, 3 + (fall - G) / 2, 12, CYAN, 0.3);
            }
        }
        for (i = 0; i < 6 + level * 5; i++) {
            box(hash(i * 3) % SW + Math.sin(clock / 7 + i) * 3, G - (hash(i) + clock) % (G - 6), 1, 1, LIME);
        }
    },

    // A turning mandala that now and then tears like a bad signal.
    psybass: function (level) {
        var i, k;
        box(0, 0, SW, G, INK);
        tiles(DEEP, level);
        flush();
        for (k = 0; k < 4; k++) {
            var count = 6 + k * 6;
            var reach = 12 + k * 13 + Math.sin(clock / 8 + k) * 2;
            var turn = clock * (0.03 + level * 0.015) * (k % 2 ? 1 : -1);
            for (i = 0; i < count; i++) {
                var a = turn + Math.PI * 2 * i / count;
                box(73 + Math.cos(a) * reach - 2, 62 + Math.sin(a) * reach - 2, 4, 4,
                    level >= 1 ? RAINBOW[(k * 3 + (i % 2) * 2 + Math.floor(clock / 6)) % 12] : DEEP[(k * 3 + 2) % 12]);
            }
        }
        for (k = 0; k < 2; k++) {
            var spin = clock * 0.02 * (k ? -1 : 1) + k * Math.PI / 3;
            for (i = 0; i < 3; i++) {
                line(73 + Math.cos(spin + i * 2.094) * 34, 62 + Math.sin(spin + i * 2.094) * 34,
                     73 + Math.cos(spin + (i + 1) * 2.094) * 34, 62 + Math.sin(spin + (i + 1) * 2.094) * 34, k ? CYAN : WHITE, 2);
            }
        }
        disc(73, 62, 6, WHITE);
        flush();
        box(71, 60, 4, 4, INK);
        if (level >= 2) {
            for (i = 0; i < level; i++) {
                var seed = i * 17 + Math.floor(clock / 4) * 31;
                var y = hash(seed) % (G - 8);
                box(0, y, SW, 4, INK);
                box(hash(seed * 3) % 70, y, 60, 4, RAINBOW[hash(seed * 5) % 12]);
            }
        }
    },

    // The inside of a machine: a circuit board, a chip, two walls of amps.
    metal: function (level) {
        var i, k;
        box(0, 0, SW, G, GREEN_DIM);
        box(0, G, SW, SH - G, INK);
        flush();
        var tracks = [[30, 8, 60], [44, 20, 44], [58, 4, 44], [88, 12, 44], [102, 26, 44], [116, 6, 60]];
        for (i = 0; i < tracks.length; i++) {
            var tx = tracks[i][0];
            var span = tracks[i][2] - tracks[i][1];
            box(tx, tracks[i][1], 1, span, GREEN);
            box(Math.min(tx, 73), tracks[i][2], Math.abs(73 - tx), 1, GREEN);
            box(tx - 1, tracks[i][1] - 1, 3, 3, SILVER);
            var run = wrapTo(clock * (2 + level) + i * 23, 120);
            if (level >= 1 && run < span) {
                box(tx - 1, tracks[i][1] + run, 3, 3, LIME);
            } else if (level >= 1 && run < span + Math.abs(73 - tx)) {
                box(tx + (73 - tx > 0 ? 1 : -1) * (run - span) - 1, tracks[i][2] - 1, 3, 3, LIME);
            }
        }
        for (i = 0; i < 6; i++) {
            box(58 + i * 6, 40, 2, 4, SILVER);
            box(58 + i * 6, 68, 2, 4, SILVER);
        }
        flush();
        for (k = 0; k < 2; k++) {
            var ax = k ? 122 : 2;
            box(ax, 84, 22, G - 84, INK);
            for (i = 0; i < 12; i++) {
                box(ax + 3 + (i % 3) * 6, 90 + Math.floor(i / 3) * 12, 4, 8, level >= 1 && clock % 6 < 2 ? SLATE : STEEL);
            }
            box(ax + 9, 86, 3, 2, level >= 1 && clock % 4 < 2 ? RED : STEEL);
        }
        box(56, 44, 34, 24, INK);
        label(clock % 8 < 4 ? "1010" : "0101", SX + 73, SY + 52, 1, level >= 2 ? LIME : GREEN, CENTER);
        if (level >= 2 && clock % 9 < 3) {
            var bx = 73;
            var by = 0;
            for (i = 0; i < 5; i++) {
                var nx = 73 + hash(i + Math.floor(clock / 9) * 7) % 40 - 20;
                line(bx, by, nx, by + 9, WHITE, 2);
                bx = nx;
                by += 9;
            }
        }
        if (level === 3) {
            for (i = 0; i < 5; i++) {
                var seed = i * 17 + Math.floor(clock / 2) * 31;
                box(hash(seed) % 110, hash(seed * 3) % G, 10 + hash(seed * 5) % 30, 3, i % 2 ? RED : WHITE);
            }
        }
    }
};

// ---- the sceneries of the styles by decade

// A wall of bulbs that chase each other, and a floor of lit tiles.
SCENES.disco = function (level) {
    var x, y;
    box(0, 0, SW, G, NIGHT);
    flush();
    var lamps = [YELLOW, ORANGE, RED, RAINBOW[10]];
    for (y = 0; y < 6; y++) {
        for (x = 0; x < 9; x++) {
            var on = level === 0 ? (x + y) % 4 === 0 : (x + y * 2 + Math.floor(clock / (5 - level))) % (5 - level) === 0;
            disc(12 + x * 15, 14 + y * 15, 5, on ? lamps[(x + y + Math.floor(clock / 6)) % lamps.length] : STEEL);
        }
    }
    tiles([RED, YELLOW, ORANGE, RAINBOW[10], WHITE], Math.max(1, level));
    box(0, G, SW, 2, WHITE);
    if (level >= 2) {
        ray(0, 0, 40 + Math.sin(clock / 5) * 30, G, YELLOW);
        ray(SW, 0, 106 - Math.sin(clock / 5) * 30, G, YELLOW);
    }
    if (level === 3) {
        for (x = 0; x < 16; x++) {
            box(hash(x * 5) % SW, (hash(x) + clock * 3) % G, 2, 2, x % 2 ? WHITE : YELLOW);
        }
    }
};

// A sunburst of the seventies: broad rays that turn behind a round sun.
SCENES.funk = function (level) {
    var i;
    var stripes = [ORANGE, YELLOW, ORANGE_DIM, RED];
    box(0, 0, SW, G, ORANGE_DIM);
    box(0, G, SW, SH - G, PLUM);
    flush();
    var turn = clock * (0.01 + level * 0.012);
    for (i = 0; i < 12; i++) {
        var a = turn + i * Math.PI / 6;
        var far = 150;
        ray(73, 96, 73 + Math.cos(a) * far, 96 + Math.sin(a) * far * 0.8, stripes[i % 4]);
        ray(75, 96, 75 + Math.cos(a + 0.05) * far, 96 + Math.sin(a + 0.05) * far * 0.8, stripes[i % 4]);
    }
    flush();
    box(0, G, SW, SH - G, PLUM);
    flush();
    disc(73, 96, 26 + (level >= 2 && clock % 6 < 3 ? 2 : 0), YELLOW);
    flush();
    disc(73, 96, 17, ORANGE);
    for (i = 0; i < SW; i += 14) {
        box(i, G + 3, 7, 3, ORANGE);
        box(i + 7, G + 9, 7, 3, YELLOW);
    }
    if (level === 3) {
        ring(73, 96, 34 + clock % 12 * 3, 24, WHITE, 0.9);
    }
};

// Deep space: a ringed planet, far stars and a row of sequencer lamps.
SCENES.kosmische = function (level) {
    var i;
    box(0, 0, SW, SH, INK);
    flush();
    twinkle(30 + level * 8, 120, WHITE);
    twinkle(8, 120, CYAN);
    disc(98, 46, 22, TEAL);
    flush();
    disc(92, 40, 14, GREEN);
    flush();
    ring(98, 46, 34, 40, SILVER, 0.28);
    ring(98, 46, 38, 44, SLATE, 0.28);
    disc(26, 84, 6, PLUM);
    box(0, G, SW, 1, SLATE);
    var step = Math.floor(clock / (6 - level)) % 16;
    for (i = 0; i < 16; i++) {
        box(5 + i * 8.6, G + 5, 5, 5, i === step ? YELLOW : i % 4 === 0 ? TEAL : STEEL);
    }
    if (level >= 2) {
        for (i = 0; i < 3; i++) {
            var fall = (clock * 4 + i * 60) % 190;
            line(fall, fall * 0.4 + i * 14, fall - 10, fall * 0.4 + i * 14 - 4, WHITE, 1);
        }
    }
    if (level === 3) {
        ring(98, 46, 44 + Math.sin(clock / 3) * 4, 30, RAINBOW[clock % 12], 0.28);
    }
};

// Shapes of the eighties afloat: a triangle, a circle, a zigzag, a grid.
SCENES.synthpop = function (level) {
    var i;
    box(0, 0, SW, G, NAVY);
    box(0, G, SW, SH - G, PLUM);
    flush();
    for (i = 0; i < SW; i += 12) {
        box(i, 0, 1, G, BLUE);
    }
    for (i = 0; i < G; i += 12) {
        box(0, i, SW, 1, BLUE);
    }
    flush();
    var bob = Math.sin(clock / (9 - level * 2)) * (2 + level * 2);
    disc(34, 40 + bob, 15, PASTEL[0]);
    line(84, 22 - bob, 118, 22 - bob, YELLOW, 3);
    line(84, 22 - bob, 101, 52 - bob, YELLOW, 3);
    line(118, 22 - bob, 101, 52 - bob, YELLOW, 3);
    for (i = 0; i < 6; i++) {
        line(20 + i * 12, 86 + (i % 2) * 10 + bob / 2, 32 + i * 12, 96 - (i % 2) * 10 + bob / 2, CYAN, 3);
    }
    box(108, 70 + bob, 20, 20, RAINBOW[10]);
    for (i = 0; i < SW; i += 16) {
        box(i, G + 4, 8, 4, PASTEL[0]);
        box(i + 8, G + 10, 8, 4, CYAN);
    }
    if (level >= 2) {
        twinkle(14, 100, WHITE);
    }
    if (level === 3) {
        for (i = 0; i < 10; i++) {
            box(hash(i * 3) % SW, (hash(i) + clock * 3) % G, 3, 3, PASTEL[i % 8]);
        }
    }
};

// A big neon heart that beats, stripes of a sunset behind it.
SCENES.italo = function (level) {
    var i;
    var bands = [PLUM, DEEP[11], RED, ORANGE, YELLOW];
    for (i = 0; i < 5; i++) {
        box(0, i * 29, SW, 29, bands[i]);
    }
    box(0, G, SW, SH - G, NAVY);
    flush();
    var beat = level >= 1 && clock % 6 < 2 ? 3 : 0;
    var size = 24 + beat;
    var neon = level >= 2 ? RAINBOW[Math.floor(clock / 3) % 12] : RAINBOW[11];
    ring(73 - size / 2, 46, size / 2, 16, neon, 1);
    ring(73 + size / 2, 46, size / 2, 16, neon, 1);
    line(73 - size, 50, 73, 50 + size * 1.3, neon, 2);
    line(73 + size, 50, 73, 50 + size * 1.3, neon, 2);
    for (i = 0; i < SW; i += 10) {
        box(i, G + 2 + (i % 20 ? 8 : 0), 10, 7, i % 20 ? BLUE : SKY);
    }
    twinkle(12 + level * 4, 60, WHITE);
    if (level === 3) {
        for (i = 0; i < 8; i++) {
            var up = (clock * 3 + i * 23) % G;
            box(10 + hash(i) % (SW - 20), G - up, 2, 2, RAINBOW[11]);
        }
    }
};

// A city of machines: a sign of running lights over the roofs.
SCENES.electro = function (level) {
    var i, x;
    box(0, 0, SW, G, INK);
    box(0, G, SW, SH - G, STEEL);
    flush();
    for (i = 0; i < 9; i++) {
        var tall = 40 + hash(i * 7) % 50;
        box(i * 17, G - tall, 15, tall, i % 2 ? NIGHT : STEEL);
    }
    flush();
    for (i = 0; i < 40; i++) {
        if ((hash(i) + Math.floor(clock / 12)) % 3 > 0) {
            box(2 + hash(i * 3) % (SW - 6), G - 6 - hash(i * 5) % 60, 2, 3, i % 5 === 0 ? CYAN : YELLOW);
        }
    }
    box(18, 12, 110, 26, NIGHT);
    flush();
    var run = Math.floor(clock / (4 - Math.min(2, level)));
    for (x = 0; x < 26; x++) {
        for (i = 0; i < 5; i++) {
            var lit = (x + i + run) % 6 < (level >= 1 ? 3 : 1) && (x * 3 + i) % 4 !== 0;
            box(21 + x * 4, 15 + i * 4, 3, 3, lit ? (level >= 2 ? RAINBOW[(x + run) % 12] : RED) : STEEL);
        }
    }
    for (i = 0; i < SW; i += 12) {
        box(i, G + 6, 6, 2, CYAN);
    }
    if (level === 3) {
        ray(0, G, 73 + Math.sin(clock / 4) * 60, 0, CYAN);
        ray(SW, G, 73 - Math.sin(clock / 4) * 60, 0, RAINBOW[10]);
    }
};

// A warehouse: hazard stripes, pillars and a line that squelches.
SCENES.acid = function (level) {
    var i, x;
    box(0, 0, SW, G, NIGHT);
    box(0, G, SW, SH - G, INK);
    flush();
    for (i = 0; i < 4; i++) {
        box(8 + i * 42, 10, 6, G - 10, STEEL);
    }
    for (x = -10; x < SW; x += 16) {
        line(x, 10, x + 10, 0, YELLOW, 4);
    }
    box(0, 10, SW, 2, YELLOW);
    for (x = 0; x < SW; x += 3) {
        var bend = 6 + level * 5;
        var y = 70 + Math.sin(x / 9 + clock / (6 - level)) * bend * Math.sin(x / 31 + clock / 17);
        box(x, y, 3, 2, level >= 2 ? LIME : GREEN);
        if (level >= 1) {
            box(x, y + 18, 3, 1, GREEN_DIM);
        }
    }
    for (x = 0; x < SW; x += 16) {
        box(x, G + 2, 8, SH - G, YELLOW);
    }
    if (level >= 2) {
        for (i = 0; i < 4; i++) {
            box(9 + i * 42, 14, 4, 4, (i + Math.floor(clock / 4)) % 2 ? LIME : STEEL);
        }
    }
    if (level === 3) {
        for (i = 0; i < 12; i++) {
            box(hash(i * 9) % SW, 20 + (hash(i) + clock * 5) % 100, 2, 2, LIME);
        }
    }
};

// A harbour in fog: a bridge with lamps, a low moon, slow rain.
SCENES.triphop = function (level) {
    var i, x;
    box(0, 0, SW, G, NIGHT);
    box(0, G, SW, SH - G, STEEL);
    flush();
    disc(112, 34, 13, SILVER);
    flush();
    disc(108, 31, 11, NIGHT);
    box(0, 96, SW, 3, SLATE);
    for (x = 6; x < SW; x += 34) {
        box(x, 60, 3, 36, SLATE);
        line(x + 1, 60, x + 18, 94, SLATE, 1);
        line(x + 1, 60, x - 16, 94, SLATE, 1);
    }
    for (x = 12; x < SW; x += 17) {
        box(x, 92, 2, 2, (x + Math.floor(clock / 9)) % 3 ? YELLOW : ORANGE);
    }
    for (i = 0; i < 3; i++) {
        var drift = (clock / (3 - Math.min(2, level) * 0.5) + i * 70) % (SW + 80) - 80;
        box(drift, 104 + i * 9, 80, 3, i % 2 ? STEEL : SLATE);
    }
    for (i = 0; i < 10 + level * 8; i++) {
        box(hash(i * 3) % SW, (hash(i) + clock * 4) % G, 1, 3, SLATE);
    }
    if (level === 3) {
        for (x = 12; x < SW; x += 17) {
            box(x - 1, 100, 4, 20 + (hash(x) + clock) % 14, DEEP[1]);
        }
    }
};

// A stadium: floodlights, stacks of speakers, hands of the crowd.
SCENES.bigbeat = function (level) {
    var i, x;
    box(0, 0, SW, G, NAVY);
    box(0, G, SW, SH - G, NIGHT);
    flush();
    for (i = 0; i < 2; i++) {
        var side = i ? SW - 30 : 4;
        box(side, 44, 26, G - 44, STEEL);
        disc(side + 13, 62, 8, NIGHT);
        disc(side + 13, 92, 10, NIGHT);
        disc(side + 13, 122, 8, NIGHT);
    }
    for (x = 0; x < 6; x++) {
        var bright = level === 0 ? x % 3 === 0 : (x + Math.floor(clock / (5 - level))) % 2 === 0;
        box(40 + x * 12, 8, 8, 8, bright ? WHITE : SLATE);
        if (bright && level >= 2) {
            ray(44 + x * 12, 16, 20 + x * 22, G, YELLOW);
        }
    }
    box(36, 4, 76, 3, SLATE);
    for (x = 0; x < SW; x += 7) {
        var hand = level === 0 ? 3 : Math.abs(Math.sin(x * 0.7 + clock / (4 - Math.min(2, level)))) * (5 + level * 3);
        box(x, G + 6 - hand, 4, 12 + hand, INK);
    }
    if (level === 3) {
        for (i = 0; i < 14; i++) {
            box(hash(i * 5) % SW, (hash(i) + clock * 4) % 100, 2, 2, RAINBOW[i % 12]);
        }
    }
};

// A hall of concrete: a tunnel of lamps, towers of speakers, a strobe.
SCENES.gabber = function (level) {
    var i;
    box(0, 0, SW, G, INK);
    box(0, G, SW, SH - G, NIGHT);
    flush();
    if (level >= 2) {
        for (i = 0; i < 6; i++) {
            box(30 + i * 16, 6, 6, 4, (i + Math.floor(clock / 3)) % 3 === 0 ? WHITE : STEEL);
        }
    }
    for (i = 1; i <= 5; i++) {
        var grow = ((clock * (1 + level) + i * 12) % 60) / 60;
        var w = 20 + grow * 120;
        var h = 14 + grow * 100;
        box(73 - w / 2, 60 - h / 2, w, 1, RED);
        box(73 - w / 2, 60 + h / 2, w, 1, RED);
        box(73 - w / 2, 60 - h / 2, 1, h, RED);
        box(73 + w / 2, 60 - h / 2, 1, h, RED);
    }
    for (i = 0; i < 2; i++) {
        var left = i ? SW - 24 : 2;
        box(left, 36, 22, G - 36, STEEL);
        disc(left + 11, 56, 8, INK);
        disc(left + 11, 86, 8, INK);
        disc(left + 11, 116, 8, INK);
    }
    box(0, G, SW, 2, RED);
    if (level >= 1) {
        ray(26, 36, 73 + Math.sin(clock / 2) * 40, G, WHITE);
        ray(120, 36, 73 - Math.sin(clock / 2) * 40, G, WHITE);
    }
    if (level === 3) {
        for (i = 0; i < 16; i++) {
            box(hash(i * 3) % SW, hash(i + Math.floor(clock / 2)) % G, 3, 1, i % 2 ? WHITE : RED);
        }
    }
};

// A club of the two-thousands: bars of light from above and from below.
SCENES.electrohouse = function (level) {
    var i;
    box(0, 0, SW, SH, INK);
    flush();
    for (i = 0; i < 18; i++) {
        var tall = 10 + Math.abs(Math.sin(i * 0.9 + clock / (7 - level * 1.5))) * (16 + level * 14);
        box(2 + i * 8, 0, 6, tall, i % 2 ? CYAN : RAINBOW[10]);
        box(2 + i * 8, G - tall * 0.6, 6, tall * 0.6, i % 2 ? RAINBOW[10] : CYAN);
    }
    box(0, G, SW, 2, WHITE);
    for (i = 0; i < SW; i += 12) {
        box(i, G + 4, 6, 6, (i / 12 + Math.floor(clock / 4)) % 2 ? CYAN : STEEL);
    }
    if (level >= 2) {
        line(40, 60, 106, 100, WHITE, 2);
        line(106, 60, 40, 100, WHITE, 2);
    }
    if (level === 3) {
        ring(73, 80, 20 + clock % 10 * 4, 20, WHITE, 1);
    }
};

// Almost nothing: a circle, a line, a few dots, and all of it moves slowly.
SCENES.minimal = function (level) {
    var i;
    box(0, 0, SW, G, STEEL);
    box(0, G, SW, SH - G, NIGHT);
    flush();
    for (i = 0; i < 40; i++) {
        box(8 + (i % 8) * 18, 12 + Math.floor(i / 8) * 24, 1, 1, SLATE);
    }
    var slide = Math.sin(clock / (40 - level * 9)) * (20 + level * 8);
    ring(73 + slide, 62, 22, 36, WHITE, 1);
    box(20, 100 - slide / 3, SW - 40, 1, SILVER);
    box(73 - slide, 30, 2, 2, level >= 1 ? ORANGE : SILVER);
    if (level >= 2) {
        ring(73 - slide, 62, 12, 20, ORANGE, 1);
    }
    if (level === 3) {
        box(73 + slide - 1, 61, 3, 3, RAINBOW[Math.floor(clock / 4) % 12]);
        box(20 + (clock * 2) % (SW - 40), 99 - slide / 3, 6, 3, WHITE);
    }
    box(0, G, SW, 1, SILVER);
};

// A beach by day: sun, sea, sand, a palm and birds.
SCENES.tropical = function (level) {
    var i, x;
    box(0, 0, SW, 84, SKY);
    box(0, 84, SW, G - 84, CYAN);
    box(0, G, SW, SH - G, YELLOW);
    flush();
    disc(110, 30, 14 + (level >= 2 && clock % 8 < 4 ? 1 : 0), YELLOW);
    for (x = 0; x < SW; x += 6) {
        box(x, 86 + Math.sin(x / 8 + clock / (8 - level * 2)) * 2 + ((x / 6) % 3) * 9, 4, 1, WHITE);
    }
    box(20, 60, 4, G - 60, ORANGE_DIM);
    for (i = -2; i <= 2; i++) {
        line(22, 60, 22 + i * 11, 52 + Math.abs(i) * 7 + Math.sin(clock / 9 + i) * level, GREEN, 3);
    }
    box(0, G, SW, 2, WHITE);
    for (i = 0; i < 2 + level; i++) {
        var fly = (clock * (1 + level * 0.5) + i * 50) % (SW + 20) - 10;
        box(fly, 16 + i * 9 + Math.sin(clock / 3 + i) * 2, 5, 1, NIGHT);
        box(fly + 2, 15 + i * 9 + Math.sin(clock / 3 + i) * 2, 1, 1, NIGHT);
    }
    if (level === 3) {
        for (i = 0; i < 12; i++) {
            box(hash(i * 5) % SW, G - (hash(i) + clock * 3) % 80, 3, 3, RAINBOW[(i * 2) % 12]);
        }
    }
};

// A dream of a shopping mall: pink air, a column, windows of an old computer.
SCENES.vaporwave = function (level) {
    var i, x;
    box(0, 0, SW, G, PASTEL[0]);
    box(0, G, SW, SH - G, PASTEL[5]);
    flush();
    for (x = 0; x < SW; x += 12) {
        box(x + ((Math.floor(clock / 8) % 2) * 12 * (level >= 1 ? 1 : 0)) % 24 - 12, G + 2, 12, 8, WHITE);
        box(x, G + 10, 12, 8, (x / 12) % 2 ? WHITE : PASTEL[5]);
    }
    disc(108, 44, 20, PASTEL[1]);
    flush();
    for (i = 0; i < 4; i++) {
        box(88, 46 + i * 6, 40, 2, PASTEL[0]);
    }
    box(22, 50, 14, G - 50, WHITE);
    box(18, 46, 22, 5, WHITE);
    box(18, G - 5, 22, 5, WHITE);
    for (i = 0; i < 3; i++) {
        box(25 + i * 4, 52, 1, G - 58, SILVER);
    }
    for (i = 0; i < 1 + level; i++) {
        var wx = 46 + i * 14 + Math.sin(clock / 20 + i) * 3;
        var wy = 14 + i * 16 + Math.cos(clock / 23 + i) * 3;
        box(wx, wy, 44, 26, SILVER);
        box(wx + 1, wy + 6, 42, 19, WHITE);
        box(wx + 1, wy + 1, 42, 4, BLUE);
        box(wx + 38, wy + 2, 3, 2, WHITE);
    }
    if (level === 3) {
        for (i = 0; i < 10; i++) {
            box(hash(i * 7) % SW, (hash(i) + clock * 2) % G, 3, 3, i % 2 ? CYAN : RAINBOW[10]);
        }
    }
};

// An estate at night: two towers with lit windows, a fence, red lamps above.
SCENES.drill = function (level) {
    var i, x, y;
    box(0, 0, SW, G, NIGHT);
    box(0, G, SW, SH - G, INK);
    flush();
    twinkle(10, 40, SLATE);
    box(10, 26, 46, G - 26, STEEL);
    box(92, 14, 44, G - 14, STEEL);
    flush();
    for (y = 0; y < 9; y++) {
        for (x = 0; x < 4; x++) {
            var lit = (hash(x * 7 + y * 13) + Math.floor(clock / (40 - level * 9))) % 4 === 0;
            box(15 + x * 10, 32 + y * 12, 6, 6, lit ? YELLOW : NIGHT);
            box(97 + x * 10, 20 + y * 13, 6, 6, (hash(x * 5 + y * 11) + Math.floor(clock / 30)) % 5 === 0 ? ORANGE : NIGHT);
        }
    }
    box(32, 22, 2, 4, clock % 12 < 6 ? RED : STEEL);
    box(113, 10, 2, 4, clock % 12 >= 6 ? RED : STEEL);
    for (x = 0; x < SW; x += 8) {
        line(x, G - 16, x + 8, G, SLATE, 1);
        line(x + 8, G - 16, x, G, SLATE, 1);
    }
    box(0, G - 17, SW, 1, SLATE);
    if (level >= 1) {
        for (x = 0; x < SW; x += 4) {
            box(x, G + 9 + Math.sin(x / 14 - clock / (5 - Math.min(2, level))) * (2 + level), 3, 1, level >= 2 ? RED : SLATE);
        }
    }
    if (level === 3) {
        box(0, 0, SW, 2, clock % 6 < 3 ? BLUE : RED);
        for (i = 0; i < 10; i++) {
            box(hash(i * 3) % SW, (hash(i) + clock * 5) % G, 1, 3, SLATE);
        }
    }
};

// ------------------------------------------------ the dancers of free play

// Every style of free play has two dancers of its own and a dance of its own.
// A dancer is a jointed figure: hips, shoulders, a head, two arms and two
// legs with an elbow or a knee in the middle. A dance is a row of poses, one
// after another on the beat. The beat is the song of Ableton while it plays,
// otherwise the pulse the player keeps, otherwise the tempo of the style.

var DANCER_ZOOM = 2;    // how many pixels of the stage one pixel of a dancer takes
var ARM = 6;        // half an arm: shoulder to elbow, elbow to hand
var LEG = 7;        // half a leg
var HIP = 13;       // how high the hips are over the ground when standing
var TORSO = 11;

// A pose, thirteen numbers:
//   the hips: shift sideways, drop (negative = a jump), lean of the shoulders
//   the left hand: x, y from its shoulder (y grows downwards); the right hand
//   the left foot: step sideways, lift; the right foot
//   the head: nod, tilt
// Left and right are the sides of the screen.
var POSES = {
    stand:   [0, 0, 0, -2, 11, 2, 11, 0, 0, 0, 0, 0, 0],
    up2:     [0, -1, 0, -3, -11, 3, -11, 0, 0, 0, 0, -1, 0],
    vee:     [0, -1, 0, -9, -8, 9, -8, 0, 0, 0, 0, -1, 0],
    tee:     [0, 0, 0, -12, 0, 12, 0, 0, 0, 0, 0, 0, 0],
    open:    [0, 0, 0, -9, 6, 9, 6, 0, 0, 0, 0, 0, 0],
    hips:    [0, 0, 0, -1, 8, 1, 8, 0, 0, 0, 0, 0, 0],
    reach:   [0, -2, 0, -1, -12, 1, -12, 0, 0, 0, 0, -2, 0],
    crown:   [0, -1, 0, 2, -10, -2, -10, 0, 0, 0, 0, -1, 0],
    heart:   [0, -1, 0, 3, -8, -3, -8, 0, 0, 0, 0, 0, 0],
    clap:    [0, 0, 0, 3, 3, -3, 3, 0, 0, 0, 0, 0, 0],
    clapUp:  [0, -2, 0, 3, -11, -3, -11, 0, 0, 0, 0, -1, 0],
    pray:    [0, 0, 0, 3, 5, -3, 5, 0, 0, 0, 0, 2, 0],
    cross:   [0, 0, 0, 6, 4, -6, 4, 0, 0, 0, 0, 1, 0],
    pointR:  [-2, 0, 1, -1, 8, 8, -10, 0, 0, 2, 0, -1, 1],
    pointL:  [2, 0, -1, -8, -10, 1, 8, -2, 0, 0, 0, -1, -1],
    downR:   [2, 1, -1, -1, 8, -7, 9, 0, 0, 0, 0, 1, -1],
    downL:   [-2, 1, 1, 7, 9, 1, 8, 0, 0, 0, 0, 1, 1],
    pumpR:   [0, -2, 0, -2, 8, 2, -12, 0, 0, 0, 0, -1, 0],
    pumpL:   [0, -2, 0, -2, -12, 2, 8, 0, 0, 0, 0, -1, 0],
    hammerL: [0, 2, -1, -1, 10, 5, -5, 0, 0, 0, 0, 2, 0],
    hammerR: [0, 2, 1, -5, -5, 1, 10, 0, 0, 0, 0, 2, 0],
    waveL:   [0, 0, -1, -10, -6, 10, 5, 0, 0, 0, 0, 0, -1],
    waveR:   [0, 0, 1, -10, 5, 10, -6, 0, 0, 0, 0, 0, 1],
    tutA:    [0, 0, 0, -6, -6, 6, 6, 0, 0, 0, 0, 0, -1],
    tutB:    [0, 0, 0, -6, 6, 6, -6, 0, 0, 0, 0, 0, 1],
    boxA:    [0, 0, 0, -7, -3, 7, -3, 0, 0, 0, 0, 0, 0],
    boxB:    [0, 1, 0, -4, 6, 4, 6, 0, 0, 0, 0, 0, 0],
    rollA:   [0, 1, 0, 2, 2, -3, 6, 0, 0, 0, 0, 0, 0],
    rollB:   [0, 1, 0, 3, 6, -2, 2, 0, 0, 0, 0, 0, 0],
    squat:   [0, 6, 0, -7, 3, 7, 3, -3, 0, 3, 0, 1, 0],
    jump:    [0, -6, 0, -8, -9, 8, -9, -2, 0, 2, 0, -1, 0],
    star:    [0, -5, 0, -11, -5, 11, -5, -6, 0, 6, 0, -1, 0],
    kickL:   [2, 0, 2, -6, 3, 8, -3, -8, 7, 0, 0, 0, 1],
    kickR:   [-2, 0, -2, -8, -3, 6, 3, 0, 0, 8, 7, 0, -1],
    kneeL:   [1, 0, 0, -3, 9, 6, -4, 2, 9, 0, 0, 0, 0],
    kneeR:   [-1, 0, 0, -6, -4, 3, 9, 0, 0, -2, 9, 0, 0],
    stepL:   [-3, 2, -1, -7, 4, 4, 8, -5, 0, 0, 0, 0, -1],
    stepR:   [3, 2, 1, -4, 8, 7, 4, 0, 0, 5, 0, 0, 1],
    leanL:   [-2, 0, -4, -4, 10, -1, 11, 0, 0, 0, 0, 0, -1],
    leanR:   [2, 0, 4, 1, 11, 4, 10, 0, 0, 0, 0, 0, 1],
    hipL:    [-4, 2, 2, -1, 8, 1, 8, 0, 0, 0, 0, 0, 1],
    hipR:    [4, 2, -2, -1, 8, 1, 8, 0, 0, 0, 0, 0, -1],
    lowL:    [-2, 3, -2, -9, 7, -3, 10, 0, 0, 0, 0, 1, -1],
    lowR:    [2, 3, 2, 3, 10, 9, 7, 0, 0, 0, 0, 1, 1],
    snapL:   [-2, 1, -1, -9, 3, 2, 10, 0, 0, 0, 0, 0, -1],
    snapR:   [2, 1, 1, -2, 10, 9, 3, 0, 0, 0, 0, 0, 1],
    nodA:    [0, 0, 0, -1, 9, 1, 9, 0, 0, 0, 0, 3, 0],
    nodB:    [0, 1, 0, -1, 9, 1, 9, 0, 0, 0, 0, 0, 0],
    bow:     [0, 3, 0, -3, 10, 3, 10, 0, 0, 0, 0, 6, 0],
    curtsy:  [0, 5, 0, -9, 5, 9, 5, -2, 0, 3, 0, 3, 0],
    arabL:   [2, 0, 2, -10, -6, 11, 1, -9, 6, 0, 0, 0, 1],
    arabR:   [-2, 0, -2, -11, 1, 10, -6, 0, 0, 9, 6, 0, -1],
    float:   [0, -3, 0, -10, 3, 10, 3, -1, 0, 1, 0, 0, 0],
    runA:    [0, 1, 0, -5, 7, 5, -2, 1, 7, 2, 0, 0, 0],
    runB:    [0, 1, 0, -5, -2, 5, 7, -2, 0, -1, 7, 0, 0],
    shufA:   [-2, 2, 0, -6, 5, 6, 5, -7, 2, 0, 0, 0, 0],
    shufB:   [2, 2, 0, -6, 5, 6, 5, 0, 0, 7, 2, 0, 0],
    crossA:  [0, 2, 0, -5, 6, 5, 6, 5, 0, -5, 0, 0, 0],
    crossB:  [0, 2, 0, -7, 4, 7, 4, -5, 0, 5, 0, 0, 0],
    heelL:   [1, 1, 0, -4, 8, 4, 8, -6, 3, 0, 0, 0, 0],
    heelR:   [-1, 1, 0, -4, 8, 4, 8, 0, 0, 6, 3, 0, 0],
    hakA:    [0, 0, 0, -4, 4, 4, 9, -1, 8, 0, 0, 0, 0],
    hakB:    [0, 0, 0, -4, 9, 4, 4, 0, 0, 1, 8, 0, 0],
    stompA:  [0, 3, 0, -8, 2, 8, 2, -5, 6, 4, 0, 0, 0],
    stompB:  [0, 3, 0, -8, 2, 8, 2, -4, 0, 5, 6, 0, 0],
    shakeA:  [0, 2, 0, -7, -9, 5, -11, -4, 0, 4, 0, 0, -1],
    shakeB:  [0, 2, 0, -5, -11, 7, -9, -4, 0, 4, 0, 0, 1],
    bang:    [0, 3, 0, -5, 7, 5, 7, -3, 0, 3, 0, 7, 0],
    bangUp:  [0, 0, 0, -5, 8, 5, 8, -3, 0, 3, 0, -2, 0],
    horns:   [0, 0, 0, -2, 6, 4, -12, -3, 0, 3, 0, -1, 0],
    strumA:  [0, 1, 0, -9, 0, -1, 7, -4, 0, 4, 0, 1, 0],
    strumB:  [0, 2, 0, -9, 0, 1, 9, -4, 0, 4, 0, 4, 0],
    dab:     [-2, 1, -2, -11, -6, -9, -5, 0, 0, 0, 0, 4, -2],
    woah:    [2, 3, 2, 3, 3, 9, 0, 0, 0, 3, 0, 0, 1],
    flossL:  [3, 0, 0, -9, 8, -7, 8, 0, 0, 0, 0, 0, 0],
    flossR:  [-3, 0, 0, 7, 8, 9, 8, 0, 0, 0, 0, 0, 0],
    gunR:    [0, 2, 0, -2, 9, 4, -11, 0, 0, 0, 0, 1, 0],
    gunL:    [0, 2, 0, -4, -11, 2, 9, 0, 0, 0, 0, 1, 0],
    robotA:  [0, 0, 0, -6, 1, 6, -6, 0, 0, 0, 0, 0, -2],
    robotB:  [0, 0, 0, -6, -6, 6, 1, 0, 0, 0, 0, 0, 2],
    robotC:  [0, 2, 0, -6, 6, 6, 6, -3, 0, 3, 0, 0, 0],
    glitchA: [3, 0, -3, -9, -9, 1, 4, -4, 3, 0, 0, 3, 2],
    glitchB: [-3, 3, 3, 2, 10, 10, -3, 0, 0, 5, 4, -1, -2],
    sweep:   [3, 8, 2, -4, 10, 9, 3, -10, 1, 1, 0, 0, 2],
    freeze:  [-4, 7, -5, -7, 11, 8, -9, 1, 0, 10, 10, 2, -3],
    ouch:    [0, 2, 0, 2, -7, -2, -7, 0, 0, 0, 0, 2, 0]
};

// The two dancers of every style and their dance.
//   dance: how many beats one pose lasts; how the body gets from pose to pose
//          (0 = at once, like a machine, 1 = quickly, just before the beat,
//          2 = flowing all the way); how deep it bounces on the beat; how far
//          it travels from side to side; 1 = the second dancer mirrors the
//          first; how many poses the second dancer is behind; the poses.
//   cast:  what each dancer looks like. Colours not given are plain ones:
//          light skin, white top, dark legs.
var TROUPES = {
    // a conductor in tails and a ballerina: a slow ballet
    classic: { dance: [2, 2, 0, 6, 1, 0, "arabL crown arabR curtsy open crown tee bow"], cast: [
        { hair: ["short", SILVER], top: SLATE, stripe: WHITE, legs: SLATE, shoes: SILVER, back: ["cape", STEEL], prop: ["baton", WHITE] },
        { hair: ["bun", ORANGE_DIM], top: PASTEL[0], body: "tutu", skirt: WHITE, legs: PEACH, shoes: PASTEL[0] }] },
    // a kid in headphones and a cat: nodding along
    lofi: { dance: [1, 2, 1, 0, 0, 1, "nodA nodB nodA leanL nodA nodB nodA leanR"], cast: [
        { hair: ["short", ORANGE_DIM], phones: ORANGE, top: GREEN, legs: SLATE, shoes: WHITE },
        { skin: SILVER, hat: ["catears", SILVER], face: "happy", top: YELLOW, legs: SILVER, shoes: SILVER, back: ["tail", SILVER] }] },
    // a monk and a spirit, hovering: arms rise and fall like breath
    ambient: { dance: [4, 2, 0, 3, 1, 1, "float open reach open float pray"], cast: [
        { body: "robe", top: ORANGE, face: "calm", hover: 1 },
        { body: "robe", top: CYAN, skin: WHITE, hat: ["halo", YELLOW], hover: 1 }] },
    // sunglasses and big hair: disco fingers
    synthwave: { dance: [1, 1, 2, 0, 1, 0, "pointR hips pointR downR pointL hips pointL downL"], cast: [
        { hair: ["short", YELLOW], face: "shades", top: RAINBOW[10], stripe: CYAN, legs: BLUE, shoes: WHITE },
        { hair: ["long", RAINBOW[11]], face: "shades", top: CYAN, legs: RAINBOW[9], shoes: WHITE }] },
    // two clubbers: step, clap, rock the hips
    house: { dance: [1, 1, 3, 4, 1, 0, "stepL clap stepR clap leanL hipR leanR hipL"], cast: [
        { skin: BROWN, hat: ["bucket", YELLOW], top: ORANGE, legs: BLUE, shoes: WHITE },
        { hair: ["afro", ORANGE_DIM], top: LIME, fore: PEACH, legs: RAINBOW[10], shoes: WHITE }] },
    // black clothes, white gloves, a gas mask: fists hammer the beat
    techno: { dance: [0.5, 1, 2, 0, 0, 0, "hammerL hammerR hammerL hammerR pumpR hammerR pumpL hammerL"], cast: [
        { face: "shades", top: SLATE, legs: SLATE, shoes: WHITE, hands: WHITE },
        { hat: ["hood", SLATE], face: "gas", top: SLATE, stripe: LIME, legs: SLATE, shoes: LIME }] },
    // a fairy and her friend with glow sticks: hands in the air
    trance: { dance: [1, 2, 2, 0, 1, 2, "reach vee up2 vee waveL waveR heart vee"], cast: [
        { hair: ["long", YELLOW], top: WHITE, legs: SKY, shoes: WHITE, back: ["wings", PASTEL[5]], prop: ["glow", CYAN] },
        { hair: ["short", ORANGE_DIM], top: SKY, legs: WHITE, shoes: SKY, prop: ["glow", LIME] }] },
    // an alien and a shaman: arms like water over a fast stomp
    psy: { dance: [0.5, 2, 3, 2, 1, 1, "waveL tutA waveR tutB shakeA lowL shakeB lowR"], cast: [
        { head: "alien", skin: LIME, face: "big", hat: ["antennae", LIME], top: RAINBOW[9], legs: RAINBOW[5], shoes: LIME },
        { skin: TAN, hair: ["dreads", ORANGE_DIM], hat: ["band", RAINBOW[1]], top: RAINBOW[1], stripe: YELLOW, legs: GREEN, shoes: TAN, prop: ["staff", YELLOW] }] },
    // masks, feathers, a spear: stomp, shake, crouch
    tribal: { dance: [1, 1, 4, 0, 0, 0, "stompA shakeA stompB shakeB squat up2 squat vee"], cast: [
        { skin: BROWN, face: "mask", hat: ["feathers", RED], top: BROWN, body: "skirt", skirt: LIME, legs: BROWN, shoes: BROWN, prop: ["spear", SILVER] },
        { skin: BROWN, face: "paint", hat: ["feathers", YELLOW], top: ORANGE, fore: BROWN, body: "skirt", skirt: YELLOW, legs: BROWN, shoes: BROWN, prop: ["maracas", RED] }] },
    // dreadlocks under a tam and the selector in headphones: the skank
    dub: { dance: [1, 2, 2, 2, 1, 0, "kneeL lowL kneeR lowR kneeL open kneeR open"], cast: [
        { skin: BROWN, hair: ["dreads", ORANGE_DIM], hat: ["rasta", RED], top: GREEN, legs: YELLOW, shoes: WHITE },
        { skin: TAN, hair: ["short", ORANGE_DIM], phones: YELLOW, top: RED, legs: GREEN, shoes: YELLOW }] },
    // a smiley and a raver in gloves: big fish, little fish, cardboard box
    rave: { dance: [0.5, 1, 3, 0, 0, 2, "rollA rollB boxA boxB pumpR pumpL star squat"], cast: [
        { head: "smiley", skin: YELLOW, face: "happy", top: LIME, legs: ORANGE, shoes: WHITE, hands: WHITE },
        { hair: ["twin", RAINBOW[10]], face: "happy", top: CYAN, stripe: LIME, legs: RAINBOW[10], shoes: WHITE, hands: WHITE, prop: ["glow", RAINBOW[2]] }] },
    // junglists: the feet cross and uncross twice a beat
    dnb: { dance: [0.5, 1, 2, 0, 1, 0, "crossA crossB heelL crossB crossA crossB heelR crossB"], cast: [
        { skin: TAN, hat: ["cap", RED], top: ORANGE, legs: SLATE, shoes: WHITE },
        { hair: ["pony", ORANGE_DIM], top: WHITE, legs: TEAL, shoes: ORANGE }] },
    // a beard in a beanie and a long dress: slow, with finger snaps
    deephouse: { dance: [2, 2, 1, 5, 1, 0, "snapL hipR snapR hipL leanL open leanR hips"], cast: [
        { skin: BROWN, hat: ["beanie", TEAL], face: "beard", beard: ORANGE_DIM, top: SKY, legs: SLATE, shoes: WHITE },
        { skin: TAN, hair: ["long", ORANGE_DIM], top: RAINBOW[8], body: "dress", legs: TAN, shoes: WHITE }] },
    // the shuffle
    techhouse: { dance: [0.5, 1, 2, 3, 1, 0, "shufA shufB shufA shufB runA runB shufA clap"], cast: [
        { hair: ["short", ORANGE_DIM], face: "shades", top: WHITE, fore: PEACH, legs: BLUE, shoes: WHITE },
        { skin: TAN, hair: ["bob", YELLOW], top: RAINBOW[0], fore: TAN, legs: SKY, shoes: WHITE }] },
    // a hooded wanderer and a woman with a lantern: slow and solemn
    melodic: { dance: [2, 2, 0, 2, 0, 1, "pray open reach vee open pray leanL leanR"], cast: [
        { hat: ["hood", SLATE], top: SLATE, legs: SLATE, shoes: SILVER, back: ["cape", STEEL], prop: ["orb", CYAN] },
        { hair: ["long", WHITE], top: BLUE, body: "dress", legs: PEACH, shoes: WHITE, prop: ["orb", YELLOW] }] },
    // a robot and a headbanger: jerks, freezes and a bang on the drop
    dubstep: { dance: [0.5, 0, 0, 0, 0, 1, "robotA robotB robotC bang robotB robotA glitchA bang"], cast: [
        { body: "robot", head: "square", skin: SILVER, face: "visor", eye: LIME, hat: ["antennae", SILVER], top: SLATE, stripe: LIME, legs: SILVER, shoes: SLATE, thick: 3 },
        { hair: ["long", LIME], top: SLATE, fore: PEACH, legs: SLATE, shoes: LIME }] },
    // pastel twin tails and cat-ear headphones: hearts and star jumps
    futurebass: { dance: [1, 1, 4, 0, 1, 0, "heart star hips clapUp pointR star pointL jump"], cast: [
        { hair: ["twin", RAINBOW[9]], face: "happy", top: PASTEL[0], body: "skirt", skirt: RAINBOW[9], legs: WHITE, shoes: PASTEL[0] },
        { hair: ["short", PASTEL[6]], hat: ["catears", PASTEL[0]], phones: PASTEL[0], top: WHITE, legs: PASTEL[5], shoes: WHITE }] },
    // a cap, a chain: the dab, the lean, the slow bounce
    trap: { dance: [1, 1, 2, 0, 1, 0, "dab stand woah leanL hipR leanR pumpR squat"], cast: [
        { skin: BROWN, hat: ["cap", RED], face: "shades", top: WHITE, chain: YELLOW, legs: SLATE, shoes: RED },
        { skin: TAN, hair: ["pony", ORANGE_DIM], top: RAINBOW[9], chain: YELLOW, legs: SILVER, shoes: WHITE }] },
    // tracksuits: hakken, a kick on every half beat
    hardstyle: { dance: [0.5, 1, 3, 0, 0, 0, "hakA hakB hakA hakB kickL hakB kickR hakA"], cast: [
        { top: WHITE, stripe: RED, legs: WHITE, shin: RED, shoes: WHITE },
        { hair: ["pony", YELLOW], top: SKY, stripe: WHITE, legs: SKY, shoes: WHITE }] },
    // two-step with a finger in the air
    garage: { dance: [1, 1, 2, 4, 1, 0, "gunR stepL gunL stepR heelL clap heelR clap"], cast: [
        { skin: BROWN, hat: ["cap", WHITE], top: SKY, fore: BROWN, legs: BLUE, shoes: WHITE },
        { skin: TAN, hair: ["bob", ORANGE_DIM], top: YELLOW, legs: WHITE, shoes: YELLOW }] },
    // a flag and a flower crown: fist pumps and jumps
    edm: { dance: [1, 1, 5, 0, 0, 0, "pumpR pumpR jump clapUp pumpL pumpL jump star"], cast: [
        { hair: ["short", YELLOW], top: RAINBOW[2], fore: PEACH, legs: SKY, shoes: WHITE, prop: ["flag", RAINBOW[0]] },
        { skin: TAN, hair: ["long", ORANGE_DIM], hat: ["flowers", RAINBOW[0]], top: RAINBOW[10], fore: TAN, body: "skirt", skirt: WHITE, legs: TAN, shoes: WHITE }] },
    // b-boy and b-girl: toprock, a sweep on the floor, a freeze
    breaks: { dance: [1, 1, 2, 0, 0, 4, "runA runB kickL sweep kneeR crossA freeze freeze"], cast: [
        { skin: TAN, hat: ["cap", BLUE], top: YELLOW, legs: SLATE, shoes: WHITE, thick: 3 },
        { hair: ["pony", ORANGE_DIM], hat: ["beanie", RED], top: LIME, legs: SLATE, shoes: ORANGE }] },
    // a straw hat and a grass skirt: arms like waves
    chillout: { dance: [2, 2, 0, 4, 1, 0, "waveL waveR lowL lowR open hips leanL leanR"], cast: [
        { skin: TAN, hat: ["bucket", YELLOW], top: RAINBOW[5], fore: TAN, legs: WHITE, shin: TAN, shoes: TAN },
        { hair: ["long", ORANGE], hat: ["flowers", PASTEL[0]], top: PASTEL[1], fore: PEACH, body: "skirt", skirt: LIME, legs: PEACH, shoes: PEACH }] },
    // a figure that falls apart and a scientist: nothing repeats evenly
    idm: { dance: [0.5, 0, 0, 0, 0, 3, "glitchA stand glitchB tutA stand glitchA tutB robotC"], cast: [
        { head: "square", skin: CYAN, face: "pixel", top: WHITE, legs: SLATE, shoes: CYAN, glitch: 1 },
        { hair: ["spikes", SILVER], face: "glasses", top: WHITE, body: "coat", legs: SLATE, shoes: SILVER }] },
    // a mohawk in a gas mask and a cyber goth: hammer and stomp
    hardtechno: { dance: [0.5, 1, 3, 0, 0, 0, "hammerL hammerR stompA stompB hammerR hammerL pumpR pumpL"], cast: [
        { hair: ["mohawk", RED], face: "gas", top: SLATE, stripe: RED, legs: SLATE, shoes: WHITE },
        { skin: WHITE, hair: ["dreads", LIME], face: "visor", eye: LIME, top: PLUM, legs: SLATE, shin: LIME, shoes: SILVER }] },
    // bucket hats: low, loose, on bent knees
    amapiano: { dance: [1, 2, 2, 2, 1, 0, "lowL heelL lowR heelR hipL snapL hipR snapR"], cast: [
        { skin: BROWN, hat: ["bucket", WHITE], top: YELLOW, fore: BROWN, legs: WHITE, shoes: YELLOW },
        { skin: BROWN, hair: ["bun", ORANGE_DIM], top: RAINBOW[5], fore: BROWN, body: "skirt", skirt: ORANGE, legs: BROWN, shoes: WHITE }] },
    // a head wrap and a drummer: stomp, open arms, hips
    afro: { dance: [1, 1, 3, 3, 1, 0, "stompA open stompB open hipL shakeA hipR shakeB"], cast: [
        { skin: BROWN, hat: ["wrap", YELLOW], top: RAINBOW[1], stripe: YELLOW, fore: BROWN, body: "dress", legs: BROWN, shoes: BROWN },
        { skin: BROWN, hair: ["short", ORANGE_DIM], top: GREEN, fore: BROWN, legs: YELLOW, shoes: BROWN, prop: ["drum", ORANGE_DIM] }] },
    // red eyes under a hood and a skeleton in a cap: slow and menacing
    phonk: { dance: [2, 1, 1, 0, 0, 0, "cross nodA leanL nodA cross nodA leanR dab"], cast: [
        { skin: NIGHT, hat: ["hood", SLATE], face: "red", top: SLATE, chain: YELLOW, legs: SLATE, shoes: WHITE, hands: PEACH },
        { body: "bones", head: "skull", skin: WHITE, hat: ["cap", RED], top: WHITE, legs: WHITE, shoes: WHITE, thick: 1 }] },
    // huge pigtails on platforms and a small angel: everything at once
    hyperpop: { dance: [0.5, 0, 5, 0, 1, 1, "star heart jump flossL flossR jump glitchA clapUp"], cast: [
        { hair: ["twin", RAINBOW[10]], face: "happy", top: CYAN, body: "skirt", skirt: YELLOW, legs: WHITE, shoes: RAINBOW[10], tall: 1 },
        { hair: ["short", WHITE], hat: ["halo", YELLOW], top: PASTEL[0], legs: PASTEL[5], shoes: WHITE, back: ["wings", WHITE] }] },
    // club kids: knees up, the feet never rest
    jersey: { dance: [0.5, 1, 3, 0, 1, 0, "runA runB kneeL kneeR runB runA kickL kickR"], cast: [
        { skin: BROWN, hat: ["cap", RAINBOW[8]], top: WHITE, fore: BROWN, legs: RED, shin: BROWN, shoes: WHITE },
        { skin: TAN, hair: ["bun", ORANGE_DIM], top: RAINBOW[10], legs: BLUE, shoes: WHITE }] },
    // cat ears and a scarf: para para, a dance of the arms
    nightcore: { dance: [0.5, 1, 3, 0, 0, 0, "tee crown tutA tutB vee cross pointR pointL"], cast: [
        { hair: ["long", PASTEL[0]], hat: ["catears", PASTEL[0]], face: "big", eye: SKY, top: WHITE, stripe: BLUE, body: "skirt", skirt: BLUE, legs: WHITE, shoes: ORANGE_DIM },
        { hair: ["spikes", SKY], top: BLUE, legs: SLATE, shoes: WHITE, back: ["scarf", RED] }] },
    // neon tracksuits of the nineties: the running man
    eurodance: { dance: [1, 1, 3, 3, 1, 0, "runA runB pointR hips runB runA pointL clap"], cast: [
        { hair: ["short", YELLOW], top: RAINBOW[8], stripe: LIME, legs: RAINBOW[10], shoes: WHITE },
        { skin: TAN, hair: ["pony", YELLOW], top: LIME, fore: TAN, legs: RAINBOW[0], shoes: WHITE, tall: 1 }] },
    // a hero and a robot of big pixels: two frames of walking and a jump
    chiptune: { dance: [1, 0, 0, 2, 0, 0, "heelL heelR heelL jump heelR heelL heelR star"], cast: [
        { grid: 2, head: "square", hat: ["band", ORANGE], face: "pixel", top: LIME, legs: ORANGE_DIM, shoes: WHITE },
        { grid: 2, body: "robot", head: "square", skin: SILVER, face: "visor", eye: RED, hat: ["antennae", SILVER], top: SKY, legs: SILVER, shoes: SLATE }] },
    // a gnome under a mushroom and a forest hippie: the skank, but slower
    psydub: { dance: [2, 2, 1, 3, 1, 1, "kneeL waveL kneeR waveR lowL reach lowR open"], cast: [
        { hat: ["mushroom", RED], face: "beard", beard: WHITE, top: GREEN, legs: ORANGE_DIM, shoes: ORANGE_DIM },
        { skin: TAN, hair: ["dreads", ORANGE_DIM], hat: ["flowers", YELLOW], top: RAINBOW[3], body: "coat", legs: RAINBOW[9], shoes: TAN, prop: ["maracas", YELLOW] }] },
    // a three-eyed alien and a cyber shaman: right angles and hips
    psybass: { dance: [1, 0, 2, 0, 1, 0, "tutA tutB robotA hipL tutB tutA robotB hipR"], cast: [
        { head: "alien", skin: SKY, face: "third", top: RAINBOW[9], legs: RAINBOW[6], shoes: WHITE, hands: CYAN },
        { skin: TAN, hair: ["mohawk", RAINBOW[5]], face: "visor", eye: CYAN, top: SLATE, stripe: LIME, legs: SLATE, shoes: LIME }] },
    // long hair and a robot, both with guitars: headbanging
    metal: { dance: [0.5, 1, 0, 0, 0, 0, "bang bangUp bang bangUp strumA horns strumB horns"], cast: [
        { hair: ["long", YELLOW], top: SLATE, fore: PEACH, legs: SLATE, shoes: WHITE, prop: ["guitar", RED] },
        { body: "robot", head: "square", skin: SILVER, face: "visor", eye: RED, top: SLATE, stripe: RED, legs: SILVER, shoes: SLATE, thick: 3, prop: ["guitar", CYAN] }] }
};

// The dancers of the styles by decade.
TROUPES.disco = { dance: [1, 1, 3, 4, 1, 0, "pointR downR pointR downR stepL clap stepR clap"], cast: [
    { hair: ["short", ORANGE_DIM], top: WHITE, stripe: NIGHT, legs: WHITE, shoes: SILVER, chain: YELLOW },
    { skin: BROWN, hair: ["afro", ORANGE_DIM], top: RAINBOW[2], body: "dress", legs: BROWN, shoes: YELLOW, tall: 1 }] };
TROUPES.funk = { dance: [1, 1, 3, 2, 1, 0, "hipL kneeL hipR kneeR lowL clap lowR clap"], cast: [
    { skin: BROWN, hair: ["afro", ORANGE_DIM], face: "shades", top: ORANGE, stripe: YELLOW, legs: RAINBOW[9], shoes: WHITE, tall: 1 },
    { skin: TAN, hat: ["bucket", RED], top: YELLOW, fore: TAN, legs: ORANGE_DIM, shoes: WHITE, prop: ["guitar", ORANGE] }] };
TROUPES.kosmische = { dance: [4, 2, 0, 2, 0, 1, "float tutA float tutB open reach"], cast: [
    { head: "square", skin: WHITE, face: "visor", eye: CYAN, top: WHITE, stripe: ORANGE, legs: WHITE, shoes: SILVER, hover: 1 },
    { hair: ["long", ORANGE_DIM], hat: ["band", YELLOW], face: "beard", beard: ORANGE_DIM, top: PLUM, legs: ORANGE_DIM, shoes: TAN }] };
TROUPES.synthpop = { dance: [1, 1, 2, 0, 1, 0, "robotA hips robotB hips tee clap pointR pointL"], cast: [
    { hair: ["spikes", BLUE], top: WHITE, stripe: RED, legs: SLATE, shoes: WHITE },
    { hair: ["bob", PASTEL[0]], face: "shades", top: RAINBOW[8], legs: RAINBOW[10], shoes: WHITE, hands: WHITE }] };
TROUPES.italo = { dance: [1, 1, 3, 0, 1, 0, "kneeL up2 kneeR up2 stepL tee stepR tee"], cast: [
    { hair: ["short", ORANGE_DIM], face: "beard", beard: ORANGE_DIM, top: SKY, stripe: PEACH, chain: YELLOW, legs: WHITE, shoes: WHITE },
    { hair: ["pony", YELLOW], hat: ["band", RAINBOW[10]], top: RAINBOW[10], fore: PEACH, legs: PEACH, shin: YELLOW, shoes: WHITE }] };
TROUPES.electro = { dance: [1, 0, 0, 0, 0, 2, "robotA robotC robotB robotC tutA tutB waveL waveR"], cast: [
    { skin: BROWN, hat: ["cap", RED], face: "visor", eye: WHITE, top: RED, stripe: WHITE, legs: RED, shoes: WHITE, hands: WHITE },
    { skin: TAN, hat: ["bucket", SKY], face: "shades", phones: YELLOW, top: SKY, legs: SKY, shin: WHITE, shoes: WHITE, hands: WHITE }] };
TROUPES.acid = { dance: [0.5, 1, 3, 2, 1, 0, "pumpR rollA pumpL rollB stepL boxA stepR boxB"], cast: [
    { hat: ["bucket", YELLOW], face: "happy", top: YELLOW, legs: SKY, shoes: WHITE },
    { skin: TAN, hair: ["long", ORANGE_DIM], hat: ["band", RED], top: WHITE, stripe: YELLOW, legs: RAINBOW[5], shoes: YELLOW }] };
TROUPES.triphop = { dance: [2, 2, 1, 2, 0, 1, "nodA leanL nodB leanR snapL nodA snapR nodB"], cast: [
    { hat: ["hood", TEAL], phones: SILVER, top: TEAL, legs: SLATE, shoes: WHITE },
    { skin: BROWN, hair: ["long", ORANGE_DIM], top: RED, body: "dress", legs: BROWN, shoes: SILVER }] };
TROUPES.bigbeat = { dance: [1, 1, 4, 0, 0, 0, "jump pumpR jump pumpL kickL star kickR squat"], cast: [
    { hair: ["short", YELLOW], face: "shades", top: RAINBOW[1], stripe: YELLOW, fore: PEACH, legs: SLATE, shoes: WHITE },
    { skin: TAN, hair: ["twin", RED], top: WHITE, legs: SLATE, shoes: ORANGE, tall: 1 }] };
TROUPES.gabber = { dance: [0.5, 0, 4, 0, 1, 0, "hakA hakB hakA kneeL hakB hakA hakB kneeR"], cast: [
    { top: GREEN, stripe: ORANGE, legs: SKY, shoes: WHITE },
    { hair: ["pony", ORANGE], top: RAINBOW[0], stripe: WHITE, legs: RAINBOW[0], shoes: WHITE }] };
TROUPES.electrohouse = { dance: [0.5, 1, 2, 0, 1, 0, "waveL crown waveR crown tutA pumpR tutB pumpL"], cast: [
    { hair: ["spikes", ORANGE_DIM], face: "visor", eye: WHITE, top: LIME, legs: SLATE, shoes: RAINBOW[10] },
    { hair: ["bob", PLUM], top: RAINBOW[10], legs: CYAN, shoes: WHITE, prop: ["glow", CYAN] }] };
TROUPES.minimal = { dance: [1, 2, 1, 2, 1, 0, "nodB stepL nodB stepR nodA hips nodA hips"], cast: [
    { hair: ["short", SILVER], face: "glasses", top: SLATE, legs: NIGHT, shoes: WHITE },
    { hair: ["bun", YELLOW], top: WHITE, legs: NIGHT, shoes: SILVER }] };
TROUPES.tropical = { dance: [1, 2, 2, 3, 1, 0, "hipL waveL hipR waveR stepL clapUp stepR clapUp"], cast: [
    { skin: TAN, hat: ["cap", WHITE], top: RAINBOW[4], fore: TAN, legs: ORANGE, shin: TAN, shoes: TAN, prop: ["maracas", RED] },
    { skin: BROWN, hair: ["long", ORANGE_DIM], hat: ["flowers", RED], top: RAINBOW[10], fore: BROWN, body: "skirt", skirt: RAINBOW[1], legs: BROWN, shoes: BROWN }] };
TROUPES.vaporwave = { dance: [2, 2, 0, 2, 0, 1, "tee leanL tee leanR dab open flossL flossR"], cast: [
    { skin: SILVER, hair: ["short", SILVER], face: "shades", eye: RAINBOW[10], top: SILVER, body: "robe" },
    { hair: ["short", ORANGE_DIM], phones: PLUM, top: WHITE, stripe: RAINBOW[8], legs: PLUM, shoes: SILVER }] };
TROUPES.drill = { dance: [1, 1, 2, 0, 1, 0, "leanL woah leanR woah hipL dab hipR squat"], cast: [
    { skin: BROWN, hat: ["hood", SLATE], top: SLATE, body: "coat", legs: SLATE, shoes: WHITE, hands: BROWN },
    { skin: TAN, hat: ["cap", SLATE], top: SKY, stripe: WHITE, chain: SILVER, legs: SKY, shoes: WHITE }] };

// The names of the poses become the poses, and what a look leaves out is
// filled in.
(function () {
    for (var id in TROUPES) {
        var troupe = TROUPES[id];
        var names = troupe.dance[6].split(" ");
        troupe.poses = [];
        for (var i = 0; i < names.length; i++) {
            troupe.poses.push(POSES[names[i]]);
        }
        for (var c = 0; c < troupe.cast.length; c++) {
            var look = troupe.cast[c];
            look.skin = look.skin === undefined ? PEACH : look.skin;
            look.top = look.top === undefined ? WHITE : look.top;
            look.legs = look.legs === undefined ? SLATE : look.legs;
            look.shin = look.shin === undefined ? look.legs : look.shin;
            look.sleeve = look.sleeve === undefined ? look.top : look.sleeve;
            look.fore = look.fore === undefined ? look.sleeve : look.fore;
            look.hands = look.hands === undefined ? look.skin : look.hands;
            look.shoes = look.shoes === undefined ? WHITE : look.shoes;
            look.eye = look.eye === undefined ? INK : look.eye;
            look.beard = look.beard === undefined ? SILVER : look.beard;
            look.thick = look.thick || 2;
        }
    }
}());

// Where in the music the dancers are, in beats.
var dance = { phase: 0, live: false, song: 0, tempo: 120, liveAt: -1000 };

// Moves the count on by one tick. Three times a second it asks Ableton
// whether the song is playing and where it is.
function danceTick() {
    if (clock % 4 === 0) {
        dance.live = false;
        if (typeof LiveAPI !== "undefined" && truthy(liveGet("live_set", "is_playing")) === true) {
            var song = Number(liveGet("live_set", "current_song_time"));
            var tempo = Number(liveGet("live_set", "tempo"));
            if (!isNaN(song) && tempo > 0) {
                dance.live = true;
                dance.song = song;
                dance.tempo = tempo;
                dance.liveAt = clock;
            }
        }
    }
    if (dance.live) {
        // a very fast song is danced at half its speed
        var rate = dance.tempo > 150 ? 0.5 : 1;
        dance.phase = (dance.song + (clock - dance.liveAt) * TICK_MS * dance.tempo / 60000) * rate;
        return;
    }
    var beat = danceBeat();
    if (beat <= 0) {
        var style = STYLES[jam.style];
        beat = 120000 / (style.tempo[0] + style.tempo[1]);
        while (beat < 350) {
            beat *= 2;
        }
    }
    dance.phase += TICK_MS / beat;
}

// A note of the player puts the dancers on the beat: the nearest half of it.
function danceOnset() {
    if (inJam() && !dance.live) {
        dance.phase = Math.round(dance.phase * 2) / 2;
    }
}

function blendPose(from, to, share) {
    var out = [];
    for (var i = 0; i < 13; i++) {
        out.push(from[i] + (to[i] - from[i]) * share);
    }
    return out;
}

// The same pose seen in a mirror.
function mirrored(p) {
    return [-p[0], p[1], -p[2], -p[5], p[6], -p[3], p[4], -p[9], p[10], -p[7], p[8], p[11], -p[12]];
}

// The pose of the dance at a moment given in beats.
function dancePose(troupe, phase, second) {
    var d = troupe.dance;
    var poses = troupe.poses;
    var at = phase / d[0] - (second ? d[5] : 0);
    var index = Math.floor(at);
    var part = at - index;
    var share = d[1] === 0 ? 0 : d[1] === 1 ? Math.max(0, (part - 0.6) / 0.4) : 0.5 - Math.cos(part * Math.PI) / 2;
    var p = blendPose(poses[wrapTo(index, poses.length)], poses[wrapTo(index + 1, poses.length)], share);
    return second && d[4] ? mirrored(p) : p;
}

// How much of the dance the dancers put in: they mark it faintly while
// nobody plays, try it when a note sounds or Ableton plays, and dance it in
// full once the playing is good.
function danceShare() {
    if (mood >= 2) {
        return 1;
    }
    if (mood === 1) {
        return 0.8;
    }
    return dance.live ? 0.8 : clock - lastOn < 24 ? 0.55 : 0.15;
}

// What one dancer does right now. "behind" is for the trail: the pose a
// part of a beat ago. Returns the pose and how far the dancer has travelled.
function troupePose(troupe, second, behind) {
    var p;
    if (mood <= -1) {
        // the playing hurts: hands over the ears, shaking
        p = POSES.ouch.slice();
        p[0] = (clock % 2 === 0 ? 1 : -1) * (mood === -2 ? 2 : 1);
        return { pose: p, travel: 0 };
    }
    var d = troupe.dance;
    var phase = dance.phase - behind;
    var share = danceShare();
    p = blendPose(POSES.stand, dancePose(troupe, phase, second), share);
    // the bounce: down on the beat, up between the beats
    p[1] += d[2] * share * (0.5 + 0.5 * Math.cos(phase * 2 * Math.PI));
    // a key just pressed gives a little hop
    if (share > 0.5 && clock - lastOn < 2 && behind === 0) {
        p[1] -= 2;
    }
    return { pose: p, travel: d[3] * share * Math.sin(phase * Math.PI / 2) * (second && d[4] ? -1 : 1) };
}

// The elbow or the knee between two ends of a limb: where its halves meet.
// wantX, wantY say which way the joint should stick out. Returns the start,
// the joint and the end (pulled in if the end is out of reach).
function bend(ax, ay, bx, by, half, wantX, wantY) {
    var dx = bx - ax;
    var dy = by - ay;
    var far = Math.sqrt(dx * dx + dy * dy);
    if (far < 0.5) {
        return [ax, ay, ax + wantX * half, ay, ax, ay + 1];
    }
    if (far >= half * 2) {
        return [ax, ay, ax + dx / far * half, ay + dy / far * half, ax + dx / far * half * 2, ay + dy / far * half * 2];
    }
    var out = Math.sqrt(half * half - far * far / 4);
    var nx = -dy / far;
    var ny = dx / far;
    if (nx * wantX + ny * wantY < 0) {
        nx = -nx;
        ny = -ny;
    }
    return [ax, ay, ax + dx / 2 + nx * out, ay + dy / 2 + ny * out, bx, by];
}

// All the joints of a dancer in a pose, standing at cx on the stage.
function figure(look, p, cx) {
    var f = {};
    var lift = look.hover ? 5 + Math.round(Math.sin(clock / 5 + cx) * 2) : 0;
    var air = p[1] < 0 ? -p[1] : 0;     // a jump takes the feet off the ground
    var jolt = look.glitch && hash(Math.floor(clock / 2)) % 3 === 0 ? hash(clock) % 7 - 3 : 0;
    f.ground = G - lift;
    f.lift = lift;
    f.cx = cx;
    f.hipX = cx + p[0];
    f.hipY = f.ground - HIP + p[1];
    f.shX = f.hipX + p[2] + jolt;
    f.shY = f.hipY - TORSO;
    f.headX = f.shX + p[2] * 0.3 + p[12];
    f.headY = f.shY - 10 + p[11];
    f.nod = p[11];
    f.lean = p[2];
    f.legs = [bend(f.hipX - 2, f.hipY, cx - 4 + p[7], f.ground - p[8] - air, LEG, -1, -0.3),
              bend(f.hipX + 2, f.hipY, cx + 4 + p[9], f.ground - p[10] - air, LEG, 1, -0.3)];
    f.arms = [bend(f.shX - 4, f.shY + 1, f.shX - 4 + p[3], f.shY + 1 + p[4], ARM, -1, 0.7),
              bend(f.shX + 4, f.shY + 1, f.shX + 4 + p[5], f.shY + 1 + p[6], ARM, 1, 0.7)];
    if (look.grid) {
        // big pixels: everything sits on a grid
        var names = ["hipX", "hipY", "shX", "shY", "headX", "headY"];
        var i, k;
        for (i = 0; i < names.length; i++) {
            f[names[i]] = Math.round(f[names[i]] / look.grid) * look.grid;
        }
        for (i = 0; i < 2; i++) {
            for (k = 0; k < 6; k++) {
                f.legs[i][k] = Math.round(f.legs[i][k] / look.grid) * look.grid;
                f.arms[i][k] = Math.round(f.arms[i][k] / look.grid) * look.grid;
            }
        }
    }
    return f;
}

// One half of a limb, as a chain of squares around the line between its ends.
function bone(x0, y0, x1, y1, colour, thick) {
    line(x0 - thick / 2, y0 - thick / 2, x1 - thick / 2, y1 - thick / 2, colour, thick);
}

// A dancer is painted in layers, each over the one before. "tint" paints a
// whole layer in one colour: the trail behind the dancer at the top mood.

// Layer 1: what hangs behind the body.
function figureBack(look, f) {
    var hair = look.hair;
    var back = look.back;
    var sway = -f.lean * 0.6;       // what hangs lags behind the body
    var i;
    if (look.hover) {
        box(f.cx - 6, G + 1, 12, 1, STEEL);     // the shadow of one who hovers
    }
    if (back && back[0] === "cape") {
        for (i = 0; i < 4; i++) {
            box(f.shX - 5 - i + sway * i / 3, f.shY + i * 4, 10 + i * 2, 4, back[1]);
        }
    }
    if (back && back[0] === "wings") {
        var flap = Math.round(Math.sin(dance.phase * Math.PI) * 2);
        box(f.shX - 12, f.shY - 3 + flap, 7, 5, back[1]);
        box(f.shX - 10, f.shY + 2 + flap, 5, 4, back[1]);
        box(f.shX + 5, f.shY - 3 + flap, 7, 5, back[1]);
        box(f.shX + 5, f.shY + 2 + flap, 5, 4, back[1]);
    }
    if (back && back[0] === "tail") {
        var wag = Math.round(Math.sin(dance.phase * Math.PI) * 3);
        line(f.hipX + 2, f.hipY - 2, f.hipX + 8, f.hipY - 4, back[1], 2);
        line(f.hipX + 8, f.hipY - 4, f.hipX + 10 + wag, f.hipY - 10, back[1], 2);
    }
    if (back && back[0] === "scarf") {
        line(f.shX + 2, f.shY - 1, f.shX + 11 + sway * 2, f.shY + 2 + Math.round(Math.sin(clock / 2) * 2), back[1], 2);
    }
    if (!hair) {
        return;
    }
    if (hair[0] === "long" && f.nod < 4) {
        box(f.headX - 5 + sway, f.headY + 2, 10, 12, hair[1]);
    } else if (hair[0] === "afro") {
        disc(f.headX, f.headY + 3, 7, hair[1]);
    } else if (hair[0] === "dreads") {
        for (i = 0; i < 5; i++) {
            line(f.headX - 5 + i * 2, f.headY + 2, f.headX - 6 + i * 2.5 + sway * (1 + i % 2), f.headY + 11 + (i % 2) * 2, hair[1], 2);
        }
    } else if (hair[0] === "pony") {
        line(f.headX + 3, f.headY + 2, f.headX + 8 + sway * 2, f.headY + 10, hair[1], 2);
    } else if (hair[0] === "twin") {
        line(f.headX - 6, f.headY + 2, f.headX - 9 + sway, f.headY + 11, hair[1], 2);
        line(f.headX + 4, f.headY + 2, f.headX + 7 + sway, f.headY + 11, hair[1], 2);
    } else if (hair[0] === "bob") {
        box(f.headX - 5, f.headY + 1, 10, 8, hair[1]);
    }
}

// Layer 2: the legs.
function figureLegs(look, f, tint) {
    if (look.body === "robe") {
        return;
    }
    for (var s = 0; s < 2; s++) {
        var j = f.legs[s];
        bone(j[0], j[1], j[2], j[3], tint >= 0 ? tint : look.legs, look.thick);
        bone(j[2], j[3], j[4], j[5], tint >= 0 ? tint : look.shin, look.thick);
    }
}

// Layer 3: the body, what hangs from the waist, the shoes.
function figureBody(look, f, tint) {
    var top = tint >= 0 ? tint : look.top;
    var plain = tint >= 0;
    var i, x, w, h;
    if (look.body === "bones" && !plain) {
        bone(f.shX, f.shY, f.hipX, f.hipY, top, 1);
        for (i = 0; i < 3; i++) {
            box(f.shX + (f.hipX - f.shX) * i / 4 - 3, f.shY + 1 + i * 3, 7, 1, top);
        }
        box(f.hipX - 3, f.hipY - 1, 6, 2, top);
    } else if (look.body === "robe") {
        var rows = Math.ceil((f.ground - f.shY) / 4);
        for (i = 0; i < rows; i++) {
            w = 8 + i;
            x = f.shX + (f.hipX - f.shX) * Math.min(1, i * 4 / TORSO);
            box(x - w / 2, f.shY + i * 4, w, Math.min(4, f.ground - f.shY - i * 4), top);
        }
        return;
    } else {
        for (i = 0; i < 4; i++) {
            x = f.shX + (f.hipX - f.shX) * i / 3;
            w = look.body === "robot" ? 10 : i === 3 ? 6 : 8;
            h = i === 3 ? TORSO - 9 : 3;
            if (look.stripe !== undefined && !plain) {
                box(x - w / 2, f.shY + i * 3, w / 2 - 1, h, top);
                box(x - 1, f.shY + i * 3, 2, h, look.stripe);
                box(x + 1, f.shY + i * 3, w / 2 - 1, h, top);
            } else {
                box(x - w / 2, f.shY + i * 3, w, h, top);
            }
        }
    }
    if (!plain) {
        var skirt = look.skirt === undefined ? top : look.skirt;
        if (look.body === "skirt") {
            box(f.hipX - 5, f.hipY, 10, 2, skirt);
            box(f.hipX - 6, f.hipY + 2, 12, 2, skirt);
            box(f.hipX - 7, f.hipY + 4, 14, 2, skirt);
        } else if (look.body === "tutu") {
            box(f.hipX - 9, f.hipY, 18, 2, skirt);
            box(f.hipX - 6, f.hipY + 2, 12, 2, skirt);
        } else if (look.body === "dress") {
            box(f.hipX - 5, f.hipY, 10, 3, skirt);
            box(f.hipX - 6, f.hipY + 3, 12, 3, skirt);
            box(f.hipX - 7, f.hipY + 6, 14, 3, skirt);
        } else if (look.body === "coat") {
            box(f.hipX - 4, f.hipY, 9, 4, skirt);
            box(f.hipX - 5, f.hipY + 4, 10, 4, skirt);
        }
    }
    for (i = 0; i < 2; i++) {
        var tall = look.tall ? 4 : 2;
        box(f.legs[i][4] - 2, f.legs[i][5] - tall + 1, 4, tall, plain ? tint : look.shoes);
    }
}

// Layer 4: the arms, and a hood, which the head then sits in.
function figureArms(look, f, tint) {
    for (var s = 0; s < 2; s++) {
        var j = f.arms[s];
        bone(j[0], j[1], j[2], j[3], tint >= 0 ? tint : look.sleeve, look.thick);
        bone(j[2], j[3], j[4], j[5], tint >= 0 ? tint : look.fore, look.thick);
    }
    if (tint < 0 && look.hat && look.hat[0] === "hood") {
        box(f.headX - 5, f.headY - 2, 10, 11, look.hat[1]);
    }
}

// Layer 5: the head.
function figureHead(look, f, tint) {
    var skin = tint >= 0 ? tint : look.skin;
    var x = f.headX;
    var y = f.headY;
    box(x - 1, y + 8, 2, 2, skin);
    if (look.head === "square") {
        box(x - 4, y, 8, 8, skin);
    } else if (look.head === "alien") {
        box(x - 5, y - 2, 10, 6, skin);
        box(x - 3, y + 4, 6, 3, skin);
        box(x - 2, y + 7, 4, 1, skin);
    } else if (look.head === "smiley") {
        box(x - 4, y - 3, 8, 11, skin);
        box(x - 6, y - 1, 12, 7, skin);
    } else {
        box(x - 3, y, 6, 8, skin);
        box(x - 4, y + 1, 8, 6, skin);
    }
}

// Layer 6: the face, the hair on top, the hat, a chain on the chest.
function figureFace(look, f) {
    var x = f.headX;
    var y = f.headY;
    var eye = look.eye;
    var face = look.face || "eyes";
    var hair = look.hair;
    var hat = look.hat;
    var covered = hat && /^(cap|beanie|bucket|wrap|rasta|mushroom|hood)$/.test(hat[0]);
    var i;
    // long hair falls over the face when the head goes down
    var veiled = hair && hair[0] === "long" && f.nod >= 4;
    if (hair && !covered) {
        if (hair[0] === "mohawk") {
            box(x - 1, y - 5, 2, 6, hair[1]);
        } else if (hair[0] === "spikes") {
            box(x - 4, y - 3, 2, 4, hair[1]);
            box(x - 1, y - 4, 2, 5, hair[1]);
            box(x + 2, y - 3, 2, 4, hair[1]);
        } else if (hair[0] === "afro") {
            box(x - 5, y - 3, 10, 4, hair[1]);
        } else {
            box(x - 4, y - 1, 8, 3, hair[1]);
            if (hair[0] === "bun") {
                box(x - 2, y - 4, 4, 3, hair[1]);
            }
        }
    }
    if (veiled) {
        box(x - 4, y + 1, 8, 9, hair[1]);
    } else if (look.head === "smiley") {
        box(x - 3, y, 2, 3, eye);
        box(x + 1, y, 2, 3, eye);
        box(x - 3, y + 5, 6, 1, eye);
        box(x - 4, y + 4, 1, 1, eye);
        box(x + 3, y + 4, 1, 1, eye);
    } else if (face === "shades") {
        box(x - 4, y + 3, 8, 2, eye);
    } else if (face === "big") {
        box(x - 4, y + 1, 3, 4, eye);
        box(x + 1, y + 1, 3, 4, eye);
    } else if (face === "visor") {
        box(x - 4, y + 2, 8, 3, eye);
    } else if (face === "gas") {
        box(x - 4, y + 2, 8, 2, CYAN);
        box(x - 3, y + 5, 6, 3, STEEL);
        box(x - 5, y + 6, 2, 2, SILVER);
        box(x + 3, y + 6, 2, 2, SILVER);
    } else if (face === "calm") {
        box(x - 3, y + 4, 2, 1, eye);
        box(x + 1, y + 4, 2, 1, eye);
    } else if (face === "glasses") {
        box(x - 4, y + 3, 3, 3, WHITE);
        box(x + 1, y + 3, 3, 3, WHITE);
        box(x - 1, y + 4, 2, 1, WHITE);
    } else if (face === "mask") {
        box(x - 4, y - 1, 8, 10, RED);
    } else if (face === "skull" || look.head === "skull") {
        box(x - 3, y + 2, 2, 3, eye);
        box(x + 1, y + 2, 2, 3, eye);
        box(x - 2, y + 6, 1, 2, eye);
        box(x, y + 6, 1, 2, eye);
        box(x + 2, y + 6, 1, 2, eye);
    } else {
        box(x - 3, y + 3, 2, 2, face === "red" ? RED : eye);
        box(x + 1, y + 3, 2, 2, face === "red" ? RED : eye);
        if (face === "happy" || face === "pixel") {
            box(x - 2, y + 6, 4, 1, eye);
        } else if (face === "third") {
            box(x - 1, y - 1, 2, 2, YELLOW);
        } else if (face === "paint") {
            box(x - 4, y + 6, 2, 1, WHITE);
            box(x + 2, y + 6, 2, 1, WHITE);
        } else if (face === "beard") {
            box(x - 4, y + 6, 8, 4, look.beard);
        }
    }
    if (look.phones !== undefined) {
        box(x - 4, y - 2, 8, 1, look.phones);
        box(x - 6, y + 2, 2, 4, look.phones);
        box(x + 4, y + 2, 2, 4, look.phones);
    }
    if (hat) {
        var c = hat[1];
        if (hat[0] === "cap") {
            box(x - 4, y - 2, 8, 3, c);
            box(x + 2, y + 1, 5, 1, c);
        } else if (hat[0] === "beanie") {
            box(x - 4, y - 3, 8, 4, c);
            box(x - 1, y - 5, 2, 2, c);
        } else if (hat[0] === "rasta") {
            box(x - 5, y - 5, 10, 2, RED);
            box(x - 5, y - 3, 10, 2, YELLOW);
            box(x - 4, y - 1, 8, 2, GREEN);
        } else if (hat[0] === "bucket") {
            box(x - 4, y - 3, 8, 3, c);
            box(x - 6, y, 12, 1, c);
        } else if (hat[0] === "wrap") {
            box(x - 4, y - 4, 8, 5, c);
            box(x - 3, y - 7, 6, 3, c);
        } else if (hat[0] === "mushroom") {
            box(x - 8, y - 2, 16, 3, c);
            box(x - 6, y - 5, 12, 3, c);
            box(x - 3, y - 7, 6, 2, c);
        } else if (hat[0] === "catears") {
            box(x - 4, y - 3, 2, 3, c);
            box(x + 2, y - 3, 2, 3, c);
        } else if (hat[0] === "antennae") {
            box(x - 3, y - 5, 1, 5, c);
            box(x + 2, y - 5, 1, 5, c);
            box(x - 4, y - 7, 3, 2, c);
            box(x + 1, y - 7, 3, 2, c);
        } else if (hat[0] === "halo") {
            box(x - 3, y - 6, 6, 1, c);
            box(x - 3, y - 4, 6, 1, c);
            box(x - 4, y - 5, 1, 1, c);
            box(x + 3, y - 5, 1, 1, c);
        } else if (hat[0] === "feathers") {
            box(x - 4, y - 1, 8, 2, c);
            box(x - 3, y - 6, 2, 5, RAINBOW[3]);
            box(x - 1, y - 8, 2, 7, RAINBOW[1]);
            box(x + 1, y - 6, 2, 5, RAINBOW[6]);
        } else if (hat[0] === "flowers") {
            box(x - 4, y - 1, 8, 2, GREEN);
        } else if (hat[0] === "band") {
            box(x - 4, y, 8, 2, c);
            box(x + 4, y + 1, 3, 1, c);
        }
    }
    if (look.chain !== undefined) {
        box(f.shX - 2, f.shY + 1, 1, 3, look.chain);
        box(f.shX + 1, f.shY + 1, 1, 3, look.chain);
        box(f.shX - 1, f.shY + 4, 2, 2, look.chain);
    }
}

// Layer 7: the hands, what they hold, and the small things on hats and masks.
function figureHands(look, f) {
    var x = f.headX;
    var y = f.headY;
    var prop = look.prop;
    var lively = mood >= 2;
    var s, j, far, ux, uy;
    for (s = 0; s < 2; s++) {
        j = f.arms[s];
        box(j[4] - 1, j[5] - 1, 2, 2, look.hands);
    }
    if (look.hat && look.hat[0] === "mushroom") {
        box(x - 5, y - 4, 2, 2, WHITE);
        box(x + 3, y - 3, 2, 2, WHITE);
        box(x - 1, y - 6, 2, 1, WHITE);
    } else if (look.hat && look.hat[0] === "flowers") {
        box(x - 4, y - 2, 2, 2, look.hat[1]);
        box(x - 1, y - 3, 2, 2, WHITE);
        box(x + 2, y - 2, 2, 2, look.hat[1]);
    }
    if (look.face === "mask") {
        box(x - 3, y + 2, 2, 2, WHITE);
        box(x + 1, y + 2, 2, 2, WHITE);
        box(x - 2, y + 6, 4, 1, YELLOW);
    }
    if (look.body === "robot") {
        // a lamp on the chest blinks with the beat
        box(f.shX - 3, f.shY + 2, 2, 2, Math.floor(dance.phase * 2) % 2 === 0 ? YELLOW : RED);
    }
    if (!prop) {
        return;
    }
    var hand = f.arms[1];           // the right hand holds what one hand holds
    if (prop[0] === "baton") {
        line(hand[4], hand[5], hand[4] + 4, hand[5] - 7, prop[1], 1);
    } else if (prop[0] === "glow" || prop[0] === "maracas") {
        for (s = 0; s < 2; s++) {
            j = f.arms[s];
            far = Math.max(1, Math.sqrt((j[4] - j[2]) * (j[4] - j[2]) + (j[5] - j[3]) * (j[5] - j[3])));
            ux = (j[4] - j[2]) / far;
            uy = (j[5] - j[3]) / far;
            if (prop[0] === "glow") {
                line(j[4] + ux * 2 - 1, j[5] + uy * 2 - 1, j[4] + ux * 8 - 1, j[5] + uy * 8 - 1,
                     lively ? RAINBOW[(clock + s * 5) % RAINBOW.length] : prop[1], 2);
            } else {
                box(j[4] + ux * 3 - 2, j[5] + uy * 3 - 2, 4, 4, prop[1]);
            }
        }
    } else if (prop[0] === "staff" || prop[0] === "spear") {
        box(hand[4], hand[5] - 15, 1, Math.max(1, f.ground - hand[5] + 15), prop[1]);
        if (prop[0] === "spear") {
            box(hand[4] - 1, hand[5] - 18, 3, 3, WHITE);
        }
    } else if (prop[0] === "flag") {
        box(hand[4], hand[5] - 15, 1, 15, SILVER);
        for (s = 0; s < 4; s++) {
            box(hand[4] + 1 + s * 3, hand[5] - 15 + Math.round(Math.sin(clock / 2 + s) * 1.5), 3, 6, prop[1]);
        }
    } else if (prop[0] === "orb") {
        box(hand[4] - 2, hand[5] - 6, 4, 4, prop[1]);
        if (clock % 6 < 3) {
            box(hand[4] - 4, hand[5] - 5, 8, 2, prop[1]);
            box(hand[4] - 1, hand[5] - 8, 2, 8, prop[1]);
        }
    } else if (prop[0] === "drum") {
        box(f.hipX - 5, f.hipY - 5, 10, 1, WHITE);
        box(f.hipX - 4, f.hipY - 4, 8, 3, prop[1]);
        box(f.hipX - 3, f.hipY - 1, 6, 4, prop[1]);
    } else if (prop[0] === "guitar") {
        line(f.hipX - 1, f.hipY - 5, f.shX - 12, f.shY + 1, SILVER, 2);
        box(f.hipX - 2, f.hipY - 6, 8, 6, prop[1]);
        box(f.hipX - 1, f.hipY - 7, 6, 8, prop[1]);
    }
}

// Both dancers of the style, layer by layer. Returns where each one stands.
function drawTroupe() {
    var troupe = TROUPES[STYLES[jam.style].id];
    var places = [40, 106];
    var figs = [];
    var i, k, state, f;
    if (mood === 3) {
        // the trail: two shadows of each dancer, a part of a beat behind
        for (k = 2; k >= 1; k--) {
            for (i = 0; i < 2; i++) {
                state = troupePose(troupe, i === 1, k * 0.2);
                f = figure(troupe.cast[i], state.pose, places[i] + state.travel);
                var tint = DEEP[(clock + k * 3 + i * 6) % DEEP.length];
                zoom = DANCER_ZOOM;
                zoomX = f.cx;
                figureLegs(troupe.cast[i], f, tint);
                figureBody(troupe.cast[i], f, tint);
                figureArms(troupe.cast[i], f, tint);
                figureHead(troupe.cast[i], f, tint);
                zoom = 1;
            }
        }
        flush();
    }
    for (i = 0; i < 2; i++) {
        state = troupePose(troupe, i === 1, 0);
        figs.push(figure(troupe.cast[i], state.pose, places[i] + state.travel));
    }
    var layers = [figureBack, figureLegs, figureBody, figureArms, figureHead, figureFace, figureHands];
    for (k = 0; k < layers.length; k++) {
        for (i = 0; i < 2; i++) {
            zoom = DANCER_ZOOM;
            zoomX = figs[i].cx;
            layers[k](troupe.cast[i], figs[i], -1);
            zoom = 1;
        }
        flush();
    }
    return [Math.round(figs[0].cx + (figs[0].shX - figs[0].cx) * DANCER_ZOOM),
            Math.round(figs[1].cx + (figs[1].shX - figs[1].cx) * DANCER_ZOOM)];
}

function drawStage() {
    var i;
    var colours = scenery();
    var horizon = GROUND - 26;
    clip = [SX, SY, SX + SW, SY + SH];
    // Free play puts on the scenery of its style as long as the playing is
    // not going wrong; trouble and storm look the same everywhere.
    var scene = inJam() && mood >= 0 ? SCENES[STYLES[jam.style].id] : null;

    // Layer 1: frame, sky, two horizon bands and the ground, none overlapping.
    px(SX - 1, SY - 1, SW + 2, 1, SLATE);
    px(SX - 1, SY + SH, SW + 2, 1, SLATE);
    px(SX - 1, SY, 1, SH, SLATE);
    px(SX + SW, SY, 1, SH, SLATE);
    if (scene) {
        flush();
        scene(mood);
    } else if (mood === 3) {
        drawPlasma(SY, GROUND);
    } else {
        px(SX, SY, SW, horizon - SY, colours[0]);
        px(SX, horizon, SW, 14, colours[1]);
        px(SX, GROUND - 12, SW, 12, colours[2]);
    }
    if (!scene) {
        px(SX, GROUND, SW, SY + SH - GROUND, INK);
    }
    flush();
    if (!scene) {
        stageProps(colours, horizon);
    }

    // Layer 3: moon face, pupils, the dancers (with trails at the top mood).
    if (scene) {
        // the scenery has its own lights in the sky
    } else if (mood >= 1 && mood < 3) {
        px(SX + SW - 22, SY + 13, 1, 2, INK);
        px(SX + SW - 17, SY + 13, 1, 2, INK);
        px(SX + SW - 22, SY + 17, 6, 1, INK);
        px(SX + SW - 23, SY + 16, 1, 1, INK);
        px(SX + SW - 16, SY + 16, 1, 1, INK);
    } else if (mood === 0) {
        px(SX + SW - 21, SY + 12, 3, 3, ORANGE);
        px(SX + SW - 17, SY + 16, 2, 2, ORANGE);
    }
    if (mood === 3 && !scene) {
        for (i = 0; i < EYES.length; i++) {
            drawPupil(SX + EYES[i][0], SY + EYES[i][1], i);
        }
    }
    drawCast();
}

// Layer 2 of the stage outside free play: band edges, floor, stars, moon,
// equaliser bars.
function stageProps(colours, horizon) {
    var x, i;
    if (mood !== 3) {
        for (x = 0; x < SW; x += 4) {
            px(SX + x, horizon - 1 - (x % 8 === 0 ? 1 : 0), 2, 1, colours[1]);
            if (x + 2 < SW) {
                px(SX + x + 2, GROUND - 13, 2, 1, colours[2]);
            }
        }
    }
    if (mood >= 1) {
        // a dance floor of flashing tiles
        var tiles = mood >= 2 ? FIRE_FLOOR : DANCE_FLOOR;
        // the floor steps on every note the player hits; at the top mood it
        // also runs on its own
        var beat = beats + (mood === 3 ? clock : 0);
        for (x = 0; x < SW; x += 12) {
            var w = Math.min(12, SW - x);
            px(SX + x, GROUND + 2, w, 6, tiles[(x / 12 + beat) % tiles.length]);
            px(SX + x, GROUND + 8, w, 6, tiles[(x / 12 + beat + 2) % tiles.length]);
        }
        px(SX, GROUND, SW, 2, WHITE);
    } else {
        px(SX, GROUND, SW, 2, mood < 0 ? STEEL : TEAL);
        for (x = 0; x < SW; x += 16) {
            px(SX + x, GROUND + 5, Math.min(8, SW - x), 1, STEEL);
            if (x + 8 < SW) {
                px(SX + x + 8, GROUND + 10, Math.min(8, SW - x - 8), 1, STEEL);
            }
        }
    }
    if (mood === 2) {
        for (i = 0; i < 12; i++) {
            var height = 6 + ((i * 37 + Math.floor(clock / 2) * 53) % 23);
            px(SX + 2 + i * 12, GROUND - height, 8, height - 2, TEAL);
            px(SX + 2 + i * 12, GROUND - height - 2, 8, 2, CYAN);
        }
    }
    if (mood >= 0 && mood < 3) {
        for (i = 0; i < STARS.length; i++) {
            var phase2 = (clock * (mood >= 1 ? 3 : 1) + i * 7) % 30;
            if (phase2 < 3) {
                px(SX + STARS[i][0] - 1, SY + STARS[i][1], 3, 1, CYAN);
                px(SX + STARS[i][0], SY + STARS[i][1] - 1, 1, 1, CYAN);
                px(SX + STARS[i][0], SY + STARS[i][1] + 1, 1, 1, CYAN);
            } else if (phase2 < 22) {
                px(SX + STARS[i][0], SY + STARS[i][1], 1, 1, WHITE);
            }
        }
        px(SX + SW - 24, SY + 10, 10, 10, YELLOW);
        px(SX + SW - 26, SY + 12, 2, 6, YELLOW);
        px(SX + SW - 14, SY + 12, 2, 6, YELLOW);
        px(SX + SW - 22, SY + 8, 6, 2, YELLOW);
        px(SX + SW - 22, SY + 20, 6, 2, YELLOW);
    }
    if (mood === 3) {
        for (i = 0; i < EYES.length; i++) {
            drawEye(SX + EYES[i][0], SY + EYES[i][1], i);
        }
    }
    flush();
}

// The rest of the stage: the dancers (with trails at the top mood), what
// hovers over them, the storm, particles, writing. In the lessons the dancers
// are the slime and the frog; every style of free play has two of its own.
function drawCast() {
    var i;
    var slimeAt, frogAt;
    if (inJam()) {
        var stand = drawTroupe();
        slimeAt = SX + stand[0];
        frogAt = SX + stand[1];
    } else {
        var slime = SPRITES.slime;
        var frog = SPRITES.frog;
        wobble = mood === 3 ? 2 : 0;
        if (mood === 3) {
            for (i = 2; i >= 1; i--) {
                drawDancer(slime, SX + 42, slimeShift, 9, 19, 10, 1, i);
                drawDancer(frog, SX + 108, frogShift, 14, 22, 0, -1, i);
            }
            flush();
        }
        slimeAt = drawDancer(slime, SX + 42, slimeShift, 9, 19, 10, 1, 0);
        frogAt = drawDancer(frog, SX + 108, frogShift, 14, 22, 0, -1, 0);
        wobble = 0;
        flush();
    }

    // Layer 4: what hovers over the dancers, and the one-shot effects.
    if (mood >= 1) {
        // hearts and a star over the slime and the frog; over the dancers of
        // free play they would hide the dance
        if (!inJam()) {
            drawSprite(SPRITES.charmed, loopFrame(SPRITES.charmed, 0), slimeAt, GROUND + 4, SPRITES.charmed.base, false);
            if (mood >= 2) {
                drawSprite(SPRITES.charmed, loopFrame(SPRITES.charmed, 12), frogAt, GROUND + 12, SPRITES.charmed.base, false);
                drawSprite(SPRITES.star, loopFrame(SPRITES.star, 0), SX + 73, SY + 68, SPRITES.star.base, false);
            }
        }
    } else if (mood <= -1) {
        drawSprite(SPRITES.confused, loopFrame(SPRITES.confused, 0), slimeAt, GROUND + 4, SPRITES.confused.base, false);
        drawSprite(SPRITES.confused, loopFrame(SPRITES.confused, 12), frogAt, GROUND + 12, SPRITES.confused.base, false);
    }
    var burst = SPRITES.burst;
    var burstFrame = Math.floor((clock - burstStart) * burst.fps * TICK_MS / 1000);
    if (burstFrame >= 0 && burstFrame < burst.runs.length) {
        drawSprite(burst, burstFrame, SX + 72, SY + 96, burst.base, false);
    }
    var confetti = SPRITES.confetti;
    var confettiFrame = clock - confettiStart;
    if (confettiFrame >= 0 && confettiFrame < confetti.runs.length) {
        drawSprite(confetti, confettiFrame, SX + 73, GROUND, confetti.base, false);
    }
    flush();

    // Layer 5: the storm over everything, then its lightning.
    if (mood === -2) {
        drawSprite(SPRITES.storm, loopFrame(SPRITES.storm, 0), SX + 77, GROUND + 1, SPRITES.storm.base, false);
        flush();
        if (flash > 0) {
            for (i = 0; i < bolt.length; i += 4) {
                px(bolt[i], bolt[i + 1], bolt[i + 2], bolt[i + 3], flash === 2 ? WHITE : YELLOW);
            }
            flush();
        }
    }

    // Layer 6: particles.
    for (i = 0; i < particles.length; i++) {
        var p = particles[i];
        var px0 = Math.round(p.x);
        var py0 = Math.round(p.y);
        if (px0 < SX + 1 || px0 > SX + SW - 7 || py0 < SY + 1 || py0 > SY + SH - 8) {
            continue;
        }
        if (p.kind === NOTE) {
            for (var k = 0; k < NOTE_SHAPE.length; k += 3) {
                px(px0 + NOTE_SHAPE[k], py0 + NOTE_SHAPE[k + 1], NOTE_SHAPE[k + 2], 1, p.colour);
            }
        } else if (p.kind === ROCKET) {
            px(px0, py0, 2, 2, WHITE);
            px(px0, py0 + 2, 2, 3, ORANGE);
        } else {
            var size = p.ramp && p.age < 3 ? 2 : 1;
            px(px0, py0, size, size, p.ramp ? p.ramp[Math.min(p.ramp.length - 1, Math.floor(p.age * p.ramp.length / p.life))] : p.colour);
        }
    }
    flush();

    // Layer 7: the gauge along the bottom, the ranks, then all the writing.
    if (rank >= 1) {
        // a virtuoso plays in a frame of all colours, a legend under golden rain
        var glow = rank === 2 && clock % 4 < 2 ? YELLOW : RAINBOW[clock % RAINBOW.length];
        px(SX, SY, SW, 1, glow);
        px(SX, SY, 1, SH, glow);
        px(SX + SW - 1, SY, 1, SH, glow);
        if (rank === 2) {
            for (i = 0; i < 12; i++) {
                px(SX + 2 + hash(i * 13) % (SW - 4), SY + 2 + (hash(i) + clock * 5) % (SH - 16), 1, 3, i % 3 === 0 ? WHITE : YELLOW);
            }
        }
        flush();
    }
    drawGauge();
    // the counter of points swells when points come and shakes when they go
    var flashing = clock < pointsFlash.until;
    var jitter = flashing && pointsFlash.shake ? (clock % 2 === 0 ? 1 : -1) : 0;
    label("★", SX + 5 + jitter, SY + 5, flashing ? 2 : 1, flashing ? pointsFlash.colour : YELLOW, LEFT);
    label(String(shownPoints), SX + (flashing ? 21 : 13) + jitter, SY + 5, flashing ? 2 : 1, flashing ? pointsFlash.colour : WHITE, LEFT);
    if (inJam() && combo >= 4) {
        label("КОМБО " + combo, SX + 5, SY + 22, 1, combo >= 64 ? RAINBOW[clock % RAINBOW.length] : combo >= 16 ? YELLOW : SILVER, LEFT);
    } else if (streak > 1) {
        label("СЕРИЯ " + streak, SX + 5, SY + 22, 1, streak >= 5 ? YELLOW : SILVER, LEFT);
    }
    for (i = 0; i < popups.length; i++) {
        if (popups[i].age < 24 || clock % 2 === 0) {
            label(popups[i].text, SX + SW / 2, SY + 60 - popups[i].age, 2, popups[i].colour === undefined ? YELLOW : popups[i].colour, CENTER);
        }
    }
    if (banner !== "" && clock < bannerUntil && clock % 4 < 3) {
        label(banner, SX + SW / 2, SY + 30, 2, mood >= 1 ? YELLOW : RED, CENTER);
    }
    if (wrong && clock % 4 < 2) {
        label("!", slimeAt - 1, GROUND - 46, 2, RED, LEFT);
    }
    flush();
}

function drawNotes() {
    for (var i = 0; i < notes.length; i++) {
        var n = notes[i];
        if (n.age > 6 && clock % 2 === 0) {
            continue; // flicker out
        }
        for (var k = 0; k < NOTE_SHAPE.length; k += 3) {
            px(n.x + NOTE_SHAPE[k], n.y + NOTE_SHAPE[k + 1], NOTE_SHAPE[k + 2], 1, n.colour);
        }
    }
    flush();
}

function paint() {
    paintedAt = clock;
    startTicker();
    claimStage();
    if (inJam()) {
        jamLook();
    }
    px(0, 0, W, H, INK);
    flush();
    drawWheel();
    drawKeyboard();
    drawTarget();
    drawHint();
    drawPanel();
    flush();
    drawStage();
    drawNotes();
}

function onresize() {
    mgraphics.redraw();
}

mgraphics.redraw();
