#include <bt/bt_service/bt.h>
#include <dialogs/dialogs.h>
#include <profiles/serial_profile.h>
#include <furi.h>
#include <furi_hal_bt.h>
#include <furi_hal_version.h>
#include <gui/view_dispatcher.h>
#include <gui/modules/text_input.h>
#include <toolbox/saved_struct.h>
#include <storage/storage.h>

#define HOST_LABEL_SIZE 15

enum {
    RemoteViewMain,
    RemoteViewName
};

typedef enum {
    RemoteCamera,
    RemoteSlides,
    RemoteMedia,
    RemoteCount,
} RemoteMode;

static const char* const mode_names[] = {"Camera", "Slides", "Media"};

typedef struct {
    RemoteMode mode;
    bool in_mode;
    bool available;
    bool connected;
    uint8_t peer[GAP_MAC_ADDR_SIZE];
    char label[HOST_LABEL_SIZE];
    char advertised_name[FURI_HAL_VERSION_DEVICE_NAME_LENGTH];
    const char* feedback;
} RemoteModel;

typedef struct {
    Bt* bt;
    View* view;
    ViewDispatcher* dispatcher;
    TextInput* name_input;
    Storage* storage;
    char new_label[HOST_LABEL_SIZE];
    uint8_t editing_peer[GAP_MAC_ADDR_SIZE];
    uint32_t feedback_until;
} Remote;

static FuriString* remote_label_path(const uint8_t* a) {
    return furi_string_alloc_printf(
        APP_DATA_PATH("host-%02x%02x%02x%02x%02x%02x"), a[5], a[4], a[3], a[2], a[1], a[0]);
}

static void remote_load_label(Remote* app, const uint8_t* peer, char* label) {
    FuriString* path = remote_label_path(peer);
    const char* target = furi_string_get_cstr(path);
    if(storage_common_stat(app->storage, target, NULL) == FSE_NOT_EXIST) {
        // FAT unlinks the destination before promoting a fully written replacement.
        FuriString* pending = furi_string_alloc_printf("%s.tmp", target);
        storage_common_rename_safe(app->storage, furi_string_get_cstr(pending), target);
        furi_string_free(pending);
    }
    if(!saved_struct_load(target, label, HOST_LABEL_SIZE, 0xBC, 1) ||
       !memchr(label, 0, HOST_LABEL_SIZE))
        label[0] = 0;
    furi_string_free(path);
}

static void remote_draw(Canvas* canvas, void* context) {
    const RemoteModel* model = context;
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str(canvas, 2, 10, model->in_mode ? mode_names[model->mode] : "Bluetooth Remote");
    canvas_set_font(canvas, FontSecondary);
    if(!model->available) {
        canvas_draw_str(canvas, 3, 32, "Turn Bluetooth on in");
        canvas_draw_str(canvas, 3, 45, "Settings > Bluetooth.");
        return;
    }
    if(!model->in_mode) {
        for(size_t i = 0; i < RemoteCount; ++i) {
            int y = 13 + 12 * i;
            if(i == model->mode) {
                canvas_draw_rbox(canvas, 1, y, model->connected ? 61 : 122, 12, 3);
                canvas_set_color(canvas, ColorWhite);
            }
            canvas_draw_str(canvas, 6, y + 9, mode_names[i]);
            canvas_set_color(canvas, ColorBlack);
        }
        if(model->connected) {
            canvas_draw_str(canvas, 73, 28, "Hold OK");
            canvas_draw_str(canvas, 73, 40, "name device");
        }
    } else if(!model->connected) {
        canvas_draw_str(canvas, 3, 29, "Open Bluetooth settings");
        canvas_draw_str(canvas, 3, 43, "and select the name below.");
    } else {
        const char* hint;
        const char* action;
        switch(model->mode) {
        case RemoteCamera:
            hint = "Open Camera on iPhone";
            action = "OK: take photo";
            break;
        case RemoteSlides:
            hint = "Start your slideshow";
            action = "< Previous       Next >";
            break;
        default:
            hint = "< Previous      Next >";
            action = "OK: play / pause";
            break;
        }
        canvas_draw_str_aligned(canvas, 64, 27, AlignCenter, AlignBottom, hint);
        canvas_set_font(canvas, FontPrimary);
        canvas_draw_str_aligned(
            canvas, 64, 45, AlignCenter, AlignBottom, model->feedback ? model->feedback : action);
    }
    char status[48];
    if(model->connected && model->label[0]) {
        snprintf(status, sizeof(status), "Linked %s", model->label);
    } else if(model->connected) {
        const uint8_t* a = model->peer;
        snprintf(
            status,
            sizeof(status),
            "Linked %02X:%02X:%02X:%02X:%02X:%02X",
            a[5],
            a[4],
            a[3],
            a[2],
            a[1],
            a[0]);
    } else {
        snprintf(status, sizeof(status), "Pair: %s", model->advertised_name);
    }
    canvas_set_font(canvas, FontSecondary);
    if(model->connected && model->label[0] && canvas_string_width(canvas, status) > 122) {
        canvas_draw_line(canvas, 2, 50, 4, 52);
        canvas_draw_line(canvas, 4, 52, 8, 48);
        canvas_draw_line(canvas, 12, 51, 125, 51);
        canvas_draw_str(canvas, 1, 62, model->label);
    } else {
        canvas_draw_line(canvas, 2, 51, 125, 51);
        canvas_draw_str(canvas, 3, 62, status);
    }
}

