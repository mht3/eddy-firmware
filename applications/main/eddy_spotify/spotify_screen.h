#pragma once
#include <gui/canvas.h>
#include "spotify_library.h"

enum {
    SpotifyQrSize = 64,
    SpotifyQrBytes = SpotifyQrSize * SpotifyQrSize / 8
};

typedef enum {
    SpotifyHome,
    SpotifyFindKind,
    SpotifyPlayer,
    SpotifyResults,
    SpotifyActions,
    SpotifyDestinations,
    SpotifyLyricsHelp,
} SpotifyScene;

typedef struct {
    SpotifyLibrary library;
    const uint8_t* setup_qr;
    uint32_t scroll;
    uint8_t category;
    SpotifyScene scene;
    char now_playing[SpotifyLabelBytes + 1];
    uint8_t play_state;
    uint8_t title_bytes;
    uint32_t duration_s;
    uint32_t elapsed_s;
    uint8_t action;
    bool child_tracks;
    bool find_artist;
    bool connected;
    bool bridge;
    bool manual_qr;
    bool dismissed_qr;
} SpotifyScreen;

uint8_t spotify_action_count(const SpotifyScreen* screen);
bool spotify_screen_shows_qr(const SpotifyScreen* screen);
void spotify_screen_draw(Canvas* canvas, void* context);
