#include <gui/modules/submenu.h>
#include <gui/elements.h>
#include <assets_icons.h>
#include <applications.h>
#include <toolbox/run_parallel.h>
#include <toolbox/eddy_remote_shortcut.h>
#include <toolbox/path.h>
#include <storage/storage.h>
#include <power/power_service/power.h>
#include "loader.h"
#include "loader_i.h"
#include "loader_menu.h"
#include "loader_menu_storage_i.h"
#include "loader_quick_settings.h"

#define TAG "LoaderMenu"

typedef enum {
    LoaderMenuViewPrimary,
    LoaderMenuViewQuickSettings,
    LoaderMenuViewSettings,
} LoaderMenuView;

struct LoaderMenu {
    FuriThread* thread;
    void (*closed_cb)(void*);
    void* context;

    Loader* loader;
    FuriPubSubSubscription* subscription;

    uint8_t section;
    size_t app_index;
    bool in_apps;
    uint32_t selected_setting;
    LoaderMenuView current_view;
    LoaderMenuStart start;
};

enum {
    MenuStop = 1,
    MenuSwitch = 2
};

static int32_t loader_menu_thread(void* p);

static void loader_pubsub_callback(const void* message, void* context) {
    const LoaderEvent* event = message;
    LoaderMenu* loader_menu = context;

    if(event->type == LoaderEventTypeApplicationBeforeLoad) {
        if(loader_menu->thread) {
            furi_thread_flags_set(furi_thread_get_id(loader_menu->thread), MenuStop);
            furi_thread_join(loader_menu->thread);
            furi_thread_free(loader_menu->thread);
            loader_menu->thread = NULL;
        }
    } else if(event->type == LoaderEventTypeNoMoreAppsInQueue) {
        if(!loader_menu->thread) {
            loader_menu->thread = furi_thread_alloc_ex(TAG, 2048, loader_menu_thread, loader_menu);
            furi_thread_start(loader_menu->thread);
        }
    }
}

LoaderMenu* loader_menu_alloc(void (*closed_cb)(void*), void* context, LoaderMenuStart start) {
    LoaderMenu* loader_menu = malloc(sizeof(LoaderMenu));
    loader_menu->closed_cb = closed_cb;
    loader_menu->context = context;
    loader_menu->section = 0;
    loader_menu->app_index = 0;
    loader_menu->in_apps = start == LoaderMenuApps;
    loader_menu->selected_setting = 0;
    loader_menu->start = start;
    loader_menu->current_view = start == LoaderMenuSettings ? LoaderMenuViewQuickSettings :
                                                              LoaderMenuViewPrimary;
    loader_menu->loader = furi_record_open(RECORD_LOADER);

    view_holder_set_back_callback(loader_menu->loader->view_holder, NULL, NULL);
    view_holder_set_view(
        loader_menu->loader->view_holder, loading_get_view(loader_menu->loader->loading));

    loader_menu->subscription = furi_pubsub_subscribe(
        loader_get_pubsub(loader_menu->loader), loader_pubsub_callback, loader_menu);

    loader_menu->thread = furi_thread_alloc_ex(TAG, 2048, loader_menu_thread, loader_menu);
    furi_thread_start(loader_menu->thread);
    return loader_menu;
}

void loader_menu_free(LoaderMenu* loader_menu) {
    furi_assert(loader_menu);

    furi_pubsub_unsubscribe(loader_get_pubsub(loader_menu->loader), loader_menu->subscription);
    furi_record_close(RECORD_LOADER);

    if(loader_menu->thread) {
        furi_thread_join(loader_menu->thread);
        furi_thread_free(loader_menu->thread);
    }

    view_holder_set_view(loader_menu->loader->view_holder, NULL);

    free(loader_menu);
}

typedef struct {
    const char* label;
    const Icon* icon;
} LauncherItem;

static const LauncherItem sections[] = {
    {"Apps", &A_Plugins_14},
    {"Settings", &A_Settings_14},
    {"Power off", &I_PowerOff_16x16}};

