#pragma once
#include "music_state.h"
#include <gui/canvas.h>

typedef enum {
    MusicFeedbackNone,
    MusicFeedbackFailed,
    MusicFeedbackLouder,
    MusicFeedbackQuieter,
} MusicFeedback;

typedef struct {
    MusicState state;
    MusicTrackInfo track;
    bool available;
    bool connected;
    bool iphone;
    bool setup;
    bool linked;
    MusicFeedback feedback;
    uint32_t position;
    uint32_t scroll;
} MusicScreen;

void music_screen_draw(Canvas* canvas, void* model);
