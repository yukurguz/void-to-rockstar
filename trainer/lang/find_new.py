"""Finds the Russian texts of trainer/smk_trainer.js that have no English yet
and writes them as the next part: ru_<n>.txt, one item a line (four digits, a
TAB, the text). Translate it into en_<n>.txt as BRIEF.md says, check it with
check.js and run make_lang.py.

Usage:  py trainer/lang/find_new.py
"""
import io
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
SOURCE = HERE.parent / "smk_trainer.js"
RUSSIAN = re.compile("[Ѐ-ӿ]")
BACKSLASH = chr(92)
REGEX_BEFORE = "(,=:[!&|?{};\n"


def literals(source):
    """Every string literal of the script, comments and regular expressions left out."""
    found = []
    at, size, before = 0, len(source), ""
    while at < size:
        char = source[at]
        pair = source[at:at + 2]
        if pair == "//":
            end = source.find("\n", at)
            at = size if end < 0 else end
        elif pair == "/*":
            end = source.find("*/", at + 2)
            at = size if end < 0 else end + 2
        elif char in "\"'":
            end = at + 1
            while end < size and source[end] != char:
                end += 2 if source[end] == BACKSLASH else 1
            text = source[at + 1:end]
            found.append(json.loads('"' + text + '"') if char == '"' and BACKSLASH in text else text)
            at, before = end + 1, "x"
        elif char == "/" and (before == "" or before in REGEX_BEFORE):
            end, in_class = at + 1, False
            while end < size and source[end] != "\n" and (source[end] != "/" or in_class):
                if source[end] == BACKSLASH:
                    end += 1
                elif source[end] == "[":
                    in_class = True
                elif source[end] == "]":
                    in_class = False
                end += 1
            at, before = end + 1, "x"
        else:
            if not char.isspace():
                before = char
            at += 1
    return found


def main():
    known = set()
    highest = -1
    parts = 0
    for part in range(1, 1000):
        name = HERE / ("ru_%d.txt" % part)
        if not name.exists():
            break
        parts = part
        for line in io.open(name, encoding="utf-8").read().splitlines():
            if line.strip():
                known.add(line[5:])
                highest = max(highest, int(line[:4]))
    fresh = []
    for text in literals(io.open(SOURCE, encoding="utf-8").read()):
        # single letters are the glyphs of the font, not texts
        if RUSSIAN.search(text) and len(text.strip()) > 1 and text not in known and text not in fresh:
            fresh.append(text)
    if not fresh:
        print("every Russian text of the trainer has its English")
        return
    name = HERE / ("ru_%d.txt" % (parts + 1))
    lines = ["%04d\t%s" % (highest + 1 + index, text) for index, text in enumerate(fresh)]
    io.open(name, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
    print("%d new texts written to %s" % (len(fresh), name.name))


if __name__ == "__main__":
    main()
