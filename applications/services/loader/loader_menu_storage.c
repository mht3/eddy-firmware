#include "loader_menu_storage_i.h"

#include <core/thread.h>
#include <dialogs/dialogs.h>
#include <storage/storage.h>
#include <gui/modules/dialog_ex.h>
#include <gui/view_holder.h>
#include <assets_icons.h>

#include "loader.h"

typedef enum {
    FormatFlagContinue = (1 << 0),
    FormatFlagCancel = (1 << 1),
    FormatFlagAll = (FormatFlagContinue | FormatFlagCancel),
} FormatFlag;

static void loader_menu_storage_settings_callback(DialogExResult result, void* context) {
    FuriThread* thread = context;
    furi_thread_flags_set(
        furi_thread_get_id(thread),
        result == DialogExResultRight ? FormatFlagContinue : FormatFlagCancel);
}

static void loader_menu_storage_settings_back(void* context) {
    FuriThread* thread = context;
    furi_thread_flags_set(furi_thread_get_id(thread), FormatFlagCancel);
}

static void storage_notice(const char* title, const char* text) {
    DialogsApp* dialogs = furi_record_open(RECORD_DIALOGS);
    DialogMessage* message = dialog_message_alloc();
    dialog_message_set_header(message, title, 64, 3, AlignCenter, AlignTop);
    dialog_message_set_text(message, text, 64, 31, AlignCenter, AlignCenter);
    dialog_message_set_buttons(message, NULL, "OK", NULL);
    dialog_message_show(dialogs, message);
    dialog_message_free(message);
    furi_record_close(RECORD_DIALOGS);
}

int32_t loader_menu_storage_settings(void* context) {
    UNUSED(context);
    Storage* storage = furi_record_open(RECORD_STORAGE);
    FS_Error card = storage_sd_status(storage);
    if(card == FSE_OK) {
        Loader* loader = furi_record_open(RECORD_LOADER);
        LoaderStatus result = loader_start(loader, "Storage", NULL, NULL);
        furi_record_close(RECORD_LOADER);
        if(result != LoaderStatusErrorUnknownApp && result != LoaderStatusErrorInternal) {
            furi_record_close(RECORD_STORAGE);
            return 0;
        }
        card = storage_sd_status(storage);
    }

    if(card == FSE_NOT_READY) {
        storage_notice("No microSD card", "Insert or reinsert a card,\nthen open Storage again.");
    } else if(card == FSE_OK) {
        storage_notice("Storage unavailable", "Restore Eddy's apps at\neddy-fw.dev/update");
    } else {
        DialogEx* dialog_ex = dialog_ex_alloc();
        Gui* gui = furi_record_open(RECORD_GUI);
        ViewHolder* view_holder = view_holder_alloc();
        view_holder_attach_to_gui(view_holder, gui);
        view_holder_set_view(view_holder, dialog_ex_get_view(dialog_ex));
        dialog_ex_set_context(dialog_ex, furi_thread_get_current());
        dialog_ex_set_result_callback(dialog_ex, loader_menu_storage_settings_callback);
        view_holder_set_back_callback(
            view_holder, loader_menu_storage_settings_back, furi_thread_get_current());

        dialog_ex_set_header(dialog_ex, "Card unreadable", 64, 0, AlignCenter, AlignTop);
        dialog_ex_set_text(
            dialog_ex, "Try reinserting your card.", 64, 25, AlignCenter, AlignCenter);
        dialog_ex_set_left_button_text(dialog_ex, "Back");
        dialog_ex_set_right_button_text(dialog_ex, "Format SD");

        FormatFlag flag = furi_thread_flags_wait(FormatFlagAll, FuriFlagWaitAny, FuriWaitForever);
        if(flag == FormatFlagContinue) {
            char text[39];
            dialog_ex_set_header(dialog_ex, "Format SD Card?", 64, 0, AlignCenter, AlignTop);
            dialog_ex_set_icon(dialog_ex, 0, 0, NULL);
            dialog_ex_set_left_button_text(dialog_ex, "Cancel");
            dialog_ex_set_right_button_text(dialog_ex, "Format");
            for(uint8_t counter = 5; counter > 0; counter--) {
                snprintf(text, sizeof(text), "All data will be lost!\n%d presses left", counter);
                dialog_ex_set_text(dialog_ex, text, 64, 12, AlignCenter, AlignTop);
                flag = furi_thread_flags_wait(FormatFlagAll, FuriFlagWaitAny, FuriWaitForever);
                if(flag != FormatFlagContinue) break;

                if(counter == 1) {
                    dialog_ex_set_header(
                        dialog_ex, "Formatting...", 70, 32, AlignCenter, AlignCenter);
                    dialog_ex_set_text(dialog_ex, NULL, 0, 0, AlignCenter, AlignCenter);
                    dialog_ex_set_icon(dialog_ex, 15, 20, &I_LoadingHourglass_24x24);
                    dialog_ex_set_left_button_text(dialog_ex, NULL);
                    dialog_ex_set_right_button_text(dialog_ex, NULL);

                    FS_Error error = storage_sd_format(storage);
                    if(error != FSE_OK) {
                        dialog_ex_set_header(
                            dialog_ex, "Cannot Format SD Card", 64, 10, AlignCenter, AlignCenter);
                        dialog_ex_set_icon(dialog_ex, 0, 0, NULL);
                        dialog_ex_set_text(
                            dialog_ex,
                            storage_error_get_desc(error),
                            64,
                            32,
                            AlignCenter,
                            AlignCenter);
                    } else {
                        dialog_ex_set_icon(dialog_ex, 48, 6, &I_DolphinDone_80x58);
                        dialog_ex_set_header(dialog_ex, "Formatted", 5, 10, AlignLeft, AlignTop);
                    }
                    dialog_ex_set_left_button_text(dialog_ex, "Finish");
                    furi_thread_flags_wait(FormatFlagAll, FuriFlagWaitAny, FuriWaitForever);
                }
            }
        }

        view_holder_set_view(view_holder, NULL);
        view_holder_free(view_holder);
        furi_record_close(RECORD_GUI);
        dialog_ex_free(dialog_ex);
    }
    furi_record_close(RECORD_STORAGE);
    return 0;
}
