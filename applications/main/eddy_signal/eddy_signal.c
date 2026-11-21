#include <furi.h>
#include <furi_hal_subghz.h>
#include <gui/gui.h>
#include <gui/elements.h>
#include <gui/modules/number_input.h>
#include <gui/view_dispatcher.h>
#include <lib/subghz/devices/cc1101_configs.h>
#include <stdio.h>
#include "../eddy_readers/observations.h"

typedef struct {
    int8_t samples[120];
    size_t count;
    size_t next;
    uint32_t frequency_khz;
} SignalHistory;

typedef struct {
    View* view;
    EddyNotes* notes;
    ViewDispatcher* dispatcher;
    Submenu* tuning;
    NumberInput* custom;
    uint32_t frequency_khz;
    int8_t window_peak;
    uint8_t window_samples;
    bool receiving;
} SignalMeter;

enum {
    SignalTune = ReaderSaved + 1,
    SignalCustom,
};

static const uint32_t presets_khz[] = {310000, 315000, 390000, 433920, 868350, 915000};
static const struct {
    const char* label;
    uint32_t min_khz;
    uint32_t max_khz;
} bands[] = {
    {"Other: 300-348 MHz", 300000, 348000},
    {"Other: 387-464 MHz", 387000, 464000},
    {"Other: 779-928 MHz", 779000, 928000},
};

static void format_frequency(char* text, size_t size, uint32_t khz) {
    snprintf(
        text, size, "%lu.%03lu MHz", (unsigned long)(khz / 1000), (unsigned long)(khz % 1000));
}

static void set_frequency(void* context, int32_t khz) {
    SignalMeter* meter = context;
    if(!furi_hal_subghz_is_frequency_valid((uint32_t)khz * 1000)) return;
    meter->frequency_khz = khz;
    view_dispatcher_switch_to_view(meter->dispatcher, ReaderScan);
}

static void tune_frequency(void* context, uint32_t index) {
    SignalMeter* meter = context;
    if(index < COUNT_OF(presets_khz)) {
        set_frequency(meter, presets_khz[index]);
        return;
    }
    size_t band = index - COUNT_OF(presets_khz);
    number_input_set_result_callback(
        meter->custom, set_frequency, meter, 0, bands[band].min_khz, bands[band].max_khz);
    view_dispatcher_switch_to_view(meter->dispatcher, SignalCustom);
}

static uint32_t back_to_tuning(void* context) {
    UNUSED(context);
    return SignalTune;
}

static int8_t signal_latest(const SignalHistory* history) {
    const size_t size = COUNT_OF(history->samples);
    return history->samples[(history->next + size - 1) % size];
}

static void signal_draw(Canvas* canvas, void* context) {
    const SignalHistory* history = context;
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str(canvas, 2, 10, "Signal Meter");
    canvas_set_font(canvas, FontSecondary);
    char label[20];
    format_frequency(label, sizeof(label), history->frequency_khz);
    canvas_draw_str_aligned(canvas, 125, 49, AlignRight, AlignBottom, label);
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
    elements_button_left(canvas, "Tune");
    elements_button_right(canvas, "Saved");
}

static void signal_sample(void* context) {
    SignalMeter* meter = context;
    if(!meter->receiving) return;
    // Keep short bursts visible without redrawing the LCD on every RSSI sample.
    int8_t strength = (int8_t)furi_hal_subghz_get_rssi();
    if(!meter->window_samples || strength > meter->window_peak) meter->window_peak = strength;
    if(++meter->window_samples < 10) return;
    meter->window_samples = 0;
    with_view_model(
        meter->view,
        SignalHistory * history,
        {
            history->samples[history->next] = meter->window_peak;
            history->next = (history->next + 1) % COUNT_OF(history->samples);
            if(history->count < COUNT_OF(history->samples)) history->count++;
        },
        true);
}

