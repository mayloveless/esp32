#pragma once
#include <atomic>
#include <cstdint>

#ifndef RADIO_FAST_WAV_START
#define RADIO_FAST_WAV_START 0
#endif

// The decoder only claims a timestamp. Printing stays on the sketch loop.
struct RadioStartTiming {
  enum Point : uint8_t { ConnectBegin, TlsConnected, WavHeader, RangeSent, RangeReady, FirstPcm, Count };
  std::atomic<bool> active{false};
  std::atomic<uint32_t> firstPcm{UINT32_MAX};
  uint32_t lockedAt = 0;
  uint32_t at[Count]{};
  bool seen[Count]{};
  bool prefetch = false;
  bool fast = false;
  bool fallback = false;
  uint8_t connections = 0;
  bool reported = false;

  void begin(uint32_t locked, bool hit, bool experiment) {
    active.store(false);
    firstPcm.store(UINT32_MAX);
    lockedAt = locked;
    for (uint8_t i = 0; i < Count; ++i) { at[i] = 0; seen[i] = false; }
    prefetch = hit; fast = experiment; fallback = false;
    connections = 0; reported = false;
    active.store(true);
  }
  bool mark(Point point, uint32_t now) {
    if (!active.load()) return false;
    if (point == TlsConnected) ++connections;
    if (seen[point]) return false;
    seen[point] = true; at[point] = now;
    return true;
  }
  void claimPcm(uint32_t now) {
    if (!active.load()) return;
    uint32_t unset = UINT32_MAX;
    firstPcm.compare_exchange_strong(unset, now);
  }
  uint32_t elapsed(Point point) const { return uint32_t(at[point] - lockedAt); }
};
