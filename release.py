"""Pack a release: the built trainer device, the keyboard's Ableton script and
the guides in one zip under dist/.

Usage:  py release.py <version>      e.g.  py release.py 0.1.0
"""

import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT / "trainer"))

import build  # noqa: E402  (trainer/build.py)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    version = sys.argv[1]
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    archive = dist / ("smk37-kit-" + version + ".zip")

    with tempfile.TemporaryDirectory() as temp:
        staging = Path(temp)
        build.build(staging / "SMK Trainer")
        shutil.copytree(ROOT / "ableton" / "SMK37", staging / "SMK37 Remote Script" / "SMK37")
        for name in ("INSTALL.md", "SMK-37-Bluetooth-MIDI.md", "THIRD_PARTY_NOTICES.md"):
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
