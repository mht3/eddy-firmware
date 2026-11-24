from pathlib import Path
import re
import unittest
from urllib.parse import urljoin
from xml.etree import ElementTree


SITE = Path(__file__).resolve().parents[2] / "website"


class SiteNavigationTest(unittest.TestCase):
    def test_public_pages_share_the_home_navigation(self):
        root = "/eddy-firmware/"
        destinations = ["wiki/", "app/", "resources/", "update/"]
        for page in SITE.rglob("index.html"):
            route = page.parent.relative_to(SITE).as_posix()
            if route in {"s", "spotify/connect", "spotify-demo"}:
                # The first two redirect. The packaged demo shares the homepage.
                continue
            with self.subTest(route=route):
                document = page.read_text()
                match = re.search(r'<nav aria-label="Main">.*?</nav>', document, re.S)
                self.assertIsNotNone(match)
                links = ElementTree.fromstring(match.group()).findall("a")
                self.assertEqual(
                    [a.text.strip() for a in links],
                    ["Wiki", "App", "Resources", "Install"],
                )
                address = urljoin(root, route + "/") if route != "." else root
                for link, destination in zip(links, destinations):
                    self.assertEqual(
                        urljoin(address, link.attrib["href"]), root + destination
                    )
                    self.assertEqual(
                        link.get("aria-current"),
                        "page" if address == root + destination else None,
                    )
