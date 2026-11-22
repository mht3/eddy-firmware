#pragma once
#include <gui/canvas.h>
#include "spotify_library.h"

enum {
    SpotifyQrSize = 64,
    SpotifyQrBytes = SpotifyQrSize * SpotifyQrSize / 8
};

typedef enum {
    SpotifyHome,
    SpotifyPlayer,
    SpotifyResults,
    SpotifyActions,
    SpotifyDestinations,
    SpotifyLyricsHelp,
    SpotifyVolume,
    SpotifyPresets,
    SpotifyPresetManage,
    SpotifyPresetDirection,
    SpotifyPresetPick,
} SpotifyScene;

typedef struct {
    SpotifyLibrary library;
    uint32_t scroll;
    uint8_t category;
    SpotifyScene scene;
    char now_playing[SpotifyLabelBytes + 1];
    uint8_t play_state;
    uint8_t volume;
    bool volume_pending;
    uint8_t volume_target;
    uint8_t preset_direction;
    uint8_t preset_option;
    char preset_labels[SpotifyRows][SpotifyLabelBytes + 1];
    bool presets_loaded;
    bool toolbar_focus;
    uint8_t tool;
    uint8_t title_bytes;
    uint32_t duration_s;
    uint32_t elapsed_s;
    uint8_t action;
    bool child_tracks;
    bool connected;
    bool bridge;
    bool manual_qr;
    bool dismissed_qr;
} SpotifyScreen;

uint8_t spotify_action_count(const SpotifyScreen* screen);
bool spotify_screen_shows_qr(const SpotifyScreen* screen);
void spotify_screen_draw(Canvas* canvas, void* context);
