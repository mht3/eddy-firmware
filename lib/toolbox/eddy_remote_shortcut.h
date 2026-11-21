#pragma once

#include <furi.h>
#include <storage/storage.h>
#include <strings.h>
#include "eddy_layout_path.h"

#define EDDY_REMOTE_PIN_PATH   EXT_PATH("infrared/.eddy_pin")
#define EDDY_REMOTE_PIN_TEMP   EDDY_REMOTE_PIN_PATH ".tmp"
#define EDDY_REMOTE_PIN_V1     "Eddy IR 1\n"
#define EDDY_REMOTE_PIN_V2     "Eddy IR 2\n"
#define EDDY_REMOTE_PIN_MAX    16U
#define EDDY_REMOTE_PATH_LIMIT 1024U

// Accept normal user remote paths, including remotes saved in nested directories.
static inline bool eddy_remote_path_valid(const char* path) {
    if(eddy_layout_path_valid(path)) return true;
    const char root[] = EXT_PATH("infrared/");
    if(strncmp(path, root, sizeof(root) - 1) != 0) return false;
    const char* component = path + sizeof(root) - 1;
    for(const char* p = component;; ++p) {
        if(*p == '/' || *p == '\0') {
            if(p == component || *component == '.' || p[-1] == '.' || p[-1] == ' ') return false;
            if(!*p) break;
            component = p + 1;
        } else if((unsigned char)*p < 32 || strchr("\\:*?\"<>|", *p)) {
            return false;
        }
    }
    const char* extension = strrchr(component, '.');
    return extension && strcasecmp(extension, ".ir") == 0;
}

// Entries are in the order they were pinned. Home Down opens the newest.
typedef struct {
    FuriString* paths[EDDY_REMOTE_PIN_MAX];
    size_t count;
} EddyRemotePins;

typedef enum {
    EddyPinOk,
    EddyPinFull,
    EddyPinError,
} EddyPinResult;

static inline void eddy_remote_pins_clear(EddyRemotePins* pins) {
    while(pins->count)
        furi_string_free(pins->paths[--pins->count]);
}

static inline size_t eddy_remote_pin_index(const EddyRemotePins* pins, const char* path) {
    for(size_t i = 0; i < pins->count; ++i) {
        if(!strcasecmp(path, furi_string_get_cstr(pins->paths[i]))) return i;
    }
    return pins->count;
}

static inline bool eddy_remote_pins_decode(File* file, EddyRemotePins* pins) {
    char header[sizeof(EDDY_REMOTE_PIN_V1) - 1];
    if(storage_file_read(file, header, sizeof(header)) != sizeof(header)) return false;
    bool legacy = !memcmp(header, EDDY_REMOTE_PIN_V1, sizeof(header));
    uint8_t count = 1;
    if(!legacy && (memcmp(header, EDDY_REMOTE_PIN_V2, sizeof(header)) ||
                   storage_file_read(file, &count, 1) != 1 || count > EDDY_REMOTE_PIN_MAX)) {
        return false;
    }

    for(uint8_t i = 0; i < count; ++i) {
        uint16_t length;
        if(legacy) {
            const uint64_t bytes = storage_file_size(file) - sizeof(header);
            if(bytes > EDDY_REMOTE_PATH_LIMIT + 1) return false;
            length = bytes;
        } else if(storage_file_read(file, &length, sizeof(length)) != sizeof(length)) {
            return false;
        }
        if(length < 2 || length > EDDY_REMOTE_PATH_LIMIT + 1) return false;
        char* path = malloc(length);
        bool valid = path && storage_file_read(file, path, length) == length &&
                     memchr(path, 0, length) == path + length - 1 &&
                     eddy_remote_path_valid(path) &&
                     eddy_remote_pin_index(pins, path) == pins->count;
        if(valid) pins->paths[pins->count++] = furi_string_alloc_set_str(path);
        free(path);
        if(!valid) return false;
    }
    return storage_file_tell(file) == storage_file_size(file);
}

static inline bool eddy_remote_pins_read(Storage* storage, EddyRemotePins* pins, bool* recovered) {
    eddy_remote_pins_clear(pins);
    if(recovered) *recovered = false;
    const char* record = EDDY_REMOTE_PIN_PATH;
    FS_Error status = storage_common_stat(storage, record, NULL);
    bool temporary = status == FSE_NOT_EXIST;
    if(temporary) {
        record = EDDY_REMOTE_PIN_TEMP;
        status = storage_common_stat(storage, record, NULL);
    }
    if(status != FSE_OK) return status == FSE_NOT_EXIST;

    File* file = storage_file_alloc(storage);
    bool ok = storage_file_open(file, record, FSAM_READ, FSOM_OPEN_EXISTING);
    if(ok) {
        ok = eddy_remote_pins_decode(file, pins);
        if(!ok) eddy_remote_pins_clear(pins);
        if(temporary) {
            // Between FAT's unlink and rename the complete temp record is
            // authoritative. An incomplete first write commits no shortcuts.
            if(ok && recovered) *recovered = true;
            if(!ok && storage_file_get_error(file) == FSE_OK) ok = true;
        }
    }
    storage_file_free(file);
    return ok;
}

