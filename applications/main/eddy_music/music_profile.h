#pragma once
#include <furi_hal_bt.h>
#include "ams_client.h"

typedef struct {
    // A NULL packet clears all state from the previous connection.
    void (*receive)(const uint8_t* data, size_t size, void* context);
    void* context;
    AmsClient* ams;
} MusicProfileParams;

extern const FuriHalBleProfileTemplate music_profile;
bool music_profile_command(FuriHalBleProfileBase* profile, uint8_t command);
bool music_profile_media(FuriHalBleProfileBase* profile, uint8_t command);
