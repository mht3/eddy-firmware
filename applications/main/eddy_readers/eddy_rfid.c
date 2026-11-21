#include "reader.h"
#include <assets_icons.h>
#include <lfrfid/lfrfid_worker.h>

typedef struct {
    EddyReader reader;
    ProtocolDict* protocols;
} RfidReader;

static void rfid_detected(LFRFIDWorkerReadResult result, ProtocolId id, void* ctx) {
    RfidReader* app = ctx;
    if(result == LFRFIDWorkerReadDone) {
        eddy_reader_found(&app->reader, protocol_dict_get_name(app->protocols, id));
    }
}

int32_t eddy_rfid_app(void* arg) {
    UNUSED(arg);
    RfidReader app;
    eddy_reader_init(&app.reader, "RFID", "Hold tag to\nFlipper's back", &I_NFC_manual_60x50);
    app.protocols = protocol_dict_alloc(lfrfid_protocols, LFRFIDProtocolMax);
    LFRFIDWorker* worker = lfrfid_worker_alloc(app.protocols);
    lfrfid_worker_start_thread(worker);
    lfrfid_worker_read_start(worker, LFRFIDWorkerReadTypeAuto, rfid_detected, &app);
    view_dispatcher_run(app.reader.dispatcher);
    lfrfid_worker_stop(worker);
    lfrfid_worker_stop_thread(worker);
    lfrfid_worker_free(worker);
    protocol_dict_free(app.protocols);
    eddy_reader_free(&app.reader);
    return 0;
}
