"""Exercise the actual display model without compiling a pixel driver."""
from pathlib import Path
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = r'''
#include "RadioDisplayModel.h"
#include <cassert>
#include <string>

int main() {
  using S = RadioDisplayStatus;
  RadioDisplayModel model;
  assert(model.status == S::Boot && model.dirty);
  model.dirty = false;
  model.setStatus(S::Connecting);
  assert(model.status == S::Connecting && model.dirty);
  model.dirty = false;
  model.setStatus(S::Connecting);
  assert(!model.dirty);
  model.update(true, true, true, false, false, false, false, false);
  assert(model.status == S::Tuning);
  model.dirty = false;
  for (int edge = 0; edge < 100; ++edge)
    model.update(true, true, true, false, false, false, false, false);
  assert(!model.dirty);
  model.selectProgram("在宇宙中如何泡一杯完美的茶？", "chat");
  assert(!model.dirty); // prepared title isn't visible in TUNING
  for (int edge = 0; edge < 100; ++edge)
    model.update(true, true, true, true, false, false, false, false);
  assert(!model.dirty);
  model.update(true, false, true, true, false, false, false, false);
  assert(model.status == S::Locking && std::strcmp(model.kind, "CHAT") == 0);
  model.update(true, false, false, false, true, true, false, false);
  assert(model.status == S::Locking); // stream ready alone isn't samples
  model.update(true, false, false, false, true, true, true, true);
  assert(model.status == S::Locking); // seek still pending
  model.update(true, false, false, false, true, true, true, false);
  assert(model.status == S::Playing);
  model.dirty = false;
  model.selectProgram("在宇宙中如何泡一杯完美的茶？", "chat");
  model.update(true, false, false, false, true, true, true, false);
  assert(!model.dirty);
  model.update(true, true, false, false, true, true, true, false);
  assert(model.status == S::Tuning); // small move preserves network audio
  model.update(true, false, false, false, true, true, true, false);
  assert(model.status == S::Playing);
  model.selectProgram("来自奥尔特云的回声", "news");
  assert(model.dirty && std::strcmp(model.kind, "NEWS") == 0);
  model.dirty = false;
  model.selectProgram("来自奥尔特云的回声", "alien");
  assert(model.dirty && std::strcmp(model.kind, "ALIEN") == 0);
  model.selectProgram("轨道氛围", "music");
  assert(std::strcmp(model.kind, "MUSIC") == 0);
  model.setIdle(S::NoSignal);
  model.update(true, false, false, false, false, false, false, false);
  assert(model.status == S::NoSignal);
  model.setIdle(S::SignalLost);
  model.update(true, true, false, false, false, false, false, false);
  assert(model.status == S::Tuning);
  model.update(true, false, false, false, false, false, false, false);
  assert(model.status == S::SignalLost); // temporary feedback doesn't lose outcome
  model.update(false, false, false, false, false, false, false, false);
  assert(model.status == S::NoNetwork);

  char lines[3][RadioDisplayModel::kTitleBytes + 1];
  model.selectProgram("来自奥尔特云的回声：在宇宙中如何泡一杯完美的茶？", "news");
  model.wrapTitle(lines, 144, [](uint32_t cp) { return cp < 128 ? 6 : 12; });
  assert(std::string(lines[0]) == "来自奥尔特云的回声：在宇");
  assert(std::string(lines[1]) == "宙中如何泡一杯完美的茶？");
  assert(!lines[2][0]);
  std::string longTitle;
  for (int i = 0; i < 100; ++i) longTitle += "茶";
  model.selectProgram(longTitle.c_str(), "chat");
  assert(std::strlen(model.title) == 192);
  model.wrapTitle(lines, 144, [](uint32_t) { return 12; });
  for (auto& line : lines) {
    assert(std::strlen(line) == 36); // 12 complete Chinese characters
    const char* p = line;
    while (*p) { uint32_t cp; p += radioTitleCharacter(p, cp); assert(cp == 0x8336); }
  }
  // The model's byte cap also never splits a character at the boundary.
  model.selectProgram((std::string(191, 'a') + "茶").c_str(), "chat");
  assert(std::strlen(model.title) == 191);
  model.selectProgram("A\nB\xe8\x8c", "chat");
  assert(std::string(model.title) == "A B??");
  model.selectProgram("\xed\xa0\x80\xf0\x80\x80\x80", "chat");
  assert(std::string(model.title) == "???????");
}
'''
with tempfile.TemporaryDirectory(prefix='radio-display-test-') as folder:
    cpp = Path(folder) / 'test.cpp'
    binary = Path(folder) / 'test'
    cpp.write_text(source)
    subprocess.run([os.environ.get('CXX', 'clang++'), '-std=c++17', '-Wall',
                    '-Wextra', '-Werror', '-fsanitize=address,undefined',
                    '-I', str(root), str(cpp), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print('display model tests passed')
