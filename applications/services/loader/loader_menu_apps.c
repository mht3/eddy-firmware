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

#define COMMUNITY_APP_DIR      EXT_PATH("apps/Community/")
#define COMMUNITY_ORDER_PREFIX "lab:"

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
            if(text && storage_file_read(file, text, size) == size && !memchr(text, 0, size)) {
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

// Move each requested item into its slot. Installed apps missing from older layouts
// keep their original relative order. Only entries already discovered on the card can move.
static void launcher_apply_order(Storage* storage, LoaderMenuApp* apps, size_t count) {
    const size_t limit = (COUNT_OF(launcher_catalog) + CommunityAppMax) *
                         (sizeof(COMMUNITY_ORDER_PREFIX) - 1 + CommunityIdMax + 2);
    char* order = launcher_read_list(storage, EXT_PATH("eddy/launcher_order.txt"), limit);
    if(!order) return;
    size_t slot = 0;
    char* rest;
    for(char* id = strtok_r(order, "\r\n", &rest); id && slot < count;
        id = strtok_r(NULL, "\r\n", &rest)) {
        const char* target = NULL;
        char path[sizeof(COMMUNITY_APP_DIR ".fap") + CommunityIdMax];
        if(!strncmp(id, COMMUNITY_ORDER_PREFIX, sizeof(COMMUNITY_ORDER_PREFIX) - 1)) {
            const char* alias = id + sizeof(COMMUNITY_ORDER_PREFIX) - 1;
            if(strlen(alias) > CommunityIdMax) continue;
            snprintf(path, sizeof(path), COMMUNITY_APP_DIR "%s.fap", alias);
            target = path;
        } else {
            for(size_t i = 0; i < COUNT_OF(launcher_catalog); ++i) {
                if(!strcmp(id, launcher_catalog[i].id)) {
                    target = launcher_catalog[i].name;
                    break;
                }
            }
        }
        if(!target) continue;
        for(size_t i = slot; i < count; ++i) {
            if(strcmp(target, apps[i].launch_target)) continue;
            const LoaderMenuApp selected = apps[i];
            memmove(apps + slot + 1, apps + slot, (i - slot) * sizeof(*apps));
            apps[slot++] = selected;
            break;
        }
    }
    free(order);
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

LoaderMenuApp* loader_menu_apps_load(Storage* storage, size_t* count) {
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
    size_t slots = FLIPPER_EXTERNAL_APPS_COUNT + capacity;
    LoaderMenuApp* apps = malloc(slots * sizeof(*apps) + capacity * sizeof(CommunityApp));
    CommunityApp* entries = (void*)(apps + slots);
    *count = 0;
    for(size_t i = 0; i < FLIPPER_EXTERNAL_APPS_COUNT; ++i) {
        const FlipperExternalApplication* app = &FLIPPER_EXTERNAL_APPS[i];
        size_t index = launcher_catalog_index(app->name);
        if(index < COUNT_OF(installed) && storage_file_exists(storage, app->path))
            installed[index] = app;
    }
    for(size_t i = 0; i < COUNT_OF(installed); ++i) {
        const FlipperExternalApplication* app = installed[i];
        if(!app) continue;
        apps[(*count)++] = (LoaderMenuApp){app, app->name};
    }
    // Keep additional menu apps supplied by other builds discoverable as well.
    for(size_t i = 0; i < FLIPPER_EXTERNAL_APPS_COUNT; ++i) {
        const FlipperExternalApplication* app = &FLIPPER_EXTERNAL_APPS[i];
        if(launcher_catalog_index(app->name) == COUNT_OF(installed) &&
           storage_file_exists(storage, app->path))
            apps[(*count)++] = (LoaderMenuApp){app, app->name};
    }
    size_t community_start = *count;
    if(community) {
        char* rest;
        for(char* row = strtok_r(community, "\n", &rest);
            row && *count - community_start < capacity;
            row = strtok_r(NULL, "\n", &rest)) {
            size_t end = strlen(row);
            if(end && row[end - 1] == '\r') row[end - 1] = 0;
            const FlipperExternalApplication* app =
                launcher_community_entry(&entries[*count - community_start], row);
            if(!app || !storage_file_exists(storage, app->path)) continue;
            size_t i = 0;
            while(i < *count && strcmp(apps[i].app->path, app->path))
                ++i;
            if(i == *count) apps[(*count)++] = (LoaderMenuApp){app, app->path};
        }
        free(community);
    }
    launcher_apply_order(storage, apps, *count);
    return apps;
}
