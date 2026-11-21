#include "ams_client.h"
#include <profiles/serial_profile.h>
#include "music_screen.h"
#include <bt/bt_service/bt.h>
#include <furi_hal_bt.h>
#include <furi.h>
#include <gui/view_dispatcher.h>
#include <storage/storage.h>
#include <toolbox/saved_struct.h>

#define MUSIC_SETUP             APP_DATA_PATH(".linked")
#define MUSIC_BRIDGE_TIMEOUT_MS 35000U

typedef struct {
    MusicScreen screen; // The view renderer reads the first member.
    MusicFrame bridge;
    MusicFrame iphone;
    uint32_t sample_tick;
    uint32_t title_tick;
    uint32_t failed_tick;
    bool manual_setup;
    bool bridge_selected;
    uint8_t sample_peer[GAP_MAC_ADDR_SIZE];
} MusicModel;

typedef struct {
    Bt* bt;
    AmsClient* ams;
    View* view;
    bool persisted;
    uint32_t save_attempt;
} MusicApp;

static void clear_session(MusicModel* model) {
    model->screen.connected = false;
    model->screen.failed_command = false;
    model->screen.iphone = false;
    model->screen.track = (MusicTrackInfo){0};
    model->screen.position = 0;
    model->screen.state = MusicWaiting;
    model->bridge_selected = false;
    model->bridge.started = false;
    model->iphone.started = false;
}

static void receive_packet(MusicApp* app, bool iphone, const uint8_t* data, size_t size) {
    uint8_t peer[GAP_MAC_ADDR_SIZE];
    if(data && !bt_get_connected_peer_address(app->bt, peer)) return;
    MusicModel* model = view_get_model(app->view);
    if(!data) {
        if(!iphone || !model->bridge_selected) {
            clear_session(model);
        }
    } else if(!iphone || !model->bridge_selected) {
        MusicFrame* frame = iphone ? &model->iphone : &model->bridge;
        bool new_title = data[0] == 4 && frame->started &&
                         strcmp(frame->pending.title, model->screen.track.title) != 0;
        bool changed =
            music_frame_receive(frame, &model->screen.track, &model->screen.state, data, size);
        if(changed) {
            model->bridge_selected = !iphone;
            model->screen.iphone = iphone;
            model->screen.connected = true;
            memcpy(model->sample_peer, peer, sizeof(peer));
            model->screen.linked = true;
            if(!model->manual_setup) model->screen.setup = false;
            model->screen.failed_command = false;
            model->sample_tick = furi_get_tick();
            model->screen.position = model->screen.track.elapsed;
            if(new_title) {
                model->title_tick = model->sample_tick;
                model->screen.scroll = 0;
            }
        }
    }
    // BLE callbacks run on the radio event thread. The app tick schedules drawing.
    view_commit_model(app->view, false);
}

static void media_event(BleMediaEvent event, const void* data, size_t size, void* context) {
    MusicApp* app = context;
    switch(event) {
    case BleMediaLink: {
        uint16_t handle = *(const uint16_t*)data;
        ams_client_set_link(app->ams, handle);
        if(handle == UINT16_MAX) receive_packet(app, false, NULL, 0);
        break;
    }
    case BleMediaRadio:
        ams_client_event(app->ams, data);
        break;
    case BleMediaFrame:
        receive_packet(app, false, data, size);
        break;
    }
}

static void receive_iphone(const uint8_t* data, size_t size, void* context) {
    receive_packet(context, true, data, size);
}

static void music_tick(void* context) {
    MusicApp* app = context;
    uint8_t peer[GAP_MAC_ADDR_SIZE];
    bool available = ble_svc_media_listen(media_event, app) && furi_hal_bt_is_active();
    bool connected = available && bt_get_connected_peer_address(app->bt, peer);
    MusicModel* model = view_get_model(app->view);
    model->screen.available = available;
    if(model->screen.connected &&
       (!connected || (model->screen.state != MusicWaiting &&
                       memcmp(model->sample_peer, peer, sizeof(peer)) != 0)))
        clear_session(model);
    uint32_t now = furi_get_tick();
    // A browser tab can disappear while the phone remains paired for media buttons.
    // Release every bridge state, including idle and retry screens, after its heartbeat.
    if(model->bridge_selected &&
       now - model->sample_tick >= furi_ms_to_ticks(MUSIC_BRIDGE_TIMEOUT_MS))
        clear_session(model);
    if(connected && model->screen.state == MusicWaiting) {
        memcpy(model->sample_peer, peer, sizeof(peer));
        model->screen.linked = true;
        if(!model->manual_setup) model->screen.setup = false;
    }
    model->screen.connected = connected;
    bool try_ams = connected && !model->bridge_selected;
    if(model->screen.state == MusicTrack) {
        MusicScreen* screen = &model->screen;
        uint32_t age_ticks = now - model->sample_tick;
        uint64_t age = (uint64_t)age_ticks * 1000 / furi_kernel_get_tick_frequency();
        uint64_t position = screen->track.elapsed;
        if(screen->track.playing) position += age;
        if(screen->track.duration) position = MIN(position, screen->track.duration);
        screen->position = MIN(position, UINT32_MAX);
        screen->scroll = (now - model->title_tick) / furi_ms_to_ticks(60);
    }
    if(model->screen.failed_command && now - model->failed_tick >= furi_ms_to_ticks(1800))
        model->screen.failed_command = false;
    bool save_setup = !model->screen.setup && !app->persisted;
    view_commit_model(app->view, true);

    ams_client_tick(app->ams, try_ams, receive_iphone, app);
    if(save_setup && (!app->save_attempt || now - app->save_attempt >= furi_ms_to_ticks(5000))) {
        app->save_attempt = now;
        const uint8_t linked = 1;
        app->persisted = saved_struct_save(MUSIC_SETUP, &linked, sizeof(linked), 0x9a, 1);
    }
}

