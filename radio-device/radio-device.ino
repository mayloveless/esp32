#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <Audio.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <lwip/etharp.h>
#include <lwip/tcpip.h>

#include <cstring>
#include <atomic>
#include <new>

#include "secrets.h"
#include "controls.h"
#include "ReceiverControls.h"
#include "RadioManifestPrefetch.h"

#ifndef WIFI_GATEWAY_MAC
#define WIFI_GATEWAY_MAC ""
#endif

namespace {

constexpr uint8_t kI2SBclkPin = 4;
constexpr uint8_t kI2SLrcPin = 5;
constexpr uint8_t kI2SDinPin = 6;
constexpr uint32_t kWifiConnectTimeoutMs = 15'000;
constexpr uint32_t kAudioStartTimeoutMs = 15'000;
constexpr uint32_t kAudioStallTimeoutMs = 30'000;

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
bool audioStreamReady = false;
bool audioStopPending = false;
std::atomic<bool> audioProducedSamples{false};
std::atomic<bool> audioError{false};
std::atomic<bool> audioSeekPending{false};
uint32_t audioSeekSeconds = 0;
uint32_t audioStartMillis = 0;
uint32_t audioProgressMillis = 0;
uint32_t lastAudioPosition = 0;

void prepareStartOffset(uint32_t offsetMs) {
  audioSeekSeconds = offsetMs / 1000;
  audioSeekPending.store(offsetMs > 0);
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
String recentProgramIds[2];
uint8_t recentProgramCount = 0;

struct ManifestPrefetchJob {
  String body;
  uint32_t generation = 0;
  uint32_t startedAt = 0;
  uint32_t lifetimeMs = 0;
  int status = 0;
  bool parsed = false;
  JsonDocument response;
};

void fetchPrefetchJob(ManifestPrefetchJob& job);

QueueHandle_t prefetchJobs = nullptr;
QueueHandle_t prefetchResults = nullptr;
ManifestPrefetchJob* prefetchedManifest = nullptr;
uint32_t prefetchGeneration = 0;
bool prefetchBusy = false;
bool prefetchAttempted = false;

void startManifestPlayback(JsonObjectConst manifest, uint32_t requestedRevision);

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
  startManifestPlayback(manifest, requestedRevision);
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
  if (encoder.sample(phase, now)) tuneInput.request(now);
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
      receiverState != ReceiverState::kPlaying || !audioStreamReady ||
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

void stopForTuning() {
  // User interruption is never a completed program. Clear queued EOF state;
  // the next connecttohost() resets the library's old stream and decoder.
  networkAudio.stopSong();
  // 4.0.0 retains its info queue across connections. Drain the old stopped
  // stream before resetting flags so its EOF/error cannot affect a new one.
  networkAudio.loop();
  currentProgramId = "";
  audioEof = false;
  audioStreamReady = false;
  audioStopPending = false;
  audioProducedSamples.store(false);
  audioError.store(false);
  prepareStartOffset(0);
  lastAudioPosition = 0;
  receiverState = ReceiverState::kTuning;
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

void sendCompleted(const String& programId) {
  WiFiClient client;
  HTTPClient request;
  const String path =
    String("/api/device/receiver/programs/") + programId + "/completed";
  const String endpoint = deviceApiUrl(path.c_str());

  if (!request.begin(client, endpoint)) {
    Serial.println("completed request failed to start");
    return;
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
}

void startManifestPlayback(JsonObjectConst manifest, uint32_t requestedRevision) {
  if (tuneSuperseded(requestedRevision)) return;
  const char* programId = manifest["programId"] | "";
  const char* title = manifest["title"] | "(untitled)";
  const char* signalKind = manifest["signalKind"] | "unknown";
  const char* audioUrl = manifest["audioUrl"] | "";
  const uint32_t startOffsetMs = manifest["startOffsetMs"] | 0;

  if (strlen(programId) == 0 || strlen(audioUrl) == 0) {
    Serial.println("signal manifest is missing programId or audioUrl");
    receiverState = ReceiverState::kIdle;
    return;
  }

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

  // Audio.connecttohost() 独占 HTTP(S) 流式读取、解码和唯一的 I2S 输出；
  // sketch 只交付当前 signed URL，绝不会把整条音频下载进 RAM 或 PSRAM。
  const bool connected = networkAudio.connecttohost(audioUrl);
  if (tuneSuperseded(requestedRevision)) {
    stopForTuning();
    Serial.println("tune superseded while connecting audio");
    return;
  }
  if (!connected) {
    Serial.println("audio playback failed to start");
    currentProgramId = "";
    receiverState = ReceiverState::kIdle;
    return;
  }

  audioStartMillis = millis();
  audioProgressMillis = audioStartMillis;
  rememberProgram(currentProgramId);
  invalidatePrefetch();
  prefetchAttempted = false;
  receiverState = ReceiverState::kPlaying;
  Serial.println("audio playback started");
}

void tuneOnce(uint32_t requestedRevision) {
  if (tuneSuperseded(requestedRevision)) return;
  if (WiFi.status() != WL_CONNECTED) {
    receiverState = ReceiverState::kIdle;
    Serial.println("tune skipped: Wi-Fi is not connected; retry after reconnection");
    return;
  }
  receiverState = ReceiverState::kTuning;
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
    receiverState = ReceiverState::kIdle;
    return;
  }

  request.setConnectTimeout(8'000);
  request.setTimeout(10'000);
  request.addHeader("Authorization", String("Bearer ") + DEVICE_API_TOKEN);
  request.addHeader("Content-Type", "application/json");
  const String payload = tuneRequestBody();
  if (tuneSuperseded(requestedRevision)) {
    request.end();
    receiverState = ReceiverState::kIdle;
    return;
  }
  const int status = request.POST(payload);
  if (tuneSuperseded(requestedRevision)) {
    request.end();
    receiverState = ReceiverState::kIdle;
    Serial.println("tune superseded while requesting manifest");
    return;
  }
  if (status < 200 || status >= 300) {
    reportHttpFailure("tune", status);
    request.end();
    diagnoseGateway();
    receiverState = ReceiverState::kIdle;
    return;
  }

  // 只从小型 Device manifest 流中保留播放所需字段；captions 不会进入 ESP32 内存。
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
    receiverState = ReceiverState::kIdle;
    Serial.println("tune superseded while reading manifest");
    return;
  }

  if (error) {
    Serial.print("tune response JSON failed: ");
    Serial.println(error.c_str());
    receiverState = ReceiverState::kIdle;
    return;
  }

  const char* result = response["result"] | "";
  if (strcmp(result, "no_signal") == 0) {
    Serial.println("no_signal");
    // Keep exclusions on no_signal. A later physical turn may retry once,
    // but never silently relax history or request again automatically.
    receiverState = ReceiverState::kIdle;
    return;
  }
  if (strcmp(result, "signal") != 0 || !response["manifest"].is<JsonObject>()) {
    Serial.println("tune response has an unknown result");
    receiverState = ReceiverState::kIdle;
    return;
  }

  startManifestPlayback(response["manifest"].as<JsonObjectConst>(), requestedRevision);
}

void updateControls() {
  RadioTuneInput input = readTuneInput();
  if (input.revision == acknowledgedTuneRevision) return;
  if (receiverState != ReceiverState::kTuning) {
    Serial.println("encoder activity");
    if (receiverState == ReceiverState::kPlaying)
      Serial.println("manual retune: stop current program");
    stopForTuning();
  }
  // Stopping the old decoder may take time. Re-read activity afterward so a
  // turn during that work cannot trigger a stale request or false settlement.
  input = readTuneInput();
  if (!input.ready(acknowledgedTuneRevision, millis())) return;
  Serial.println("tuning settled");
  acknowledgedTuneRevision = input.revision;
  if (!playPrefetchedManifest(input.revision)) {
    invalidatePrefetch();  // Discard an in-flight result if foreground tune wins.
    tuneOnce(input.revision);
  }
}

void onAudioInfo(Audio::msg_t message) {
  if (message.e == Audio::evt_eof) audioEof = true;
  if (message.e == Audio::evt_info && message.msg &&
      strcmp(message.msg, "stream ready") == 0) audioStreamReady = true;
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
    if (strcmp(message.msg, "radio.seek.new-buffer.result") == 0 && message.arg2 == 1)
      Serial.printf("audio seek applied: position=%ld\n", static_cast<long>(message.arg1));
  }
  // 日志可能从库的解码任务发出；只保存错误标志，不打印含 signed URL 的消息。
  if (message.e == Audio::evt_log && message.s &&
      strcmp(message.s, "LOGE") == 0) audioError.store(true);
}

void failPlayback() {
  Serial.printf("audio failure flags: libraryError=%d WiFi=%d ready=%d seekPending=%d samples=%d running=%d\n",
    audioError.load(), WiFi.status(), audioStreamReady, audioSeekPending.load(),
    audioProducedSamples.load(), networkAudio.isRunning());
  networkAudio.stopSong();
  invalidatePrefetch();
  currentProgramId = "";
  receiverState = ReceiverState::kIdle;
  // A native error can stop playback during loop(), before its queued
  // diagnostic events are dispatched. Drain the stopped stream once.
  networkAudio.loop();
  Serial.println("audio playback failed");
}

void updatePlayback() {
  networkAudio.loop();

  if (receiverState != ReceiverState::kPlaying) return;
  // A turn captured during Audio.loop() must win over an EOF dispatched in
  // that same call. Manual interruption never retires the old program.
  if (tuneSuperseded(acknowledgedTuneRevision)) {
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
    currentProgramId = "";
    receiverState = ReceiverState::kIdle;
    Serial.println("audio playback completed");
    sendCompleted(completedProgramId);
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

// ESP32-audioI2S 的弱回调，在解码任务上执行；不改变样本或 I2S 输出。
void audio_process_raw_samples(int32_t*, int16_t validSamples) {
  if (validSamples > 0 && !audioSeekPending.load()) audioProducedSamples.store(true);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("Cosmic Radio Device boot");
  Audio::audio_info_callback = onAudioInfo;

  // Task 008 只有 NETWORK_AUDIO 这一条 I2S 输出路径。
  networkAudio.setPinout(kI2SBclkPin, kI2SLrcPin, kI2SDinPin);
  networkAudio.setConnectionTimeout(8'000, 15'000);
  networkAudio.setVolume(15);
  setupControls();

  if (!connectWifi()) {
    receiverState = ReceiverState::kWifiFailed;
    Serial.println("Wi-Fi diagnostic idle; no automatic reboot or tune retry.");
    return;
  }

  setupManifestPrefetch();

  acknowledgedTuneRevision = readTuneInput().revision;
  tuneOnce(acknowledgedTuneRevision);
}

void loop() {
  pollManifestPrefetch();
  updateControls();
  if (receiverState == ReceiverState::kPlaying) updatePlayback();
  updateManifestPrefetch();
  updateWifiDiagnostics();
  vTaskDelay(1);
}
