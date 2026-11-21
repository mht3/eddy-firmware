#include "desktop_i.h"
#include <furi_hal_rtc.h>
#include <toolbox/saved_struct.h>
#include <notification/notification_messages.h>
#include <stdatomic.h>

#define TIMER_PATH  INT_PATH(".eddy_focus")
#define TIMER_MAGIC 0xE7

struct EddyTimer {
    FuriMutex* mutex;
    NotificationApp* notification;
    EddyTimerState state;
    atomic_uint next_alarm;
};

typedef struct {
    uint32_t remaining;
    uint32_t deadline;
    uint8_t on_break;
    uint8_t focus_minutes;
    uint8_t break_minutes;
    uint8_t reserved;
} LegacyTimer;

static const EddyTimerState defaults = {
    .remaining = 25 * 60,
    .focus_seconds = 25 * 60,
    .break_seconds = 5 * 60,
};

static const NotificationSequence chime = {
    &message_display_backlight_on,
    &message_note_c5,
    &message_delay_250,
    &message_sound_off,
    &message_delay_100,
    &message_note_e5,
    &message_delay_250,
    &message_sound_off,
    &message_delay_100,
    &message_note_g5,
    &message_delay_500,
    &message_sound_off,
    NULL,
};

static bool valid_state(const EddyTimerState* state) {
    return state->on_break <= 1 && state->muted <= 1 && state->focus_seconds > 0 &&
           state->focus_seconds <= EDDY_TIMER_MAX_SECONDS && state->break_seconds > 0 &&
           state->break_seconds <= EDDY_TIMER_MAX_SECONDS && state->remaining &&
           state->remaining <= (state->on_break ? state->break_seconds : state->focus_seconds);
}

EddyTimer* eddy_timer_alloc(Storage* storage, NotificationApp* notification) {
    EddyTimer* timer = malloc(sizeof(EddyTimer));
    timer->mutex = furi_mutex_alloc(FuriMutexTypeNormal);
    timer->notification = notification;
    timer->state = defaults;
    if(storage_file_exists(storage, TIMER_PATH) &&
       !saved_struct_load(TIMER_PATH, &timer->state, sizeof(timer->state), TIMER_MAGIC, 3)) {
        LegacyTimer legacy;
        bool v2 = saved_struct_load(TIMER_PATH, &legacy, sizeof(legacy), TIMER_MAGIC, 2);
        if(v2 || saved_struct_load(TIMER_PATH, &legacy, sizeof(legacy), TIMER_MAGIC, 1)) {
            timer->state.remaining = legacy.remaining;
            timer->state.deadline = legacy.deadline;
            timer->state.on_break = legacy.on_break;
            if(v2) {
                timer->state.focus_seconds = 60U * legacy.focus_minutes;
                timer->state.break_seconds = 60U * legacy.break_minutes;
            }
        }
    }
    if(!valid_state(&timer->state)) timer->state = defaults;
    atomic_init(&timer->next_alarm, timer->state.deadline);
    furi_record_create(RECORD_EDDY_TIMER, timer);
    return timer;
}

static void timer_advance(EddyTimerState* state, uint32_t now) {
    if(!state->on_break && now - state->deadline < state->break_seconds) {
        state->on_break = 1;
        state->remaining = state->break_seconds;
        state->deadline += state->break_seconds;
    } else {
        state->on_break = 0;
        state->remaining = state->focus_seconds;
        state->deadline = 0;
    }
}

static uint16_t timer_adjust(uint16_t current, EddyTimerAction action) {
    uint16_t minutes = current / 60;
    uint16_t seconds = current % 60;
    switch(action) {
    case EddyTimerMinuteShorter:
        if(minutes) minutes--;
        break;
    case EddyTimerMinuteLonger:
        if(minutes < EDDY_TIMER_MAX_SECONDS / 60) minutes++;
        break;
    case EddyTimerCycleSeconds:
        seconds = ((seconds / EDDY_TIMER_STEP + 1) * EDDY_TIMER_STEP) % 60;
        break;
    // Preserve the five-second actions used by earlier app binaries.
    case EddyTimerShorter:
        return current <= EDDY_TIMER_STEP ? current :
                                            MAX(current - EDDY_TIMER_STEP, EDDY_TIMER_STEP);
    case EddyTimerLonger:
        return MIN(current + EDDY_TIMER_STEP, EDDY_TIMER_MAX_SECONDS);
    default:
        return current;
    }
    return minutes || seconds ? minutes * 60U + seconds : EDDY_TIMER_STEP;
}

void eddy_timer_update(EddyTimer* timer, EddyTimerAction action, EddyTimerState* snapshot) {
    furi_check(furi_mutex_acquire(timer->mutex, FuriWaitForever) == FuriStatusOk);
    EddyTimerState* state = &timer->state;
    uint32_t now = furi_hal_rtc_get_timestamp();
    bool expired = state->deadline && now >= state->deadline;
    if(expired) {
        // Avoid a stale alarm after a powered-off Flipper wakes up hours later.
        if(!state->muted && now - state->deadline <= 5) {
            notification_message(timer->notification, &chime);
        }
        timer_advance(state, now);
    }
    bool changed = expired;
    if(action == EddyTimerToggleRunning) {
        if(state->deadline) {
            state->remaining = MIN(state->deadline - now, state->remaining);
            state->deadline = 0;
        } else {
            state->deadline = now + state->remaining;
        }
        changed = true;
    } else if(action == EddyTimerToggleSound) {
        state->muted = !state->muted;
        changed = true;
    } else if(!state->deadline && action != EddyTimerRead) {
        uint16_t seconds = timer_adjust(state->remaining, action);
        if(seconds != state->remaining) {
            state->remaining = seconds;
            if(state->on_break)
                state->break_seconds = seconds;
            else
                state->focus_seconds = seconds;
            changed = true;
        }
    }
    if(changed) {
        atomic_store(&timer->next_alarm, state->deadline);
        saved_struct_save(TIMER_PATH, state, sizeof(*state), TIMER_MAGIC, 3);
    }
    if(snapshot) {
        *snapshot = *state;
        if(state->deadline) snapshot->remaining = MIN(state->deadline - now, state->remaining);
    }
    furi_check(furi_mutex_release(timer->mutex) == FuriStatusOk);
}

void eddy_timer_tick(EddyTimer* timer) {
    uint32_t alarm = atomic_load(&timer->next_alarm);
    if(alarm && furi_hal_rtc_get_timestamp() >= alarm)
        eddy_timer_update(timer, EddyTimerRead, NULL);
}