static inline void eddy_remote_pin_erase(EddyRemotePins* pins, size_t index) {
    furi_string_free(pins->paths[index]);
    --pins->count;
    memmove(
        pins->paths + index,
        pins->paths + index + 1,
        (pins->count - index) * sizeof(*pins->paths));
}

static inline bool eddy_remote_pins_load(Storage* storage, EddyRemotePins* pins) {
    if(!eddy_remote_pins_read(storage, pins, NULL)) return false;
    if(!pins->count) return true;
    const bool infrared = storage_file_exists(storage, EXT_PATH("apps/Infrared/infrared.fap"));
    const bool builder =
        storage_file_exists(storage, EXT_PATH("apps/assets/eddy_remote_builder.fap"));
    for(size_t i = pins->count; i > 0; --i) {
        const char* path = furi_string_get_cstr(pins->paths[i - 1]);
        bool exists = eddy_layout_path_valid(path) ?
                          builder && eddy_layout_restore_file(storage, path) :
                          infrared && storage_file_exists(storage, path);
        if(!exists) {
            eddy_remote_pin_erase(pins, i - 1);
        }
    }
    return true;
}

static inline bool eddy_remote_shortcut_get(Storage* storage, FuriString* path) {
    EddyRemotePins pins = {0};
    eddy_remote_pins_load(storage, &pins);
    furi_string_reset(path);
    if(pins.count) furi_string_set(path, pins.paths[pins.count - 1]);
    eddy_remote_pins_clear(&pins);
    return !furi_string_empty(path);
}

static inline bool
    eddy_remote_pins_write(Storage* storage, const EddyRemotePins* pins, bool recovered) {
    // Preserve a recovered record before reusing the temporary name.
    if(recovered &&
       storage_common_rename(storage, EDDY_REMOTE_PIN_TEMP, EDDY_REMOTE_PIN_PATH) != FSE_OK)
        return false;
    File* file = storage_file_alloc(storage);
    const size_t header = sizeof(EDDY_REMOTE_PIN_V2) - 1;
    const uint8_t count = pins->count;
    bool ok = storage_file_open(file, EDDY_REMOTE_PIN_TEMP, FSAM_WRITE, FSOM_CREATE_ALWAYS) &&
              storage_file_write(file, EDDY_REMOTE_PIN_V2, header) == header &&
              storage_file_write(file, &count, 1) == 1;
    for(size_t i = 0; ok && i < pins->count; ++i) {
        uint16_t length = furi_string_size(pins->paths[i]) + 1;
        ok = storage_file_write(file, &length, sizeof(length)) == sizeof(length) &&
             storage_file_write(file, furi_string_get_cstr(pins->paths[i]), length) == length;
    }
    ok = ok && storage_file_sync(file);
    bool closed = storage_file_close(file);
    storage_file_free(file);
    return ok && closed &&
           storage_common_rename(storage, EDDY_REMOTE_PIN_TEMP, EDDY_REMOTE_PIN_PATH) == FSE_OK;
}

// NULL old_path adds, NULL new_path removes. Rename keeps the pin's position.
static inline EddyPinResult
    eddy_remote_pins_update(Storage* storage, const char* old_path, const char* new_path) {
    if(new_path && (strlen(new_path) > EDDY_REMOTE_PATH_LIMIT ||
                    !eddy_remote_path_valid(new_path) || !storage_file_exists(storage, new_path)))
        return EddyPinError;
    EddyRemotePins pins = {0};
    bool recovered;
    if(!eddy_remote_pins_read(storage, &pins, &recovered)) return EddyPinError;
    EddyPinResult result = EddyPinOk;
    bool changed = false;
    if(old_path) {
        size_t index = eddy_remote_pin_index(&pins, old_path);
        if(index < pins.count) {
            if(new_path) {
                size_t duplicate = eddy_remote_pin_index(&pins, new_path);
                furi_string_set_str(pins.paths[index], new_path);
                if(duplicate < pins.count && duplicate != index)
                    eddy_remote_pin_erase(&pins, duplicate);
            } else
                eddy_remote_pin_erase(&pins, index);
            changed = true;
        }
    } else if(new_path && eddy_remote_pin_index(&pins, new_path) == pins.count) {
        // Manually deleted remotes do not consume a shortcut slot.
        for(size_t i = pins.count; i > 0; --i) {
            const char* path = furi_string_get_cstr(pins.paths[i - 1]);
            if(storage_common_stat(storage, path, NULL) == FSE_NOT_EXIST &&
               !(eddy_layout_path_valid(path) && eddy_layout_restore_file(storage, path))) {
                eddy_remote_pin_erase(&pins, i - 1);
            }
        }
        if(pins.count == EDDY_REMOTE_PIN_MAX)
            result = EddyPinFull;
        else {
            pins.paths[pins.count++] = furi_string_alloc_set_str(new_path);
            changed = true;
        }
    }
    if(changed && !eddy_remote_pins_write(storage, &pins, recovered)) result = EddyPinError;
    eddy_remote_pins_clear(&pins);
    return result;
}
