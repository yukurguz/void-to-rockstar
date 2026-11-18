"""Builds trainer/lang_en.js from the Russian texts (ru_<n>.txt) and their
English (en_<n>.txt) in this folder: one pair a line, in the order the texts
stand in smk_trainer.js.

Usage:  py trainer/lang/make_lang.py
"""
import io
import json
from pathlib import Path

HERE = Path(__file__).parent


def read(name):
    lines = io.open(HERE / name, encoding="utf-8").read().replace("\r", "").split("\n")
    return {line[:4]: line[5:] for line in lines if line.strip() != ""}


def main():
    pairs = []
    missing = 0
    for part in range(1, 100):
        if not (HERE / ("ru_%d.txt" % part)).exists():
            break
        russian = read("ru_%d.txt" % part)
        english = read("en_%d.txt" % part) if (HERE / ("en_%d.txt" % part)).exists() else {}
        for number in sorted(russian):
            if number in english and english[number].strip() != "":
                pairs.append((russian[number], english[number]))
            else:
                missing += 1
    # fixes.txt: corrections made by hand after the parts were put together
    # (one name for a thing in all parts, names that have room after all).
    # They win over the parts.
    fixes = {}
    if (HERE / "fixes.txt").exists():
        for line in io.open(HERE / "fixes.txt", encoding="utf-8").read().splitlines():
            if chr(9) in line and not line.startswith("#"):
                russian, english = line.split(chr(9), 1)
                fixes[russian] = english
    known = {russian for russian, english in pairs}
    pairs = [(russian, fixes.get(russian, english)) for russian, english in pairs]
    unknown = [russian for russian in fixes if russian not in known]
    if unknown:
        print("fixes.txt names texts the trainer does not have:", unknown[:5])
    out = [
        "// English for the trainer: Russian text -> English text, word for word as the",
        "// Russian stands in smk_trainer.js. Made by trainer/lang/make_lang.py from the",
        "// tables in trainer/lang/; edit those and run it again.",
        "(function () {",
        "    var TEXT = {",
    ]
    for index, (russian, english) in enumerate(pairs):
        comma = "," if index < len(pairs) - 1 else ""
        out.append("        %s: %s%s" % (json.dumps(russian, ensure_ascii=False), json.dumps(english, ensure_ascii=False), comma))
    out += [
        "    };",
        "    for (var key in TEXT) {",
        "        if (TEXT.hasOwnProperty(key)) {",
        "            EN[key] = TEXT[key];",
        "        }",
        "    }",
        "}());",
        "",
    ]
    io.open(HERE.parent / "lang_en.js", "w", encoding="utf-8", newline="\n").write("\n".join(out))
    print("lang_en.js: %d texts, %d still without English" % (len(pairs), missing))


if __name__ == "__main__":
    main()
