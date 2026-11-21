#include "music_hid.h"
#include <furi.h>
#include <ble/ble.h>
#include <furi_ble/gatt.h>
#include <profiles/serial_profile.h>

// A media accessory appears in iPhone Bluetooth settings. Its single input report
// exposes the three transport controls and the two volume controls.
static const uint8_t report_map[] = {
    0x05, 0x0c, // Usage Page (Consumer)
    0x09, 0x01, // Usage (Consumer Control)
    0xa1, 0x01, // Collection (Application)
    0x85, 0x01, // Report ID (1)
    0x09, 0xb6, // Scan Previous Track
    0x09, 0xcd, // Play/Pause
    0x09, 0xb5, // Scan Next Track
    0x09, 0xe9, // Volume increment
    0x09, 0xea, // Volume decrement
    0x15, 0x00, 0x25, 0x01, // Logical range 0..1
    0x75, 0x01, 0x95, 0x05, 0x81, 0x02, // Five one-bit inputs
    0x75, 0x03, 0x95, 0x01, 0x81, 0x03, // Three padding bits
    0xc0,
};
static const uint8_t hid_info[] = {0x11, 0x01, 0, 0x02};
static const uint8_t released = 0;

static bool report_reference(const void* context, const uint8_t** data, uint16_t* length) {
    UNUSED(context);
    static const uint8_t ref[] = {1, 1}; // Report ID 1, input report
    *length = sizeof(ref);
    if(data) *data = ref;
    return false;
}

static BleGattCharacteristicDescriptorParams report_descriptor = {
    .uuid_type = UUID_TYPE_16,
    .uuid.Char_UUID_16 = REPORT_REFERENCE_DESCRIPTOR_UUID,
    .max_length = 2,
    .data_callback.fn = report_reference,
    .access_permissions = ATTR_ACCESS_READ_ONLY,
};
enum {
    HidMap,
    HidInfo,
    HidControl,
    HidInput,
    HidCount
};
static const BleGattCharacteristicParams characteristics[HidCount] = {
    [HidMap] =
        {.name = "Media report map",
         .data.fixed = {.ptr = report_map, .length = sizeof(report_map)},
         .uuid_type = UUID_TYPE_16,
         .uuid.Char_UUID_16 = REPORT_MAP_CHAR_UUID,
         .char_properties = CHAR_PROP_READ,
         .security_permissions = ATTR_PERMISSION_AUTHEN_READ},
    [HidInfo] =
        {.name = "HID information",
         .data.fixed = {.ptr = hid_info, .length = sizeof(hid_info)},
         .uuid_type = UUID_TYPE_16,
         .uuid.Char_UUID_16 = HID_INFORMATION_CHAR_UUID,
         .char_properties = CHAR_PROP_READ,
         .security_permissions = ATTR_PERMISSION_AUTHEN_READ},
    [HidControl] =
        {.name = "HID control point",
         .data.fixed.length = 1,
         .uuid_type = UUID_TYPE_16,
         .uuid.Char_UUID_16 = HID_CONTROL_POINT_CHAR_UUID,
         .char_properties = CHAR_PROP_WRITE_WITHOUT_RESP,
         .security_permissions = ATTR_PERMISSION_AUTHEN_WRITE},
    [HidInput] =
        {.name = "Media buttons",
         .data.fixed = {.ptr = &released, .length = 1},
         .uuid_type = UUID_TYPE_16,
         .uuid.Char_UUID_16 = REPORT_CHAR_UUID,
         .char_properties = CHAR_PROP_READ | CHAR_PROP_NOTIFY,
         .security_permissions = ATTR_PERMISSION_AUTHEN_READ,
         .descriptor_params = &report_descriptor},
};

struct MusicHid {
    uint16_t handle;
    BleGattCharacteristicInstance chars[HidCount];
};

void music_hid_stop(MusicHid* hid) {
    for(size_t i = 0; i < HidCount; i++) {
        if(hid->chars[i].characteristic)
            ble_gatt_characteristic_delete(hid->handle, &hid->chars[i]);
    }
    if(hid->handle) ble_gatt_service_delete(hid->handle);
    free(hid);
}

MusicHid* music_hid_start(void) {
    const Service_UUID_t uuid = {.Service_UUID_16 = HUMAN_INTERFACE_DEVICE_SERVICE_UUID};
    MusicHid* hid = malloc(sizeof(MusicHid));
    *hid = (MusicHid){0};
    if(ble_gatt_service_add(UUID_TYPE_16, &uuid, PRIMARY_SERVICE, 11, &hid->handle)) {
        for(size_t i = 0; i < HidCount; i++) {
            ble_gatt_characteristic_init(hid->handle, &characteristics[i], &hid->chars[i]);
            if(!hid->chars[i].handle || (i == HidInput && !hid->chars[i].descriptor_handle)) break;
            if(i != HidControl &&
               ble_gatt_characteristic_update(hid->handle, &hid->chars[i], NULL))
                break;
            if(i == HidInput) return hid;
        }
    }
    music_hid_stop(hid);
    return NULL;
}

bool music_hid_send(MusicHid* hid, uint8_t command) {
    if(command < BleMediaPrevious || command > BleMediaVolumeDown) return false;
    uint8_t pressed = 1U << (command - 1U);
    if(ble_gatt_characteristic_update(hid->handle, &hid->chars[HidInput], &pressed)) return false;
    return !ble_gatt_characteristic_update(hid->handle, &hid->chars[HidInput], &released);
}
