#include "infrared_remote.h"

#include <m-array.h>

#include <toolbox/m_cstr_dup.h>
#include <toolbox/path.h>
#include <toolbox/eddy_ir_snapshot.h>
#include <toolbox/dir_walk.h>
#include <storage/storage.h>

#define TAG "InfraredRemote"

#define INFRARED_FILE_HEADER    "IR signals file"
#define INFRARED_LIBRARY_HEADER "IR library file"
#define INFRARED_FILE_VERSION   (1)

ARRAY_DEF(StringArray, const char*, M_CSTR_DUP_OPLIST); //-V575

struct InfraredRemote {
    StringArray_t signal_names;
    FuriString* name;
    FuriString* path;
};

typedef struct {
    InfraredRemote* remote;
    FlipperFormat* ff_in;
    FlipperFormat* ff_out;
    FuriString* signal_name;
    InfraredSignal* signal;
    size_t signal_index;
} InfraredBatch;

typedef struct {
    size_t signal_index;
    size_t destination;
    const char* signal_name;
    const InfraredSignal* signal;
    bool append;
} InfraredBatchTarget;

typedef InfraredErrorCode (
    *InfraredBatchCallback)(const InfraredBatch* batch, const InfraredBatchTarget* target);

InfraredRemote* infrared_remote_alloc(void) {
    InfraredRemote* remote = malloc(sizeof(InfraredRemote));
    StringArray_init(remote->signal_names);
    remote->name = furi_string_alloc();
    remote->path = furi_string_alloc();
    return remote;
}

void infrared_remote_free(InfraredRemote* remote) {
    StringArray_clear(remote->signal_names);
    furi_string_free(remote->path);
    furi_string_free(remote->name);
    free(remote);
}

void infrared_remote_reset(InfraredRemote* remote) {
    StringArray_reset(remote->signal_names);
    furi_string_reset(remote->name);
    furi_string_reset(remote->path);
}

const char* infrared_remote_get_name(const InfraredRemote* remote) {
    return furi_string_get_cstr(remote->name);
}

static void infrared_remote_set_path(InfraredRemote* remote, const char* path) {
    furi_string_set(remote->path, path);
    path_extract_filename(remote->path, remote->name, true);
}

const char* infrared_remote_get_path(const InfraredRemote* remote) {
    return furi_string_get_cstr(remote->path);
}

size_t infrared_remote_get_signal_count(const InfraredRemote* remote) {
    return StringArray_size(remote->signal_names);
}

const char* infrared_remote_get_signal_name(const InfraredRemote* remote, size_t index) {
    furi_assert(index < infrared_remote_get_signal_count(remote));
    return *StringArray_cget(remote->signal_names, index);
}

InfraredErrorCode infrared_remote_load_signal(
    const InfraredRemote* remote,
    InfraredSignal* signal,
    size_t index) {
    furi_assert(index < infrared_remote_get_signal_count(remote));

    Storage* storage = furi_record_open(RECORD_STORAGE);
    FlipperFormat* ff = flipper_format_buffered_file_alloc(storage);

    InfraredErrorCode error = InfraredErrorCodeNone;

    do {
        const char* path = furi_string_get_cstr(remote->path);
        if(!flipper_format_buffered_file_open_existing(ff, path)) {
            error = InfraredErrorCodeFileOperationFailed;
            break;
        }

        error = infrared_signal_search_by_index_and_read(signal, ff, index);
        if(INFRARED_ERROR_PRESENT(error)) {
            const char* signal_name = infrared_remote_get_signal_name(remote, index);
            FURI_LOG_E(TAG, "Failed to load signal '%s' from file '%s'", signal_name, path);
            break;
        }
    } while(false);

    flipper_format_free(ff);
    furi_record_close(RECORD_STORAGE);

    return error;
}

