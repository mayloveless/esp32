#include <Arduino.h>
#include <ESP_I2S.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <math.h>
#include "esp_timer.h"

/**
 * Minimal drum machine for ESP32-S3.
 *
 * Current hardware:
 * - EC11: rotate = BPM, press = start / stop
 * - MAX98357A: I2S audio output
 *
 * Not used yet:
 * - external button
 * - WS2812
 * - TFT
 */

// =====================
// Pin config
// =====================

// MAX98357A
#define I2S_BCLK 4
#define I2S_LRC  5
#define I2S_DIN  6

// EC11
#define ENCODER_CLK 7
#define ENCODER_DT  15
#define ENCODER_KEY 16

// =====================
// WiFi / WebSocket config
// =====================

// Fill these in before uploading. Keep the ESP32 and browser on the same LAN.
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 15000;
constexpr uint16_t WEBSOCKET_PORT = 81;
constexpr char MDNS_HOSTNAME[] = "esp32-drum";
constexpr char WIFI_PREFERENCES_NAMESPACE[] = "drum-wifi";
WebSocketsServer webSocket(WEBSOCKET_PORT);
bool webSocketStarted = false;
Preferences wifiPreferences;
String activeSsid;
String activePassword;

// =====================
// Drum config
// =====================

constexpr int SAMPLE_RATE = 32000;
constexpr int AUDIO_BLOCK_FRAMES = 128;
constexpr int STEPS_PER_BAR = 16;
constexpr int BPM_MIN = 40;
constexpr int BPM_MAX = 240;
constexpr int BPM_STEP = 5;

struct DrumPattern {
  bool kick[STEPS_PER_BAR];
  bool snare[STEPS_PER_BAR];
  bool hihat[STEPS_PER_BAR];
};

struct DrumState {
  int bpm;
  DrumPattern pattern;
  bool playing;
  int currentStep;
};

// Basic 4/4 pattern: kick on 1/3, snare on 2/4, closed hat on eighth notes.
DrumState drumState = {
  120,
  {
    { true, false, false, false, false, false, false, false,
      true, false, false, false, false, false, false, false },
    { false, false, false, false, true, false, false, false,
      false, false, false, false, true, false, false, false },
    { true, false, true, false, true, false, true, false,
      true, false, true, false, true, false, true, false }
  },
  false,
  0
};

// =====================
// Audio engine
// =====================

enum DrumVoiceType : uint8_t {
  DRUM_KICK,
  DRUM_SNARE,
  DRUM_HIHAT
};

struct DrumTrigger {
  DrumVoiceType type;
};

struct SynthVoice {
  bool active = false;
  uint32_t age = 0;
  float phase = 0.0f;
};

I2SClass i2s;
QueueHandle_t audioQueue = nullptr;
bool audioReady = false;

SynthVoice kickVoice;
SynthVoice snareVoice;
SynthVoice hihatVoice;

uint32_t noiseState = 0x12345678;
float previousNoise = 0.0f;

float nextNoise() {
  noiseState = noiseState * 1664525u + 1013904223u;
  return ((int32_t)(noiseState >> 8) / 8388608.0f) - 1.0f;
}

void startVoice(DrumVoiceType type) {
  SynthVoice* voice = nullptr;

  switch (type) {
    case DRUM_KICK:  voice = &kickVoice; break;
    case DRUM_SNARE: voice = &snareVoice; break;
    case DRUM_HIHAT: voice = &hihatVoice; break;
  }

  if (voice) {
    voice->active = true;
    voice->age = 0;
    voice->phase = 0.0f;
  }
}

float renderKick() {
  if (!kickVoice.active) return 0.0f;

  float t = (float)kickVoice.age / SAMPLE_RATE;
  if (t >= 0.28f) {
    kickVoice.active = false;
    return 0.0f;
  }

  // Fast pitch drop gives the characteristic kick "thump".
  float frequency = 52.0f + 115.0f * expf(-24.0f * t);
  float envelope = expf(-13.0f * t);

  kickVoice.phase += 2.0f * PI * frequency / SAMPLE_RATE;
  if (kickVoice.phase >= 2.0f * PI) kickVoice.phase -= 2.0f * PI;

  kickVoice.age++;
  return sinf(kickVoice.phase) * envelope * 0.95f;
}

float renderSnare() {
  if (!snareVoice.active) return 0.0f;

  float t = (float)snareVoice.age / SAMPLE_RATE;
  if (t >= 0.20f) {
    snareVoice.active = false;
    return 0.0f;
  }

  float envelope = expf(-20.0f * t);
  float noise = nextNoise();

  snareVoice.phase += 2.0f * PI * 180.0f / SAMPLE_RATE;
  if (snareVoice.phase >= 2.0f * PI) snareVoice.phase -= 2.0f * PI;

  float body = sinf(snareVoice.phase) * 0.25f;

  snareVoice.age++;
  return (noise * 0.75f + body) * envelope * 0.72f;
}

