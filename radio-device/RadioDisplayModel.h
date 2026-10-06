#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

enum class RadioDisplayStatus : uint8_t {
  Boot, Connecting, Tuning, Locking, Playing, NoNetwork, NoSignal, SignalLost
};

// Decode one valid Unicode scalar. Invalid input advances one byte so a bad
// title cannot hang the foreground loop or leave a partial UTF-8 character.
inline size_t radioTitleCharacter(const char* text, uint32_t& codepoint) {
  const auto* bytes = reinterpret_cast<const unsigned char*>(text);
  if (!bytes[0]) return 0;
  if (bytes[0] < 0x80) { codepoint = bytes[0]; return 1; }
  size_t count = bytes[0] >= 0xc2 && bytes[0] <= 0xdf ? 2 :
    bytes[0] >= 0xe0 && bytes[0] <= 0xef ? 3 :
    bytes[0] >= 0xf0 && bytes[0] <= 0xf4 ? 4 : 0;
  codepoint = count ? bytes[0] & ((1u << (7 - count)) - 1) : '?';
  for (size_t i = 1; i < count; ++i) {
    if ((bytes[i] & 0xc0) != 0x80) { codepoint = '?'; return 1; }
    codepoint = (codepoint << 6) | (bytes[i] & 0x3f);
  }
  if (!count || (count == 3 && codepoint < 0x800) ||
      (count == 4 && codepoint < 0x10000) || codepoint > 0x10ffff ||
      (codepoint >= 0xd800 && codepoint <= 0xdfff)) {
    codepoint = '?'; return 1;
  }
  return count;
}

struct RadioTextCopy {
  size_t bytes;
  bool truncated;
};

inline RadioTextCopy radioCopyText(char* output, size_t capacity, const char* text) {
  const char* input = text ? text : "";
  size_t length = 0;
  while (*input && capacity) {
    uint32_t cp;
    const size_t count = radioTitleCharacter(input, cp);
    const bool replacement = cp == '?' && static_cast<unsigned char>(*input) >= 0x80;
    const size_t copied = replacement ? 1 : count;
    if (length + copied >= capacity) break;
    if (replacement) output[length++] = '?';
    else if (cp < 0x20 || cp == 0x7f) output[length++] = ' ';
    else { std::memcpy(output + length, input, count); length += count; }
    input += count;
  }
  if (capacity) output[length] = '\0';
  return {length, *input != '\0'};
}

struct RadioDisplayModel {
  static constexpr size_t kTitleBytes = 192;
  static constexpr size_t kCaptionLineBytes = 192;
  RadioDisplayStatus status = RadioDisplayStatus::Boot;
  RadioDisplayStatus idleStatus = RadioDisplayStatus::NoSignal;
  char title[kTitleBytes + 1]{};
  char kind[6]{};
  int8_t captionIndex = -1;
  uint16_t captionPage = 0;
  uint16_t captionPages = 0;
  char captionLines[3][kCaptionLineBytes + 1]{};
  char captionSpeaker[49]{};
  bool dirty = true;

  bool captionLayout() const {
    return !std::strcmp(kind, "NEWS") || !std::strcmp(kind, "CHAT") || !std::strcmp(kind, "ALIEN");
  }

  const char* captionLabel() const {
    return !std::strcmp(kind, "ALIEN") ? "译文" : captionLayout() ? "字幕" : "";
  }

  void clearCaption() {
    if (captionIndex < 0) return;
    captionIndex = -1;
    captionPage = captionPages = 0;
    std::memset(captionLines, 0, sizeof(captionLines));
    captionSpeaker[0] = '\0';
    if (status == RadioDisplayStatus::Playing && captionLayout()) dirty = true;
  }

  void setCaption(int8_t index, uint16_t page, uint16_t pages,
                  const char (&lines)[3][kCaptionLineBytes + 1], const char* speaker) {
    if (status != RadioDisplayStatus::Playing || !captionLayout()) { clearCaption(); return; }
    if (captionIndex == index && captionPage == page) return;
    captionIndex = index;
    captionPage = page;
    captionPages = pages;
    std::memcpy(captionLines, lines, sizeof(captionLines));
    radioCopyText(captionSpeaker, sizeof(captionSpeaker), !std::strcmp(kind, "CHAT") ? speaker : "");
    dirty = true;
  }

  void setStatus(RadioDisplayStatus next) {
    if (next != RadioDisplayStatus::Playing) clearCaption();
    if (status != next) { status = next; dirty = true; }
  }

  void setIdle(RadioDisplayStatus outcome) {
    idleStatus = outcome;
    setStatus(outcome);
  }

  void selectProgram(const char* newTitle, const char* newKind) {
    char safe[kTitleBytes + 1]{};
    radioCopyText(safe, sizeof(safe), newTitle);
    const char* label = "";
    if (newKind) {
      if (!std::strcmp(newKind, "news")) label = "NEWS";
      else if (!std::strcmp(newKind, "chat")) label = "CHAT";
      else if (!std::strcmp(newKind, "alien")) label = "ALIEN";
      else if (!std::strcmp(newKind, "music")) label = "MUSIC";
    }
    if (std::strcmp(title, safe) || std::strcmp(kind, label)) {
      clearCaption();
      std::strcpy(title, safe);
      std::strcpy(kind, label);
      // Metadata can arrive while the dial is still turning. It is hidden
      // then; entering LOCKING will draw it once without reflashing TUNING.
      if (status == RadioDisplayStatus::Locking || status == RadioDisplayStatus::Playing)
        dirty = true;
    }
  }

  // Inputs are snapshots from the existing receiver, not another player.
  void update(bool wifi, bool moving, bool tuning, bool manifestReady,
              bool network, bool ready, bool samples, bool seekPending) {
    if (!wifi) setStatus(RadioDisplayStatus::NoNetwork);
    else if (moving) setStatus(RadioDisplayStatus::Tuning);
    else if (network) setStatus(ready && samples && !seekPending
      ? RadioDisplayStatus::Playing : RadioDisplayStatus::Locking);
    else if (tuning) setStatus(manifestReady
      ? RadioDisplayStatus::Locking : RadioDisplayStatus::Tuning);
    else setStatus(idleStatus);
  }

  // Up to three lines, measured by the selected font. No scrolling, heap or
  // splitting inside UTF-8. The renderer decides how unsupported glyphs look.
  template <class Width>
  void wrapTitle(char (&lines)[3][kTitleBytes + 1], int maxWidth, Width width) const {
    std::memset(lines, 0, sizeof(lines));
    const char* input = title;
    for (size_t line = 0; line < 3 && *input; ++line) {
      size_t length = 0;
      int used = 0;
      while (*input) {
        uint32_t cp;
        const size_t count = radioTitleCharacter(input, cp);
        const int advance = width(cp);
        if (used + advance > maxWidth) break;
        std::memcpy(lines[line] + length, input, count);
        length += count;
        used += advance;
        input += count;
      }
    }
  }
};
