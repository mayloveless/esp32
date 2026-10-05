"""Run the sketch's actual playback functions with host-side audio/network fakes.
Requires Python 3 and a C++17 compiler; does not replace ESP32 compilation.
"""
from pathlib import Path
import os
import subprocess
import tempfile

sketch = (Path(__file__).resolve().parents[1] / 'radio-device.ino').read_text()
globals_ = sketch[sketch.index('constexpr uint8_t'):sketch.index('String deviceApiUrl')]
playback = sketch[sketch.index('void onAudioInfo'):sketch.index('}  // namespace')]
hook = sketch[sketch.index('void audio_process_raw_samples'):sketch.index('void setup()')]
preamble = r'''
#include <atomic>
#include <cassert>
#include <cstdint>
#include <cstring>
#include <functional>
#include <string>
#include <vector>
using String = std::string;
uint32_t clockMs = 0;
uint32_t millis() { return clockMs; }
constexpr int WL_CONNECTED = 3;
struct { int connection = WL_CONNECTED; int status() { return connection; } } WiFi;
struct {
  void println(const char*) {}
  template<class... T> void printf(const char*, T...) {}
} Serial;
struct Audio {
  enum Event { evt_eof, evt_info, evt_log };
  struct msg_t { Event e; const char* msg = nullptr; const char* s = nullptr; };
  bool running = true;
  uint32_t position = 0;
  std::vector<uint16_t> seeks;
  bool seekSucceeds = true;
  std::vector<msg_t> events;
  std::function<void()> step;
  void loop();
  bool isRunning() { return running; }
  void stopSong() { running = false; }
  uint32_t getAudioFilePosition() { return position; }
  bool setAudioPlayTime(uint16_t seconds) {
    seeks.push_back(seconds);
    return seekSucceeds;
  }
};
int completed = 0;
void sendCompleted(const String& id) { assert(id == "program"); ++completed; }
'''
cases = r'''
void Audio::loop() {
  auto pending = events;
  events.clear();
  for (auto event : pending) onAudioInfo(event);
  if (running && step) step();
}
void reset(bool started = true, uint32_t offsetMs = 0) {
  networkAudio = Audio{};
  receiverState = ReceiverState::kPlaying;
  currentProgramId = "program";
  audioEof = audioStopPending = false;
  audioStreamReady = started;
  prepareStartOffset(offsetMs);
  audioProducedSamples = false;
  if (started) audio_process_raw_samples(nullptr, 128);
  audioError = false;
  audioStartMillis = audioProgressMillis = lastAudioPosition = clockMs = 0;
  WiFi.connection = WL_CONNECTED;
  completed = 0;
}
void tick() { if (receiverState == ReceiverState::kPlaying) updatePlayback(); }
void eofOnNextLoop() {
  networkAudio.step = [] {
    networkAudio.stopSong();
    networkAudio.events.push_back({Audio::evt_eof});
  };
}
void failed() { assert(receiverState == ReceiverState::kIdle); assert(completed == 0); assert(!networkAudio.running); }
int main() {
  reset(); eofOnNextLoop(); tick();
  assert(receiverState == ReceiverState::kPlaying && completed == 0);
  tick(); assert(receiverState == ReceiverState::kIdle && completed == 1);
  tick(); assert(completed == 1);

  // Header timeout emits EOF even with library logging disabled.
  reset(false); eofOnNextLoop(); tick(); tick(); failed();
  reset(false); audioStreamReady = true; eofOnNextLoop(); tick(); tick(); failed();
  reset(); onAudioInfo({Audio::evt_log, "redacted", "LOGE"});
  eofOnNextLoop(); tick(); tick(); failed();

  reset(); networkAudio.stopSong(); tick(); tick(); failed();
  reset(false); clockMs = 15000; tick(); failed();
  reset(); WiFi.connection = 0; tick(); failed();
  reset(); clockMs = 30000; tick(); failed();
  reset(); clockMs = 29000; networkAudio.position = 4096; tick();
  clockMs = 31000; tick(); assert(receiverState == ReceiverState::kPlaying);
  clockMs = 59000; tick(); failed();
  reset(); audioProgressMillis = UINT32_MAX - 10000; clockMs = 20000;
  tick(); failed();

  // Offset 0 keeps normal playback and does not call the seek API.
  reset(); tick(); assert(networkAudio.seeks.empty());
  eofOnNextLoop(); tick(); tick(); assert(completed == 1);

  // Pre-seek samples are not evidence of successful offset playback.
  reset(false, 8300);
  audio_process_raw_samples(nullptr, 128);
  tick(); tick(); assert(networkAudio.seeks.empty() && !audioProducedSamples);
  onAudioInfo({Audio::evt_info, "stream ready"});
  assert(networkAudio.seeks.empty()); // callback only sets a flag
  tick(); assert(networkAudio.seeks == std::vector<uint16_t>{8});
  assert(!audioSeekPending && receiverState == ReceiverState::kPlaying);
  tick(); tick(); assert(networkAudio.seeks.size() == 1);
  audio_process_raw_samples(nullptr, 128);
  eofOnNextLoop(); tick(); tick();
  assert(completed == 1 && receiverState == ReceiverState::kIdle);

  reset(true, 8300); networkAudio.seekSucceeds = false;
  tick(); failed(); tick(); assert(networkAudio.seeks.size() == 1);

  // A positive subsecond offset still makes one explicit native seek to 0.
  reset(true, 999); tick(); assert(networkAudio.seeks == std::vector<uint16_t>{0});
  reset(true, UINT32_MAX); tick(); failed(); assert(networkAudio.seeks.empty());

  // EOF before seek, or before post-seek samples, is never completed.
  reset(false, 8300); eofOnNextLoop(); tick(); tick(); failed();
  reset(true, 8300); networkAudio.events.push_back({Audio::evt_eof});
  tick(); failed(); assert(networkAudio.seeks.empty());
  reset(true, 8300); tick(); eofOnNextLoop(); tick(); tick(); failed();

  // Waiting for ready retains original startup, disconnect and error guards.
  reset(false, 8300); clockMs = 15000; tick(); failed();
  reset(false, 8300); WiFi.connection = 0; tick(); failed();
  reset(true, 8300); WiFi.connection = 0; tick(); failed();
  assert(networkAudio.seeks.empty());
  reset(true, 8300); audioError = true; tick(); failed();
  assert(networkAudio.seeks.empty());
  // After seeking, missing samples time out and a stalled stream still fails.
  reset(true, 8300); clockMs = 500; tick();
  clockMs = 15500; tick(); failed();
  reset(true, 8300); tick(); audio_process_raw_samples(nullptr, 128);
  clockMs = 30000; tick(); failed();
  // Native seek may be accepted and fail when the next loop performs I/O.
  reset(true, 8300); tick();
  networkAudio.events.push_back({Audio::evt_log, "redacted", "LOGE"});
  tick(); failed(); assert(networkAudio.seeks.size() == 1);
  reset(true, 8300); tick(); networkAudio.stopSong();
  tick(); tick(); failed();
  // A simultaneous failure and EOF cannot retire even after normal samples.
  reset(); WiFi.connection = 0; networkAudio.events.push_back({Audio::evt_eof});
  tick(); failed();
}
'''
with tempfile.TemporaryDirectory(prefix='radio-playback-test-') as directory:
    source = Path(directory) / 'playback.cpp'
    binary = Path(directory) / 'playback-test'
    source.write_text(preamble + globals_ + playback + hook + cases)
    subprocess.run([os.environ.get('CXX', 'clang++'), '-std=c++17', '-Wall', '-Wextra', str(source), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print('Playback regression checks passed (host fakes, not hardware).')
