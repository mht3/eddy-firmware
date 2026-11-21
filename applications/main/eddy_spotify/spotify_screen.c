#include "spotify_screen.h"
#include "setup_qr.h"
#include <stdio.h>
#include <string.h>

_Static_assert(sizeof(spotify_setup_qr) == SpotifyQrBytes, "Invalid built-in QR bitmap");

bool spotify_screen_shows_qr(const SpotifyScreen* screen) {
    return screen->manual_qr || (!screen->bridge && !screen->dismissed_qr);
}

static void
    draw_text_width(Canvas* canvas, int x, int width, const char* text, int y, uint32_t scroll) {
    int extra = (int)canvas_string_width(canvas, text) - width;
    unsigned offset = 0;
    if(extra > 0) {
        unsigned phase = scroll % ((unsigned)extra + 34);
        if(phase > 16) offset = MIN(phase - 16, (unsigned)extra);
    }
    canvas_draw_str(canvas, x - (int)offset, y, text);
}

static void draw_text(Canvas* canvas, int x, const char* text, int y, uint32_t scroll) {
    draw_text_width(canvas, x, 126 - x, text, y, scroll);
}

static void draw_label(Canvas* canvas, const char* text, int y, uint32_t scroll) {
    draw_text(canvas, 4, text, y, scroll);
}

// List icons are redrawn after labels so long names may scroll without covering them.
static void row_icon(Canvas* c, uint8_t op, int y) {
    if(op == SpotifyPlaylists || op == SpotifyChoosePlaylist) {
        for(int i = 0; i < 3; ++i)
            canvas_draw_line(c, 3, y + 2 * i, 10 - i, y + 2 * i);
        canvas_draw_box(c, 10, y + 4, 2, 2);
    } else if(op == SpotifyAlbums) {
        canvas_draw_frame(c, 3, y - 1, 8, 8);
        canvas_draw_frame(c, 5, y + 1, 4, 4);
    } else if(op == SpotifySearchArtists || op == SpotifySearchTracks) {
        canvas_draw_circle(c, 6, y + 2, 3);
        canvas_draw_line(c, 8, y + 4, 11, y + 7);
    } else if(op == SpotifyViewQueue) {
        for(int i = 0; i < 3; ++i) {
            canvas_draw_dot(c, 3, y + 2 * i);
            canvas_draw_line(c, 5, y + 2 * i, 11, y + 2 * i);
        }
    } else if(op == SpotifyNowPlaying) {
        for(int i = 0; i < 4; ++i)
            canvas_draw_line(c, 4 + i, y + i, 4 + i, y + 6 - i);
    } else {
        canvas_draw_line(c, 4, y, 7, y + 3);
        canvas_draw_line(c, 7, y + 3, 10, y);
        canvas_draw_line(c, 3, y + 2, 7, y + 6);
        canvas_draw_line(c, 7, y + 6, 11, y + 2);
    }
}

static void playlist_cover(Canvas* c, const char* name, int y) {
    uint16_t hash = 5381;
    for(const unsigned char* p = (const unsigned char*)name; *p; ++p)
        hash = hash * 33 + *p;
    canvas_draw_frame(c, 3, y, 9, 9);
    static const uint8_t tiles[8][5] = {
        {4, 14, 31, 14, 4},
        {17, 10, 4, 10, 17},
        {0, 27, 31, 14, 4},
        {4, 12, 31, 12, 4},
        {4, 10, 17, 31, 0},
        {8, 15, 9, 27, 18},
        {1, 3, 7, 15, 31},
        {0, 21, 10, 21, 0},
    };
    const uint8_t* tile = tiles[hash % 8];
    for(int row = 0; row < 5; ++row)
        for(int col = 0; col < 5; ++col)
            if(tile[row] & (1 << col)) canvas_draw_dot(c, 5 + col, y + 2 + row);
}

static void highlight(Canvas* c, int y, int height, bool selected) {
    if(selected) {
        canvas_draw_rbox(c, 0, y, 128, height, 2);
        canvas_set_color(c, ColorWhite);
    }
}

static void now_bar(Canvas* canvas, const SpotifyScreen* screen) {
    canvas_draw_box(canvas, 0, 51, 128, 13);
    canvas_set_color(canvas, ColorWhite);
    // Scroll the title, reserving the first 13 pixels for playback state.
    draw_text(
        canvas,
        15,
        screen->now_playing[0] ? screen->now_playing : "Nothing playing",
        61,
        screen->scroll);
    canvas_set_color(canvas, ColorBlack);
    canvas_draw_box(canvas, 0, 52, 13, 12);
    canvas_set_color(canvas, ColorWhite);
    if(screen->play_state == 1) {
        for(int i = 0; i < 4; ++i)
            canvas_draw_line(canvas, 4 + i, 54 + i, 4 + i, 61 - i);
    } else if(screen->play_state == 2) {
        canvas_draw_box(canvas, 4, 55, 2, 6);
        canvas_draw_box(canvas, 8, 55, 2, 6);
    } else {
        canvas_draw_frame(canvas, 4, 55, 6, 6);
    }
    canvas_set_color(canvas, ColorBlack);
}

