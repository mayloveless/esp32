"""Verify installed patch layers and reconstruct earlier layers for regressions."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
library = Path(os.environ.get('RADIO_AUDIO_LIBRARY_DIR', str(Path.home() / 'Documents/Arduino/libraries/ESP32-audioI2S-master')))
hashes = json.loads((root / 'patches/library-hashes.json').read_text())

def read_source(layer=None):
    source = (library / 'src/Audio.cpp').read_text()
    digest = hashlib.sha256(source.encode()).hexdigest()
    levels = ['captionClock', 'startTiming', 'fastWavStart']
    installed = next((name for name in levels if hashes['Audio.cpp'].get(name) == digest), None)
    assert installed, 'Apply the current library patches first: Audio.cpp'
    for name in ['Audio.h', 'RadioHttpRange.h'] + (['RadioFastWav.h'] if installed == 'fastWavStart' else []):
        key = 'fastWavStart' if installed == 'fastWavStart' and name != 'RadioHttpRange.h' else 'fixed'
        assert hashlib.sha256((library / 'src' / name).read_bytes()).hexdigest() == hashes[name][key], name
    if not layer or layer == installed:
        return source
    assert levels.index(layer) < levels.index(installed)
    with tempfile.TemporaryDirectory(prefix='radio-library-layer-') as folder:
        stage = Path(folder)
        (stage / 'src').mkdir()
        for name in ['Audio.cpp', 'Audio.h', 'RadioHttpRange.h', 'RadioFastWav.h']:
            if (library / 'src' / name).exists():
                (stage / 'src' / name).write_bytes((library / 'src' / name).read_bytes())
        patches = [('fastWavStart', 'fast-wav-start', 'startTiming'), ('startTiming', 'start-timing', 'captionClock')]
        for current, patch, previous in patches:
            if installed != current or installed == layer:
                continue
            subprocess.run(['patch', '--batch', '-R', '-p1', '-d', folder],
                input=(root / f'patches/esp32-audioI2S-4.0.0-{patch}.patch').read_bytes(),
                capture_output=True, check=True)
            installed = previous
            assert hashlib.sha256((stage / 'src/Audio.cpp').read_bytes()).hexdigest() == hashes['Audio.cpp'][installed]
        return (stage / 'src/Audio.cpp').read_text()