static bool music_input(InputEvent* event, void* context) {
    if(event->type != InputTypeShort) return false;
    MusicApp* app = context;
    MusicModel* model = view_get_model(app->view);
    bool handled = true;
    uint8_t command = 0;
    bool iphone = model->screen.iphone;
    bool use_hid = model->screen.state == MusicWaiting ||
                   (iphone && model->screen.state == MusicIdle);
    uint8_t sample_peer[GAP_MAC_ADDR_SIZE];
    memcpy(sample_peer, model->sample_peer, sizeof(sample_peer));
    if(event->key == InputKeyUp) {
        model->screen.setup = !model->screen.setup;
        model->manual_setup = model->screen.setup;
    } else if((event->key == InputKeyBack || event->key == InputKeyOk) && model->manual_setup) {
        model->manual_setup = false;
        model->screen.setup = false;
    } else if(
        !model->screen.setup && model->screen.connected &&
        (use_hid || model->screen.state == MusicTrack)) {
        if(event->key == InputKeyLeft)
            command = 1;
        else if(event->key == InputKeyOk)
            command = 2;
        else if(event->key == InputKeyRight)
            command = 3;
        else
            handled = false;
    } else {
        handled = false;
    }
    view_commit_model(app->view, handled);
    if(command) {
        uint8_t peer[GAP_MAC_ADDR_SIZE];
        bool sent = bt_get_connected_peer_address(app->bt, peer) &&
                    memcmp(sample_peer, peer, sizeof(peer)) == 0 &&
                    (use_hid ? ble_svc_media_send(app, command, true) :
                     iphone  ? ams_client_send(app->ams, command) :
                               ble_svc_media_send(app, command, false));
        if(!sent) {
            with_view_model(
                app->view,
                MusicModel * state,
                {
                    state->failed_tick = furi_get_tick();
                    state->screen.failed_command = true;
                },
                true);
        }
    }
    return handled;
}

static uint32_t music_exit(void* context) {
    UNUSED(context);
    return VIEW_NONE;
}

int32_t eddy_music_app(void* argument) {
    UNUSED(argument);
    MusicApp app = {
        .bt = furi_record_open(RECORD_BT), .view = view_alloc(), .ams = ams_client_alloc()};
    Gui* gui = furi_record_open(RECORD_GUI);
    ViewDispatcher* dispatcher = view_dispatcher_alloc();
    view_allocate_model(app.view, ViewModelTypeLocking, sizeof(MusicModel));
    view_set_context(app.view, &app);
    view_set_draw_callback(app.view, music_screen_draw);
    view_set_input_callback(app.view, music_input);
    view_set_previous_callback(app.view, music_exit);
    view_dispatcher_set_event_callback_context(dispatcher, &app);
    view_dispatcher_set_tick_event_callback(dispatcher, music_tick, 200);
    view_dispatcher_add_view(dispatcher, 0, app.view);

    Storage* storage = furi_record_open(RECORD_STORAGE);
    FuriString* setup_path = furi_string_alloc_set(MUSIC_SETUP);
    storage_common_resolve_path_and_ensure_app_directory(storage, setup_path);
    furi_string_free(setup_path);
    furi_record_close(RECORD_STORAGE);
    uint8_t linked = 0;
    app.persisted = saved_struct_load(MUSIC_SETUP, &linked, sizeof(linked), 0x9a, 1) &&
                    linked == 1;
    with_view_model(
        app.view,
        MusicModel * model,
        {
            *model = (MusicModel){0};
            model->screen.setup = !app.persisted;
            model->manual_setup = !app.persisted;
            model->screen.linked = app.persisted;
        },
        false);
    music_tick(&app);
    view_dispatcher_attach_to_gui(dispatcher, gui, ViewDispatcherTypeFullscreen);
    view_dispatcher_switch_to_view(dispatcher, 0);
    view_dispatcher_run(dispatcher);
    ams_client_close(app.ams);
    ble_svc_media_unlisten(&app);
    MusicModel* model = view_get_model(app.view);
    bool dismissed = !model->screen.setup;
    view_commit_model(app.view, false);
    if(dismissed && !app.persisted) {
        linked = 1;
        saved_struct_save(MUSIC_SETUP, &linked, sizeof(linked), 0x9a, 1);
    }
    ams_client_free(app.ams);
    view_dispatcher_remove_view(dispatcher, 0);
    view_dispatcher_free(dispatcher);
    view_free(app.view);
    furi_record_close(RECORD_GUI);
    furi_record_close(RECORD_BT);
    return 0;
}
