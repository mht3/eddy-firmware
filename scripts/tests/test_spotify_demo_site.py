from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from eddy_site import ROOT, stage_pages


class SpotifyDemoSiteTest(unittest.TestCase):
    def test_public_tour_shares_the_homepage_controls_and_pinned_player(self):
        source = ROOT / "applications/main/eddy_spotify/source"
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory) / "project"
            stage_pages(site, source)
            route = site / "spotify-demo"
            home = (site / "index.html").read_text()
            demo = (route / "index.html").read_text()
            self.assertIn("<title>Spotify demo · Eddy Firmware</title>", demo)
            self.assertIn('name="description" content="Try Spotify', demo)
            self.assertLess(
                demo.index('<base href="../">'), demo.index('<link rel="icon"')
            )
            self.assertNotIn("<title>Spotify demo · Eddy Firmware</title>", home)
            self.assertIn('id="lesson-step"', demo)
            self.assertEqual(demo.split("<body>")[1], home.split("<body>")[1])
            for name in (
                "lcd.js",
                "lcd-fonts.js",
                "spotify-demo-library.js",
                "spotify-preview.js",
                "spotify-tour.js",
            ):
                self.assertFalse((route / name).is_symlink())
                self.assertEqual(
                    (route / name).read_bytes(), (source / "demo" / name).read_bytes()
                )
            self.assertNotEqual(demo, (source / "demo/index.html").read_text())
