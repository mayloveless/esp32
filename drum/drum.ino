#include <Arduino.h>
#include <ESP_I2S.h>
#include <WiFi.h>
#include <WebServer.h>
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
// WiFi / HTTP config
// =====================

// Fill these in before uploading. Keep the ESP32 and browser on the same LAN.
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 15000;
WebServer server(80);
bool httpServerStarted = false;

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
  int bpm;
  bool kick[STEPS_PER_BAR];
  bool snare[STEPS_PER_BAR];
  bool hihat[STEPS_PER_BAR];
};

// Basic 4/4 pattern: kick on 1/3, snare on 2/4, closed hat on eighth notes.
DrumPattern pattern = {
  120,
  { true, false, false, false, false, false, false, false,
    true, false, false, false, false, false, false, false },
  { false, false, false, false, true, false, false, false,
    false, false, false, false, true, false, false, false },
  { true, false, true, false, true, false, true, false,
    true, false, true, false, true, false, true, false }
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

bool playing = false;
int currentStep = 0;
int64_t nextStepAtUs = 0;

int64_t stepIntervalUs() {
  // 16th note: quarter-note duration / 4.
  return 60000000LL / ((int64_t)pattern.bpm * 4LL);
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
  bool kick = pattern.kick[step];
  bool snare = pattern.snare[step];
  bool hihat = pattern.hihat[step];

  printStep(step, kick, snare, hihat);

  if (kick) triggerDrum(DRUM_KICK);
  if (snare) triggerDrum(DRUM_SNARE);
  if (hihat) triggerDrum(DRUM_HIHAT);
}

void startSequencer() {
  playing = true;
  currentStep = 0;
  nextStepAtUs = esp_timer_get_time();

  Serial.printf("DRUM START | BPM %d\n", pattern.bpm);
}

void stopSequencer() {
  playing = false;
  Serial.println("DRUM STOP");
}

void updateSequencer() {
  if (!playing) return;

  int64_t now = esp_timer_get_time();

  // Use an absolute timeline instead of delay(), so processing time does not
  // accumulate into the beat timing.
  while (playing && now >= nextStepAtUs) {
    triggerStep(currentStep);
    currentStep = (currentStep + 1) % STEPS_PER_BAR;
    nextStepAtUs += stepIntervalUs();
  }
}

void updateEncoder() {
  int clk = digitalRead(ENCODER_CLK);

  if (clk != lastCLK && clk == LOW) {
    if (digitalRead(ENCODER_DT) != clk) {
      pattern.bpm += BPM_STEP;
    } else {
      pattern.bpm -= BPM_STEP;
    }

    pattern.bpm = constrain(pattern.bpm, BPM_MIN, BPM_MAX);
    Serial.printf("BPM: %d\n", pattern.bpm);
  }

  lastCLK = clk;

  bool key = digitalRead(ENCODER_KEY);
  uint32_t nowMs = millis();

  if (lastKey == HIGH && key == LOW && nowMs - lastClickMs > 180) {
    lastClickMs = nowMs;

    if (playing) stopSequencer();
    else startSequencer();
  }

  lastKey = key;
}

// =====================
// HTTP pattern API
// =====================

void addCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void sendApiError(int statusCode, const char* message) {
  addCorsHeaders();
  String body = String("{\"ok\":false,\"error\":\"") + message + "\"}";
  server.send(statusCode, "application/json", body);
}

bool copyTrack(JsonArray source, bool* destination) {
  if (source.isNull() || source.size() != STEPS_PER_BAR) return false;

  for (int step = 0; step < STEPS_PER_BAR; step++) {
    if (!source[step].is<bool>()) return false;
    destination[step] = source[step].as<bool>();
  }

  return true;
}

void handlePatternOptions() {
  addCorsHeaders();
  server.send(204, "text/plain", "");
}

void handlePatternPost() {
  const String body = server.arg("plain");
  DynamicJsonDocument document(1024);
  DeserializationError error = deserializeJson(document, body);

  if (error) {
    sendApiError(400, "Invalid JSON");
    return;
  }

  JsonVariant bpmValue = document["bpm"];
  if (!bpmValue.is<int>()) {
    sendApiError(400, "bpm must be an integer");
    return;
  }

  DrumPattern nextPattern;
  nextPattern.bpm = bpmValue.as<int>();
  if (nextPattern.bpm < BPM_MIN || nextPattern.bpm > BPM_MAX) {
    sendApiError(400, "bpm must be between 40 and 240");
    return;
  }

  if (!copyTrack(document["kick"].as<JsonArray>(), nextPattern.kick) ||
      !copyTrack(document["snare"].as<JsonArray>(), nextPattern.snare) ||
      !copyTrack(document["hihat"].as<JsonArray>(), nextPattern.hihat)) {
    sendApiError(400, "kick, snare and hihat must have 16 booleans");
    return;
  }

  // This runs in the Arduino loop, as does updateSequencer(). The audio task
  // only consumes trigger messages, so replacing the pattern cannot interrupt it.
  pattern = nextPattern;

  Serial.print("Received pattern: ");
  serializeJson(document, Serial);
  Serial.println();
  Serial.printf("Pattern updated | BPM %d\n", pattern.bpm);

  addCorsHeaders();
  server.send(200, "application/json", String("{\"ok\":true,\"bpm\":") + pattern.bpm + "}");
}

void wifiBegin() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");

  const uint32_t startedAtMs = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAtMs < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi connection FAILED; HTTP API disabled");
    return;
  }

  Serial.println("WiFi connected");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  server.on("/api/pattern", HTTP_OPTIONS, handlePatternOptions);
  server.on("/api/pattern", HTTP_POST, handlePatternPost);
  server.begin();
  httpServerStarted = true;
  Serial.println("HTTP API ready: POST /api/pattern");
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
  Serial.printf("BPM: %d\n", pattern.bpm);
  Serial.println("Rotate = BPM, press = START/STOP");
}

void loop() {
  if (httpServerStarted) server.handleClient();
  updateEncoder();
  updateSequencer();
  delay(1);
}