static void signal_enter(void* context) {
    SignalMeter* meter = context;
    meter->window_samples = 0;
    with_view_model(
        meter->view,
        SignalHistory * history,
        {
            history->count = history->next = 0;
            history->frequency_khz = meter->frequency_khz;
        },
        true);
    meter->receiving = furi_hal_subghz_set_frequency_and_path(meter->frequency_khz * 1000) != 0;
    if(meter->receiving) furi_hal_subghz_rx();
}

static void signal_exit(void* context) {
    SignalMeter* meter = context;
    meter->receiving = false;
    furi_hal_subghz_idle();
}

static bool signal_input(InputEvent* event, void* context) {
    if(event->type != InputTypeShort) return false;
    SignalMeter* meter = context;
    if(event->key == InputKeyLeft) {
        view_dispatcher_switch_to_view(meter->dispatcher, SignalTune);
        return true;
    }
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
            if(history->count) {
                char frequency[20];
                format_frequency(frequency, sizeof(frequency), history->frequency_khz);
                snprintf(
                    reading,
                    sizeof(reading),
                    "%d dBm at %s",
                    (int)signal_latest(history),
                    frequency);
            }
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
    SignalMeter meter = {
        .view = view,
        .dispatcher = dispatcher,
        .notes = eddy_notes_alloc(dispatcher, "Sub-GHz"),
        .tuning = submenu_alloc(),
        .custom = number_input_alloc(),
        .frequency_khz = 433920,
    };
    submenu_set_header(meter.tuning, "Tune receiver");
    for(size_t i = 0; i < COUNT_OF(presets_khz); i++) {
        char label[20];
        format_frequency(label, sizeof(label), presets_khz[i]);
        submenu_add_item(meter.tuning, label, i, tune_frequency, &meter);
    }
    for(size_t i = 0; i < COUNT_OF(bands); i++) {
        submenu_add_item(
            meter.tuning, bands[i].label, COUNT_OF(presets_khz) + i, tune_frequency, &meter);
    }
    submenu_set_selected_item(meter.tuning, 3);
    number_input_set_header_text(meter.custom, "Receive frequency (kHz)");
    view_set_previous_callback(submenu_get_view(meter.tuning), back_to_scan);
    view_set_previous_callback(number_input_get_view(meter.custom), back_to_tuning);
    view_dispatcher_add_view(dispatcher, SignalTune, submenu_get_view(meter.tuning));
    view_dispatcher_add_view(dispatcher, SignalCustom, number_input_get_view(meter.custom));
    view_set_context(view, &meter);
    view_allocate_model(view, ViewModelTypeLocking, sizeof(SignalHistory));
    view_set_draw_callback(view, signal_draw);
    view_set_input_callback(view, signal_input);
    view_set_enter_callback(view, signal_enter);
    view_set_exit_callback(view, signal_exit);
    view_set_previous_callback(view, signal_back);
    view_dispatcher_set_event_callback_context(dispatcher, &meter);
    view_dispatcher_set_custom_event_callback(dispatcher, signal_event);
    view_dispatcher_set_tick_event_callback(dispatcher, signal_sample, furi_ms_to_ticks(10));
    view_dispatcher_add_view(dispatcher, 0, view);
    view_dispatcher_attach_to_gui(dispatcher, gui, ViewDispatcherTypeFullscreen);

    furi_hal_subghz_load_custom_preset(subghz_device_cc1101_preset_ook_270khz_async_regs);
    view_dispatcher_switch_to_view(dispatcher, 0);
    view_dispatcher_run(dispatcher);
    view_dispatcher_remove_view(dispatcher, 0);
    view_dispatcher_remove_view(dispatcher, SignalCustom);
    view_dispatcher_remove_view(dispatcher, SignalTune);
    number_input_free(meter.custom);
    submenu_free(meter.tuning);
    furi_hal_subghz_sleep();
    eddy_notes_free(meter.notes);
    view_free(view);
    view_dispatcher_free(dispatcher);
    furi_record_close(RECORD_GUI);
    return 0;
}
