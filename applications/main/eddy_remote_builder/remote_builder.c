#include "layout.h"
#include <assets_icons.h>
#include <infrared/remote/infrared_remote.h>
#include <infrared/remote/tv_presets.h>
#include <toolbox/dir_walk.h>
#include <toolbox/path.h>
#include <gui/modules/dialog_ex.h>
#include <gui/modules/submenu.h>
#include <gui/modules/text_input.h>
#include <gui/view_dispatcher.h>
#include <infrared/worker/infrared_worker.h>
#include <toolbox/eddy_remote_shortcut.h>
#include <string.h>

typedef enum {
    Library,
    NewName,
    Grid,
    Stock,
    Learn,
    SaveLabel,
    Options,
    RenameLabel,
    Move,
    ConfirmRemove,
    ConfirmDelete,
    Presets,
    Error
} Screen;

typedef enum {
    GridView,
    MenuView,
    InputView,
    DialogView
} BuilderView;
typedef enum {
    GlyphPower,
    GlyphVolUp,
    GlyphVolDown,
    GlyphMute,
    GlyphPlay,
    GlyphChannelUp,
    GlyphChannelDown,
    GlyphInput,
    GlyphCustom
} ButtonGlyph;

static const char* const stock_labels[] =
    {"Power", "Vol +", "Vol -", "Mute", "Play/Pause", "Channel +", "Channel -", "Input", "Custom"};

enum {
    PageSize = 8,
    PreviousPage = 20,
    NextPage,
    Retry,
    ChoosePreset
};
enum {
    RenameButton,
    LearnAgain,
    MoveButton,
    RemoveButton,
    PinRemote,
    DeleteRemote
};
enum {
    EditEvent = 50,
    UseEvent,
    TextEvent,
    ConfirmEvent,
    CancelEvent
};

typedef struct {
    EddyLayoutButton cells[6];
    size_t count;
    size_t total;
    char title[EDDY_LAYOUT_NAME_MAX + 1];
    size_t slot;
    bool moving;
    const char* notice;
} GridModel;

typedef struct {
    Storage* storage;
    ViewDispatcher* dispatcher;
    View* grid;
    Submenu* menu;
    TextInput* text;
    DialogEx* dialog;
    InfraredWorker* receiver;
    InfraredSignal* signal;
    FuriString* path;
    EddyLayout layout;
    InfraredRemote* ir;
    bool standard;
    EddyLayoutButton pending;
    Screen screen;
    Screen error_return;
    size_t slot;
    size_t move_from;
    size_t page;
    size_t name_count;
    FuriString* paths[PageSize];
    char title[EDDY_LAYOUT_NAME_MAX + 1];
    char entry[EDDY_LAYOUT_NAME_MAX + 1];
    FuriEventFlag* capture_ready;
    FuriEventLoopTimer* feedback_timer;
    bool receiving;
    bool direct;
} Builder;

static void draw_fit(Canvas* canvas, int x, int y, size_t width, const char* text) {
    char label[EDDY_LAYOUT_NAME_MAX + 1];
    strlcpy(label, text, sizeof(label));
    size_t length = strlen(label);
    while(length && canvas_string_width(canvas, label) > width)
        label[--length] = '\0';
    canvas_draw_str(canvas, x, y, label);
}