static void draw_player(Canvas* canvas, const SpotifyScreen* screen) {
    char title[sizeof(screen->now_playing)];
    strlcpy(title, screen->now_playing, sizeof(title));
    const char* artist = NULL;
    size_t split = screen->title_bytes;
    if(split > 0 && split + 3 < strlen(title) && !strncmp(title + split, " - ", 3)) {
        title[split] = 0;
        artist = screen->now_playing + split + 3;
    }
    canvas_set_font(canvas, FontPrimary);
    draw_label(canvas, title[0] ? title : "Nothing playing", 21, screen->scroll);
    canvas_set_font(canvas, FontSecondary);
    if(artist) draw_label(canvas, artist, 31, screen->scroll);
    if(screen->duration_s) {
        uint32_t total = screen->duration_s, elapsed = screen->elapsed_s;
        canvas_draw_frame(canvas, 3, 34, 122, 4);
        unsigned width = (uint64_t)elapsed * 120 / total;
        if(width) canvas_draw_box(canvas, 4, 35, width, 2);
        char t[16];
        snprintf(
            t,
            sizeof(t),
            "%lu:%02lu",
            (unsigned long)(elapsed / 60),
            (unsigned long)(elapsed % 60));
        canvas_draw_str(canvas, 3, 47, t);
        snprintf(
            t, sizeof(t), "%lu:%02lu", (unsigned long)(total / 60), (unsigned long)(total % 60));
        canvas_draw_str(canvas, 125 - canvas_string_width(canvas, t), 47, t);
    }
    canvas_draw_str(canvas, 45, 47, "Down: Lyrics");
    canvas_draw_box(canvas, 0, 51, 128, 13);
    canvas_set_color(canvas, ColorWhite);
    canvas_draw_str(canvas, 3, 61, "< Prev");
    const char* toggle = screen->play_state == 1 ? "OK: Pause" : "OK: Play";
    canvas_draw_str(canvas, 64 - canvas_string_width(canvas, toggle) / 2, 61, toggle);
    canvas_draw_str(canvas, 100, 61, "Next >");
    canvas_set_color(canvas, ColorBlack);
}

uint8_t spotify_action_count(const SpotifyScreen* screen) {
    uint8_t op = spotify_category_ops[screen->category];
    if(!screen->child_tracks && (op == SpotifyPlaylists || op == SpotifyAlbums ||
                                 (op == SpotifySearchTracks && screen->find_artist)))
        return 2;
    return 3;
}

