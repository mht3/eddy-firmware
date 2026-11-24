"""Check the native receiver against the companion's row, preset and volume packets."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "applications/main/eddy_spotify/source"

HARNESS = r"""
#include <assert.h>
#include "spotify_playback.h"
#include <string.h>

static void companion_setup(void) {
    SpotifyScreen screen = {0};
    assert(spotify_screen_shows_setup(&screen));
    screen.connected = true;
    assert(spotify_screen_shows_setup(&screen)); // Bluetooth pairing alone does not load playlists.
    screen.bridge = true;
    assert(!spotify_screen_shows_setup(&screen));
    screen.manual_setup = true;
    assert(spotify_screen_shows_setup(&screen));
    screen.manual_setup = false;
    screen.bridge = false;
    assert(spotify_screen_shows_setup(&screen)); // Companion disconnected.
    screen.dismissed_setup = true;
    assert(!spotify_screen_shows_setup(&screen));
}


static void paused_playback(void) {
    SpotifyScreen screen = {0};
    SpotifyPlayback clock = {0};
    SpotifyLibrary status = {0};
    spotify_playback_update(&clock, &screen, &status, 0);
    assert(!screen.now_playing[0]);
    status = (SpotifyLibrary){.count = 1, .play_state = 1, .duration_ms = 60000,
                              .progress_ms = 10000, .rows = {"Low Tide - Eddy"}};
    spotify_playback_update(&clock, &screen, &status, 100);
    spotify_playback_tick(&clock, &screen, 5100, 1000);
    spotify_playback_toggle(&clock, &screen, 5100);
    assert(screen.elapsed_s == 15 && screen.play_state == 2);
    spotify_playback_update(&clock, &screen, &status, 6400); // Stale playing snapshot.
    spotify_playback_tick(&clock, &screen, 7100, 1000);
    assert(screen.elapsed_s == 15 && screen.play_state == 2);
    status.count = 0;
    spotify_playback_update(&clock, &screen, &status, 8100);
    status.error = SpotifyOffline;
    spotify_playback_update(&clock, &screen, &status, 18100);
    status.error = SpotifyNoPlayer;
    spotify_playback_update(&clock, &screen, &status, 608100);
    spotify_playback_tick(&clock, &screen, 608100, 1000);
    assert(!strcmp(screen.now_playing, "Low Tide - Eddy"));
    assert(screen.play_state == 2 && screen.elapsed_s == 15 && !clock.expected_state);
    spotify_playback_toggle(&clock, &screen, 608100);
    spotify_playback_tick(&clock, &screen, 610100, 1000);
    assert(screen.play_state == 1 && screen.elapsed_s == 17);
    spotify_playback_reject(&clock, &screen);
    spotify_playback_tick(&clock, &screen, 615100, 1000);
    assert(screen.play_state == 2 && screen.elapsed_s == 15);
    spotify_playback_toggle(&clock, &screen, 615100);
    status.error = SpotifyOk;
    status.count = 1;
    status.progress_ms = 16000;
    spotify_playback_update(&clock, &screen, &status, 616100);
    assert(screen.play_state == 1 && screen.elapsed_s == 16 && !clock.expected_state);
    spotify_playback_toggle(&clock, &screen, 616100);
    strcpy(status.rows[0], "Dolphin Days");
    spotify_playback_update(&clock, &screen, &status, 617100);
    assert(!strcmp(screen.now_playing, "Dolphin Days") && screen.play_state == 1);
    status.error = SpotifyLogin;
    spotify_playback_update(&clock, &screen, &status, 618100);
    assert(!screen.now_playing[0] && !screen.duration_s && !clock.expected_state);
}

static void reply(SpotifyLibrary* lib, uint8_t op, uint8_t row) {
    spotify_library_begin(lib, op, 0x1234);
    const uint8_t ack[] = {0x14, 0x34, 0x12, row};
    spotify_library_receive(lib, ack, sizeof(ack));
    assert(lib->request == 0);
}

