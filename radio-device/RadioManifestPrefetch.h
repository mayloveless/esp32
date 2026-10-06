#pragma once

#include <stdint.h>
#include <stdio.h>
#include <string.h>

// Use the API response's UTC Date rather than an uninitialized ESP32 clock.
// Cache for at most five minutes, leaving 30 seconds before URL expiration.
inline int64_t radioUtcSeconds(int year, int month, int day, int hour, int minute, int second) {
  if (year < 1970 || year > 2100 || month < 1 || month > 12 ||
      hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return -1;
  const int daysInMonth[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  auto leap = [](int y) { return y % 4 == 0 && (y % 100 != 0 || y % 400 == 0); };
  if (day < 1 || day > daysInMonth[month - 1] + (month == 2 && leap(year))) return -1;
  int64_t days = 0;
  for (int y = 1970; y < year; ++y) days += 365 + leap(y);
  for (int m = 1; m < month; ++m) days += daysInMonth[m - 1] + (m == 2 && leap(year));
  return ((days + day - 1) * 24 + hour) * 3600 + minute * 60 + second;
}

inline uint32_t radioManifestLifetime(const char* expiresAt, const char* responseDate) {
  const size_t size = strlen(expiresAt);
  if (!((size == 20 && expiresAt[19] == 'Z') ||
        (size == 24 && expiresAt[19] == '.' && expiresAt[23] == 'Z' &&
         expiresAt[20] >= '0' && expiresAt[20] <= '9' &&
         expiresAt[21] >= '0' && expiresAt[21] <= '9' &&
         expiresAt[22] >= '0' && expiresAt[22] <= '9'))) return 0;
  for (size_t i = 0; i < 19; ++i) {
    const char expected = i == 4 || i == 7 ? '-' : i == 10 ? 'T' : i == 13 || i == 16 ? ':' : 0;
    if (expected ? expiresAt[i] != expected : expiresAt[i] < '0' || expiresAt[i] > '9') return 0;
  }
  int year, month, day, hour, minute, second;
  if (sscanf(expiresAt, "%d-%d-%dT%d:%d:%d", &year, &month, &day, &hour, &minute, &second) != 6) return 0;
  const int64_t expiration = radioUtcSeconds(year, month, day, hour, minute, second);
  char weekday[4], monthName[4], timezone[4], extra;
  if (sscanf(responseDate, "%3s, %d %3s %d %d:%d:%d %3s%c",
      weekday, &day, monthName, &year, &hour, &minute, &second, timezone, &extra) != 8 ||
      strcmp(timezone, "GMT") != 0) return 0;
  const char* months[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
  month = 0;
  for (int i = 0; i < 12; ++i) if (!strcmp(monthName, months[i])) month = i + 1;
  const int64_t issued = radioUtcSeconds(year, month, day, hour, minute, second);
  if (expiration < 0 || issued < 0 || expiration - issued <= 30) return 0;
  const int64_t remainingMs = (expiration - issued - 30) * 1000;
  return uint32_t(remainingMs < 300'000 ? remainingMs : 300'000);
}