bool infrared_remote_get_signal_index(
    const InfraredRemote* remote,
    const char* name,
    size_t* index) {
    uint32_t i = 0;
    StringArray_it_t it;

    for(StringArray_it(it, remote->signal_names); !StringArray_end_p(it);
        StringArray_next(it), ++i) {
        if(strcmp(*StringArray_cref(it), name) == 0) {
            *index = i;
            return true;
        }
    }

    return false;
}

static InfraredErrorCode infrared_remote_batch_start(
    InfraredRemote* remote,
    InfraredBatchCallback batch_callback,
    const InfraredBatchTarget* target) {
    const char* path_in = furi_string_get_cstr(remote->path);
    FuriString* tmp = furi_string_alloc_printf("%s.eddy-part", path_in);
    Storage* storage = furi_record_open(RECORD_STORAGE);

    InfraredBatch batch_context = {
        .remote = remote,
        .ff_in = flipper_format_buffered_file_alloc(storage),
        .ff_out = flipper_format_buffered_file_alloc(storage),
        .signal_name = furi_string_alloc(),
        .signal = infrared_signal_alloc(),
        .signal_index = 0,
    };

    const char* path_out = furi_string_get_cstr(tmp);

    InfraredErrorCode error = InfraredErrorCodeNone;

    StringArray_t buf_names;
    StringArray_init_set(buf_names, remote->signal_names);
    do {
        if(eddy_ir_restore(storage, path_in) != FSE_OK ||
           !flipper_format_buffered_file_open_existing(batch_context.ff_in, path_in) ||
           !flipper_format_buffered_file_open_always(batch_context.ff_out, path_out) ||
           !flipper_format_write_header_cstr(
               batch_context.ff_out, INFRARED_FILE_HEADER, INFRARED_FILE_VERSION)) {
            error = InfraredErrorCodeFileOperationFailed;
            break;
        }
        const size_t signal_count = infrared_remote_get_signal_count(remote);

        for(; batch_context.signal_index < signal_count; ++batch_context.signal_index) {
            error = infrared_signal_read(
                batch_context.signal, batch_context.ff_in, batch_context.signal_name);
            if(INFRARED_ERROR_PRESENT(error)) {
                INFRARED_ERROR_SET_INDEX(error, batch_context.signal_index);
                break;
            }

            error = batch_callback(&batch_context, target);
            if(INFRARED_ERROR_PRESENT(error)) {
                INFRARED_ERROR_SET_INDEX(error, batch_context.signal_index);
                break;
            }
        }
        if(target->append && !INFRARED_ERROR_PRESENT(error)) {
            error =
                infrared_signal_save(target->signal, batch_context.ff_out, target->signal_name);
            if(!INFRARED_ERROR_PRESENT(error))
                StringArray_push_back(remote->signal_names, target->signal_name);
        }
        if(INFRARED_ERROR_PRESENT(error)) break;

        if(!flipper_format_buffered_file_close(batch_context.ff_out) ||
           !flipper_format_buffered_file_close(batch_context.ff_in)) {
            error = InfraredErrorCodeFileOperationFailed;
            break;
        }

        if(!eddy_ir_commit(storage, path_in, path_out))
            error = InfraredErrorCodeFileOperationFailed;
    } while(false);

    if(INFRARED_ERROR_PRESENT(error)) {
        //Remove all temp data and rollback signal names
        flipper_format_buffered_file_close(batch_context.ff_out);
        flipper_format_buffered_file_close(batch_context.ff_in);
        storage_common_remove(storage, path_out);

        StringArray_reset(remote->signal_names);
        StringArray_set(remote->signal_names, buf_names);
    }

    StringArray_clear(buf_names);
    infrared_signal_free(batch_context.signal);
    furi_string_free(batch_context.signal_name);
    flipper_format_free(batch_context.ff_out);
    flipper_format_free(batch_context.ff_in);
    furi_string_free(tmp);

    furi_record_close(RECORD_STORAGE);

    return error;
}