static void remote_link_event(BleMediaEvent event, const void* data, size_t size, void* context) {
    UNUSED(data);
    UNUSED(size);
    if(event != BleMediaLink) return;
    Remote* app = context;
    // Require the foreground UI to identify the new peer before sending another button.
    with_view_model(app->view, RemoteModel * model, { model->connected = false; }, true);
}

// Display and act on the paired link only. A new host must be drawn before it can receive input.
static bool remote_refresh(Remote* app) {
    uint8_t peer[GAP_MAC_ADDR_SIZE];
    bool available = ble_svc_media_listen(remote_link_event, app) && furi_hal_bt_is_active();
    bool connected = available && bt_get_connected_peer_address(app->bt, peer);
    RemoteModel* model = view_get_model(app->view);
    bool changed = model->available != available || model->connected != connected ||
                   (connected && memcmp(model->peer, peer, sizeof(peer)) != 0);
    if(changed) {
        view_commit_model(app->view, false);
        char label[HOST_LABEL_SIZE] = {0};
        if(connected) remote_load_label(app, peer, label);
        model = view_get_model(app->view);
        strlcpy(model->label, label, sizeof(model->label));
        model->available = available;
        model->connected = connected;
        if(connected) memcpy(model->peer, peer, sizeof(peer));
        model->feedback = NULL;
    }
    bool expired = model->feedback && (int32_t)(furi_get_tick() - app->feedback_until) >= 0;
    if(expired) model->feedback = NULL;
    view_commit_model(app->view, changed || expired);
    return connected && !changed;
}

static void remote_tick(void* context) {
    remote_refresh(context);
}

static const char* remote_action(Remote* app, RemoteMode mode, InputKey key) {
    BleMediaCommand command;
    const char* feedback;
    if(mode == RemoteCamera && key == InputKeyOk) {
        command = BleMediaVolumeUp;
        feedback = "Shutter sent";
    } else if(mode == RemoteMedia && key == InputKeyOk) {
        command = BleMediaPlayPause;
        feedback = "Play / pause sent";
    } else if(mode != RemoteCamera && key == InputKeyLeft) {
        command = mode == RemoteSlides ? BleMediaPreviousSlide : BleMediaPrevious;
        feedback = "Previous sent";
    } else if(mode != RemoteCamera && key == InputKeyRight) {
        command = mode == RemoteSlides ? BleMediaNextSlide : BleMediaNext;
        feedback = "Next sent";
    } else {
        return NULL;
    }
    return ble_svc_media_send(app, command, true) ? feedback : "Try again";
}

static uint32_t remote_name_back(void* context) {
    UNUSED(context);
    return RemoteViewMain;
}

static void remote_finish_name(void* context) {
    Remote* app = context;
    uint8_t peer[GAP_MAC_ADDR_SIZE];
    bool same = bt_get_connected_peer_address(app->bt, peer) &&
                memcmp(peer, app->editing_peer, sizeof(peer)) == 0;
    bool saved = false;
    if(same) {
        FuriString* path = remote_label_path(peer);
        FuriString* pending = furi_string_alloc_printf("%s.tmp", furi_string_get_cstr(path));
        saved =
            saved_struct_save(
                furi_string_get_cstr(pending), app->new_label, sizeof(app->new_label), 0xBC, 1) &&
            storage_common_rename(
                app->storage, furi_string_get_cstr(pending), furi_string_get_cstr(path)) == FSE_OK;
        furi_string_free(pending);
        furi_string_free(path);
    }
    if(saved) {
        with_view_model(
            app->view,
            RemoteModel * model,
            {
                if(model->connected && memcmp(peer, model->peer, sizeof(peer)) == 0)
                    strlcpy(model->label, app->new_label, sizeof(model->label));
            },
            true);
    } else {
        DialogsApp* dialogs = furi_record_open(RECORD_DIALOGS);
        dialog_message_show_storage_error(
            dialogs, same ? "Could not save name." : "Device disconnected.");
        furi_record_close(RECORD_DIALOGS);
    }
    remote_refresh(app);
    view_dispatcher_switch_to_view(app->dispatcher, RemoteViewMain);
}

