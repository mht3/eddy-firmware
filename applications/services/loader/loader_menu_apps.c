#include "loader_menu_apps_i.h"
#include <assets_icons.h>

// Catalog IDs are shared with the web installer. Names identify compiled menu apps.
static const struct {
    const char* id;
    const char* name;
} launcher_catalog[] = {
    {"signal", "Sub-GHz"},
    {"rfid", "RFID"},
    {"infrared", "Infrared"},
    {"spotify", "Spotify"},
    {"builder", "Remotes"},
    {"btRemote", "Bluetooth Remote"},
    {"music", "Music"},
    {"gpio", "GPIO"},
    {"ibutton", "iButton"},
    {"nfc", "NFC"},
    {"pomodoro", "Pomodoro Timer"},
    {"metronome", "Metronome"},
};
// Only catalog entries selected by the installer can add a tile. Launch paths are
// compiled into the firmware; the SD manifest contains IDs rather than arbitrary paths.
static const struct {
    const char* id;
    FlipperExternalApplication app;
} launcher_community[] = {
    {"techart_calendar",
     {"Calendar", &I_CommunityCalendar_16x16, EXT_PATH("apps/Community/techart_calendar.fap")}},
    {"resistors",
     {"Resistance calculator",
      &I_CommunityResistor_16x16,
      EXT_PATH("apps/Community/resistors.fap")}},
};

static size_t launcher_catalog_index(const char* name) {
    for(size_t i = 0; i < COUNT_OF(launcher_catalog); ++i) {
        if(strcmp(name, launcher_catalog[i].name) == 0) return i;
    }
    return COUNT_OF(launcher_catalog);
}

// Files are small, line-oriented lists of catalog IDs. Reject incomplete reads
// and embedded NULs before using any item.
static bool launcher_read_list(Storage* storage, const char* path, char* text, size_t capacity) {
    File* file = storage_file_alloc(storage);
    bool ok = storage_file_open(file, path, FSAM_READ, FSOM_OPEN_EXISTING);
    if(ok) {
        uint64_t size = storage_file_size(file);
        ok = size < capacity && storage_file_read(file, text, size) == size &&
             !memchr(text, 0, size);
        if(ok) text[size] = 0;
    }
    storage_file_free(file);
    return ok;
}

static void launcher_read_order(Storage* storage, uint8_t* order) {
    bool seen[COUNT_OF(launcher_catalog)] = {false};
    size_t count = 0;
    char text[257];
    if(launcher_read_list(storage, EXT_PATH("eddy/launcher_order.txt"), text, sizeof(text))) {
        char* rest;
        for(char* id = strtok_r(text, "\r\n", &rest); id; id = strtok_r(NULL, "\r\n", &rest)) {
            for(size_t i = 0; i < COUNT_OF(launcher_catalog); ++i) {
                if(!seen[i] && !strcmp(id, launcher_catalog[i].id)) {
                    seen[i] = true;
                    order[count++] = i;
                    break;
                }
            }
        }
    }
    // Older installations may omit later apps. Append each missing ID once.
    for(size_t i = 0; i < COUNT_OF(launcher_catalog); ++i) {
        if(!seen[i]) order[count++] = i;
    }
}

static size_t launcher_append_community(
    Storage* storage,
    const FlipperExternalApplication** apps,
    size_t count) {
    char text[257];
    if(!launcher_read_list(storage, EXT_PATH("eddy/community_apps.txt"), text, sizeof(text)))
        return count;
    bool seen[COUNT_OF(launcher_community)] = {false};
    char* rest;
    for(char* id = strtok_r(text, "\r\n", &rest); id; id = strtok_r(NULL, "\r\n", &rest)) {
        for(size_t i = 0; i < COUNT_OF(launcher_community); ++i) {
            if(seen[i] || strcmp(id, launcher_community[i].id)) continue;
            seen[i] = true;
            const FlipperExternalApplication* app = &launcher_community[i].app;
            bool listed = false;
            for(size_t j = 0; j < count; ++j) {
                if(!strcmp(apps[j]->path, app->path)) {
                    listed = true;
                    break;
                }
            }
            if(!listed && storage_file_exists(storage, app->path)) apps[count++] = app;
            break;
        }
    }
    return count;
}

const FlipperExternalApplication**
    loader_menu_apps_load(Storage* storage, size_t* count, size_t* community_start) {
    uint8_t order[COUNT_OF(launcher_catalog)];
    launcher_read_order(storage, order);
    const FlipperExternalApplication* installed[COUNT_OF(launcher_catalog)] = {0};
    const FlipperExternalApplication** apps =
        malloc((FLIPPER_EXTERNAL_APPS_COUNT + COUNT_OF(launcher_community)) * sizeof(*apps));
    *count = 0;
    for(size_t i = 0; i < FLIPPER_EXTERNAL_APPS_COUNT; ++i) {
        const FlipperExternalApplication* app = &FLIPPER_EXTERNAL_APPS[i];
        size_t index = launcher_catalog_index(app->name);
        if(index < COUNT_OF(installed) && storage_file_exists(storage, app->path))
            installed[index] = app;
    }
    for(size_t i = 0; i < COUNT_OF(installed); ++i) {
        const FlipperExternalApplication* app = installed[order[i]];
        if(!app) continue;
        apps[(*count)++] = app;
    }
    // Keep additional menu apps supplied by other builds discoverable as well.
    for(size_t i = 0; i < FLIPPER_EXTERNAL_APPS_COUNT; ++i) {
        const FlipperExternalApplication* app = &FLIPPER_EXTERNAL_APPS[i];
        if(launcher_catalog_index(app->name) == COUNT_OF(installed) &&
           storage_file_exists(storage, app->path))
            apps[(*count)++] = app;
    }
    *community_start = *count;
    *count = launcher_append_community(storage, apps, *count);
    return apps;
}
