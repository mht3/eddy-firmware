#pragma once

#include <furi_ble/profile_interface.h>

#include <services/serial_service.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BLE_PROFILE_SERIAL_PACKET_SIZE_MAX BLE_SVC_SERIAL_DATA_LEN_MAX

typedef enum {
    FuriHalBtSerialRpcStatusNotActive,
    FuriHalBtSerialRpcStatusActive,
} FuriHalBtSerialRpcStatus;

/** Serial service callback type */
typedef SerialServiceEventCallback FuriHalBtSerialCallback;

/** Shared music accessory on the normal, bonded Flipper connection.
 * A listener receives the current uint16_t handle (UINT16_MAX when disconnected),
 * controller events for AMS, and authenticated playback frames.
 * The callback must not call these functions. Unlisten before freeing its context.
 */
typedef enum {
    BleMediaLink,
    BleMediaRadio,
    BleMediaFrame,
} BleMediaEvent;
typedef void (
    *BleMediaEventCallback)(BleMediaEvent event, const void* data, size_t size, void* context);

// These values are shared with the optional browser bridge. HID uses the
// corresponding bits in its single consumer-control input report.
typedef enum {
    BleMediaPrevious = 1,
    BleMediaPlayPause,
    BleMediaNext,
    BleMediaVolumeUp,
    BleMediaVolumeDown,
} BleMediaCommand;

bool ble_svc_media_listen(BleMediaEventCallback callback, void* context);
void ble_svc_media_unlisten(void* context);
bool ble_svc_media_send(void* context, uint8_t command, bool hid);

/** Request a Spotify library page or track on the active bridge. */
bool ble_svc_media_library_request(
    void* context,
    uint16_t connection,
    uint8_t op,
    uint16_t request,
    uint16_t page);

/** Serial profile descriptor */
extern const FuriHalBleProfileTemplate* const ble_profile_serial;

/** Send data through BLE
 *
 * @param profile       Profile instance
 * @param data          data buffer
 * @param size          data buffer size
 *
 * @return      true on success
 */
bool ble_profile_serial_tx(FuriHalBleProfileBase* profile, uint8_t* data, uint16_t size);

/** Set BLE RPC status
 *
 * @param profile       Profile instance
 * @param active        true if RPC is active
 */
void ble_profile_serial_set_rpc_active(FuriHalBleProfileBase* profile, bool active);

/** Notify that application buffer is empty
 * @param profile       Profile instance
 */
void ble_profile_serial_notify_buffer_is_empty(FuriHalBleProfileBase* profile);

/** Set Serial service events callback
 *
 * @param profile       Profile instance
 * @param buffer_size   Applicaition buffer size
 * @param calback       FuriHalBtSerialCallback instance
 * @param context       pointer to context
 */
void ble_profile_serial_set_event_callback(
    FuriHalBleProfileBase* profile,
    uint16_t buff_size,
    FuriHalBtSerialCallback callback,
    void* context);

#ifdef __cplusplus
}
#endif
