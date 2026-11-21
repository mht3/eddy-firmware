#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct AmsClient AmsClient;
typedef void (*AmsReceive)(const uint8_t* packet, size_t size, void* context);

AmsClient* ams_client_alloc(void);
void ams_client_free(AmsClient* client);
// Forward from the music profile's event handler. This never claims a GAP event.
void ams_client_event(AmsClient* client, const void* event);
// Call on the app thread. connected means an authenticated link is available.
void ams_client_tick(AmsClient* client, bool connected, AmsReceive receive, void* context);
bool ams_client_send(AmsClient* client, uint8_t command);