float renderHihat() {
  if (!hihatVoice.active) return 0.0f;

  float t = (float)hihatVoice.age / SAMPLE_RATE;
  if (t >= 0.055f) {
    hihatVoice.active = false;
    return 0.0f;
  }

  float envelope = expf(-65.0f * t);
  float noise = nextNoise();

  // Crude high-pass effect: emphasize rapid changes in the noise.
  float brightNoise = noise - previousNoise * 0.85f;
  previousNoise = noise;

  hihatVoice.age++;
  return brightNoise * envelope * 0.28f;
}

int16_t limitSample(float sample) {
  sample = constrain(sample, -1.0f, 1.0f);
  return (int16_t)(sample * 12000.0f);
}

void audioTask(void* parameter) {
  int16_t buffer[AUDIO_BLOCK_FRAMES * 2]; // stereo: L/R carry the same mono mix

  while (true) {
    DrumTrigger trigger;
    while (xQueueReceive(audioQueue, &trigger, 0) == pdTRUE) {
      startVoice(trigger.type);
    }

    for (int frame = 0; frame < AUDIO_BLOCK_FRAMES; frame++) {
      float mixed = 0.0f;
      mixed += renderKick();
      mixed += renderSnare();
      mixed += renderHihat();

      int16_t sample = limitSample(mixed);
      buffer[frame * 2] = sample;
      buffer[frame * 2 + 1] = sample;
    }

    i2s.write((uint8_t*)buffer, sizeof(buffer));
  }
}

void audioBegin() {
  audioQueue = xQueueCreate(24, sizeof(DrumTrigger));
  if (!audioQueue) {
    Serial.println("Audio queue init FAILED");
    return;
  }

  i2s.setPins(I2S_BCLK, I2S_LRC, I2S_DIN);

  audioReady = i2s.begin(
    I2S_MODE_STD,
    SAMPLE_RATE,
    I2S_DATA_BIT_WIDTH_16BIT,
    I2S_SLOT_MODE_STEREO
  );

  if (!audioReady) {
    Serial.println("Audio init FAILED");
    return;
  }

  xTaskCreatePinnedToCore(
    audioTask,
    "audio_render",
    6144,
    nullptr,
    5,
    nullptr,
    0
  );

  Serial.println("Audio init OK");
}

void triggerDrum(DrumVoiceType type) {
  if (!audioReady || !audioQueue) return;

  DrumTrigger trigger{type};
  xQueueSend(audioQueue, &trigger, 0);
}

// =====================
// Encoder
// =====================

int lastCLK = HIGH;
bool lastKey = HIGH;
uint32_t lastClickMs = 0;

// =====================
// Sequencer
// =====================

int scheduledStep = 0;
int64_t nextStepAtUs = 0;

void broadcastState();

int64_t stepIntervalUs() {
  // 16th note: quarter-note duration / 4.
  return 60000000LL / ((int64_t)drumState.bpm * 4LL);
}

void printStep(int step, bool kick, bool snare, bool hihat) {
  Serial.printf("Step %02d |", step + 1);
  if (kick)  Serial.print(" KICK");
  if (snare) Serial.print(" SNARE");
  if (hihat) Serial.print(" HH");
  if (!kick && !snare && !hihat) Serial.print(" -");
  Serial.println();
}

void triggerStep(int step) {
  bool kick = drumState.pattern.kick[step];
  bool snare = drumState.pattern.snare[step];
  bool hihat = drumState.pattern.hihat[step];

  printStep(step, kick, snare, hihat);

  if (kick) triggerDrum(DRUM_KICK);
  if (snare) triggerDrum(DRUM_SNARE);
  if (hihat) triggerDrum(DRUM_HIHAT);
}

void startSequencer() {
  drumState.playing = true;
  drumState.currentStep = 0;
  scheduledStep = 0;
  nextStepAtUs = esp_timer_get_time();

  Serial.printf("DRUM START | BPM %d\n", drumState.bpm);
  broadcastState();
}

void stopSequencer() {
  drumState.playing = false;
  Serial.println("DRUM STOP");
  broadcastState();
}

