#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct AmsClient AmsClient;
typedef void (*AmsReceive)(const uint8_t* packet, size_t size, void* context);

AmsClient* ams_client_alloc(void);
// Release remote subscriptions before detaching from a shared live connection.
void ams_client_close(AmsClient* client);
void ams_client_free(AmsClient* client);
// Seed the current shared link when opening the app on an already-connected phone.
void ams_client_set_link(AmsClient* client, uint16_t handle);
// Forward GATT events from the shared media service.
void ams_client_event(AmsClient* client, const void* event);
// Call on the app thread. connected means an authenticated link is available.
void ams_client_tick(AmsClient* client, bool connected, AmsReceive receive, void* context);
bool ams_client_supports_volume(AmsClient* client, bool up);
bool ams_client_send(AmsClient* client, uint8_t command);
