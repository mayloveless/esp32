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
struct { void println(const char*) {} } Serial;
struct Audio {
  enum Event { evt_eof, evt_info, evt_log };
  struct msg_t { Event e; const char* msg = nullptr; const char* s = nullptr; };
  bool running = true;
  uint32_t position = 0;
  std::vector<msg_t> events;
  std::function<void()> step;
  void loop();
  bool isRunning() { return running; }
  void stopSong() { running = false; }
  uint32_t getAudioFilePosition() { return position; }
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
void reset(bool started = true) {
  networkAudio = Audio{};
  receiverState = ReceiverState::kPlaying;
  currentProgramId = "program";
  audioEof = audioStopPending = false;
  audioStreamReady = started;
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
}
'''
with tempfile.TemporaryDirectory(prefix='radio-playback-test-') as directory:
    source = Path(directory) / 'playback.cpp'
    binary = Path(directory) / 'playback-test'
    source.write_text(preamble + globals_ + playback + hook + cases)
    subprocess.run([os.environ.get('CXX', 'clang++'), '-std=c++17', '-Wall', '-Wextra', str(source), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print('Playback regression checks passed (host fakes, not hardware).')
