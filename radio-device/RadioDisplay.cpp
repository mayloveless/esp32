#include "RadioDisplay.h"
#include <new>

bool RadioDisplay::begin() {
  // Allocate once, after Arduino has initialized memory/PSRAM. An unavailable
  // display must never prevent the existing audio receiver from running.
  frame_ = new (std::nothrow) GFXcanvas16(160, 128);
  if (!frame_ || !frame_->getBuffer()) { delete frame_; frame_ = nullptr; return false; }
  SPI.begin(kTftClockPin, -1, kTftMosiPin, kTftCsPin);
  tft_.initR(INITR_BLACKTAB);
  tft_.setRotation(3); // Landscape flipped 180 degrees to suit the cable routing.
  frame_->setTextWrap(false);
  frame_->setTextSize(1);
  frame_->setTextColor(ST77XX_WHITE);
  titleFont_.begin(*frame_);
  titleFont_.setFont(u8g2_font_wqy12_t_gb2312);
  titleFont_.setFontMode(1);
  titleFont_.setForegroundColor(ST77XX_WHITE);
  return true;
}

void RadioDisplay::text(int16_t y, const char* value) {
  frame_->setCursor(8, y);
  frame_->print(value);
}

uint16_t RadioDisplay::glyph(uint32_t cp) {
  return cp <= 0xffff && u8g2_IsGlyph(&titleFont_.u8g2, uint16_t(cp)) ? uint16_t(cp) : '?';
}

void RadioDisplay::renderIfDirty(RadioDisplayModel& model) {
  if (!frame_ || !model.dirty) return;
  frame_->fillScreen(ST77XX_BLACK);
  text(8, "COSMIC RADIO");
  frame_->drawFastHLine(8, 22, 144, ST77XX_WHITE);
  switch (model.status) {
    case RadioDisplayStatus::Boot: text(42, "BOOTING..."); break;
    case RadioDisplayStatus::Connecting: text(42, "CONNECTING"); break;
    case RadioDisplayStatus::Tuning:
      text(42, "~ TUNING ~"); text(66, "SEARCHING SIGNAL..."); break;
    case RadioDisplayStatus::NoNetwork:
      text(42, "NO NETWORK"); text(66, "TURN TO RETRY"); break;
    case RadioDisplayStatus::NoSignal:
      text(42, "NO SIGNAL"); text(66, "TURN THE DIAL"); break;
    case RadioDisplayStatus::SignalLost:
      text(42, "SIGNAL LOST"); text(66, "TURN TO RETRY"); break;
    case RadioDisplayStatus::Locking:
    case RadioDisplayStatus::Playing: {
      text(32, model.kind);
      char lines[3][RadioDisplayModel::kTitleBytes + 1];
      model.wrapTitle(lines, 144, [this](uint32_t cp) {
        return int(u8g2_GetGlyphWidth(&titleFont_.u8g2, glyph(cp)));
      });
      for (int line = 0; line < 3; ++line) {
        int16_t x = 8;
        const char* input = lines[line];
        while (*input) {
          uint32_t cp;
          input += radioTitleCharacter(input, cp);
          x += titleFont_.drawGlyph(x, 57 + line * 17, glyph(cp));
        }
      }
      if (model.status == RadioDisplayStatus::Playing) {
        frame_->fillCircle(11, 113, 3, ST77XX_WHITE);
        frame_->setCursor(20, 110);
        frame_->print("SIGNAL LOCKED");
      } else text(110, "LOCKING SIGNAL...");
      break;
    }
  }
  // One SPI transfer per changed frame; no intermediate screen clears/glyph
  // transfers, and no calls from the decoder, interrupt or HTTP worker.
  tft_.drawRGBBitmap(0, 0, frame_->getBuffer(), 160, 128);
  model.dirty = false;
}
