# Control surface for the M-Vave / Movetone SMK-37 Elite (Bluetooth via loopMIDI).
#
# Encoders K1-K8 -> the 8 main parameters of the selected device (macros for racks)
# Faders 1-4     -> volume of tracks 1-4
# Pads           -> the 16 visible Drum Rack pads (pad bank that sends plain notes)
# In the other pad bank the top-row pads 1-4 send a toggle-style note, so there
# they are used as transport buttons
#
# All numbers below were measured on the keyboard. Channels are 0-based:
# MIDI channel 1 is 0, channel 9 is 8.

import Live
from _Framework.ControlSurface import ControlSurface
from _Framework.InputControlElement import MIDI_CC_TYPE, MIDI_NOTE_TYPE
from _Framework.EncoderElement import EncoderElement
from _Framework.SliderElement import SliderElement
from _Framework.ButtonElement import ButtonElement
from _Framework.MixerComponent import MixerComponent

try:
    from _Generic.Devices import best_of_parameter_bank
except Exception:
    best_of_parameter_bank = None

PORT_NAME = 'SMK-37 BT'

# Encoders are endless and relative: every tick sends 1 in one direction and
# 69 in the other. No built-in Live map mode decodes that symmetrically, so the
# script handles them itself.
ENCODER_CHANNEL = 0
ENCODER_CCS = (30, 31, 32, 33, 34, 35, 36, 37)
ENCODER_LOW_VALUE_INCREASES = False  # True swaps the turning direction
ENCODER_TICKS_FULL_RANGE = 200       # ticks to sweep a parameter from min to max
ENCODER_TICKS_PER_STEP = 12          # ticks per step of a switch / list parameter

# What K1-K8 control on devices Ableton itself has no "best of" bank for, by
# parameter name; '' leaves an encoder unused. The trainer's sound lessons
# name encoders after this table.
EXTRA_BANKS = {
    'Drift': ('LP Freq', 'LP Res', 'Env 1 Attack', 'Env 1 Decay',
              'Env 1 Sustain', 'Env 1 Release', 'LFO Amount', 'Volume'),
    'Delay': ('L 16th', 'R 16th', 'Feedback', 'Filter Freq',
              'Filter Width', 'LFO > Filter', 'LFO > Delay', 'Dry/Wet'),
    'Chorus2': ('Amount', 'Rate', 'Feedback', 'Width',
                'Warmth', 'HP Freq', 'Output', 'Dry/Wet'),
    'AutoFilter2': ('Frequency', 'Resonance', 'Filter Type', 'Drive',
                    'Env Amount', 'LFO Amount', 'LFO Freq', 'Dry/Wet'),
    'Redux2': ('Sample Rate', 'Jitter', 'Bit Depth', 'Quantizer Shape',
               'Post-Filter', 'DC Shift', '', 'Dry/Wet'),
    'Limiter': ('Input Gain', 'Ceiling', 'Release', 'Lookahead', '', '', '', ''),
    'Hybrid': ('Decay', 'Size', 'Predelay', 'Damping',
               'Diffusion', 'Blend', 'Width', 'Dry/Wet'),
    'PhaserNew': ('LFO Amount', 'LFO 1 Freq', 'Feedback', 'Notches',
                  'Warmth', 'Flanger Time', 'Output', 'Dry/Wet'),
    'Roar': ('Drive', 'Shaper 1 Amt', 'Shaper 1 Bias', 'Flt 1 Freq',
             'Comp Amt', '', 'Output', 'Dry/Wet'),
    'DrumCell': ('Transpose', 'Detune', 'Attack', 'Hold',
                 'Decay', 'Filter Freq', 'Pan', 'Volume'),
}

FADER_CHANNEL = 0
FADER_CCS = (68, 69, 70, 71)

# The keys, the mod wheel and the pitch wheel are sent on three different
# channels. Live cannot move pitch bend to another channel, so the keys (notes
# and CCs such as a sustain pedal) and the mod wheel are moved onto the
# pitch-bend channel. A track that listens to that one channel then gets the
# keys with both wheels and none of the pads.
KEYS_CHANNEL = 14
MOD_WHEEL_CHANNEL = 2
MOD_WHEEL_CC = 1
PITCH_BEND_CHANNEL = 3

# Notes of the pads (plain-note pad bank) in Drum Rack order: the first note
# plays the bottom-left visible Drum Rack pad, then left to right, row by row
# upwards. The order was pressed in by the owner: keyboard bottom row left to
# right, then top row left to right.
PAD_CHANNEL = 8
PAD_NOTES = (37, 36, 42, 54,
             48, 47, 45, 43,
             40, 38, 46, 44,
             49, 55, 51, 53)

