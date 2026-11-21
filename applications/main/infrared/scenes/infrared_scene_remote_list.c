#include "../infrared_app_i.h"
#include <toolbox/dir_walk.h>
#include <toolbox/path.h>

static int32_t infrared_scene_remote_list_task_callback(void* context) {
    InfraredApp* infrared = context;
    const InfraredErrorCode error =
        infrared_remote_load(infrared->remote, furi_string_get_cstr(infrared->file_path));
    view_dispatcher_send_custom_event(
        infrared->view_dispatcher, InfraredCustomEventTypeTaskFinished);
    return error;
}

static void remote_selected(void* context, uint32_t index) {
    InfraredApp* infrared = context;
    if(index < infrared->remote_count) {
        furi_string_set(infrared->file_path, infrared->remote_paths[index]);
    }
    view_dispatcher_send_custom_event(
        infrared->view_dispatcher, InfraredCustomEventTypeMenuSelected);
}

static bool remote_filter(const char* name, FileInfo* info, void* ctx) {
    UNUSED(ctx);
    if(name[0] == '.') return false;
    if(file_info_is_dir(info)) return false;
    const char* ext = strrchr(name, '.');
    return ext && strcasecmp(ext, INFRARED_APP_EXTENSION) == 0;
}

static const char* remote_filename(FuriString* path) {
    return strrchr(furi_string_get_cstr(path), '/') + 1;
}

static void add_library_rows(InfraredApp* infrared) {
    FuriString* label = furi_string_alloc();
    FuriString* folder = furi_string_alloc();
    for(size_t i = 0; i < infrared->remote_count; ++i) {
        FuriString* path = infrared->remote_paths[i];
        path_extract_filename(path, label, true);
        // Existing nested libraries can contain several remotes with the same name.
        // Use the room or collection as a label without asking the user to open folders.
        path_extract_dirname(furi_string_get_cstr(path), folder);
        const char* location = furi_string_get_cstr(folder) + strlen(INFRARED_APP_FOLDER);
        if(*location == '/') furi_string_cat_printf(label, " (%s)", location + 1);
        submenu_add_item(
            infrared->submenu, furi_string_get_cstr(label), i, remote_selected, infrared);
        if(furi_string_equal(path, infrared->file_path))
            submenu_set_selected_item(infrared->submenu, i);
    }
    furi_string_free(folder);
    furi_string_free(label);
}

enum {
    LibraryPrevious = UINT32_MAX - 2,
    LibraryNext = UINT32_MAX - 1,
    LibraryRetry = UINT32_MAX
};

typedef enum {
    PageAtStart,
    PageAfter,
    PageBefore
} PageDirection;

static void library_action(void* context, uint32_t index) {
    InfraredApp* infrared = context;
    view_dispatcher_send_custom_event(infrared->view_dispatcher, index);
}

static int compare_remotes(FuriString* a, FuriString* b) {
    int order = strcasecmp(remote_filename(a), remote_filename(b));
    return order ? order : furi_string_cmp(a, b);
}

// Keep only the first (or last, when paging back) screenful of matches in RAM.
static bool page_consider(InfraredApp* app, FuriString* path, bool reverse) {
    size_t index = app->remote_count;
    while(index) {
        int order = compare_remotes(app->remote_paths[index - 1], path);
        if(reverse ? order >= 0 : order <= 0) break;
        --index;
    }
    bool full = app->remote_count == INFRARED_REMOTES_PER_PAGE;
    if(index == INFRARED_REMOTES_PER_PAGE) return true;
    FuriString* slot;
    if(full) {
        slot = app->remote_paths[app->remote_count - 1];
    } else {
        slot = furi_string_alloc();
        ++app->remote_count;
    }
    for(size_t j = app->remote_count - 1; j > index; --j)
        app->remote_paths[j] = app->remote_paths[j - 1];
    furi_string_set(slot, path);
    app->remote_paths[index] = slot;
    return full;
}

static void clear_page(InfraredApp* app) {
    submenu_reset(app->submenu);
    for(size_t i = 0; i < app->remote_count; ++i)
        furi_string_free(app->remote_paths[i]);
    app->remote_count = 0;
}

