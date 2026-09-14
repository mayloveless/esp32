#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <Audio.h>

#include <cstring>

#include "secrets.h"

namespace {

constexpr uint8_t kI2SBclkPin = 4;
constexpr uint8_t kI2SLrcPin = 5;
constexpr uint8_t kI2SDinPin = 6;
constexpr uint32_t kWifiConnectTimeoutMs = 15'000;
constexpr uint32_t kAudioStartTimeoutMs = 15'000;

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
bool audioWasRunning = false;
bool naturalAudioEof = false;
uint32_t audioStartMillis = 0;

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

bool connectWifi() {
  Serial.println("Wi-Fi connecting");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const uint32_t startedAt = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - startedAt >= kWifiConnectTimeoutMs) {
      Serial.printf("Wi-Fi failed after %lu ms\n", kWifiConnectTimeoutMs);
      return false;
    }
    delay(500);
  }

  Serial.print("Wi-Fi connected: ");
  Serial.println(WiFi.localIP());
  return true;
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
    Serial.printf("completed request failed: HTTP %d\n", status);
  request.end();
}

void startManifestPlayback(JsonObjectConst manifest) {
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
  if (startOffsetMs > 0) {
    Serial.printf(
      "startOffsetMs received: %lu; Task 008 intentionally plays from 0 ms.\n",
      startOffsetMs,
    );
  }
  Serial.print("audio stream: ");
  Serial.println(summarizeAudioUrl(audioUrl));

  // Audio.connecttohost() 独占 HTTP(S) 流式读取、解码和唯一的 I2S 输出；
  // sketch 只交付当前 signed URL，绝不会把整条音频下载进 RAM 或 PSRAM。
  if (!networkAudio.connecttohost(audioUrl)) {
    Serial.println("audio playback failed to start");
    currentProgramId = "";
    receiverState = ReceiverState::kIdle;
    return;
  }

  naturalAudioEof = false;
  audioWasRunning = false;
  audioStartMillis = millis();
  receiverState = ReceiverState::kPlaying;
  Serial.println("audio playback started");
}

void tuneOnce() {
  receiverState = ReceiverState::kTuning;
  Serial.println("tune request");

  WiFiClient client;
  HTTPClient request;
  if (!request.begin(client, deviceApiUrl("/api/device/receiver/tune"))) {
    Serial.println("tune request failed to start");
    receiverState = ReceiverState::kIdle;
    return;
  }

  request.setConnectTimeout(8'000);
  request.setTimeout(10'000);
  request.addHeader("Authorization", String("Bearer ") + DEVICE_API_TOKEN);
  request.addHeader("Content-Type", "application/json");
  const int status = request.POST("{\"excludeProgramIds\":[]}");
  if (status < 200 || status >= 300) {
    Serial.printf("tune request failed: HTTP %d\n", status);
    request.end();
    receiverState = ReceiverState::kIdle;
    return;
  }

  // 只从小型 Device manifest 流中保留播放所需字段；captions 不会进入 ESP32 内存。
  JsonDocument filter;
  filter["result"] = true;
  filter["manifest"]["programId"] = true;
  filter["manifest"]["title"] = true;
  filter["manifest"]["signalKind"] = true;
  filter["manifest"]["audioUrl"] = true;
  filter["manifest"]["startOffsetMs"] = true;
  JsonDocument response;
  const DeserializationError error = deserializeJson(
    response,
    *request.getStreamPtr(),
    DeserializationOption::Filter(filter),
    DeserializationOption::NestingLimit(4),
  );
  request.end();

  if (error) {
    Serial.print("tune response JSON failed: ");
    Serial.println(error.c_str());
    receiverState = ReceiverState::kIdle;
    return;
  }

  const char* result = response["result"] | "";
  if (strcmp(result, "no_signal") == 0) {
    Serial.println("no_signal");
    receiverState = ReceiverState::kIdle;
    return;
  }
  if (strcmp(result, "signal") != 0 || !response["manifest"].is<JsonObject>()) {
    Serial.println("tune response has an unknown result");
    receiverState = ReceiverState::kIdle;
    return;
  }

  startManifestPlayback(response["manifest"].as<JsonObjectConst>());
}

void onAudioInfo(Audio::msg_t message) {
  if (message.e == Audio::evt_eof) naturalAudioEof = true;
}

void updatePlayback() {
  networkAudio.loop();

  if (receiverState != ReceiverState::kPlaying) return;
  if (networkAudio.isRunning()) audioWasRunning = true;

  if (naturalAudioEof) {
    naturalAudioEof = false;
    const String completedProgramId = currentProgramId;
    currentProgramId = "";
    receiverState = ReceiverState::kIdle;
    Serial.println("audio playback completed");
    sendCompleted(completedProgramId);
    return;
  }

  if (
    (audioWasRunning && !networkAudio.isRunning()) ||
    (!audioWasRunning && millis() - audioStartMillis >= kAudioStartTimeoutMs)
  ) {
    Serial.println("audio playback failed");
    currentProgramId = "";
    receiverState = ReceiverState::kIdle;
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("Cosmic Radio Device boot");
  Audio::audio_info_callback = onAudioInfo;

  // Task 008 只有 NETWORK_AUDIO 这一条 I2S 输出路径。
  networkAudio.setPinout(kI2SBclkPin, kI2SLrcPin, kI2SDinPin);
  networkAudio.setConnectionTimeout(8'000, 15'000);
  networkAudio.setVolume(15);

  if (!connectWifi()) {
    receiverState = ReceiverState::kWifiFailed;
    Serial.println("Wi-Fi diagnostic idle; no automatic reboot or tune retry.");
    return;
  }

  tuneOnce();
}

void loop() {
  if (receiverState == ReceiverState::kPlaying) updatePlayback();
  vTaskDelay(1);
}
