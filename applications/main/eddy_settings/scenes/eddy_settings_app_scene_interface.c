#include "../eddy_settings_app.h"

enum VarItemListIndex {
    VarItemListIndexGraphics,
    VarItemListIndexMainmenu,
    VarItemListIndexLockscreen,
    VarItemListIndexStatusbar,
    VarItemListIndexFileBrowser,
    VarItemListIndexGeneral,
};

void eddy_settings_app_scene_interface_var_item_list_callback(void* context, uint32_t index) {
    EddySettingsApp* app = context;
    view_dispatcher_send_custom_event(app->view_dispatcher, index);
}

void eddy_settings_app_scene_interface_on_enter(void* context) {
    EddySettingsApp* app = context;
    VariableItemList* var_item_list = app->var_item_list;
    VariableItem* item;

    item = variable_item_list_add(var_item_list, "Graphics", 0, NULL, app);
    variable_item_set_current_value_text(item, ">");

    item = variable_item_list_add(var_item_list, "Mainmenu", 0, NULL, app);
    variable_item_set_current_value_text(item, ">");

    item = variable_item_list_add(var_item_list, "Lockscreen", 0, NULL, app);
    variable_item_set_current_value_text(item, ">");

    item = variable_item_list_add(var_item_list, "Statusbar", 0, NULL, app);
    variable_item_set_current_value_text(item, ">");

    item = variable_item_list_add(var_item_list, "File Browser", 0, NULL, app);
    variable_item_set_current_value_text(item, ">");

    item = variable_item_list_add(var_item_list, "General", 0, NULL, app);
    variable_item_set_current_value_text(item, ">");

    variable_item_list_set_enter_callback(
        var_item_list, eddy_settings_app_scene_interface_var_item_list_callback, app);

    variable_item_list_set_selected_item(
        var_item_list,
        scene_manager_get_scene_state(app->scene_manager, EddySettingsAppSceneInterface));

    view_dispatcher_switch_to_view(app->view_dispatcher, EddySettingsAppViewVarItemList);
}

bool eddy_settings_app_scene_interface_on_event(void* context, SceneManagerEvent event) {
    EddySettingsApp* app = context;
    bool consumed = false;

    if(event.type == SceneManagerEventTypeCustom) {
        scene_manager_set_scene_state(
            app->scene_manager, EddySettingsAppSceneInterface, event.event);
        consumed = true;
        switch(event.event) {
        case VarItemListIndexGraphics:
            scene_manager_set_scene_state(
                app->scene_manager, EddySettingsAppSceneInterfaceGraphics, 0);
            scene_manager_next_scene(app->scene_manager, EddySettingsAppSceneInterfaceGraphics);
            break;
        case VarItemListIndexMainmenu:
            scene_manager_set_scene_state(
                app->scene_manager, EddySettingsAppSceneInterfaceMainmenu, 0);
            scene_manager_next_scene(app->scene_manager, EddySettingsAppSceneInterfaceMainmenu);
            break;
        case VarItemListIndexLockscreen:
            scene_manager_set_scene_state(
                app->scene_manager, EddySettingsAppSceneInterfaceLockscreen, 0);
            scene_manager_next_scene(app->scene_manager, EddySettingsAppSceneInterfaceLockscreen);
            break;
        case VarItemListIndexStatusbar:
            scene_manager_set_scene_state(
                app->scene_manager, EddySettingsAppSceneInterfaceStatusbar, 0);
            scene_manager_next_scene(app->scene_manager, EddySettingsAppSceneInterfaceStatusbar);
            break;
        case VarItemListIndexFileBrowser:
            scene_manager_set_scene_state(
                app->scene_manager, EddySettingsAppSceneInterfaceFilebrowser, 0);
            scene_manager_next_scene(app->scene_manager, EddySettingsAppSceneInterfaceFilebrowser);
            break;
        case VarItemListIndexGeneral:
            scene_manager_set_scene_state(
                app->scene_manager, EddySettingsAppSceneInterfaceGeneral, 0);
            scene_manager_next_scene(app->scene_manager, EddySettingsAppSceneInterfaceGeneral);
            break;
        default:
            break;
        }
    }

    return consumed;
}

void eddy_settings_app_scene_interface_on_exit(void* context) {
    EddySettingsApp* app = context;
    variable_item_list_reset(app->var_item_list);
}
