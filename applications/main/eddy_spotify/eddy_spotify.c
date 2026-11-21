#include "spotify_screen.h"
#include <bt/bt_service/bt.h>
#include <furi.h>
#include <furi_hal_random.h>
#include <gui/view_dispatcher.h>
#include <profiles/serial_profile.h>
#include <storage/storage.h>

typedef struct {
    SpotifyScreen screen;
    uint16_t connection;
    uint8_t peer[GAP_MAC_ADDR_SIZE];
    uint8_t queued;
    uint32_t started;
    uint32_t seen;
    uint32_t scroll_start;
} SpotifyModel;

typedef struct {
    Bt* bt;
    View* view;
    uint16_t sequence;
} SpotifyApp;

static void reset_link(SpotifyModel* model, uint16_t handle) {
    *model = (SpotifyModel){
        .connection = handle,
        .screen = {.manual_qr = model->screen.manual_qr, .setup_qr = model->screen.setup_qr}};
}

static void spotify_event(BleMediaEvent event, const void* data, size_t size, void* context) {
    SpotifyApp* app = context;
    if(event == BleMediaRadio) return;
    uint8_t peer[GAP_MAC_ADDR_SIZE];
    if(event == BleMediaFrame && !bt_get_connected_peer_address(app->bt, peer)) return;
    SpotifyModel* model = view_get_model(app->view);
    if(event == BleMediaLink) {
        reset_link(model, *(const uint16_t*)data);
    } else if(model->screen.connected && !memcmp(model->peer, peer, sizeof(peer)) && size) {
        const uint8_t* packet = data;
        SpotifyLibrary* lib = &model->screen.library;
        if(size == 1 && packet[0] == SpotifyHello) {
            *lib = (SpotifyLibrary){0};
            model->queued = model->screen.browsing ? spotify_category_ops[model->screen.category] :
                                                     0;
            model->screen.bridge = true;
            model->seen = furi_get_tick();
        } else if(size == 1 && packet[0] == SpotifyClear) {
            *lib = (SpotifyLibrary){0};
            model->queued = 0;
            model->screen.bridge = false;
        } else if(size == 1 && packet[0] == 0x17) {
            model->seen = furi_get_tick();
            if(!model->screen.bridge && !lib->request)
                model->queued =
                    model->screen.browsing ? spotify_category_ops[model->screen.category] : 0;
            model->screen.bridge = true;
        } else if(
            size >= 3 && lib->request &&
            lib->request == (uint16_t)(packet[1] | ((uint16_t)packet[2] << 8)) &&
            packet[0] >= 0x10 && packet[0] <= 0x14) {
            model->screen.bridge = true;
            model->seen = furi_get_tick();
            spotify_library_receive(lib, packet, size);
            if(!lib->request) model->scroll_start = model->seen;
        }
    }
    view_commit_model(app->view, false);
}

static void spotify_tick(void* context) {
    SpotifyApp* app = context;
    uint8_t peer[GAP_MAC_ADDR_SIZE];
    bool secure = ble_svc_media_listen(spotify_event, app) &&
                  bt_get_connected_peer_address(app->bt, peer);
    uint32_t now = furi_get_tick();
    SpotifyModel* model = view_get_model(app->view);
    SpotifyLibrary* lib = &model->screen.library;
    if(model->screen.connected && (!secure || memcmp(model->peer, peer, sizeof(peer))))
        reset_link(model, model->connection);
    if(secure && model->connection != UINT16_MAX && !model->screen.connected) {
        model->screen.connected = true;
        memcpy(model->peer, peer, sizeof(peer));
        model->queued = SpotifyHello;
    }
    if(lib->request && now - model->started > furi_ms_to_ticks(20000))
        spotify_library_fail(lib, SpotifyOffline);
    if(model->screen.bridge && now - model->seen > furi_ms_to_ticks(45000)) {
        *lib = (SpotifyLibrary){0};
        model->queued = 0;
        model->screen.bridge = false;
    }
    uint8_t op = model->queued;
    uint16_t request = 0, page = 0;
    uint16_t handle = model->connection;
    if(op && model->screen.connected) {
        if(!++app->sequence) ++app->sequence;
        request = app->sequence;
        if(op != SpotifyHello && op != SpotifyClear) {
            if(op == SpotifyNext || op == SpotifyPrevious || op >= SpotifyPlay) page = lib->page;
            spotify_library_begin(lib, op, request);
        }
        model->started = now;
    }
    model->queued = 0;
    model->screen.scroll = (now - model->scroll_start) / furi_ms_to_ticks(70);
    view_commit_model(app->view, true);
    if(request) {
        uint8_t current[GAP_MAC_ADDR_SIZE];
        bool sent = bt_get_connected_peer_address(app->bt, current) &&
                    !memcmp(peer, current, sizeof(peer)) &&
                    ble_svc_media_library_request(app, handle, op, request, page);
        if(!sent && op != SpotifyHello && op != SpotifyClear) {
            model = view_get_model(app->view);
            if(model->screen.library.request == request)
                spotify_library_fail(&model->screen.library, SpotifyOffline);
            view_commit_model(app->view, true);
        }
    }
}

