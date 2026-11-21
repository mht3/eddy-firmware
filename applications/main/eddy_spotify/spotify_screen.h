#pragma once
#include <gui/canvas.h>
#include "spotify_library.h"

typedef struct {
    SpotifyLibrary library;
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
