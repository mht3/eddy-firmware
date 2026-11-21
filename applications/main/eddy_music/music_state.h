#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>

typedef enum {
    MusicWaiting,
    MusicTrack,
    MusicIdle,
    MusicLogin,
    MusicOffline,
    MusicRestricted,
    MusicRateLimited,
} MusicState;

typedef struct {
    char title[96];
    char artist[96];
    bool playing;
    uint32_t elapsed;
    uint32_t duration;
} MusicTrackInfo;

typedef struct {
    MusicTrackInfo pending;
    size_t title_len;
    size_t artist_len;
    bool started;
} MusicFrame;

// Applies complete frames only. A partial or invalid transaction leaves the last display intact.
bool music_frame_receive(
    MusicFrame* frame,
    MusicTrackInfo* track,
    MusicState* state,
    const uint8_t* data,
    size_t size);