void updateSequencer() {
  if (!drumState.playing) return;

  int64_t now = esp_timer_get_time();

  // Use an absolute timeline instead of delay(), so processing time does not
  // accumulate into the beat timing.
  while (drumState.playing && now >= nextStepAtUs) {
    drumState.currentStep = scheduledStep;
    triggerStep(drumState.currentStep);
    broadcastState();
    scheduledStep = (scheduledStep + 1) % STEPS_PER_BAR;
    nextStepAtUs += stepIntervalUs();
  }
}

void updateEncoder() {
  int clk = digitalRead(ENCODER_CLK);

  if (clk != lastCLK && clk == LOW) {
    if (digitalRead(ENCODER_DT) != clk) {
      drumState.bpm += BPM_STEP;
    } else {
      drumState.bpm -= BPM_STEP;
    }

    drumState.bpm = constrain(drumState.bpm, BPM_MIN, BPM_MAX);
    Serial.printf("BPM: %d\n", drumState.bpm);
    broadcastState();
  }

  lastCLK = clk;

  bool key = digitalRead(ENCODER_KEY);
  uint32_t nowMs = millis();

  if (lastKey == HIGH && key == LOW && nowMs - lastClickMs > 180) {
    lastClickMs = nowMs;

    if (drumState.playing) stopSequencer();
    else startSequencer();
  }

  lastKey = key;
}

// =====================
// WebSocket state API
// =====================

void writeTrack(JsonArray target, const bool* source) {
  for (int step = 0; step < STEPS_PER_BAR; step++) {
    target.add(source[step]);
  }
}

String stateMessage() {
  DynamicJsonDocument document(1536);
  document["type"] = "state_sync";
  JsonObject data = document.createNestedObject("data");
  data["bpm"] = drumState.bpm;
  data["playing"] = drumState.playing;
  data["currentStep"] = drumState.currentStep;
  JsonObject pattern = data.createNestedObject("pattern");
  writeTrack(pattern.createNestedArray("kick"), drumState.pattern.kick);
  writeTrack(pattern.createNestedArray("snare"), drumState.pattern.snare);
  writeTrack(pattern.createNestedArray("hihat"), drumState.pattern.hihat);

  String message;
  serializeJson(document, message);
  return message;
}

void sendState(uint8_t clientNumber) {
  String message = stateMessage();
  webSocket.sendTXT(clientNumber, message);
}

void broadcastState() {
  String message = stateMessage();
  webSocket.broadcastTXT(message);
}

bool copyTrack(JsonArray source, bool* destination) {
  if (source.isNull() || source.size() != STEPS_PER_BAR) return false;

  for (int step = 0; step < STEPS_PER_BAR; step++) {
    if (!source[step].is<bool>()) return false;
    destination[step] = source[step].as<bool>();
  }

  return true;
}

bool parseBpm(JsonVariant value, int& destination) {
  if (!value.is<int>()) return false;

  int bpm = value.as<int>();
  if (bpm < BPM_MIN || bpm > BPM_MAX) return false;
  destination = bpm;
  return true;
}

bool parsePattern(JsonObject data, DrumPattern& destination) {
  return copyTrack(data["kick"].as<JsonArray>(), destination.kick) &&
         copyTrack(data["snare"].as<JsonArray>(), destination.snare) &&
         copyTrack(data["hihat"].as<JsonArray>(), destination.hihat);
}

bool parseWiFiCredentials(JsonObject data, String& nextSsid, String& nextPassword) {
  if (!data["ssid"].is<const char*>() || !data["password"].is<const char*>()) return false;

  nextSsid = data["ssid"].as<const char*>();
  nextPassword = data["password"].as<const char*>();
  return !nextSsid.isEmpty() && nextSsid.length() <= 32 && nextPassword.length() <= 63;
}

void saveWiFiCredentials(const String& nextSsid, const String& nextPassword) {
  wifiPreferences.begin(WIFI_PREFERENCES_NAMESPACE, false);
  wifiPreferences.putString("ssid", nextSsid);
  wifiPreferences.putString("password", nextPassword);
  wifiPreferences.end();
}

