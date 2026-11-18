"""Pack a release: the built trainer device, the keyboard's Ableton script, the
Bluetooth bridge starter and the guides in one zip under dist/.

Usage:  py release.py <version>      e.g.  py release.py 0.1.0
"""

import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT / "trainer"))

import build  # noqa: E402  (trainer/build.py)


def trainer_version():
    """The number the trainer shows on its panel."""
    source = (ROOT / "trainer" / "smk_trainer.js").read_text(encoding="utf-8")
    found = re.search(r'^var VERSION = "([^"]+)";', source, re.MULTILINE)
    return found.group(1) if found else None


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    version = sys.argv[1]
    shown = trainer_version()
    if shown != version:
        sys.exit("The trainer calls itself %s, not %s: set VERSION in trainer/smk_trainer.js first." % (shown, version))
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    archive = dist / ("smk37-kit-" + version + ".zip")

    with tempfile.TemporaryDirectory() as temp:
        staging = Path(temp)
        build.build(staging / "SMK Trainer")
        shutil.copytree(ROOT / "ableton" / "SMK37", staging / "SMK37 Remote Script" / "SMK37")
        shutil.copytree(ROOT / "bridge", staging / "Bluetooth Bridge")
        for name in ("INSTALL.md", "INSTALL.en.md", "SMK-37-Bluetooth-MIDI.md", "SMK-37-Bluetooth-MIDI.en.md",
                     "THIRD_PARTY_NOTICES.md", "LICENSE.md", "COMMERCIAL.md"):
            shutil.copy(ROOT / name, staging / name)
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as packed:
            for file in sorted(staging.rglob("*")):
                if file.is_file():
                    packed.write(file, file.relative_to(staging).as_posix())

    with zipfile.ZipFile(archive) as packed:
        for info in packed.infolist():
            print("%9d  %s" % (info.file_size, info.filename))
    print(archive.name + ":", archive.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