static void draw_glyph(Canvas* canvas, int x, int y, uint32_t glyph) {
    switch(glyph) {
    case GlyphPower:
        canvas_draw_circle(canvas, x, y + 1, 4);
        canvas_draw_line(canvas, x, y - 5, x, y);
        break;
    case GlyphVolUp:
    case GlyphVolDown:
        canvas_draw_line(canvas, x - 4, y, x + 4, y);
        if(glyph == GlyphVolUp) canvas_draw_line(canvas, x, y - 4, x, y + 4);
        break;
    case GlyphChannelUp:
    case GlyphChannelDown: {
        int dir = glyph == GlyphChannelUp ? -1 : 1;
        canvas_draw_line(canvas, x - 4, y - dir * 2, x, y + dir * 2);
        canvas_draw_line(canvas, x, y + dir * 2, x + 4, y - dir * 2);
        break;
    }
    case GlyphMute:
        canvas_draw_box(canvas, x - 5, y - 1, 3, 3);
        canvas_draw_line(canvas, x - 2, y - 1, x, y - 3);
        canvas_draw_line(canvas, x, y - 3, x, y + 3);
        canvas_draw_line(canvas, x, y + 3, x - 2, y + 1);
        canvas_draw_line(canvas, x + 2, y - 2, x + 5, y + 1);
        canvas_draw_line(canvas, x + 2, y + 1, x + 5, y - 2);
        break;
    case GlyphPlay:
        canvas_draw_line(canvas, x - 5, y - 3, x - 5, y + 3);
        canvas_draw_line(canvas, x - 5, y - 3, x, y);
        canvas_draw_line(canvas, x, y, x - 5, y + 3);
        canvas_draw_line(canvas, x + 2, y - 3, x + 2, y + 3);
        canvas_draw_line(canvas, x + 4, y - 3, x + 4, y + 3);
        break;
    case GlyphInput:
        canvas_draw_frame(canvas, x, y - 4, 5, 9);
        canvas_draw_line(canvas, x - 5, y, x + 2, y);
        canvas_draw_line(canvas, x, y - 2, x + 2, y);
        canvas_draw_line(canvas, x + 2, y, x, y + 2);
        break;
    default:
        canvas_draw_rframe(canvas, x - 4, y - 4, 9, 9, 2);
        canvas_draw_dot(canvas, x, y);
    }
}

static size_t button_count(const Builder* app) {
    if(app->standard) return infrared_remote_get_signal_count(app->ir);
    size_t count = 0;
    for(size_t i = 0; i < EDDY_LAYOUT_SLOTS; i++)
        if(app->layout.buttons[i].label[0]) count++;
    return count;
}

// Keep old sparse layout files intact while presenting only their programmed buttons.
static size_t layout_slot(const Builder* app, size_t index) {
    size_t empty = EDDY_LAYOUT_SLOTS;
    for(size_t i = 0; i < EDDY_LAYOUT_SLOTS; i++) {
        if(app->layout.buttons[i].label[0]) {
            if(!index) return i;
            index--;
        } else if(empty == EDDY_LAYOUT_SLOTS)
            empty = i;
    }
    return empty;
}

static EddyLayoutButton button_at(const Builder* app, size_t index) {
    EddyLayoutButton button = {0};
    if(app->standard) {
        if(index >= infrared_remote_get_signal_count(app->ir)) return button;
        const char* name = infrared_remote_get_signal_name(app->ir, index);
        strlcpy(button.label, name, sizeof(button.label));
        button.glyph = GlyphCustom;
        for(size_t i = 0; i < COUNT_OF(stock_labels); i++)
            if(!strcasecmp(name, stock_labels[i])) button.glyph = i;
    } else {
        size_t slot = layout_slot(app, index);
        if(slot < EDDY_LAYOUT_SLOTS) button = app->layout.buttons[slot];
    }
    return button;
}

static size_t grid_count(const Builder* app, bool moving) {
    size_t count = button_count(app);
    return count + (!moving && (app->standard || count < EDDY_LAYOUT_SLOTS));
}

