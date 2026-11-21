#include "loader_menu_power_i.h"
#include "loader.h"
#include <dialogs/dialogs.h>
#include <power/power_service/power.h>

int32_t loader_menu_power(void* argument) {
    Loader* loader = furi_record_open(RECORD_LOADER);
    LoaderStatus result = loader_start(loader, "Power", argument, NULL);
    furi_record_close(RECORD_LOADER);
    if(result != LoaderStatusErrorUnknownApp && result != LoaderStatusErrorInternal) return 0;

    // Device shutdown also works when the settings app on the SD card is unavailable.
    DialogMessage* message = dialog_message_alloc();
    dialog_message_set_header(message, "Power off?", 64, 22, AlignCenter, AlignCenter);
    dialog_message_set_buttons(message, "Cancel", NULL, "Power off");
    DialogsApp* dialogs = furi_record_open(RECORD_DIALOGS);
    DialogMessageButton choice = dialog_message_show(dialogs, message);
    furi_record_close(RECORD_DIALOGS);
    dialog_message_free(message);
    if(choice == DialogMessageButtonRight) {
        Power* power = furi_record_open(RECORD_POWER);
        power_off(power);
        furi_record_close(RECORD_POWER);
    }
    return 0;
}
