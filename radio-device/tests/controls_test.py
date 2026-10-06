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
flow = sketch[sketch.index('void startManifestPlayback(JsonObjectConst manifest, uint32_t requestedRevision,\n  const RadioCaptionTrack* captions) {'):sketch.index('void onAudioInfo')]
playback = sketch[sketch.index('void onAudioInfo'):sketch.index('}  // namespace')]
hook = sketch[sketch.index('void audio_process_raw_samples'):sketch.index('void setup()')]
display_update = sketch[sketch.index('void updateDisplay() {'):sketch.index('// The library can drain queued PCM')]
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
#include "RadioTuningWav.h"
#include "RadioDisplayModel.h"
#include "RadioCaptions.h"
#include "RadioStartTiming.h"
int captionGlyphWidth(uint32_t cp) { return cp < 128 ? 6 : 12; }
void renderDisplay(RadioDisplayModel& model) { model.dirty = false; }
int FFat = 0;
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
  bool fastOK = false; int fastConnects = 0;
  int stops = 0, connects = 0, localConnects = 0, volume = 15;
  bool localOK = true;
  std::vector<String> operations;
  uint32_t position = 0, currentTimeSec = 0;
  std::vector<uint16_t> seeks;
  std::vector<msg_t> events;
  std::function<void()> loopStep, connectStep, stopStep;
  bool connecttohost(const char*) {
    operations.push_back("network"); ++connects; if (connectStep) connectStep(); running = connectOK; return connectOK;
  }
  bool connecttohostAtTime(const char*, uint16_t) {
    operations.push_back("fast"); ++fastConnects;
    running = fastOK;
    if (!fastOK) { events.push_back({evt_info, "radio.fast.failed", nullptr, 5}); events.push_back({evt_log, "redacted", "LOGE"}); }
    return fastOK;
  }
  void stopSong() { operations.push_back("stop"); ++stops; running = false; if (stopStep) stopStep(); }
  void setVolume(uint8_t value) { volume = value; }
  bool connecttoFS(int, const char* path) {
    assert(String(path) == kTuningWavPath); operations.push_back("static");
    ++localConnects; running = localOK; return localOK;
  }
  void loop();
  bool isRunning() { return running; }
  uint32_t getAudioFilePosition() { return position; }
  uint32_t getAudioCurrentTime() { return currentTimeSec; }
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
  operations.push_back("drain");
  auto pending = events; events.clear();
  for (const auto& message : pending) onAudioInfo(message);
  if (running && loopStep) loopStep();
}
void reset() {
  displayModel = RadioDisplayModel{};
  captionTrack.clear(); captionCursor.reset();
  clearPrefetchedManifest();
  for (QueueHandle_t q : {prefetchJobs, prefetchResults}) {
    if (!q) continue;
    for (auto* item : q->items) delete static_cast<ManifestPrefetchJob*>(item);
    vQueueDelete(q);
  }
  prefetchJobs = prefetchResults = nullptr;
  foregroundTunePending = false; foregroundTuneRevision = 0;
  handledActivityRevision = 0; pendingPlaybackReady = feedbackLogged = false; pendingPlaybackManifest.clear();
  pendingPlaybackRevision = 0; feedbackChangedAt = 0; feedbackActivitySeen = false;
  audioOwner.store(AudioOwner::kNone); tuningWavReady = false;
  staticEof = staticStopPending = staticReadyLogged = false;
  staticError = staticProducedSamples = staticStreamReady = false;
  prefetchGeneration = 0; prefetchBusy = prefetchAttempted = false;
  taskCreateOK = true; responseDate = "Tue, 06 Oct 2026 00:00:00 GMT";
  startTiming.active.store(false); startTimingPrefetch = false; dialLockRecorded = false;
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
void select(uint32_t now) {
  // Physical travel, rather than forcing the selection revision in tests.
  const uint32_t before = tuneInput.revision;
  while (tuneInput.revision == before) tuneInput.request(now);
}
void settle(uint32_t now) { clockMs = now; updateControls(); }
int main() {
  RadioEncoder phase; phase.begin(3);
  int forward = 0, backward = 0;
  for (auto state : {1, 0, 2, 3}) { assert(phase.sample(state, clockMs += 3)); forward += phase.direction(); }
  for (auto state : {2, 0, 1, 3}) { assert(phase.sample(state, clockMs += 3)); backward += phase.direction(); }
  assert(forward == -backward && (forward == 4 || forward == -4));
  phase.begin(3); assert(!phase.sample(0, 30)); assert(phase.sample(1, 50)); assert(!phase.sample(3, 51));
  RadioTuneInput dial;
  for (int i = 0; i < 3; ++i) dial.request(i * 3);
  assert(dial.revision == 0); dial.request(9); assert(dial.ready(0, 9));
  for (int i = 0; i < 200; ++i) dial.request(20 + i * 3);
  assert(dial.revision == 1); // one selection while waiting for acceptance
  dial.hold(1000);
  for (int i = 0; i < 15; ++i) dial.request(1100);
  assert(dial.revision == 1); dial.request(1100); assert(dial.revision == 2);
  dial.hold(2000);
  for (int i = 0; i < 8; ++i) { dial.request(2100, 1); dial.request(2103, -1); }
  assert(dial.revision == 2 && dial.travel == 0);
  for (int i = 0; i < 4; ++i) dial.request(6000, -1);
  assert(dial.revision == 3);
  RadioTuneInput wrapped; wrapped.hold(UINT32_MAX - 100);
  for (int i = 0; i < 4; ++i) wrapped.request(198);
  assert(wrapped.revision == 0 && wrapped.moving(497) && !wrapped.moving(498));
  wrapped.settle(); for (int i = 0; i < 4; ++i) wrapped.request(4000);
  assert(wrapped.revision == 1);

  // Actual ISR triggers PCM feedback before the main loop can run. Neither
  // small motion nor release may stop/reconnect or discard a prepared manifest.
  reset(); play(); startPrefetch(); finishPrefetch(); tuningWavReady = true;
  pins[RADIO_ENCODER_SW] = LOW; updateControls(); assert(!feedbackActivitySeen);
  clockMs = 100; pins[RADIO_ENCODER_DT] = LOW; onEncoderChange();
  assert(feedbackActivitySeen && tuneInput.revision == 0);
  int32_t pcm[1024]; for (auto& sample : pcm) sample = 123456789;
  audioProducedSamples = false; audio_process_raw_samples(pcm, 1024);
  assert(!audioProducedSamples && !staticProducedSamples);
  bool nonzero = false;
  for (int i = 0; i < 1024; i += 2) {
    assert(pcm[i] == pcm[i + 1] && pcm[i] >= -4096 * 65536 && pcm[i] <= 4096 * 65536);
    nonzero |= pcm[i] != 0;
  }
  assert(nonzero && networkAudio.connects == 1 && networkAudio.stops == 1);
  updateControls(); assert(currentProgramId == "old" && audioOwner == AudioOwner::kNetwork);
  clockMs = 250; for (auto& sample : pcm) sample = 123456789;
  audio_process_raw_samples(pcm, 1024);
  for (auto sample : pcm) assert(sample == 123456789);
  assert(audioProducedSamples); settle(400);
  assert(networkAudio.connects == 1 && networkAudio.localConnects == 0 && requestCalls == 1 && prefetchedManifest);
  assert(receiverState == ReceiverState::kPlaying && completedIds.empty());

  // Crossing the angle starts static and prepares cache now, but never runs
  // blocking connect in the rotation burst, including 8 seconds of motion.
  reset(); play(); startPrefetch(); finishPrefetch(); tuningWavReady = true;
  networkAudio.events.push_back({Audio::evt_eof});
  select(0); updateControls();
  assert(pendingPlaybackReady && currentProgramId.empty() && networkAudio.connects == 1);
  assert(audioOwner == AudioOwner::kStaticLocalFile && networkAudio.localConnects == 1);
  assert(!audioEof && !audioError && !audioProducedSamples && !audioSeekPending && completedIds.empty());
  onAudioInfo({Audio::evt_info, "stream ready"}); audio_process_raw_samples(nullptr, 128);
  for (clockMs = 100; clockMs <= 8000; clockMs += 100) {
    tuneInput.request(clockMs); updateControls(); updateLocalStatic();
    if (clockMs == 6000) {
      networkAudio.events.push_back({Audio::evt_eof}); updateLocalStatic();
      assert(networkAudio.localConnects == 2);
      onAudioInfo({Audio::evt_info, "stream ready"}); audio_process_raw_samples(nullptr, 128);
    }
  }
  assert(tuneInput.revision == 1 && networkAudio.connects == 1 && requestCalls == 1);
  assert(!audioProducedSamples && completedIds.empty());
  settle(8149); assert(audioOwner == AudioOwner::kStaticLocalFile);
  settle(8150); assert(audioOwner == AudioOwner::kNone && networkAudio.volume == 0 && networkAudio.connects == 1);
  settle(8299); assert(networkAudio.connects == 1);
  settle(8300); assert(currentProgramId == "cached" && networkAudio.connects == 2 && !pendingPlaybackReady);
  assert(audioSeekSeconds == 8 && audioSeekPending && recentProgramCount == 2);
  onAudioInfo({Audio::evt_info, "stream ready"}); updatePlayback();
  assert(networkAudio.seeks == std::vector<uint16_t>{8});
  audio_process_raw_samples(nullptr, 128); networkAudio.events.push_back({Audio::evt_eof}); updatePlayback();
  assert(completedIds == std::vector<String>{"cached"} && receiverState == ReceiverState::kIdle);

  // HTTP is queued at threshold. Ready results wait for release, and motion
  // during the job cannot trigger repeated HTTP requests/reconnects.
  reset(); play(); setupManifestPrefetch(); tuningWavReady = true;
  select(0); updateControls(); assert(prefetchBusy && requestCalls == 0);
  postStep = [] { clockMs = 100; for (int i = 0; i < 100; ++i) tuneInput.request(clockMs); };
  finishPrefetch(); assert(pendingPlaybackReady && currentProgramId.empty() && networkAudio.connects == 1);
  postStep = {}; updateControls(); assert(requestCalls == 1 && !foregroundTunePending);
  settle(250); assert(audioOwner == AudioOwner::kNone);
  settle(400); assert(currentProgramId == "new" && networkAudio.connects == 2 && requestCalls == 1);
  // Tiny input in the protected window preserves the live connection.
  clockMs = 500; for (int i = 0; i < 4; ++i) tuneInput.request(clockMs);
  updateControls(); settle(800); assert(requestCalls == 1 && networkAudio.connects == 2 && currentProgramId == "new");
  // Large travel overrides the protection and still makes one selection.
  clockMs = 900; select(clockMs); updateControls(); finishPrefetch();
  assert(requestCalls == 2 && pendingPlaybackReady && networkAudio.connects == 2);
  settle(1200); assert(networkAudio.connects == 3 && completedIds.empty());

  // Small turns during connect do not supersede or immediately reconnect it.
  reset(); play(); startPrefetch(); finishPrefetch(); tuningWavReady = true;
  select(0); updateControls();
  networkAudio.connectStep = [] { clockMs = 350; for (int i = 0; i < 30; ++i) tuneInput.request(clockMs); };
  settle(300); networkAudio.connectStep = {}; updateControls(); settle(650);
  assert(currentProgramId == "cached" && requestCalls == 1 && networkAudio.connects == 2);
  assert(completedIds.empty());

  // Actual selection captured during Audio.loop wins over EOF in that loop.
  reset(); play(); tuningWavReady = true; audioStreamReady = true; audio_process_raw_samples(nullptr, 128);
  networkAudio.loopStep = [] { select(millis()); networkAudio.events.push_back({Audio::evt_eof}); };
  updatePlayback(); networkAudio.loopStep = {};
  assert(receiverState == ReceiverState::kTuning && completedIds.empty() && !audioEof);

  // Background result invalidated by foreground selection cannot auto play.
  reset(); play(); startPrefetch(); select(0); updateControls();
  assert(foregroundTunePending); finishPrefetch(); assert(!prefetchedManifest && currentProgramId.empty());
  updateForegroundTune(); finishPrefetch(); assert(pendingPlaybackReady && requestCalls == 2);
  settle(300); assert(currentProgramId == "cached" && networkAudio.connects == 2);

  // Expired/invalid caches fall back once, retaining native seek.
  for (int scenario = 0; scenario < 5; ++scenario) {
    reset(); play(); startPrefetch();
    if (scenario == 1) responseJson = R"({"result":"no_signal"})";
    if (scenario == 2) responseJson = "{";
    if (scenario == 3) responseDate = "";
    if (scenario == 4) requestStatus = 500;
    finishPrefetch(); clockMs = 300000;
    responseJson = R"({"result":"signal","manifest":{"programId":"fresh","audioUrl":"https://example.test/a.wav","startOffsetMs":5042}})";
    requestStatus = 200; select(clockMs); updateControls(); finishPrefetch();
    assert(pendingPlaybackReady && currentProgramId.empty()); settle(300300);
    assert(currentProgramId == "fresh" && requestCalls == 2 && audioSeekSeconds == 5);
  }
  // no_signal/error returns idle, releases the latch; there is no automatic retry.
  for (int scenario = 0; scenario < 4; ++scenario) {
    reset(); play(); setupManifestPrefetch(); tuningWavReady = true;
    select(0); updateControls();
    if (scenario == 0) responseJson = R"({"result":"no_signal"})";
    if (scenario == 1) requestStatus = -1;
    if (scenario == 2) responseJson = "{";
    if (scenario == 3) responseJson = R"({"result":"signal","manifest":{}})";
    finishPrefetch(); assert(receiverState == ReceiverState::kIdle && audioOwner == AudioOwner::kNone);
    updateDisplay();
    assert(displayModel.status == (scenario == 0 ? RadioDisplayStatus::NoSignal : RadioDisplayStatus::SignalLost)
      || displayModel.status == RadioDisplayStatus::Tuning); // feedback may still be active
    assert(!pendingPlaybackReady && !tuneInput.selectionLatched && networkAudio.volume == 0);
    settle(10000); updateForegroundTune(); updateManifestPrefetch();
    updateDisplay();
    assert(displayModel.status == (scenario == 0 ? RadioDisplayStatus::NoSignal : RadioDisplayStatus::SignalLost));
    assert(requestCalls == 1 && recentProgramCount == 1 && completedIds.empty());
  }
  reset(); rememberProgram("A"); rememberProgram("A"); rememberProgram("B"); rememberProgram("C");
  assert((exclusions(tuneRequestBody()) == std::vector<String>{"C", "B"}));
  responseJson = R"({"result":"no_signal"})"; tuneOnce(0);
  assert(recentProgramCount == 2 && (exclusions(requestBodies.back()) == std::vector<String>{"C", "B"}));

  // Silent degradation if local file fails, selection can still proceed.
  for (int scenario = 0; scenario < 3; ++scenario) {
    reset(); play(); tuningWavReady = true; networkAudio.localOK = scenario != 0;
    select(0); updateControls();
    if (scenario == 1) onAudioInfo({Audio::evt_log, "hidden", "LOGE"});
    if (scenario == 2) onAudioInfo({Audio::evt_eof});
    updateLocalStatic(); assert(!tuningWavReady && completedIds.empty());
    settle(300); assert(currentProgramId == "new" && requestCalls == 1);
  }
  // Startup/worker-failure fallback and wraparound/recent-ID cache protection.
  reset(); taskCreateOK = false; setupManifestPrefetch(); play(); select(0); updateControls();
  assert(requestCalls == 1 && pendingPlaybackReady); settle(300); assert(currentProgramId == "new");
  reset(); play(); clockMs = UINT32_MAX - 100; startPrefetch(); finishPrefetch();
  clockMs = 50; assert(playPrefetchedManifest(0) && currentProgramId == "cached");
  reset(); play(); startPrefetch(); finishPrefetch(); rememberProgram("cached");
  assert(!playPrefetchedManifest(0) && !prefetchedManifest);
  // NONE and pre-ready PCM are silent, not network-success evidence.
  reset(); int32_t tail[] = {100, -100}; audio_process_raw_samples(tail, 2);
  assert(tail[0] == 0 && tail[1] == 0);
  audioOwner = AudioOwner::kStaticLocalFile; tail[0] = 100; audio_process_raw_samples(tail, 2);
  assert(tail[0] == 0 && !audioProducedSamples);
  // Actual sketch mapping: connect isn't locked, and local/noise PCM cannot
  // prove network success. Small feedback temporarily changes only the view.
  reset(); play("display", 8000); updateDisplay();
  assert(displayModel.status == RadioDisplayStatus::Locking);
  audio_process_raw_samples(nullptr, 2); updateDisplay();
  assert(displayModel.status == RadioDisplayStatus::Locking);
  onAudioInfo({Audio::evt_info, "stream ready"}); updateDisplay();
  assert(displayModel.status == RadioDisplayStatus::Locking);
  updatePlayback(); updateDisplay(); // native seek accepted, still no samples
  assert(displayModel.status == RadioDisplayStatus::Locking);
  audio_process_raw_samples(nullptr, 2); updateDisplay();
  assert(displayModel.status == RadioDisplayStatus::Locking); // queued isn't applied
  onAudioInfo({Audio::evt_info, "radio.seek.new-buffer.result", nullptr, 512044, 1});
  updateDisplay();
  assert(displayModel.status == RadioDisplayStatus::Locking); // wait for PCM after seek
  audio_process_raw_samples(nullptr, 2); updateDisplay();
  assert(displayModel.status == RadioDisplayStatus::Playing);
  tuneInput.request(clockMs += 3); updateControls(); updateDisplay();
  assert(displayModel.status == RadioDisplayStatus::Tuning && receiverState == ReceiverState::kPlaying);
  clockMs += 300; updateControls(); updateDisplay();
  assert(displayModel.status == RadioDisplayStatus::Playing);
  failPlayback(); updateDisplay();
  assert(displayModel.status == RadioDisplayStatus::SignalLost);
  WiFi.connection = 0; updateDisplay();
  assert(displayModel.status == RadioDisplayStatus::NoNetwork);

  // Real HTTP filter and native seek gating preserve and time captions.
  reset();
  responseJson = R"({"result":"signal","manifest":{"programId":"captions","title":"safe title","signalKind":"chat","audioUrl":"https://example.test/c.wav","startOffsetMs":8301,"captions":[{"startMs":1000,"endMs":3000,"speaker":"A","text":"已经播过"},{"startMs":5000,"endMs":10000,"speaker":"B","text":"中途字幕","ignored":"not retained"}]}})";
  tuneOnce(0); updateDisplay();
  assert(captionTrack.count == 2 && displayModel.captionIndex == -1);
  onAudioInfo({Audio::evt_info, "stream ready"}); updatePlayback();
  networkAudio.currentTimeSec = 8;
  audio_process_raw_samples(nullptr, 128); updateDisplay();
  assert(displayModel.captionIndex == -1); // queued seek must not advance captions
  onAudioInfo({Audio::evt_info, "radio.seek.new-buffer.result", nullptr, 512044, 1});
  audio_process_raw_samples(nullptr, 128); updateDisplay();
  assert(displayModel.captionIndex == 1 && String(displayModel.captionLines[0]) == "中途字幕");
  networkAudio.currentTimeSec = 10; clockMs += 200; updateDisplay();
  assert(displayModel.captionIndex == -1 && !displayModel.captionLines[0][0]);
  networkAudio.currentTimeSec = 8; clockMs += 200; updateDisplay();
  assert(displayModel.captionIndex == 1);
  const int beforeStops = networkAudio.stops;
  tuneInput.request(clockMs += 3); updateControls(); updateDisplay();
  assert(displayModel.status == RadioDisplayStatus::Tuning && displayModel.captionIndex == -1);
  clockMs += 300; updateControls(); updateDisplay();
  assert(displayModel.captionIndex == 1 && networkAudio.stops == beforeStops);
  failPlayback(); updateDisplay();
  assert(captionTrack.count == 0 && displayModel.captionIndex == -1 && completedIds.empty());
  for (const auto& line : Serial.lines)
    assert(line.find("中途字幕") == String::npos && line.find("已经播过") == String::npos);

  // Prefetch owns bounded captions after its temporary JSON is compacted;
  // staged manifest has no caption JSON, and survives deletion of the job.
  reset(); play(); startPrefetch();
  responseJson = R"({"result":"signal","manifest":{"programId":"caption-cache","title":"cached title","signalKind":"alien","audioUrl":"https://example.test/a.wav","startOffsetMs":8301,"audioExpiresAt":"2026-10-06T00:15:00.500Z","captions":[{"startMs":0,"endMs":20000,"speaker":"alien","text":"预取译文"}]}})";
  finishPrefetch();
  assert(prefetchedManifest && prefetchedManifest->captions.count == 1);
  assert(prefetchedManifest->response["manifest"]["captions"].isNull());
  select(0); updateControls();
  assert(pendingPlaybackReady && pendingPlaybackManifest["captions"].isNull());
  assert(!prefetchedManifest && captionTrack.count == 1 && String(captionTrack.text(0)) == "预取译文");
  settle(300);
  assert(currentProgramId == "caption-cache" && captionTrack.count == 1);
  onAudioInfo({Audio::evt_info, "stream ready"}); updatePlayback();
  onAudioInfo({Audio::evt_info, "radio.seek.new-buffer.result", nullptr, 512044, 1});
  networkAudio.currentTimeSec = 8; audio_process_raw_samples(nullptr, 128); updateDisplay();
  assert(String(displayModel.captionLines[0]) == "预取译文" && String(displayModel.captionLabel()) == "译文");
  networkAudio.events.push_back({Audio::evt_eof}); updatePlayback();
  assert(captionTrack.count == 0 && displayModel.captionIndex == -1 && completedIds.size() == 1);
  reset();
}
'''
fast_cases = cases[:cases.index('int main() {')] + r'''
int main() {
  reset(); networkAudio.fastOK = true;
  JsonDocument manifest;
  manifest["programId"] = "fast"; manifest["audioUrl"] = "https://example.test/file.wav?token=HIDDEN";
  manifest["startOffsetMs"] = 7613; manifest["signalKind"] = "chat";
  auto caption = manifest["captions"].to<JsonArray>().add<JsonObject>();
  caption["startMs"] = 7000; caption["endMs"] = 12000; caption["text"] = "绝对时间字幕";
  startManifestPlayback(manifest.as<JsonObjectConst>(),0);
  assert(receiverState == ReceiverState::kPlaying && networkAudio.fastConnects == 1 && networkAudio.connects == 0);
  assert(!audioSeekPending && !displaySeekWaiting && !startTiming.fallback);
  onAudioInfo({Audio::evt_info,"stream ready"});
  int32_t pcm[4] = {1,2,3,4}; audio_process_raw_samples(pcm,4);
  networkAudio.currentTimeSec = 7; updateDisplay();
  assert(String(displayModel.captionLines[0]) == "绝对时间字幕");
  updatePlayback(); assert(networkAudio.seeks.empty());
  networkAudio.events.push_back({Audio::evt_eof}); updatePlayback();
  assert(receiverState == ReceiverState::kIdle && completedIds.size() == 1);
  updatePlayback(); assert(completedIds.size() == 1);

  reset(); play("fallback",7613);
  assert(networkAudio.fastConnects == 1 && networkAudio.connects == 1);
  assert(startTiming.fallback && !audioError && audioSeekPending && displaySeekWaiting && completedIds.empty());
  assert(countLog("fallback to legacy seek") == 1);
  onAudioInfo({Audio::evt_info,"stream ready"}); updatePlayback();
  assert(networkAudio.seeks.size() == 1 && networkAudio.seeks[0] == 7);
  reset(); networkAudio.connectOK = false;
  manifest["programId"] = "failed";
  startManifestPlayback(manifest.as<JsonObjectConst>(),0);
  assert(receiverState == ReceiverState::kIdle && currentProgramId.empty() && completedIds.empty());
  assert(displayModel.status == RadioDisplayStatus::SignalLost && captionTrack.count == 0);

  reset(); manifest["audioUrl"] = "https://example.test/file.mp3";
  startManifestPlayback(manifest.as<JsonObjectConst>(),0);
  assert(networkAudio.fastConnects == 0 && networkAudio.connects == 1 && audioSeekPending);
  reset();
}
'''
with tempfile.TemporaryDirectory(prefix='radio-controls-test-') as directory:
    for flag, test_cases in [(0, cases), (1, fast_cases)]:
        cpp, binary = Path(directory) / 'controls.cpp', Path(directory) / 'controls-test'
        cpp.write_text(preamble + globals_ + controls + flow + playback + display_update + hook + test_cases)
        subprocess.run([os.environ.get('CXX', 'clang++'), '-std=c++17', f'-DRADIO_FAST_WAV_START={flag}', '-Wall', '-Wextra', '-I', str(root), '-I', str(json_headers), str(cpp), '-o', str(binary)], check=True)
        subprocess.run([str(binary)], check=True)
print('Controls/tune/prefetch/playback and opt-in fast/fallback checks passed (host I/O fakes).')
