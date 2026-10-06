"""Bounded captions, actual timeline matching and pagination; no pixel driver."""
from pathlib import Path
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
json_headers = Path(os.environ.get('ARDUINO_LIBRARY_DIR', str(Path.home() / 'Documents/Arduino/libraries'))) / 'ArduinoJson/src'
source = r'''
#include "RadioCaptions.h"
#include <cassert>
#include <string>
#include <iostream>

RadioCaptionTrack track;
RadioCaptionCursor cursor;
int widthCalls = 0;
int width(uint32_t cp) { ++widthCalls; return cp < 128 ? 6 : 12; }
void load(const char* json) {
  JsonDocument temporary;
  assert(!deserializeJson(temporary, json));
  track.load(temporary.as<JsonArrayConst>());
  cursor.reset();
} // track survives destruction of the temporary JSON strings

int main() {
  load(R"([{"startMs":1000,"endMs":3000,"speaker":"A","text":"第一句"},
           {"startMs":5000,"endMs":10000,"speaker":"B","text":"中途字幕"}])");
  assert(track.find(999) == -1 && track.find(1000) == 0);
  assert(track.find(2999) == 0 && track.find(3000) == -1 && track.find(4000) == -1);
  assert(track.find(8000) == 1 && track.find(10000) == -1);
  assert(track.find(UINT64_MAX) == -1); // no seconds-to-ms overflow
  RadioDisplayModel model;
  model.selectProgram("标题", "chat"); model.setStatus(RadioDisplayStatus::Playing);
  cursor.update(track, model, 8000, 0, width);
  assert(model.captionIndex == 1 && std::string(model.captionLines[0]) == "中途字幕");
  assert(std::string(model.captionSpeaker) == "B" && std::string(model.captionLabel()) == "字幕");
  model.dirty = false;
  int measured = widthCalls;
  cursor.update(track, model, 9000, 200, width);
  assert(!model.dirty && widthCalls == measured);
  cursor.update(track, model, 10000, 400, width);
  assert(model.dirty && model.captionIndex == -1 && !model.captionLines[0][0]);
  model.dirty = false;
  cursor.update(track, model, 12000, 600, width);
  assert(!model.dirty);

  JsonDocument longCaption;
  auto item = longCaption.to<JsonArray>().add<JsonObject>();
  item["startMs"] = 1000; item["endMs"] = 11000; item["speaker"] = "外星人";
  std::string repeated;
  for (int i = 0; i < 108; ++i) repeated += "茶";
  item["text"] = repeated;
  track.load(longCaption.as<JsonArrayConst>()); cursor.reset();
  model.selectProgram("标题", "alien");
  cursor.update(track, model, 1000, 0, width);
  assert(model.captionPage == 0 && model.captionPages == 3);
  assert(std::string(model.captionLabel()) == "译文" && !model.captionSpeaker[0]);
  for (const auto& line : model.captionLines) assert(std::strlen(line) == 36);
  model.dirty = false; measured = widthCalls;
  cursor.update(track, model, 4400, 199, width); // 200ms poll limit
  assert(!model.dirty && model.captionPage == 0 && measured == widthCalls);
  cursor.update(track, model, 4400, 200, width);
  assert(model.dirty && model.captionPage == 1);
  model.dirty = false;
  cursor.update(track, model, 7000, 400, width);
  assert(!model.dirty && model.captionPage == 1);
  cursor.update(track, model, 7667, 600, width);
  assert(model.dirty && model.captionPage == 2);
  cursor.update(track, model, 10999, 800, width);
  assert(model.captionPage == 2);
  cursor.update(track, model, 11000, 1000, width);
  assert(model.captionIndex == -1);

  // Every non-playing state clears the previous text immediately.
  for (auto state : {RadioDisplayStatus::Tuning, RadioDisplayStatus::Locking,
                    RadioDisplayStatus::SignalLost, RadioDisplayStatus::NoSignal,
                    RadioDisplayStatus::NoNetwork}) {
    model.setStatus(RadioDisplayStatus::Playing); cursor.reset();
    cursor.update(track, model, 5000, 0, width);
    assert(model.captionIndex == 0);
    model.setStatus(state);
    assert(model.captionIndex == -1 && !model.captionLines[0][0] && !model.captionSpeaker[0]);
    cursor.update(track, model, 5000, 200, width);
    assert(model.captionIndex == -1);
  }
  model.selectProgram("音乐", "music"); model.setStatus(RadioDisplayStatus::Playing);
  cursor.update(track, model, 5000, 400, width);
  assert(!model.captionLayout() && !model.captionLabel()[0] && model.captionIndex == -1);
  model.selectProgram("新节目", "news"); model.setStatus(RadioDisplayStatus::Playing);
  load(R"([{"startMs":0,"endMs":10000,"text":"新节目字幕"}])");
  cursor.update(track, model, 5000, 500, width);
  assert(std::string(model.captionLines[0]) == "新节目字幕");
  model.dirty = false;
  cursor.pause(model);
  assert(model.captionIndex == -1 && model.dirty);
  cursor.update(track, model, 6000, 501, width); // immediate resume, no wall clock interpolation
  assert(model.captionIndex == 0);
  cursor.reset();
  cursor.update(track, model, 6000, UINT32_MAX - 100, width);
  model.dirty = false;
  cursor.update(track, model, 10000, 99, width);
  assert(model.captionIndex == -1 && model.dirty); // poll timestamp wraparound

  // Bounded text pool, item count, speaker length and Unicode sanitization.
  JsonDocument many;
  auto rows = many.to<JsonArray>();
  for (int i = 0; i < 30; ++i) {
    auto row = rows.add<JsonObject>(); row["startMs"] = i * 1000; row["endMs"] = i * 1000 + 900;
    row["text"] = "短句"; row["speaker"] = std::string(100, 's');
  }
  track.load(many.as<JsonArrayConst>());
  assert(track.count == 24 && track.received == 30 && track.dropped == 6 && track.speakerTruncated == 24);
  assert(std::strlen(track.items[0].speaker) == 48);
  for (auto row : rows) row["text"] = repeated + repeated + repeated + repeated + repeated;
  track.load(rows);
  assert(track.usedBytes <= 4096 && track.count < 24 && track.dropped > 0 && track.textTruncated > 0);
  assert(track.items[0].textBytes == RadioCaptionTrack::kMaxTextBytes);
  for (int i = 0; i < track.count; ++i) {
    const char* p = track.text(i);
    while (*p) { uint32_t cp; p += radioTitleCharacter(p, cp); assert(cp == 0x8336); }
  }
  load(R"([{"startMs":0,"endMs":1000,"text":"valid"},
           {"startMs":-1,"endMs":1000,"text":"invalid"},
           {"startMs":1,"endMs":1,"text":"invalid"},
           {"startMs":0,"endMs":4294967296,"text":"invalid"},
           {"startMs":"0","endMs":1,"text":"invalid"},
           {"startMs":0,"endMs":1,"text":false}])");
  assert(track.count == 1 && track.invalid == 5);
  char broken[] = "A\nB\xe8\x8c\xed\xa0\x80";
  rows.clear(); auto row = rows.add<JsonObject>();
  row["startMs"] = 0; row["endMs"] = 1000; row["text"] = broken;
  track.load(rows);
  assert(std::string(track.text(0)) == "A B?????");
  // Pathological width providers still consume characters and stay bounded.
  row["text"] = std::string(RadioCaptionTrack::kMaxTextBytes, 'a'); track.load(rows); cursor.reset();
  model.clearCaption();
  cursor.update(track, model, 999, 0, [](uint32_t) { return 1000; });
  assert(model.captionPages == RadioCaptionCursor::kMaxPages);
  assert(model.captionPage == model.captionPages - 1);
  cursor.reset(); model.clearCaption();
  cursor.update(track, model, 999, 0, [](uint32_t) { return 0; });
  assert(model.captionPages > 0);
  std::cout << "trackBytes=" << sizeof(track) << " cursorBytes=" << sizeof(cursor)
            << " modelBytes=" << sizeof(model) << '\n';
}
'''
with tempfile.TemporaryDirectory(prefix='radio-captions-test-') as folder:
    cpp, binary = Path(folder) / 'test.cpp', Path(folder) / 'test'
    cpp.write_text(source)
    subprocess.run([os.environ.get('CXX', 'clang++'), '-std=c++17', '-Wall', '-Wextra',
                    '-Werror', '-fsanitize=address,undefined', '-I', str(root),
                    '-I', str(json_headers), str(cpp), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print('Caption timeline/ownership/bounds/pagination checks passed.')
