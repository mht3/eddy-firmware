"""Check the native receiver against the companion's row, preset and volume packets."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "applications/main/eddy_spotify"

HARNESS = r"""
#include <assert.h>
#include "spotify_library.h"

static void reply(SpotifyLibrary* lib, uint8_t op, uint8_t row) {
    spotify_library_begin(lib, op, 0x1234);
    const uint8_t ack[] = {0x14, 0x34, 0x12, row};
    spotify_library_receive(lib, ack, sizeof(ack));
    assert(lib->request == 0);
}

int main(void) {
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
            (work / "test.c").write_text(HARNESS)
            executable = work / "test"
            subprocess.run(
                [
                    os.environ.get("CC", "cc"),
                    "-I",
                    str(APP),
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
