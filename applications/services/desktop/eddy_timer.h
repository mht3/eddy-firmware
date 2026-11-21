#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define RECORD_EDDY_TIMER      "eddy_timer"
#define EDDY_TIMER_MAX_SECONDS (99U * 60U + 59U)
#define EDDY_TIMER_STEP        5U

typedef struct EddyTimer EddyTimer;

typedef enum {
    EddyTimerRead,
    EddyTimerToggleRunning,
    EddyTimerToggleSound,
    EddyTimerShorter,
    EddyTimerLonger,
    EddyTimerMinuteShorter,
    EddyTimerMinuteLonger,
    EddyTimerCycleSeconds,
} EddyTimerAction;

typedef struct {
    uint32_t remaining;
    uint32_t deadline;
    uint16_t focus_seconds;
    uint16_t break_seconds;
    uint8_t on_break;
    uint8_t muted;
} EddyTimerState;

/** Apply an action to the desktop-owned timer and return a current snapshot. */
void eddy_timer_update(EddyTimer* timer, EddyTimerAction action, EddyTimerState* snapshot);

#ifdef __cplusplus
}
#endif
