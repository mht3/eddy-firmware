#include "loader_quick_settings.h"
#include <assets_icons.h>
#include <notification/notification_app.h>

typedef enum {
    QuickBrightness,
    QuickVolume,
    QuickDetails,
    QuickCount,
} QuickItem;

typedef struct {
    NotificationApp* notification;
    void (*open_details)(void*);
    void* context;
    QuickItem selected;
    bool changed;
} QuickSettings;

static const NotificationSequence volume_preview = {
    &message_note_c5,
    &message_delay_100,
    &message_sound_off,
    NULL,
};

static unsigned level_percent(float level) {
    return (unsigned)(CLAMP(level, 1.0f, 0.0f) * 100.0f + 0.5f);
}

static void quick_draw(Canvas* canvas, void* context) {
    const QuickSettings* model = context;
    const NotificationSettings* settings = &model->notification->settings;
    const char* labels[] = {"Brightness", "Volume", "Settings"};
    const Icon* icons[] = {&I_Pin_star_7x7, &I_Volup_8x6, &I_CC_Settings_16x16};
    for(size_t i = 0; i < QuickCount; i++) {
        const int x = 21 + i * 42;
        canvas_draw_rframe(canvas, x - 13, 10, 27, 29, 5);
        if(i == model->selected) canvas_draw_rframe(canvas, x - 15, 8, 31, 33, 6);
        if(i != QuickDetails) {
            unsigned pct = level_percent(
                i == QuickBrightness ? settings->display_brightness : settings->speaker_volume);
            int height = (23 * pct + 50) / 100;
            if(height) canvas_draw_box(canvas, x - 10, 36 - height, 21, height);
            canvas_set_color(canvas, ColorXOR);
        }
        canvas_draw_icon(
            canvas, x - icon_get_width(icons[i]) / 2, 24 - icon_get_height(icons[i]) / 2, icons[i]);
        canvas_set_color(canvas, ColorBlack);
        canvas_set_font(canvas, FontSecondary);
        canvas_draw_str_aligned(canvas, x, 49, AlignCenter, AlignBottom, labels[i]);
    }
    char hint[28];
    if(model->selected == QuickDetails) {
        canvas_draw_str_aligned(
            canvas, 64, 62, AlignCenter, AlignBottom, "OK for device settings");
    } else {
        unsigned pct = level_percent(
            model->selected == QuickBrightness ? settings->display_brightness :
                                                 settings->speaker_volume);
        snprintf(hint, sizeof(hint), "%u%%   Up / Down", pct);
        canvas_draw_str_aligned(canvas, 64, 62, AlignCenter, AlignBottom, hint);
    }
}

static bool quick_input(InputEvent* event, void* context) {
    if(event->type != InputTypeShort && event->type != InputTypeRepeat) return false;
    View* view = context;
    QuickSettings* model = view_get_model(view);
    bool handled = true;
    if(event->key == InputKeyLeft || event->key == InputKeyRight) {
        model->selected =
            (model->selected + (event->key == InputKeyLeft ? QuickCount - 1 : 1)) % QuickCount;
    } else if(
        model->selected == QuickDetails && event->key == InputKeyOk &&
        event->type == InputTypeShort) {
        model->open_details(model->context);
    } else if(
        model->selected != QuickDetails &&
        (event->key == InputKeyUp || event->key == InputKeyDown)) {
        const bool brightness = model->selected == QuickBrightness;
        float* level = brightness ? &model->notification->settings.display_brightness :
                                    &model->notification->settings.speaker_volume;
        int next = (int)level_percent(*level) + (event->key == InputKeyUp ? 5 : -5);
        *level = CLAMP(next, 100, 0) / 100.0f;
        model->changed = true;
        notification_message(
            model->notification, brightness ? &sequence_display_backlight_on : &volume_preview);
    } else {
        handled = false;
    }
    view_commit_model(view, handled);
    return handled;
}

static void quick_settings_exit(void* context) {
    View* view = context;
    with_view_model(
        view,
        QuickSettings * model,
        {
            if(model->changed) {
                notification_message_save_settings(model->notification);
                model->changed = false;
            }
        },
        false);
}

View* loader_quick_settings_alloc(void (*open_details)(void*), void* context) {
    View* view = view_alloc();
    view_allocate_model(view, ViewModelTypeLocking, sizeof(QuickSettings));
    with_view_model(
        view,
        QuickSettings * model,
        {
            model->selected = QuickBrightness;
            model->notification = furi_record_open(RECORD_NOTIFICATION);
            model->open_details = open_details;
            model->context = context;
            model->changed = false;
        },
        false);
    view_set_context(view, view);
    view_set_draw_callback(view, quick_draw);
    view_set_input_callback(view, quick_input);
    view_set_exit_callback(view, quick_settings_exit);
    return view;
}

void loader_quick_settings_free(View* view) {
    view_free(view);
    furi_record_close(RECORD_NOTIFICATION);
}
