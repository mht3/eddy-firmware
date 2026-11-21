#include "ams_client.h"
#include <profiles/serial_profile.h>
#include "music_screen.h"
#include <bt/bt_service/bt.h>
#include <furi_hal_bt.h>
#include <furi.h>
#include <gui/view_dispatcher.h>

typedef struct {
    MusicScreen screen; // The view renderer reads the first member.
    MusicFrame iphone;
    uint32_t sample_tick;
    uint32_t title_tick;
    uint32_t feedback_tick;
    uint8_t sample_peer[GAP_MAC_ADDR_SIZE];
} MusicModel;

typedef struct {
    Bt* bt;
    AmsClient* ams;
    View* view;
} MusicApp;

static void clear_session(MusicModel* model) {
    model->screen.connected = false;
    model->screen.feedback = MusicFeedbackNone;
    model->screen.track = (MusicTrackInfo){0};
    model->screen.position = 0;
    model->screen.state = MusicWaiting;
    model->iphone.started = false;
}

static void receive_iphone(const uint8_t* data, size_t size, void* context) {
    MusicApp* app = context;
    uint8_t peer[GAP_MAC_ADDR_SIZE];
    if(data && !bt_get_connected_peer_address(app->bt, peer)) return;
    MusicModel* model = view_get_model(app->view);
    if(!data) {
        clear_session(model);
    } else {
        MusicFrame* frame = &model->iphone;
        bool new_title = data[0] == 4 && frame->started &&
                         strcmp(frame->pending.title, model->screen.track.title) != 0;
        if(music_frame_receive(frame, &model->screen.track, &model->screen.state, data, size)) {
            memcpy(model->sample_peer, peer, sizeof(peer));
            model->sample_tick = furi_get_tick();
            model->screen.position = model->screen.track.elapsed;
            if(new_title) model->title_tick = model->sample_tick;
        }
    }
    view_commit_model(app->view, false);
}

static void media_event(BleMediaEvent event, const void* data, size_t size, void* context) {
    MusicApp* app = context;
    switch(event) {
    case BleMediaLink: {
        uint16_t handle = *(const uint16_t*)data;
        ams_client_set_link(app->ams, handle);
        if(handle == UINT16_MAX) receive_iphone(NULL, 0, app);
        break;
    }
    case BleMediaRadio:
        ams_client_event(app->ams, data);
        break;
    case BleMediaFrame:
        // The separate Spotify library app owns the browser bridge.
        UNUSED(size);
        break;
    }
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
    if(connected && model->screen.state == MusicWaiting)
        memcpy(model->sample_peer, peer, sizeof(peer));
    model->screen.connected = connected;
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
    if(model->screen.feedback != MusicFeedbackNone &&
       now - model->feedback_tick >= furi_ms_to_ticks(1800))
        model->screen.feedback = MusicFeedbackNone;
    view_commit_model(app->view, true);
    ams_client_tick(app->ams, connected, receive_iphone, app);
}

static bool music_input(InputEvent* event, void* context) {
    if(event->type != InputTypeShort) return false;
    MusicApp* app = context;
    MusicModel* model = view_get_model(app->view);
    bool handled = true;
    uint8_t command = 0;
    bool use_hid = model->screen.state != MusicTrack;
    uint8_t sample_peer[GAP_MAC_ADDR_SIZE];
    memcpy(sample_peer, model->sample_peer, sizeof(sample_peer));
    if(model->screen.connected) {
        if(event->key == InputKeyLeft)
            command = BleMediaPrevious;
        else if(event->key == InputKeyOk)
            command = BleMediaPlayPause;
        else if(event->key == InputKeyRight)
            command = BleMediaNext;
        else if(event->key == InputKeyUp || event->key == InputKeyDown) {
            bool up = event->key == InputKeyUp;
            command = up ? BleMediaVolumeUp : BleMediaVolumeDown;
            if(!ams_client_supports_volume(app->ams, up)) use_hid = true;
        } else
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
                               ams_client_send(app->ams, command));
        bool volume = command == BleMediaVolumeUp || command == BleMediaVolumeDown;
        if(!sent || volume) {
            with_view_model(
                app->view,
                MusicModel * state,
                {
                    state->feedback_tick = furi_get_tick();
                    state->screen.feedback = !sent                       ? MusicFeedbackFailed :
                                             command == BleMediaVolumeUp ? MusicFeedbackLouder :
                                                                           MusicFeedbackQuieter;
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

    music_tick(&app);
    view_dispatcher_attach_to_gui(dispatcher, gui, ViewDispatcherTypeFullscreen);
    view_dispatcher_switch_to_view(dispatcher, 0);
    view_dispatcher_run(dispatcher);
    ams_client_close(app.ams);
    ble_svc_media_unlisten(&app);
    ams_client_free(app.ams);
    view_dispatcher_remove_view(dispatcher, 0);
    view_dispatcher_free(dispatcher);
    view_free(app.view);
    furi_record_close(RECORD_GUI);
    furi_record_close(RECORD_BT);
    return 0;
}