void handleWebSocketMessage(uint8_t clientNumber, uint8_t* payload, size_t length) {
  DynamicJsonDocument document(1024);
  DeserializationError error = deserializeJson(document, payload, length);

  if (error) {
    Serial.printf("WebSocket client %u sent invalid JSON\n", clientNumber);
    return;
  }

  const char* type = document["type"];
  JsonObject data = document["data"].as<JsonObject>();
  if (!type || data.isNull()) {
    Serial.printf("WebSocket client %u sent an invalid message envelope\n", clientNumber);
    return;
  }

  if (strcmp(type, "get_state") == 0) {
    sendState(clientNumber);
    return;
  }

  if (strcmp(type, "set_bpm") == 0) {
    int nextBpm;
    if (!parseBpm(data["bpm"], nextBpm)) {
      Serial.println("Rejected WebSocket set_bpm message");
      return;
    }
    drumState.bpm = nextBpm;
    broadcastState();
    return;
  }

  if (strcmp(type, "set_pattern") == 0) {
    DrumPattern nextPattern;
    int nextBpm;
    if (!parseBpm(data["bpm"], nextBpm) || !parsePattern(data, nextPattern)) {
      Serial.println("Rejected WebSocket set_pattern message");
      return;
    }
    drumState.bpm = nextBpm;
    drumState.pattern = nextPattern;
    broadcastState();
    return;
  }

  if (strcmp(type, "toggle_step") == 0) {
    const char* track = data["track"];
    int step = data["step"] | -1;
    if (!track || step < 0 || step >= STEPS_PER_BAR) {
      Serial.println("Rejected WebSocket toggle_step message");
      return;
    }

    bool* trackSteps = nullptr;
    if (strcmp(track, "kick") == 0) trackSteps = drumState.pattern.kick;
    else if (strcmp(track, "snare") == 0) trackSteps = drumState.pattern.snare;
    else if (strcmp(track, "hihat") == 0) trackSteps = drumState.pattern.hihat;

    if (!trackSteps) {
      Serial.println("Rejected WebSocket toggle_step track");
      return;
    }

    trackSteps[step] = !trackSteps[step];
    broadcastState();
    return;
  }

  if (strcmp(type, "set_playing") == 0) {
    if (!data["playing"].is<bool>()) {
      Serial.println("Rejected WebSocket set_playing message");
      return;
    }

    bool shouldPlay = data["playing"].as<bool>();
    if (shouldPlay && !drumState.playing) startSequencer();
    else if (!shouldPlay && drumState.playing) stopSequencer();
    else broadcastState();
    return;
  }

  if (strcmp(type, "set_wifi") == 0) {
    String nextSsid;
    String nextPassword;
    if (!parseWiFiCredentials(data, nextSsid, nextPassword)) {
      Serial.println("Rejected WebSocket set_wifi message");
      return;
    }

    saveWiFiCredentials(nextSsid, nextPassword);
    Serial.printf("WiFi settings saved for SSID: %s; restarting\n", nextSsid.c_str());
    broadcastState();
    delay(200);
    ESP.restart();
    return;
  }

  Serial.printf("Unknown WebSocket message type: %s\n", type);
}

void webSocketEvent(uint8_t clientNumber, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.printf("WebSocket client %u connected\n", clientNumber);
      sendState(clientNumber);
      break;
    case WStype_DISCONNECTED:
      Serial.printf("WebSocket client %u disconnected\n", clientNumber);
      break;
    case WStype_TEXT:
      handleWebSocketMessage(clientNumber, payload, length);
      break;
    default:
      break;
  }
}

void wifiBegin() {
  wifiPreferences.begin(WIFI_PREFERENCES_NAMESPACE, true);
  activeSsid = wifiPreferences.getString("ssid", ssid);
  activePassword = wifiPreferences.getString("password", password);
  wifiPreferences.end();

  WiFi.mode(WIFI_STA);
  WiFi.begin(activeSsid.c_str(), activePassword.c_str());
  Serial.print("Connecting to WiFi");

  const uint32_t startedAtMs = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAtMs < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi connection FAILED; WebSocket API disabled");
    return;
  }

  Serial.println("WiFi connected");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  if (MDNS.begin(MDNS_HOSTNAME)) {
    MDNS.addService("ws", "tcp", WEBSOCKET_PORT);
    Serial.printf("mDNS: %s.local\n", MDNS_HOSTNAME);
  } else {
    Serial.println("mDNS start FAILED; use the IP address instead");
  }

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  webSocketStarted = true;
  Serial.printf("WebSocket API ready: ws://%s.local:%u\n", MDNS_HOSTNAME, WEBSOCKET_PORT);
}

// =====================
// Arduino lifecycle
// =====================

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(ENCODER_CLK, INPUT_PULLUP);
  pinMode(ENCODER_DT, INPUT_PULLUP);
  pinMode(ENCODER_KEY, INPUT_PULLUP);

  lastCLK = digitalRead(ENCODER_CLK);
  lastKey = digitalRead(ENCODER_KEY);

  audioBegin();
  wifiBegin();

  Serial.println("Drum Machine Ready");
  Serial.printf("BPM: %d\n", drumState.bpm);
  Serial.println("Rotate = BPM, press = START/STOP");
}

void loop() {
  if (webSocketStarted) webSocket.loop();
  updateEncoder();
  updateSequencer();
  delay(1);
}
