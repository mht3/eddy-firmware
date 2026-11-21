#include "reader.h"
#include <ibutton/ibutton_worker.h>

typedef struct {
    EddyReader reader;
    iButtonKey* key;
    iButtonProtocols* protocols;
} ContactReader;

static void contact_detected(void* ctx) {
    ContactReader* app = ctx;
    eddy_reader_found(
        &app->reader,
        ibutton_protocols_get_name(app->protocols, ibutton_key_get_protocol_id(app->key)));
}

int32_t eddy_ibutton_app(void* arg) {
    UNUSED(arg);
    ContactReader app;
    eddy_reader_init(&app.reader, "iButton", "Touch a key to the contacts");
    app.protocols = ibutton_protocols_alloc();
    app.key = ibutton_key_alloc(ibutton_protocols_get_max_data_size(app.protocols));
    iButtonWorker* worker = ibutton_worker_alloc(app.protocols);
    ibutton_worker_start_thread(worker);
    ibutton_worker_read_set_callback(worker, contact_detected, &app);
    ibutton_worker_read_start(worker, app.key);
    view_dispatcher_run(app.reader.dispatcher);
    ibutton_worker_stop(worker);
    ibutton_worker_stop_thread(worker);
    ibutton_worker_free(worker);
    ibutton_key_free(app.key);
    ibutton_protocols_free(app.protocols);
    eddy_reader_free(&app.reader);
    return 0;
}
