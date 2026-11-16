"""Build the SMK Trainer Max for Live device.

The device is Ableton's stock "Max MIDI Effect" template with a jsui object
added: the template's own header is reused and only the patcher JSON is
replaced. The script it loads is sprites_data.js + smk_trainer.js in one file.

Usage:  py build.py [destination folder]

Without a destination the device goes into the Ableton User Library
(Presets/MIDI Effects/Max MIDI Effect), where Live's browser shows it and an
open copy of the device reloads itself.
"""

import json
import os
import re
import struct
import sys
from pathlib import Path

HERE = Path(__file__).parent

DEVICE_NAME = "SMK Trainer"
SCRIPT_NAME = "smk_trainer.js"
# jsui loads a single file, so the baked animation frames go in front of the code.
SCRIPT_SOURCES = ["sprites_data.js", "smk_trainer.js"]
WIDTH = 860
HEIGHT = 169


def find_template():
    """The empty MIDI effect that ships with every Live with Max for Live."""
    found = sorted(Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData"), "Ableton")
                   .glob("Live*/Resources/Misc/Max Devices/Max MIDI Effect.amxd"))
    if not found:
        sys.exit("Max MIDI Effect.amxd not found: is Ableton Live with Max for Live installed?")
    return found[-1]


def find_user_library():
    """Where Live keeps the user's own devices, read from its newest settings."""
    settings = sorted(Path(os.environ["APPDATA"], "Ableton").glob("Live */Preferences/Library.cfg"),
                      key=lambda p: p.stat().st_mtime)
    if not settings:
        sys.exit("Ableton settings not found: pass the destination folder as an argument.")
    text = settings[-1].read_text(encoding="utf-8", errors="replace")
    block = re.search(r"<UserLibrary>.*?<ProjectPath Value=\"([^\"]*)\"", text, re.S)
    if not block:
        sys.exit("User Library path not found in " + str(settings[-1]))
    return Path(block.group(1)) / "User Library" / "Presets" / "MIDI Effects" / "Max MIDI Effect"


def newobj(obj_id, text, inlets, outlets, x, y):
    box = {
        "id": obj_id,
        "maxclass": "newobj",
        "numinlets": inlets,
        "numoutlets": len(outlets),
        "patching_rect": [x, y, 90.0, 20.0],
        "text": text,
    }
    if outlets:
        box["outlettype"] = outlets
    return {"box": box}


def line(source, outlet, destination, inlet):
    return {"patchline": {"source": [source, outlet], "destination": [destination, inlet]}}


def build_patcher(patcher):
    patcher["openinpresentation"] = 1
    patcher["title"] = DEVICE_NAME
    patcher["boxes"] += [
        newobj("obj-20", "notein", 1, ["int", "int", "int"], 200.0, 34.0),
        newobj("obj-21", "pack 0 0", 2, [""], 200.0, 64.0),
        newobj("obj-22", "prepend note", 1, [""], 200.0, 94.0),
        {"box": {
            "id": "obj-23",
            "maxclass": "jsui",
            "filename": SCRIPT_NAME,
            "border": 0,
            "numinlets": 1,
            "numoutlets": 1,
            "outlettype": [""],
            "parameter_enable": 0,
            "patching_rect": [200.0, 200.0, float(WIDTH), float(HEIGHT)],
            "presentation": 1,
            "presentation_rect": [0.0, 0.0, float(WIDTH), float(HEIGHT)],
        }},
        newobj("obj-24", "noteout", 3, [], 200.0, 390.0),
    ]
    patcher["lines"] += [
        line("obj-20", 0, "obj-21", 0),   # pitch
        line("obj-20", 1, "obj-21", 1),   # velocity
        line("obj-21", 0, "obj-22", 0),
        line("obj-22", 0, "obj-23", 0),
        line("obj-23", 0, "obj-24", 0),   # chord preview
    ]


def build_device():
    data = find_template().read_bytes()
    marker = data.index(b"ptch")
    length = struct.unpack("<I", data[marker + 4:marker + 8])[0]
    document = json.loads(data[marker + 8:marker + 8 + length].rstrip(b"\x00").decode("utf-8"))
    build_patcher(document["patcher"])
    body = json.dumps(document, indent="\t").encode("utf-8") + b"\n\x00"
    return data[:marker] + b"ptch" + struct.pack("<I", len(body)) + body


def escape_non_ascii(source):
    # The jsui engine may not read UTF-8 source reliably, so Cyrillic text is
    # shipped as \uXXXX escapes.
    return "".join(ch if ord(ch) < 128 else "\\u%04x" % ord(ch) for ch in source)


def build(dest):
    dest.mkdir(parents=True, exist_ok=True)
    device = dest / (DEVICE_NAME + ".amxd")
    script = dest / SCRIPT_NAME
    device.write_bytes(build_device())
    source = "\n".join((HERE / name).read_text(encoding="utf-8") for name in SCRIPT_SOURCES)
    script.write_text(escape_non_ascii(source), encoding="ascii")
    return device, script


def main():
    dest = Path(sys.argv[1]) if len(sys.argv) > 1 else find_user_library()
    for built in build(dest):
        print(built.name + ":", built.stat().st_size, "bytes ->", built.parent)


if __name__ == "__main__":
    main()
