#pragma once
#include <stdbool.h>
#include <stdint.h>

typedef struct MusicHid MusicHid;

MusicHid* music_hid_start(void);
void music_hid_stop(MusicHid* hid);
bool music_hid_send(MusicHid* hid, uint8_t command);
