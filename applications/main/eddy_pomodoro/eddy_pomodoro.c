#include <desktop/eddy_timer.h>
#include <gui/gui.h>
#include <gui/view_dispatcher.h>
#include <stdio.h>

typedef struct {
    View* view;
    EddyTimer* timer;
} Pomodoro;

static void timer_draw(Canvas* canvas, void* context) {
    const EddyTimerState* timer = context;
    uint32_t seconds = timer->remaining;
    char time[12];
    snprintf(time, sizeof(time), "%02lu:%02lu", seconds / 60, seconds % 60);
    canvas_set_font(canvas, FontSecondary);
    canvas_draw_str(canvas, 3, 9, timer->on_break ? "Short break" : "Focus session");
    canvas_set_font(canvas, FontBigNumbers);
    canvas_draw_str_aligned(canvas, 64, 41, AlignCenter, AlignBottom, time);
    if(!timer->deadline) {
        if(seconds >= 60) {
            canvas_draw_line(canvas, 12, 32, 18, 26);
            canvas_draw_line(canvas, 12, 32, 18, 38);
        }
        if(seconds / 60 < EDDY_TIMER_MAX_SECONDS / 60) {
            canvas_draw_line(canvas, 115, 32, 109, 26);
            canvas_draw_line(canvas, 115, 32, 109, 38);
        }
    }
    canvas_set_font(canvas, FontSecondary);
    if(!timer->deadline)
        canvas_draw_str_aligned(
            canvas, 64, 51, AlignCenter, AlignBottom, "L/R: minutes   Up: +5s");
    const char* control = timer->deadline ? "OK pause" : "OK start";
    if(!timer->deadline &&
       seconds < (timer->on_break ? timer->break_seconds : timer->focus_seconds))
        control = "OK resume";
    canvas_draw_str(canvas, 2, 61, timer->muted ? "Down: muted" : "Down: sound on");
    canvas_draw_str_aligned(canvas, 126, 61, AlignRight, AlignBottom, control);
}

static void timer_refresh(Pomodoro* app, EddyTimerAction action) {
    EddyTimerState snapshot;
    eddy_timer_update(app->timer, action, &snapshot);
    with_view_model(app->view, EddyTimerState * model, { *model = snapshot; }, true);
}

static bool timer_input(InputEvent* event, void* context) {
    bool held = event->type == InputTypeLong || event->type == InputTypeRepeat;
    if(!held && event->type != InputTypeShort) return false;
    EddyTimerAction action;
    if(event->key == InputKeyLeft) {
        action = EddyTimerMinuteShorter;
    } else if(event->key == InputKeyRight) {
        action = EddyTimerMinuteLonger;
    } else if(!held && event->key == InputKeyOk) {
        action = EddyTimerToggleRunning;
    } else if(!held && event->key == InputKeyUp) {
        action = EddyTimerCycleSeconds;
    } else if(!held && event->key == InputKeyDown) {
        action = EddyTimerToggleSound;
    } else {
        return false;
    }
    timer_refresh(context, action);
    return true;
}

static void timer_tick(void* context) {
    timer_refresh(context, EddyTimerRead);
}

static uint32_t timer_back(void* ctx) {
    UNUSED(ctx);
    return VIEW_NONE;
}

int32_t eddy_pomodoro_app(void* args) {
    UNUSED(args);
    Gui* gui = furi_record_open(RECORD_GUI);
    ViewDispatcher* dispatcher = view_dispatcher_alloc();
    Pomodoro app = {.view = view_alloc(), .timer = furi_record_open(RECORD_EDDY_TIMER)};
    view_allocate_model(app.view, ViewModelTypeLocking, sizeof(EddyTimerState));
    timer_refresh(&app, EddyTimerRead);
    view_set_context(app.view, &app);
    view_set_draw_callback(app.view, timer_draw);
    view_set_input_callback(app.view, timer_input);
    view_set_previous_callback(app.view, timer_back);
    view_dispatcher_set_event_callback_context(dispatcher, &app);
    view_dispatcher_set_tick_event_callback(dispatcher, timer_tick, furi_ms_to_ticks(250));
    view_dispatcher_add_view(dispatcher, 0, app.view);
    view_dispatcher_attach_to_gui(dispatcher, gui, ViewDispatcherTypeFullscreen);
    view_dispatcher_switch_to_view(dispatcher, 0);
    view_dispatcher_run(dispatcher);
    view_dispatcher_remove_view(dispatcher, 0);
    view_free(app.view);
    view_dispatcher_free(dispatcher);
    furi_record_close(RECORD_EDDY_TIMER);
    furi_record_close(RECORD_GUI);
    return 0;
}
