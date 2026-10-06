#pragma once

#include <stdint.h>

// Either direction is activity. Do not wait for a complete detent: some EC11
// variants rest twice per quadrature cycle. Ignore impossible transitions and
// suppress edges less than 2 ms apart; the loop coalesces the remaining burst.
class RadioEncoder {
 public:
  void begin(uint8_t phase) {
    previous_ = phase & 3;
    haveActivity_ = false;
  }

  bool sample(uint8_t phase, uint32_t now) {
    phase &= 3;
    const uint8_t changed = previous_ ^ phase;
    previous_ = phase;
    if (changed != 1 && changed != 2) return false;
    if (haveActivity_ && uint32_t(now - lastActivity_) < 2) return false;
    haveActivity_ = true;
    lastActivity_ = now;
    return true;
  }

 private:
  uint8_t previous_ = 3;
  bool haveActivity_ = false;
  uint32_t lastActivity_ = 0;
};

struct RadioTuneInput {
  uint32_t revision = 0;
  uint32_t changedAt = 0;

  void request(uint32_t now) { ++revision; changedAt = now; }
  bool ready(uint32_t acknowledged, uint32_t now) const {
    return revision != acknowledged && uint32_t(now - changedAt) >= 300;
  }
};
