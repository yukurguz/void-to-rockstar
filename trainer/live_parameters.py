"""Collects the parameter names of Ableton's devices into live_parameters.json.

The trainer's lessons check knobs by name ("knob:Drift:LP Freq:down"). A
misspelt name does no harm in the tests, which play on a made-up Ableton,
and never passes in the real one. Ableton ships its own tables of names, for
its control surface scripts; this reads them, and test_trainer.js checks
every knob of every lesson against the result.

  py -3.11 live_parameters.py            (reads Ableton's tables)
  py -3.11 live_parameters.py --seen     (adds what the trainer itself saw)

Run it again after an Ableton update. The tables list what a control surface
shows on its knobs. That is most of a device's parameters but not all, and it
includes a few settings that are not parameters at all (the voice mode of
Drift, the unison mode of Wavetable): the Live API keeps those as properties
of the device, and a knob check on them never passes. The known ones are
listed in SETTINGS and left out.

The second form is the stronger evidence. The trainer has a self-check: with
a file named smk_trainer_probe.txt next to the device it writes
smk_trainer_probe.json, with the parameters of every device on its track as
Ableton itself lists them. --seen copies those lists into
live_parameters_seen.json, and for such a device the test trusts only them.
"""
import collections
import glob
import importlib.machinery
import json
import marshal
import os
import sys
import types

SCRIPTS = glob.glob(r"C:\ProgramData\Ableton\Live 1*\Resources\MIDI Remote Scripts")
FILES = [
    r"_Generic\Devices.pyc",
    r"ableton\v3\control_surface\default_bank_definitions.pyc",
    r"ableton\v2\control_surface\default_bank_definitions.pyc",
    r"Push2\custom_bank_definitions.pyc",
]
# Keys of a bank that hold button labels, not parameter names.
NOT_PARAMETERS = ("Options", "view_description")
# Settings a control surface shows like knobs, which the Live API has as
# properties of the device instead (see DriftDevice, WavetableDevice and
# MeldDevice in the Live Object Model).
SETTINGS = {
    "Drift": ["Voice Mode", "Voice Count", "PB Range", "Osc Select", "Shape Mod Src", "LP Mod Src 1", "LP Mod Src 2",
              "LFO Mod Src", "Pitch Mod Src 1", "Pitch Mod Src 2", "Mod Slot", "Mod Dest", "Mod Source 1", "Mod Source 2",
              "Mod Source 3", "Mod Dest 1", "Mod Dest 2", "Mod Dest 3"],
    "InstrumentVector": ["Unison Mode", "Unison Voices", "Mono On", "Poly Voices", "Filter Routing", "Osc 1 Effect Type",
                         "Osc 2 Effect Type", "Osc 1 Table", "Osc 2 Table", "Osc 1 Category", "Oscillator", "Filter",
                         "Envelopes", "LFO", "Modulation Target Names", "Current Mod Target", "Amp Env View", "Mod Env View"],
    "InstrumentMeld": ["Stack Voices", "Mono Poly", "Poly Voices", "Selected Engine", "Selected Env", "Envelope View",
                       "LFO1 Effect"],
}


def load(base, name):
    with open(os.path.join(base, name), "rb") as handle:
        handle.read(16)  # magic, flags, date, size
        return marshal.loads(handle.read())


class Name(str):
    """A name wrapped by use(...): remembers the names it may turn into."""

    def __getattr__(self, attribute):
        if attribute.startswith("__") or attribute == "others":
            raise AttributeError(attribute)

        def chained(*args, **kwargs):
            if attribute == "else_use":
                if not hasattr(self, "others"):
                    self.others = []
                for arg in args:
                    if isinstance(arg, str):
                        self.others.append(str(arg))
                        self.others.extend(getattr(arg, "others", []))
            return self
        return chained


class Stub(types.ModuleType):
    """Stands for everything the scripts import from Ableton itself."""
    __path__ = []

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        if name == "IndexedDict":
            return collections.OrderedDict
        if name == "old_div":
            return lambda a, b: a // b
        if name.endswith("_KEY"):
            return name
        return Stub(self.__name__ + "." + name)

    def __call__(self, *args, **kwargs):
        if args and isinstance(args[0], str):
            return Name(args[0])
        return self


class Finder:
    @staticmethod
    def find_spec(name, path, target=None):
        if name.split(".")[0] in ("past", "future", "Live", "ableton", "_Framework", "_Generic", "Push2", "pushbase"):
            return importlib.machinery.ModuleSpec(name, Finder, is_package=True)
        return None

    @staticmethod
    def create_module(spec):
        return sys.modules.get(spec.name) or Stub(spec.name)

    @staticmethod
    def exec_module(module):
        pass


def gather(value, out):
    if isinstance(value, str):
        for name in [str(value)] + list(getattr(value, "others", [])):
            name = name.strip()
            if name and name not in out:
                out.append(name)
    elif isinstance(value, dict):
        for key, item in value.items():
            if key not in NOT_PARAMETERS:
                gather(item, out)
    elif isinstance(value, (tuple, list)):
        for item in value:
            gather(item, out)


def user_library():
    """Where the trainer lives: the folder build.py puts the device into."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import build
    return build.find_user_library()


def add_seen():
    here = os.path.dirname(os.path.abspath(__file__))
    probe = os.path.join(str(user_library()), "smk_trainer_probe.json")
    if not os.path.exists(probe):
        sys.exit("no smk_trainer_probe.json: put smk_trainer_probe.txt next to the device and reload it")
    with open(probe, encoding="utf-8") as handle:
        answer = json.load(handle)
    out = os.path.join(here, "live_parameters_seen.json")
    seen = {}
    if os.path.exists(out):
        with open(out, encoding="utf-8") as handle:
            seen = json.load(handle)
    for device in answer.get("devices", []):
        if len(device["parameters"]) > 1:
            seen[device["cls"]] = device["parameters"]
            print("%s: %d parameters, as Ableton lists them" % (device["cls"], len(device["parameters"])))
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(seen, handle, ensure_ascii=False, indent=0, sort_keys=True)


def main():
    if "--seen" in sys.argv:
        return add_seen()
    if not SCRIPTS:
        sys.exit("Ableton Live is not installed where expected")
    base = sorted(SCRIPTS)[-1]
    sys.meta_path.append(Finder)
    # The one module the tables really need: the names themselves.
    names = types.ModuleType("_Generic.device_parameters")
    exec(load(base, r"_Generic\device_parameters.pyc"), names.__dict__)
    sys.modules["_Generic.device_parameters"] = names

    result = {}
    for name in FILES:
        space = {"__name__": "tables", "__package__": "_Generic", "device_parameters": names}
        exec(load(base, name), space)
        for key, value in space.items():
            if not (isinstance(value, dict) and key in ("DEVICE_DICT", "BANK_DEFINITIONS")):
                continue
            for cls, banks in value.items():
                if isinstance(cls, str):
                    gather(banks, result.setdefault(cls, []))
    for cls, found in result.items():
        for name in SETTINGS.get(cls, []):
            if name in found:
                found.remove(name)
        # Every device has this one, and no table bothers to list it.
        found.insert(0, "Device On")
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "live_parameters.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=0, sort_keys=True)
    print("%d devices, %d names -> %s" % (len(result), sum(len(v) for v in result.values()), out))


if __name__ == "__main__":
    main()