void spotify_screen_draw(Canvas* canvas, void* context) {
    const SpotifyScreen* screen = context;
    const SpotifyLibrary* lib = &screen->library;
    canvas_set_font(canvas, FontSecondary);
    if(spotify_screen_shows_qr(screen)) {
        canvas_draw_xbm(
            canvas,
            0,
            0,
            SpotifyQrSize,
            SpotifyQrSize,
            screen->setup_qr ? screen->setup_qr : spotify_setup_qr);
        canvas_set_font(canvas, FontPrimary);
        canvas_draw_str(canvas, 66, 20, "Spotify");
        canvas_set_font(canvas, FontSecondary);
        canvas_draw_str(canvas, 66, 33, "Scan to link");
        canvas_draw_str(canvas, 66, 44, "in browser");
        canvas_draw_str(canvas, 66, 60, "OK: Continue");
        return;
    }
    uint8_t category = spotify_category_ops[screen->category];
    const char* title = spotify_category_names[screen->category];
    if(screen->child_tracks)
        title = category == SpotifyPlaylists ? "Playlist tracks" :
                category == SpotifyAlbums    ? "Album tracks" :
                                               "Artist tracks";
    if(screen->scene == SpotifyDestinations) title = "Add to playlist";
    if(screen->scene == SpotifyActions && lib->count) {
        draw_text_width(canvas, 2, 89, lib->rows[lib->selected], 8, screen->scroll);
        canvas_set_color(canvas, ColorWhite);
        canvas_draw_box(canvas, 92, 0, 36, 10);
        canvas_set_color(canvas, ColorBlack);
    } else
        canvas_draw_str(canvas, 2, 8, screen->scene == SpotifyHome ? "Spotify" : title);
    if(!screen->connected || !screen->bridge) {
        canvas_draw_str(
            canvas,
            2,
            27,
            screen->connected ? "Open Spotify setup." : "Pair in Bluetooth settings.");
        canvas_draw_str(canvas, 2, 40, "Hold Up for the link.");
        canvas_draw_str(canvas, 2, 62, "OK: Retry");
        return;
    }
    if(lib->accepted) {
        uint8_t action = lib->op & 0xfc;
        canvas_set_font(canvas, FontPrimary);
        canvas_draw_str(
            canvas,
            2,
            24,
            action == SpotifyQueue         ? "Added to queue" :
            action == SpotifyAddToPlaylist ? "Added to playlist" :
                                             "Playback requested");
        canvas_set_font(canvas, FontSecondary);
        draw_label(canvas, lib->rows[lib->selected], 36, screen->scroll);
        canvas_draw_str(canvas, 2, 47, "OK: Back to list");
    } else if(lib->error != SpotifyOk && screen->scene != SpotifyHome) {
        static const char* const errors[] = {
            [SpotifyNoPlayer] = "Open Spotify on a device.",
            [SpotifyLogin] = "Link Spotify in the browser.",
            [SpotifyOffline] = "Check the browser link.",
            [SpotifyRestricted] = "Spotify declined access.",
            [SpotifyRateLimited] = "Spotify is busy. Try later.",
            [SpotifyInvalid] = "Could not read this page.",
        };
        if(spotify_library_action_unconfirmed(lib)) {
            canvas_draw_str(canvas, 2, 24, "Result not confirmed.");
            canvas_draw_str(canvas, 2, 36, "Check your Spotify app.");
            canvas_draw_str(canvas, 2, 47, "OK: Return");
        } else {
            canvas_draw_str(canvas, 2, 24, errors[lib->error]);
            canvas_draw_str(canvas, 2, 36, "See details in your browser.");
            canvas_draw_str(canvas, 2, 47, "OK: Retry    Back: Return");
        }
    } else if(screen->scene == SpotifyHome) {
        size_t first = screen->category > 2 ? screen->category - 2 : 0;
        for(size_t i = first; i < first + 3; ++i) {
            int y = 11 + (i - first) * 13;
            highlight(canvas, y, 12, i == screen->category);
            row_icon(canvas, spotify_category_ops[i], y + 3);
            canvas_draw_str(canvas, 16, y + 9, spotify_category_names[i]);
            canvas_set_color(canvas, ColorBlack);
        }
        char position[8];
        snprintf(position, sizeof(position), "%u/%u", screen->category + 1, SpotifyCategories);
        canvas_draw_str(canvas, 73, 8, position);
    } else if(screen->scene == SpotifyFindKind) {
        for(size_t i = 0; i < 2; ++i) {
            int y = 13 + 16 * i;
            highlight(canvas, y, 15, (bool)i == screen->find_artist);
            canvas_draw_str(canvas, 6, y + 11, i ? "Artists" : "Tracks");
            canvas_set_color(canvas, ColorBlack);
        }
    } else if(screen->scene == SpotifyLyricsHelp) {
        canvas_draw_str(canvas, 2, 24, "Open Now Playing in Spotify");
        canvas_draw_str(canvas, 2, 36, "on your phone to view lyrics.");
        canvas_draw_str(canvas, 2, 47, "OK: Back");
    } else if(screen->scene == SpotifyPlayer) {
        draw_player(canvas, screen);
        return;
    } else if(lib->request || !lib->page) {
        canvas_draw_str(canvas, 2, 32, "Contacting Spotify...");
    } else if(screen->scene == SpotifyActions) {
        bool collection = spotify_action_count(screen) == 2;
        const char* const actions[] = {
            collection ? "Browse tracks" : "Play now",
            collection ? (category == SpotifyPlaylists ? "Play playlist" :
                          category == SpotifyAlbums    ? "Play album" :
                                                         "Play artist") :
                         "Add to queue",
            "Add to playlist"};
        for(size_t i = 0; i < spotify_action_count(screen); ++i) {
            int y = 11 + i * 13;
            highlight(canvas, y, 12, i == screen->action);
            canvas_draw_str(canvas, 6, y + 9, actions[i]);
            canvas_set_color(canvas, ColorBlack);
        }
    } else {
        if(!lib->count) {
            canvas_draw_str(
                canvas,
                2,
                30,
                screen->scene == SpotifyDestinations ? "No owned playlists found." :
                                                       "No results here.");
        }
        bool icons = screen->scene == SpotifyDestinations ||
                     (category == SpotifyPlaylists && !screen->child_tracks);
        for(size_t i = 0; i < lib->count; ++i) {
            int y = 10 + (int)i * 10;
            bool selected = i == lib->selected;
            highlight(canvas, y, 10, selected);
            if(icons) {
                draw_text(canvas, 16, lib->rows[i], y + 8, selected ? screen->scroll : 0);
                canvas_set_color(canvas, selected ? ColorBlack : ColorWhite);
                canvas_draw_box(canvas, 0, y, 15, 10);
                canvas_set_color(canvas, selected ? ColorWhite : ColorBlack);
                playlist_cover(canvas, lib->rows[i], y);
            } else
                draw_label(canvas, lib->rows[i], y + 8, selected ? screen->scroll : 0);
            canvas_set_color(canvas, ColorBlack);
        }
        if(lib->previous || lib->next) {
            const char* arrows = lib->previous ? (lib->next ? "< >" : "<") : ">";
            canvas_draw_str(canvas, 78, 8, arrows);
        }
    }
    now_bar(canvas, screen);
}