static void load_page(InfraredApp* app, PageDirection direction) {
    bool before = false, after = false;
    clear_page(app);
    DirWalk* walk = dir_walk_alloc(app->storage);
    const char* excluded[] = {INFRARED_APP_FOLDER "/assets"};
    dir_walk_set_recurse_filter(walk, excluded, COUNT_OF(excluded));
    dir_walk_set_filter_cb(walk, remote_filter, NULL);
    FuriString* path = furi_string_alloc();
    DirWalkResult result = DirWalkError;
    if(storage_simply_mkdir(app->storage, INFRARED_APP_FOLDER) &&
       dir_walk_open(walk, INFRARED_APP_FOLDER)) {
        while((result = dir_walk_read(walk, path, NULL)) == DirWalkOK) {
            if(!furi_string_empty(app->remote_page_start)) {
                int order = compare_remotes(path, app->remote_page_start);
                if(direction == PageBefore && order >= 0) {
                    after = true;
                    continue;
                }
                if(direction != PageBefore &&
                   (order < 0 || (direction == PageAfter && order == 0))) {
                    before = true;
                    continue;
                }
            }
            if(page_consider(app, path, direction == PageBefore)) {
                if(direction == PageBefore)
                    before = true;
                else
                    after = true;
            }
        }
    }
    dir_walk_free(walk);
    furi_string_free(path);
    if(direction == PageBefore) {
        for(size_t i = 0; i < app->remote_count / 2; ++i) {
            FuriString* tmp = app->remote_paths[i];
            size_t other = app->remote_count - 1 - i;
            app->remote_paths[i] = app->remote_paths[other];
            app->remote_paths[other] = tmp;
        }
    }
    if(before)
        submenu_add_item(app->submenu, "Previous page", LibraryPrevious, library_action, app);
    if(app->remote_count) {
        furi_string_set(app->remote_page_start, app->remote_paths[0]);
        add_library_rows(app);
    }
    if(after) submenu_add_item(app->submenu, "Next page", LibraryNext, library_action, app);
    if(result != DirWalkLast) {
        submenu_set_header(app->submenu, "Check microSD card");
        submenu_add_item(app->submenu, "Try again", LibraryRetry, library_action, app);
    } else if(!app->remote_count && !before && !after) {
        submenu_set_header(app->submenu, "No remotes yet");
        submenu_add_item(app->submenu, "Learn a remote", 0, remote_selected, app);
    } else {
        submenu_set_header(app->submenu, "My remotes");
    }
    view_dispatcher_switch_to_view(app->view_dispatcher, InfraredViewSubmenu);
}

void infrared_scene_remote_list_on_enter(void* context) {
    load_page(context, PageAtStart);
}

bool infrared_scene_remote_list_on_event(void* context, SceneManagerEvent event) {
    InfraredApp* infrared = context;
    if(event.type != SceneManagerEventTypeCustom) return false;
    if(event.event == LibraryRetry) {
        load_page(infrared, PageAtStart);
    } else if(event.event == LibraryNext || event.event == LibraryPrevious) {
        bool next = event.event == LibraryNext;
        if(infrared->remote_count) {
            size_t edge = next ? infrared->remote_count - 1 : 0;
            furi_string_set(infrared->remote_page_start, infrared->remote_paths[edge]);
        }
        furi_string_reset(infrared->file_path);
        load_page(infrared, next ? PageAfter : PageBefore);
        if(infrared->remote_count) submenu_set_selected_item(infrared->submenu, 0);
    } else if(event.event == InfraredCustomEventTypeMenuSelected) {
        if(infrared->remote_count)
            infrared_blocking_task_start(infrared, infrared_scene_remote_list_task_callback);
        else {
            infrared->remote_name[0] = '\0';
            infrared->app_state.is_learning_new_remote = true;
            infrared->app_state.current_button_index = 0;
            scene_manager_next_scene(infrared->scene_manager, InfraredSceneLearn);
        }
    } else if(event.event == InfraredCustomEventTypeTaskFinished) {
        InfraredErrorCode error = infrared_blocking_task_finalize(infrared);
        if(!INFRARED_ERROR_PRESENT(error))
            scene_manager_next_scene(infrared->scene_manager, InfraredSceneRemote);
        else {
            infrared_show_error_message(infrared, "Could not open this remote");
            view_dispatcher_switch_to_view(infrared->view_dispatcher, InfraredViewSubmenu);
        }
    } else
        return false;
    return true;
}

void infrared_scene_remote_list_on_exit(void* context) {
    clear_page(context);
}