static InfraredErrorCode infrared_remote_insert_signal_callback(
    const InfraredBatch* batch,
    const InfraredBatchTarget* target) {
    // Insert a signal under the specified index
    if(batch->signal_index == target->signal_index) {
        InfraredErrorCode error =
            infrared_signal_save(target->signal, batch->ff_out, target->signal_name);
        if(INFRARED_ERROR_PRESENT(error)) return error;

        StringArray_push_at(
            batch->remote->signal_names, target->signal_index, target->signal_name);
    }

    // Write the rest normally
    return infrared_signal_save(
        batch->signal, batch->ff_out, furi_string_get_cstr(batch->signal_name));
}

InfraredErrorCode infrared_remote_append_signal(
    InfraredRemote* remote,
    const InfraredSignal* signal,
    const char* name) {
    const InfraredBatchTarget target = {
        .signal_index = infrared_remote_get_signal_count(remote),
        .signal_name = name,
        .signal = signal,
        .append = true};
    return infrared_remote_batch_start(remote, infrared_remote_insert_signal_callback, &target);
}

InfraredErrorCode infrared_remote_insert_signal(
    InfraredRemote* remote,
    const InfraredSignal* signal,
    const char* name,
    size_t index) {
    if(index >= infrared_remote_get_signal_count(remote)) {
        return infrared_remote_append_signal(remote, signal, name);
    }

    const InfraredBatchTarget insert_target = {
        .signal_index = index,
        .signal_name = name,
        .signal = signal,
    };

    return infrared_remote_batch_start(
        remote, infrared_remote_insert_signal_callback, &insert_target);
}

static InfraredErrorCode infrared_remote_rename_signal_callback(
    const InfraredBatch* batch,
    const InfraredBatchTarget* target) {
    const char* signal_name;

    if(batch->signal_index == target->signal_index) {
        // Rename the signal at requested index
        signal_name = target->signal_name;
        StringArray_set_at(batch->remote->signal_names, batch->signal_index, signal_name);
    } else {
        // Use the original name otherwise
        signal_name = furi_string_get_cstr(batch->signal_name);
    }

    const InfraredSignal* signal = batch->signal_index == target->signal_index && target->signal ?
                                       target->signal :
                                       batch->signal;
    return infrared_signal_save(signal, batch->ff_out, signal_name);
}

InfraredErrorCode
    infrared_remote_rename_signal(InfraredRemote* remote, size_t index, const char* new_name) {
    return infrared_remote_set_signal(remote, index, new_name, NULL);
}

InfraredErrorCode infrared_remote_set_signal(
    InfraredRemote* remote,
    size_t index,
    const char* new_name,
    const InfraredSignal* signal) {
    furi_assert(index < infrared_remote_get_signal_count(remote));

    const InfraredBatchTarget rename_target = {
        .signal_index = index,
        .signal_name = new_name,
        .signal = signal,
    };

    return infrared_remote_batch_start(
        remote, infrared_remote_rename_signal_callback, &rename_target);
}

static InfraredErrorCode infrared_remote_delete_signal_callback(
    const InfraredBatch* batch,
    const InfraredBatchTarget* target) {
    if(batch->signal_index == target->signal_index) {
        // Do not save the signal to be deleted, remove it from the signal name list instead
        StringArray_remove_v(
            batch->remote->signal_names, batch->signal_index, batch->signal_index + 1);
    } else {
        // Pass other signals through
        return infrared_signal_save(
            batch->signal, batch->ff_out, furi_string_get_cstr(batch->signal_name));
    }

    return InfraredErrorCodeNone;
}

InfraredErrorCode infrared_remote_delete_signal(InfraredRemote* remote, size_t index) {
    furi_assert(index < infrared_remote_get_signal_count(remote));

    const InfraredBatchTarget delete_target = {
        .signal_index = index,
        .signal_name = NULL,
        .signal = NULL,
    };

    return infrared_remote_batch_start(
        remote, infrared_remote_delete_signal_callback, &delete_target);
}

