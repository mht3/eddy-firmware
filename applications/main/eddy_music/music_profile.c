#include "music_profile.h"
#include "music_hid.h"
#include <services/battery_service.h>
#include <services/dev_info_service.h>
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
    FuriHalBleProfileBase base;
    uint16_t handle;
    BleGattCharacteristicInstance state;
    BleGattCharacteristicInstance command;
    GapSvcEventHandler* handler;
    MusicProfileParams params;
    MusicHid* hid;
    BleServiceBattery* battery;
    BleServiceDevInfo* device;
} MusicProfile;

static BleEventAckStatus music_event(void* event, void* context) {
    MusicProfile* profile = context;
    ams_client_event(profile->params.ams, event);
    const hci_event_pckt* packet = (const void*)((const hci_uart_pckt*)event)->data;
    if(packet->evt == HCI_DISCONNECTION_COMPLETE_EVT_CODE) {
        profile->params.receive(NULL, 0, profile->params.context);
        return BleEventNotAck; // GAP owns disconnect and resuming advertisements.
    }
    if(packet->evt != HCI_VENDOR_SPECIFIC_DEBUG_EVT_CODE) return BleEventNotAck;
    const evt_blecore_aci* aci = (const void*)packet->data;
    if(aci->ecode != ACI_GATT_ATTRIBUTE_MODIFIED_VSEVT_CODE) return BleEventNotAck;
    const aci_gatt_attribute_modified_event_rp0* write = (const void*)aci->data;
    if(write->Attr_Handle != profile->state.handle + 1) return BleEventNotAck;
    if(write->Offset == 0 && write->Attr_Data_Length && write->Attr_Data_Length <= 20)
        profile->params.receive(
            write->Attr_Data, write->Attr_Data_Length, profile->params.context);
    return BleEventAckFlowEnable;
}

static void music_stop(FuriHalBleProfileBase* base) {
    MusicProfile* profile = (MusicProfile*)base;
    if(profile->handler) ble_event_dispatcher_unregister_svc_handler(profile->handler);
    if(profile->state.characteristic)
        ble_gatt_characteristic_delete(profile->handle, &profile->state);
    if(profile->command.characteristic)
        ble_gatt_characteristic_delete(profile->handle, &profile->command);
    if(profile->hid) music_hid_stop(profile->hid);
    if(profile->device) ble_svc_dev_info_stop(profile->device);
    if(profile->battery) ble_svc_battery_stop(profile->battery);
    if(profile->handle) ble_gatt_service_delete(profile->handle);
    free(profile);
}

static FuriHalBleProfileBase* music_start(FuriHalBleProfileParams params) {
    MusicProfile* profile = malloc(sizeof(MusicProfile));
    *profile =
        (MusicProfile){.base.config = &music_profile, .params = *(MusicProfileParams*)params};
    if(ble_gatt_service_add(UUID_TYPE_128, &service_uuid, PRIMARY_SERVICE, 6, &profile->handle)) {
        ble_gatt_characteristic_init(profile->handle, &state_char, &profile->state);
        ble_gatt_characteristic_init(profile->handle, &command_char, &profile->command);
        profile->hid = music_hid_start();
        profile->battery = ble_svc_battery_start(true);
        profile->device = ble_svc_dev_info_start();
        if(profile->state.handle && profile->command.handle && profile->hid && profile->battery &&
           profile->device) {
            profile->handler = ble_event_dispatcher_register_svc_handler(music_event, profile);
            return &profile->base;
        }
    }
    music_stop(&profile->base);
    return NULL;
}

static void music_config(GapConfig* config, FuriHalBleProfileParams params) {
    UNUSED(params);
    *config = (GapConfig){
        .adv_service = {.UUID_Type = UUID_TYPE_128, .Service_UUID_128 = MUSIC_UUID(1)},
        .solicit_apple_media = true,
        .appearance_char = 0x0180, // Generic remote control
        .bonding_mode = true,
        .pairing_method = GapPairingPinCodeVerifyYesNo,
        .conn_param = {.conn_int_min = 24, .conn_int_max = 40},
        .adv_name = "\x09"
                    "Eddy Music",
    };
    memcpy(config->mac_address, furi_hal_version_get_ble_mac(), sizeof(config->mac_address));
    config->mac_address[0] ^= 0x4d;
    config->mac_address[1] ^= 0xed;
}

const FuriHalBleProfileTemplate music_profile = {
    .start = music_start,
    .stop = music_stop,
    .get_gap_config = music_config,
};

bool music_profile_command(FuriHalBleProfileBase* base, uint8_t command) {
    MusicProfile* profile = (MusicProfile*)base;
    // The characteristic update wrapper returns nonzero on error.
    return !ble_gatt_characteristic_update(profile->handle, &profile->command, &command);
}

bool music_profile_media(FuriHalBleProfileBase* base, uint8_t command) {
    return music_hid_send(((MusicProfile*)base)->hid, command);
}
