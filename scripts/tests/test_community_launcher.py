"""Exercise the firmware's actual launcher discovery against a temporary SD filesystem."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOADER = ROOT / "applications/services/loader"

APPLICATIONS = """
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#define COUNT_OF(x) (sizeof(x) / sizeof((x)[0]))
typedef struct Icon Icon;
typedef struct { const char* name; const Icon* icon; const char* path; } FlipperExternalApplication;
extern const FlipperExternalApplication FLIPPER_EXTERNAL_APPS[];
extern const size_t FLIPPER_EXTERNAL_APPS_COUNT;
"""

STORAGE = """
#pragma once
#include <stdio.h>
#include <unistd.h>
#define EXT_PATH(x) x
enum { FSAM_READ, FSOM_OPEN_EXISTING };
typedef int Storage;
typedef struct { FILE* handle; } File;
static inline File* storage_file_alloc(Storage* storage) { return calloc(1, sizeof(File)); }
static inline bool storage_file_open(File* file, const char* path, int access, int mode) {
    return (file->handle = fopen(path, "rb")) != NULL;
}
static inline uint64_t storage_file_size(File* file) {
    fseek(file->handle, 0, SEEK_END);
    long size = ftell(file->handle);
    rewind(file->handle);
    return size;
}
static inline size_t storage_file_read(File* file, void* dst, size_t size) {
    return fread(dst, 1, size, file->handle);
}
static inline void storage_file_free(File* file) {
    if(file->handle) fclose(file->handle);
    free(file);
}
static inline bool storage_file_exists(Storage* storage, const char* path) {
    return access(path, R_OK) == 0;
}
"""

MAIN = """
#include "loader_menu_apps_i.h"
#include <gui/icon_i.h>
const Icon I_CommunityCalendar_16x16 = {.width=1}, I_CommunityResistor_16x16 = {.width=2}, A_Plugins_14 = {.width=3};
const FlipperExternalApplication FLIPPER_EXTERNAL_APPS[] = {
    {"Sub-GHz", NULL, "signal.fap"}, {"NFC", NULL, "nfc.fap"}, {"Extra", NULL, "extra.fap"}
};
const size_t FLIPPER_EXTERNAL_APPS_COUNT = COUNT_OF(FLIPPER_EXTERNAL_APPS);
int main(int argc, char** argv) {
    Storage storage;
    size_t count, community_start;
    const FlipperExternalApplication** apps = loader_menu_apps_load(&storage, &count, &community_start);
    for(size_t i=0; i<count; ++i) {
        if(i >= community_start && !apps[i]->icon) return 1;
        if(argc > 1 && i >= community_start) {
            const Icon* icon = apps[i]->icon;
            if(icon->width == 10) {
                if(icon->height != 10 || icon->frame_count != 1 || icon->frames[0][0]) return 1;
                for(size_t j=1; j<=20; ++j) printf("%02x", icon->frames[0][j]);
            } else printf("%d", icon->width);
            printf(" %s %s\\n", apps[i]->name, apps[i]->path);
        }
        else puts(i < community_start ? apps[i]->name : apps[i]->path);
    }
    free(apps);
}
"""


class CommunityLauncherTest(unittest.TestCase):
    def test_manifest_order_files_and_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "storage").mkdir()
            (root / "storage/storage.h").write_text(STORAGE)
            (root / "applications.h").write_text(APPLICATIONS)
            (root / "furi.h").write_text("#include <assert.h>\n#define furi_check assert\n")
            (root / "assets_icons.h").write_text(
                "extern const Icon I_CommunityCalendar_16x16, I_CommunityResistor_16x16, A_Plugins_14;"
            )
            (root / "test.c").write_text(MAIN)
            executable = root / "test"
            subprocess.run(
                [
                    os.environ.get("CC", "cc"),
                    "-I",
                    tmp,
                    "-I",
                    str(LOADER),
                    "-I",
                    str(ROOT / "applications/services"),
                    "-I",
                    str(ROOT / "lib"),
                    str(ROOT / "lib/toolbox/hex.c"),
                    str(root / "test.c"),
                    str(LOADER / "loader_menu_apps.c"),
                    "-o",
                    str(executable),
                ],
                check=True,
            )

            def loaded(*args):
                return subprocess.check_output(
                    [executable, *args], cwd=root, text=True
                ).splitlines()

            (root / "eddy").mkdir()
            (root / "apps/Community").mkdir(parents=True)
            calendar, resistor = [
                "apps/Community/" + id + ".fap"
                for id in ("techart_calendar", "resistors")
            ]
            for file in ["nfc.fap", "signal.fap", "extra.fap", calendar, resistor]:
                (root / file).touch()
            self.assertEqual(loaded(), ["Sub-GHz", "NFC", "Extra"])
            stock = ["NFC", "Sub-GHz", "Extra"]
            (root / "eddy/launcher_order.txt").write_bytes(b"nfc\r\nmissing\nnfc\n")
            manifest = root / "eddy/community_apps.txt"
            for bad in (
                b"",
                b"resistors\x00techart_calendar",
                b"x" * 257,
                b"apps/Community/resistors.fap",
            ):
                manifest.write_bytes(bad)
                self.assertEqual(loaded(), stock)
            manifest.write_bytes(b"resistors\r\n../other\nresistors\ntechart_calendar")
            self.assertEqual(loaded(), [*stock, resistor, calendar])
            imported = "apps/Community/f0_claude_remote.fap"
            (root / imported).touch()
            manifest.write_text(
                "f0_claude_remote\tClaude Remote\r\n"
                "techart_calendar\n"
                "f0_claude_remote\tDuplicate name\n"
                "../extra\tEscape\n"
                "missing_package\tMissing file\n"
                "resistors\tOld bundled app"
            )
            self.assertEqual(
                loaded("details"),
                [*stock, "3 Claude Remote " + imported, "1 Calendar " + calendar,
                 "2 Resistance calculator " + resistor],
            )
            icon = "e4031201d9008900770066005500440033001100"
            manifest.write_text(f"f0_claude_remote\tClaude Remote\t{icon}\n")
            self.assertEqual(loaded("details"), [*stock, icon + " Claude Remote " + imported])
            (root / "apps/Community/4inrow.fap").touch()
            manifest.write_text("4inrow\tFour in a row")
            self.assertEqual(loaded(), [*stock, "apps/Community/4inrow.fap"])
            (root / "apps/rogue.fap").touch()
            for invalid in (
                "f0_claude_remote", "f0_claude_remote\t", "f0_claude_remote\t   ",
                "f0_claude_remote\tTwo\tfields", "f0_claude_remote\tEscape\x1b",
                "f0_claude_remote\t" + "x" * 33, "../rogue\tOther",
                "f0_claude_remote\tOne\x00Two", "f0_claude_remote\tInvalid\rBreak",
                "f0_claude_remote\tIcon\t" + "x" * 40,
                "f0_claude_remote\tIcon\t" + "0" * 39,
                ("f0_claude_remote\tName\n" * 265),
            ):
                manifest.write_text(invalid)
                self.assertEqual(loaded(), stock)
            names = ["app_" + str(i) for i in range(33)]
            for name in names:
                (root / "apps/Community" / (name + ".fap")).touch()
            manifest.write_text("".join(f"{name}\tApp {i}\n" for i, name in enumerate(names)))
            self.assertEqual(loaded(), [*stock, *["apps/Community/" + name + ".fap" for name in names[:32]]])
            manifest.write_bytes(b"resistors\ntechart_calendar")
            (root / resistor).unlink()
            self.assertEqual(loaded(), [*stock, calendar])
            (root / "signal.fap").unlink()
            manifest.write_bytes(b"")
            self.assertEqual(loaded(), ["NFC", "Extra"])


if __name__ == "__main__":
    unittest.main()