static InfraredErrorCode
    move_signal(const InfraredBatch* batch, const InfraredBatchTarget* target) {
    if(batch->signal_index == target->signal_index) return InfraredErrorCodeNone;
    bool at_destination = batch->signal_index == target->destination;
    bool earlier = target->destination < target->signal_index;
    InfraredErrorCode error = InfraredErrorCodeNone;
    if(at_destination && earlier)
        error = infrared_signal_save(target->signal, batch->ff_out, target->signal_name);
    if(!INFRARED_ERROR_PRESENT(error))
        error = infrared_signal_save(
            batch->signal, batch->ff_out, furi_string_get_cstr(batch->signal_name));
    if(at_destination && !earlier && !INFRARED_ERROR_PRESENT(error))
        error = infrared_signal_save(target->signal, batch->ff_out, target->signal_name);
    return error;
}

InfraredErrorCode
    infrared_remote_move_signal(InfraredRemote* remote, size_t index, size_t new_index) {
    size_t count = infrared_remote_get_signal_count(remote);
    furi_assert(index < count && new_index < count);
    if(index == new_index) return InfraredErrorCodeNone;
    InfraredSignal* signal = infrared_signal_alloc();
    char* name = strdup(infrared_remote_get_signal_name(remote, index));
    InfraredErrorCode error = infrared_remote_load_signal(remote, signal, index);
    if(!INFRARED_ERROR_PRESENT(error)) {
        const InfraredBatchTarget target = {
            .signal_index = index, .destination = new_index, .signal_name = name, .signal = signal};
        error = infrared_remote_batch_start(remote, move_signal, &target);
        if(!INFRARED_ERROR_PRESENT(error)) {
            StringArray_remove_v(remote->signal_names, index, index + 1);
            StringArray_push_at(remote->signal_names, new_index, name);
        }
    }
    free(name);
    infrared_signal_free(signal);
    return error;
}

InfraredErrorCode infrared_remote_create(
    InfraredRemote* remote,
    const char* path,
    const InfraredSignal* signal,
    const char* button_name) {
    Storage* storage = furi_record_open(RECORD_STORAGE);
    FlipperFormat* file = flipper_format_file_alloc(storage);
    InfraredErrorCode error = InfraredErrorCodeFileOperationFailed;
    FuriString* partial = furi_string_alloc_printf("%s.eddy-part", path);
    const char* pending = furi_string_get_cstr(partial);
    if(eddy_ir_restore(storage, path) == FSE_NOT_EXIST &&
       flipper_format_file_open_always(file, pending)) {
        if(flipper_format_write_header_cstr(file, INFRARED_FILE_HEADER, INFRARED_FILE_VERSION)) {
            error = infrared_signal_save(signal, file, button_name);
        }
        if(!flipper_format_file_close(file) ||
           (!INFRARED_ERROR_PRESENT(error) &&
            storage_common_rename_safe(storage, pending, path) != FSE_OK))
            error = InfraredErrorCodeFileOperationFailed;
        if(INFRARED_ERROR_PRESENT(error))
            storage_common_remove(storage, pending);
        else {
            infrared_remote_reset(remote);
            infrared_remote_set_path(remote, path);
            StringArray_push_back(remote->signal_names, button_name);
        }
    }
    furi_string_free(partial);
    flipper_format_free(file);
    furi_record_close(RECORD_STORAGE);
    return error;
}

