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

var W = 860;
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

// Twelve saturated hues for the plasma of the "trip" mood.
var RAINBOW = [];
(function () {
    for (var i = 0; i < 12; i++) {
        COLORS.push(shiftHue([0.95, 0.25, 0.35], i * 30));
        RAINBOW.push(COLORS.length - 1);
    }
}());

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
var CHORD_NAME = /^[A-G][#b]?(maj|m|dim|aug|sus|add)?[0-9]*(b5)?(\/[A-G][#b]?)?$/;
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
                     "6", "m6", "add9", "9", "maj9", "m9", "5"];
var QUALITIES = {
    "": [0, 4, 7], "m": [0, 3, 7], "dim": [0, 3, 6], "aug": [0, 4, 8],
    "sus2": [0, 2, 7], "sus4": [0, 5, 7], "5": [0, 7],
    "7": [0, 4, 7, 10], "maj7": [0, 4, 7, 11], "m7": [0, 3, 7, 10],
    "m7b5": [0, 3, 6, 10], "dim7": [0, 3, 6, 9], "6": [0, 4, 7, 9], "m6": [0, 3, 7, 9],
    "add9": [0, 4, 7, 14], "9": [0, 4, 7, 10, 14], "maj9": [0, 4, 7, 11, 14], "m9": [0, 3, 7, 10, 14]
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
    for (var q = 0; q < QUALITY_ORDER.length; q++) {
        var intervals = QUALITIES[QUALITY_ORDER[q]];
        if (unique(intervals.map(function (v) { return v % 12; })).length !== pcs.length) {
            continue;
        }
        for (var r = 0; r < roots.length; r++) {
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
function holdStep(holdSymbol, token, under) {
    var single = /^[A-G][#b]?$/.test(holdSymbol);
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
        for (i = 0; i < blocks.length; i++) {
            var halves = blocks[i].split(": ");
            tokens = words(halves[1]);
            for (k = 0; k < tokens.length; k++) {
                steps.push(holdStep(halves[0], tokens[k], lesson.kind === "walk"));
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
                step = { label: "ABLETON", live: spec[1], pcs: [], bass: -1, show: [] };
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
        ], "Знакомство: что где на экране, как тренажёр проверяет игру и как он связан с Ableton.", { pts: 100 }),
        lesson("Свободная игра", "free", "", "Площадка без заданий: пробуй звуки, смотри, как называются твои аккорды. Очков тут не дают.", {})
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
        ], "Темп и метроном в Ableton это основа: без ровного счёта клипы не сойдутся друг с другом.", { pts: 120 })
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
        ], "Квантизация ставит ноты точно на доли. Так ровно звучит почти вся электронная музыка.", { pts: 90 })
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
               "Сбивка это переход между частями трека: дробь по снейру и томам и удар с тарелкой.", { rhythm: 4 })
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