// Catalog IDs are shared with the web installer. Names identify compiled menu apps.
static const struct {
    const char* id;
    const char* name;
} launcher_catalog[] = {
    {"signal", "Sub-GHz"},
    {"rfid", "RFID"},
    {"infrared", "Infrared"},
    {"pomodoro", "Pomodoro Timer"},
    {"music", "Music"},
    {"builder", "Remote Builder"},
    {"btRemote", "Bluetooth Remote"},
    {"metronome", "Metronome"},
    {"gpio", "GPIO"},
    {"ibutton", "iButton"},
    {"nfc", "NFC"},
    {"spotify", "Spotify"},
};
enum {
    LauncherPageSize = 8,
    LauncherColumns = 4
};

typedef struct {
    const FlipperExternalApplication* app;
    size_t slot;
} LauncherApp;

typedef struct {
    uint8_t section;
    size_t app_index;
    bool in_apps;
    LauncherApp* apps;
    size_t first_pin_slot;
    size_t app_count;
    FuriString* pinned_labels[EDDY_REMOTE_PIN_MAX];
    size_t pin_count;
    bool remote_unavailable;
} LauncherModel;

typedef struct {
    LoaderMenu* menu;
    View* grid;
    View* quick;
    Submenu* settings;
    Storage* storage;
    EddyRemotePins pins;
} Launcher;

static size_t launcher_catalog_index(const char* name) {
    for(size_t i = 0; i < COUNT_OF(launcher_catalog); ++i) {
        if(strcmp(name, launcher_catalog[i].name) == 0) return i;
    }
    return COUNT_OF(launcher_catalog);
}

static void launcher_read_order(Storage* storage, uint8_t* order) {
    bool seen[COUNT_OF(launcher_catalog)] = {false};
    size_t count = 0;
    File* file = storage_file_alloc(storage);
    if(storage_file_open(
           file, EXT_PATH("eddy/launcher_order.txt"), FSAM_READ, FSOM_OPEN_EXISTING)) {
        char text[256];
        uint64_t size = storage_file_size(file);
        if(size <= sizeof(text) && storage_file_read(file, text, size) == size &&
           !memchr(text, '\0', size)) {
            size_t start = 0;
            for(size_t end = 0; end <= size; ++end) {
                if(end != size && text[end] != '\n') continue;
                size_t len = end - start;
                if(len && text[end - 1] == '\r') --len;
                for(size_t i = 0; i < COUNT_OF(launcher_catalog); ++i) {
                    const char* id = launcher_catalog[i].id;
                    if(!seen[i] && strlen(id) == len && !memcmp(text + start, id, len)) {
                        seen[i] = true;
                        order[count++] = i;
                        break;
                    }
                }
                start = end + 1;
            }
        }
    }
    storage_file_free(file);
    // Older installations may omit later apps. Append each missing ID once.
    for(size_t i = 0; i < COUNT_OF(launcher_catalog); ++i) {
        if(!seen[i]) order[count++] = i;
    }
}

static void launcher_load_apps(LauncherModel* model, Storage* storage) {
    uint8_t order[COUNT_OF(launcher_catalog)];
    launcher_read_order(storage, order);
    const FlipperExternalApplication* installed[COUNT_OF(launcher_catalog)] = {0};
    model->apps = malloc((FLIPPER_EXTERNAL_APPS_COUNT + 1) * sizeof(LauncherApp));
    model->app_count = 0;
    for(size_t i = 0; i < FLIPPER_EXTERNAL_APPS_COUNT; ++i) {
        const FlipperExternalApplication* app = &FLIPPER_EXTERNAL_APPS[i];
        size_t index = launcher_catalog_index(app->name);
        if(index < COUNT_OF(installed) && storage_file_exists(storage, app->path))
            installed[index] = app;
    }
    size_t next = 0;
    for(size_t i = 0; i < COUNT_OF(installed); ++i) {
        const FlipperExternalApplication* app = installed[order[i]];
        if(!app) continue;
        // Omitted neighbors leave their slots empty on both installer pages.
        model->apps[model->app_count++] = (LauncherApp){.app = app, .slot = i};
        next = MAX((size_t)LauncherPageSize, i + 1);
    }
    // Keep additional menu apps supplied by other builds discoverable as well.
    for(size_t i = 0; i < FLIPPER_EXTERNAL_APPS_COUNT; ++i) {
        const FlipperExternalApplication* app = &FLIPPER_EXTERNAL_APPS[i];
        if(launcher_catalog_index(app->name) == COUNT_OF(installed) &&
           storage_file_exists(storage, app->path))
            model->apps[model->app_count++] = (LauncherApp){.app = app, .slot = next++};
    }
    model->first_pin_slot = next;
}

