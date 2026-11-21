#include "../eddy_settings_app.h"

enum VarItemListIndex {
    VarItemListIndexScreen,
    VarItemListIndexDolphin,
    VarItemListIndexVgm,
    VarItemListIndexShowMomentumIntro,
};

void eddy_settings_app_scene_misc_var_item_list_callback(void* context, uint32_t index) {
    EddySettingsApp* app = context;
    view_dispatcher_send_custom_event(app->view_dispatcher, index);
}

void eddy_settings_app_scene_misc_on_enter(void* context) {
    EddySettingsApp* app = context;
    VariableItemList* var_item_list = app->var_item_list;
    VariableItem* item;

    item = variable_item_list_add(var_item_list, "Screen", 0, NULL, app);
    variable_item_set_current_value_text(item, ">");

    item = variable_item_list_add(var_item_list, "Eddy the Dolphin", 0, NULL, app);
    variable_item_set_current_value_text(item, ">");

    item = variable_item_list_add(var_item_list, "VGM Options", 0, NULL, app);
    variable_item_set_current_value_text(item, ">");

    variable_item_list_add(var_item_list, "Show Eddy Intro", 0, NULL, app);

    variable_item_list_set_enter_callback(
        var_item_list, eddy_settings_app_scene_misc_var_item_list_callback, app);

    variable_item_list_set_selected_item(
        var_item_list,
        scene_manager_get_scene_state(app->scene_manager, EddySettingsAppSceneMisc));

    view_dispatcher_switch_to_view(app->view_dispatcher, EddySettingsAppViewVarItemList);
}

bool eddy_settings_app_scene_misc_on_event(void* context, SceneManagerEvent event) {
    EddySettingsApp* app = context;
    bool consumed = false;

    if(event.type == SceneManagerEventTypeCustom) {
        scene_manager_set_scene_state(app->scene_manager, EddySettingsAppSceneMisc, event.event);
        consumed = true;
        switch(event.event) {
        case VarItemListIndexScreen:
            scene_manager_set_scene_state(app->scene_manager, EddySettingsAppSceneMiscScreen, 0);
            scene_manager_next_scene(app->scene_manager, EddySettingsAppSceneMiscScreen);
            break;
        case VarItemListIndexDolphin:
            scene_manager_set_scene_state(app->scene_manager, EddySettingsAppSceneMiscDolphin, 0);
            scene_manager_next_scene(app->scene_manager, EddySettingsAppSceneMiscDolphin);
            break;
        case VarItemListIndexVgm:
            scene_manager_set_scene_state(app->scene_manager, EddySettingsAppSceneMiscVgm, 0);
            scene_manager_next_scene(app->scene_manager, EddySettingsAppSceneMiscVgm);
            break;
        case VarItemListIndexShowMomentumIntro: {
            for(int i = 0; i < 10; i++) {
                if(storage_common_copy(
                       app->storage, EXT_PATH("dolphin/firstboot.bin"), SLIDESHOW_FS_PATH)) {
                    app->show_slideshow = true;
                    eddy_settings_app_apply(app);
                    break;
                }
            }
            break;
        }
        default:
            break;
        }
    }

    return consumed;
}

void eddy_settings_app_scene_misc_on_exit(void* context) {
    EddySettingsApp* app = context;
    variable_item_list_reset(app->var_item_list);
}