static void grid_draw(Canvas* canvas, void* context) {
    GridModel* m = context;
    canvas_set_font(canvas, FontPrimary);
    draw_fit(canvas, 2, 9, m->total > 6 ? 64 : 92, m->title);
    canvas_set_font(canvas, FontSecondary);
    if(m->total > COUNT_OF(m->cells)) {
        char page[24];
        snprintf(
            page,
            sizeof(page),
            "%u/%u",
            (unsigned)(m->slot / 6 + 1),
            (unsigned)((m->total + 5) / 6));
        canvas_draw_str_aligned(canvas, 94, 9, AlignRight, AlignBottom, page);
    }
    for(size_t i = 0; i < m->count; i++) {
        size_t columns = MIN(m->count, (size_t)3);
        int width = 126 / columns - 2;
        int x = 2 + (width + 2) * (i % columns), y = 12 + 17 * (i / columns);
        bool focus = i == m->slot % 6;
        if(focus) {
            canvas_draw_rbox(canvas, x, y, width, 16, 3);
            canvas_set_color(canvas, ColorWhite);
        } else {
            canvas_draw_rframe(canvas, x, y, width, 16, 3);
        }
        const EddyLayoutButton* button = &m->cells[i];
        if(button->label[0]) {
            draw_glyph(canvas, x + 8, y + 8, button->glyph);
            draw_fit(canvas, x + 15, y + 11, width - 17, button->label);
        } else {
            canvas_draw_str_aligned(
                canvas,
                x + width / 2,
                y + 11,
                AlignCenter,
                AlignBottom,
                width > 50 ? "+ Add button" : "+");
        }
        canvas_set_color(canvas, ColorBlack);
    }
    const char* name = m->cells[m->slot % 6].label;
    const char* subtitle =
        m->notice ? m->notice :
                    (m->moving ? "Choose destination" : (name[0] ? name : "Add button"));
    canvas_draw_str_aligned(canvas, 64, 53, AlignCenter, AlignBottom, subtitle);
    const char* hint = m->moving ?
                           "OK: place    Back: cancel" :
                           (name[0] ? "OK: send    Hold OK: menu" : "OK: add    Hold OK: menu");
    canvas_draw_str_aligned(canvas, 64, 63, AlignCenter, AlignBottom, hint);
}

static void enqueue(Builder* app, uint32_t event) {
    view_dispatcher_send_custom_event(app->dispatcher, event);
}

static void item_chosen(void* context, uint32_t index) {
    enqueue(context, index);
}

static void text_entered(void* context) {
    enqueue(context, TextEvent);
}

static void dialog_chosen(DialogExResult result, void* context) {
    if(result == DialogExResultCenter)
        enqueue(context, ConfirmEvent);
    else if(result == DialogExResultLeft)
        enqueue(context, CancelEvent);
}

static void clear_feedback(void* context) {
    Builder* app = context;
    if(app->screen == Grid)
        with_view_model(app->grid, GridModel * model, { model->notice = NULL; }, true);
}

static void show_grid(Builder* app, bool moving, const char* notice) {
    app->screen = moving ? Move : Grid;
    size_t total = grid_count(app, moving);
    app->slot = MIN(app->slot, total - 1);
    size_t first = app->slot / 6 * 6;
    with_view_model(
        app->grid,
        GridModel * m,
        {
            m->total = total;
            m->count = MIN((size_t)6, total - first);
            for(size_t i = 0; i < m->count; i++)
                m->cells[i] = button_at(app, first + i);
            strlcpy(m->title, app->title, sizeof(m->title));
            m->slot = app->slot;
            m->moving = moving;
            m->notice = notice;
        },
        true);
    view_dispatcher_switch_to_view(app->dispatcher, GridView);
    if(notice) furi_event_loop_timer_start(app->feedback_timer, furi_ms_to_ticks(950));
}

static bool grid_input(InputEvent* event, void* context) {
    Builder* app = context;
    if(event->key == InputKeyOk &&
       (event->type == InputTypeShort || event->type == InputTypeLong)) {
        enqueue(app, event->type == InputTypeShort ? UseEvent : EditEvent);
        return true;
    }
    if(event->type != InputTypeShort && event->type != InputTypeRepeat) return false;
    size_t count = grid_count(app, app->screen == Move);
    size_t rows = (count + 2) / 3;
    size_t row = app->slot / 3;
    switch(event->key) {
    case InputKeyLeft:
        app->slot = (app->slot + count - 1) % count;
        break;
    case InputKeyRight:
        app->slot = (app->slot + 1) % count;
        break;
    case InputKeyUp:
    case InputKeyDown:
        row = (row + (event->key == InputKeyUp ? rows - 1 : 1)) % rows;
        app->slot = MIN(count - 1, row * 3 + app->slot % 3);
        break;
    default:
        return false;
    }
    show_grid(app, app->screen == Move, NULL);
    return true;
}

static void begin_menu(Builder* app, Screen screen, const char* title) {
    app->screen = screen;
    submenu_reset(app->menu);
    submenu_set_header(app->menu, title);
}

static void add_item(Builder* app, const char* label, uint32_t index) {
    submenu_add_item(app->menu, label, index, item_chosen, app);
}

