#include <furi.h>
#include <furi_hal_rtc.h>
#include <gui/gui.h>
#include <gui/view_dispatcher.h>
#include <notification/notification_messages.h>
#include <storage/storage.h>
#include <toolbox/saved_struct.h>
#include <stdio.h>

#define TIMER_PATH    INT_PATH(".eddy_focus")
#define FOCUS_SECONDS (25U * 60U)
#define BREAK_SECONDS (5U * 60U)

typedef struct {
    uint32_t remaining;
    uint32_t deadline;
    uint8_t on_break;
} TimerState;

static void timer_save(const TimerState* timer) {
    saved_struct_save(TIMER_PATH, timer, sizeof(*timer), 0xE7, 1);
}

static bool timer_advance(TimerState* timer, uint32_t now) {
    if(!timer->deadline || now < timer->deadline) return false;
    if(!timer->on_break && now - timer->deadline < BREAK_SECONDS) {
        timer->on_break = 1;
        timer->remaining = BREAK_SECONDS;
        timer->deadline += BREAK_SECONDS;
    } else {
        *timer = (TimerState){.remaining = FOCUS_SECONDS};
    }
    return true;
}

static uint32_t seconds_left(const TimerState* timer, uint32_t now) {
    if(!timer->deadline) return timer->remaining;
    return timer->deadline > now ?
               MIN(timer->deadline - now, timer->on_break ? BREAK_SECONDS : FOCUS_SECONDS) :
               0;
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
    const char* controls = "OK start   Left reset";
    if(timer->deadline)
        controls = "OK pause   Left reset";
    else if(seconds < (timer->on_break ? BREAK_SECONDS : FOCUS_SECONDS))
        controls = "OK resume   Left reset";
    canvas_draw_str_aligned(canvas, 64, 61, AlignCenter, AlignBottom, controls);
}

static bool timer_input(InputEvent* event, void* context) {
    if(event->type != InputTypeShort || (event->key != InputKeyOk && event->key != InputKeyLeft))
        return false;
    View* view = context;
    uint32_t now = furi_hal_rtc_get_timestamp();
    with_view_model(
        view,
        TimerState * timer,
        {
            timer_advance(timer, now);
            if(event->key == InputKeyLeft)
                *timer = (TimerState){.remaining = FOCUS_SECONDS};
            else if(timer->deadline) {
                timer->remaining = seconds_left(timer, now);
                timer->deadline = 0;
            } else
                timer->deadline = now + timer->remaining;
            timer_save(timer);
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
            if(!saved_struct_load(TIMER_PATH, timer, sizeof(*timer), 0xE7, 1) ||
               timer->on_break > 1 || !timer->remaining || timer->remaining > FOCUS_SECONDS) {
                *timer = (TimerState){.remaining = FOCUS_SECONDS};
            }
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
