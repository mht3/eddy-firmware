import importlib.util
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from setup_spotify import configure


@unittest.skipUnless(
    importlib.util.find_spec("segno"), "Install segno to test personal QR setup"
)
class PersonalSetupTest(unittest.TestCase):
    def test_personal_scan_and_invalid_input(self):
        import segno

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "website/spotify/config.js"
            config.parent.mkdir(parents=True)
            config.write_text("export const spotifyClientId = 'original';\n")
            header = root / "applications/main/eddy_spotify/setup_qr.h"
            header.parent.mkdir(parents=True)
            card = root / "setup.qr"
            site = "https://developer.github.io/my-library/spotify/"
            client_id = "d" * 32
            configure(root, site, client_id, card)
            expected = segno.make_qr(site + "#link", error="L")
            matrix = list(expected.matrix_iter(border=4))
            native = card.read_bytes()
            self.assertEqual(len(native), 512)
            self.assertEqual(
                bytes.fromhex("".join(re.findall("0x(..)", header.read_text()))), native
            )
            for y in range(64):
                for x in range(64):
                    bit = native[8 * y + x // 8] >> (x % 8) & 1
                    self.assertEqual(
                        bit, matrix[y * len(matrix) // 64][x * len(matrix) // 64]
                    )
            self.assertIn(client_id, config.read_text())
            self.assertTrue(
                (config.parent / "guide-qr.png").read_bytes().startswith(b"\x89PNG")
            )
            for uri, key in [
                (site + "#link", client_id),
                (site, "wrong"),
                (site.replace("https:", "http:"), client_id),
            ]:
                with self.assertRaises(ValueError):
                    configure(root, uri, key, card)
            self.assertEqual(card.read_bytes(), native)
