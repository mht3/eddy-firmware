#include "../infrared_app_i.h"
#include <string.h>

static void saved_remote_choice(DialogExResult result, void* context) {
    InfraredApp* infrared = context;
    view_dispatcher_send_custom_event(infrared->view_dispatcher, result);
}

// Thirteen of the widest secondary-font glyphs fit on one LCD line.
static const char* saved_remote_label(InfraredApp* infrared) {
    const char* name = infrared_remote_get_name(infrared->remote);
    const size_t max_line = 13;
    const size_t length = strlen(name);
    if(length <= max_line) return name;

    // Newly named remotes are limited to 22 bytes. Prefer a space that lets
    // both halves fit, otherwise break at a complete UTF-8 character.
    size_t split = length / 2;
    for(size_t i = length - max_line; i <= max_line; ++i) {
        if(name[i] == ' ') {
            split = i;
            break;
        }
    }
    while(split && ((uint8_t)name[split] & 0xC0) == 0x80)
        split--;
    infrared_text_store_set(
        infrared, 0, "%.*s\n%s", (int)split, name, name + split + (name[split] == ' '));
    return infrared->text_store[0];
}

void infrared_scene_learn_done_on_enter(void* context) {
    InfraredApp* infrared = context;
    if(infrared->app_state.is_learning_new_remote) {
        DialogEx* dialog = infrared->dialog_ex;
        dialog_ex_disable_extended_events(dialog);
        dialog_ex_set_header(dialog, "Remote saved", 64, 14, AlignCenter, AlignTop);
        dialog_ex_set_text(dialog, saved_remote_label(infrared), 64, 35, AlignCenter, AlignCenter);
        dialog_ex_set_left_button_text(dialog, "Done");
        dialog_ex_set_right_button_text(dialog, "Pin to Apps");
        dialog_ex_set_result_callback(dialog, saved_remote_choice);
        dialog_ex_set_context(dialog, infrared);
        view_dispatcher_switch_to_view(infrared->view_dispatcher, InfraredViewDialogEx);
    } else {
        Popup* popup = infrared->popup;
        popup_set_header(popup, "Button saved", 64, 18, AlignCenter, AlignCenter);
        popup_set_text(
            popup, infrared_remote_get_name(infrared->remote), 64, 39, AlignCenter, AlignCenter);
        popup_set_callback(popup, infrared_popup_closed_callback);
        popup_set_context(popup, context);
        popup_set_timeout(popup, 1500);
        popup_enable_timeout(popup);
        view_dispatcher_switch_to_view(infrared->view_dispatcher, InfraredViewPopup);
    }
}

bool infrared_scene_learn_done_on_event(void* context, SceneManagerEvent event) {
    InfraredApp* infrared = context;
    if(event.type == SceneManagerEventTypeCustom) {
        if(infrared->app_state.is_learning_new_remote) {
            if(event.event == DialogExResultRight) {
                if(!infrared_set_apps_shortcut(infrared, true)) return true;
            } else if(event.event != DialogExResultLeft) {
                return false;
            }
        } else if(event.event != InfraredCustomEventTypePopupClosed) {
            return false;
        }
    } else if(event.type != SceneManagerEventTypeBack) {
        return false;
    }
    if(!scene_manager_search_and_switch_to_previous_scene(
           infrared->scene_manager, InfraredSceneRemote)) {
        scene_manager_next_scene(infrared->scene_manager, InfraredSceneRemote);
    }
    return true;
}

void infrared_scene_learn_done_on_exit(void* context) {
    InfraredApp* infrared = context;
    if(infrared->app_state.is_learning_new_remote) {
        dialog_ex_reset(infrared->dialog_ex);
        infrared->app_state.is_learning_new_remote = false;
    } else {
        popup_reset(infrared->popup);
    }
}
