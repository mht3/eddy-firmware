#include <furi.h>
#include <furi_hal_rtc.h>
#include <gui/gui.h>
#include <gui/view_dispatcher.h>
#include <notification/notification_messages.h>
#include <storage/storage.h>
#include <toolbox/saved_struct.h>
#include <stdio.h>

#define TIMER_PATH            INT_PATH(".eddy_focus")
#define DEFAULT_FOCUS_MINUTES 25U
#define DEFAULT_BREAK_MINUTES 5U
#define MAX_MINUTES           99U

typedef struct {
    uint32_t remaining;
    uint32_t deadline;
    uint8_t on_break;
    uint8_t focus_minutes;
    uint8_t break_minutes;
    uint8_t reserved;
} TimerState;

// The three bytes after on_break were padding in version 1.
_Static_assert(sizeof(TimerState) == 12, "Pomodoro save layout changed");

static uint32_t session_seconds(const TimerState* timer) {
    return 60U * (timer->on_break ? timer->break_minutes : timer->focus_minutes);
}

static void timer_load(TimerState* timer) {
    *timer = (TimerState){0};
    if(!saved_struct_load(TIMER_PATH, timer, sizeof(*timer), 0xE7, 2) &&
       saved_struct_load(TIMER_PATH, timer, sizeof(*timer), 0xE7, 1)) {
        timer->focus_minutes = DEFAULT_FOCUS_MINUTES;
        timer->break_minutes = DEFAULT_BREAK_MINUTES;
        timer->reserved = 0;
    }
    if(timer->on_break > 1 || !timer->focus_minutes || timer->focus_minutes > MAX_MINUTES ||
       !timer->break_minutes || timer->break_minutes > MAX_MINUTES || !timer->remaining ||
       timer->remaining > session_seconds(timer)) {
        *timer = (TimerState){
            .focus_minutes = DEFAULT_FOCUS_MINUTES,
            .break_minutes = DEFAULT_BREAK_MINUTES,
            .remaining = 60U * DEFAULT_FOCUS_MINUTES,
        };
    }
}

static void timer_save(const TimerState* timer) {
    saved_struct_save(TIMER_PATH, timer, sizeof(*timer), 0xE7, 2);
}

static bool timer_advance(TimerState* timer, uint32_t now) {
    if(!timer->deadline || now < timer->deadline) return false;
    if(!timer->on_break && now - timer->deadline < 60U * timer->break_minutes) {
        timer->on_break = 1;
        timer->remaining = session_seconds(timer);
        timer->deadline += timer->remaining;
    } else {
        timer->on_break = 0;
        timer->deadline = 0;
        timer->remaining = session_seconds(timer);
    }
    return true;
}

static uint32_t seconds_left(const TimerState* timer, uint32_t now) {
    if(!timer->deadline) return timer->remaining;
    return timer->deadline > now ? MIN(timer->deadline - now, session_seconds(timer)) : 0;
}

static void timer_draw(Canvas* canvas, void* context) {
    TimerState* timer = context;
    uint32_t seconds = seconds_left(timer, furi_hal_rtc_get_timestamp());
    char time[12];
    snprintf(time, sizeof(time), "%02lu:%02lu", seconds / 60, seconds % 60);
    canvas_set_font(canvas, FontSecondary);
    canvas_draw_str_aligned(
        canvas, 3, 11, AlignLeft, AlignBottom, timer->on_break ? "Short break" : "Focus session");
    canvas_set_font(canvas, FontBigNumbers);
    canvas_draw_str_aligned(canvas, 64, 42, AlignCenter, AlignBottom, time);
    canvas_set_font(canvas, FontSecondary);
    if(!timer->deadline) {
        if(seconds > 60U) {
            canvas_draw_line(canvas, 12, 32, 18, 26);
            canvas_draw_line(canvas, 12, 32, 18, 38);
        }
        if(seconds < 60U * MAX_MINUTES) {
            canvas_draw_line(canvas, 115, 32, 109, 26);
            canvas_draw_line(canvas, 115, 32, 109, 38);
        }
    }
    const char* controls = "OK start";
    if(timer->deadline)
        controls = "OK pause";
    else if(seconds < session_seconds(timer))
        controls = "OK resume";
    canvas_draw_str_aligned(canvas, 64, 61, AlignCenter, AlignBottom, controls);
}

static bool timer_adjust(TimerState* timer, bool increase) {
    if(timer->deadline || (increase && timer->remaining >= 60U * MAX_MINUTES) ||
       (!increase && timer->remaining <= 60U))
        return false;
    const uint32_t minutes = increase ? timer->remaining / 60U + 1 : (timer->remaining - 1) / 60U;
    if(timer->on_break)
        timer->break_minutes = minutes;
    else
        timer->focus_minutes = minutes;
    timer->remaining = minutes * 60U;
    return true;
}

static bool timer_input(InputEvent* event, void* context) {
    const bool arrow = event->key == InputKeyLeft || event->key == InputKeyRight;
    if(event->type != InputTypeShort || (!arrow && event->key != InputKeyOk)) return false;
    View* view = context;
    uint32_t now = furi_hal_rtc_get_timestamp();
    with_view_model(
        view,
        TimerState * timer,
        {
            bool changed = timer_advance(timer, now);
            if(arrow) {
                if(timer_adjust(timer, event->key == InputKeyRight)) changed = true;
            } else {
                if(timer->deadline) {
                    timer->remaining = seconds_left(timer, now);
                    timer->deadline = 0;
                } else {
                    timer->deadline = now + timer->remaining;
                }
                changed = true;
            }
            if(changed) timer_save(timer);
        },
        true);
    return true;
}

static void timer_tick(void* context) {
    View* view = context;
    bool finished = false;
    with_view_model(
        view,
        TimerState * timer,
        {
            finished = timer_advance(timer, furi_hal_rtc_get_timestamp());
            if(finished) timer_save(timer);
        },
        true);
    if(finished) {
        NotificationApp* notifications = furi_record_open(RECORD_NOTIFICATION);
        notification_message(notifications, &sequence_success);
        furi_record_close(RECORD_NOTIFICATION);
    }
}

static uint32_t timer_back(void* ctx) {
    UNUSED(ctx);
    return VIEW_NONE;
}

int32_t eddy_pomodoro_app(void* args) {
    UNUSED(args);
    Gui* gui = furi_record_open(RECORD_GUI);
    ViewDispatcher* dispatcher = view_dispatcher_alloc();
    View* view = view_alloc();
    view_allocate_model(view, ViewModelTypeLocking, sizeof(TimerState));
    with_view_model(
        view,
        TimerState * timer,
        {
            timer_load(timer);
            if(timer_advance(timer, furi_hal_rtc_get_timestamp())) timer_save(timer);
        },
        false);
    view_set_context(view, view);
    view_set_draw_callback(view, timer_draw);
    view_set_input_callback(view, timer_input);
    view_set_previous_callback(view, timer_back);
    view_dispatcher_set_event_callback_context(dispatcher, view);
    view_dispatcher_set_tick_event_callback(dispatcher, timer_tick, furi_ms_to_ticks(1000));
    view_dispatcher_add_view(dispatcher, 0, view);
    view_dispatcher_attach_to_gui(dispatcher, gui, ViewDispatcherTypeFullscreen);
    view_dispatcher_switch_to_view(dispatcher, 0);
    view_dispatcher_run(dispatcher);
    view_dispatcher_remove_view(dispatcher, 0);
    view_free(view);
    view_dispatcher_free(dispatcher);
    furi_record_close(RECORD_GUI);
    return 0;
}
