#include "reader.h"
#include <assets_icons.h>
#include <ibutton/ibutton_worker.h>

typedef struct {
    EddyReader reader;
    iButtonKey* key;
    iButtonWorker* worker;
    iButtonProtocols* protocols;
} ContactReader;

static void contact_detected(void* ctx) {
    ContactReader* app = ctx;
    eddy_reader_found(
        &app->reader,
        ibutton_protocols_get_name(app->protocols, ibutton_key_get_protocol_id(app->key)));
}

static void contact_rescan(void* context) {
    ContactReader* app = context;
    eddy_reader_clear(&app->reader);
    ibutton_worker_read_start(app->worker, app->key);
}

int32_t eddy_ibutton_app(void* arg) {
    UNUSED(arg);
    ContactReader app;
    eddy_reader_init(
        &app.reader,
        "iButton",
        "Touch key to\nthe contacts",
        &I_DolphinWait_59x54,
        contact_rescan,
        &app);
    app.protocols = ibutton_protocols_alloc();
    app.key = ibutton_key_alloc(ibutton_protocols_get_max_data_size(app.protocols));
    app.worker = ibutton_worker_alloc(app.protocols);
    ibutton_worker_start_thread(app.worker);
    ibutton_worker_read_set_callback(app.worker, contact_detected, &app);
    ibutton_worker_read_start(app.worker, app.key);
    view_dispatcher_run(app.reader.dispatcher);
    ibutton_worker_stop(app.worker);
    ibutton_worker_stop_thread(app.worker);
    ibutton_worker_free(app.worker);
    ibutton_key_free(app.key);
    ibutton_protocols_free(app.protocols);
    eddy_reader_free(&app.reader);
    return 0;
}
