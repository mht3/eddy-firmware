#include "spotify_screen.h"
#include <bt/bt_service/bt.h>
#include <furi.h>
#include <furi_hal_random.h>
#include <gui/view_dispatcher.h>
#include <gui/modules/text_input.h>
#include <profiles/serial_profile.h>
#include <storage/storage.h>

typedef struct {
    SpotifyScreen screen;
    SpotifyLibrary status;
    char query[SpotifyQueryBytes + 1];
    uint8_t collection_row;
    uint8_t track_row;
    uint32_t status_started;
    uint32_t status_received;
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
    ViewDispatcher* dispatcher;
    TextInput* keyboard;
    char input[SpotifyQueryBytes + 1];
} SpotifyApp;

static void reset_link(SpotifyModel* model, uint16_t handle) {
    *model = (SpotifyModel){
        .connection = handle,
        .screen = {.manual_qr = model->screen.manual_qr, .setup_qr = model->screen.setup_qr}};
}

static uint8_t category_op(const SpotifyScreen* screen) {
    uint8_t op = spotify_category_ops[screen->category];
    return op == SpotifySearchTracks && screen->find_artist ? SpotifySearchArtists : op;
}

static void bridge_reset(SpotifyModel* model, bool connected) {
    SpotifyScreen* screen = &model->screen;
    screen->scene = SpotifyHome;
    screen->child_tracks = false;
    screen->library = (SpotifyLibrary){0};
    model->status = (SpotifyLibrary){0};
    model->query[0] = screen->now_playing[0] = 0;
    screen->play_state = 0;
    screen->title_bytes = 0;
    screen->duration_s = screen->elapsed_s = 0;
    screen->bridge = connected;
    model->status_started = furi_get_tick();
    model->queued = connected ? SpotifyNowPlaying : 0;
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
        if(size == 1 && packet[0] == SpotifyHello) {
            bridge_reset(model, true);
            model->seen = furi_get_tick();
        } else if(size == 1 && packet[0] == SpotifyClear) {
            bridge_reset(model, false);
        } else if(size == 1 && packet[0] == 0x17) {
            if(!model->screen.bridge) bridge_reset(model, true);
            model->seen = furi_get_tick();
        } else if(size >= 3 && packet[0] >= 0x10 && packet[0] <= 0x14) {
            uint16_t token = packet[1] | ((uint16_t)packet[2] << 8);
            SpotifyLibrary* lib = &model->screen.library;
            if(token && token == model->status.request) {
                SpotifyLibrary* status = &model->status;
                spotify_library_receive(status, packet, size);
                if(!status->request) {
                    model->status_received = furi_get_tick();
                    model->screen.play_state = status->error ? 0 : status->play_state;
                    model->screen.title_bytes = status->title_bytes;
                    model->screen.duration_s =
                        !status->error && status->count ? status->duration_ms / 1000 : 0;
                    strlcpy(
                        model->screen.now_playing,
                        status->error || !status->count ? "" : status->rows[0],
                        sizeof(model->screen.now_playing));
                }
            } else if(token && token == lib->request) {
                spotify_library_receive(lib, packet, size);
                if(!lib->request) {
                    model->scroll_start = furi_get_tick();
                    if(!lib->error && lib->accepted && (lib->op & 0xfc) == SpotifyPlay) {
                        model->queued = SpotifyNowPlaying;
                    } else if(
                        !lib->error && lib->op >= SpotifyPlayerPrevious &&
                        lib->op <= SpotifyPlayerNext) {
                        lib->accepted = false;
                        model->queued = SpotifyNowPlaying;
                    } else if(!lib->error && lib->op == SpotifyParent) {
                        uint8_t row = model->screen.scene == SpotifyDestinations ?
                                          model->track_row :
                                          model->collection_row;
                        if(row < lib->count) lib->selected = row;
                        if(model->screen.scene != SpotifyDestinations)
                            model->screen.child_tracks = false;
                        model->screen.scene = SpotifyResults;
                    } else if(!lib->error && (lib->op & 0xfc) == SpotifyChoosePlaylist) {
                        model->screen.scene = SpotifyDestinations;
                    } else if(
                        !lib->error && ((lib->op & 0xfc) == SpotifyArtistTracks ||
                                        (lib->op & 0xfc) == SpotifyCollectionTracks)) {
                        model->screen.scene = SpotifyResults;
                        model->screen.child_tracks = true;
                    }
                }
            } else {
                view_commit_model(app->view, false);
                return;
            }
            model->seen = furi_get_tick();
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
    if(model->status.request && now - model->status_started > furi_ms_to_ticks(20000))
        spotify_library_fail(&model->status, SpotifyOffline);
    if(model->screen.bridge && now - model->seen > furi_ms_to_ticks(45000))
        bridge_reset(model, false);
    if(model->screen.bridge && !model->queued && !model->status.request && !lib->request &&
       now - model->status_started >= furi_ms_to_ticks(30000))
        model->queued = SpotifyNowPlaying;
    uint8_t op = model->queued;
    uint16_t request = 0, page = 0;
    char query[SpotifyQueryBytes + 1] = {0};
    uint16_t handle = model->connection;
    if(op && model->screen.connected) {
        do {
            ++app->sequence;
        } while(!app->sequence || app->sequence == model->status.request ||
                app->sequence == lib->page);
        request = app->sequence;
        if(op == SpotifyNowPlaying) {
            spotify_library_begin(&model->status, op, request);
            model->status_started = now;
        } else if(op != SpotifyHello && op != SpotifyClear) {
            if(op == SpotifyNext || op == SpotifyPrevious || op == SpotifyParent ||
               (op >= SpotifyPlay && op < SpotifyPlayerPrevious))
                page = lib->page;
            if(op == SpotifySearchTracks || op == SpotifySearchArtists)
                strlcpy(query, model->query, sizeof(query));
            spotify_library_begin(lib, op, request);
            model->started = now;
        }
    }
    model->queued = 0;
    if(model->screen.duration_s) {
        uint32_t elapsed = model->status.progress_ms / 1000;
        if(model->screen.play_state == 1)
            elapsed += (now - model->status_received) / furi_ms_to_ticks(1000);
        model->screen.elapsed_s = MIN(elapsed, model->screen.duration_s);
    }
    model->screen.scroll = (now - model->scroll_start) / furi_ms_to_ticks(70);
    view_commit_model(app->view, true);
    if(request) {
        uint8_t current[GAP_MAC_ADDR_SIZE];
        bool sent = bt_get_connected_peer_address(app->bt, current) &&
                    !memcmp(peer, current, sizeof(peer)) &&
                    (query[0] ? ble_svc_media_library_search(app, handle, op, request, query) :
                                ble_svc_media_library_request(app, handle, op, request, page));
        if(!sent && op != SpotifyHello && op != SpotifyClear) {
            model = view_get_model(app->view);
            if(model->status.request == request)
                spotify_library_fail(&model->status, SpotifyOffline);
            if(model->screen.library.request == request)
                spotify_library_fail(&model->screen.library, SpotifyOffline);
            view_commit_model(app->view, true);
        }
    }
}

static uint32_t search_back(void* context) {
    UNUSED(context);
    return 0;
}

static void finish_search(void* context) {
    SpotifyApp* app = context;
    SpotifyModel* model = view_get_model(app->view);
    if(model->screen.bridge && model->screen.scene == SpotifyFindKind && app->input[0]) {
        strlcpy(model->query, app->input, sizeof(model->query));
        model->screen.scene = SpotifyResults;
        model->queued = category_op(&model->screen);
    }
    view_commit_model(app->view, true);
    view_dispatcher_switch_to_view(app->dispatcher, 0);
}

static void return_home(SpotifyModel* model) {
    model->screen.scene = SpotifyHome;
    model->screen.child_tracks = false;
    model->screen.library = (SpotifyLibrary){0};
    model->queued = model->screen.bridge ? SpotifyClear : 0;
}

static bool spotify_input(InputEvent* event, void* context) {
    bool setup = event->type == InputTypeLong && event->key == InputKeyUp;
    if(event->type != InputTypeShort && !setup) return false;
    SpotifyApp* app = context;
    SpotifyModel* model = view_get_model(app->view);
    SpotifyScreen* screen = &model->screen;
    SpotifyLibrary* lib = &screen->library;
    uint8_t op = category_op(screen);
    InputKey key = event->key;
    bool handled = true, keyboard = false;
    bool vertical = key == InputKeyUp || key == InputKeyDown;
    if(setup) {
        screen->manual_qr = true;
    } else if(spotify_screen_shows_qr(screen)) {
        if(key == InputKeyOk || (key == InputKeyBack && screen->manual_qr)) {
            screen->manual_qr = false;
            screen->dismissed_qr = true;
        } else
            handled = false;
    } else if(lib->accepted && (key == InputKeyOk || key == InputKeyBack)) {
        lib->accepted = false;
        if(screen->scene == SpotifyDestinations)
            model->queued = SpotifyParent;
        else
            screen->scene = SpotifyResults;
        model->scroll_start = furi_get_tick();
    } else if(spotify_library_action_unconfirmed(lib) && (key == InputKeyOk || key == InputKeyBack)) {
        lib->error = SpotifyOk;
        if(screen->scene == SpotifyDestinations)
            model->queued = SpotifyParent;
        else if(screen->scene == SpotifyPlayer)
            model->queued = SpotifyNowPlaying;
        else
            screen->scene = SpotifyResults;
    } else if(key == InputKeyBack) {
        if(screen->scene == SpotifyLyricsHelp)
            screen->scene = SpotifyPlayer;
        else if(screen->scene == SpotifyHome)
            handled = false;
        else if(lib->request || (model->queued && model->queued != SpotifyNowPlaying) || lib->error)
            return_home(model);
        else if(screen->scene == SpotifyActions)
            screen->scene = SpotifyResults;
        else if(screen->scene == SpotifyDestinations || screen->child_tracks)
            model->queued = SpotifyParent;
        else if(
            screen->scene == SpotifyResults &&
            (op == SpotifySearchTracks || op == SpotifySearchArtists)) {
            screen->scene = SpotifyFindKind;
            *lib = (SpotifyLibrary){0};
        } else
            return_home(model);
    } else if(!screen->bridge) {
        if(key == InputKeyOk)
            model->queued = SpotifyHello;
        else
            handled = false;
    } else if(screen->scene == SpotifyHome) {
        if(vertical) {
            screen->category =
                (screen->category + (key == InputKeyUp ? SpotifyCategories - 1 : 1)) %
                SpotifyCategories;
        } else if(key == InputKeyOk) {
            if(op == SpotifySearchTracks || op == SpotifySearchArtists) {
                screen->scene = SpotifyFindKind;
            } else if(op == SpotifyNowPlaying) {
                screen->scene = SpotifyPlayer;
                model->queued = SpotifyNowPlaying;
            } else {
                screen->scene = SpotifyResults;
                model->queued = op;
            }
        } else
            handled = false;
    } else if(screen->scene == SpotifyLyricsHelp) {
        if(key == InputKeyOk || key == InputKeyUp)
            screen->scene = SpotifyPlayer;
        else
            handled = false;
    } else if(screen->scene == SpotifyPlayer) {
        if(lib->request || (model->queued && model->queued != SpotifyNowPlaying)) {
            // A second tap must not duplicate a playback command.
        } else if(lib->error && key == InputKeyOk)
            model->queued = lib->op;
        else if(key == InputKeyOk)
            model->queued = SpotifyPlayerToggle;
        else if(key == InputKeyLeft)
            model->queued = SpotifyPlayerPrevious;
        else if(key == InputKeyRight)
            model->queued = SpotifyPlayerNext;
        else if(key == InputKeyDown)
            screen->scene = SpotifyLyricsHelp;
        else
            handled = false;
    } else if(screen->scene == SpotifyFindKind) {
        if(vertical)
            screen->find_artist = !screen->find_artist;
        else if(key == InputKeyOk) {
            strlcpy(app->input, model->query, sizeof(app->input));
            keyboard = true;
        } else
            handled = false;
    } else if(lib->request || (model->queued && model->queued != SpotifyNowPlaying) || lib->accepted) {
        // Only a committed page can supply the row token for the next operation.
    } else if(lib->error) {
        if(key == InputKeyOk)
            model->queued = lib->op;
        else
            handled = false;
    } else if(screen->scene == SpotifyActions) {
        uint8_t count = spotify_action_count(screen);
        if(vertical)
            screen->action = (screen->action + (key == InputKeyUp ? count - 1 : 1)) % count;
        else if(key == InputKeyOk) {
            bool collection = count == 2;
            static const uint8_t track_actions[] = {
                SpotifyPlay, SpotifyQueue, SpotifyChoosePlaylist};
            uint8_t action = collection ? (screen->action ? SpotifyPlay :
                                                            (op == SpotifySearchArtists ?
                                                                 SpotifyArtistTracks :
                                                                 SpotifyCollectionTracks)) :
                                          track_actions[screen->action];
            if(action == SpotifyArtistTracks || action == SpotifyCollectionTracks)
                model->collection_row = lib->selected;
            if(action == SpotifyChoosePlaylist) model->track_row = lib->selected;
            model->queued = action + lib->selected;
        } else
            handled = false;
    } else if(key == InputKeyRight && lib->next)
        model->queued = SpotifyNext;
    else if(key == InputKeyLeft && lib->previous)
        model->queued = SpotifyPrevious;
    else if(lib->count && vertical) {
        lib->selected = (lib->selected + (key == InputKeyUp ? lib->count - 1 : 1)) % lib->count;
        model->scroll_start = furi_get_tick();
    } else if(key == InputKeyOk && lib->count) {
        if(screen->scene == SpotifyDestinations)
            model->queued = SpotifyAddToPlaylist + lib->selected;
        else {
            screen->scene = SpotifyActions;
            screen->action = 0;
        }
    } else if(key == InputKeyOk && !screen->child_tracks && screen->scene != SpotifyDestinations)
        model->queued = op;
    else
        handled = false;
    bool find_artist = screen->find_artist;
    view_commit_model(app->view, handled);
    if(keyboard) {
        text_input_set_header_text(app->keyboard, find_artist ? "Find an artist" : "Find a track");
        text_input_set_result_callback(
            app->keyboard, finish_search, app, app->input, sizeof(app->input), true);
        view_dispatcher_switch_to_view(app->dispatcher, 1);
    }
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
    app.dispatcher = dispatcher;
    app.keyboard = text_input_alloc();
    text_input_set_minimum_length(app.keyboard, 1);
    view_set_previous_callback(text_input_get_view(app.keyboard), search_back);
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
    view_dispatcher_add_view(dispatcher, 1, text_input_get_view(app.keyboard));
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
    view_dispatcher_remove_view(dispatcher, 1);
    text_input_free(app.keyboard);
    view_dispatcher_remove_view(dispatcher, 0);
    view_dispatcher_free(dispatcher);
    view_free(app.view);
    free(setup_qr);
    furi_record_close(RECORD_GUI);
    furi_record_close(RECORD_BT);
    return 0;
}
