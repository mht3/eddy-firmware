#include "tv_presets.h"
#include <toolbox/eddy_ir_snapshot.h>
#include <infrared/signal/infrared_signal.h>

bool infrared_tv_preset_save(Storage* storage, size_t index, FuriString* target) {
    if(index >= COUNT_OF(presets)) return false;
    const TvPreset* preset = &presets[index];
    const char* dir = EXT_PATH("infrared/TV presets");
    furi_string_printf(target, "%s/%s.ir", dir, preset->model);
    const char* path = furi_string_get_cstr(target);
    if(eddy_ir_restore(storage, path) == FSE_OK) {
        return true;
    }
    FuriString* partial = furi_string_alloc_printf("%s.part", path);
    FlipperFormat* file = flipper_format_buffered_file_alloc(storage);
    InfraredSignal* signal = infrared_signal_alloc();
    bool ok = storage_simply_mkdir(storage, EXT_PATH("infrared")) &&
              storage_simply_mkdir(storage, dir) &&
              flipper_format_buffered_file_open_always(file, furi_string_get_cstr(partial)) &&
              flipper_format_write_header_cstr(file, "IR signals file", 1);
    bool roku = preset->labels == roku_labels;
    size_t buttons = roku ? 5 : COUNT_OF(preset->commands);
    size_t total = buttons + (roku ? COUNT_OF(roku_keys) : 0);
    for(size_t i = 0; ok && i < total; i++) {
        InfraredMessage message = {
            .protocol = preset->protocol,
            .address = preset->address,
            .command = i < buttons ? preset->commands[i] : roku_keys[i - buttons].command};
        const char* label = i < buttons ? preset->labels[i] : roku_keys[i - buttons].label;
        infrared_signal_set_message(signal, &message);
        ok = infrared_signal_save(signal, file, label) == InfraredErrorCodeNone;
    }
    if(!flipper_format_buffered_file_close(file)) ok = false;
    flipper_format_free(file);
    if(ok) ok = storage_common_rename_safe(storage, furi_string_get_cstr(partial), path) == FSE_OK;
    if(!ok) storage_common_remove(storage, furi_string_get_cstr(partial));
    furi_string_free(partial);
    infrared_signal_free(signal);
    return ok;
}
