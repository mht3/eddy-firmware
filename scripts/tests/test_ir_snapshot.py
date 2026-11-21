"""Exercise IR file commits and reboot recovery with an interruptible host filesystem."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

HARNESS = r"""
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>

typedef int Storage;
typedef enum { FSE_OK, FSE_NOT_EXIST, FSE_EXIST, FSE_ERROR } FS_Error;
typedef char FuriString;
static const char *furi_string_get_cstr(const FuriString *s) { return s; }
#define furi_string_free free
static FuriString *furi_string_alloc_printf(const char *fmt, const char *a, const char *b) {
    size_t n = strlen(a) + strlen(b) + 1;
    char *s = malloc(n);
    snprintf(s, n, fmt, a, b);
    return s;
}
static FS_Error storage_common_stat(Storage *s, const char *p, void *info) {
    return access(p, F_OK) == 0 ? FSE_OK : errno == ENOENT ? FSE_NOT_EXIST : FSE_ERROR;
}
static bool storage_simply_remove(Storage *s, const char *p) {
    return unlink(p) == 0 || errno == ENOENT;
}
static FS_Error storage_common_rename_safe(Storage *s, const char *from, const char *to) {
    if(access(from, F_OK)) return FSE_NOT_EXIST;
    if(!access(to, F_OK)) return FSE_EXIST;
    if(!strcmp(from, "revision") && getenv("FAIL_INSTALL")) return FSE_EXIST;
    if(rename(from, to)) return FSE_ERROR;
    if(getenv("CUT_AFTER") && !strcmp(getenv("CUT_AFTER"), to)) _exit(72);
    return FSE_OK;
}
#include <toolbox/eddy_ir_snapshot.h>

int main(int argc, char **argv) {
    Storage storage = 0;
    const char *path = "TV.ir";
    if(!strcmp(argv[1], "commit")) return !eddy_ir_commit(&storage, path, "revision");
    if(!strcmp(argv[1], "restore")) return eddy_ir_restore(&storage, path) != FSE_OK;
    if(!strcmp(argv[1], "delete"))
        return !(eddy_ir_clear_backup(&storage, path) && storage_simply_remove(&storage, path));
    return 2;
}
"""


class InfraredSnapshotTest(unittest.TestCase):
    def test_power_cuts_and_failed_rename(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "storage").mkdir()
            (root / "storage/storage.h").touch()
            source = root / "test.c"
            source.write_text(HARNESS)
            executable = root / "test"
            subprocess.run(
                [
                    os.environ.get("CC", "cc"),
                    "-I",
                    tmp,
                    "-I",
                    str(ROOT / "lib"),
                    str(source),
                    "-o",
                    str(executable),
                ],
                check=True,
            )

            def run(action, **env):
                return subprocess.run(
                    [executable, action],
                    cwd=root,
                    env={**os.environ, **env},
                    check=False,
                ).returncode

            original, replacement = root / "TV.ir", root / "revision"
            backup = root / "TV.ir.eddy-backup"
            for destination, expected in [
                (backup.name, b"old"),
                (original.name, b"new"),
            ]:
                with self.subTest(interrupted_after=destination):
                    original.write_bytes(b"old")
                    replacement.write_bytes(b"new")
                    self.assertEqual(run("commit", CUT_AFTER=destination), 72)
                    self.assertEqual(run("restore"), 0)
                    self.assertEqual(original.read_bytes(), expected)
                    self.assertEqual(run("delete"), 0)
                    self.assertFalse(backup.exists())
                    self.assertEqual(run("restore"), 1)
            original.write_bytes(b"original")
            replacement.write_bytes(b"replacement")
            self.assertEqual(run("commit", FAIL_INSTALL="1"), 1)
            self.assertEqual(original.read_bytes(), b"original")
            self.assertEqual(run("commit"), 0)
            self.assertEqual(original.read_bytes(), b"replacement")
            self.assertFalse(backup.exists())


if __name__ == "__main__":
    unittest.main()
