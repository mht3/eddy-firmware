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
#include "spotify_screen.h"
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


static void reply(SpotifyLibrary* lib, uint8_t op, uint8_t row) {
    spotify_library_begin(lib, op, 0x1234);
    const uint8_t ack[] = {0x14, 0x34, 0x12, row};
    spotify_library_receive(lib, ack, sizeof(ack));
    assert(lib->request == 0);
}

int main(void) {
    companion_setup();
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
                    "-o",
                    str(executable),
                ],
                check=True,
            )
            subprocess.run([executable], check=True)


if __name__ == "__main__":
    unittest.main()
