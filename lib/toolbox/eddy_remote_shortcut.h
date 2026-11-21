#pragma once

#include <furi.h>
#include <storage/storage.h>
#include <strings.h>

#define EDDY_REMOTE_PIN_PATH    EXT_PATH("infrared/.eddy_pin")
#define EDDY_REMOTE_PIN_TEMP    EDDY_REMOTE_PIN_PATH ".tmp"
#define EDDY_REMOTE_PIN_VERSION "Eddy IR 1\n"
#define EDDY_REMOTE_PATH_LIMIT  1024U

// Accept normal user remote paths, including remotes saved in nested directories.
static inline bool eddy_remote_path_valid(const char* path) {
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

static inline bool eddy_remote_shortcut_get(Storage* storage, FuriString* path) {
    furi_string_reset(path);
    File* file = storage_file_alloc(storage);
    // FAT replaces a file by unlinking the old name before renaming the new one.
    // A complete temp record recovers the pin if power was lost between those steps.
    const char* record = storage_file_exists(storage, EDDY_REMOTE_PIN_PATH) ?
                             EDDY_REMOTE_PIN_PATH :
                             EDDY_REMOTE_PIN_TEMP;
    if(storage_file_open(file, record, FSAM_READ, FSOM_OPEN_EXISTING)) {
        const size_t prefix = sizeof(EDDY_REMOTE_PIN_VERSION) - 1;
        uint64_t size = storage_file_size(file);
        if(size > prefix + 1 && size <= prefix + EDDY_REMOTE_PATH_LIMIT + 1) {
            char* data = malloc(size);
            if(data && storage_file_read(file, data, size) == size &&
               memcmp(data, EDDY_REMOTE_PIN_VERSION, prefix) == 0 &&
               memchr(data + prefix, '\0', size - prefix) == data + size - 1 &&
               eddy_remote_path_valid(data + prefix) &&
               storage_file_exists(storage, data + prefix)) {
                furi_string_set_str(path, data + prefix);
            }
            free(data);
        }
    }
    storage_file_free(file);
    return !furi_string_empty(path);
}

// Passing NULL removes the tile. The saved remote itself is never modified.
static inline bool eddy_remote_shortcut_set(Storage* storage, const char* path) {
    if(!path) {
        return storage_simply_remove(storage, EDDY_REMOTE_PIN_TEMP) &&
               storage_simply_remove(storage, EDDY_REMOTE_PIN_PATH);
    }
    size_t length = strlen(path);
    if(length > EDDY_REMOTE_PATH_LIMIT || !eddy_remote_path_valid(path) ||
       !storage_file_exists(storage, path)) {
        return false;
    }
    File* file = storage_file_alloc(storage);
    size_t prefix = sizeof(EDDY_REMOTE_PIN_VERSION) - 1;
    bool written = storage_file_open(file, EDDY_REMOTE_PIN_TEMP, FSAM_WRITE, FSOM_CREATE_ALWAYS) &&
                   storage_file_write(file, EDDY_REMOTE_PIN_VERSION, prefix) == prefix &&
                   storage_file_write(file, path, length + 1) == length + 1 &&
                   storage_file_sync(file);
    bool closed = storage_file_close(file);
    storage_file_free(file);
    return written && closed &&
           storage_common_rename(storage, EDDY_REMOTE_PIN_TEMP, EDDY_REMOTE_PIN_PATH) == FSE_OK;
}
