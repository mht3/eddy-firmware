#include "../infrared_app_i.h"

typedef struct {
    const char* model;
    const char* title;
    InfraredProtocol protocol;
    uint16_t address;
    uint16_t commands[6];
    const char* const* labels;
} TvPreset;

// Each row of the pad pairs related controls. The Roku remote uses navigation
// commands in place of tuner controls (32S327 has no dedicated channel keys).
static const char* const tv_labels[] = {"Power", "Mute", "Vol -", "Vol +", "CH -", "CH +"};
static const char* const roku_labels[] = {"Power", "Home", "Vol -", "Vol +", "Exit", "D-pad"};

static const TvPreset presets[] = {
    // Samsung TV profile from the fork's original Samsung.ir.
    {"Samsung TV",
     "Samsung TV",
     InfraredProtocolSamsung32,
     0x07,
     {0x02, 0x0F, 0x0B, 0x07, 0x10, 0x12},
     tv_labels},
    // LG's TV IR Codes reference (KROWM000086145), NEC address 04.
    {"LG TV", "LG TV", InfraredProtocolNEC, 0x04, {0x08, 0x09, 0x03, 0x02, 0x01, 0x00}, tv_labels},
    // TCL LED49D2930 with RC3000E02, from resources/infrared/assets/tv.ir.
    {"TCL (RC3000E02)",
     "TCL TV",
     InfraredProtocolRCA,
     0x0F,
     {0x54, 0xFC, 0x74, 0xF4, 0x34, 0xB4},
     tv_labels},
    // Flipper-IRDB, TVs/TCL/TCL_32S327.ir. NECext file fields are little-endian.
    {"TCL Roku (32S327)",
     "TCL Roku TV",
     InfraredProtocolNECext,
     0xC7EA,
     {0xE817, 0xFC03, 0xEF10, 0xF00F, 0x9966, 0 /* opens D-pad */},
     roku_labels},
};

static const struct {
    InputKey key;
    const char* label;
    uint8_t x, y;
    uint16_t command;
} roku_keys[] = {
    {InputKeyUp, "Up", 64, 18, 0xE619},
    {InputKeyLeft, "Left", 35, 32, 0xE11E},
    {InputKeyOk, "OK", 64, 32, 0xD52A},
    {InputKeyRight, "Right", 93, 32, 0xD22D},
    {InputKeyDown, "Down", 64, 46, 0xCC33},
};

typedef struct {
    const TvPreset* preset;
    uint8_t button;
    uint8_t feedback_ticks;
    bool navigation;
    size_t last_key;
} TvPadModel;

static void choose_preset(void* context, uint32_t index) {
    InfraredApp* app = context;
    view_dispatcher_send_custom_event(app->view_dispatcher, index);
}

void infrared_scene_tv_presets_on_enter(void* context) {
    InfraredApp* app = context;
    submenu_set_header(app->submenu, "Choose your TV");
    for(size_t i = 0; i < COUNT_OF(presets); ++i)
        submenu_add_item(app->submenu, presets[i].model, i, choose_preset, app);
    submenu_set_selected_item(
        app->submenu, scene_manager_get_scene_state(app->scene_manager, InfraredSceneTvPresets));
    view_dispatcher_switch_to_view(app->view_dispatcher, InfraredViewSubmenu);
}

bool infrared_scene_tv_presets_on_event(void* context, SceneManagerEvent event) {
    InfraredApp* app = context;
    if(event.type != SceneManagerEventTypeCustom || event.event >= COUNT_OF(presets)) return false;
    scene_manager_set_scene_state(app->scene_manager, InfraredSceneTvPresets, event.event);
    scene_manager_next_scene(app->scene_manager, InfraredSceneTvPad);
    return true;
}

void infrared_scene_tv_presets_on_exit(void* context) {
    InfraredApp* app = context;
    submenu_reset(app->submenu);
}

static void tv_pad_draw(Canvas* canvas, void* context) {
    const TvPadModel* model = context;
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str(canvas, 3, 10, model->preset->title);
    canvas_set_font(canvas, FontSecondary);
    if(model->navigation) {
        for(size_t i = 0; i < COUNT_OF(roku_keys); ++i) {
            int x = roku_keys[i].x, y = roku_keys[i].y;
            if(model->feedback_ticks && model->last_key == i) {
                canvas_draw_rbox(canvas, x - 14, y - 6, 28, 13, 3);
                canvas_set_color(canvas, ColorWhite);
            } else {
                canvas_draw_rframe(canvas, x - 14, y - 6, 28, 13, 3);
            }
            canvas_draw_str_aligned(
                canvas, x, y + 4, AlignCenter, AlignBottom, roku_keys[i].label);
            canvas_set_color(canvas, ColorBlack);
        }
        canvas_draw_str_aligned(
            canvas, 64, 63, AlignCenter, AlignBottom, "Arrows / OK send  Back exits");
        return;
    }
    for(size_t i = 0; i < COUNT_OF(model->preset->commands); ++i) {
        uint8_t x = 3 + 62 * (i % 2), y = 13 + 14 * (i / 2);
        if(i == model->button) {
            canvas_draw_rbox(canvas, x, y, 59, 13, 3);
            canvas_set_color(canvas, ColorWhite);
        } else {
            canvas_draw_rframe(canvas, x, y, 59, 13, 3);
        }
        const bool roku = model->preset->labels == roku_labels;
        if(i == 0) {
            canvas_draw_circle(canvas, x + 10, y + 7, 3);
            canvas_draw_line(canvas, x + 10, y + 2, x + 10, y + 6);
        } else if(i == 1 && roku) {
            canvas_draw_line(canvas, x + 6, y + 6, x + 10, y + 2);
            canvas_draw_line(canvas, x + 10, y + 2, x + 14, y + 6);
            canvas_draw_frame(canvas, x + 7, y + 6, 7, 5);
        } else {
            const Icon* icons[] = {
                NULL,
                &I_Muted_8x8,
                &I_Voldwn_6x6,
                &I_Volup_8x6,
                roku ? &I_back_10px : &I_ButtonDown_7x4,
                roku ? &I_ButtonCenter_7x7 : &I_ButtonUp_7x4};
            const Icon* icon = icons[i];
            canvas_draw_icon(
                canvas, x + 10 - icon_get_width(icon) / 2, y + 6 - icon_get_height(icon) / 2, icon);
        }
        canvas_draw_str_aligned(
            canvas, x + 35, y + 10, AlignCenter, AlignBottom, model->preset->labels[i]);
        canvas_set_color(canvas, ColorBlack);
    }
    char footer[28];
    strlcpy(
        footer,
        model->button == 5 && model->preset->labels == roku_labels ? "OK: open D-pad" :
                                                                     "Choose a key   OK: send",
        sizeof(footer));
    if(model->feedback_ticks)
        snprintf(footer, sizeof(footer), "Sent: %s", model->preset->labels[model->button]);
    canvas_draw_str_aligned(canvas, 64, 63, AlignCenter, AlignBottom, footer);
}

