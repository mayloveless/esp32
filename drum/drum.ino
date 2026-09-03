#include <Arduino.h>
#include <ESP_I2S.h>
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
// Drum config
// =====================

constexpr int SAMPLE_RATE = 32000;
constexpr int AUDIO_BLOCK_FRAMES = 128;
constexpr int STEPS_PER_BAR = 16;
constexpr int BPM_MIN = 40;
constexpr int BPM_MAX = 240;
constexpr int BPM_STEP = 5;

// Basic 4/4 pattern: kick on 1/3, snare on 2/4, closed hat on eighth notes.
const bool KICK_PATTERN[STEPS_PER_BAR] = {
  true, false, false, false,
  false, false, false, false,
  true, false, false, false,
  false, false, false, false
};

const bool SNARE_PATTERN[STEPS_PER_BAR] = {
  false, false, false, false,
  true, false, false, false,
  false, false, false, false,
  true, false, false, false
};

const bool HIHAT_PATTERN[STEPS_PER_BAR] = {
  true, false, true, false,
  true, false, true, false,
  true, false, true, false,
  true, false, true, false
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

int bpm = 120;
bool playing = false;
int currentStep = 0;
int64_t nextStepAtUs = 0;

int64_t stepIntervalUs() {
  // 16th note: quarter-note duration / 4.
  return 60000000LL / ((int64_t)bpm * 4LL);
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
  bool kick = KICK_PATTERN[step];
  bool snare = SNARE_PATTERN[step];
  bool hihat = HIHAT_PATTERN[step];

  printStep(step, kick, snare, hihat);

  if (kick) triggerDrum(DRUM_KICK);
  if (snare) triggerDrum(DRUM_SNARE);
  if (hihat) triggerDrum(DRUM_HIHAT);
}

void startSequencer() {
  playing = true;
  currentStep = 0;
  nextStepAtUs = esp_timer_get_time();

  Serial.printf("DRUM START | BPM %d\n", bpm);
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
      bpm += BPM_STEP;
    } else {
      bpm -= BPM_STEP;
    }

    bpm = constrain(bpm, BPM_MIN, BPM_MAX);
    Serial.printf("BPM: %d\n", bpm);
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

  Serial.println("Drum Machine Ready");
  Serial.printf("BPM: %d\n", bpm);
  Serial.println("Rotate = BPM, press = START/STOP");
}

void loop() {
  updateEncoder();
  updateSequencer();
  delay(1);
}
