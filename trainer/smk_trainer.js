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
    knob: "РУЧКА", masterKnob: "РУЧКА", returnKnob: "РУЧКА",
    tempo: "ТЕМП", tempo90: "ТЕМП"
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
            ["live", "knob:Drift:Voice Mode:is Unison", "Найди список Mode, обычно в нём стоит Poly. Выбери Unison: каждую ноту играют четыре слегка расстроенных голоса. Звук стал широким и жирным."]
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
            ["live", "knob:Drift:Voice Mode:is Mono", "Бас играет по одной ноте. В списке Mode выбери Mono: ноты перестанут накладываться друг на друга."],
            ["live", "knob:Drift:^(Osc 1 Oct|Transpose)$:changed", "Опусти звук на октаву: ручка Oct у Osc 1."],
            ["live", "knob:Drift:LP Freq:down", "Прикрой фильтр ручкой Freq (K1): басу яркий верх не нужен, ему нужен плотный низ."],
            many("note", "A3 A3 C4 A3 G3 A3 E3 A3", "Бас готов. Сыграй линию коротко и ровно: бас должен попадать вместе с бочкой.")
        ), "Бас это фундамент трека. Рецепт один на все жанры: один голос, низкая октава, прикрытый фильтр.", { pts: 150 }),
        lesson("Рецепт: пэд", "tour", tour(
            ["live", "device:Drift", "Нужен Drift на этой дорожке. Если его нет, перетащи его из раздела Instruments."],
            ["live", "knob:Drift:Voice Mode:is Stereo", "Пэд это мягкий фон из аккордов. В списке Mode выбери Stereo: голоса разойдутся по левой и правой колонке."],
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
            ["live", "knob:InstrumentVector:Unison Mode:is Classic", "Найди блок Unison и выбери в нём режим Classic: один голос превращается в хор. Так делают суперпилу для транса и фьюче-бейса."],
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
            ["live", "knob:Drift:Voice Mode:is Mono", "В списке Mode выбери Mono: в самом низу две ноты сразу дают только гул."],
            ["live", "knob:Drift:^(Osc 1 Oct|Transpose)$:changed", "Опусти звук на октаву или две ручкой Oct у Osc 1."],
            many("note", "A3 A3 F3 F3 D3 D3 E3 E3", "Сыграй линию длинными нотами. На маленьких колонках саб почти не слышен: проверяй его в наушниках.")
        ), "Саб-бас держит низ в трэпе, дабстепе и драм-н-бейсе. Он простой, но без него трек не качает.", { pts: 150 }),
        lesson("Рецепт: эйсид-бас", "tour", tour(
            ["live", "device:Drift", "Перетащи на дорожку Drift из Instruments, если сейчас стоит другой инструмент."],
            ["live", "knob:Drift:Voice Mode:is Mono", "Эйсид это визжащий бас из чикагских клубов. В списке Mode выбери Mono."],
            ["live", "knob:Drift:Legato On:on", "Включи рядом переключатель Legato и прибавь Glide: ноты, сыгранные внахлёст, будут съезжать одна в другую."],
            ["live", "knob:Drift:LP Res:up", "Резонанс (K2) прибавь почти до упора: это и есть голос эйсида."],
            ["live", "knob:Drift:LP Freq:down", "Фильтр (K1) прикрой примерно до середины."],
            many("note", "A3 A3 C4 A3 A3 G3 A3 E4", "Сыграй риф быстрыми короткими нотами."),
            ["live", "knob:Drift:LP Freq:moved", "А теперь главное: играй риф одной рукой, а другой води фильтр туда и обратно. Бас запел и завизжал."]
        ), "Эйсид-бас это пара нот, резонанс и рука на фильтре. С него начались эйсид-хаус и техно.", { pts: 160 }),
        lesson("Рецепт: суперпила", "tour", tour(
            ["live", "device:Drift", "Перетащи на дорожку Drift из Instruments, если сейчас стоит другой инструмент."],
            ["live", "knob:Drift:Osc 1 Wave:is Saw", "В списке волн Osc 1 выбери Saw: пила самая яркая из волн."],
            ["live", "knob:Drift:Voice Mode:is Unison", "В списке Mode выбери Unison: каждую ноту играют четыре голоса."],
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
    { id: "dance", title: "Жанры: танцпол", need: 1500, shelf: true, lessons: [
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
    { id: "beats", title: "Жанры: бит", need: 1500, shelf: true, lessons: [
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
    { id: "synths", title: "Жанры: синты", need: 1500, shelf: true, lessons: [
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
// make a tier with its own theme. Courses live beside the stages: the panel
// has a button that switches between the two.

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
    mono: ["Voice Mode", "is Mono", "В списке Mode выбери Mono: синтезатор играет по одной ноте."],
    poly: ["Voice Mode", "is Poly", "В списке Mode выбери Poly: можно играть аккорды."],
    stereo: ["Voice Mode", "is Stereo", "В списке Mode выбери Stereo: голоса расходятся по колонкам."],
    unison: ["Voice Mode", "is Unison", "В списке Mode выбери Unison: каждую ноту играют четыре голоса."],
    glide: ["Glide Time", "up", "Прибавь Glide: ноты съезжают одна в другую."],
    legato: ["Legato On", "on", "Включи Legato: при игре внахлёст нота не начинается заново."],
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
    fat: ["Voice Mode", "is Unison", "Сделай звук толстым и широким, как хор."],
    oneVoice: ["Voice Mode", "is Mono", "Сделай так, чтобы звучала только одна нота сразу."],
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
        out.push(["live", "knob:Drift:" + task[0] + ":" + task[1], task[2] + (tier < 7 ? " Играй ноты и слушай." : "")]);
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

// id, title, short name for lesson titles, points to open, tiers, generator
var COURSE_LIST = [
    ["c-notes", "Ноты", "Ноты", 100, NOTE_TIERS, makeNotes],
    ["c-black", "Чёрные клавиши", "Чёрные", 200, BLACK_TIERS, makeBlack],
    ["c-intervals", "Интервалы", "Интервалы", 300, INTERVAL_TIERS, makeIntervals],
    ["c-chords", "Аккорды", "Аккорды", 500, CHORD_TIERS, makeChords],
    ["c-prog", "Прогрессии", "Прогрессии", 800, PROGRESSION_TIERS, makeProgressions],
    ["c-inv", "Обращения", "Обращения", 1000, INVERSION_TIERS, makeInversions],
    ["c-bass", "Бас и аккорд", "Бас и аккорд", 1200, BASS_TIERS, makeBass],
    ["c-hands", "Две руки", "Две руки", 1200, HAND_TIERS, makeHands],
    ["c-keys", "Тональности", "Тональности", 1500, KEY_TIERS, makeKeys],
    ["c-sevenths", "Септаккорды", "Септаккорды", 2000, SEVENTH_TIERS, makeSevenths],
    ["c-scales", "Гаммы", "Гаммы", 1200, SCALE_TIERS, makeScales],
    ["c-beats", "Биты", "Биты", 500, BEAT_TIERS, makeBeats],
    ["c-knobs", "Ручки синтезатора", "Ручки", 300, KNOB_TIERS, makeKnobs],
    ["c-fx", "Эффекты", "Эффекты", 300, FX_TIERS, makeEffects],
    ["c-tempo", "Темпы жанров", "Темпы", 600, TEMPO_TIERS, makeTempos]
];
var COURSE_SIZE = 40;

(function () {
    for (var c = 0; c < COURSE_LIST.length; c++) {
        var spec = COURSE_LIST[c];
        var group = { id: spec[0], title: spec[1], need: spec[3], course: true, lessons: [] };
        if (spec[0] === "c-beats") {
            group.pads = true;
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

// done = the best score of every finished lesson; reps = how many more times
// a training lesson was run after its first.
var progress = { v: 1, points: 0, done: {}, reps: {}, last: "start/0" };

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
        return data;
    } catch (error) {
        return null;
    }
}

// Points are the sum of the best score of every finished lesson, plus a
// little for every repeat of a training lesson.
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
    progress.points = total;
}

// Takes over what another trainer (say, the one on the drum track) has
// earned in the meantime.
function mergeDisk() {
    var disk = readProgress();
    progress.reps = progress.reps || {};
    if (disk) {
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
    var owner = liveFresh(track);
    if (!owner) {
        return null;
    }
    var out = [];
    var count = children(owner, "devices", 12);
    for (var i = 0; i < count; i++) {
        var path = track + " devices " + i;
        var device = liveFresh(path);
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
            var chain = liveFresh(path + " chains " + c);
            var inner = chain ? children(chain, "devices", 3) : 0;
            for (var d = 0; d < inner; d++) {
                var innerPath = path + " chains " + c + " devices " + d;
                var innerDevice = liveFresh(innerPath);
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
    return /^(device|masterDevice|returnDevice|knob|masterKnob|returnKnob|order|simplerMode):/.test(spec) ? 6 : 3;
}

function rememberBaseline() {
    stepClock = clock;
    knobWatch = null;
    baseline = {
        tracks: liveCount("live_set", "tracks"),
        devices: liveCount(TRACK, "devices"),
        volume: Number(liveGet("live_set tracks 0 mixer_device volume", "value")),
        pan: Number(liveGet(TRACK + " mixer_device panning", "value")),
        clips: countClips()
    };
    // A knob step remembers where the knob stands before the player touches it.
    var s = currentStep();
    if (s && s.live && /[kK]nob:/.test(s.live)) {
        checkLive(s.live);
    }
}

// ----------------------------------------------------------------- lesson

function currentStep() {
    return phase === "run" ? steps[step] : null;
}

function selectLesson(item) {
    current = item;
    renew(item);
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
    if (ticker) {
        mergeDisk(); // the lesson before this one may have been played in another trainer
    }
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

// The stages and the courses are two shelves; the arrows stay on the shelf
// the player is on, and a button of the panel takes them to the other one.
function isCourse(g) {
    return !!GROUPS[g].course;
}

// The stages (or the courses) as a list of group numbers.
function shelf(courses) {
    var out = [];
    for (var g = 0; g < GROUPS.length; g++) {
        if (isCourse(g) === courses) {
            out.push(g);
        }
    }
    return out;
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
    var groups = shelf(isCourse(current.group));
    var place = groups.indexOf(current.group) + delta;
    if (place >= 0 && place < groups.length) {
        selectLesson(firstOpenLesson(groups[place]));
    }
}

// Where the player was on each shelf, to come back to the same lesson.
var shelfMemory = [null, null];

function switchShelf() {
    var from = isCourse(current.group) ? 1 : 0;
    shelfMemory[from] = current;
    selectLesson(shelfMemory[1 - from] || firstOpenLesson(shelf(from === 0)[0]));
}

// The lesson after this one, across the groups of the same shelf; null at
// the very end.
function nextLesson() {
    var list = GROUPS[current.group].lessons;
    if (current.index + 1 < list.length) {
        return list[current.index + 1];
    }
    var groups = shelf(isCourse(current.group));
    for (var place = groups.indexOf(current.group) + 1; place < groups.length; place++) {
        if (groupOpen(groups[place])) {
            return GROUPS[groups[place]].lessons[0];
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
            opened.push((isCourse(g) ? "КУРС " : "СТУПЕНЬ ") + GROUPS[g].title);
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
    restart: [PX + 92, 74, 80, 17],
    shelf: [PX, 118, PW, 13]
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

var lastPressMs = -10000;   // when the latest click had been dealt with
var lastPressKind = "";     // "click" or "double"
var lastMainMs = -10000;    // the latest click on the big buttons

// Max 9 reports the second click of a quick pair twice: as a click and as a
// double click, one right after the other. Acting on both made a double click
// on an arrow move three lessons. So a call that comes straight after one of
// the other kind is the same click and is dropped. Two plain clicks are always
// two clicks, however fast. Older versions of Max report the second click
// once, as a double click only; that works too.
function press(x, y, kind) {
    if (kind !== lastPressKind && nowMs() - lastPressMs < 15) {
        return;
    }
    act(x, y, nowMs());
    // The time is taken after the work: switching a lesson saves a file, and
    // the twin of this click is already waiting behind it.
    lastPressKind = kind;
    lastPressMs = nowMs();
}

function onclick(x, y) {
    press(x, y, "click");
}

function ondblclick(x, y) {
    press(x, y, "double");
}

function act(x, y, now) {
    var big = inside(BUTTONS.restart, x, y) || inside(BUTTONS.shelf, x, y)
        || (inside(BUTTONS.main, x, y) && mainAction() !== "ПОСЛУШАТЬ");
    if (big) {
        // The big buttons change their meaning when pressed (start becomes
        // done, next becomes start), so the second click of a double click
        // must not go to the new meaning.
        if (now - lastMainMs < 400) {
            return;
        }
        lastMainMs = now;
    }
    if (inside(BUTTONS.shelf, x, y)) {
        switchShelf();
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
    if (s && s.live && clock - stepClock >= 12 && clock % checkEvery(s.live) === 0 && checkLive(s.live) === true) {
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
            ? (isCourse(current.group) ? "КУРС ОТКРОЕТСЯ НА " : "СТУПЕНЬ ОТКРОЕТСЯ НА ") + GROUPS[current.group].need + " ОЧКАХ. У ТЕБЯ " + progress.points
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
    buttonBody(BUTTONS.shelf, false);
    flush();
    var courses = isCourse(current.group);
    var groups = shelf(courses);
    var place = groups.indexOf(current.group);
    buttonCaption(BUTTONS.groupPrev, "<", place > 0);
    buttonCaption(BUTTONS.groupNext, ">", place < groups.length - 1);
    buttonCaption(BUTTONS.prev, "<", current.index > 0);
    buttonCaption(BUTTONS.next, ">", current.index < group.lessons.length - 1);
    buttonCaption(BUTTONS.main, action === "" ? "-" : action, action !== "");
    buttonCaption(BUTTONS.restart, "ЗАНОВО", canRestart);
    buttonCaption(BUTTONS.shelf, courses ? "НАЗАД К СТУПЕНЯМ" : "КУРСЫ: " + COURSE_SIZE + " УРОКОВ НА НАВЫК", true);

    label((courses ? "КУРС " : "СТУПЕНЬ ") + (place + 1) + "/" + groups.length, PX + PW / 2, 4, 1, SLATE, CENTER);
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

    legend(ORANGE, "МАЖОР", PX, 137);
    legend(GREEN, "МИНОР", PX + 58, 137);
    legend(STEEL, "ЧУЖИЕ", PX + 116, 137);
    legend(SKY, "НАЖАТЬ", PX, 149);
    legend(LIME, "ВЕРНО", PX + 58, 149);
    legend(RED, "ЛИШНЯЯ", PX + 116, 149);
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