static bool tv_pad_input(InputEvent* event, void* context) {
    InfraredApp* app = context;
    if(event->type != InputTypeShort && event->type != InputTypeRepeat) return false;
    TvPadModel* model = view_get_model(app->tv_pad);
    if(model->navigation) {
        if(event->key == InputKeyBack && event->type == InputTypeShort) {
            model->navigation = false;
            model->feedback_ticks = 0;
            view_commit_model(app->tv_pad, true);
            return true;
        }
        view_commit_model(app->tv_pad, false);
        for(size_t i = 0; i < COUNT_OF(roku_keys); ++i) {
            if(event->key == roku_keys[i].key && event->type == InputTypeShort) {
                view_dispatcher_send_custom_event(app->view_dispatcher, COUNT_OF(tv_labels) + i);
                return true;
            }
        }
        return false;
    }
    size_t button = model->button;
    if(model->preset->labels == roku_labels && button == 5 && event->key == InputKeyOk &&
       event->type == InputTypeShort) {
        model->navigation = true;
        model->feedback_ticks = 0;
        view_commit_model(app->tv_pad, true);
        return true;
    }
    bool handled = true;
    if(event->key == InputKeyLeft || event->key == InputKeyRight) {
        model->button ^= 1;
    } else if(event->key == InputKeyUp || event->key == InputKeyDown) {
        model->button = (button + (event->key == InputKeyUp ? 4 : 2)) % 6;
    } else {
        handled = event->key == InputKeyOk && event->type == InputTypeShort;
    }
    if(model->button != button) model->feedback_ticks = 0;
    view_commit_model(app->tv_pad, handled);
    if(handled && event->key == InputKeyOk)
        view_dispatcher_send_custom_event(app->view_dispatcher, button);
    return handled;
}

void infrared_scene_tv_pad_on_enter(void* context) {
    InfraredApp* app = context;
    size_t index = scene_manager_get_scene_state(app->scene_manager, InfraredSceneTvPresets);
    if(!app->tv_pad) {
        app->tv_pad = view_alloc();
        view_set_context(app->tv_pad, app);
        view_allocate_model(app->tv_pad, ViewModelTypeLocking, sizeof(TvPadModel));
        view_set_draw_callback(app->tv_pad, tv_pad_draw);
        view_set_input_callback(app->tv_pad, tv_pad_input);
        view_dispatcher_add_view(app->view_dispatcher, InfraredViewTvPad, app->tv_pad);
    }
    with_view_model(
        app->tv_pad,
        TvPadModel * m,
        {
            m->preset = &presets[index];
            m->navigation = false;
            m->button = 2; // Start on Volume Down so the user can test the profile.
            m->feedback_ticks = 0;
        },
        false);
    view_dispatcher_switch_to_view(app->view_dispatcher, InfraredViewTvPad);
}

bool infrared_scene_tv_pad_on_event(void* context, SceneManagerEvent event) {
    InfraredApp* app = context;
    if(event.type == SceneManagerEventTypeTick) {
        TvPadModel* model = view_get_model(app->tv_pad);
        bool expired = model->feedback_ticks && --model->feedback_ticks == 0;
        view_commit_model(app->tv_pad, expired);
        return true;
    }
    if(event.type != SceneManagerEventTypeCustom ||
       event.event >= COUNT_OF(tv_labels) + COUNT_OF(roku_keys))
        return false;
    const TvPreset* preset =
        &presets[scene_manager_get_scene_state(app->scene_manager, InfraredSceneTvPresets)];
    bool navigation = event.event >= COUNT_OF(tv_labels);
    size_t key = navigation ? event.event - COUNT_OF(tv_labels) : event.event;
    if((navigation && preset->labels != roku_labels) ||
       (!navigation && preset->labels == roku_labels && key == 5))
        return false;
    InfraredMessage message = {
        .protocol = preset->protocol,
        .address = preset->address,
        .command = navigation ? roku_keys[key].command : preset->commands[key],
        .repeat = false};
    infrared_signal_set_message(app->current_signal, &message);
    infrared_tx_send_once(app);
    with_view_model(
        app->tv_pad,
        TvPadModel * m,
        {
            m->feedback_ticks =
                m->navigation == navigation && (navigation || m->button == key) ? 8 : 0;
            m->last_key = key;
        },
        true);
    return true;
}

void infrared_scene_tv_pad_on_exit(void* context) {
    UNUSED(context);
}
