#include "spotify_screen.h"
#include "setup_qr.h"
#include <stdio.h>

bool spotify_screen_shows_qr(const SpotifyScreen* screen) {
    return screen->manual_qr || (!screen->bridge && !screen->dismissed_qr);
}

static void draw_label(Canvas* canvas, const char* text, int y, uint32_t scroll) {
    int extra = (int)canvas_string_width(canvas, text) - 120;
    unsigned offset = 0;
    if(extra > 0) {
        unsigned phase = scroll % ((unsigned)extra + 34);
        if(phase > 16) offset = MIN(phase - 16, (unsigned)extra);
    }
    canvas_draw_str(canvas, 4 - (int)offset, y, text);
}

void spotify_screen_draw(Canvas* canvas, void* context) {
    const SpotifyScreen* screen = context;
    const SpotifyLibrary* lib = &screen->library;
    canvas_set_font(canvas, FontSecondary);
    if(spotify_screen_shows_qr(screen)) {
        canvas_draw_xbm(canvas, 0, 0, 64, 64, spotify_setup_qr);
        canvas_set_font(canvas, FontPrimary);
        canvas_draw_str(canvas, 66, 20, "Spotify");
        canvas_set_font(canvas, FontSecondary);
        canvas_draw_str(canvas, 66, 33, "Scan for setup");
        canvas_draw_str(canvas, 66, 57, "OK: Continue");
        return;
    }
    canvas_draw_str(
        canvas, 2, 8, screen->browsing ? spotify_category_names[screen->category] : "Spotify");
    if(lib->accepted) {
        canvas_set_font(canvas, FontPrimary);
        canvas_draw_str(canvas, 2, 28, "Play request sent");
        canvas_set_font(canvas, FontSecondary);
        draw_label(canvas, lib->rows[lib->selected], 42, screen->scroll);
        canvas_draw_str(canvas, 2, 62, "OK: Back to list");
    } else if(lib->error != SpotifyOk) {
        static const char* const errors[] = {
            [SpotifyNoPlayer] = "Open Spotify on a device.",
            [SpotifyLogin] = "Link Spotify in the browser.",
            [SpotifyOffline] = "Check the browser link.",
            [SpotifyRestricted] = "Check Spotify on your phone.",
            [SpotifyRateLimited] = "Spotify is busy. Try later.",
            [SpotifyInvalid] = "Could not read this page.",
        };
        canvas_draw_str(canvas, 2, 35, errors[lib->error]);
        canvas_draw_str(canvas, 2, 62, "OK: Refresh");
    } else if(!screen->connected || !screen->bridge) {
        canvas_draw_str(
            canvas,
            2,
            27,
            screen->connected ? "Open Spotify setup." : "Pair in Bluetooth settings.");
        canvas_draw_str(canvas, 2, 40, "Hold Up for the link.");
        canvas_draw_str(canvas, 2, 62, "OK: Retry");
    } else if(!screen->browsing) {
        for(size_t i = 0; i < SpotifyCategories; ++i) {
            int y = 12 + (int)i * 12;
            if(i == screen->category) {
                canvas_draw_rbox(canvas, 0, y, 128, 12, 2);
                canvas_set_color(canvas, ColorWhite);
            }
            canvas_draw_str(canvas, 4, y + 9, spotify_category_names[i]);
            canvas_set_color(canvas, ColorBlack);
        }
        canvas_draw_str(canvas, 2, 62, "OK: Open");
    } else if(lib->request || !lib->page) {
        canvas_draw_str(
            canvas,
            2,
            35,
            lib->op >= SpotifyPlay ? "Sending play request..." : "Loading library...");
    } else if(lib->page) {
        if(!lib->count) {
            canvas_draw_str(canvas, 2, 28, "Nothing saved here.");
            canvas_draw_str(canvas, 2, 41, "Check your Spotify library.");
        }
        for(size_t i = 0; i < lib->count; ++i) {
            int y = 10 + (int)i * 10;
            bool selected = i == lib->selected;
            if(selected) {
                canvas_draw_rbox(canvas, 0, y, 128, 10, 2);
                canvas_set_color(canvas, ColorWhite);
            }
            draw_label(canvas, lib->rows[i], y + 8, selected ? screen->scroll : 0);
            canvas_set_color(canvas, ColorBlack);
        }
        char page[28];
        snprintf(
            page,
            sizeof(page),
            "%sPage %lu%s",
            lib->previous ? "< " : "",
            (unsigned long)(lib->offset / SpotifyRows + 1),
            lib->next ? " >" : "");
        canvas_draw_str(canvas, 2, 62, page);
        canvas_draw_str(canvas, 82, 62, lib->count ? "OK: Play" : "OK: Retry");
    }
}
