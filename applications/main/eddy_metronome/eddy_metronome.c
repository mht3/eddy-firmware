#include <furi.h>
#include <gui/view_dispatcher.h>
#include <notification/notification_messages.h>
#include <storage/storage.h>
#include <toolbox/saved_struct.h>
#include <stdio.h>
#include <string.h>

#define TEMPO_PATH INT_PATH(".eddy_tempo")
#define MIN_BPM    40U
#define MAX_BPM    220U

typedef struct {
    uint8_t bpm;
    uint8_t beat;
    bool playing;
    bool awaiting_tap;
} MetronomeModel;

typedef struct {
    View* view;
    NotificationApp* notifications;
    FuriEventLoopTimer* timer;
    uint32_t taps[5];
    size_t tap_count;
} Metronome;

static void metronome_draw(Canvas* canvas, void* context) {
    const MetronomeModel* model = context;
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str(canvas, 2, 9, "Metronome");
    char tempo[5];
    snprintf(tempo, sizeof(tempo), "%u", (unsigned)model->bpm);
    canvas_set_font(canvas, FontBigNumbers);
    canvas_draw_str_aligned(canvas, 59, 32, AlignCenter, AlignBottom, tempo);
    canvas_set_font(canvas, FontSecondary);
    canvas_draw_str(canvas, 83, 32, "BPM");
    if(model->bpm > MIN_BPM) {
        canvas_draw_line(canvas, 10, 25, 14, 21);
        canvas_draw_line(canvas, 10, 25, 14, 29);
    }
    if(model->bpm < MAX_BPM) {
        canvas_draw_line(canvas, 117, 25, 113, 21);
        canvas_draw_line(canvas, 117, 25, 113, 29);
    }
    for(unsigned i = 0; i < 4; ++i) {
        int x = 30 + 18 * i;
        if(model->playing && model->beat == i)
            canvas_draw_rbox(canvas, x, 39, 14, 7, 2);
        else
            canvas_draw_rframe(canvas, x, 39, 14, 7, 2);
    }
    canvas_draw_str(canvas, 3, 60, model->awaiting_tap ? "Tap Up again" : "Up: tap tempo");
    canvas_draw_str_aligned(
        canvas, 125, 60, AlignRight, AlignBottom, model->playing ? "OK: stop" : "OK: start");
}

// Average up to four intervals. Unsigned subtraction also covers a tick-counter rollover.
static void tap_tempo(Metronome* app, uint32_t now, uint32_t frequency, uint8_t* bpm) {
    if(app->tap_count) {
        uint32_t gap = now - app->taps[app->tap_count - 1];
        if(gap < frequency / 5) return;
        if(gap > frequency * 2) app->tap_count = 0;
    }
    if(app->tap_count == COUNT_OF(app->taps)) {
        --app->tap_count;
        memmove(app->taps, app->taps + 1, app->tap_count * sizeof(app->taps[0]));
    }
    app->taps[app->tap_count++] = now;
    if(app->tap_count < 2) return;
    uint32_t span = now - app->taps[0];
    uint32_t estimate = (60U * frequency * (app->tap_count - 1) + span / 2) / span;
    *bpm = CLAMP(estimate, MAX_BPM, MIN_BPM);
}

static void metronome_beat(void* context) {
    Metronome* app = context;
    with_view_model(
        app->view, MetronomeModel * model, { model->beat = (model->beat + 1) % 4; }, true);
    notification_message(app->notifications, &sequence_single_vibro);
}

static bool metronome_input(InputEvent* event, void* context) {
    Metronome* app = context;
    bool tap = event->key == InputKeyUp && event->type == InputTypePress;
    bool toggle = event->key == InputKeyOk && event->type == InputTypeShort;
    bool adjust = (event->key == InputKeyLeft || event->key == InputKeyRight) &&
                  (event->type == InputTypeShort || event->type == InputTypeRepeat);
    if(!tap && !toggle && !adjust) return false;

    uint32_t frequency = furi_kernel_get_tick_frequency();
    MetronomeModel* model = view_get_model(app->view);
    uint8_t previous = model->bpm;
    bool was_awaiting_tap = model->awaiting_tap;
    if(tap) {
        tap_tempo(app, furi_get_tick(), frequency, &model->bpm);
        model->awaiting_tap = app->tap_count == 1;
    } else if(toggle) {
        app->tap_count = 0;
        model->awaiting_tap = false;
        model->playing = !model->playing;
        model->beat = 0;
    } else {
        app->tap_count = 0;
        model->awaiting_tap = false;
        model->bpm = CLAMP(
            (int)model->bpm + (event->key == InputKeyRight ? 1 : -1), (int)MAX_BPM, (int)MIN_BPM);
    }
    bool playing = model->playing;
    uint8_t bpm = model->bpm;
    bool redraw = toggle || bpm != previous || model->awaiting_tap != was_awaiting_tap;
    view_commit_model(app->view, redraw);
    if(playing && (toggle || bpm != previous)) {
        furi_event_loop_timer_start(app->timer, (60U * frequency + bpm / 2) / bpm);
        if(toggle) notification_message(app->notifications, &sequence_single_vibro);
    } else if(toggle) {
        furi_event_loop_timer_stop(app->timer);
    }
    return true;
}

static uint32_t metronome_back(void* context) {
    UNUSED(context);
    return VIEW_NONE;
}

int32_t eddy_metronome_app(void* argument) {
    UNUSED(argument);
    uint8_t initial_bpm;
    if(!saved_struct_load(TEMPO_PATH, &initial_bpm, sizeof(initial_bpm), 0xEC, 1) ||
       initial_bpm < MIN_BPM || initial_bpm > MAX_BPM)
        initial_bpm = 96;
    Gui* gui = furi_record_open(RECORD_GUI);
    ViewDispatcher* dispatcher = view_dispatcher_alloc();
    Metronome app = {.view = view_alloc(), .notifications = furi_record_open(RECORD_NOTIFICATION)};
    app.timer = furi_event_loop_timer_alloc(
        view_dispatcher_get_event_loop(dispatcher),
        metronome_beat,
        FuriEventLoopTimerTypePeriodic,
        &app);
    view_allocate_model(app.view, ViewModelTypeLocking, sizeof(MetronomeModel));
    with_view_model(
        app.view,
        MetronomeModel * model,
        { *model = (MetronomeModel){.bpm = initial_bpm}; },
        false);
    view_set_context(app.view, &app);
    view_set_draw_callback(app.view, metronome_draw);
    view_set_input_callback(app.view, metronome_input);
    view_set_previous_callback(app.view, metronome_back);
    view_dispatcher_add_view(dispatcher, 0, app.view);
    view_dispatcher_attach_to_gui(dispatcher, gui, ViewDispatcherTypeFullscreen);
    view_dispatcher_switch_to_view(dispatcher, 0);
    view_dispatcher_run(dispatcher);
    furi_event_loop_timer_free(app.timer);
    MetronomeModel* model = view_get_model(app.view);
    uint8_t last_bpm = model->bpm;
    view_commit_model(app.view, false);
    if(last_bpm != initial_bpm)
        saved_struct_save(TEMPO_PATH, &last_bpm, sizeof(last_bpm), 0xEC, 1);
    view_dispatcher_remove_view(dispatcher, 0);
    view_free(app.view);
    view_dispatcher_free(dispatcher);
    furi_record_close(RECORD_NOTIFICATION);
    furi_record_close(RECORD_GUI);
    return 0;
}