# (column, row, note, channel); row 3 is the bottom row of the visible pads.
PAD_TRANSLATIONS = tuple((index % 4, 3 - index // 4, note, PAD_CHANNEL)
                         for index, note in enumerate(PAD_NOTES))

# Other pad bank, top-row pads 1-4: one message per press, velocity alternates,
# so any message counts as a press.
TRANSPORT_CHANNEL = 1
PLAY_NOTE = 16
STOP_NOTE = 17
RECORD_NOTE = 18
METRONOME_NOTE = 19


class SMK37(ControlSurface):

    def __init__(self, c_instance):
        super(SMK37, self).__init__(c_instance)
        self._encoders = []
        self._sliders = []
        self._buttons = []
        self._listeners = []
        self._ticks = {}
        self._last_device = None
        with self.component_guard():
            self._suggested_input_port = PORT_NAME
            self._suggested_output_port = ''
            self._setup_encoders()
            self._setup_faders()
            self._setup_transport()
            self.set_pad_translations(PAD_TRANSLATIONS)
        self.log_message('SMK37: script loaded, %d pads, keys on channel %d'
                         % (len(PAD_TRANSLATIONS), PITCH_BEND_CHANNEL + 1))

    _translation_logged = False

    def build_midi_map(self, midi_map_handle):
        super(SMK37, self).build_midi_map(midi_map_handle)
        try:
            # The mod wheel goes first and the keys channel skips its CC number:
            # two translations must not point at the same CC on the same channel.
            mod_result = self._c_instance.set_cc_translation(
                MOD_WHEEL_CC, MOD_WHEEL_CHANNEL, MOD_WHEEL_CC, PITCH_BEND_CHANNEL)
            other_results = set()
            for number in range(128):
                other_results.add(repr(self._c_instance.set_note_translation(
                    number, KEYS_CHANNEL, number, PITCH_BEND_CHANNEL)))
                if number != MOD_WHEEL_CC:
                    other_results.add(repr(self._c_instance.set_cc_translation(
                        number, KEYS_CHANNEL, number, PITCH_BEND_CHANNEL)))
            if not self._translation_logged:
                self._translation_logged = True
                self.log_message('SMK37: mod wheel translation returned %r, others %s'
                                 % (mod_result, sorted(other_results)))
        except Exception as error:
            self.log_message('SMK37: channel translation failed: %r' % (error,))

    # ---------------------------------------------------------------- setup

    def _setup_encoders(self):
        for index, cc in enumerate(ENCODER_CCS):
            encoder = EncoderElement(MIDI_CC_TYPE, ENCODER_CHANNEL, cc,
                                     Live.MidiMap.MapMode.relative_signed_bit)
            listener = self._make_encoder_listener(index)
            encoder.add_value_listener(listener)
            self._encoders.append(encoder)
            self._listeners.append(listener)

    def _setup_faders(self):
        self._mixer = MixerComponent(len(FADER_CCS))
        for index, cc in enumerate(FADER_CCS):
            slider = SliderElement(MIDI_CC_TYPE, FADER_CHANNEL, cc)
            self._mixer.channel_strip(index).set_volume_control(slider)
            self._sliders.append(slider)

    def _setup_transport(self):
        actions = ((PLAY_NOTE, self._on_play), (STOP_NOTE, self._on_stop),
                   (RECORD_NOTE, self._on_record), (METRONOME_NOTE, self._on_metronome))
        for note, action in actions:
            button = ButtonElement(True, MIDI_NOTE_TYPE, TRANSPORT_CHANNEL, note)
            button.add_value_listener(action)
            self._buttons.append(button)
            self._listeners.append(action)

    # ------------------------------------------------------------- encoders

    def _make_encoder_listener(self, index):
        def listener(value):
            self._on_encoder(index, value)
        return listener

    def _selected_device(self):
        track = self.song().view.selected_track
        device = track.view.selected_device
        if device is None and len(track.devices) > 0:
            device = track.devices[0]
        return device

    def _device_parameters(self, device):
        parameters = []
        names = EXTRA_BANKS.get(device.class_name)
        if names:
            by_name = {}
            for parameter in device.parameters:
                by_name.setdefault(parameter.original_name, parameter)
            parameters = [by_name.get(name) for name in names]
        elif best_of_parameter_bank is not None:
            try:
                parameters = list(best_of_parameter_bank(device))
            except Exception:
                parameters = []
        if not any(parameter is not None for parameter in parameters):
            parameters = list(device.parameters)[1:9]
        return parameters

    def _on_encoder(self, index, value):
        if value in (0, 64):
            return
        direction = 1 if (value < 64) == ENCODER_LOW_VALUE_INCREASES else -1
        try:
            device = self._selected_device()
            if device is None:
                return
            if device != self._last_device:
                self._last_device = device
                self._ticks = {}
                self.show_message('SMK-37: ' + device.name)
            parameters = self._device_parameters(device)
            if index >= len(parameters):
                return
            parameter = parameters[index]
            if parameter is None or not parameter.is_enabled:
                return
            if parameter.is_quantized:
                ticks = self._ticks.get(index, 0) + direction
                if abs(ticks) < ENCODER_TICKS_PER_STEP:
                    self._ticks[index] = ticks
                    return
                self._ticks[index] = 0
                new_value = parameter.value + direction
            else:
                span = parameter.max - parameter.min
                new_value = parameter.value + direction * span / float(ENCODER_TICKS_FULL_RANGE)
            parameter.value = max(parameter.min, min(parameter.max, new_value))
        except Exception as error:
            self.log_message('SMK37: encoder %d failed: %r' % (index + 1, error))

    # ------------------------------------------------------------ transport

    def _on_play(self, value):
        song = self.song()
        if song.is_playing:
            song.stop_playing()
        else:
            song.start_playing()

    def _on_stop(self, value):
        self.song().stop_playing()

    def _on_record(self, value):
        song = self.song()
        song.record_mode = not song.record_mode

    def _on_metronome(self, value):
        song = self.song()
        song.metronome = not song.metronome