static void library_label(FuriString* path, FuriString* label, bool multiline) {
    path_extract_filename(path, label, true);
    const char* file = furi_string_get_cstr(path);
    const char* source = "Infrared";
    FuriString* folder = furi_string_alloc();
    if(eddy_layout_path_valid(file))
        source = "Custom";
    else {
        path_extract_dirname(file, folder);
        if(furi_string_size(folder) > strlen(EXT_PATH("infrared"))) {
            source = furi_string_get_cstr(folder) + strlen(EXT_PATH("infrared/"));
        }
    }
    furi_string_cat_printf(label, multiline ? "\n%s" : " (%s)", source);
    furi_string_free(folder);
}

static void show_library(Builder* app) {
    begin_menu(app, Library, "Remotes");
    app->name_count = 0;
    bool ok = storage_simply_mkdir(app->storage, EXT_PATH("infrared")) &&
              storage_simply_mkdir(app->storage, EDDY_LAYOUT_DIR);
    if(ok) eddy_layout_recover(app->storage);
    DirWalk* dir = dir_walk_alloc(app->storage);
    const char* excluded[] = {EXT_PATH("infrared/assets")};
    dir_walk_set_recurse_filter(dir, excluded, COUNT_OF(excluded));
    ok = ok && dir_walk_open(dir, EXT_PATH("infrared"));
    if(ok) {
        add_item(app, "New remote", 0);
        add_item(app, "TV presets", ChoosePreset);
        if(app->page) add_item(app, "Previous page", PreviousPage);
        FuriString* path = furi_string_alloc();
        FuriString* label = furi_string_alloc();
        FileInfo info;
        size_t seen = 0;
        DirWalkResult result;
        while((result = dir_walk_read(dir, path, &info)) == DirWalkOK) {
            const char* file = furi_string_get_cstr(path);
            if(file_info_is_dir(&info) || !eddy_remote_path_valid(file)) continue;
            if(seen++ < app->page * PageSize) continue;
            if(app->name_count == PageSize) {
                add_item(app, "Next page", NextPage);
                break;
            }
            furi_string_set(app->paths[app->name_count], path);
            library_label(path, label, false);
            add_item(app, furi_string_get_cstr(label), ++app->name_count);
        }
        ok = result != DirWalkError;
        furi_string_free(label);
        furi_string_free(path);
    }
    dir_walk_free(dir);
    if(!ok) {
        begin_menu(app, Library, "Check microSD card");
        add_item(app, "Try again", Retry);
    }
    view_dispatcher_switch_to_view(app->dispatcher, MenuView);
}

static void show_dialog(
    Builder* app,
    Screen screen,
    const char* title,
    const char* body,
    const char* accept) {
    app->screen = screen;
    dialog_ex_reset(app->dialog);
    dialog_ex_set_header(app->dialog, title, 64, 11, AlignCenter, AlignTop);
    dialog_ex_set_text(app->dialog, body, 64, 32, AlignCenter, AlignCenter);
    dialog_ex_set_center_button_text(app->dialog, accept);
    if(screen == ConfirmRemove || screen == ConfirmDelete)
        dialog_ex_set_left_button_text(app->dialog, "Cancel");
    dialog_ex_set_context(app->dialog, app);
    dialog_ex_set_result_callback(app->dialog, dialog_chosen);
    view_dispatcher_switch_to_view(app->dispatcher, DialogView);
}

static void show_error(Builder* app, const char* why, Screen back) {
    app->error_return = back;
    show_dialog(app, Error, "Remotes", why, "OK");
}

static bool name_validator(const char* value, FuriString* error, void* context) {
    Builder* app = context;
    if(app->screen == NewName) {
        if(!eddy_layout_name_valid(value)) {
            furi_string_set(error, "Use a short name\nwithout file symbols.");
            return false;
        }
        FuriString* path =
            furi_string_alloc_printf("%s/%s%s", EDDY_LAYOUT_DIR, value, EDDY_LAYOUT_EXT);
        bool taken = storage_file_exists(app->storage, furi_string_get_cstr(path));
        furi_string_free(path);
        if(taken) {
            furi_string_set(error, "Name already used");
            return false;
        }
    } else if(!eddy_layout_label_valid(value)) {
        furi_string_set(error, "Enter a button name");
        return false;
    }
    return true;
}

