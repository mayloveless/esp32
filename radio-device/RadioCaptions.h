#pragma once

#include <ArduinoJson.h>
#include <cmath>
#include "RadioDisplayModel.h"

struct RadioCaption {
  uint32_t startMs = 0;
  uint32_t endMs = 0;
  uint16_t textOffset = 0;
  uint16_t textBytes = 0;
  char speaker[49]{};
};

struct RadioCaptionTrack {
  static constexpr size_t kMaxCaptions = 24;
  static constexpr size_t kMaxTextBytes = 1536;
  static constexpr size_t kTextPoolBytes = 4096;
  RadioCaption items[kMaxCaptions]{};
  char textPool[kTextPoolBytes]{};
  uint8_t count = 0;
  uint16_t usedBytes = 0;
  uint32_t received = 0, invalid = 0, dropped = 0, textTruncated = 0, speakerTruncated = 0;

  void clear() {
    count = 0;
    usedBytes = 0;
    received = invalid = dropped = textTruncated = speakerTruncated = 0;
    textPool[0] = '\0';
  }

  void load(JsonArrayConst captions) {
    clear();
    for (JsonVariantConst value : captions) {
      ++received;
      if (!value["startMs"].is<double>() || !value["endMs"].is<double>() ||
          !value["text"].is<const char*>()) { ++invalid; continue; }
      const double start = value["startMs"].as<double>();
      const double end = value["endMs"].as<double>();
      const char* text = value["text"].as<const char*>();
      if (!std::isfinite(start) || !std::isfinite(end) || start < 0 ||
          end > UINT32_MAX || end <= start || uint32_t(end) <= uint32_t(start) || !*text) {
        ++invalid; continue;
      }
      if (count == kMaxCaptions || kTextPoolBytes - usedBytes < 5) { ++dropped; continue; }
      RadioCaption& caption = items[count];
      caption.startMs = uint32_t(start);
      caption.endMs = uint32_t(end);
      caption.textOffset = usedBytes;
      const size_t available = kTextPoolBytes - usedBytes;
      const size_t capacity = available < kMaxTextBytes + 1 ? available : kMaxTextBytes + 1;
      const RadioTextCopy copied = radioCopyText(textPool + usedBytes, capacity, text);
      caption.textBytes = uint16_t(copied.bytes);
      if (copied.truncated) ++textTruncated;
      if (radioCopyText(caption.speaker, sizeof(caption.speaker), value["speaker"] | "").truncated)
        ++speakerTruncated;
      usedBytes += uint16_t(copied.bytes + 1);
      ++count;
    }
  }

  int8_t find(uint64_t playbackMs) const {
    for (uint8_t i = 0; i < count; ++i)
      if (playbackMs >= items[i].startMs && playbackMs < items[i].endMs) return int8_t(i);
    return -1;
  }

  const char* text(uint8_t index) const { return textPool + items[index].textOffset; }
};

// Cached geometry for just the current caption. Even if a glyph filled a
// whole line, each page consumes at least three bytes (except the last page).
class RadioCaptionCursor {
 public:
  static constexpr uint32_t kPollMs = 200;
  static constexpr int kWidth = 144;
  static constexpr size_t kMaxPages = (RadioCaptionTrack::kMaxTextBytes + 2) / 3;

  void reset() { cachedIndex_ = -1; polled_ = false; pageCount_ = 0; }
  void pause(RadioDisplayModel& model) { model.clearCaption(); polled_ = false; }

  template <class Width>
  void update(const RadioCaptionTrack& track, RadioDisplayModel& model,
              uint64_t playbackMs, uint32_t nowMs, Width width) {
    if (model.status != RadioDisplayStatus::Playing || !model.captionLayout()) { pause(model); return; }
    if (polled_ && uint32_t(nowMs - lastPoll_) < kPollMs) return;
    lastPoll_ = nowMs;
    polled_ = true;
    const int8_t index = track.find(playbackMs);
    if (index < 0) { model.clearCaption(); return; }
    const RadioCaption& caption = track.items[index];
    const char* text = track.text(index);
    if (cachedIndex_ != index) {
      cachedIndex_ = index;
      pageCount_ = 0;
      uint16_t offset = 0;
      while (offset < caption.textBytes && pageCount_ < kMaxPages) {
        pageStarts_[pageCount_++] = offset;
        for (int line = 0; line < 3 && offset < caption.textBytes; ++line)
          offset = nextLine(text, offset, nullptr, width);
      }
      pageStarts_[pageCount_] = offset;
    }
    if (!pageCount_) { model.clearCaption(); return; }
    uint16_t page = uint16_t((playbackMs - caption.startMs) * pageCount_ /
      (uint64_t(caption.endMs) - caption.startMs));
    if (page >= pageCount_) page = pageCount_ - 1;
    if (model.captionIndex == index && model.captionPage == page) return;
    char lines[3][RadioDisplayModel::kCaptionLineBytes + 1]{};
    uint16_t offset = pageStarts_[page];
    for (int line = 0; line < 3 && offset < pageStarts_[page + 1]; ++line)
      offset = nextLine(text, offset, lines[line], width);
    model.setCaption(index, page, pageCount_, lines, caption.speaker);
  }

 private:
  int8_t cachedIndex_ = -1;
  bool polled_ = false;
  uint32_t lastPoll_ = 0;
  uint16_t pageCount_ = 0;
  uint16_t pageStarts_[kMaxPages + 1]{};

  template <class Width>
  static uint16_t nextLine(const char* text, uint16_t offset, char* output, Width width) {
    size_t bytes = 0;
    int used = 0;
    while (text[offset]) {
      uint32_t cp;
      const size_t count = radioTitleCharacter(text + offset, cp);
      int advance = width(cp);
      if (advance < 1) advance = 1;
      if (advance > kWidth) advance = kWidth;
      if (used + advance > kWidth || bytes + count > RadioDisplayModel::kCaptionLineBytes) break;
      if (output) std::memcpy(output + bytes, text + offset, count);
      bytes += count;
      offset += uint16_t(count);
      used += advance;
    }
    if (output) output[bytes] = '\0';
    return offset;
  }
};

static_assert(sizeof(RadioCaptionTrack) <= 6 * 1024, "Caption track must fit the fixed 6 KiB budget");
