#include <furi.h>
#include <furi_hal_subghz.h>
#include <gui/gui.h>
#include <gui/view_dispatcher.h>
#include <stdio.h>

typedef struct {
    int8_t samples[120];
    size_t count;
    size_t next;
} SignalHistory;

static void signal_draw(Canvas* canvas, void* context) {
    const SignalHistory* history = context;
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str(canvas, 2, 10, "Signal Meter");
    canvas_set_font(canvas, FontSecondary);
    canvas_draw_str(canvas, 77, 10, "433.92 MHz");
    canvas_draw_frame(canvas, 2, 15, 124, 37);
    for(size_t i = 0; i < history->count; i++) {
        size_t idx = (history->next + COUNT_OF(history->samples) - history->count + i) %
                     COUNT_OF(history->samples);
        int height = CLAMP((history->samples[idx] + 110) / 2, 34, 1);
        canvas_draw_line(canvas, i + 4, 50, i + 4, 51 - height);
    }
    if(history->count) {
        size_t latest =
            (history->next + COUNT_OF(history->samples) - 1) % COUNT_OF(history->samples);
        char value[16];
        snprintf(value, sizeof(value), "%d dBm", (int)history->samples[latest]);
        canvas_draw_str(canvas, 3, 62, value);
    }
    canvas_draw_str(canvas, 75, 62, "Receive only");
}

static void signal_sample(void* context) {
    View* view = context;
    with_view_model(
        view,
        SignalHistory * history,
        {
            history->samples[history->next] = (int8_t)furi_hal_subghz_get_rssi();
            history->next = (history->next + 1) % COUNT_OF(history->samples);
            if(history->count < COUNT_OF(history->samples)) history->count++;
        },
        true);
}

static uint32_t signal_back(void* context) {
    UNUSED(context);
    return VIEW_NONE;
}

int32_t eddy_signal_app(void* arg) {
    UNUSED(arg);
    Gui* gui = furi_record_open(RECORD_GUI);
    ViewDispatcher* dispatcher = view_dispatcher_alloc();
    View* view = view_alloc();
    view_allocate_model(view, ViewModelTypeLocking, sizeof(SignalHistory));
    view_set_draw_callback(view, signal_draw);
    view_set_previous_callback(view, signal_back);
    view_dispatcher_set_event_callback_context(dispatcher, view);
    view_dispatcher_set_tick_event_callback(dispatcher, signal_sample, furi_ms_to_ticks(100));
    view_dispatcher_add_view(dispatcher, 0, view);
    view_dispatcher_attach_to_gui(dispatcher, gui, ViewDispatcherTypeFullscreen);

    furi_hal_subghz_reset();
    furi_hal_subghz_set_frequency_and_path(433920000);
    furi_hal_subghz_rx();
    view_dispatcher_switch_to_view(dispatcher, 0);
    view_dispatcher_run(dispatcher);
    furi_hal_subghz_idle();
    furi_hal_subghz_sleep();

    view_dispatcher_remove_view(dispatcher, 0);
    view_free(view);
    view_dispatcher_free(dispatcher);
    furi_record_close(RECORD_GUI);
    return 0;
}