static void ask_name(Builder* app, Screen screen, const char* title, const char* initial) {
    app->screen = screen;
    strlcpy(app->entry, initial, sizeof(app->entry));
    text_input_reset(app->text);
    text_input_set_header_text(app->text, title);
    text_input_set_result_callback(
        app->text,
        text_entered,
        app,
        app->entry,
        screen == NewName ? sizeof(app->entry) : EDDY_LAYOUT_LABEL_MAX + 1,
        true);
    text_input_set_minimum_length(app->text, 1);
    text_input_set_validator(app->text, name_validator, app);
    view_dispatcher_switch_to_view(app->dispatcher, InputView);
}

static void open_layout(Builder* app) {
    const char* path = furi_string_get_cstr(app->path);
    app->standard = !eddy_layout_path_valid(path);
    bool ok = eddy_remote_path_valid(path) &&
              (app->standard ? infrared_remote_load(app->ir, path) == InfraredErrorCodeNone :
                               eddy_layout_load(app->storage, path, &app->layout));
    if(!ok) {
        show_error(app, "Could not open remote.\nCheck the microSD card.", Library);
        return;
    }
    FuriString* name = furi_string_alloc();
    path_extract_filename(app->path, name, true);
    strlcpy(app->title, furi_string_get_cstr(name), sizeof(app->title));
    furi_string_free(name);
    app->slot = 0;
    show_grid(app, false, NULL);
}

static void open_preset(Builder* app, size_t index) {
    if(infrared_tv_preset_save(app->storage, index, app->path))
        open_layout(app);
    else
        show_error(app, "Could not save preset.\nCheck the microSD card.", Library);
}

static void show_stock(Builder* app) {
    begin_menu(app, Stock, "Choose a button");
    for(size_t i = 0; i < COUNT_OF(stock_labels); i++)
        add_item(app, stock_labels[i], i);
    view_dispatcher_switch_to_view(app->dispatcher, MenuView);
}

static void received(void* context, InfraredWorkerSignal* signal) {
    Builder* app = context;
    if(furi_event_flag_get(app->capture_ready)) return;
    if(infrared_worker_signal_is_decoded(signal)) {
        const InfraredMessage* message = infrared_worker_get_decoded_signal(signal);
        if(message->repeat) return;
        infrared_signal_set_message(app->signal, message);
    } else {
        const uint32_t* timings;
        size_t count;
        infrared_worker_get_raw_signal(signal, &timings, &count);
        if(!count || count > MAX_TIMINGS_AMOUNT) return;
        infrared_signal_set_raw_signal(
            app->signal,
            timings,
            count,
            INFRARED_COMMON_CARRIER_FREQUENCY,
            INFRARED_COMMON_DUTY_CYCLE);
    }
    if(!infrared_signal_is_valid(app->signal)) return;
    furi_event_flag_set(app->capture_ready, 1);
}

static void begin_learning(Builder* app) {
    show_dialog(
        app, Learn, "Learn button", "Point the original remote\nat Flipper and press once.", NULL);
    app->receiving = true;
    infrared_worker_rx_start(app->receiver);
}

static void stop_learning(Builder* app) {
    if(app->receiving) {
        infrared_worker_rx_stop(app->receiver);
        app->receiving = false;
        furi_event_flag_clear(app->capture_ready, 1);
    }
}

static void capture_complete(FuriEventLoopObject* object, void* context) {
    Builder* app = context;
    if(app->screen != Learn || !furi_event_flag_get(object)) return;
    stop_learning(app);
    ask_name(app, SaveLabel, "Signal read. Name & save", app->pending.label);
}

static bool pin_state(Builder* app, bool* pinned) {
    EddyRemotePins pins = {0};
    bool ok = eddy_remote_pins_read(app->storage, &pins, NULL);
    *pinned = eddy_remote_pin_index(&pins, furi_string_get_cstr(app->path)) < pins.count;
    eddy_remote_pins_clear(&pins);
    return ok;
}

