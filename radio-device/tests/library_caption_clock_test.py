"""Verify the installed library's actual absolute WAV clock after native seek."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
library = Path(os.environ.get('RADIO_AUDIO_LIBRARY_DIR', str(Path.home() / 'Documents/Arduino/libraries/ESP32-audioI2S-master')))
source = (library / 'src/Audio.cpp').read_text()
hashes = json.loads((root / 'patches/library-hashes.json').read_text())
assert hashlib.sha256(source.encode()).hexdigest() == hashes['Audio.cpp']['captionClock']
structs = (library / 'src/audiolib_structs.hpp').read_text()
clock_struct = structs[structs.index('typedef struct _cat {'):structs.index('struct ifCh_t')]

def function(signature, source):
    start = source.index(signature)
    end = source.index('{', start) + 1
    depth = 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end] + '\n'

preamble = r'''
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <vector>
using std::abs;
using std::round;
uint32_t clockMs = 100;
uint32_t millis() { return clockMs; }
#define AUDIO_LOG_WARN(...) do {} while (0)
constexpr int AUDIO_LOCALFILE=1, ST_WEBFILE=2, CODEC_FLAC=3, evt_bitrate=4, evt_lyrics=5;
struct Decoder { uint32_t getAudioFileDuration() { return 60; } } decoder;
struct Line { const char* c_get() { return ""; } };
struct Audio;
template<class... T> void info(Audio&, int, const char*, T...) {}
'''
audio = r'''
struct Audio {
  cat_t m_cat;
  int m_codec = 1, m_dataMode = ST_WEBFILE, m_streamType = ST_WEBFILE;
  bool m_f_running = true;
  Decoder* m_decoder = &decoder;
  uint32_t m_audioDataStart = 44, m_audioDataSize = 60*64000;
  uint32_t m_audioCurrentTime = 0, m_audioFileDuration = 0;
  uint32_t m_nominal_bitrate = 512000, m_avr_bitrate = 0, m_lastGranulePosition = 0;
  uint32_t m_haveNewFilePos = 0;
  int32_t m_resumeFilePos = -1;
  struct { uint32_t sampleRate = 32000; } m_i2s_items;
  std::vector<Line> m_syltLines;
  std::vector<uint32_t> m_syltTimeStamp;
  uint32_t getBitRate() { return m_nominal_bitrate; }
  uint32_t getAudioFileDuration() { return m_audioFileDuration; }
  void seekDiagnostic(const char*, uint32_t, uint32_t) {}
  void stopSong() { m_f_running = false; }
  void calculateAudioTime(uint16_t, uint16_t);
  bool setAudioPlayTime(uint16_t);
  uint32_t getAudioCurrentTime();
};
'''
cases = r'''
int main() {
  Audio earlySeek;
  earlySeek.m_cat.firstCall = true;
  earlySeek.m_audioFileDuration = 60; // header known; decoder has not run yet
  assert(earlySeek.setAudioPlayTime(8));
  assert(earlySeek.m_cat.sum_samples == 0);
  earlySeek.m_haveNewFilePos = earlySeek.m_resumeFilePos;
  earlySeek.calculateAudioTime(2048, 1024);
  assert(earlySeek.getAudioCurrentTime() == 8); // one absolute seek tick
  clockMs = 200;
  earlySeek.calculateAudioTime(2048, 1024);
#ifdef CLOCK_FIXED
  assert(earlySeek.getAudioCurrentTime() == 8);
#else
  assert(earlySeek.getAudioCurrentTime() == 0); // firstCall reset lost seek samples
#endif
  clockMs = 300;
  earlySeek.calculateAudioTime(64000, 32000);
#ifdef CLOCK_FIXED
  assert(earlySeek.getAudioCurrentTime() == 9);
#else
  assert(earlySeek.getAudioCurrentTime() == 1); // then decoder-relative seconds
#endif

  clockMs = 100;
  Audio player;
  player.m_cat.firstCall = true;
  player.calculateAudioTime(64000, 32000);
  assert(player.getAudioCurrentTime() == 1 && player.getAudioFileDuration() == 60);
  assert(player.setAudioPlayTime(8));
  assert(player.m_resumeFilePos == 512044 && player.getAudioCurrentTime() == 1);
  // processWebFile stores the successfully applied seek here, then the real
  // decoder calls calculateAudioTime before delivering PCM to the raw hook.
  player.m_haveNewFilePos = player.m_resumeFilePos;
  clockMs = 200;
  player.calculateAudioTime(2048, 1024);
  assert(player.getAudioCurrentTime() == 8); // absolute, not zero or 8+8
  assert(player.m_haveNewFilePos == 0);
  clockMs = 300;
  player.calculateAudioTime(64000, 32000);
  assert(player.getAudioCurrentTime() == 9);
  clockMs += 60000;
  assert(player.getAudioCurrentTime() == 9);
  player.calculateAudioTime(0, 0);
  assert(player.getAudioCurrentTime() == 9); // stalled audio doesn't use wall time
  assert(player.setAudioPlayTime(0));
  player.m_haveNewFilePos = player.m_resumeFilePos;
  clockMs += 100; player.calculateAudioTime(2048, 1024);
  assert(player.getAudioCurrentTime() == 0);
  assert(player.setAudioPlayTime(7613 / 1000));
  player.m_haveNewFilePos = player.m_resumeFilePos;
  clockMs += 100; player.calculateAudioTime(2048, 1024);
  assert(player.getAudioCurrentTime() == 7); // actual native second resolution

  // Duration rounding must not make a late seek fall back by a second.
  Audio fractional;
  fractional.m_audioDataSize += 16000; // 60.25s; native duration rounds to 60s
  fractional.m_cat.firstCall = true;
  clockMs += 100; fractional.calculateAudioTime(2048, 1024);
  assert(fractional.setAudioPlayTime(8));
  fractional.m_haveNewFilePos = fractional.m_resumeFilePos;
  clockMs += 100; fractional.calculateAudioTime(256, 128);
  assert(fractional.getAudioCurrentTime() == 8);
  clockMs += 100; fractional.calculateAudioTime(256, 128);
#ifdef CLOCK_FIXED
  assert(fractional.getAudioCurrentTime() == 8);
#else
  assert(fractional.getAudioCurrentTime() == 7);
#endif
}
'''
with tempfile.TemporaryDirectory(prefix='radio-caption-clock-test-') as folder:
    baseline = Path(folder) / 'baseline'
    (baseline / 'src').mkdir(parents=True)
    (baseline / 'src/Audio.cpp').write_text(source)
    patch = (root / 'patches/esp32-audioI2S-4.0.0-caption-clock.patch').read_bytes()
    subprocess.run(['patch', '--batch', '-R', '-p1', '-d', str(baseline)],
                   input=patch, capture_output=True, check=True)
    legacy = (baseline / 'src/Audio.cpp').read_text()
    assert hashlib.sha256(legacy.encode()).hexdigest() == hashes['Audio.cpp']['mutexGuard']
    for name, actual_source, define in [('legacy', legacy, ''), ('fixed', source, '#define CLOCK_FIXED\n')]:
        actual = ''.join(function(sig, actual_source) for sig in ['void Audio::calculateAudioTime(',
                                            'bool Audio::setAudioPlayTime(',
                                            'uint32_t Audio::getAudioCurrentTime('])
        cpp, binary = Path(folder) / f'{name}.cpp', Path(folder) / name
        cpp.write_text(define + preamble + clock_struct + audio + actual + cases)
        subprocess.run([os.environ.get('CXX', 'clang++'), '-std=c++17', '-Wall', '-Wextra',
                        '-Wno-parentheses', str(cpp), '-o', str(binary)], check=True)
        subprocess.run([str(binary)], check=True)
print('Native early/late seek clock bug reproduced; absolute clock fix and reverse patch verified.')
