#include "loader_menu_apps_i.h"
#include <assets_icons.h>
#include <gui/icon_i.h>
#include <toolbox/hex.h>
#include <stdio.h>

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
// Bundled apps retain their original labels and artwork with older SD manifests.
static const struct {
    const char* id;
    FlipperExternalApplication app;
} launcher_community[] = {
    {"techart_calendar",
     {"Calendar", &I_CommunityCalendar_16x16, EXT_PATH("apps/Community/techart_calendar.fap")}},
};

static size_t launcher_catalog_index(const char* name) {
    for(size_t i = 0; i < COUNT_OF(launcher_catalog); ++i) {
        if(strcmp(name, launcher_catalog[i].name) == 0) return i;
    }
    return COUNT_OF(launcher_catalog);
}

enum {
    CommunityAppMax = 32,
    CommunityIdMax = 48,
    CommunityNameMax = 32,
    CommunityBitmapSize = 20, // 10 rows, two XBM bytes per row
    CommunityManifestMax = CommunityAppMax * (CommunityIdMax + 1 + CommunityNameMax + 1 +
                                              2 * CommunityBitmapSize + 2),
};

#define COMMUNITY_APP_DIR EXT_PATH("apps/Community/")

typedef struct {
    FlipperExternalApplication app;
    Icon icon;
    const uint8_t* frame;
    uint8_t bitmap[1 + CommunityBitmapSize];
    char name[CommunityNameMax + 1];
    char path[sizeof(COMMUNITY_APP_DIR ".fap") + CommunityIdMax];
} CommunityApp;

// Reject oversized files and incomplete reads before using any rows.
static char* launcher_read_list(Storage* storage, const char* path, size_t limit) {
    File* file = storage_file_alloc(storage);
    char* text = NULL;
    if(storage_file_open(file, path, FSAM_READ, FSOM_OPEN_EXISTING)) {
        uint64_t size = storage_file_size(file);
        if(size && size <= limit) {
            text = malloc(size + 1);
            if(storage_file_read(file, text, size) == size && !memchr(text, 0, size)) {
                text[size] = 0;
            } else {
                free(text);
                text = NULL;
            }
        }
    }
    storage_file_free(file);
    return text;
}

static void launcher_read_order(Storage* storage, uint8_t* order) {
    bool seen[COUNT_OF(launcher_catalog)] = {false};
    size_t count = 0;
    char* text = launcher_read_list(storage, EXT_PATH("eddy/launcher_order.txt"), 256);
    if(text) {
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
    free(text);
    // Older installations may omit later apps. Append each missing ID once.
    for(size_t i = 0; i < COUNT_OF(launcher_catalog); ++i) {
        if(!seen[i]) order[count++] = i;
    }
}

static const FlipperExternalApplication* launcher_community_entry(CommunityApp* entry, char* row) {
    char* name = strchr(row, '\t');
    if(name) *name++ = 0;
    for(size_t i = 0; i < COUNT_OF(launcher_community); ++i) {
        if(!strcmp(row, launcher_community[i].id)) return &launcher_community[i].app;
    }
    if(!name) {
        // Previous releases used an ID-only row for this optional app.
        static const FlipperExternalApplication legacy_resistors = {
            "Resistance calculator", &A_Plugins_14, EXT_PATH("apps/Community/resistors.fap")};
        return !strcmp(row, "resistors") ? &legacy_resistors : NULL;
    }
    char* icon_hex = strchr(name, '\t');
    if(icon_hex) *icon_hex++ = 0;
    if(!*name || strlen(name) > CommunityNameMax || name[0] == ' ') return NULL;
    for(const char* c = name; *c; ++c) {
        if(*c < 32 || *c > 126) return NULL;
    }
    if(!((row[0] >= 'a' && row[0] <= 'z') || (row[0] >= '0' && row[0] <= '9')) ||
       strlen(row) > CommunityIdMax)
        return NULL;
    for(const char* c = row; *c; ++c) {
        if(!((*c >= 'a' && *c <= 'z') || (*c >= '0' && *c <= '9') || *c == '-' || *c == '_'))
            return NULL;
    }
    strcpy(entry->name, name);
    snprintf(entry->path, sizeof(entry->path), COMMUNITY_APP_DIR "%s.fap", row);
    entry->app = (FlipperExternalApplication){
        .name = entry->name,
        .path = entry->path,
        .icon = &A_Plugins_14,
    };
    if(icon_hex) {
        if(strlen(icon_hex) != 2 * CommunityBitmapSize ||
           !hex_chars_to_uint8(icon_hex, entry->bitmap + 1))
            return NULL;
        entry->bitmap[0] = 0; // Native icon header for an uncompressed frame
        entry->frame = entry->bitmap;
        const Icon icon = {.width = 10, .height = 10, .frame_count = 1, .frames = &entry->frame};
        memcpy(&entry->icon, &icon, sizeof(icon));
        entry->app.icon = &entry->icon;
    }
    return &entry->app;
}

const FlipperExternalApplication**
    loader_menu_apps_load(Storage* storage, size_t* count, size_t* community_start) {
    uint8_t order[COUNT_OF(launcher_catalog)];
    launcher_read_order(storage, order);
    const FlipperExternalApplication* installed[COUNT_OF(launcher_catalog)] = {0};
    char* community =
        launcher_read_list(storage, EXT_PATH("eddy/community_apps.txt"), CommunityManifestMax);
    size_t capacity = 0;
    if(community) {
        capacity = 1;
        for(const char* c = community; *c && capacity < CommunityAppMax; ++c) {
            if(*c == '\n' && c[1]) ++capacity;
        }
    }
    // The grid and all dynamic entries share one allocation lasting until menu teardown.
    size_t pointers = FLIPPER_EXTERNAL_APPS_COUNT + capacity;
    const FlipperExternalApplication** apps =
        malloc(pointers * sizeof(*apps) + capacity * sizeof(CommunityApp));
    CommunityApp* entries = (void*)(apps + pointers);
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
    if(community) {
        char* rest;
        for(char* row = strtok_r(community, "\n", &rest);
            row && *count - *community_start < capacity;
            row = strtok_r(NULL, "\n", &rest)) {
            size_t end = strlen(row);
            if(end && row[end - 1] == '\r') row[end - 1] = 0;
            const FlipperExternalApplication* app =
                launcher_community_entry(&entries[*count - *community_start], row);
            if(!app || !storage_file_exists(storage, app->path)) continue;
            size_t i = 0;
            while(i < *count && strcmp(apps[i]->path, app->path))
                ++i;
            if(i == *count) apps[(*count)++] = app;
        }
        free(community);
    }
    return apps;
}