static void show_options(Builder* app) {
    EddyLayoutButton selected = button_at(app, app->slot);
    const char* label = selected.label;
    begin_menu(app, Options, label[0] ? label : "Remote options");
    bool pinned;
    if(!pin_state(app, &pinned)) {
        show_error(app, "Could not read shortcuts.\nCheck the microSD card.", Grid);
        return;
    }
    if(!pinned) add_item(app, "Add to Apps", PinRemote);
    if(label[0]) {
        add_item(app, "Rename button", RenameButton);
        add_item(app, "Learn again", LearnAgain);
        add_item(app, "Move button", MoveButton);
        add_item(app, "Remove button", RemoveButton);
    }
    if(pinned) add_item(app, "Remove from Apps", PinRemote);
    add_item(app, "Delete remote", DeleteRemote);
    view_dispatcher_switch_to_view(app->dispatcher, MenuView);
}

static void refresh_saved(Builder* app, bool saved, const char* notice) {
    if(!saved) {
        Screen retry = app->screen == SaveLabel || app->screen == RenameLabel ? app->screen : Grid;
        show_error(app, "Could not save changes.\nCheck the microSD card.", retry);
    } else if(
        !app->standard &&
        !eddy_layout_load(app->storage, furi_string_get_cstr(app->path), &app->layout)) {
        show_error(app, "Could not reopen remote.\nCheck the microSD card.", Library);
    } else {
        show_grid(app, false, notice);
    }
}

static void select_option(Builder* app, uint32_t event) {
    bool pinned;
    const char* path = furi_string_get_cstr(app->path);
    switch(event) {
    case RenameButton:
        app->pending = button_at(app, app->slot);
        ask_name(app, RenameLabel, "Rename button", app->pending.label);
        break;
    case LearnAgain:
        app->pending = button_at(app, app->slot);
        begin_learning(app);
        break;
    case MoveButton:
        app->move_from = app->slot;
        show_grid(app, true, NULL);
        break;
    case RemoveButton:
        app->pending = button_at(app, app->slot);
        show_dialog(app, ConfirmRemove, "Remove button?", app->pending.label, "Remove");
        break;
    case DeleteRemote: {
        FuriString* label = furi_string_alloc();
        library_label(app->path, label, true);
        show_dialog(app, ConfirmDelete, "Delete remote?", furi_string_get_cstr(label), "Delete");
        furi_string_free(label);
        break;
    }
    case PinRemote:
        if(pin_state(app, &pinned)) {
            EddyPinResult result =
                eddy_remote_pins_update(app->storage, pinned ? path : NULL, pinned ? NULL : path);
            if(result == EddyPinOk)
                show_grid(app, false, pinned ? "Removed from Apps" : "Added to Apps");
            else
                show_error(
                    app,
                    result == EddyPinFull ? "Apps shortcuts are full." :
                                            "Could not save shortcut.",
                    Grid);
        } else
            show_error(app, "Could not read shortcuts.", Grid);
        break;
    }
}

static bool go_back(void* context) {
    Builder* app = context;
    switch(app->screen) {
    case Library:
        return false;
    case Grid:
        if(app->direct) return false;
        show_library(app);
        break;
    case Presets:
    case NewName:
        show_library(app);
        break;
    case Learn:
        stop_learning(app);
        show_grid(app, false, NULL);
        break;
    case Error:
        if(app->error_return == Library && app->direct) return false;
        if(app->error_return == Library)
            show_library(app);
        else if(app->error_return == SaveLabel || app->error_return == RenameLabel)
            ask_name(app, app->error_return, "Name & save button", app->pending.label);
        else
            show_grid(app, false, NULL);
        break;
    case Move:
        app->slot = app->move_from;
        show_grid(app, false, NULL);
        break;
    case RenameLabel:
    case ConfirmDelete:
    case ConfirmRemove:
        show_options(app);
        break;
    default:
        show_grid(app, false, NULL);
        break;
    }
    return true;
}