static bool spotify_input(InputEvent* event, void* context) {
    bool setup = event->type == InputTypeLong && event->key == InputKeyUp;
    if(event->type != InputTypeShort && !setup) return false;
    SpotifyApp* app = context;
    SpotifyModel* model = view_get_model(app->view);
    SpotifyScreen* screen = &model->screen;
    SpotifyLibrary* lib = &screen->library;
    bool handled = true;
    if(setup) {
        screen->manual_qr = true;
    } else if(spotify_screen_shows_qr(screen)) {
        if(event->key == InputKeyOk || (event->key == InputKeyBack && screen->manual_qr)) {
            screen->manual_qr = false;
            screen->dismissed_qr = true;
        } else
            handled = false;
    } else if(lib->accepted && (event->key == InputKeyOk || event->key == InputKeyBack)) {
        lib->accepted = false;
        model->scroll_start = furi_get_tick();
    } else if(event->key == InputKeyBack) {
        handled = screen->browsing;
        if(handled) {
            screen->browsing = false;
            *lib = (SpotifyLibrary){0};
            model->queued = screen->bridge ? SpotifyClear : 0;
        }
    } else if(!screen->bridge) {
        if(event->key == InputKeyOk)
            model->queued = SpotifyHello;
        else
            handled = false;
    } else if(!screen->browsing) {
        if(event->key == InputKeyUp || event->key == InputKeyDown) {
            screen->category =
                (screen->category + (event->key == InputKeyUp ? SpotifyCategories - 1 : 1)) %
                SpotifyCategories;
        } else if(event->key == InputKeyOk) {
            screen->browsing = true;
            model->queued = spotify_category_ops[screen->category];
        } else
            handled = false;
    } else if(lib->request || model->queued || lib->accepted) {
        // Until the current request finishes, a row belongs to its previous page.
    } else if(event->key == InputKeyOk && (lib->error || !lib->page || !lib->count)) {
        model->queued = spotify_category_ops[screen->category];
    } else if(lib->error || !lib->page) {
        handled = false;
    } else if(event->key == InputKeyRight && lib->next) {
        model->queued = SpotifyNext;
    } else if(event->key == InputKeyLeft && lib->previous) {
        model->queued = SpotifyPrevious;
    } else if(lib->count && (event->key == InputKeyUp || event->key == InputKeyDown)) {
        lib->selected =
            (lib->selected + (event->key == InputKeyUp ? lib->count - 1 : 1)) % lib->count;
        model->scroll_start = furi_get_tick();
    } else if(event->key == InputKeyOk && lib->count) {
        model->queued = SpotifyPlay + lib->selected;
    } else
        handled = false;
    view_commit_model(app->view, handled);
    return handled;
}

static uint32_t spotify_exit(void* context) {
    UNUSED(context);
    return VIEW_NONE;
}

static uint8_t* load_setup_qr(void) {
    Storage* storage = furi_record_open(RECORD_STORAGE);
    File* file = storage_file_alloc(storage);
    uint8_t* bitmap = NULL;
    if(storage_file_open(file, APP_DATA_PATH("setup.qr"), FSAM_READ, FSOM_OPEN_EXISTING) &&
       storage_file_size(file) == SpotifyQrBytes) {
        bitmap = malloc(SpotifyQrBytes);
        if(bitmap && storage_file_read(file, bitmap, SpotifyQrBytes) != SpotifyQrBytes) {
            free(bitmap);
            bitmap = NULL;
        }
    }
    storage_file_free(file);
    furi_record_close(RECORD_STORAGE);
    return bitmap;
}

int32_t eddy_spotify_app(void* argument) {
    UNUSED(argument);
    SpotifyApp app = {
        .bt = furi_record_open(RECORD_BT),
        .view = view_alloc(),
        .sequence = furi_hal_random_get()};
    Gui* gui = furi_record_open(RECORD_GUI);
    ViewDispatcher* dispatcher = view_dispatcher_alloc();
    view_allocate_model(app.view, ViewModelTypeLocking, sizeof(SpotifyModel));
    uint8_t* setup_qr = load_setup_qr();
    with_view_model(
        app.view,
        SpotifyModel * model,
        {
            *model = (SpotifyModel){.connection = UINT16_MAX};
            model->screen.setup_qr = setup_qr;
        },
        false);
    view_set_context(app.view, &app);
    view_set_draw_callback(app.view, spotify_screen_draw);
    view_set_input_callback(app.view, spotify_input);
    view_set_previous_callback(app.view, spotify_exit);
    view_dispatcher_set_event_callback_context(dispatcher, &app);
    view_dispatcher_set_tick_event_callback(dispatcher, spotify_tick, 200);
    view_dispatcher_add_view(dispatcher, 0, app.view);
    spotify_tick(&app);
    view_dispatcher_attach_to_gui(dispatcher, gui, ViewDispatcherTypeFullscreen);
    view_dispatcher_switch_to_view(dispatcher, 0);
    view_dispatcher_run(dispatcher);
    SpotifyModel* model = view_get_model(app.view);
    bool clear = model->screen.connected && model->screen.bridge;
    model->queued = clear ? SpotifyClear : 0;
    view_commit_model(app.view, false);
    if(clear) spotify_tick(&app);
    ble_svc_media_unlisten(&app);
    view_dispatcher_remove_view(dispatcher, 0);
    view_dispatcher_free(dispatcher);
    view_free(app.view);
    free(setup_qr);
    furi_record_close(RECORD_GUI);
    furi_record_close(RECORD_BT);
    return 0;
}