static size_t launcher_slot(const LauncherModel* model, size_t index) {
    if(index < model->app_count) return model->apps[index].slot;
    return model->first_pin_slot + index - model->app_count;
}

// In a sparse row, land on the nearest available column. An empty row is skipped.
static size_t launcher_vertical(const LauncherModel* model, bool up) {
    size_t count = model->app_count + model->pin_count;
    size_t slot = launcher_slot(model, model->app_index);
    size_t rows = launcher_slot(model, count - 1) / LauncherColumns + 1;
    size_t row = slot / LauncherColumns;
    size_t column = slot % LauncherColumns;
    for(size_t step = 1; step < rows; ++step) {
        size_t target = (row + (up ? rows - step : step)) % rows;
        size_t best = model->app_index;
        size_t distance = LauncherColumns;
        for(size_t i = 0; i < count; ++i) {
            size_t cell = launcher_slot(model, i);
            if(cell / LauncherColumns != target) continue;
            size_t other = cell % LauncherColumns;
            size_t gap = column > other ? column - other : other - column;
            if(gap < distance) {
                distance = gap;
                best = i;
            }
        }
        if(distance < LauncherColumns) return best;
    }
    return model->app_index;
}

static void launcher_draw(Canvas* canvas, void* context) {
    const LauncherModel* model = context;
    bool grid = model->in_apps;
    size_t count = grid ? model->app_count + model->pin_count : COUNT_OF(sections);
    size_t selected = grid ? model->app_index : model->section;
    canvas_set_font(canvas, FontSecondary);
    if(grid && !count) {
        canvas_draw_str_aligned(canvas, 64, 35, AlignCenter, AlignCenter, "No apps installed");
        return;
    }
    const size_t page_number = grid ? launcher_slot(model, selected) / LauncherPageSize : 0;
    const size_t pages = grid ? launcher_slot(model, count - 1) / LauncherPageSize + 1 : 1;
    if(pages > 1) {
        char page[32];
        snprintf(page, sizeof(page), "Apps %u/%u", (unsigned)(page_number + 1), (unsigned)pages);
        canvas_draw_str(canvas, 2, 7, page);
    }
    for(size_t i = 0; i < count; ++i) {
        size_t cell = grid ? launcher_slot(model, i) : i;
        if(cell / LauncherPageSize != page_number) continue;
        int x = grid ? 16 + 32 * (cell % LauncherColumns) : 21 + 42 * i;
        int y = grid ? 18 + 20 * ((cell % LauncherPageSize) / LauncherColumns) : 26;
        if(i == selected) {
            canvas_draw_rbox(canvas, x - 12, y - (grid ? 9 : 10), 25, grid ? 19 : 21, 4);
            canvas_set_color(canvas, ColorWhite);
        } else {
            canvas_draw_rframe(canvas, x - 12, y - (grid ? 9 : 10), 25, grid ? 19 : 21, 4);
        }
        if(grid && i >= model->app_count) {
            elements_scrollable_text_line_centered(
                canvas, x, y + 3, 21, model->pinned_labels[i - model->app_count], 0, false, true);
        } else {
            const Icon* icon = grid ? model->apps[i].app->icon : sections[i].icon;
            if(!icon) icon = &A_Plugins_14;
            canvas_draw_icon(
                canvas, x - icon_get_width(icon) / 2, y - icon_get_height(icon) / 2, icon);
        }
        canvas_set_color(canvas, ColorBlack);
        if(!grid)
            canvas_draw_str_aligned(canvas, x, 49, AlignCenter, AlignBottom, sections[i].label);
    }
    if(grid) {
        canvas_draw_line(canvas, 4, 49, 123, 49);
        canvas_set_font(canvas, FontPrimary);
        if(model->remote_unavailable) {
            canvas_draw_str_aligned(
                canvas, 64, 63, AlignCenter, AlignBottom, "Remote unavailable");
        } else if(selected >= model->app_count) {
            elements_scrollable_text_line_centered(
                canvas,
                64,
                63,
                120,
                model->pinned_labels[selected - model->app_count],
                0,
                true,
                true);
        } else {
            canvas_draw_str_aligned(
                canvas, 64, 63, AlignCenter, AlignBottom, model->apps[selected].app->name);
        }
    }
}