static bool remote_input(InputEvent* event, void* context) {
    bool name_key = event->type == InputTypeLong && event->key == InputKeyOk;
    if(event->type != InputTypeShort && !name_key) return false;
    Remote* app = context;
    bool ready = remote_refresh(app);
    RemoteModel* model = view_get_model(app->view);
    RemoteMode mode = model->mode;
    bool send = false;
    bool handled = true;
    if(name_key) {
        bool edit = ready && !model->in_mode;
        if(edit) {
            memcpy(app->editing_peer, model->peer, sizeof(app->editing_peer));
            memset(app->new_label, 0, sizeof(app->new_label));
            strlcpy(app->new_label, model->label, sizeof(app->new_label));
        }
        view_commit_model(app->view, false);
        if(edit) {
            text_input_set_result_callback(
                app->name_input,
                remote_finish_name,
                app,
                app->new_label,
                sizeof(app->new_label),
                true);
            view_dispatcher_switch_to_view(app->dispatcher, RemoteViewName);
        }
        return true;
    }
    if(event->key == InputKeyBack) {
        handled = model->in_mode;
        model->in_mode = false;
        model->feedback = NULL;
    } else if(!model->available) {
        handled = false;
    } else if(model->in_mode) {
        send = ready;
    } else if(event->key == InputKeyOk) {
        model->in_mode = true;
    } else if(event->key == InputKeyDown || event->key == InputKeyUp) {
        model->mode = (mode + (event->key == InputKeyDown ? 1 : RemoteCount - 1)) % RemoteCount;
    } else {
        handled = false;
    }
    view_commit_model(app->view, handled);
    if(send) {
        const char* message = remote_action(app, mode, event->key);
        if(message) {
            app->feedback_until = furi_get_tick() + furi_ms_to_ticks(650);
            with_view_model(app->view, RemoteModel * state, { state->feedback = message; }, true);
        }
    }
    return handled;
}

static uint32_t remote_back(void* context) {
    UNUSED(context);
    return VIEW_NONE;
}

int32_t eddy_bluetooth_app(void* argument) {
    UNUSED(argument);
    Remote app = {.bt = furi_record_open(RECORD_BT), .view = view_alloc()};
    Gui* gui = furi_record_open(RECORD_GUI);
    ViewDispatcher* dispatcher = app.dispatcher = view_dispatcher_alloc();
    app.name_input = text_input_alloc();
    app.storage = furi_record_open(RECORD_STORAGE);
    text_input_set_header_text(app.name_input, "Name this device");
    view_set_previous_callback(text_input_get_view(app.name_input), remote_name_back);
    view_allocate_model(app.view, ViewModelTypeLocking, sizeof(RemoteModel));
    with_view_model(
        app.view,
        RemoteModel * model,
        {
            *model = (RemoteModel){0};
            strlcpy(
                model->advertised_name,
                furi_hal_version_get_device_name_ptr(),
                sizeof(model->advertised_name));
        },
        false);
    view_set_context(app.view, &app);
    view_set_draw_callback(app.view, remote_draw);
    view_set_input_callback(app.view, remote_input);
    view_set_previous_callback(app.view, remote_back);
    view_dispatcher_set_event_callback_context(dispatcher, &app);
    view_dispatcher_set_tick_event_callback(dispatcher, remote_tick, 150);
    view_dispatcher_add_view(dispatcher, RemoteViewMain, app.view);
    view_dispatcher_add_view(dispatcher, RemoteViewName, text_input_get_view(app.name_input));

    remote_refresh(&app);
    view_dispatcher_attach_to_gui(dispatcher, gui, ViewDispatcherTypeFullscreen);
    view_dispatcher_switch_to_view(dispatcher, RemoteViewMain);
    view_dispatcher_run(dispatcher);

    ble_svc_media_unlisten(&app);
    view_dispatcher_remove_view(dispatcher, RemoteViewName);
    view_dispatcher_remove_view(dispatcher, RemoteViewMain);
    text_input_free(app.name_input);
    furi_record_close(RECORD_STORAGE);
    view_dispatcher_free(dispatcher);
    view_free(app.view);
    furi_record_close(RECORD_GUI);
    furi_record_close(RECORD_BT);
    return 0;
}
