#include "reader.h"
#include <assets_icons.h>
#include <nfc/nfc_device.h>
#include <nfc/nfc_scanner.h>

typedef struct {
    EddyReader reader;
    NfcScanner* scanner;
} CardReader;

static void nfc_detected(NfcScannerEvent event, void* ctx) {
    if(event.type == NfcScannerEventTypeDetected && event.data.protocol_num) {
        eddy_reader_found(ctx, nfc_device_get_protocol_name(event.data.protocols[0]));
    }
}

static void nfc_rescan(void* context) {
    CardReader* app = context;
    nfc_scanner_stop(app->scanner);
    eddy_reader_clear(&app->reader);
    nfc_scanner_start(app->scanner, nfc_detected, &app->reader);
}

int32_t eddy_nfc_app(void* arg) {
    UNUSED(arg);
    CardReader app;
    eddy_reader_init(
        &app.reader, "NFC", "Hold card to\nFlipper's back", &I_NFC_manual_60x50, nfc_rescan, &app);
    Nfc* nfc = nfc_alloc();
    app.scanner = nfc_scanner_alloc(nfc);
    nfc_scanner_start(app.scanner, nfc_detected, &app.reader);
    view_dispatcher_run(app.reader.dispatcher);
    nfc_scanner_stop(app.scanner);
    nfc_scanner_free(app.scanner);
    nfc_free(nfc);
    eddy_reader_free(&app.reader);
    return 0;
}
