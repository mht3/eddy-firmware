#include "../infrared_app_i.h"

void infrared_scene_learn_remote_name_on_enter(void* context) {
    InfraredApp* infrared = context;
    TextInput* input = infrared->text_input;
    if(!infrared->remote_name[0]) {
        FuriString* suggested = furi_string_alloc();
        storage_get_next_filename(
            infrared->storage,
            INFRARED_APP_FOLDER,
            "TV",
            INFRARED_APP_EXTENSION,
            suggested,
            sizeof(infrared->remote_name) - 1);
        strlcpy(
            infrared->remote_name, furi_string_get_cstr(suggested), sizeof(infrared->remote_name));
        furi_string_free(suggested);
    }
    text_input_set_header_text(input, "Name your remote");
    text_input_set_validator(
        input,
        infrared_validate_remote_name,
        validator_is_file_alloc_init(INFRARED_APP_FOLDER, INFRARED_APP_EXTENSION, NULL));
    text_input_set_result_callback(
        input,
        infrared_text_input_callback,
        context,
        infrared->remote_name,
        sizeof(infrared->remote_name),
        true);
    view_dispatcher_switch_to_view(infrared->view_dispatcher, InfraredViewTextInput);
}

bool infrared_scene_learn_remote_name_on_event(void* context, SceneManagerEvent event) {
    InfraredApp* infrared = context;
    if(event.type != SceneManagerEventTypeCustom ||
       event.event != InfraredCustomEventTypeTextEditDone)
        return false;
    scene_manager_next_scene(infrared->scene_manager, InfraredSceneLearnEnterName);
    return true;
}

void infrared_scene_learn_remote_name_on_exit(void* context) {
    InfraredApp* infrared = context;
    validator_is_file_free(text_input_get_validator_callback_context(infrared->text_input));
    text_input_reset(infrared->text_input);
}