static bool handle_event(void* context, uint32_t event) {
    Builder* app = context;
    const char* path = furi_string_get_cstr(app->path);
    if(event == CancelEvent && (app->screen == ConfirmRemove || app->screen == ConfirmDelete)) {
        show_options(app);
        return true;
    }
    switch(app->screen) {
    case Library:
        if(event == Retry) {
            app->page = 0;
            show_library(app);
        } else if(event == PreviousPage && app->page) {
            --app->page;
            show_library(app);
        } else if(event == NextPage) {
            ++app->page;
            show_library(app);
        } else if(event == ChoosePreset) {
            begin_menu(app, Presets, "Add TV preset");
            for(size_t i = 0; i < COUNT_OF(presets); i++)
                add_item(app, presets[i].model, i);
            view_dispatcher_switch_to_view(app->dispatcher, MenuView);
        } else if(event == 0)
            ask_name(app, NewName, "Name your remote", "");
        else if(event <= app->name_count) {
            furi_string_set(app->path, app->paths[event - 1]);
            open_layout(app);
        }
        break;
    case Presets:
        if(event < COUNT_OF(presets)) open_preset(app, event);
        break;
    case NewName:
        if(event != TextEvent) break;
        if(eddy_layout_create(app->storage, app->entry, app->path))
            open_layout(app);
        else
            show_error(app, "Could not create remote.\nCheck name and card.", Library);
        break;
    case Grid:
        if(event == EditEvent)
            show_options(app);
        else if(event == UseEvent && app->slot == button_count(app))
            show_stock(app);
        else if(event == UseEvent) {
            if(app->standard ? infrared_remote_load_signal(app->ir, app->signal, app->slot) ==
                                   InfraredErrorCodeNone :
                               eddy_layout_signal(
                                   app->storage, path, layout_slot(app, app->slot), app->signal)) {
                infrared_signal_transmit(app->signal);
                show_grid(app, false, "Sent");
            } else
                show_error(app, "Could not read button.\nCheck the microSD card.", Grid);
        }
        break;
    case Stock:
        if(event < COUNT_OF(stock_labels)) {
            app->pending.glyph = event;
            strlcpy(app->pending.label, stock_labels[event], sizeof(app->pending.label));
            begin_learning(app);
        }
        break;
    case Learn:
        break;
    case SaveLabel:
    case RenameLabel:
        if(event == TextEvent) {
            strlcpy(app->pending.label, app->entry, sizeof(app->pending.label));
            const InfraredSignal* signal = app->screen == SaveLabel ? app->signal : NULL;
            bool saved;
            if(app->standard) {
                InfraredErrorCode result =
                    app->slot == button_count(app) ?
                        infrared_remote_append_signal(app->ir, signal, app->pending.label) :
                        infrared_remote_set_signal(app->ir, app->slot, app->pending.label, signal);
                saved = result == InfraredErrorCodeNone;
            } else {
                size_t slot = layout_slot(app, app->slot);
                saved = eddy_layout_set(app->storage, path, slot, &app->pending, signal);
                if(saved && !app->layout.buttons[slot].label[0]) {
                    app->slot = 0;
                    for(size_t i = 0; i < slot; ++i)
                        if(app->layout.buttons[i].label[0]) app->slot++;
                }
            }
            refresh_saved(app, saved, "Button saved");
        }
        break;
    case Options:
        select_option(app, event);
        break;
    case Move:
        if(event == UseEvent) {
            if(app->slot == app->move_from)
                show_grid(app, false, NULL);
            else
                refresh_saved(
                    app,
                    app->standard ?
                        infrared_remote_move_signal(app->ir, app->move_from, app->slot) ==
                            InfraredErrorCodeNone :
                        eddy_layout_move(
                            app->storage,
                            path,
                            layout_slot(app, app->move_from),
                            layout_slot(app, app->slot)),
                    "Button moved");
        }
        break;
    case ConfirmRemove:
        if(event == ConfirmEvent)
            refresh_saved(
                app,
                app->standard ?
                    infrared_remote_delete_signal(app->ir, app->slot) == InfraredErrorCodeNone :
                    eddy_layout_remove(app->storage, path, layout_slot(app, app->slot)),
                "Button removed");
        break;
    case ConfirmDelete:
        if(event == ConfirmEvent) {
            bool ok = true;
            if(!app->standard) {
                // Do not let an interrupted older replacement resurrect the deleted remote.
                FuriString* ready = furi_string_alloc_printf("%s.ready", path);
                ok = storage_simply_remove(app->storage, furi_string_get_cstr(ready));
                furi_string_free(ready);
            }
            if(ok)
                ok = app->standard ? infrared_remote_remove(app->ir) == InfraredErrorCodeNone :
                                     storage_common_remove(app->storage, path) == FSE_OK;
            if(!ok)
                show_error(app, "Could not delete remote.", Grid);
            else {
                EddyPinResult cleanup = eddy_remote_pins_update(app->storage, path, NULL);
                app->page = 0;
                if(cleanup != EddyPinOk)
                    show_error(app, "Deleted. Could not\nclear shortcut.", Library);
                else if(app->direct)
                    view_dispatcher_stop(app->dispatcher);
                else
                    show_library(app);
            }
        }
        break;
    case Error:
        if(event == ConfirmEvent && !go_back(app)) view_dispatcher_stop(app->dispatcher);
        break;
    }
    return true;
}

