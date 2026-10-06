"""Run the installed library's real decode path with a failed/successful mutex."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
library = Path(os.environ.get('RADIO_AUDIO_LIBRARY_DIR', str(Path.home() / 'Documents/Arduino/libraries/ESP32-audioI2S-master')))
source = (library / 'src/Audio.cpp').read_text()
hashes = json.loads((root / 'patches/library-hashes.json').read_text())['Audio.cpp']
assert hashlib.sha256(source.encode()).hexdigest() == hashes.get('captionClock', hashes['mutexGuard']), 'Apply the current library patches first'
function = source[source.index('void Audio::playAudioData() {'):source.index('std::vector<ps_ptr<char>> Audio::readHeader()')]
preamble = r'''
#include <algorithm>
#include <cassert>
#include <cstdint>
using std::min;
constexpr int pdTRUE = 1, configTICK_RATE_HZ = 100;
constexpr int AUDIO_LOCALFILE = 1, ST_WEBFILE = 2, ST_WEBSTREAM = 3, FORMAT_M3U8 = 4;
bool takeOK = true, owned = false;
int takes = 0, gives = 0;
int xSemaphoreTake(int, int) { ++takes; owned = takeOK; return takeOK; }
void xSemaphoreGive(int) { assert(owned); owned = false; ++gives; }
void vTaskDelay(int) {}
#define AUDIO_LOG_DEBUG(...) do {} while (0)
struct Buffer {
  size_t bufferFilled() { return 0; }
  size_t readSpace() { return 4096; }
  size_t getMaxBlockSize() { return 4096; }
  uint8_t* getReadPtr() { return nullptr; }
  void bytesWasRead(int) {}
};
struct Audio {
  bool m_f_eof = false, m_f_lockInBuffer = false, m_f_stream = true;
  bool m_f_firstPlayCall = true, m_f_ID3v1TagFound = false;
  bool m_f_allDataReceived = false, m_f_tts = false, m_f_chunked = false;
  int m_validSamples = 0, m_dataMode = AUDIO_LOCALFILE, m_streamType = 0, m_playlistFormat = 0;
  int mutex_audioTaskIsDecoding = 0, decodes = 0;
  size_t m_audioDataReadPtr = 0, m_audioDataSize = 100000, m_audioDataStart = 44, m_audioFilePosition = 44;
  int m_bytesNotConsumed = 0;
  Buffer InBuff, SamplesBuff;
  struct { int count = 0, bytesDecoded = 0; size_t bytesToDecode = 0, oldAudioDataSize = 0; bool lastFrames = false; } m_pad;
  void playAudioData();
  void playChunk() {}
  void cacheSamples() {}
  int sendBytes(uint8_t*, size_t bytes) { ++decodes; return bytes; }
};
'''
cases = r'''
int main() {
  // Reproduce seek contention: another task owns the mutex longer than timeout.
  Audio audio; takeOK = false; audio.playAudioData();
  assert(takes == 1 && gives == 0 && audio.decodes == 0);
  // The next successful iteration resumes decoding and releases its own lock.
  takeOK = true; audio.playAudioData();
  assert(takes == 2 && gives == 1 && audio.decodes == 1 && !owned);
  // EOF's goto-exit still releases an acquired mutex exactly once.
  Audio eof; eof.m_audioDataSize = 0; eof.playAudioData();
  assert(takes == 3 && gives == 2 && eof.decodes == 0 && !owned);
  // Existing lock/stream guards still skip decoding without taking a mutex.
  audio.m_f_lockInBuffer = true; audio.playAudioData();
  assert(takes == 3 && gives == 2);
}
'''
with tempfile.TemporaryDirectory(prefix='radio-mutex-test-') as directory:
    cpp, binary = (Path(directory) / name for name in ('test.cpp', 'test'))
    cpp.write_text(preamble + function + cases)
    subprocess.run([os.environ.get('CXX', 'clang++'), '-std=c++17', '-Wall', '-Wextra',
                    str(cpp), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print('Native decode mutex timeout/resume/EOF regression passed.')
