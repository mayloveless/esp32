#pragma once

#include <stdint.h>
#include <string.h>

constexpr const char* kTuningWavPath = "/radio-tuning.wav";
constexpr const char* kTuningWavTempPath = "/radio-tuning.tmp.wav";
constexpr const char* kTuningVersionPath = "/radio-tuning.version";
constexpr uint32_t kTuningSampleRate = 32000;
constexpr uint32_t kTuningSamples = kTuningSampleRate * 6;
constexpr uint32_t kTuningDataBytes = kTuningSamples * 2;
constexpr uint8_t kTuningVersion[] = {'R', 'T', 'N', 1};

inline void radioWavLe(uint8_t* out, uint32_t value, unsigned bytes) {
  for (unsigned i = 0; i < bytes; ++i) out[i] = uint8_t(value >> (8 * i));
}

inline void radioTuningWavHeader(uint8_t* header) {
  memset(header, 0, 44);
  memcpy(header, "RIFF", 4); radioWavLe(header + 4, kTuningDataBytes + 36, 4);
  memcpy(header + 8, "WAVEfmt ", 8); radioWavLe(header + 16, 16, 4);
  radioWavLe(header + 20, 1, 2); radioWavLe(header + 22, 1, 2);
  radioWavLe(header + 24, kTuningSampleRate, 4);
  radioWavLe(header + 28, kTuningSampleRate * 2, 4);
  radioWavLe(header + 32, 2, 2); radioWavLe(header + 34, 16, 2);
  memcpy(header + 36, "data", 4); radioWavLe(header + 40, kTuningDataBytes, 4);
}

class RadioTuningNoise {
 public:
  int16_t sample(uint32_t index) {
    random_ ^= random_ << 13; random_ ^= random_ >> 17; random_ ^= random_ << 5;
    const int32_t white = (int32_t(random_ & 65535) - 32768) / 8;
    filtered_ = (filtered_ + white) / 2; // soften the high-frequency edge
    const uint32_t edge = index < 128 ? index : kTuningSamples - 1 - index;
    return int16_t(edge < 128 ? filtered_ * int32_t(edge) / 128 : filtered_);
  }
 private:
  uint32_t random_ = 0x72616431;
  int32_t filtered_ = 0;
};

template<class FileSystem> bool radioTuningFileValid(FileSystem& fs) {
  if (!fs.exists(kTuningWavPath) || !fs.exists(kTuningVersionPath)) return false;
  auto wav = fs.open(kTuningWavPath, "r");
  uint8_t actual[44], expected[44]; radioTuningWavHeader(expected);
  const bool valid = wav && wav.size() == kTuningDataBytes + 44 &&
    wav.read(actual, sizeof(actual)) == sizeof(actual) && !memcmp(actual, expected, sizeof(actual));
  wav.close();
  auto version = fs.open(kTuningVersionPath, "r");
  uint8_t marker[sizeof(kTuningVersion)];
  const bool current = version && version.size() == sizeof(marker) &&
    version.read(marker, sizeof(marker)) == sizeof(marker) && !memcmp(marker, kTuningVersion, sizeof(marker));
  version.close();
  return valid && current;
}

template<class FileSystem> bool radioEnsureTuningFile(FileSystem& fs, void (*yieldBlock)() = nullptr) {
  if (radioTuningFileValid(fs)) return true;
  auto wav = fs.open(kTuningWavTempPath, "w");
  uint8_t header[44]; radioTuningWavHeader(header);
  if (!wav || wav.write(header, sizeof(header)) != sizeof(header)) { wav.close(); return false; }
  RadioTuningNoise noise;
  uint8_t block[512];
  for (uint32_t start = 0; start < kTuningSamples; start += 256) {
    for (unsigned i = 0; i < 256; ++i) radioWavLe(block + i * 2, uint16_t(noise.sample(start + i)), 2);
    if (wav.write(block, sizeof(block)) != sizeof(block)) { wav.close(); return false; }
    if (yieldBlock) yieldBlock();
  }
  wav.close();
  if (fs.exists(kTuningWavPath) && !fs.remove(kTuningWavPath)) return false;
  if (!fs.rename(kTuningWavTempPath, kTuningWavPath)) return false;
  auto version = fs.open(kTuningVersionPath, "w");
  const bool written = version && version.write(kTuningVersion, sizeof(kTuningVersion)) == sizeof(kTuningVersion);
  version.close();
  return written && radioTuningFileValid(fs);
}
