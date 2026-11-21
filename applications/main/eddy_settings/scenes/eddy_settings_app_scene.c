#include "eddy_settings_app_scene.h"

// Generate scene on_enter handlers array
#define ADD_SCENE(prefix, name, id) prefix##_scene_##name##_on_enter,
void (*const eddy_settings_app_on_enter_handlers[])(void*) = {
#include "eddy_settings_app_scene_config.h"
};
#undef ADD_SCENE

// Generate scene on_event handlers array
#define ADD_SCENE(prefix, name, id) prefix##_scene_##name##_on_event,
bool (*const eddy_settings_app_on_event_handlers[])(void* context, SceneManagerEvent event) = {
#include "eddy_settings_app_scene_config.h"
};
#undef ADD_SCENE

// Generate scene on_exit handlers array
#define ADD_SCENE(prefix, name, id) prefix##_scene_##name##_on_exit,
void (*const eddy_settings_app_on_exit_handlers[])(void* context) = {
#include "eddy_settings_app_scene_config.h"
};
#undef ADD_SCENE

// Initialize scene handlers configuration structure
const SceneManagerHandlers eddy_settings_app_scene_handlers = {
    .on_enter_handlers = eddy_settings_app_on_enter_handlers,
    .on_event_handlers = eddy_settings_app_on_event_handlers,
    .on_exit_handlers = eddy_settings_app_on_exit_handlers,
    .scene_num = EddySettingsAppSceneNum,
};
