#include "media_service_i.h"
#include "music_hid.h"
#include <furi.h>
#include <app_common.h>
#include <ble/ble.h>
#include <furi_ble/event_dispatcher.h>
#include <furi_ble/gatt.h>

// STM32WB accepts 128-bit UUIDs least-significant octet first.
#define MUSIC_UUID(id) \
    {0xed, 0x00, 0x0d, 0xe6, 0x72, 0x1f, 0xab, 0x9f, 0x32, 0x4a, 0x34, 0x5a, id, 0x00, 0xdd, 0xef}

static const Service_UUID_t service_uuid = {.Service_UUID_128 = MUSIC_UUID(1)};
static const BleGattCharacteristicParams state_char = {
    .name = "Playback",
    .data.fixed.length = 20,
    .uuid.Char_UUID_128 = MUSIC_UUID(2),
    .uuid_type = UUID_TYPE_128,
    .char_properties = CHAR_PROP_WRITE,
    .security_permissions = ATTR_PERMISSION_AUTHEN_WRITE,
    .gatt_evt_mask = GATT_NOTIFY_ATTRIBUTE_WRITE,
    .is_variable = CHAR_VALUE_LEN_VARIABLE,
};
static const BleGattCharacteristicParams command_char = {
    .name = "Transport",
    .data.fixed.length = 1,
    .uuid.Char_UUID_128 = MUSIC_UUID(3),
    .uuid_type = UUID_TYPE_128,
    .char_properties = CHAR_PROP_NOTIFY,
    .security_permissions = ATTR_PERMISSION_AUTHEN_READ,
};

typedef struct {
    uint16_t handle;
    uint16_t connection;
    BleGattCharacteristicInstance state;
    BleGattCharacteristicInstance command;
    GapSvcEventHandler* handler;
    MusicHid* hid;
    BleMediaEventCallback callback;
    void* context;
} MediaService;

// The guard outlives profile restarts and synchronizes detach with in-flight callbacks.
static FuriMutex* guard;
static MediaService* active;

static BleEventAckStatus media_event(void* event, void* context) {
    MediaService* svc = context;
    const hci_event_pckt* packet = (const void*)((const hci_uart_pckt*)event)->data;
    BleEventAckStatus result = BleEventNotAck;
    furi_mutex_acquire(guard, FuriWaitForever);
    bool link_event = false;
    uint16_t confirmation = UINT16_MAX;
    if(packet->evt == HCI_LE_META_EVT_CODE && packet->plen >= 4 &&
       (packet->data[0] == HCI_LE_CONNECTION_COMPLETE_SUBEVT_CODE ||
        packet->data[0] == HCI_LE_ENHANCED_CONNECTION_COMPLETE_SUBEVT_CODE) &&
       packet->data[1] == BLE_STATUS_SUCCESS) {
        svc->connection = packet->data[2] | ((uint16_t)packet->data[3] << 8);
        link_event = true;
    } else if(
        packet->evt == HCI_DISCONNECTION_COMPLETE_EVT_CODE && packet->plen >= 4 &&
        svc->connection == (packet->data[1] | ((uint16_t)packet->data[2] << 8))) {
        svc->connection = UINT16_MAX;
        link_event = true;
    }
    if(link_event && svc->callback)
        svc->callback(BleMediaLink, &svc->connection, sizeof(svc->connection), svc->context);
    if(packet->evt == HCI_VENDOR_SPECIFIC_DEBUG_EVT_CODE && packet->plen >= 2) {
        if(svc->callback) svc->callback(BleMediaRadio, event, 0, svc->context);
        const evt_blecore_aci* aci = (const void*)packet->data;
        if(aci->ecode == ACI_GATT_INDICATION_VSEVT_CODE && packet->plen >= 4) {
            // A bonded phone may retain the Service Changed subscription while
            // Spotify is closed. ATT still requires confirmation from the client.
            uint16_t handle = aci->data[0] | ((uint16_t)aci->data[1] << 8);
            if(handle == svc->connection) confirmation = handle;
        }
        if(aci->ecode == ACI_GATT_ATTRIBUTE_MODIFIED_VSEVT_CODE &&
           packet->plen >= 2 + offsetof(aci_gatt_attribute_modified_event_rp0, Attr_Data)) {
            const aci_gatt_attribute_modified_event_rp0* write = (const void*)aci->data;
            if(write->Attr_Handle == svc->state.handle + 1) {
                if(svc->callback && write->Connection_Handle == svc->connection &&
                   write->Offset == 0 && write->Attr_Data_Length &&
                   write->Attr_Data_Length <= 20 &&
                   write->Attr_Data_Length <=
                       packet->plen - 2 -
                           offsetof(aci_gatt_attribute_modified_event_rp0, Attr_Data))
                    svc->callback(
                        BleMediaFrame, write->Attr_Data, write->Attr_Data_Length, svc->context);
                result = BleEventAckFlowEnable;
            }
        }
    }
    furi_mutex_release(guard);
    if(confirmation != UINT16_MAX) ble_gatt_client_confirm(confirmation);
    return result;
}

