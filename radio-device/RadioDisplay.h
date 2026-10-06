#pragma once

#include <Adafruit_ST7735.h>
#include <U8g2_for_Adafruit_GFX.h>
#include "RadioDisplayModel.h"
#include "controls.h"

constexpr uint8_t kTftCsPin = 10;
constexpr uint8_t kTftResetPin = 8;
constexpr uint8_t kTftDcPin = 9;
constexpr uint8_t kTftMosiPin = 11;
constexpr uint8_t kTftClockPin = 12;

constexpr bool radioDisplayPinsValid() {
  constexpr uint8_t pins[] = {kTftCsPin, kTftResetPin, kTftDcPin, kTftMosiPin, kTftClockPin};
  for (size_t i = 0; i < sizeof(pins); ++i) {
    if (pins[i] == 4 || pins[i] == 5 || pins[i] == 6 ||
        pins[i] == RADIO_ENCODER_CLK || pins[i] == RADIO_ENCODER_DT ||
        pins[i] == RADIO_ENCODER_SW) return false;
    for (size_t j = i + 1; j < sizeof(pins); ++j)
      if (pins[i] == pins[j]) return false;
  }
  return true;
}
static_assert(radioDisplayPinsValid(), "TFT pins must be distinct and separate from I2S/EC11");

class RadioDisplay {
 public:
  bool begin();
  void renderIfDirty(RadioDisplayModel& model);
  int glyphWidth(uint32_t cp);
 private:
  Adafruit_ST7735 tft_{&SPI, kTftCsPin, kTftDcPin, kTftResetPin};
  GFXcanvas16* frame_ = nullptr;
  U8G2_FOR_ADAFRUIT_GFX titleFont_;
  uint16_t glyph(uint32_t cp);
  void text(int16_t y, const char* value);
  void unicodeLine(int16_t x, int16_t baseline, const char* value, int width);
  void captionView(const RadioDisplayModel& model);
};
