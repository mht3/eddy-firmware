#include <furi.h>
#include <furi_hal_subghz.h>
#include <gui/gui.h>
#include <gui/elements.h>
#include <gui/view_dispatcher.h>
#include <stdio.h>
#include "../eddy_readers/observations.h"

typedef struct {
    int8_t samples[120];
    size_t count;
    size_t next;
} SignalHistory;

typedef struct {
    View* view;
    EddyNotes* notes;
    bool receiving;
} SignalMeter;

static int8_t signal_latest(const SignalHistory* history) {
    const size_t size = COUNT_OF(history->samples);
    return history->samples[(history->next + size - 1) % size];
}

static void signal_draw(Canvas* canvas, void* context) {
    const SignalHistory* history = context;
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str(canvas, 2, 10, "Signal Meter");
    canvas_set_font(canvas, FontSecondary);
    canvas_draw_str(canvas, 76, 49, "433.92 MHz");
    canvas_draw_frame(canvas, 2, 13, 124, 27);
    for(size_t i = 0; i < history->count; i++) {
        size_t idx = (history->next + COUNT_OF(history->samples) - history->count + i) %
                     COUNT_OF(history->samples);
        int height = CLAMP((history->samples[idx] + 110) / 3, 24, 1);
        canvas_draw_line(canvas, i + 4, 38, i + 4, 39 - height);
    }
    if(history->count) {
        char value[16];
        snprintf(value, sizeof(value), "%d dBm", (int)signal_latest(history));
        canvas_draw_str(canvas, 3, 49, value);
        elements_button_center(canvas, "Save");
    }
    elements_button_right(canvas, "Saved");
}

static void signal_sample(void* context) {
    SignalMeter* meter = context;
    if(!meter->receiving) return;
    with_view_model(
        meter->view,
        SignalHistory * history,
        {
            history->samples[history->next] = (int8_t)furi_hal_subghz_get_rssi();
            history->next = (history->next + 1) % COUNT_OF(history->samples);
            if(history->count < COUNT_OF(history->samples)) history->count++;
        },
        true);
}

static void signal_enter(void* context) {
    SignalMeter* meter = context;
    with_view_model(
        meter->view, SignalHistory * history, { history->count = history->next = 0; }, false);
    furi_hal_subghz_rx();
    meter->receiving = true;
}

static void signal_exit(void* context) {
    SignalMeter* meter = context;
    meter->receiving = false;
    furi_hal_subghz_idle();
}

static bool signal_input(InputEvent* event, void* context) {
    if(event->type != InputTypeShort) return false;
    SignalMeter* meter = context;
    if(event->key == InputKeyRight) {
        eddy_notes_browse(meter->notes);
        return true;
    }
    if(event->key != InputKeyOk) return false;

    char reading[32] = "";
    with_view_model(
        meter->view,
        SignalHistory * history,
        {
            if(history->count)
                snprintf(
                    reading, sizeof(reading), "%d dBm at 433.92 MHz", (int)signal_latest(history));
        },
        false);
    if(reading[0]) eddy_notes_save(meter->notes, reading);
    return true;
}

static bool signal_event(void* context, uint32_t event) {
    SignalMeter* meter = context;
    return eddy_notes_event(meter->notes, event);
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
    SignalMeter meter = {.view = view, .notes = eddy_notes_alloc(dispatcher, "Sub-GHz")};
    view_set_context(view, &meter);
    view_allocate_model(view, ViewModelTypeLocking, sizeof(SignalHistory));
    view_set_draw_callback(view, signal_draw);
    view_set_input_callback(view, signal_input);
    view_set_enter_callback(view, signal_enter);
    view_set_exit_callback(view, signal_exit);
    view_set_previous_callback(view, signal_back);
    view_dispatcher_set_event_callback_context(dispatcher, &meter);
    view_dispatcher_set_custom_event_callback(dispatcher, signal_event);
    view_dispatcher_set_tick_event_callback(dispatcher, signal_sample, furi_ms_to_ticks(100));
    view_dispatcher_add_view(dispatcher, 0, view);
    view_dispatcher_attach_to_gui(dispatcher, gui, ViewDispatcherTypeFullscreen);

    furi_hal_subghz_reset();
    furi_hal_subghz_set_frequency_and_path(433920000);
    view_dispatcher_switch_to_view(dispatcher, 0);
    view_dispatcher_run(dispatcher);
    view_dispatcher_remove_view(dispatcher, 0);
    furi_hal_subghz_sleep();
    eddy_notes_free(meter.notes);
    view_free(view);
    view_dispatcher_free(dispatcher);
    furi_record_close(RECORD_GUI);
    return 0;
}
