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

struct RadioDisplayModel {
  static constexpr size_t kTitleBytes = 192;
  RadioDisplayStatus status = RadioDisplayStatus::Boot;
  RadioDisplayStatus idleStatus = RadioDisplayStatus::NoSignal;
  char title[kTitleBytes + 1]{};
  char kind[6]{};
  bool dirty = true;

  void setStatus(RadioDisplayStatus next) {
    if (status != next) { status = next; dirty = true; }
  }

  void setIdle(RadioDisplayStatus outcome) {
    idleStatus = outcome;
    setStatus(outcome);
  }

  void selectProgram(const char* newTitle, const char* newKind) {
    char safe[kTitleBytes + 1]{};
    size_t length = 0;
    const char* input = newTitle ? newTitle : "";
    while (*input) {
      uint32_t cp;
      const size_t count = radioTitleCharacter(input, cp);
      const bool replacement = cp == '?' && static_cast<unsigned char>(*input) >= 0x80;
      const size_t copied = replacement ? 1 : count;
      if (length + copied > kTitleBytes) break;
      if (replacement) safe[length++] = '?';
      else if (cp < 0x20 || cp == 0x7f) safe[length++] = ' ';
      else { std::memcpy(safe + length, input, count); length += count; }
      input += count;
    }
    const char* label = "";
    if (newKind) {
      if (!std::strcmp(newKind, "news")) label = "NEWS";
      else if (!std::strcmp(newKind, "chat")) label = "CHAT";
      else if (!std::strcmp(newKind, "alien")) label = "ALIEN";
      else if (!std::strcmp(newKind, "music")) label = "MUSIC";
    }
    if (std::strcmp(title, safe) || std::strcmp(kind, label)) {
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
