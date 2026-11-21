#pragma once

#include <infrared.h>
#include <input/input.h>
#include <storage/storage.h>

bool infrared_tv_preset_save(Storage* storage, size_t index, FuriString* target);

typedef struct {
    const char* model;
    const char* title;
    InfraredProtocol protocol;
    uint16_t address;
    uint16_t commands[6];
    const char* const* labels;
} TvPreset;

// Each row of the pad pairs related controls. The Roku remote uses navigation
// commands in place of tuner controls (32S327 has no dedicated channel keys).
static const char* const tv_labels[] = {"Power", "Mute", "Vol -", "Vol +", "CH -", "CH +"};
static const char* const roku_labels[] = {"Power", "Home", "Vol -", "Vol +", "Exit", "D-pad"};

static const TvPreset presets[] = {
    // Samsung TV profile from the fork's original Samsung.ir.
    {"Samsung TV",
     "Samsung TV",
     InfraredProtocolSamsung32,
     0x07,
     {0x02, 0x0F, 0x0B, 0x07, 0x10, 0x12},
     tv_labels},
    // LG's TV IR Codes reference (KROWM000086145), NEC address 04.
    {"LG TV", "LG TV", InfraredProtocolNEC, 0x04, {0x08, 0x09, 0x03, 0x02, 0x01, 0x00}, tv_labels},
    // TCL LED49D2930 with RC3000E02, from resources/infrared/assets/tv.ir.
    {"TCL (RC3000E02)",
     "TCL TV",
     InfraredProtocolRCA,
     0x0F,
     {0x54, 0xFC, 0x74, 0xF4, 0x34, 0xB4},
     tv_labels},
    // Flipper-IRDB, TVs/TCL/TCL_32S327.ir. NECext file fields are little-endian.
    {"TCL Roku (32S327)",
     "TCL Roku TV",
     InfraredProtocolNECext,
     0xC7EA,
     {0xE817, 0xFC03, 0xEF10, 0xF00F, 0x9966, 0 /* opens D-pad */},
     roku_labels},
};

static const struct {
    InputKey key;
    const char* label;
    uint8_t x, y;
    uint16_t command;
} roku_keys[] = {
    {InputKeyUp, "Up", 64, 18, 0xE619},
    {InputKeyLeft, "Left", 35, 32, 0xE11E},
    {InputKeyOk, "OK", 64, 32, 0xD52A},
    {InputKeyRight, "Right", 93, 32, 0xD22D},
    {InputKeyDown, "Down", 64, 46, 0xCC33},
};
