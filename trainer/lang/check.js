// Checks one part of the English text against its Russian.
// Usage: node check.js <part number>
const fs = require("fs");
const path = require("path");
const part = process.argv[2];
const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8").replace(/\r/g, "").split("\n").filter((l) => l !== "");
const ru = read("ru_" + part + ".txt");
let en;
try { en = read("en_" + part + ".txt"); } catch (e) { console.log("no en_" + part + ".txt yet"); process.exit(1); }
const ALLOWED = /^[A-Za-z0-9 .,:!?\-+\/%()<>#|→°★]*$/;
const CHORD = /^[A-G][#b]?(maj|mMaj|m|dim|aug|sus|add)?[0-9]*(sus[24])?([b#][0-9]+)*(\/[A-G][#b]?)?$/;
const byId = {};
const bad = [];
for (const line of en) {
    const tab = line.indexOf("\t");
    if (tab !== 4) { bad.push("not an item (need 4 digits, a tab, the text): " + line.slice(0, 60)); continue; }
    if (byId[line.slice(0, 4)] !== undefined) { bad.push(line.slice(0, 4) + " twice"); }
    byId[line.slice(0, 4)] = line.slice(5);
}
for (const line of ru) {
    const id = line.slice(0, 4), from = line.slice(5), to = byId[id];
    const say = (what) => bad.push(id + " " + what + "\n      RU: " + from + "\n      EN: " + to);
    if (to === undefined) { bad.push(id + " is missing"); continue; }
    if (!ALLOWED.test(to)) { say("has a character the font lacks: " + JSON.stringify((to.match(/[^A-Za-z0-9 .,:!?\-+\/%()<>#|→°★]/g) || []).join(""))); }
    if (/^\s*/.exec(from)[0] !== /^\s*/.exec(to)[0] || /\s*$/.exec(from)[0] !== /\s*$/.exec(to)[0]) { say("spaces at the start or the end differ"); }
    if (from.split("|").length !== to.split("|").length) { say("a different number of | separators"); }
    const limit = from.length <= 14 ? from.length + 1 : Math.max(from.length + 2, Math.floor(from.length * 1.08));
    if (to.length > limit) { say("too long: " + to.length + " characters, the limit is " + limit + " (the Russian has " + from.length + ")"); }
    if (to.trim() === "" && from.trim() !== "") { say("is empty"); }
    const latin = from.match(/[A-Za-z][A-Za-z0-9#]*/g) || [];
    for (const word of latin) {
        const exact = CHORD.test(word) || /[a-z]/.test(word);
        if (word.length >= 2 && (exact ? to.indexOf(word) < 0 : to.toLowerCase().indexOf(word.toLowerCase()) < 0)) { say("lost " + word); }
    }
    for (const number of from.match(/[0-9]+/g) || []) {
        if (to.indexOf(number) < 0) { say("lost the number " + number); }
    }
    for (const word of to.match(/[A-Za-z0-9#\/]+/g) || []) {
        if (/[a-z]/.test(word) && /[A-Z]/.test(word.slice(1)) && !CHORD.test(word) && from.indexOf(word) < 0) { say("odd capitals in " + word); }
    }
}
for (const id of Object.keys(byId)) {
    if (!ru.some((line) => line.slice(0, 4) === id)) { bad.push(id + " is not in the Russian part"); }
}
console.log(bad.slice(0, 40).join("\n"));
console.log(bad.length === 0 ? "OK: part " + part + ", " + ru.length + " items" : bad.length + " problems (first 40 shown)");
process.exit(bad.length === 0 ? 0 : 1);
