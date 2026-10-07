#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <Audio.h>
#include <FFat.h>
#include <esp_partition.h>
#include <wear_levelling.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <lwip/etharp.h>
#include <lwip/tcpip.h>

#include <cstring>
#include <atomic>
#include <new>
#include <utility>

#include "secrets.h"
#include "controls.h"
#include "ReceiverControls.h"
#include "RadioManifestPrefetch.h"
#include "RadioTuningWav.h"
#include "RadioDisplay.h"
#include "RadioCaptions.h"
#include "RadioStartTiming.h"

#ifndef WIFI_GATEWAY_MAC
#define WIFI_GATEWAY_MAC ""
#endif

namespace {

RadioDisplay radioDisplay;
int captionGlyphWidth(uint32_t cp) { return radioDisplay.glyphWidth(cp); }
void renderDisplay(RadioDisplayModel& model) {
  const bool wasDirty = model.dirty;
  const uint32_t started = millis();
  radioDisplay.renderIfDirty(model);
  if (wasDirty && !model.dirty) {
    constexpr const char* labels[] = {
      "BOOTING", "CONNECTING", "TUNING", "LOCKING", "PLAYING", "NO NETWORK", "NO SIGNAL", "SIGNAL LOST"
    };
    Serial.printf("[display] %s refreshMs=%lu\n", labels[static_cast<uint8_t>(model.status)],
      static_cast<unsigned long>(millis() - started));
  }
}

constexpr uint8_t kI2SBclkPin = 4;
RadioStartTiming startTiming;
bool startTimingPrefetch = false;
uint32_t dialLockedAt = 0;
bool dialLockRecorded = false;
void failPlayback();
void recordStartPoint(RadioStartTiming::Point point, uint32_t now) {
  if (!startTiming.mark(point, now)) return;
  constexpr const char* labels[] = { "connect.begin", "tls.connected", "wav.header", "range.sent", "range.ready", "first.network.pcm" };
  Serial.printf("[start] %s: ms=%lu\n", labels[point], static_cast<unsigned long>(startTiming.elapsed(point)));
}
void reportFirstNetworkPcm() {
  const uint32_t first = startTiming.firstPcm.load();
  if (!startTiming.active.load() || startTiming.reported || first == UINT32_MAX) return;
  recordStartPoint(RadioStartTiming::FirstPcm, first);
  startTiming.reported = true;
  Serial.printf("[start] summary: mode=%s prefetch=%d fallback=%d tls=%u headerMs=%lu rangeMs=%lu totalMs=%lu\n",
    startTiming.fast ? "fast" : "legacy", startTiming.prefetch, startTiming.fallback, unsigned(startTiming.connections),
    static_cast<unsigned long>(startTiming.elapsed(RadioStartTiming::WavHeader)),
    static_cast<unsigned long>(startTiming.at[RadioStartTiming::RangeReady] - startTiming.at[RadioStartTiming::RangeSent]),
    static_cast<unsigned long>(startTiming.elapsed(RadioStartTiming::FirstPcm)));
}
constexpr uint8_t kI2SLrcPin = 5;
constexpr uint8_t kI2SDinPin = 6;
constexpr uint32_t kWifiConnectTimeoutMs = 15'000;
constexpr uint32_t kAudioStartTimeoutMs = 15'000;
constexpr uint32_t kAudioStallTimeoutMs = 30'000;
constexpr uint8_t kNetworkVolume = 15;
constexpr uint8_t kStaticVolume = 15;
constexpr uint32_t kFeedbackTailMs = 150;
std::atomic<uint32_t> feedbackChangedAt{0};
std::atomic<bool> feedbackActivitySeen{false};

enum class AudioOwner : uint8_t { kNone, kNetwork, kStaticLocalFile };
std::atomic<AudioOwner> audioOwner{AudioOwner::kNone};
bool tuningWavReady = false;
bool staticEof = false;
bool staticStopPending = false;
std::atomic<bool> staticError{false};
std::atomic<bool> staticProducedSamples{false};
std::atomic<bool> staticStreamReady{false};
bool staticReadyLogged = false;

enum class ReceiverState : uint8_t {
  kBoot,
  kWifiFailed,
  kIdle,
  kTuning,
  kPlaying,
};

Audio networkAudio;
ReceiverState receiverState = ReceiverState::kBoot;
String currentProgramId;
bool audioEof = false;
std::atomic<bool> audioStreamReady{false};
bool audioStopPending = false;
std::atomic<bool> audioProducedSamples{false};
std::atomic<bool> audioError{false};
std::atomic<bool> audioSeekPending{false};
uint32_t audioSeekSeconds = 0;
uint32_t audioStartMillis = 0;
uint32_t audioProgressMillis = 0;
uint32_t lastAudioPosition = 0;
bool autoAdvancePending = false;
bool automaticTune = false;
uint32_t autoAdvanceRevision = 0;
uint32_t autoAdvanceActivity = 0;
RadioDisplayModel displayModel;
std::atomic<bool> displaySeekWaiting{false};
std::atomic<bool> displayProducedSamples{false};
RadioCaptionTrack captionTrack;
RadioCaptionCursor captionCursor;

void prepareStartOffset(uint32_t offsetMs) {
  audioSeekSeconds = offsetMs / 1000;
  audioSeekPending.store(offsetMs > 0);
  displaySeekWaiting.store(offsetMs > 0);
  displayProducedSamples.store(false);
}

String deviceApiUrl(const char* path) {
  String url(DEVICE_API_BASE_URL);
  while (url.endsWith("/")) url.remove(url.length() - 1);
  return url + path;
}

// signed URL 的 query string 含有临时授权，调试时只能输出 host 与 path。
String summarizeAudioUrl(const String& url) {
  const int schemeEnd = url.indexOf("://");
  const int hostStart = schemeEnd >= 0 ? schemeEnd + 3 : 0;
  const int pathStart = url.indexOf('/', hostStart);
  const int queryStart = url.indexOf('?');
  const String host =
    pathStart >= 0 ? url.substring(hostStart, pathStart) : url.substring(hostStart);
  const String path = pathStart >= 0
    ? url.substring(pathStart, queryStart >= 0 ? queryStart : url.length())
    : "/";
  return host + path;
}

static_assert(RADIO_ENCODER_CLK != RADIO_ENCODER_DT &&
  RADIO_ENCODER_CLK != RADIO_ENCODER_SW && RADIO_ENCODER_DT != RADIO_ENCODER_SW,
  "EC11 pins must be distinct");
static_assert(RADIO_ENCODER_CLK != 4 && RADIO_ENCODER_CLK != 5 && RADIO_ENCODER_CLK != 6 &&
  RADIO_ENCODER_DT != 4 && RADIO_ENCODER_DT != 5 && RADIO_ENCODER_DT != 6 &&
  RADIO_ENCODER_SW != 4 && RADIO_ENCODER_SW != 5 && RADIO_ENCODER_SW != 6,
  "EC11 must not share audio I2S pins");

RadioEncoder encoder;
RadioTuneInput tuneInput;
portMUX_TYPE controlsMux = portMUX_INITIALIZER_UNLOCKED;
uint32_t acknowledgedTuneRevision = 0;
uint32_t handledActivityRevision = 0;
JsonDocument pendingPlaybackManifest;
bool pendingPlaybackReady = false;
uint32_t pendingPlaybackRevision = 0;
bool feedbackLogged = false;
String recentProgramIds[2];
uint8_t recentProgramCount = 0;

struct ManifestPrefetchJob {
  String body;
  uint32_t generation = 0;
  uint32_t startedAt = 0;
  uint32_t lifetimeMs = 0;
  int status = 0;
  bool parsed = false;
  bool foreground = false;
  uint32_t requestedRevision = 0;
  JsonDocument response;
  RadioCaptionTrack captions;
};

void fetchPrefetchJob(ManifestPrefetchJob& job);

QueueHandle_t prefetchJobs = nullptr;
QueueHandle_t prefetchResults = nullptr;
ManifestPrefetchJob* prefetchedManifest = nullptr;
uint32_t prefetchGeneration = 0;
bool prefetchBusy = false;
bool prefetchAttempted = false;
bool foregroundTunePending = false;
uint32_t foregroundTuneRevision = 0;

void startManifestPlayback(JsonObjectConst manifest, uint32_t requestedRevision,
  const RadioCaptionTrack* captions = nullptr);
void finishTuningIdle(RadioDisplayStatus status = RadioDisplayStatus::SignalLost);
bool tuneSuperseded(uint32_t requestedRevision);
void applyForegroundManifest(ManifestPrefetchJob& job);

void clearPrefetchedManifest() {
  delete prefetchedManifest;
  prefetchedManifest = nullptr;
}

void invalidatePrefetch() {
  ++prefetchGeneration;  // A pending worker owns its job until it posts a result.
  clearPrefetchedManifest();
}

bool isRecentProgram(const char* programId) {
  for (uint8_t i = 0; i < recentProgramCount; ++i)
    if (recentProgramIds[i] == programId) return true;
  return false;
}

void fillManifestFilter(JsonDocument& filter) {
  filter["result"] = true;
  filter["manifest"]["programId"] = true;
  filter["manifest"]["title"] = true;
  filter["manifest"]["signalKind"] = true;
  filter["manifest"]["audioUrl"] = true;
  filter["manifest"]["audioExpiresAt"] = true;
  filter["manifest"]["startOffsetMs"] = true;
  filter["manifest"]["captions"][0]["startMs"] = true;
  filter["manifest"]["captions"][0]["endMs"] = true;
  filter["manifest"]["captions"][0]["speaker"] = true;
  filter["manifest"]["captions"][0]["text"] = true;
}

// This worker only fetches JSON. Audio, encoder, history and Serial belong to loop().
void fetchPrefetchJob(ManifestPrefetchJob& job) {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClient client;
  HTTPClient request;
  request.useHTTP10(true);
  const char* headers[] = {"Date"};
  if (!request.begin(client, deviceApiUrl("/api/device/receiver/tune"))) return;
  request.collectHeaders(headers, 1);
  request.setConnectTimeout(8'000);
  request.setTimeout(10'000);
  request.addHeader("Authorization", String("Bearer ") + DEVICE_API_TOKEN);
  request.addHeader("Content-Type", "application/json");
  job.status = request.POST(job.body);
  if (job.status >= 200 && job.status < 300) {
    JsonDocument filter;
    fillManifestFilter(filter);
    job.parsed = !deserializeJson(job.response, *request.getStreamPtr(),
      DeserializationOption::Filter(filter), DeserializationOption::NestingLimit(4));
    if (job.parsed) job.lifetimeMs = radioManifestLifetime(
      job.response["manifest"]["audioExpiresAt"] | "", request.header("Date").c_str());
    if (job.parsed) {
      job.captions.load(job.response["manifest"]["captions"].as<JsonArrayConst>());
      job.response["manifest"].remove("captions");
      // Retain only bounded, owned caption data in the prefetch cache. Free
      // the temporary JSON strings and slots used by the incoming captions.
      JsonDocument compact;
      if (compact.set(job.response)) job.response = std::move(compact);
    }
  }
  request.end();
}

void manifestPrefetchWorker(void*) {
  for (;;) {
    ManifestPrefetchJob* job = nullptr;
    if (xQueueReceive(prefetchJobs, &job, portMAX_DELAY) != pdTRUE) continue;
    fetchPrefetchJob(*job);
    // Ownership transfers to loop(); at most one job is outstanding.
    xQueueSend(prefetchResults, &job, portMAX_DELAY);
  }
}

void setupManifestPrefetch() {
  prefetchJobs = xQueueCreate(1, sizeof(ManifestPrefetchJob*));
  prefetchResults = xQueueCreate(1, sizeof(ManifestPrefetchJob*));
  if (!prefetchJobs || !prefetchResults ||
      xTaskCreate(manifestPrefetchWorker, "manifest-prefetch", 8192, nullptr, 1, nullptr) != pdPASS) {
    if (prefetchJobs) vQueueDelete(prefetchJobs);
    if (prefetchResults) vQueueDelete(prefetchResults);
    prefetchJobs = prefetchResults = nullptr;
    Serial.println("manifest prefetch unavailable; using normal tune");
  }
}

void pollManifestPrefetch() {
  ManifestPrefetchJob* job = nullptr;
  if (!prefetchResults || xQueueReceive(prefetchResults, &job, 0) != pdTRUE) return;
  prefetchBusy = false;
  if (job->foreground) {
    if (job->generation == prefetchGeneration && !tuneSuperseded(job->requestedRevision) &&
        receiverState == ReceiverState::kTuning) applyForegroundManifest(*job);
    else Serial.println("tune superseded while requesting manifest");
    delete job;
    return;
  }
  const uint32_t age = millis() - job->startedAt;
  const char* result = job->response["result"] | "";
  JsonObjectConst manifest = job->response["manifest"].as<JsonObjectConst>();
  const char* id = manifest["programId"] | "";
  if (job->generation == prefetchGeneration && job->parsed &&
      strcmp(result, "signal") == 0 && strlen(id) && !isRecentProgram(id) &&
      strlen(manifest["audioUrl"] | "") && job->lifetimeMs && age < job->lifetimeMs &&
      WiFi.status() == WL_CONNECTED) {
    clearPrefetchedManifest();
    prefetchedManifest = job;
    Serial.printf("manifest prefetch ready: requestMs=%lu validMs=%lu\n",
      static_cast<unsigned long>(age), static_cast<unsigned long>(job->lifetimeMs - age));
    return;
  }
  Serial.printf("manifest prefetch discarded: HTTP=%d stale=%d\n", job->status,
    job->generation != prefetchGeneration || age >= job->lifetimeMs);
  delete job;  // No retries on no_signal, error, expiration or stale generation.
}

bool playPrefetchedManifest(uint32_t requestedRevision) {
  if (!prefetchedManifest) return false;
  ManifestPrefetchJob* job = prefetchedManifest;
  prefetchedManifest = nullptr;
  JsonObjectConst manifest = job->response["manifest"].as<JsonObjectConst>();
  const uint32_t age = millis() - job->startedAt;
  if (job->generation != prefetchGeneration || !job->lifetimeMs || age >= job->lifetimeMs ||
      isRecentProgram(manifest["programId"] | "") || WiFi.status() != WL_CONNECTED) {
    delete job;
    Serial.println("manifest prefetch expired; using normal tune");
    return false;
  }
  Serial.printf("manifest prefetch hit: ageMs=%lu\n", static_cast<unsigned long>(age));
  startTimingPrefetch = true;
  startManifestPlayback(manifest, requestedRevision, &job->captions);
  delete job;
  return true;  // Audio failure still stays idle; it is not a reason to auto tune.
}

uint8_t encoderPhase() {
  return (digitalRead(RADIO_ENCODER_CLK) == HIGH ? 2 : 0) |
    (digitalRead(RADIO_ENCODER_DT) == HIGH ? 1 : 0);
}

void onEncoderChange() {
  const uint8_t phase = encoderPhase();
  const uint32_t now = millis();
  portENTER_CRITICAL_ISR(&controlsMux);
  if (encoder.sample(phase, now)) {
    tuneInput.request(now, encoder.direction());
    feedbackChangedAt.store(now);
    feedbackActivitySeen.store(true);
  }
  portEXIT_CRITICAL_ISR(&controlsMux);
}

RadioTuneInput readTuneInput() {
  portENTER_CRITICAL(&controlsMux);
  const RadioTuneInput input = tuneInput;
  portEXIT_CRITICAL(&controlsMux);
  return input;
}

bool tuneSuperseded(uint32_t requestedRevision) {
  return readTuneInput().revision != requestedRevision;
}

bool controlsHaveActivity() {
  return readTuneInput().activityRevision != handledActivityRevision;
}

void rememberProgram(const String& programId) {
  if (!programId.length() || (recentProgramCount && recentProgramIds[0] == programId)) return;
  if (recentProgramCount) recentProgramIds[1] = recentProgramIds[0];
  recentProgramIds[0] = programId;
  if (recentProgramCount < 2) ++recentProgramCount;
}

String tuneRequestBody() {
  JsonDocument body;
  JsonArray excluded = body["excludeProgramIds"].to<JsonArray>();
  for (uint8_t i = 0; i < recentProgramCount; ++i) excluded.add(recentProgramIds[i]);
  String payload;
  serializeJson(body, payload);
  return payload;
}

void updateManifestPrefetch() {
  pollManifestPrefetch();
  if (!prefetchJobs || prefetchBusy || prefetchAttempted ||
      receiverState != ReceiverState::kPlaying || audioOwner.load() != AudioOwner::kNetwork || !audioStreamReady ||
      audioStopPending || !networkAudio.isRunning() ||
      !audioProducedSamples.load() || audioSeekPending.load() || audioError.load() ||
      WiFi.status() != WL_CONNECTED || tuneSuperseded(acknowledgedTuneRevision)) return;
  auto* job = new (std::nothrow) ManifestPrefetchJob;
  prefetchAttempted = true;  // One background attempt per accepted playing program.
  if (!job) return;
  job->body = tuneRequestBody();
  job->generation = prefetchGeneration;
  job->startedAt = millis();
  if (xQueueSend(prefetchJobs, &job, 0) != pdTRUE) { delete job; return; }
  prefetchBusy = true;
  Serial.println("manifest prefetch request queued");
}

void stopAudioForHandoff() {
  // NONE gates decoder-thread samples before stopSong waits for decoding.
  // loop() drains the 4.0.0 info queue; old events cannot change playback flags.
  audioOwner.store(AudioOwner::kNone);
  startTiming.active.store(false);
  networkAudio.setVolume(0); // stopSong can leave queued PCM; NONE must stay silent.
  networkAudio.stopSong();
  networkAudio.loop();
  audioEof = false;
  audioStreamReady = false;
  audioStopPending = false;
  audioProducedSamples.store(false);
  audioError.store(false);
  prepareStartOffset(0);
  lastAudioPosition = 0;
  staticEof = staticStopPending = staticReadyLogged = false;
  staticError.store(false);
  staticProducedSamples.store(false);
  staticStreamReady.store(false);
}

void startLocalStatic() {
  if (!tuningWavReady) return;
  networkAudio.setVolume(kStaticVolume);
  audioOwner.store(AudioOwner::kStaticLocalFile);
  if (!networkAudio.connecttoFS(FFat, kTuningWavPath)) {
    stopAudioForHandoff();
    tuningWavReady = false;
    Serial.println("local static failed to start; tuning stays silent");
    return;
  }
  Serial.println("local static started");
}

void stopForTuning() {
  // Manual interruption never retires the old network program.
  autoAdvancePending = automaticTune = false;
  startTimingPrefetch = false;
  dialLockRecorded = false;
  stopAudioForHandoff();
  currentProgramId = "";
  receiverState = ReceiverState::kTuning;
  captionTrack.clear();
  captionCursor.reset();
  displayModel.selectProgram("", "");
  displayModel.setStatus(RadioDisplayStatus::Tuning);
  startLocalStatic();
}

void finishTuningIdle(RadioDisplayStatus status) {
  autoAdvancePending = automaticTune = false;
  stopAudioForHandoff();
  foregroundTunePending = false;
  pendingPlaybackReady = false;
  pendingPlaybackManifest.clear();
  portENTER_CRITICAL(&controlsMux);
  tuneInput.hold(millis());
  portEXIT_CRITICAL(&controlsMux);
  currentProgramId = "";
  receiverState = ReceiverState::kIdle;
  captionTrack.clear();
  captionCursor.reset();
  displayModel.setIdle(WiFi.status() == WL_CONNECTED ? status : RadioDisplayStatus::NoNetwork);
}

void updateLocalStatic() {
  if (receiverState != ReceiverState::kTuning || audioOwner.load() != AudioOwner::kStaticLocalFile) return;
  networkAudio.loop();
  if (staticProducedSamples.load() && !staticReadyLogged) {
    staticReadyLogged = true;
    Serial.printf("local static ready: volume=%u\n", kStaticVolume);
  }
  if (staticError.load() || (staticEof && !staticProducedSamples.load()) ||
      (!networkAudio.isRunning() && !staticEof && staticStopPending)) {
    stopAudioForHandoff();
    tuningWavReady = false;
    Serial.println("local static failed; tuning stays silent");
    return;
  }
  if (staticEof) {
    stopAudioForHandoff();
    Serial.println("local static loop");
    startLocalStatic();
  } else staticStopPending = !networkAudio.isRunning();
}

void setupControls() {
  pinMode(RADIO_ENCODER_CLK, INPUT_PULLUP);
  pinMode(RADIO_ENCODER_DT, INPUT_PULLUP);
  encoder.begin(encoderPhase());
  attachInterrupt(digitalPinToInterrupt(RADIO_ENCODER_CLK), onEncoderChange, CHANGE);
  attachInterrupt(digitalPinToInterrupt(RADIO_ENCODER_DT), onEncoderChange, CHANGE);
  Serial.printf("EC11: CLK=%d DT=%d SW=%d reserved; rotate to tune\n",
    RADIO_ENCODER_CLK, RADIO_ENCODER_DT, RADIO_ENCODER_SW);
}

struct WifiDiagnosticEvent {
  arduino_event_id_t event;
  uint32_t timestamp;
  uint8_t reason;
};

QueueHandle_t wifiDiagnosticQueue = nullptr;
std::atomic<uint32_t> droppedWifiEvents{0};
uint32_t lastWifiReportMillis = 0;

void onWifiEvent(arduino_event_id_t event, arduino_event_info_t info) {
  if (event != ARDUINO_EVENT_WIFI_STA_CONNECTED &&
      event != ARDUINO_EVENT_WIFI_STA_DISCONNECTED &&
      event != ARDUINO_EVENT_WIFI_STA_GOT_IP &&
      event != ARDUINO_EVENT_WIFI_STA_LOST_IP) return;
  // Wi-Fi 回调运行在另一个任务。只入队，在主循环中输出，避免阻塞事件任务。
  const WifiDiagnosticEvent diagnostic{
    event, millis(),
    event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED
      ? info.wifi_sta_disconnected.reason : uint8_t{0}
  };
  if (xQueueSend(wifiDiagnosticQueue, &diagnostic, 0) != pdTRUE)
    droppedWifiEvents.fetch_add(1);
}

void printWifiStatus(const char* context) {
  const int status = WiFi.status();
  Serial.printf("[Wi-Fi %lu ms] %s: status=%d (%s), STA MAC=%s\n",
    static_cast<unsigned long>(millis()), context, status,
    status == WL_CONNECTED ? "connected" : "not connected",
    WiFi.macAddress().c_str());
  if (status != WL_CONNECTED) return;
  Serial.printf("  SSID=%s, AP BSSID=%s, channel=%ld, RSSI=%ld dBm\n",
    WiFi.SSID().c_str(), WiFi.BSSIDstr().c_str(),
    static_cast<long>(WiFi.channel()), static_cast<long>(WiFi.RSSI()));
  Serial.printf("  IP=%s, gateway=%s, mask=%s, DNS=%s\n",
    WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str(),
    WiFi.subnetMask().toString().c_str(), WiFi.dnsIP().toString().c_str());
}

void updateWifiDiagnostics() {
  WifiDiagnosticEvent diagnostic;
  while (wifiDiagnosticQueue && xQueueReceive(wifiDiagnosticQueue, &diagnostic, 0) == pdTRUE) {
    if (diagnostic.event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
      Serial.printf("[Wi-Fi %lu ms] disconnected: reason=%u (%s)\n",
        static_cast<unsigned long>(diagnostic.timestamp), diagnostic.reason,
        WiFi.disconnectReasonName(static_cast<wifi_err_reason_t>(diagnostic.reason)));
    } else {
      const char* name = diagnostic.event == ARDUINO_EVENT_WIFI_STA_CONNECTED
        ? "associated with AP" : diagnostic.event == ARDUINO_EVENT_WIFI_STA_GOT_IP
        ? "got IP" : "lost IP";
      Serial.printf("[Wi-Fi %lu ms] %s\n",
        static_cast<unsigned long>(diagnostic.timestamp), name);
    }
  }
  const uint32_t dropped = droppedWifiEvents.exchange(0);
  if (dropped) Serial.printf("Wi-Fi diagnostic queue overflow: %lu events\n",
    static_cast<unsigned long>(dropped));
  // idle 也持续诊断；播放时避免周期性串口输出打断 decoder。
  if (receiverState != ReceiverState::kPlaying && millis() - lastWifiReportMillis >= 15'000) {
    lastWifiReportMillis = millis();
    printWifiStatus("periodic");
  }
}

void reportHttpFailure(const char* operation, int status) {
  Serial.printf("%s request failed: HTTP %d\n", operation, status);
  if (status < 0) Serial.printf("  transport error: %s\n", HTTPClient::errorToString(status).c_str());
  updateWifiDiagnostics();
  printWifiStatus("HTTP failure");
}

struct GatewayNeighbor {
  ip4_addr_t ip;
  uint8_t mac[6];
  bool found;
};

void readGatewayNeighbor(void* context) {
  auto* neighbor = static_cast<GatewayNeighbor*>(context);
  // 在 lwIP 线程读取邻居表，避免跨任务访问 ARP 内部数据。
  for (size_t i = 0; i < ARP_TABLE_SIZE; ++i) {
    ip4_addr_t* ip = nullptr;
    netif* interface = nullptr;
    eth_addr* mac = nullptr;
    if (etharp_get_entry(i, &ip, &interface, &mac) && ip4_addr_cmp(ip, &neighbor->ip)) {
      memcpy(neighbor->mac, mac->addr, sizeof(neighbor->mac));
      neighbor->found = true;
      return;
    }
  }
}

String diagnoseGateway() {
  if (WiFi.status() != WL_CONNECTED) return "";
  WiFiClient client;
  HTTPClient request;
  const String endpoint = String("http://") + WiFi.gatewayIP().toString() + "/";
  request.setConnectTimeout(3'000);
  request.setTimeout(3'000);
  if (request.begin(client, endpoint)) {
    // 只测试网关可达性，不发送 Device token，不读取或输出管理页正文。
    const int status = request.GET();
    Serial.printf("Gateway HTTP probe: %d\n", status);
    request.end();
  }
  GatewayNeighbor neighbor{};
  neighbor.ip.addr = static_cast<uint32_t>(WiFi.gatewayIP());
  if (tcpip_callback_wait(readGatewayNeighbor, &neighbor) == ERR_OK && neighbor.found) {
    char mac[18];
    snprintf(mac, sizeof(mac), "%02X:%02X:%02X:%02X:%02X:%02X",
      neighbor.mac[0], neighbor.mac[1], neighbor.mac[2],
      neighbor.mac[3], neighbor.mac[4], neighbor.mac[5]);
    Serial.printf("Gateway MAC: %s\n", mac);
    return String(mac);
  } else {
    Serial.println("Gateway MAC: unresolved");
    return "";
  }
}

bool waitForWifi() {
  const uint32_t startedAt = millis();
  while (WiFi.status() != WL_CONNECTED) {
    updateWifiDiagnostics();
    if (millis() - startedAt >= kWifiConnectTimeoutMs) {
      Serial.printf("Wi-Fi failed after %lu ms\n", kWifiConnectTimeoutMs);
      printWifiStatus("connect timeout");
      return false;
    }
    delay(500);
  }
  Serial.print("Wi-Fi connected: ");
  Serial.println(WiFi.localIP());
  updateWifiDiagnostics();
  printWifiStatus("connected");
  return true;
}

bool connectWifi() {
  Serial.println("Wi-Fi connecting");
  wifiDiagnosticQueue = xQueueCreate(12, sizeof(WifiDiagnosticEvent));
  if (!wifiDiagnosticQueue) {
    Serial.println("Wi-Fi diagnostic queue allocation failed");
    return false;
  }
  WiFi.onEvent(onWifiEvent);
  WiFi.mode(WIFI_STA);
  // This receiver streams over Wi-Fi continuously while powered by USB.
  // Avoid modem sleep delaying HTTP/TLS exchanges and audio packet delivery.
  Serial.println(WiFi.setSleep(false)
    ? "Wi-Fi modem sleep disabled" : "Wi-Fi modem sleep disable failed");
  if (strlen(WIFI_GATEWAY_MAC) == 0) {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    return waitForWifi();
  }

  // 同名 SSID 可能属于不同局域网。启动时最多验证 8 个热点，
  // 只接受配置的网关，使用 BSSID 固定接入点，再调用一次 tune。
  struct Candidate { uint8_t bssid[6]; int32_t channel; };
  Candidate candidates[8];
  size_t count = 0;
  WiFi.setAutoReconnect(false);
  const int found = WiFi.scanNetworks();
  Serial.printf("Wi-Fi scan: %d networks; required gateway=%s\n", found, WIFI_GATEWAY_MAC);
  for (int i = 0; i < found; ++i) {
    if (WiFi.SSID(i) != WIFI_SSID) continue;
    Serial.printf("  matching AP: %s, channel=%ld, RSSI=%ld dBm\n",
      WiFi.BSSIDstr(i).c_str(), static_cast<long>(WiFi.channel(i)),
      static_cast<long>(WiFi.RSSI(i)));
    if (count < 8) {
      memcpy(candidates[count].bssid, WiFi.BSSID(i), 6);
      candidates[count++].channel = WiFi.channel(i);
    }
  }
  WiFi.scanDelete();
  for (size_t i = 0; i < count; ++i) {
    WiFi.disconnect(false, false);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD, candidates[i].channel, candidates[i].bssid);
    if (waitForWifi() && diagnoseGateway().equalsIgnoreCase(WIFI_GATEWAY_MAC)) {
      WiFi.setAutoReconnect(true);  // BSSID 保持固定，不漫游到同名的其他网络。
      Serial.println("Wi-Fi gateway matched; access point selected");
      return true;
    }
    Serial.println("Wi-Fi candidate rejected: disconnected or different gateway");
  }
  WiFi.disconnect(false, false);
  Serial.println("Wi-Fi: no matching gateway among scanned same-name access points");
  return false;
}

bool sendCompleted(const String& programId) {
  WiFiClient client;
  HTTPClient request;
  const String path =
    String("/api/device/receiver/programs/") + programId + "/completed";
  const String endpoint = deviceApiUrl(path.c_str());

  if (!request.begin(client, endpoint)) {
    Serial.println("completed request failed to start");
    return false;
  }

  request.setConnectTimeout(8'000);
  request.setTimeout(10'000);
  request.addHeader("Authorization", String("Bearer ") + DEVICE_API_TOKEN);
  const int status = request.POST("");
  if (status >= 200 && status < 300)
    Serial.println("completed request succeeded");
  else
    reportHttpFailure("completed", status);
  request.end();
  return status >= 200 && status < 300;
}

bool blankFatVolume() {
  const esp_partition_t* partition = esp_partition_find_first(ESP_PARTITION_TYPE_DATA,
    ESP_PARTITION_SUBTYPE_DATA_FAT, "ffat");
  if (!partition) return false;
  wl_handle_t handle = WL_INVALID_HANDLE;
  if (wl_mount(partition, &handle) != ESP_OK) return false;
  // Check logical sectors, not raw flash: wl_mount initializes metadata even
  // when there is no FAT filesystem yet. Those metadata pages are not files.
  bool blank = true;
  const size_t size = wl_size(handle);
  uint8_t block[4096];
  for (size_t offset = 0; blank && offset < size; offset += sizeof(block)) {
    const size_t remaining = size - offset;
    const size_t bytes = remaining < sizeof(block) ? remaining : sizeof(block);
    if (wl_read(handle, offset, block, bytes) != ESP_OK) { blank = false; break; }
    for (size_t i = 0; i < bytes; ++i) if (block[i] != 0xff) { blank = false; break; }
    vTaskDelay(1);
  }
  const bool unmounted = wl_unmount(handle) == ESP_OK;
  return size && blank && unmounted;
}

void setupTuningWav() {
  const bool blank = blankFatVolume();
  if (!FFat.begin(false)) {
    // Initialize only a completely erased logical volume. Do not format a
    // nonempty, unreadable filesystem belonging to another sketch.
    if (!blank || !FFat.begin(true)) {
      Serial.println("FFat unavailable; local static disabled (existing data preserved)");
      return;
    }
    Serial.println("FFat initialized on blank volume");
  }
  const bool cached = radioTuningFileValid(FFat);
  tuningWavReady = radioEnsureTuningFile(FFat, [] { vTaskDelay(1); });
  Serial.println(tuningWavReady
    ? (cached ? "local tuning WAV cached: 32000 Hz mono 16-bit, 6 s"
              : "local tuning WAV generated: 32000 Hz mono 16-bit, 6 s")
    : "local tuning WAV generation failed; static disabled");
}

void startManifestPlayback(JsonObjectConst manifest, uint32_t requestedRevision,
  const RadioCaptionTrack* captions) {
  if (tuneSuperseded(requestedRevision)) return;
  if (automaticTune && readTuneInput().activityRevision != autoAdvanceActivity) {
    stopForTuning();
    return;
  }
  const char* programId = manifest["programId"] | "";
  const char* title = manifest["title"] | "(untitled)";
  const char* signalKind = manifest["signalKind"] | "unknown";
  const char* audioUrl = manifest["audioUrl"] | "";
  const uint32_t startOffsetMs = automaticTune ? 0 : (manifest["startOffsetMs"] | 0u);

  if (strlen(programId) == 0 || strlen(audioUrl) == 0) {
    Serial.println("signal manifest is missing programId or audioUrl");
    finishTuningIdle();
    return;
  }

  // Selection/prefetch happens while turning. Blocking HTTPS/Range work must
  // wait until the local feedback has had a chance to play and the dial stops.
  if (captions && captions != &captionTrack) captionTrack = *captions;
  else if (!captions) captionTrack.load(manifest["captions"].as<JsonArrayConst>());
  captionCursor.reset();
  displayModel.clearCaption();
  if (captions != &captionTrack) {
    Serial.printf("[caption] loaded: received=%lu kept=%u invalid=%lu dropped=%lu textTruncated=%lu speakerTruncated=%lu bytes=%u\n",
      static_cast<unsigned long>(captionTrack.received), unsigned(captionTrack.count),
      static_cast<unsigned long>(captionTrack.invalid), static_cast<unsigned long>(captionTrack.dropped),
      static_cast<unsigned long>(captionTrack.textTruncated), static_cast<unsigned long>(captionTrack.speakerTruncated),
      unsigned(captionTrack.usedBytes));
  }
  displayModel.selectProgram(title, signalKind);
  if (receiverState == ReceiverState::kTuning && readTuneInput().moving(millis())) {
    pendingPlaybackManifest.set(manifest);
    pendingPlaybackManifest.remove("captions");
    JsonDocument compact;
    if (compact.set(pendingPlaybackManifest)) pendingPlaybackManifest = std::move(compact);
    pendingPlaybackRevision = requestedRevision;
    pendingPlaybackReady = true;
    Serial.println("manifest prepared; waiting for dial stop");
    return;
  }

  stopAudioForHandoff();
  const char* query = strchr(audioUrl, '?');
  const size_t pathLength = query ? size_t(query - audioUrl) : strlen(audioUrl);
  const bool wavCandidate = pathLength >= 4 && !strncmp(audioUrl + pathLength - 4, ".wav", 4);
  const bool useFastWav = RADIO_FAST_WAV_START && wavCandidate && startOffsetMs / 1000 <= UINT16_MAX;
  startTiming.begin(dialLockRecorded ? dialLockedAt : millis(), startTimingPrefetch, useFastWav);
  Serial.printf("[start] dial.locked: ms=0 prefetch=%d\n", startTiming.prefetch);
  audioOwner.store(AudioOwner::kNetwork);
  currentProgramId = programId;
  Serial.println("signal");
  Serial.print("program title: ");
  Serial.println(title);
  Serial.print("signalKind: ");
  Serial.println(signalKind);
  Serial.printf("startOffsetMs: %lu\n", static_cast<unsigned long>(startOffsetMs));
  Serial.print("audio stream: ");
  Serial.println(summarizeAudioUrl(audioUrl));

  audioEof = false;
  audioStreamReady = false;
  audioStopPending = false;
  audioProducedSamples.store(false);
  audioError.store(false);
  prepareStartOffset(startOffsetMs);
  lastAudioPosition = 0;

  displayModel.setStatus(RadioDisplayStatus::Locking);
  renderDisplay(displayModel); // Show the selected title before blocking TLS/seek.
  // Audio.connecttohost() 独占 HTTP(S) 流式读取、解码和唯一的 I2S 输出；
  // sketch 只交付当前 signed URL，绝不会把整条音频下载进 RAM 或 PSRAM。
  recordStartPoint(RadioStartTiming::ConnectBegin, millis());
  bool connected = false;
#if RADIO_FAST_WAV_START
  if (useFastWav) {
    connected = networkAudio.connecttohostAtTime(audioUrl, static_cast<uint16_t>(startOffsetMs / 1000));
    if (connected) {
      audioSeekPending.store(false);
      displaySeekWaiting.store(false);
    } else {
      // Drain failed experiment events before resetting flags for the legacy
      // attempt. Error events from the failed attempt cannot poison fallback.
      networkAudio.loop();
      startTiming.fallback = true;
      audioError.store(false);
      audioEof = false;
      audioStreamReady.store(false);
      audioProducedSamples.store(false);
      displayProducedSamples.store(false);
      prepareStartOffset(startOffsetMs);
      Serial.println("fallback to legacy seek");
    }
  }
#endif
  if (!connected) connected = networkAudio.connecttohost(audioUrl);
  if (tuneSuperseded(requestedRevision) ||
      (automaticTune && readTuneInput().activityRevision != autoAdvanceActivity)) {
    stopForTuning();
    Serial.println("tune superseded while connecting audio");
    return;
  }
  if (!connected) {
    Serial.println("audio playback failed to start");
    if (startTiming.fallback) failPlayback();
    else finishTuningIdle();
    return;
  }

  networkAudio.setVolume(kNetworkVolume);
  if (requestedRevision != 0) {
    portENTER_CRITICAL(&controlsMux);
    tuneInput.hold(millis());
    portEXIT_CRITICAL(&controlsMux);
  }
  audioStartMillis = millis();
  audioProgressMillis = audioStartMillis;
  rememberProgram(currentProgramId);
  invalidatePrefetch();
  prefetchAttempted = false;
  receiverState = ReceiverState::kPlaying;
  automaticTune = false;
  Serial.println("audio playback started");
}

void tuneOnce(uint32_t requestedRevision) {
  if (tuneSuperseded(requestedRevision)) return;
  if (WiFi.status() != WL_CONNECTED) {
    finishTuningIdle();
    Serial.println("tune skipped: Wi-Fi is not connected; retry after reconnection");
    return;
  }
  receiverState = ReceiverState::kTuning;
  displayModel.setStatus(RadioDisplayStatus::Tuning);
  renderDisplay(displayModel);
  Serial.println("tune request");
  Serial.print("Device API: ");
  Serial.println(summarizeAudioUrl(deviceApiUrl("/api/device/receiver/tune")));
  printWifiStatus("before tune");

  WiFiClient client;
  HTTPClient request;
  // getStreamPtr() 不解码 chunked；HTTP/1.0 要求服务端返回普通 body。
  request.useHTTP10(true);
  if (!request.begin(client, deviceApiUrl("/api/device/receiver/tune"))) {
    Serial.println("tune request failed to start");
    finishTuningIdle();
    return;
  }

  request.setConnectTimeout(8'000);
  request.setTimeout(10'000);
  request.addHeader("Authorization", String("Bearer ") + DEVICE_API_TOKEN);
  request.addHeader("Content-Type", "application/json");
  const String payload = tuneRequestBody();
  if (tuneSuperseded(requestedRevision)) {
    request.end();
    return;
  }
  const int status = request.POST(payload);
  if (tuneSuperseded(requestedRevision)) {
    request.end();
    Serial.println("tune superseded while requesting manifest");
    return;
  }
  if (status < 200 || status >= 300) {
    reportHttpFailure("tune", status);
    request.end();
    diagnoseGateway();
    finishTuningIdle();
    return;
  }

  // 只保留播放元数据与 captions；字幕随后复制到有界的设备自有结构。
  JsonDocument filter;
  fillManifestFilter(filter);
  JsonDocument response;
  const DeserializationError error = deserializeJson(
    response,
    *request.getStreamPtr(),
    DeserializationOption::Filter(filter),
    DeserializationOption::NestingLimit(4)
  );
  request.end();

  if (tuneSuperseded(requestedRevision)) {
    Serial.println("tune superseded while reading manifest");
    return;
  }

  if (error) {
    Serial.print("tune response JSON failed: ");
    Serial.println(error.c_str());
    finishTuningIdle();
    return;
  }

  const char* result = response["result"] | "";
  if (strcmp(result, "no_signal") == 0) {
    Serial.println("no_signal");
    // Keep exclusions on no_signal. A later physical turn may retry once,
    // but never silently relax history or request again automatically.
    finishTuningIdle(RadioDisplayStatus::NoSignal);
    return;
  }
  if (strcmp(result, "signal") != 0 || !response["manifest"].is<JsonObject>()) {
    Serial.println("tune response has an unknown result");
    finishTuningIdle();
    return;
  }

  startManifestPlayback(response["manifest"].as<JsonObjectConst>(), requestedRevision);
}

void applyForegroundManifest(ManifestPrefetchJob& job) {
  if (job.status < 200 || job.status >= 300) {
    reportHttpFailure("tune", job.status);
    finishTuningIdle();
    return;
  }
  const char* result = job.response["result"] | "";
  if (!job.parsed || (strcmp(result, "signal") && strcmp(result, "no_signal"))) {
    Serial.println("tune response JSON/result failed");
    finishTuningIdle();
    return;
  }
  if (strcmp(result, "no_signal") == 0) {
    Serial.println("no_signal");
    finishTuningIdle(RadioDisplayStatus::NoSignal);
    return;
  }
  startManifestPlayback(job.response["manifest"].as<JsonObjectConst>(), job.requestedRevision, &job.captions);
}

void updateForegroundTune() {
  if (!foregroundTunePending) return;
  if (receiverState != ReceiverState::kTuning || tuneSuperseded(foregroundTuneRevision)) {
    foregroundTunePending = false;
    return;
  }
  if (prefetchBusy) return; // Only one HTTP request may run at a time.
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("tune skipped: Wi-Fi is not connected; retry after reconnection");
    finishTuningIdle();
    return;
  }
  auto* job = new (std::nothrow) ManifestPrefetchJob;
  foregroundTunePending = false;
  if (!job) { Serial.println("tune allocation failed"); finishTuningIdle(); return; }
  job->body = tuneRequestBody();
  job->generation = prefetchGeneration;
  job->startedAt = millis();
  job->foreground = true;
  job->requestedRevision = foregroundTuneRevision;
  if (xQueueSend(prefetchJobs, &job, 0) != pdTRUE) {
    delete job;
    Serial.println("tune queue failed");
    finishTuningIdle();
    return;
  }
  prefetchBusy = true;
  Serial.println("tune request queued");
}

void requestForegroundTune(uint32_t requestedRevision) {
  if (!prefetchJobs) { tuneOnce(requestedRevision); return; }
  foregroundTuneRevision = requestedRevision;
  foregroundTunePending = true;
  updateForegroundTune();
}

void updateAutomaticAdvance() {
  if (!autoAdvancePending) return;
  const RadioTuneInput input = readTuneInput();
  // Any physical motion, including during completed HTTP, wins over autoplay.
  if (receiverState != ReceiverState::kIdle || input.revision != autoAdvanceRevision ||
      input.activityRevision != autoAdvanceActivity || input.moving(millis())) {
    autoAdvancePending = false;
    return;
  }
  if (WiFi.status() != WL_CONNECTED) { finishTuningIdle(); return; }
  // Reuse a background request still in flight; never queue a duplicate.
  if (prefetchBusy) return;
  autoAdvancePending = false;
  automaticTune = true;
  startTimingPrefetch = false;
  dialLockedAt = millis();
  dialLockRecorded = true;
  receiverState = ReceiverState::kTuning;
  displayModel.setStatus(RadioDisplayStatus::Locking);
  Serial.println("automatic continuation: next program");
  if (!playPrefetchedManifest(autoAdvanceRevision)) {
    invalidatePrefetch();
    requestForegroundTune(autoAdvanceRevision);
  }
}

void updateControls() {
  RadioTuneInput input = readTuneInput();
  if (input.activityRevision != handledActivityRevision) {
    if (automaticTune) {
      foregroundTunePending = false;
      pendingPlaybackReady = false;
      pendingPlaybackManifest.clear();
      invalidatePrefetch();
      stopForTuning();
    }
    handledActivityRevision = input.activityRevision;
    feedbackChangedAt.store(input.changedAt);
    feedbackActivitySeen.store(true);
    if (!feedbackLogged) {
      Serial.println("encoder feedback");
      feedbackLogged = true;
    }
    // Small movement uses the existing decoder's PCM callback; the network
    // connection and prefetch stay intact. Stop only for an actual selection.
    if (receiverState == ReceiverState::kIdle || receiverState == ReceiverState::kWifiFailed)
      stopForTuning();
    else if (receiverState == ReceiverState::kTuning && audioOwner.load() == AudioOwner::kNone)
      startLocalStatic();
  }
  input = readTuneInput();
  if (input.ready(acknowledgedTuneRevision, millis())) {
    Serial.println("dial travel threshold: retune");
    acknowledgedTuneRevision = input.revision;
    pendingPlaybackReady = false;
    pendingPlaybackManifest.clear();
    if (receiverState != ReceiverState::kTuning) {
      Serial.println("manual retune: stop current program");
      stopForTuning();
    }
    if (!playPrefetchedManifest(input.revision)) {
      invalidatePrefetch();
      requestForegroundTune(input.revision);
    }
    return;
  }
  // End noise quickly; keep the 300ms lock window for starting HTTPS once.
  if (receiverState == ReceiverState::kTuning && audioOwner.load() == AudioOwner::kStaticLocalFile &&
      uint32_t(millis() - input.changedAt) >= kFeedbackTailMs) {
    stopAudioForHandoff();
    Serial.println("dial stopped: static off");
  }
  if (input.activityRevision && !input.moving(millis())) {
    portENTER_CRITICAL(&controlsMux);
    const bool stillStopped = tuneInput.activityRevision == input.activityRevision;
    if (stillStopped) tuneInput.settle();
    portEXIT_CRITICAL(&controlsMux);
    if (!stillStopped) return;
    feedbackLogged = false;
    if (receiverState == ReceiverState::kTuning && pendingPlaybackReady) {
      JsonDocument manifest;
      manifest.set(pendingPlaybackManifest);
      const uint32_t revision = pendingPlaybackRevision;
      pendingPlaybackReady = false;
      pendingPlaybackManifest.clear();
      dialLockedAt = millis();
      dialLockRecorded = true;
      Serial.println("dial locked: connect prepared program");
      startManifestPlayback(manifest.as<JsonObjectConst>(), revision, &captionTrack);
    } else if (receiverState == ReceiverState::kTuning && !foregroundTunePending && !prefetchBusy) {
      receiverState = ReceiverState::kIdle;
      displayModel.setIdle(RadioDisplayStatus::NoSignal);
    }
  }
}

void onAudioInfo(Audio::msg_t message) {
  const AudioOwner owner = audioOwner.load();
  if (owner == AudioOwner::kStaticLocalFile) {
    if (message.e == Audio::evt_eof) staticEof = true;
    if (message.e == Audio::evt_info && message.msg && !strcmp(message.msg, "stream ready")) staticStreamReady.store(true);
    if (message.e == Audio::evt_log && message.s && !strcmp(message.s, "LOGE")) staticError.store(true);
    return;
  }
  if (owner == AudioOwner::kNetwork && message.e == Audio::evt_eof) audioEof = true;
  if (owner == AudioOwner::kNetwork && message.e == Audio::evt_info && message.msg &&
      strcmp(message.msg, "stream ready") == 0) audioStreamReady = true;
  if (owner == AudioOwner::kNetwork && message.e == Audio::evt_info && message.msg) {
    if (!strcmp(message.msg, "radio.fast.not-reusable"))
      Serial.println("fast wav start: connection not reusable");
    if (!strcmp(message.msg, "radio.fast.failed")) {
      constexpr const char* stages[] = {"unknown", "connect", "initial header", "initial body", "WAV header/target", "connection not reusable", "target request", "target header", "decode mutex", "decoder", "target prefill"};
      const unsigned stage = static_cast<unsigned>(message.arg1);
      Serial.printf("fast wav start failed: %s\n", stage < sizeof(stages) / sizeof(stages[0]) ? stages[stage] : stages[0]);
    }
    if (!strcmp(message.msg, "radio.fast.initial.consumed"))
      Serial.printf("[fast] initial.consumed: bytes=%ld\n", static_cast<long>(message.arg1));
    if (!strcmp(message.msg, "radio.fast.applied"))
      Serial.printf("[fast] applied: position=%ld seconds=%ld\n", static_cast<long>(message.arg1), static_cast<long>(message.arg2));
    struct StartEvent { const char* tag; RadioStartTiming::Point point; };
    static constexpr StartEvent points[] = {
      {"radio.start.tls.connected", RadioStartTiming::TlsConnected},
      {"radio.start.wav.header", RadioStartTiming::WavHeader},
      {"radio.start.range.sent", RadioStartTiming::RangeSent},
      {"radio.start.range.ready", RadioStartTiming::RangeReady},
    };
    for (const StartEvent& event : points)
      if (!strcmp(message.msg, event.tag)) recordStartPoint(event.point, uint32_t(message.arg1));
  }
  // The local diagnostic patch enqueues these constant IDs. evt_info is
  // dispatched by Audio.loop() on the main task. Never print arbitrary
  // library messages or response headers: they can contain signed URLs.
  if (message.e == Audio::evt_info && message.msg) {
    struct Diagnostic { const char* tag; const char* first; const char* second; };
    static constexpr Diagnostic diagnostics[] = {
      {"radio.seek.queued", "seconds", "position"},
      {"radio.seek.initial.status", "HTTP", nullptr},
      {"radio.seek.initial.content-range", "present", nullptr},
      {"radio.seek.initial.range-supported", "supported", "fileSize"},
      {"radio.seek.accept-ranges", "headerBytes", "supported"},
      {"radio.seek.range.request", "position", "length"},
      {"radio.seek.range.not-running", "value", nullptr},
      {"radio.seek.range.connect-failed", "value", nullptr},
      {"radio.seek.range.sent", "written", "expected"},
      {"radio.seek.range.status", "HTTP", nullptr},
      {"radio.seek.range.validated", "position", "fileSize"},
      {"radio.seek.range.header-result", "ok", "reason"},
      {"radio.seek.file-seek.begin", "acceptRanges", "dataMode"},
      {"radio.seek.file-seek.request-result", "ok", nullptr},
      {"radio.seek.file-seek.header-result", "ok", nullptr},
      {"radio.seek.file-seek.no-ranges", "result", nullptr},
      {"radio.seek.new-buffer.begin", "position", "headerState"},
      {"radio.seek.new-buffer.guard", "reason", nullptr},
      {"radio.seek.new-buffer.seek-result", "result", "requested"},
      {"radio.seek.new-buffer.read", "read", "expected"},
      {"radio.seek.read.timeout", "read", "expected"},
      {"radio.seek.new-buffer.align", "offset", "codec"},
      {"radio.seek.new-buffer.result", "position", "ok"},
    };
    for (const Diagnostic& diagnostic : diagnostics) {
      if (strcmp(message.msg, diagnostic.tag) != 0) continue;
      const char* phase = diagnostic.tag + sizeof("radio.seek.") - 1;
      if (diagnostic.second) {
        Serial.printf("[seek] %s: %s=%ld %s=%ld\n", phase,
          diagnostic.first, static_cast<long>(message.arg1),
          diagnostic.second, static_cast<long>(message.arg2));
      } else {
        Serial.printf("[seek] %s: %s=%ld\n", phase,
          diagnostic.first, static_cast<long>(message.arg1));
      }
      break;
    }
    if (owner == AudioOwner::kNetwork && strcmp(message.msg, "radio.seek.new-buffer.result") == 0 && message.arg2 == 1) {
      displaySeekWaiting.store(false);
      Serial.printf("audio seek applied: position=%ld\n", static_cast<long>(message.arg1));
    }
  }
  // 日志可能从库的解码任务发出；只保存错误标志，不打印含 signed URL 的消息。
  if (owner == AudioOwner::kNetwork && message.e == Audio::evt_log && message.s &&
      strcmp(message.s, "LOGE") == 0) audioError.store(true);
}

void failPlayback() {
  autoAdvancePending = automaticTune = false;
  Serial.printf("audio failure flags: libraryError=%d WiFi=%d ready=%d seekPending=%d samples=%d running=%d\n",
    audioError.load(), WiFi.status(), audioStreamReady.load(), audioSeekPending.load(),
    audioProducedSamples.load(), networkAudio.isRunning());
  stopAudioForHandoff();
  invalidatePrefetch();
  // A selected tune remains latched until accepted or finished. A terminal
  // playback failure must release it just like finishTuningIdle, so a later
  // physical turn can request a new program; never retry automatically.
  portENTER_CRITICAL(&controlsMux);
  tuneInput.hold(millis());
  portEXIT_CRITICAL(&controlsMux);
  currentProgramId = "";
  receiverState = ReceiverState::kIdle;
  captionTrack.clear();
  captionCursor.reset();
  displayModel.setIdle(WiFi.status() == WL_CONNECTED
    ? RadioDisplayStatus::SignalLost : RadioDisplayStatus::NoNetwork);
  Serial.println("audio playback failed");
}

void updatePlayback() {
  if (audioOwner.load() != AudioOwner::kNetwork) return;
  networkAudio.loop();
  reportFirstNetworkPcm();

  if (receiverState != ReceiverState::kPlaying) return;
  // A turn captured during Audio.loop() must win over an EOF dispatched in
  // that same call. Manual interruption never retires the old program.
  if (controlsHaveActivity() || tuneSuperseded(acknowledgedTuneRevision)) {
    updateControls();
    return;
  }
  // An error/disconnection must also take precedence over EOF and seek.
  if (audioError.load() || WiFi.status() != WL_CONNECTED) {
    failPlayback();
    return;
  }
  if (audioEof) {
    // 4.0.0 的音频头超时也会发 EOF。必须有 ready 和真实解码样本，
    // 且没有错误，才允许下线节目；不依赖可被关闭的库错误日志。
    if (audioSeekPending.load() || !audioStreamReady || !audioProducedSamples.load()) {
      failPlayback();
      return;
    }
    audioEof = false;
    const String completedProgramId = currentProgramId;
    stopAudioForHandoff();
    currentProgramId = "";
    receiverState = ReceiverState::kIdle;
    captionTrack.clear();
    captionCursor.reset();
    displayModel.setIdle(RadioDisplayStatus::NoSignal);
    renderDisplay(displayModel); // completed HTTP may block; the program has ended.
    const RadioTuneInput input = readTuneInput();
    autoAdvanceRevision = input.revision;
    autoAdvanceActivity = input.activityRevision;
    Serial.println("audio playback completed");
    autoAdvancePending = sendCompleted(completedProgramId);
    return;
  }

  if (!networkAudio.isRunning()) {
    // EOF 在本轮 loop() 内入队，下一轮开头才派发；先保留 playing。
    if (audioStopPending) failPlayback();
    else audioStopPending = true;
    return;
  }
  audioStopPending = false;

  const uint32_t now = millis();
  if (audioSeekPending.load() && audioStreamReady) {
    Serial.printf("seeking to: %lu s\n", static_cast<unsigned long>(audioSeekSeconds));
    // The public API takes uint16_t seconds. Reject an unrepresentable
    // offset rather than wrapping it into a different playback position.
    if (audioSeekSeconds > UINT16_MAX ||
        !networkAudio.setAudioPlayTime(static_cast<uint16_t>(audioSeekSeconds))) {
      Serial.printf("audio seek failed: %lu s\n", static_cast<unsigned long>(audioSeekSeconds));
      failPlayback();
      return;
    }
    audioSeekPending.store(false);
    audioStartMillis = audioProgressMillis = now;
    lastAudioPosition = networkAudio.getAudioFilePosition();
    Serial.println("audio seek queued");
    // 4.0.0 queues its seek; the next library loop performs the native read.
    // Existing error/stall/EOF checks continue to guard that operation.
    return;
  }
  const uint32_t position = networkAudio.getAudioFilePosition();
  if (position != lastAudioPosition) {
    lastAudioPosition = position;
    audioProgressMillis = now;
  }
  if ((!audioProducedSamples.load() && now - audioStartMillis >= kAudioStartTimeoutMs) ||
      (audioProducedSamples.load() && now - audioProgressMillis >= kAudioStallTimeoutMs))
    failPlayback();
}

}  // namespace

// Foreground only. Small dial feedback is visual TUNING even while the
// existing receiver keeps its network connection and business state.
void updateDisplay() {
  const RadioTuneInput input = readTuneInput();
  displayModel.update(WiFi.status() == WL_CONNECTED,
    input.activityRevision && input.moving(millis()),
    receiverState == ReceiverState::kTuning, pendingPlaybackReady,
    receiverState == ReceiverState::kPlaying && audioOwner.load() == AudioOwner::kNetwork,
    audioStreamReady.load(), displayProducedSamples.load(),
    audioSeekPending.load() || displaySeekWaiting.load());
  if (displayModel.status == RadioDisplayStatus::Playing && displayModel.captionLayout()) {
    const int8_t previousCaption = displayModel.captionIndex;
    const uint16_t previousPage = displayModel.captionPage;
    const uint64_t playbackMs = uint64_t(networkAudio.getAudioCurrentTime()) * 1000;
    captionCursor.update(captionTrack, displayModel, playbackMs, millis(), captionGlyphWidth);
    if (previousCaption != displayModel.captionIndex || previousPage != displayModel.captionPage)
      Serial.printf("[caption] index=%d page=%u/%u playbackMs=%llu\n", int(displayModel.captionIndex),
        displayModel.captionIndex < 0 ? 0u : unsigned(displayModel.captionPage + 1),
        unsigned(displayModel.captionPages), static_cast<unsigned long long>(playbackMs));
  } else captionCursor.pause(displayModel);
  renderDisplay(displayModel);
}

// The library can drain queued PCM after stopSong. NONE must output silence;
// the volume ramp alone cannot guarantee that during an owner handoff.
void audio_process_raw_samples(int32_t* samples, int16_t validSamples) {
  const AudioOwner owner = audioOwner.load();
  const bool feedback = owner == AudioOwner::kNetwork && feedbackActivitySeen.load() &&
    uint32_t(millis() - feedbackChangedAt.load()) < kFeedbackTailMs;
  const bool currentStreamReady =
    (owner == AudioOwner::kNetwork && audioStreamReady.load() && !audioSeekPending.load()) ||
    (owner == AudioOwner::kStaticLocalFile && staticStreamReady.load());
  // This callback runs on the one decoder/I2S task. Replace, never mix, the
  // network PCM with the same low-amplitude local noise on small dial moves.
  // No filesystem, HTTP, allocation, Audio calls or Serial in this callback.
  static RadioTuningNoise feedbackNoise;
  static uint32_t feedbackSample = 0;
  if (feedback && samples && validSamples > 0) {
    for (int i = 0; i < validSamples; i += 2) {
      const int32_t noise = int32_t(feedbackNoise.sample(feedbackSample)) * 65536;
      samples[i] = noise;
      if (i + 1 < validSamples) samples[i + 1] = noise;
      feedbackSample = (feedbackSample + 1) % kTuningSamples;
    }
  } else {
    feedbackSample = 0;
    if (!currentStreamReady && samples && validSamples > 0)
      memset(samples, 0, size_t(validSamples) * sizeof(*samples));
  }
  if (validSamples > 0 && owner == AudioOwner::kNetwork && currentStreamReady && !feedback) {
    audioProducedSamples.store(true);
    if (!displaySeekWaiting.load()) {
      displayProducedSamples.store(true);
      if (samples) startTiming.claimPcm(millis());
    }
  }
  if (validSamples > 0 && owner == AudioOwner::kStaticLocalFile && staticStreamReady.load())
    staticProducedSamples.store(true);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("Cosmic Radio Device boot");
  if (!radioDisplay.begin()) Serial.println("display unavailable: frame allocation failed");
  renderDisplay(displayModel);
  Audio::audio_info_callback = onAudioInfo;

  // Network and local static share this one Audio object and I2S output.
  networkAudio.setPinout(kI2SBclkPin, kI2SLrcPin, kI2SDinPin);
  networkAudio.setConnectionTimeout(8'000, 15'000);
  networkAudio.setVolume(kNetworkVolume);
  setupControls();
  setupTuningWav();

  displayModel.setStatus(RadioDisplayStatus::Connecting);
  renderDisplay(displayModel);
  if (!connectWifi()) {
    receiverState = ReceiverState::kWifiFailed;
    displayModel.setStatus(RadioDisplayStatus::NoNetwork);
    renderDisplay(displayModel);
    Serial.println("Wi-Fi diagnostic idle; no automatic reboot or tune retry.");
    return;
  }

  setupManifestPrefetch();

  acknowledgedTuneRevision = readTuneInput().revision;
  handledActivityRevision = readTuneInput().activityRevision;
  tuneOnce(acknowledgedTuneRevision);
}

void loop() {
  pollManifestPrefetch();
  updateControls();
  updateDisplay();
  updateLocalStatic();
  updateForegroundTune();
  if (receiverState == ReceiverState::kPlaying) updatePlayback();
  updateAutomaticAdvance();
  updateManifestPrefetch();
  updateWifiDiagnostics();
  updateDisplay();
  vTaskDelay(1);
}
