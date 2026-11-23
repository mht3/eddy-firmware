"""Compare the browser timers against the stock firmware's actual 128x64 framebuffers."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
U8G2 = ROOT / "lib/u8g2"

# Only bridge the firmware's canvas API. Both draw callbacks and the u8g2
# drawing primitives below are compiled from the copies that ship on-device.
CANVAS = r"""
#include "u8g2.h"
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

typedef u8g2_t Canvas;
typedef enum {AlignLeft, AlignRight, AlignCenter, AlignBottom} Align;
typedef struct {
    unsigned long remaining, deadline, focus_seconds, break_seconds;
    bool on_break, muted;
} EddyTimerState;
typedef struct { int bpm, output, beat; bool playing, awaiting_tap; } MetronomeModel;

#define MIN_BPM 40
#define MAX_BPM 220
#define EDDY_TIMER_MAX_SECONDS 5999
#define FontPrimary u8g2_font_helvB08_tr
#define FontSecondary u8g2_font_haxrcorp4089_tr
#define FontBigNumbers u8g2_font_profont22_tn
#define canvas_draw_str u8g2_DrawUTF8
#define canvas_draw_rbox u8g2_DrawRBox
#define canvas_draw_rframe u8g2_DrawRFrame
#define canvas_draw_line u8g2_DrawLine

static void canvas_set_font(Canvas* canvas, const uint8_t* font) {
    u8g2_SetFontMode(canvas, 1);
    u8g2_SetFont(canvas, font);
}

static void canvas_draw_str_aligned(Canvas* canvas, int x, int y, Align h, Align v, const char* str) {
    const int width = u8g2_GetUTF8Width(canvas, str);
    const int offset = h == AlignCenter ? width / 2 : h == AlignRight ? width : 0;
    canvas_draw_str(canvas, x - offset, y, str);
}
"""

NATIVE = r"""
int main(void) {
    Canvas canvas = {0};
    uint8_t buffer[1024] = {0};
    const u8x8_display_info_t display = {
        .tile_width=16, .tile_height=8, .pixel_width=128, .pixel_height=64,
    };
    canvas.u8x8.display_info = &display;
    u8g2_SetupBuffer(&canvas, buffer, 8, u8g2_ll_hvline_vertical_top_lsb, U8G2_R0);

    EddyTimerState timer = {.remaining=1500, .focus_seconds=1500, .break_seconds=300};
    timer_draw(&canvas, &timer);
    fwrite(buffer, 1, sizeof buffer, stdout);

    memset(buffer, 0, sizeof buffer);
    MetronomeModel metronome = {.bpm=96};
    metronome_draw(&canvas, &metronome);
    fwrite(buffer, 1, sizeof buffer, stdout);
}
"""

BROWSER = r"""
import {drawPomodoro} from './website/pomodoro.js';
import {drawMetronome} from './website/metronome.js';
const lcd = Buffer.alloc(1024);
const ctx = {
    fillRect(x,y,w,h) {
        for(let row=y; row<y+h; row++) for(let col=x; col<x+w; col++) {
            if(col>=0 && col<128 && row>=0 && row<64) lcd[(row>>3)*128+col] |= 1<<(row%8);
        }
    }
};
drawPomodoro(ctx);
process.stdout.write(Buffer.from(lcd));
lcd.fill(0);
drawMetronome(ctx,{},0);
process.stdout.write(lcd);
"""


def draw_callback(source, name):
    start = source.index(f"static void {name}(")
    return source[start : source.index("\n}", start) + 2]


class TimerLcdTest(unittest.TestCase):
    def test_website_timer_pixels_match_firmware(self):
        apps = ROOT / "applications/main"
        pomo = (apps / "eddy_pomodoro/eddy_pomodoro.c").read_text()
        metro = (apps / "eddy_metronome/eddy_metronome.c").read_text()
        labels = next(
            line for line in metro.splitlines() if "output_labels[] =" in line
        )
        harness = "\n".join(
            (
                CANVAS,
                labels,
                draw_callback(pomo, "timer_draw"),
                draw_callback(metro, "metronome_draw"),
                NATIVE,
            )
        )
        with tempfile.TemporaryDirectory() as temp:
            main = Path(temp) / "main.c"
            exe = Path(temp) / "reference"
            main.write_text(harness)
            renderer = [str(p) for p in U8G2.glob("*.c") if p.stem != "u8g2_glue"]
            linker = (
                "-Wl,-dead_strip" if sys.platform == "darwin" else "-Wl,--gc-sections"
            )
            subprocess.run(
                [
                    os.environ.get("CC", "cc"),
                    "-Wno-format",
                    "-ffunction-sections",
                    linker,
                    "-I",
                    str(U8G2),
                    str(main),
                    *renderer,
                    "-o",
                    str(exe),
                ],
                check=True,
            )
            expected = subprocess.check_output([str(exe)])
        actual = subprocess.check_output(
            ["node", "--input-type=module", "-e", BROWSER], cwd=ROOT
        )
        self.assertEqual(len(actual), len(expected))
        for i, app in enumerate(("Pomodoro", "Metronome")):
            with self.subTest(app=app):
                frame = slice(1024 * i, 1024 * (i + 1))
                different = sum(
                    bin(a ^ b).count("1")
                    for a, b in zip(actual[frame], expected[frame])
                )
                self.assertEqual(
                    different,
                    0,
                    f"{app} differs from the firmware by {different} pixels",
                )
