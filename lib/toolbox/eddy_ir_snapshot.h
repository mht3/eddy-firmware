#pragma once

#include <storage/storage.h>

#define EDDY_IR_BACKUP ".eddy-backup"

// Edits only rename into empty destinations. After a power loss, the original
// is either at its normal path or in this backup until the new file is in place.
static inline FS_Error eddy_ir_restore(Storage* storage, const char* path) {
    FS_Error status = storage_common_stat(storage, path, NULL);
    if(status != FSE_NOT_EXIST) return status;
    FuriString* backup = furi_string_alloc_printf("%s%s", path, EDDY_IR_BACKUP);
    status = storage_common_rename_safe(storage, furi_string_get_cstr(backup), path);
    furi_string_free(backup);
    return status;
}

static inline bool eddy_ir_clear_backup(Storage* storage, const char* path) {
    FuriString* backup = furi_string_alloc_printf("%s%s", path, EDDY_IR_BACKUP);
    bool ok = storage_simply_remove(storage, furi_string_get_cstr(backup));
    furi_string_free(backup);
    return ok;
}

static inline bool eddy_ir_commit(Storage* storage, const char* path, const char* replacement) {
    FuriString* backup = furi_string_alloc_printf("%s%s", path, EDDY_IR_BACKUP);
    const char* saved = furi_string_get_cstr(backup);
    bool ok = eddy_ir_restore(storage, path) == FSE_OK && storage_simply_remove(storage, saved) &&
              storage_common_rename_safe(storage, path, saved) == FSE_OK;
    if(ok) {
        ok = storage_common_rename_safe(storage, replacement, path) == FSE_OK;
        if(ok) {
            storage_simply_remove(storage, saved);
        } else {
            // A media error may delay recovery until the next mount.
            storage_common_rename_safe(storage, saved, path);
        }
    }
    furi_string_free(backup);
    return ok;
}
