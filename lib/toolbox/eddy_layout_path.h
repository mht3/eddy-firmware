#pragma once

#include <storage/storage.h>
#include <string.h>
#include <strings.h>

#define EDDY_LAYOUT_DIR      EXT_PATH("infrared/layouts")
#define EDDY_LAYOUT_EXT      ".eddy"
#define EDDY_LAYOUT_NAME_MAX 22

static inline bool eddy_layout_name_valid_n(const char* name, size_t size) {
    if(!size || size > EDDY_LAYOUT_NAME_MAX || name[0] == '.' || name[0] == ' ' ||
       name[size - 1] == ' ' || name[size - 1] == '.')
        return false;
    for(size_t i = 0; i < size; ++i) {
        if((unsigned char)name[i] < 32 || strchr("/\\:*?\"<>|", name[i])) return false;
    }
    return true;
}

static inline bool eddy_layout_name_valid(const char* name) {
    return name && eddy_layout_name_valid_n(name, strlen(name));
}

static inline bool eddy_layout_path_valid(const char* path) {
    const char prefix[] = EDDY_LAYOUT_DIR "/";
    if(!path || strncmp(path, prefix, sizeof(prefix) - 1)) return false;
    const char* name = path + sizeof(prefix) - 1;
    const char* extension = strrchr(name, '.');
    return extension && !strcasecmp(extension, EDDY_LAYOUT_EXT) &&
           eddy_layout_name_valid_n(name, extension - name);
}

// FAT replacement unlinks the previous file before renaming the new one. A .ready
// file has already been closed successfully, so a missing target can be restored.
static inline bool eddy_layout_restore_file(Storage* storage, const char* path) {
    FS_Error status = storage_common_stat(storage, path, NULL);
    if(status != FSE_NOT_EXIST) return status == FSE_OK;
    FuriString* ready = furi_string_alloc_printf("%s.ready", path);
    bool restored = storage_common_rename_safe(storage, furi_string_get_cstr(ready), path) ==
                    FSE_OK;
    furi_string_free(ready);
    return restored;
}
