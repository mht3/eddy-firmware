#include "../eddy_settings_app.h"

enum VarItemListIndex {
    VarItemListIndexInterface,
    VarItemListIndexMisc,
};

void eddy_settings_app_scene_start_var_item_list_callback(void* context, uint32_t index) {
    EddySettingsApp* app = context;
    view_dispatcher_send_custom_event(app->view_dispatcher, index);
}

void eddy_settings_app_scene_start_on_enter(void* context) {
    EddySettingsApp* app = context;
    VariableItemList* var_item_list = app->var_item_list;
    VariableItem* item;

    item = variable_item_list_add(var_item_list, "Interface", 0, NULL, app);
    variable_item_set_current_value_text(item, ">");

    item = variable_item_list_add(var_item_list, "Misc", 0, NULL, app);
    variable_item_set_current_value_text(item, ">");

    variable_item_list_set_header(var_item_list, furi_string_get_cstr(app->version_tag));

    variable_item_list_set_enter_callback(
        var_item_list, eddy_settings_app_scene_start_var_item_list_callback, app);

    variable_item_list_set_selected_item(
        var_item_list,
        scene_manager_get_scene_state(app->scene_manager, EddySettingsAppSceneStart));

    view_dispatcher_switch_to_view(app->view_dispatcher, EddySettingsAppViewVarItemList);
}

bool eddy_settings_app_scene_start_on_event(void* context, SceneManagerEvent event) {
    EddySettingsApp* app = context;
    bool consumed = false;

    if(event.type == SceneManagerEventTypeCustom) {
        scene_manager_set_scene_state(app->scene_manager, EddySettingsAppSceneStart, event.event);
        consumed = true;
        switch(event.event) {
        case VarItemListIndexInterface:
            scene_manager_set_scene_state(app->scene_manager, EddySettingsAppSceneInterface, 0);
            scene_manager_next_scene(app->scene_manager, EddySettingsAppSceneInterface);
            break;
        case VarItemListIndexMisc:
            scene_manager_set_scene_state(app->scene_manager, EddySettingsAppSceneMisc, 0);
            scene_manager_next_scene(app->scene_manager, EddySettingsAppSceneMisc);
            break;
        default:
            break;
        }
    }

    return consumed;
}

void eddy_settings_app_scene_start_on_exit(void* context) {
    EddySettingsApp* app = context;
    variable_item_list_reset(app->var_item_list);
}
