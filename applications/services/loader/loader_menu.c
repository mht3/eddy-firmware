#include <gui/modules/submenu.h>
#include <gui/elements.h>
#include <assets_icons.h>
#include <applications.h>
#include <toolbox/run_parallel.h>
#include <toolbox/eddy_remote_shortcut.h>
#include <toolbox/path.h>
#include <storage/storage.h>
#include "loader.h"
#include "loader_i.h"
#include "loader_menu.h"
#include "loader_menu_storage_i.h"
#include "loader_menu_power_i.h"
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
    uint8_t app_index;
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

static const LauncherItem apps[] = {
    {"Sub-GHz", &A_Sub1ghz_14},
    {"RFID", &A_125khz_14},
    {"NFC", &A_NFC_14},
    {"Infrared", &A_Infrared_14},
    {"GPIO", &A_GPIO_14},
    {"iButton", &A_iButton_14},
    {"Pomodoro Timer", &I_Clock_18x18},
};

static const LauncherItem sections[] = {
    {"Apps", &A_Plugins_14},
    {"Settings", &A_Settings_14},
    {"Power", &I_Battery_16x16}};

typedef struct {
    uint8_t section;
    uint8_t app_index;
    bool in_apps;
    FuriString* pinned_label;
    bool remote_unavailable;
} LauncherModel;

typedef struct {
    LoaderMenu* menu;
    View* grid;
    View* quick;
    Submenu* settings;
    Storage* storage;
    FuriString* pinned_path;
} Launcher;

static void launcher_draw(Canvas* canvas, void* context) {
    const LauncherModel* model = context;
    bool grid = model->in_apps;
    size_t count = grid ? COUNT_OF(apps) + (model->pinned_label != NULL) : COUNT_OF(sections);
    size_t selected = grid ? model->app_index : model->section;
    canvas_set_font(canvas, FontSecondary);
    for(size_t i = 0; i < count; ++i) {
        const Icon* icon = grid ? (i < COUNT_OF(apps) ? apps[i].icon : &I_xremote_10px) :
                                  sections[i].icon;
        int x = grid ? 16 + 32 * (i % 4) : 21 + 42 * i;
        int y = grid ? 12 + 24 * (i / 4) : 26;
        if(i == selected) {
            canvas_draw_rbox(canvas, x - 12, y - 10, 25, 21, 4);
            canvas_set_color(canvas, ColorWhite);
        } else {
            canvas_draw_rframe(canvas, x - 12, y - 10, 25, 21, 4);
        }
        canvas_draw_icon(
            canvas, x - icon_get_width(icon) / 2, y - icon_get_height(icon) / 2, icon);
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
        } else if(selected == COUNT_OF(apps)) {
            elements_scrollable_text_line_centered(
                canvas, 64, 63, 120, model->pinned_label, 0, true, true);
        } else {
            canvas_draw_str_aligned(
                canvas, 64, 63, AlignCenter, AlignBottom, apps[selected].label);
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
    bool open_remote = false;
    bool power = false;
    unsigned app_count = COUNT_OF(apps) + (model->pinned_label != NULL);
    model->remote_unavailable = false;
    bool settings = false;
    bool handled = true;
    if(event->key == InputKeyBack) {
        handled = model->in_apps && launcher->menu->start == LoaderMenuHome &&
                  event->type == InputTypeShort;
        if(handled) model->in_apps = false;
    } else if(event->key == InputKeyOk && event->type == InputTypeShort) {
        if(model->in_apps) {
            if(model->app_index == COUNT_OF(apps))
                open_remote = true;
            else
                launch = apps[model->app_index].label;
        } else if(model->section == 0)
            model->in_apps = true;
        else if(model->section == 1)
            settings = true;
        else
            power = true;
    } else if(event->key == InputKeyLeft || event->key == InputKeyRight) {
        uint8_t* index = model->in_apps ? &model->app_index : &model->section;
        unsigned count = model->in_apps ? app_count : COUNT_OF(sections);
        *index = (*index + (event->key == InputKeyLeft ? count - 1 : 1)) % count;
    } else if(model->in_apps && (event->key == InputKeyDown || event->key == InputKeyUp)) {
        model->app_index = model->app_index >= 4 ?
                               model->app_index - 4U :
                               MIN((unsigned)model->app_index + 4, app_count - 1);
    } else
        handled = false;
    view_commit_model(launcher->grid, handled);
    if(settings) switch_view(launcher, LoaderMenuViewQuickSettings);
    if(power) run_parallel(loader_menu_power, NULL, 1024);
    if(open_remote) {
        const char* path = furi_string_get_cstr(launcher->pinned_path);
        if(storage_file_exists(launcher->storage, path)) {
            loader_start_detached_with_gui_error(launcher->menu->loader, "Infrared", path);
        } else {
            with_view_model(
                launcher->grid,
                LauncherModel * grid,
                {
                    grid->pinned_label = NULL;
                    grid->remote_unavailable = true;
                    grid->app_index = COUNT_OF(apps) - 1;
                },
                true);
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
    if(strcmp(name, "Power") == 0) {
        run_parallel(loader_menu_power, NULL, 1024);
        return;
    }
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
    launcher.pinned_path = furi_string_alloc();
    FuriString* pinned_label = furi_string_alloc();
    bool has_pin = eddy_remote_shortcut_get(launcher.storage, launcher.pinned_path);
    if(has_pin) path_extract_filename(launcher.pinned_path, pinned_label, true);
    launcher.quick = loader_quick_settings_alloc(open_settings_details, &launcher);
    view_set_context(launcher.grid, &launcher);
    view_allocate_model(launcher.grid, ViewModelTypeLocking, sizeof(LauncherModel));
    with_view_model(
        launcher.grid,
        LauncherModel * model,
        {
            model->section = menu->section;
            model->pinned_label = has_pin ? pinned_label : NULL;
            model->remote_unavailable = false;
            model->app_index = MIN(menu->app_index, COUNT_OF(apps) - 1 + has_pin);
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
            menu->section = model->section;
            menu->app_index = model->app_index;
            menu->in_apps = model->in_apps;
        },
        false);
    menu->selected_setting = submenu_get_selected_item(launcher.settings);
    loader_quick_settings_free(launcher.quick);
    submenu_free(launcher.settings);
    view_free(launcher.grid);
    furi_string_free(launcher.pinned_path);
    furi_string_free(pinned_label);
    furi_record_close(RECORD_STORAGE);
    return 0;
}