int main(void) {
    companion_setup();
    paused_playback();
    SpotifyLibrary lib = {.count = 4, .page = 8};
    for(int direction = 0; direction < 4; ++direction) {
        for(int row = 0; row < 4; ++row) {
            uint8_t held = SpotifyHoldPlaylist + 4 * direction + row;
            reply(&lib, held, row);
            assert(lib.accepted && !lib.preset_played && lib.page == 8);
            reply(&lib, held, row + 4);
            assert(lib.accepted && lib.preset_played && lib.page == 8);
            reply(&lib, held, (row + 1) % 4);
            assert(!lib.accepted && lib.error == SpotifyInvalid);
            reply(&lib, SpotifyAssignPreset + 4 * direction + row, row);
            assert(lib.accepted && !lib.preset_played);
        }
        reply(&lib, SpotifyAssignLiked + direction, 0);
        assert(lib.accepted && !lib.preset_played);
        reply(&lib, SpotifyAssignLiked + direction, 1);
        assert(!lib.accepted && lib.error == SpotifyInvalid);
        reply(&lib, SpotifyHoldLiked + direction, 0);
        assert(lib.accepted && !lib.preset_played);
        reply(&lib, SpotifyHoldLiked + direction, 4);
        assert(lib.accepted && lib.preset_played);
        reply(&lib, SpotifyHoldLiked + direction, 5);
        assert(!lib.accepted && lib.error == SpotifyInvalid);
        reply(&lib, SpotifyPlayPreset + direction, 0);
        assert(lib.accepted);
        reply(&lib, SpotifyClearPreset + direction, 0);
        assert(lib.accepted);
    }
    // Queue actions belong to a selected library row on a committed page.
    for(int row = 0; row < 4; ++row) {
        reply(&lib, SpotifyQueue + row, row);
        assert(lib.accepted && lib.page == 8);
        reply(&lib, SpotifyQueue + row, (row + 1) % 4);
        assert(!lib.accepted && lib.error == SpotifyInvalid);
    }
    // Adding the current song asks for a page of playlist choices.
    spotify_library_begin(&lib, SpotifyChooseCurrent, 1);
    const uint8_t start[] = {0x10, 1, 0};
    spotify_library_receive(&lib, start, sizeof(start));
    assert(lib.collecting && !lib.accepted);
    const uint8_t label[] = {0x11, 1, 0, 0, 'S', 'e', 'a'};
    spotify_library_receive(&lib, label, sizeof(label));
    const uint8_t end[] = {0x12, 1, 0, 1, 0, 0, 0, 0, 0, 0};
    spotify_library_receive(&lib, end, sizeof(end));
    assert(lib.page == 1 && lib.count == 1 && lib.selected == 0);
    reply(&lib, SpotifyAddToPlaylist, 0);
    assert(lib.accepted);

    const uint8_t status[] = {0x10, 1, 0, 1, 0x88, 0x13, 0, 0, 0x10, 0x27, 0, 0, 4, 64};
    for(int legacy = 0; legacy < 2; ++legacy) {
        spotify_library_begin(&lib, SpotifyNowPlaying, 1);
        spotify_library_receive(&lib, status, sizeof(status) - legacy);
        assert(lib.collecting && lib.volume == (legacy ? SpotifyVolumeUnknown : 64));
        assert(lib.progress_ms == 5000 && lib.duration_ms == 10000 && lib.title_bytes == 4);
    }
    const uint8_t error[] = {0x13, 1, 0, 5};
    spotify_library_begin(&lib, SpotifySetVolume, 1);
    spotify_library_receive(&lib, error, sizeof(error));
    assert(lib.error == SpotifyVolumeUnavailable && !lib.request);
}
"""


class NativeSpotifyTests(unittest.TestCase):
    def test_receiver(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            (work / "gui").mkdir()
            (work / "gui/canvas.h").write_text(
                "#pragma once\ntypedef struct Canvas Canvas;\n"
            )
            (work / "test.c").write_text(HARNESS)
            executable = work / "test"
            subprocess.run(
                [
                    os.environ.get("CC", "cc"),
                    "-I",
                    str(APP),
                    "-I",
                    str(work),
                    "-I",
                    str(ROOT / "lib"),
                    str(work / "test.c"),
                    str(APP / "spotify_library.c"),
                    str(APP / "spotify_playback.c"),
                    "-o",
                    str(executable),
                ],
                check=True,
            )
            subprocess.run([executable], check=True)


if __name__ == "__main__":
    unittest.main()
