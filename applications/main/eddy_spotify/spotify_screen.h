#pragma once
#include <gui/canvas.h>
#include "spotify_library.h"

enum {
    SpotifyQrSize = 64,
    SpotifyQrBytes = SpotifyQrSize * SpotifyQrSize / 8
};

typedef struct {
    SpotifyLibrary library;
    const uint8_t* setup_qr;
    uint32_t scroll;
    uint8_t category;
    bool browsing;
    bool connected;
    bool bridge;
    bool manual_qr;
    bool dismissed_qr;
} SpotifyScreen;

bool spotify_screen_shows_qr(const SpotifyScreen* screen);
void spotify_screen_draw(Canvas* canvas, void* context);
