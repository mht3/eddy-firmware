#include "reader.h"
#include <assets_icons.h>
#include <nfc/nfc_device.h>
#include <nfc/nfc_scanner.h>

static void nfc_detected(NfcScannerEvent event, void* ctx) {
    if(event.type == NfcScannerEventTypeDetected && event.data.protocol_num) {
        eddy_reader_found(ctx, nfc_device_get_protocol_name(event.data.protocols[0]));
    }
}

int32_t eddy_nfc_app(void* arg) {
    UNUSED(arg);
    EddyReader reader;
    eddy_reader_init(&reader, "NFC", "Hold card to\nFlipper's back", &I_NFC_manual_60x50);
    Nfc* nfc = nfc_alloc();
    NfcScanner* scanner = nfc_scanner_alloc(nfc);
    nfc_scanner_start(scanner, nfc_detected, &reader);
    view_dispatcher_run(reader.dispatcher);
    nfc_scanner_stop(scanner);
    nfc_scanner_free(scanner);
    nfc_free(nfc);
    eddy_reader_free(&reader);
    return 0;
}