InfraredErrorCode infrared_remote_load(InfraredRemote* remote, const char* path) {
    FURI_LOG_I(TAG, "Loading file: '%s'", path);

    Storage* storage = furi_record_open(RECORD_STORAGE);
    FlipperFormat* ff = flipper_format_buffered_file_alloc(storage);

    FuriString* tmp = furi_string_alloc();
    InfraredErrorCode error = InfraredErrorCodeNone;

    do {
        if(eddy_ir_restore(storage, path) != FSE_OK ||
           !flipper_format_buffered_file_open_existing(ff, path)) {
            error = InfraredErrorCodeFileOperationFailed;
            break;
        }

        uint32_t version;
        if(!flipper_format_read_header(ff, tmp, &version)) {
            error = InfraredErrorCodeFileOperationFailed;
            break;
        }

        if(furi_string_equal(tmp, INFRARED_LIBRARY_HEADER)) {
            FURI_LOG_E(TAG, "Library file can't be loaded in this context");
            error = InfraredErrorCodeWrongFileType;
            break;
        }

        if(!furi_string_equal(tmp, INFRARED_FILE_HEADER)) {
            error = InfraredErrorCodeWrongFileType;
            FURI_LOG_E(TAG, "Filetype unknown");
            break;
        }

        if(version != INFRARED_FILE_VERSION) {
            error = InfraredErrorCodeWrongFileVersion;
            FURI_LOG_E(TAG, "Wrong file version");
            break;
        }

        infrared_remote_set_path(remote, path);
        StringArray_reset(remote->signal_names);

        while(infrared_signal_read_name(ff, tmp) == InfraredErrorCodeNone) {
            StringArray_push_back(remote->signal_names, furi_string_get_cstr(tmp));
        }
    } while(false);

    furi_string_free(tmp);
    flipper_format_free(ff);
    furi_record_close(RECORD_STORAGE);

    return error;
}

InfraredErrorCode infrared_remote_rename(InfraredRemote* remote, const char* new_path) {
    const char* old_path = infrared_remote_get_path(remote);

    Storage* storage = furi_record_open(RECORD_STORAGE);
    const bool success = eddy_ir_restore(storage, old_path) == FSE_OK &&
                         eddy_ir_restore(storage, new_path) == FSE_NOT_EXIST &&
                         eddy_ir_clear_backup(storage, old_path) &&
                         storage_common_rename_safe(storage, old_path, new_path) == FSE_OK;
    furi_record_close(RECORD_STORAGE);

    if(success) {
        infrared_remote_set_path(remote, new_path);
    }

    return success ? InfraredErrorCodeNone : InfraredErrorCodeFileOperationFailed;
}

InfraredErrorCode infrared_remote_remove(InfraredRemote* remote) {
    Storage* storage = furi_record_open(RECORD_STORAGE);
    const char* path = infrared_remote_get_path(remote);
    // Clear the fallback before deletion so a later recovery cannot restore it.
    const bool success = eddy_ir_clear_backup(storage, path) &&
                         storage_simply_remove(storage, path);
    furi_record_close(RECORD_STORAGE);

    if(success) {
        infrared_remote_reset(remote);
    }

    return success ? InfraredErrorCodeNone : InfraredErrorCodeFileOperationFailed;
}

// A reboot can leave the only complete version under its backup name. Restore
// those files before either app builds the library from its normal .ir entries.
void infrared_remote_recover_library(Storage* storage) {
    DirWalk* dir = dir_walk_alloc(storage);
    const char* excluded[] = {EXT_PATH("infrared/assets")};
    dir_walk_set_recurse_filter(dir, excluded, COUNT_OF(excluded));
    FuriString* path = furi_string_alloc();
    FileInfo info;
    if(dir_walk_open(dir, EXT_PATH("infrared"))) {
        while(dir_walk_read(dir, path, &info) == DirWalkOK) {
            const size_t suffix = strlen(".ir" EDDY_IR_BACKUP), length = furi_string_size(path);
            if(file_info_is_dir(&info) || length <= suffix ||
               strcasecmp(furi_string_get_cstr(path) + length - suffix, ".ir" EDDY_IR_BACKUP))
                continue;
            furi_string_left(path, furi_string_size(path) - strlen(EDDY_IR_BACKUP));
            eddy_ir_restore(storage, furi_string_get_cstr(path));
        }
    }
    furi_string_free(path);
    dir_walk_free(dir);
}