// Flat list for the save file and the tests; texts are prepared once.
var LESSONS = [];
(function () {
    for (var g = 0; g < GROUPS.length; g++) {
        GROUPS[g].title = caps(GROUPS[g].title);
        for (var l = 0; l < GROUPS[g].lessons.length; l++) {
            var item = GROUPS[g].lessons[l];
            item.id = GROUPS[g].id + "/" + l;
            item.group = g;
            item.index = l;
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

// ---------------------------------------------------------------- progress

var progress = { v: 1, points: 0, done: {}, last: "start/0" };

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
        return data && typeof data.points === "number" && data.done ? data : null;
    } catch (error) {
        return null;
    }
}

// Points are the sum of the best score of every finished lesson.
function recount() {
    var total = 0;
    for (var id in progress.done) {
        total += progress.done[id];
    }
    progress.points = total;
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
        var disk = readProgress();
        if (disk) {
            for (var id in disk.done) {
                if (!(progress.done[id] >= disk.done[id])) {
                    progress.done[id] = disk.done[id];
                }
            }
            recount();
        }
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

function groupOpen(g) {
    return progress.points >= GROUPS[g].need;
}

function lessonOpen(item) {
    if (!groupOpen(item.group)) {
        return false;
    }
    if (item.index === 0 || item.kind === "free") {
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
        if (!object) {
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

function truthy(value) {
    return value === null ? null : Number(value) === 1;
}

// Every check answers true, false or null (cannot tell: no Live API here).
var LIVE_CHECKS = {
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
    }
};

function rememberBaseline() {
    stepClock = clock;
    baseline = {
        tracks: liveCount("live_set", "tracks"),
        devices: liveCount(TRACK, "devices"),
        volume: Number(liveGet("live_set tracks 0 mixer_device volume", "value"))
    };
}

// ----------------------------------------------------------------- lesson

function currentStep() {
    return phase === "run" ? steps[step] : null;
}

function selectLesson(item) {
    current = item;
    setKey(item.key || "C");
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
    phase = !lessonOpen(item) ? "locked" : (item.kind === "free" ? "run" : "intro");
    // Remember where the player is, so the next session opens on the same
    // lesson. Not during start-up: the save file has only just been read.
    if (progress.last !== item.id) {
        progress.last = item.id;
        if (ticker) {
            saveProgress();
        }
    }
}

function startLesson() {
    if (phase === "locked" || current.kind === "free") {
        return;
    }
    selectLesson(current);
    phase = "run";
    rememberBaseline();
}

function moveLesson(delta) {
    var list = GROUPS[current.group].lessons;
    var index = current.index + delta;
    if (index >= 0 && index < list.length) {
        selectLesson(list[index]);
    }
}

function moveGroup(delta) {
    var g = current.group + delta;
    if (g < 0 || g >= GROUPS.length) {
        return;
    }
    // Land on the first lesson of the stage that is not finished yet.
    var list = GROUPS[g].lessons;
    var target = list[0];
    for (var i = 0; i < list.length; i++) {
        if (list[i].kind !== "free" && !(progress.done[list[i].id] > 0)) {
            target = list[i];
            break;
        }
    }
    selectLesson(target);
}

// The lesson after this one, across stages; null at the very end.
function nextLesson() {
    var list = GROUPS[current.group].lessons;
    if (current.index + 1 < list.length) {
        return list[current.index + 1];
    }
    for (var g = current.group + 1; g < GROUPS.length; g++) {
        if (groupOpen(g)) {
            return GROUPS[g].lessons[0];
        }
    }
    return null;
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
    saveProgress();
    var opened = [];
    var following = GROUPS[current.group].lessons[current.index + 1];
    if (best === 0 && following) {
        opened.push("УРОК " + following.title);
    }
    for (g = 0; g < GROUPS.length; g++) {
        if (!openBefore[g] && groupOpen(g)) {
            opened.push("СТУПЕНЬ " + GROUPS[g].title);
        }
    }
    reward = { total: total, gain: progress.points - before, lines: lines, opened: opened, best: best };
    if (reward.gain > 0) {
        popups.push({ text: "+" + reward.gain, age: 0 });
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
function judge(pitch) {
    lastOn = clock;
    var now = nowMs();
    var fresh = now - onsetMs >= 70; // a new onset, not one more note of the same chord
    if (fresh) {
        rhythm = feelRhythm(now);
    }
    var gain = 0;
    var loss = 0;
    var drumming = current.kind === "drums" || !!(currentStep() && currentStep().drums);
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
        for (var i = 0; i < held.length; i++) {
            if (held[i] === pitch) {
                continue;
            }
            var distance = Math.abs(pitch - held[i]);
            var interval = distance % 12;
            if (interval === 0 || interval === 3 || interval === 4 || interval === 5
                    || interval === 7 || interval === 8 || interval === 9) {
                gain += 0.03;
            } else if (!chord) {
                // Clashes count only outside a real chord: the seventh of
                // Cmaj7 and the tritone inside G7 belong there.
                if (distance === 1) {
                    loss -= 0.25;
                } else if (distance === 2) {
                    loss -= 0.06;
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
            if (lastPitch >= 0) {
                var leap = Math.abs(pitch - lastPitch);
                if (leap > 0 && leap <= 4) {
                    gain += 0.03;
                }
                if (leap > 0) {
                    lastMelody = clock;
                }
            }
            lastPitch = pitch;
        } else {
            onsetNotes++;
            lastMelody = melodyBefore;
        }
        if (chord) {
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
            }
        } else if (lastChordPcs.indexOf(pc) < 0) {
            sameChord = 0; // a note from outside the chord: something new is going on
        }
        if (fresh && rhythm === 1 && groove >= 3) {
            gain += 0.02;
        } else if (fresh && rhythm === -1) {
            loss -= 0.02;
        }
        gain *= variety * (groove >= 3 ? 1 : groove >= 1 ? 0.6 : 0.3) * (sameChord >= 4 ? 0.15 : 1);
    }
    // The higher the vibe already is, the less a single good note adds, so
    // the top moods need rich playing kept up for a while, not three chords.
    if (vibe > 0) {
        gain *= 1 - vibe;
    }
    vibe = Math.max(-1, Math.min(1, vibe + gain + loss));
    // The top mood is for the real thing only: a melody over changing chords,
    // or on the pads a long unbroken groove.
    var rich = drumming ? groove >= 16 : clock - lastMelody < 36 && clock - chordChange < 120;
    if (!rich) {
        vibe = Math.min(vibe, TRIP_AT - 0.01);
    }
    updateMood();
}

var DANCE_AT = 0.3;
var FIRE_AT = 0.55;
var TRIP_AT = 0.78;

var BANNERS = { "-2": "КАКОФОНИЯ!", "-1": "ОЙ...", "1": "КРУТО!", "2": "ОГОНЬ!", "3": "КОСМОС!" };

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
var KEY_W = 16;
var KEY_H = 58;
var BLACK_W = 10;
var BLACK_H = 35;
var LOW_NOTE = 48;   // C3
var OCTAVES = 3;
var TEXT_RIGHT = KX + OCTAVES * 7 * KEY_W;

var PX = 528;        // right panel
var PW = 172;
var BUTTONS = {
    groupPrev: [PX, 4, 18, 14],
    groupNext: [PX + PW - 18, 4, 18, 14],
    prev: [PX, 32, 18, 14],
    next: [PX + PW - 18, 32, 18, 14],
    main: [PX, 74, 88, 17],
    restart: [PX + 92, 74, 80, 17]
};

var SX = 708;        // stage with the critters
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
    return WHITE_PCS.indexOf(pc) >= 0 ? KX + white * KEY_W + 7 : KX + (white + 1) * KEY_W;
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
    return [KX + (index % 8) * 42, KY + (index < 8 ? 30 : 0), 40, 28];
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

function note(pitch, velocity) {
    var index = held.indexOf(pitch);
    if (velocity > 0) {
        if (index < 0) {
            held.push(pitch);
        }
    } else if (index >= 0) {
        held.splice(index, 1);
    }
    held.sort(function (a, b) { return a - b; });
    if (velocity > 0) {
        judge(pitch);
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
            notes.push({ x: keyCentre(foldIntoRange(pitch)) - 2, y: KY - 9, colour: good ? LIME : RED, age: 0 });
        }
    }
    evaluate();
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
    if (previewTask) {
        previewTask.cancel();
        previewTask = null;
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

function onclick(x, y) {
    if (inside(BUTTONS.groupPrev, x, y)) {
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
            return;
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
            return;
        }
    }
    mgraphics.redraw();
}

function ondblclick(x, y) {
    onclick(x, y);
}

// -------------------------------------------------------------- animation

function tick() {
    clock++;
    // The vibe fades slowly while someone plays and quickly after two
    // seconds of silence.
    vibe *= clock - lastOn > 24 ? 0.97 : 0.99;
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
    if (s && s.live && clock % 3 === 0 && clock - stepClock >= 12 && LIVE_CHECKS[s.live]() === true) {
        completeStep();
    }
    mgraphics.redraw();
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
        shownPoints = progress.points;
        for (var i = 0; i < LESSONS.length; i++) {
            if (LESSONS[i].id === progress.last) {
                current = LESSONS[i];
            }
        }
    }
    selectLesson(current);
    ticker = new Task(tick, this);
    ticker.interval = TICK_MS;
    ticker.repeat();
}

function notifydeleted() {
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

function drawWheel() {
    var colours = sectorColours();
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
            label(ring === 0 ? MAJOR_NAMES[index] : MINOR_NAMES[index],
                  CX + radius * Math.cos(middle), Math.round(CY + radius * Math.sin(middle)) - 3,
                  1, colour === STEEL ? SLATE : (colour === ORANGE_DIM || colour === GREEN_DIM ? INK : NIGHT), CENTER);
        }
    }
    label(MAJOR_NAMES[keyIndex], CX, CY - 12, 2, WHITE, CENTER);
    label(MINOR_NAMES[keyIndex], CX, CY + 6, 1, SILVER, CENTER);
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
            label(DRUM_TAGS[pitch], rect[0] + 20, rect[1] + 9, 1, states[pitch] === undefined ? SILVER : NIGHT, CENTER);
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
            label(NOTE_NAMES[WHITE_PCS[i]], x + 7, KY + KEY_H - 13, 1, i === 0 ? NIGHT : SLATE, CENTER);
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
    flush();
}

// Big text that shrinks until it fits the width.
function headline(s, x, y, maxWidth, colour) {
    var scale = 3;
    while (scale > 1 && layout(s).w * scale > maxWidth) {
        scale--;
    }
    return label(s, x, y + (3 - scale) * 3, scale, colour, LEFT);
}

function drawFreePlay() {
    var pcs = unique(held.map(function (p) { return p % 12; }));
    var played = held.length > 0 ? detectChord(pcs, held[0] % 12) : null;
    if (played) {
        var width = headline(played.name, KX, 5, 150, LIME);
        label(noteList(played.pcs, NOTE_NAMES), KX + width + 10, 6, 1, WHITE, LEFT);
        label(noteList(played.pcs, NOTE_RU), KX + width + 10, 17, 1, SLATE, LEFT);
        var own = isDiatonic(sectorIndex(played.root, played.minor));
        label(own ? "СВОЙ АККОРД ДЛЯ ТОНАЛЬНОСТИ" : "ЧУЖОЙ ДЛЯ ТОНАЛЬНОСТИ: НА КРУГЕ ОН СЕРЫЙ", KX, 33, 1, own ? GREEN : SLATE, LEFT);
    } else if (pcs.length > 0) {
        label(noteList(pcs, NOTE_NAMES), KX, 8, 2, WHITE, LEFT);
        label(pcs.length < 3 ? "ДЛЯ АККОРДА НУЖНЫ ТРИ РАЗНЫЕ НОТЫ" : "ТАКОГО АККОРДА ТРЕНАЖЁР НЕ ЗНАЕТ", KX, 33, 1, SLATE, LEFT);
    } else {
        label("СЫГРАЙ АККОРД", KX, 8, 2, SLATE, LEFT);
        label("ЦВЕТНЫЕ СЕКТОРЫ КРУГА СОЧЕТАЮТСЯ МЕЖДУ СОБОЙ", KX, 33, 1, SLATE, LEFT);
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
        label(progress.done[current.id] > 0 ? "ПРОЙДЕН. ЛУЧШИЙ СЧЁТ: " + progress.done[current.id] : "НАЖМИ СТАРТ ИЛИ ЛЮБУЮ КЛАВИШУ",
              KX, 33, 1, clock % 12 < 8 ? YELLOW : ORANGE, LEFT);
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
    if (phase === "intro" || phase === "locked") {
        y = paragraph("ЗАЧЕМ: " + current.why, KX, y, width, SILVER, 3) + 2;
        paragraph("КАК: " + current.hint, KX, y, width, SLATE, 2);
    } else if (phase === "done") {
        paragraph(current.task || (nextLesson() ? "ЖМИ ДАЛЬШЕ, ЧТОБЫ ПЕРЕЙТИ К СЛЕДУЮЩЕМУ УРОКУ. ЗАНОВО, ЧТОБЫ ПОБИТЬ СВОЙ СЧЁТ." : "ЭТО БЫЛ ПОСЛЕДНИЙ УРОК. ТЫ ПРОШЁЛ ВСЁ!"),
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

function drawPanel() {
    var group = GROUPS[current.group];
    var action = mainAction();
    var canRestart = phase === "run" && current.kind !== "free" || phase === "done";
    buttonBody(BUTTONS.groupPrev, false);
    buttonBody(BUTTONS.groupNext, false);
    buttonBody(BUTTONS.prev, false);
    buttonBody(BUTTONS.next, false);
    buttonBody(BUTTONS.main, action !== "" && action !== "ПОСЛУШАТЬ" && clock % 12 < 8);
    buttonBody(BUTTONS.restart, false);
    flush();
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
        label("ШАГ " + (step + 1) + "/" + steps.length + "  ОШИБОК: " + mistakes, PX, 107, 1, SLATE, LEFT);
    } else if (phase === "intro") {
        var prize = current.pts || Math.max(50, steps.length * 10);
        label("НАГРАДА: ДО " + Math.round(prize * (current.rhythm ? 1.8 : 1.5)) + " ОЧКОВ", PX, 107, 1, YELLOW, LEFT);
    }

    legend(ORANGE, "МАЖОР", PX, 124);
    legend(GREEN, "МИНОР", PX + 88, 124);
    legend(STEEL, "ЧУЖИЕ", PX, 136);
    legend(SKY, "НАЖАТЬ", PX + 88, 136);
    legend(LIME, "ВЕРНО", PX, 148);
    legend(RED, "ЛИШНЯЯ", PX + 88, 148);
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

function drawStage() {
    var x, i;
    var colours = scenery();
    var horizon = GROUND - 26;
    clip = [SX, SY, SX + SW, SY + SH];

    // Layer 1: frame, sky, two horizon bands and the ground, none overlapping.
    px(SX - 1, SY - 1, SW + 2, 1, SLATE);
    px(SX - 1, SY + SH, SW + 2, 1, SLATE);
    px(SX - 1, SY, 1, SH, SLATE);
    px(SX + SW, SY, 1, SH, SLATE);
    if (mood === 3) {
        drawPlasma(SY, GROUND);
    } else {
        px(SX, SY, SW, horizon - SY, colours[0]);
        px(SX, horizon, SW, 14, colours[1]);
        px(SX, GROUND - 12, SW, 12, colours[2]);
    }
    px(SX, GROUND, SW, SY + SH - GROUND, INK);
    flush();

    // Layer 2: band edges, floor, stars, moon, equaliser bars.
    if (mood !== 3) {
        for (x = 0; x < SW; x += 4) {
            px(SX + x, horizon - 1 - (x % 8 === 0 ? 1 : 0), 2, 1, colours[1]);
            px(SX + x + 2, GROUND - 13, 2, 1, colours[2]);
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
            px(SX + x, GROUND + 5, 8, 1, STEEL);
            px(SX + x + 8, GROUND + 10, 8, 1, STEEL);
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

    // Layer 3: moon face, pupils, the dancers (with trails at the top mood).
    if (mood >= 1 && mood < 3) {
        px(SX + SW - 22, SY + 13, 1, 2, INK);
        px(SX + SW - 17, SY + 13, 1, 2, INK);
        px(SX + SW - 22, SY + 17, 6, 1, INK);
        px(SX + SW - 23, SY + 16, 1, 1, INK);
        px(SX + SW - 16, SY + 16, 1, 1, INK);
    } else if (mood === 0) {
        px(SX + SW - 21, SY + 12, 3, 3, ORANGE);
        px(SX + SW - 17, SY + 16, 2, 2, ORANGE);
    }
    if (mood === 3) {
        for (i = 0; i < EYES.length; i++) {
            drawPupil(SX + EYES[i][0], SY + EYES[i][1], i);
        }
    }
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
    var slimeAt = drawDancer(slime, SX + 42, slimeShift, 9, 19, 10, 1, 0);
    var frogAt = drawDancer(frog, SX + 108, frogShift, 14, 22, 0, -1, 0);
    wobble = 0;
    flush();

    // Layer 4: what hovers over the dancers, and the one-shot effects.
    if (mood >= 1) {
        drawSprite(SPRITES.charmed, loopFrame(SPRITES.charmed, 0), slimeAt, GROUND + 4, SPRITES.charmed.base, false);
        if (mood >= 2) {
            drawSprite(SPRITES.charmed, loopFrame(SPRITES.charmed, 12), frogAt, GROUND + 12, SPRITES.charmed.base, false);
            drawSprite(SPRITES.star, loopFrame(SPRITES.star, 0), SX + 73, SY + 68, SPRITES.star.base, false);
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

    // Layer 7: the vibe meter under the floor, then all the writing.
    var meterX = SX + 6;
    var meterW = SW - 12;
    var middle = meterX + meterW / 2;
    px(meterX, SY + SH - 3, meterW, 2, STEEL);
    flush();
    var length = Math.round(Math.abs(vibe) * meterW / 2);
    if (length > 0) {
        px(vibe > 0 ? middle : middle - length, SY + SH - 3, length, 2, vibe > 0 ? (mood === 3 ? CYAN : LIME) : RED);
    }
    px(middle, SY + SH - 4, 1, 4, WHITE);
    label("★", SX + 5, SY + 5, 1, YELLOW, LEFT);
    label(String(shownPoints), SX + 13, SY + 5, 1, WHITE, LEFT);
    if (streak > 1) {
        label("СЕРИЯ " + streak, SX + 5, SY + 15, 1, streak >= 5 ? YELLOW : SILVER, LEFT);
    }
    for (i = 0; i < popups.length; i++) {
        if (popups[i].age < 24 || clock % 2 === 0) {
            label(popups[i].text, SX + SW / 2, SY + 60 - popups[i].age, 2, YELLOW, CENTER);
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
    startTicker();
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
