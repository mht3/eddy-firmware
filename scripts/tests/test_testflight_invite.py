from pathlib import Path
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from eddy_site import ROOT, configure_testflight


class TestFlightInviteTest(unittest.TestCase):
    def test_one_invite_updates_both_pages(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            pages = [site / name / "index.html" for name in ("app", "spotify")]
            for page in pages:
                page.parent.mkdir()
                shutil.copy(ROOT / "website" / page.relative_to(site), page)

            configure_testflight(site, "")
            for page in pages:
                self.assertIn(
                    'href="https://testflight.apple.com/join/9vUqxk8j"',
                    page.read_text(),
                )

            with self.assertRaises(ValueError):
                configure_testflight(site, "https://example.com/join/abcd1234")
            invite = "https://testflight.apple.com/join/abcd1234"
            configure_testflight(site, invite)
            for page in pages:
                self.assertEqual(page.read_text().count(invite), 1)
                self.assertEqual(
                    page.read_text().count("testflight.apple.com/join/"), 1
                )
            self.assertIn("eddyspotify://setup", pages[0].read_text())
            self.assertIn("id899247664", pages[0].read_text())
