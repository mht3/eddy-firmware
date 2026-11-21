#include "../infrared_app_i.h"

enum SubmenuIndex {
    SubmenuIndexSavedRemotes,
    SubmenuIndexLearnNewRemote,
    SubmenuIndexTvPresets,
    SubmenuIndexButtonTester,
};

static void infrared_scene_start_submenu_callback(void* context, uint32_t index) {
    InfraredApp* infrared = context;
    view_dispatcher_send_custom_event(infrared->view_dispatcher, index);
}

void infrared_scene_start_on_enter(void* context) {
    InfraredApp* infrared = context;
    Submenu* submenu = infrared->submenu;
    SceneManager* scene_manager = infrared->scene_manager;

    submenu_set_header(submenu, "Infrared");
    submenu_add_item(
        submenu,
        "My remotes",
        SubmenuIndexSavedRemotes,
        infrared_scene_start_submenu_callback,
        infrared);
    submenu_add_item(
        submenu,
        "Learn a remote",
        SubmenuIndexLearnNewRemote,
        infrared_scene_start_submenu_callback,
        infrared);

    submenu_add_item(
        submenu,
        "TV presets",
        SubmenuIndexTvPresets,
        infrared_scene_start_submenu_callback,
        infrared);
    submenu_add_item(
        submenu,
        "Button tester",
        SubmenuIndexButtonTester,
        infrared_scene_start_submenu_callback,
        infrared);

    const uint32_t submenu_index =
        scene_manager_get_scene_state(scene_manager, InfraredSceneStart);
    submenu_set_selected_item(submenu, submenu_index);
    scene_manager_set_scene_state(scene_manager, InfraredSceneStart, SubmenuIndexSavedRemotes);

    view_dispatcher_switch_to_view(infrared->view_dispatcher, InfraredViewSubmenu);
}

bool infrared_scene_start_on_event(void* context, SceneManagerEvent event) {
    InfraredApp* infrared = context;
    SceneManager* scene_manager = infrared->scene_manager;

    bool consumed = false;

    if(event.type == SceneManagerEventTypeCustom) {
        const uint32_t submenu_index = event.event;
        scene_manager_set_scene_state(scene_manager, InfraredSceneStart, submenu_index);
        if(submenu_index == SubmenuIndexLearnNewRemote) {
            infrared->remote_name[0] = '\0';
            infrared->app_state.is_learning_new_remote = true;
            infrared->app_state.current_button_index = 0; // Reset index when starting new remote
            scene_manager_next_scene(scene_manager, InfraredSceneLearn);
        } else if(submenu_index == SubmenuIndexTvPresets) {
            scene_manager_next_scene(scene_manager, InfraredSceneTvPresets);
        } else if(submenu_index == SubmenuIndexButtonTester) {
            scene_manager_next_scene(scene_manager, InfraredSceneButtonTester);
        } else if(submenu_index == SubmenuIndexSavedRemotes) {
            furi_string_reset(infrared->remote_page_start);
            furi_string_reset(infrared->file_path);
            scene_manager_next_scene(scene_manager, InfraredSceneRemoteList);
        }

        consumed = true;
    }

    return consumed;
}

void infrared_scene_start_on_exit(void* context) {
    InfraredApp* infrared = context;
    submenu_reset(infrared->submenu);
}
