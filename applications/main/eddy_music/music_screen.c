#include "music_screen.h"
#include "setup_qr.h"
#include <stdio.h>

static void draw_setup(Canvas* canvas) {
    // Two display pixels per QR module, with no graphics touching the symbol.
    for(size_t y = 0; y < MUSIC_QR_SIZE; ++y) {
        for(size_t x = 0; x < MUSIC_QR_SIZE; ++x) {
            if(music_qr[y * ((MUSIC_QR_SIZE + 7) / 8) + x / 8] & (1 << (x % 8)))
                canvas_draw_box(canvas, 8 + x * 2, 11 + y * 2, 2, 2);
        }
    }
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str(canvas, 60, 16, "Spotify");
    canvas_set_font(canvas, FontSecondary);
    canvas_draw_str(canvas, 60, 30, "Scan to open");
    canvas_draw_str(canvas, 60, 40, "Spotify.");
    canvas_draw_str(canvas, 60, 59, "OK: Continue");
}

static void draw_marquee(Canvas* canvas, int y, const char* text, uint32_t phase) {
    uint16_t width = canvas_string_width(canvas, text);
    uint32_t offset = 0;
    if(width > 124) {
        uint32_t overflow = width - 124;
        uint32_t step = phase % (overflow + 32);
        if(step > 16) offset = step - 16 < overflow ? step - 16 : overflow;
    }
    canvas_draw_str(canvas, 2 - (int)offset, y, text);
}

static void format_time(char* out, size_t size, uint32_t ms) {
    uint32_t seconds = ms / 1000;
    if(seconds < 3600) {
        snprintf(
            out, size, "%lu:%02lu", (unsigned long)(seconds / 60), (unsigned long)(seconds % 60));
    } else {
        snprintf(
            out,
            size,
            "%lu:%02lu:%02lu",
            (unsigned long)(seconds / 3600),
            (unsigned long)(seconds / 60 % 60),
            (unsigned long)(seconds % 60));
    }
}

static const char* feedback_text(MusicFeedback feedback, const char* fallback) {
    switch(feedback) {
    case MusicFeedbackFailed:
        return "Try again";
    case MusicFeedbackLouder:
        return "Vol +";
    case MusicFeedbackQuieter:
        return "Vol -";
    default:
        return fallback;
    }
}

static void draw_track(Canvas* canvas, const MusicScreen* model) {
    canvas_set_font(canvas, FontSecondary);
    const char* source = model->iphone ? "iPhone" : "Spotify";
    canvas_draw_str(canvas, 2, 8, source);
    const char* status =
        feedback_text(model->feedback, model->track.playing ? "Playing" : "Paused");
    canvas_draw_str(canvas, 88 - canvas_string_width(canvas, status), 8, status);
    canvas_set_font(canvas, FontPrimary);
    draw_marquee(canvas, 22, model->track.title, model->scroll);
    canvas_set_font(canvas, FontSecondary);
    draw_marquee(canvas, 32, model->track.artist, model->scroll);
    canvas_draw_frame(canvas, 2, 36, 124, 4);
    if(model->track.duration) {
        uint32_t filled = (uint64_t)122 * model->position / model->track.duration;
        if(filled) canvas_draw_box(canvas, 3, 37, filled, 2);
    }
    char elapsed[16], total[16];
    format_time(elapsed, sizeof(elapsed), model->position);
    canvas_draw_str(canvas, 2, 49, elapsed);
    if(model->track.duration) {
        format_time(total, sizeof(total), model->track.duration);
        canvas_draw_str(canvas, 126 - canvas_string_width(canvas, total), 49, total);
    }
    canvas_draw_str(
        canvas, 2, 61, !model->iphone && model->position >= 3000 ? "< Start" : "< Prev");
    canvas_draw_str(canvas, 99, 61, "Next >");
    const char* action = model->track.playing ? "Pause" : "Play";
    canvas_draw_rbox(canvas, 43, 51, 42, 13, 5);
    canvas_set_color(canvas, ColorWhite);
    canvas_draw_str(canvas, 64 - canvas_string_width(canvas, action) / 2, 61, action);
    canvas_set_color(canvas, ColorBlack);
}

void music_screen_draw(Canvas* canvas, void* context) {
    const MusicScreen* model = context;
    if(model->setup) {
        draw_setup(canvas);
        return;
    }
    if(model->connected && model->state == MusicTrack) {
        draw_track(canvas, model);
        return;
    }
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str(canvas, 2, 12, "Spotify");
    canvas_set_font(canvas, FontSecondary);
    if(model->available && model->connected && model->state == MusicWaiting) {
        canvas_draw_str(canvas, 2, 29, "Media controls");
        canvas_draw_str(
            canvas, 2, 41, feedback_text(model->feedback, "Play music on your phone."));
        canvas_draw_str(canvas, 2, 61, "< Prev");
        canvas_draw_rbox(canvas, 39, 51, 50, 13, 5);
        canvas_set_color(canvas, ColorWhite);
        canvas_draw_str(canvas, 43, 61, "Play/Pause");
        canvas_set_color(canvas, ColorBlack);
        canvas_draw_str(canvas, 99, 61, "Next >");
        return;
    }
    const char* line = model->linked ? "Waiting for your phone" : "Pair your Flipper";
    const char* hint = model->linked ? "Keep Bluetooth turned on." : "in phone Bluetooth.";
    if(!model->available) {
        line = "Bluetooth unavailable";
        hint = "Open Settings > Bluetooth.";
    } else if(model->connected) {
        switch(model->state) {
        case MusicIdle:
            line = "Nothing playing";
            hint = feedback_text(
                model->feedback,
                model->iphone ? "OK: resume on iPhone" : "Start a song on your phone.");
            break;
        case MusicLogin:
            line = "Open Spotify on your phone";
            hint = "Sign in and play a song.";
            break;
        case MusicOffline:
            line = "Waiting for your phone";
            hint = "Reopen the Spotify link.";
            break;
        case MusicRestricted:
            line = "Control unavailable";
            hint = "Check playback on the phone.";
            break;
        case MusicRateLimited:
            line = "Waiting for Spotify";
            hint = "Playback will sync again.";
            break;
        default:
            break;
        }
    }
    canvas_draw_str(canvas, 2, 31, line);
    canvas_draw_str(canvas, 2, 43, hint);
    canvas_draw_str(canvas, 2, 61, model->available ? "Hold Up: setup QR" : "Back to Apps");
}