static void switch_view(Launcher* launcher, LoaderMenuView view) {
    launcher->menu->current_view = view;
    furi_thread_flags_set(furi_thread_get_id(launcher->menu->thread), MenuSwitch);
}

static void open_settings_details(void* context) {
    switch_view(context, LoaderMenuViewSettings);
}

static bool launcher_input(InputEvent* event, void* context) {
    if(event->type != InputTypeShort && event->type != InputTypeRepeat) return false;
    Launcher* launcher = context;
    LauncherModel* model = view_get_model(launcher->grid);
    const char* launch = NULL;
    const char* remote_path = NULL;
    bool power = false;
    size_t app_count = model->app_count + model->pin_count;
    model->remote_unavailable = false;
    bool settings = false;
    bool handled = true;
    if(event->key == InputKeyBack) {
        handled = model->in_apps && launcher->menu->start == LoaderMenuHome &&
                  event->type == InputTypeShort;
        if(handled) model->in_apps = false;
    } else if(event->key == InputKeyOk && event->type == InputTypeShort) {
        if(model->in_apps && app_count) {
            if(model->app_index >= model->app_count)
                remote_path = furi_string_get_cstr(
                    launcher->pins.paths[model->app_index - model->app_count]);
            else
                launch = model->apps[model->app_index].app->name;
        } else if(model->in_apps) {
            handled = false;
        } else if(model->section == 0)
            model->in_apps = true;
        else if(model->section == 1)
            settings = true;
        else
            power = true;
    } else if(event->key == InputKeyLeft || event->key == InputKeyRight) {
        size_t count = model->in_apps ? app_count : COUNT_OF(sections);
        size_t index = model->in_apps ? model->app_index : model->section;
        if(count) {
            index = (index + (event->key == InputKeyLeft ? count - 1 : 1)) % count;
            if(model->in_apps)
                model->app_index = index;
            else
                model->section = index;
        }
    } else if(
        model->in_apps && app_count && (event->key == InputKeyDown || event->key == InputKeyUp)) {
        model->app_index = launcher_vertical(model, event->key == InputKeyUp);
    } else
        handled = false;
    view_commit_model(launcher->grid, handled);
    if(settings) switch_view(launcher, LoaderMenuViewQuickSettings);
    if(power) {
        Power* service = furi_record_open(RECORD_POWER);
        power_off(service);
        furi_record_close(RECORD_POWER);
    }
    if(remote_path) {
        if(storage_file_exists(launcher->storage, remote_path)) {
            const char* app = eddy_layout_path_valid(remote_path) ? "Remote Builder" : "Infrared";
            loader_start_detached_with_gui_error(launcher->menu->loader, app, remote_path);
        } else {
            with_view_model(
                launcher->grid, LauncherModel * grid, { grid->remote_unavailable = true; }, true);
        }
    }
    if(launch) loader_start_detached_with_gui_error(launcher->menu->loader, launch, NULL);
    return handled;
}