static void media_free(MediaService* svc) {
    if(svc->state.characteristic) ble_gatt_characteristic_delete(svc->handle, &svc->state);
    if(svc->command.characteristic) ble_gatt_characteristic_delete(svc->handle, &svc->command);
    if(svc->hid) music_hid_stop(svc->hid);
    if(svc->handle) ble_gatt_service_delete(svc->handle);
    free(svc);
}

void ble_svc_media_start(void) {
    if(!guard) guard = furi_mutex_alloc(FuriMutexTypeNormal);
    MediaService* svc = malloc(sizeof(MediaService));
    *svc = (MediaService){.connection = UINT16_MAX};
    if(ble_gatt_service_add(UUID_TYPE_128, &service_uuid, PRIMARY_SERVICE, 6, &svc->handle)) {
        ble_gatt_characteristic_init(svc->handle, &state_char, &svc->state);
        ble_gatt_characteristic_init(svc->handle, &command_char, &svc->command);
        svc->hid = music_hid_start();
        if(svc->state.handle && svc->command.handle && svc->hid) {
            svc->handler = ble_event_dispatcher_register_svc_handler(media_event, svc);
            furi_mutex_acquire(guard, FuriWaitForever);
            active = svc;
            furi_mutex_release(guard);
            return;
        }
    }
    FURI_LOG_E("BtMedia", "Media service initialization failed");
    media_free(svc);
}

void ble_svc_media_stop(void) {
    furi_mutex_acquire(guard, FuriWaitForever);
    MediaService* svc = active;
    active = NULL;
    if(svc && svc->callback) {
        svc->connection = UINT16_MAX;
        svc->callback(BleMediaLink, &svc->connection, sizeof(svc->connection), svc->context);
        svc->callback = NULL;
    }
    furi_mutex_release(guard);
    if(svc) {
        ble_event_dispatcher_unregister_svc_handler(svc->handler);
        media_free(svc);
    }
}

bool ble_svc_media_listen(BleMediaEventCallback callback, void* context) {
    if(!guard || !callback) return false;
    furi_mutex_acquire(guard, FuriWaitForever);
    bool available = active && (!active->callback ||
                                (active->callback == callback && active->context == context));
    if(available && !active->callback) {
        active->callback = callback;
        active->context = context;
        callback(BleMediaLink, &active->connection, sizeof(active->connection), context);
    }
    furi_mutex_release(guard);
    return available;
}

void ble_svc_media_unlisten(void* context) {
    if(!guard) return;
    furi_mutex_acquire(guard, FuriWaitForever);
    if(active && active->context == context) {
        active->callback = NULL;
        active->context = NULL;
    }
    furi_mutex_release(guard);
}

bool ble_svc_media_send(void* context, uint8_t command, bool hid) {
    if(!guard || command < 1 || command > 3) return false;
    furi_mutex_acquire(guard, FuriWaitForever);
    bool sent = active && active->context == context && active->callback &&
                active->connection != UINT16_MAX &&
                (hid ?
                     music_hid_send(active->hid, command) :
                     !ble_gatt_characteristic_update(active->handle, &active->command, &command));
    furi_mutex_release(guard);
    return sent;
}
