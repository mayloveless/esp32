#include <Arduino.h>
#include <ESP_I2S.h>
#include <math.h>

// MAX98357A
#define I2S_BCLK 4
#define I2S_LRC  5
#define I2S_DIN  6

// EC11
#define ENCODER_CLK 7
#define ENCODER_DT  15
#define ENCODER_KEY 16

AudioEngine_PLACEHOLDER
