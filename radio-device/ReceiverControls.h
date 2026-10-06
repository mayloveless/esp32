#pragma once

#include <stdint.h>

// Either direction is activity. Do not wait for a complete detent: some EC11
// variants rest twice per quadrature cycle. Ignore impossible transitions and
// suppress edges less than 2 ms apart. Direction lets dial travel cancel bounce.
class RadioEncoder {
 public:
  void begin(uint8_t phase) {
    previous_ = phase & 3;
    haveActivity_ = false;
  }

  bool sample(uint8_t phase, uint32_t now) {
    phase &= 3;
    const uint8_t oldPhase = previous_;
    const uint8_t changed = previous_ ^ phase;
    previous_ = phase;
    if (changed != 1 && changed != 2) return false;
    if (haveActivity_ && uint32_t(now - lastActivity_) < 2) return false;
    haveActivity_ = true;
    lastActivity_ = now;
    static constexpr int8_t direction[] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
    direction_ = direction[(oldPhase << 2) | phase];
    return true;
  }

  int8_t direction() const { return direction_; }

 private:
  uint8_t previous_ = 3;
  bool haveActivity_ = false;
  uint32_t lastActivity_ = 0;
  int8_t direction_ = 0;
};

struct RadioTuneInput {
  uint32_t revision = 0;
  uint32_t activityRevision = 0;
  uint32_t changedAt = 0;
  uint32_t selectedAt = 0;
  int16_t travel = 0;
  bool holding = false;
  bool selectionLatched = false;
  static constexpr uint32_t kHoldMs = 4000;
  static constexpr int kNormalEdges = 4, kLargeEdges = 16;

  void request(uint32_t now, int8_t direction = 1) {
    ++activityRevision;
    changedAt = now;
    travel += direction;
    const int threshold = holding && uint32_t(now - selectedAt) < kHoldMs ? kLargeEdges : kNormalEdges;
    if (!selectionLatched && (travel >= threshold || travel <= -threshold)) {
      ++revision; travel = 0; selectedAt = now; holding = true;
      selectionLatched = true;
    }
    if (selectionLatched) travel = 0;
  }
  void hold(uint32_t now) { selectedAt = now; holding = true; travel = 0; selectionLatched = false; }
  void settle() { travel = 0; }
  bool moving(uint32_t now) const { return activityRevision && uint32_t(now - changedAt) < 300; }
  bool ready(uint32_t acknowledged, uint32_t now) const {
    (void)now;
    return revision != acknowledged;
  }
};
