"""Exercise actual EC11, tune, manifest and playback functions with host I/O.
Uses the installed ArduinoJson headers; does not replace ESP32/hardware checks.
"""
from pathlib import Path
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
sketch = (root / 'radio-device.ino').read_text()
globals_ = sketch[sketch.index('constexpr uint8_t'):sketch.index('String deviceApiUrl')]
controls = sketch[sketch.index('static_assert(RADIO_ENCODER'):sketch.index('struct WifiDiagnosticEvent')]
flow = sketch[sketch.index('void startManifestPlayback(JsonObjectConst manifest, uint32_t requestedRevision) {'):sketch.index('void onAudioInfo')]
playback = sketch[sketch.index('void onAudioInfo'):sketch.index('}  // namespace')]
hook = sketch[sketch.index('void audio_process_raw_samples'):sketch.index('void setup()')]
json_headers = Path(os.environ.get('ARDUINO_LIBRARY_DIR', str(Path.home() / 'Documents/Arduino/libraries'))) / 'ArduinoJson/src'
preamble = r'''
#include <ArduinoJson.h>
#include <atomic>
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <sstream>
#include <vector>
#include <functional>
#include <new>
#include "controls.h"
#include "ReceiverControls.h"
#include "RadioManifestPrefetch.h"
using String = std::string;
struct TestQueue { std::vector<void*> items; };
using QueueHandle_t = TestQueue*;
constexpr int pdTRUE = 1, pdPASS = 1;
constexpr uint32_t portMAX_DELAY = UINT32_MAX;
bool taskCreateOK = true;
QueueHandle_t xQueueCreate(int, size_t) { return new TestQueue; }
void vQueueDelete(QueueHandle_t q) { delete q; }
int xQueueSend(QueueHandle_t q, void* value, uint32_t) {
  if (!q || !q->items.empty()) return 0;
  q->items.push_back(*static_cast<void**>(value)); return pdTRUE;
}
int xQueueReceive(QueueHandle_t q, void* value, uint32_t) {
  if (!q || q->items.empty()) return 0;
  *static_cast<void**>(value) = q->items.front(); q->items.erase(q->items.begin()); return pdTRUE;
}
int xTaskCreate(void (*)(void*), const char*, int, void*, int, void*) { return taskCreateOK ? pdPASS : 0; }
constexpr int HIGH = 1, LOW = 0, INPUT_PULLUP = 2, CHANGE = 3, WL_CONNECTED = 3;
int pins[49] = {};
uint32_t clockMs = 0;
uint32_t millis() { return clockMs; }
int digitalRead(int pin) { return pins[pin]; }
void pinMode(int, int) {}
void attachInterrupt(int, void (*)(), int) {}
int digitalPinToInterrupt(int pin) { return pin; }
using portMUX_TYPE = int;
#define portMUX_INITIALIZER_UNLOCKED 0
void portENTER_CRITICAL(int*) {}
void portEXIT_CRITICAL(int*) {}
void portENTER_CRITICAL_ISR(int*) {}
void portEXIT_CRITICAL_ISR(int*) {}
struct { int connection = WL_CONNECTED; int status() { return connection; } } WiFi;
struct {
  std::vector<std::string> lines;
  template<class T> void print(const T&) {}
  template<class T> void println(const T& value) { lines.emplace_back(value); }
  template<class... T> void printf(const char* format, T... args) {
    char text[512]; std::snprintf(text, sizeof(text), format, args...); lines.emplace_back(text);
  }
} Serial;
struct Audio {
  enum Event { evt_eof, evt_info, evt_log };
  struct msg_t { Event e; const char* msg = nullptr; const char* s = nullptr; int32_t arg1 = 0, arg2 = 0; };
  bool running = false, connectOK = true;
  int stops = 0, connects = 0;
  uint32_t position = 0;
  std::vector<uint16_t> seeks;
  std::vector<msg_t> events;
  std::function<void()> loopStep, connectStep;
  bool connecttohost(const char*) {
    ++connects; if (connectStep) connectStep(); running = connectOK; return connectOK;
  }
  void stopSong() { ++stops; running = false; }
  void loop();
  bool isRunning() { return running; }
  uint32_t getAudioFilePosition() { return position; }
  bool setAudioPlayTime(uint16_t seconds) { seeks.push_back(seconds); return true; }
};
String responseJson = R"({"result":"signal","manifest":{"programId":"new","title":"test","signalKind":"music","audioUrl":"https://example.test/song.wav?token=HIDDEN","startOffsetMs":8301}})";
int requestStatus = 200, requestCalls = 0;
String responseDate = "Tue, 06 Oct 2026 00:00:00 GMT";
bool beginOK = true;
std::vector<String> requestBodies, completedIds;
std::function<void()> postStep, readStep;
struct WiFiClient {};
struct HTTPClient {
  std::istringstream stream;
  HTTPClient(): stream(responseJson) {}
  void useHTTP10(bool) {}
  bool begin(WiFiClient&, const String&) { return beginOK; }
  void setConnectTimeout(int) {}
  void setTimeout(int) {}
  void addHeader(const char*, const String&) {}
  void collectHeaders(const char**, size_t) {}
  String header(const char*) { return responseDate; }
  int POST(const String& body) {
    ++requestCalls; requestBodies.push_back(body); if (postStep) postStep(); return requestStatus;
  }
  std::istringstream* getStreamPtr() { if (readStep) readStep(); return &stream; }
  void end() {}
};
constexpr const char* DEVICE_API_TOKEN = "test-only-token";
String deviceApiUrl(const char* path) { return String("http://example.test") + path; }
String summarizeAudioUrl(const String&) { return "example.test/audio.wav"; }
void printWifiStatus(const char*) {}
void reportHttpFailure(const char*, int) {}
String diagnoseGateway() { return {}; }
void sendCompleted(const String& id) { assert(!id.empty()); completedIds.push_back(id); }
'''
cases = r'''
void Audio::loop() {
  auto pending = events; events.clear();
  for (const auto& message : pending) onAudioInfo(message);
  if (running && loopStep) loopStep();
}
void reset() {
  clearPrefetchedManifest();
  for (QueueHandle_t q : {prefetchJobs, prefetchResults}) {
    if (!q) continue;
    for (auto* item : q->items) delete static_cast<ManifestPrefetchJob*>(item);
    vQueueDelete(q);
  }
  prefetchJobs = prefetchResults = nullptr;
  prefetchGeneration = 0; prefetchBusy = prefetchAttempted = false;
  taskCreateOK = true; responseDate = "Tue, 06 Oct 2026 00:00:00 GMT";
  networkAudio = Audio{}; receiverState = ReceiverState::kIdle;
  currentProgramId.clear(); recentProgramCount = 0;
  recentProgramIds[0].clear(); recentProgramIds[1].clear();
  audioEof = audioStreamReady = audioStopPending = false;
  audioProducedSamples = audioError = false; prepareStartOffset(0);
  audioStartMillis = audioProgressMillis = lastAudioPosition = clockMs = 0;
  encoder = RadioEncoder{}; tuneInput = RadioTuneInput{}; acknowledgedTuneRevision = 0;
  pins[RADIO_ENCODER_CLK] = pins[RADIO_ENCODER_DT] = pins[RADIO_ENCODER_SW] = HIGH;
  setupControls(); Serial.lines.clear(); WiFi.connection = WL_CONNECTED;
  requestStatus = 200; beginOK = true; requestCalls = 0;
  requestBodies.clear(); completedIds.clear(); postStep = readStep = {};
  responseJson = R"({"result":"signal","manifest":{"programId":"new","title":"test","signalKind":"music","audioUrl":"https://example.test/song.wav?token=HIDDEN","startOffsetMs":8301}})";
}
void play(const char* id = "old", uint32_t offsetMs = 0) {
  JsonDocument manifest; manifest["programId"] = id; manifest["audioUrl"] = "https://example.test/file.wav";
  manifest["startOffsetMs"] = offsetMs;
  startManifestPlayback(manifest.as<JsonObjectConst>(), acknowledgedTuneRevision);
  assert(receiverState == ReceiverState::kPlaying);
}
std::vector<String> exclusions(const String& body) {
  JsonDocument parsed; assert(!deserializeJson(parsed, body));
  std::vector<String> ids;
  for (JsonVariantConst id : parsed["excludeProgramIds"].as<JsonArrayConst>()) ids.push_back(id.as<String>());
  return ids;
}
int countLog(const char* value) {
  int count = 0; for (const auto& line : Serial.lines) if (line == value) ++count; return count;
}
void finishPrefetch() {
  ManifestPrefetchJob* job = nullptr;
  assert(xQueueReceive(prefetchJobs, &job, 0) == pdTRUE);
  fetchPrefetchJob(*job);
  assert(xQueueSend(prefetchResults, &job, 0) == pdTRUE);
  pollManifestPrefetch();
}
void startPrefetch() {
  setupManifestPrefetch();
  audioStreamReady = true; audio_process_raw_samples(nullptr, 128);
  updateManifestPrefetch();
  assert(prefetchBusy && prefetchJobs->items.size() == 1);
  responseJson = R"({"result":"signal","manifest":{"programId":"cached","title":"prepared","audioUrl":"https://example.test/next.wav?token=HIDDEN","startOffsetMs":8301,"audioExpiresAt":"2026-10-06T00:15:00.500Z"}})";
}
int main() {
  // One valid phase edge is enough, in either direction; no full detent needed.
  RadioEncoder phase; phase.begin(3);
  assert(phase.sample(1, 10)); assert(phase.sample(0, 15));
  assert(phase.sample(2, 20)); assert(phase.sample(3, 25));
  assert(phase.sample(2, 30)); assert(phase.sample(0, 35));
  assert(phase.sample(1, 40)); assert(phase.sample(3, 45));
  phase.begin(3); assert(!phase.sample(3, 0)); assert(!phase.sample(0, 5)); // impossible two-bit jump
  assert(phase.sample(1, 10)); assert(!phase.sample(0, 11)); // short bounce
  assert(phase.sample(2, 12)); assert(!phase.sample(2, 20));
  phase.begin(3); assert(phase.sample(1, UINT32_MAX)); assert(phase.sample(0, 1));
  RadioTuneInput wrapped; wrapped.request(UINT32_MAX - 100);
  assert(!wrapped.ready(0, 198)); assert(wrapped.ready(0, 199));

  // Interrupt old playback, drain queued EOF and clear pending seek/error.
  reset(); play("old", 8301);
  audioStreamReady = audioEof = audioStopPending = true;
  audioProducedSamples = audioError = true;
  networkAudio.events.push_back({Audio::evt_eof});
  tuneInput.request(0); updateControls();
  assert(receiverState == ReceiverState::kTuning && !networkAudio.running);
  assert(currentProgramId.empty() && networkAudio.events.empty());
  assert(!audioEof && !audioStreamReady && !audioStopPending && !audioProducedSamples && !audioError && !audioSeekPending);
  assert(completedIds.empty() && requestCalls == 0 && networkAudio.stops == 1);
  assert(countLog("encoder activity") == 1 && countLog("manual retune: stop current program") == 1);
  // A continuous burst makes exactly one request 300 ms after its last edge.
  for (uint32_t t = 10; t <= 100; t += 10) {
    clockMs = t; tuneInput.request(t); updateControls(); assert(requestCalls == 0);
  }
  clockMs = 399; updateControls(); assert(requestCalls == 0);
  clockMs = 400; updateControls(); assert(requestCalls == 1);
  assert(countLog("tuning settled") == 1 && countLog("encoder activity") == 1);
  assert(exclusions(requestBodies[0]) == std::vector<String>{"old"});
  assert(receiverState == ReceiverState::kPlaying && currentProgramId == "new");
  assert(recentProgramCount == 2 && recentProgramIds[0] == "new" && recentProgramIds[1] == "old");
  assert(audioSeekPending && audioSeekSeconds == 8);
  onAudioInfo({Audio::evt_info, "stream ready"}); updatePlayback();
  assert(networkAudio.seeks == std::vector<uint16_t>{8} && !audioSeekPending);
  clockMs = 500; updateControls(); updatePlayback(); assert(requestCalls == 1 && networkAudio.seeks.size() == 1);
  audio_process_raw_samples(nullptr, 128);
  networkAudio.loopStep = [] { networkAudio.running = false; networkAudio.events.push_back({Audio::evt_eof}); };
  updatePlayback(); updatePlayback();
  assert(completedIds == std::vector<String>{"new"});
  assert(receiverState == ReceiverState::kIdle && requestCalls == 1);

  // The button has no function. ISR phase capture still initiates rotation.
  reset(); play(); pins[RADIO_ENCODER_SW] = LOW; clockMs = 1000; updateControls();
  assert(tuneInput.revision == 0 && networkAudio.running && requestCalls == 0);
  pins[RADIO_ENCODER_DT] = LOW; onEncoderChange(); updateControls();
  assert(receiverState == ReceiverState::kTuning && requestCalls == 0);
  clockMs = 1299; updateControls(); assert(requestCalls == 0);
  clockMs = 1300; updateControls(); assert(requestCalls == 1);

  // Most recent two distinct accepted signals, with real JSON serialization.
  reset(); rememberProgram("A"); rememberProgram("A"); assert(recentProgramCount == 1);
  rememberProgram("B"); rememberProgram("C");
  assert(exclusions(tuneRequestBody()) == (std::vector<String>{"C", "B"}));
  responseJson = R"({"result":"no_signal"})"; tuneOnce(0);
  assert(receiverState == ReceiverState::kIdle && requestCalls == 1);
  assert(exclusions(requestBodies.back()) == (std::vector<String>{"C", "B"}));
  clockMs = 1000; updateControls(); assert(requestCalls == 1); // no hidden retry
  tuneInput.request(clockMs); updateControls(); clockMs = 1300; updateControls();
  assert(requestCalls == 2 && recentProgramCount == 2);
  assert(exclusions(requestBodies.back()) == (std::vector<String>{"C", "B"}));
  assert(completedIds.empty());

  // Input during POST, JSON read or audio connect supersedes the old result.
  for (int stage = 0; stage < 3; ++stage) {
    reset(); play();
    auto rotate = [] { ++clockMs; tuneInput.request(clockMs); };
    if (stage == 0) postStep = rotate;
    if (stage == 1) readStep = rotate;
    if (stage == 2) networkAudio.connectStep = rotate;
    tuneInput.request(100); clockMs = 400; updateControls();
    assert(requestCalls == 1 && !networkAudio.running && currentProgramId.empty());
    assert(recentProgramCount == 1 && recentProgramIds[0] == "old" && completedIds.empty());
    postStep = readStep = networkAudio.connectStep = {};
    updateControls(); assert(requestCalls == 1);
    clockMs = 701; updateControls(); assert(requestCalls == 2);
    assert(receiverState == ReceiverState::kPlaying && currentProgramId == "new");
  }
  // Rotation captured during Audio.loop wins over old EOF in the same call.
  reset(); play(); audioStreamReady = true; audio_process_raw_samples(nullptr, 128);
  networkAudio.loopStep = [] {
    tuneInput.request(millis()); networkAudio.running = false;
    networkAudio.events.push_back({Audio::evt_eof});
  };
  updatePlayback();
  assert(receiverState == ReceiverState::kTuning && completedIds.empty() && requestCalls == 0);
  assert(!audioEof && networkAudio.events.empty());
  // Failures remain idle, retain history, and never retry/complete themselves.
  reset(); play(); requestStatus = 500;
  tuneInput.request(0); clockMs = 300; updateControls();
  assert(receiverState == ReceiverState::kIdle && requestCalls == 1 && recentProgramCount == 1);
  clockMs = 1000; updateControls(); assert(requestCalls == 1 && completedIds.empty());
  reset(); play(); WiFi.connection = 0;
  tuneInput.request(0); clockMs = 300; updateControls();
  assert(receiverState == ReceiverState::kIdle && requestCalls == 0 && completedIds.empty());
  reset(); play(); audioStreamReady = true; audioError = true;
  networkAudio.events.push_back({Audio::evt_eof}); updatePlayback();
  assert(receiverState == ReceiverState::kIdle && completedIds.empty());

  // Conservative server Date / URL expiry lifetime, without an ESP32 UTC clock.
  assert(radioManifestLifetime("2026-10-06T00:15:00.500Z", "Tue, 06 Oct 2026 00:00:00 GMT") == 300000);
  assert(radioManifestLifetime("2026-10-06T00:00:40Z", "Tue, 06 Oct 2026 00:00:00 GMT") == 10000);
  assert(radioManifestLifetime("2026-10-06T00:00:30Z", "Tue, 06 Oct 2026 00:00:00 GMT") == 0);
  assert(radioManifestLifetime("2026-10-05T23:59:00Z", "Tue, 06 Oct 2026 00:00:00 GMT") == 0);
  assert(radioManifestLifetime("2026-02-29T00:15:00Z", "Sun, 01 Feb 2026 00:00:00 GMT") == 0);
  assert(radioManifestLifetime("2028-02-29T00:15:00Z", "Tue, 29 Feb 2028 00:00:00 GMT") == 300000);
  assert(radioManifestLifetime("2026-10-06T00:15:00+08:00", "Tue, 06 Oct 2026 00:00:00 GMT") == 0);
  assert(radioManifestLifetime("2026-10-06T00:15:00Z", "") == 0);

  // Queueing is nonblocking: only the simulated worker makes HTTP requests.
  reset(); play(); setupManifestPrefetch(); updateManifestPrefetch();
  assert(!prefetchBusy && requestCalls == 0); // no decoded audio yet
  audioStreamReady = true; audio_process_raw_samples(nullptr, 128);
  updateManifestPrefetch(); updateManifestPrefetch();
  assert(prefetchBusy && requestCalls == 0 && prefetchJobs->items.size() == 1);
  responseJson = R"({"result":"signal","manifest":{"programId":"cached","audioUrl":"https://example.test/next.wav?token=HIDDEN","startOffsetMs":8301,"audioExpiresAt":"2026-10-06T00:15:00.500Z"}})";
  clockMs = 100; finishPrefetch();
  assert(prefetchedManifest && recentProgramCount == 1 && recentProgramIds[0] == "old");
  assert(exclusions(requestBodies[0]) == std::vector<String>{"old"});
  assert(receiverState == ReceiverState::kPlaying && currentProgramId == "old" && networkAudio.running);
  updateManifestPrefetch(); assert(requestCalls == 1); // no recurring refill
  tuneInput.request(100); updateControls(); assert(!networkAudio.running && completedIds.empty());
  clockMs = 399; updateControls(); assert(requestCalls == 1);
  clockMs = 400; updateControls();
  assert(requestCalls == 1 && !prefetchedManifest && currentProgramId == "cached");
  assert(recentProgramCount == 2 && recentProgramIds[0] == "cached" && recentProgramIds[1] == "old");
  assert(audioSeekPending && audioSeekSeconds == 8);
  onAudioInfo({Audio::evt_info, "stream ready"}); updatePlayback();
  assert(networkAudio.seeks == std::vector<uint16_t>{8});
  assert(completedIds.empty());
  audio_process_raw_samples(nullptr, 128);
  networkAudio.events.push_back({Audio::evt_eof}); updatePlayback();
  assert(completedIds == std::vector<String>{"cached"} && receiverState == ReceiverState::kIdle);

  // A result arriving during the 300 ms settling window can still be used.
  reset(); play(); startPrefetch(); tuneInput.request(0); updateControls();
  assert(receiverState == ReceiverState::kTuning && completedIds.empty());
  clockMs = 100; finishPrefetch(); assert(prefetchedManifest);
  clockMs = 300; updateControls(); assert(currentProgramId == "cached" && requestCalls == 1);

  // A new turn during a cache hit's audio connect discards that selection.
  reset(); play(); startPrefetch(); finishPrefetch();
  networkAudio.connectStep = [] { ++clockMs; tuneInput.request(clockMs); };
  tuneInput.request(0); clockMs = 300; updateControls();
  assert(receiverState == ReceiverState::kTuning && currentProgramId.empty() && !networkAudio.running);
  assert(recentProgramCount == 1 && completedIds.empty() && requestCalls == 1);
  networkAudio.connectStep = {}; clockMs = 601; updateControls();
  assert(requestCalls == 2 && currentProgramId == "cached");

  // Expired cache, no_signal, bad JSON/header and HTTP failure use one manual tune.
  for (int scenario = 0; scenario < 5; ++scenario) {
    reset(); play(); startPrefetch();
    if (scenario == 1) responseJson = R"({"result":"no_signal"})";
    if (scenario == 2) responseJson = "{";
    if (scenario == 3) responseDate = "";
    if (scenario == 4) requestStatus = 500;
    finishPrefetch();
    clockMs = 300000; updateManifestPrefetch(); assert(requestCalls == 1);
    responseJson = R"({"result":"signal","manifest":{"programId":"fresh","audioUrl":"https://example.test/fresh.wav","startOffsetMs":5042}})";
    requestStatus = 200;
    tuneInput.request(clockMs); updateControls(); clockMs += 300; updateControls();
    assert(requestCalls == 2 && currentProgramId == "fresh" && audioSeekSeconds == 5);
    assert(!prefetchedManifest && completedIds.empty());
  }
  // Rapid tune while a background request is pending invalidates its result.
  reset(); play(); startPrefetch();
  tuneInput.request(0); updateControls(); clockMs = 300; updateControls();
  assert(requestCalls == 1 && currentProgramId == "cached");
  finishPrefetch(); assert(!prefetchedManifest && requestCalls == 2 && !prefetchBusy);
  updateManifestPrefetch(); assert(prefetchJobs->items.empty()); // fresh playback not ready yet

  // Failed audio connect is not a reason to tune again or mark completion.
  reset(); play(); startPrefetch(); finishPrefetch(); networkAudio.connectOK = false;
  tuneInput.request(0); updateControls(); clockMs = 300; updateControls();
  assert(requestCalls == 1 && receiverState == ReceiverState::kIdle && completedIds.empty());
  assert(recentProgramCount == 1);
  // Natural EOF keeps the prepared next manifest but never auto plays it.
  reset(); play(); startPrefetch(); finishPrefetch();
  networkAudio.events.push_back({Audio::evt_eof}); updatePlayback();
  assert(completedIds == std::vector<String>{"old"} && receiverState == ReceiverState::kIdle);
  updateManifestPrefetch(); assert(requestCalls == 1 && networkAudio.connects == 1 && prefetchedManifest);
  tuneInput.request(0); clockMs = 300; updateControls();
  assert(currentProgramId == "cached" && requestCalls == 1);
  // Cache lifetime works across millis wrap and cannot replay a recent ID.
  reset(); play(); clockMs = UINT32_MAX - 100; startPrefetch(); finishPrefetch();
  clockMs = 50; assert(playPrefetchedManifest(0) && currentProgramId == "cached");
  reset(); play(); startPrefetch(); finishPrefetch(); rememberProgram("cached");
  assert(!playPrefetchedManifest(0) && !prefetchedManifest && requestCalls == 1);
  // Resource failure disables prefetch but preserves the existing manual flow.
  reset(); taskCreateOK = false; setupManifestPrefetch(); play();
  audioStreamReady = true; audio_process_raw_samples(nullptr, 128); updateManifestPrefetch();
  assert(!prefetchJobs && !prefetchResults && requestCalls == 0);
  tuneInput.request(0); clockMs = 300; updateControls(); assert(requestCalls == 1);
  reset();
}
'''
with tempfile.TemporaryDirectory(prefix='radio-controls-test-') as directory:
    cpp, binary = Path(directory) / 'controls.cpp', Path(directory) / 'controls-test'
    cpp.write_text(preamble + globals_ + controls + flow + playback + hook + cases)
    subprocess.run([os.environ.get('CXX', 'clang++'), '-std=c++17', '-Wall', '-Wextra', '-I', str(root), '-I', str(json_headers), str(cpp), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print('Controls/tune/prefetch/playback checks passed (real ArduinoJson, host I/O fakes).')