int32_t eddy_remote_builder_app(void* argument) {
    Builder* app = calloc(1, sizeof(Builder));
    app->storage = furi_record_open(RECORD_STORAGE);
    infrared_remote_recover_library(app->storage);
    app->dispatcher = view_dispatcher_alloc();
    FuriEventLoop* loop = view_dispatcher_get_event_loop(app->dispatcher);
    app->capture_ready = furi_event_flag_alloc();
    furi_event_loop_subscribe_event_flag(
        loop, app->capture_ready, FuriEventLoopEventIn, capture_complete, app);
    app->feedback_timer =
        furi_event_loop_timer_alloc(loop, clear_feedback, FuriEventLoopTimerTypeOnce, app);
    app->grid = view_alloc();
    app->menu = submenu_alloc();
    app->text = text_input_alloc();
    app->dialog = dialog_ex_alloc();
    app->path = furi_string_alloc();
    app->ir = infrared_remote_alloc();
    for(size_t i = 0; i < PageSize; i++)
        app->paths[i] = furi_string_alloc();
    app->signal = infrared_signal_alloc();
    app->receiver = infrared_worker_alloc();
    infrared_worker_rx_set_received_signal_callback(app->receiver, received, app);
    view_set_context(app->grid, app);
    view_allocate_model(app->grid, ViewModelTypeLocking, sizeof(GridModel));
    view_set_draw_callback(app->grid, grid_draw);
    view_set_input_callback(app->grid, grid_input);
    view_dispatcher_add_view(app->dispatcher, GridView, app->grid);
    view_dispatcher_add_view(app->dispatcher, MenuView, submenu_get_view(app->menu));
    view_dispatcher_add_view(app->dispatcher, InputView, text_input_get_view(app->text));
    view_dispatcher_add_view(app->dispatcher, DialogView, dialog_ex_get_view(app->dialog));
    view_dispatcher_set_event_callback_context(app->dispatcher, app);
    view_dispatcher_set_custom_event_callback(app->dispatcher, handle_event);
    view_dispatcher_set_navigation_event_callback(app->dispatcher, go_back);
    Gui* gui = furi_record_open(RECORD_GUI);
    view_dispatcher_attach_to_gui(app->dispatcher, gui, ViewDispatcherTypeFullscreen);
    app->direct = argument && *(const char*)argument;
    if(app->direct) {
        furi_string_set_str(app->path, argument);
        open_layout(app);
    } else
        show_library(app);
    view_dispatcher_run(app->dispatcher);
    stop_learning(app);
    furi_event_loop_unsubscribe(loop, app->capture_ready);
    furi_event_flag_free(app->capture_ready);
    furi_event_loop_timer_free(app->feedback_timer);
    view_dispatcher_remove_view(app->dispatcher, DialogView);
    view_dispatcher_remove_view(app->dispatcher, InputView);
    view_dispatcher_remove_view(app->dispatcher, MenuView);
    view_dispatcher_remove_view(app->dispatcher, GridView);
    dialog_ex_free(app->dialog);
    text_input_free(app->text);
    submenu_free(app->menu);
    view_free(app->grid);
    view_dispatcher_free(app->dispatcher);
    infrared_worker_free(app->receiver);
    infrared_signal_free(app->signal);
    infrared_remote_free(app->ir);
    for(size_t i = 0; i < PageSize; i++)
        furi_string_free(app->paths[i]);
    furi_string_free(app->path);
    furi_record_close(RECORD_GUI);
    furi_record_close(RECORD_STORAGE);
    free(app);
    return 0;
}
