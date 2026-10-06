"""Verify actual local WAV generation, reuse and interrupted writes with a tiny FS."""
from pathlib import Path
import array
import math
import os
import subprocess
import tempfile
import wave

root = Path(__file__).resolve().parents[1]
source = r'''
#include <cassert>
#include <algorithm>
#include <fstream>
#include <map>
#include <string>
#include <vector>
#include "RadioTuningWav.h"
struct FS {
  std::map<std::string, std::vector<uint8_t>> files;
  int writes = 0, failAfter = -1;
  struct File {
    FS* fs; std::vector<uint8_t>* data; size_t position = 0;
    explicit operator bool() const { return data; }
    size_t size() { return data ? data->size() : 0; }
    size_t read(uint8_t* out, size_t bytes) {
      if (!data) return 0;
      bytes = std::min(bytes, data->size() - position);
      std::copy_n(data->data() + position, bytes, out); position += bytes; return bytes;
    }
    size_t write(const uint8_t* in, size_t bytes) {
      ++fs->writes;
      if (!data || (fs->failAfter >= 0 && fs->writes > fs->failAfter)) return 0;
      data->insert(data->end(), in, in + bytes); return bytes;
    }
    void close() {}
  };
  bool exists(const char* path) { return files.count(path); }
  File open(const char* path, const char* mode) {
    if (*mode == 'w') files[path].clear();
    return {this, exists(path) ? &files[path] : nullptr};
  }
  bool remove(const char* path) { return files.erase(path); }
  bool rename(const char* from, const char* to) {
    if (!exists(from)) return false;
    files[to] = files[from]; files.erase(from); return true;
  }
};
int main(int argc, char** argv) {
  assert(argc == 2);
  FS fs; fs.files["/unrelated.bin"] = {1, 2, 3};
  assert(radioEnsureTuningFile(fs) && radioTuningFileValid(fs));
  const auto original = fs.files[kTuningWavPath];
  const int writes = fs.writes;
  assert(radioEnsureTuningFile(fs) && fs.writes == writes); // cached, no flash writes
  fs.files[kTuningVersionPath][3] = 0;
  assert(!radioTuningFileValid(fs));
  fs.failAfter = fs.writes + 2;
  assert(!radioEnsureTuningFile(fs));
  assert(fs.files[kTuningWavPath] == original); // interrupted temp write preserves target
  fs.failAfter = -1;
  assert(radioEnsureTuningFile(fs) && fs.files[kTuningWavPath] == original);
  fs.files[kTuningWavPath].resize(100);
  assert(!radioTuningFileValid(fs) && radioEnsureTuningFile(fs));
  fs.files[kTuningWavPath][22] = 2; // incorrect channel count
  assert(!radioTuningFileValid(fs) && radioEnsureTuningFile(fs));
  assert(fs.files["/unrelated.bin"] == (std::vector<uint8_t>{1, 2, 3}));
  assert(!fs.exists(kTuningWavTempPath));
  std::ofstream output(argv[1], std::ios::binary);
  output.write(reinterpret_cast<const char*>(original.data()), original.size());
}
'''

# Run the sketch's real mount/initialization policy against logical WL sectors.
# Wear-level metadata exists outside this logical volume, even on an empty disk.
sketch = (root / 'radio-device.ino').read_text()
mount_code = sketch[sketch.index('bool blankFatVolume() {'):sketch.index('void startManifestPlayback(JsonObjectConst manifest, uint32_t requestedRevision,\n  const RadioCaptionTrack* captions) {')]
mount_fakes = r"""
constexpr int ESP_OK = 0, WL_INVALID_HANDLE = -1;
constexpr int ESP_PARTITION_TYPE_DATA = 1, ESP_PARTITION_SUBTYPE_DATA_FAT = 2;
using wl_handle_t = int;
struct esp_partition_t {} partition;
std::vector<uint8_t> logicalVolume(8192, 0xff);
bool readOK = true;
int activeHandles = 0;
const esp_partition_t* esp_partition_find_first(int, int, const char*) { return &partition; }
int wl_mount(const esp_partition_t*, int* handle) { *handle = 1; ++activeHandles; return 0; }
size_t wl_size(int) { return logicalVolume.size(); }
int wl_read(int, size_t offset, void* output, size_t bytes) {
  if (!readOK) return 1;
  memcpy(output, logicalVolume.data() + offset, bytes); return 0;
}
int wl_unmount(int) { --activeHandles; return 0; }
void vTaskDelay(int) {}
struct : FS {
  bool mounted = false;
  std::vector<bool> beginCalls;
  bool begin(bool format) {
    beginCalls.push_back(format);
    if (format) {
      assert(std::all_of(logicalVolume.begin(), logicalVolume.end(), [](uint8_t byte) { return byte == 0xff; }));
      mounted = true;
    }
    return mounted;
  }
} FFat;
bool tuningWavReady = false;
struct { void println(const char*) {} } Serial;
"""
mount_cases = r"""
  // Only WL metadata is present: empty logical sectors can be initialized.
  setupTuningWav();
  assert(tuningWavReady && FFat.beginCalls == (std::vector<bool>{false, true}));
  assert(activeHandles == 0 && radioTuningFileValid(FFat));
  // Existing mounted filesystem/file is reused, without formatting/writing.
  FFat.beginCalls.clear(); logicalVolume[0] = 0xeb;
  const int cachedWrites = FFat.writes;
  setupTuningWav();
  assert(tuningWavReady && FFat.beginCalls == std::vector<bool>{false});
  assert(FFat.writes == cachedWrites && activeHandles == 0);
  // Nonempty unreadable volume, or a read error, never authorizes formatting.
  for (int scenario = 0; scenario < 2; ++scenario) {
    FFat.mounted = false; FFat.beginCalls.clear(); tuningWavReady = false;
    logicalVolume.assign(8192, 0xff);
    if (scenario == 0) logicalVolume.back() = 0;
    readOK = scenario != 1;
    setupTuningWav();
    assert(!tuningWavReady && FFat.beginCalls == std::vector<bool>{false});
    assert(FFat.writes == cachedWrites && activeHandles == 0);
  }
"""
source = source.replace('int main(', mount_fakes + mount_code + '\nint main(')
source = source.replace('  FS fs; fs.files', mount_cases + '\n  FS fs; fs.files')
with tempfile.TemporaryDirectory(prefix='radio-static-test-') as directory:
    cpp, binary, wav = (Path(directory) / name for name in ('test.cpp', 'test', 'tuning.wav'))
    cpp.write_text(source)
    subprocess.run([os.environ.get('CXX', 'clang++'), '-std=c++17', '-Wall', '-Wextra',
                    '-I', str(root), str(cpp), '-o', str(binary)], check=True)
    subprocess.run([str(binary), str(wav)], check=True)
    with wave.open(str(wav)) as audio:
        assert (audio.getframerate(), audio.getnchannels(), audio.getsampwidth(), audio.getnframes()) == (32000, 1, 2, 192000)
        samples = array.array('h', audio.readframes(audio.getnframes()))
    assert samples[0] == samples[-1] == 0
    assert max(abs(x) for x in samples) <= 4096  # at most 1/8 of signed 16-bit full scale
    assert abs(sum(samples) / len(samples)) < 20
    rms = math.sqrt(sum(x*x for x in samples) / len(samples))
    assert 500 < rms < 2000
print('Local WAV generation/version/cache/partial-write and PCM checks passed.')