static void launcher_back(void* context) {
    Launcher* launcher = context;
    if(launcher->menu->current_view == LoaderMenuViewSettings) {
        switch_view(launcher, LoaderMenuViewQuickSettings);
    } else if(
        launcher->menu->current_view == LoaderMenuViewQuickSettings &&
        launcher->menu->start == LoaderMenuHome) {
        switch_view(launcher, LoaderMenuViewPrimary);
    } else {
        if(launcher->menu->closed_cb) launcher->menu->closed_cb(launcher->menu->context);
        furi_thread_flags_set(furi_thread_get_id(launcher->menu->thread), MenuStop);
    }
}

static void settings_open(void* context, uint32_t index) {
    Launcher* launcher = context;
    const char* name = FLIPPER_SETTINGS_APPS[index].name;
    if(strcmp(name, "Storage") == 0) {
        run_parallel(loader_menu_storage_settings, NULL, 1024);
        return;
    }
    loader_start_detached_with_gui_error(launcher->menu->loader, name, NULL);
}

static int32_t loader_menu_thread(void* context) {
    LoaderMenu* menu = context;
    Launcher launcher = {.menu = menu, .grid = view_alloc(), .settings = submenu_alloc()};
    launcher.storage = furi_record_open(RECORD_STORAGE);
    eddy_remote_pins_load(launcher.storage, &launcher.pins);
    launcher.quick = loader_quick_settings_alloc(open_settings_details, &launcher);
    view_set_context(launcher.grid, &launcher);
    view_allocate_model(launcher.grid, ViewModelTypeLocking, sizeof(LauncherModel));
    with_view_model(
        launcher.grid,
        LauncherModel * model,
        {
            launcher_load_apps(model, launcher.storage);
            model->section = menu->section;
            model->pin_count = launcher.pins.count;
            for(size_t i = 0; i < model->pin_count; ++i) {
                model->pinned_labels[i] = furi_string_alloc();
                path_extract_filename(launcher.pins.paths[i], model->pinned_labels[i], true);
            }
            model->remote_unavailable = false;
            size_t total = model->app_count + model->pin_count;
            model->app_index = total ? MIN(menu->app_index, total - 1) : 0;
            model->in_apps = menu->in_apps;
        },
        false);
    view_set_draw_callback(launcher.grid, launcher_draw);
    view_set_input_callback(launcher.grid, launcher_input);
    submenu_set_header(launcher.settings, "Settings");
    for(size_t i = 0; i < FLIPPER_SETTINGS_APPS_COUNT; i++) {
        const char* name = FLIPPER_SETTINGS_APPS[i].name;
        submenu_add_item(launcher.settings, name, i, settings_open, &launcher);
    }
    submenu_set_selected_item(launcher.settings, menu->selected_setting);
    ViewHolder* holder = menu->loader->view_holder;
    view_holder_set_back_callback(holder, launcher_back, &launcher);
    for(;;) {
        View* view = menu->current_view == LoaderMenuViewSettings ?
                         submenu_get_view(launcher.settings) :
                         launcher.grid;
        if(menu->current_view == LoaderMenuViewQuickSettings) view = launcher.quick;
        view_holder_set_view(holder, view);
        uint32_t flags =
            furi_thread_flags_wait(MenuStop | MenuSwitch, FuriFlagWaitAny, FuriWaitForever);
        if(flags & MenuStop) break;
    }
    view_holder_set_back_callback(holder, NULL, NULL);
    view_holder_set_view(holder, loading_get_view(menu->loader->loading));
    with_view_model(
        launcher.grid,
        LauncherModel * model,
        {
            free(model->apps);
            menu->section = model->section;
            menu->app_index = model->app_index;
            menu->in_apps = model->in_apps;
            for(size_t i = 0; i < model->pin_count; ++i)
                furi_string_free(model->pinned_labels[i]);
        },
        false);
    menu->selected_setting = submenu_get_selected_item(launcher.settings);
    loader_quick_settings_free(launcher.quick);
    submenu_free(launcher.settings);
    view_free(launcher.grid);
    eddy_remote_pins_clear(&launcher.pins);
    furi_record_close(RECORD_STORAGE);
    return 0;
}
