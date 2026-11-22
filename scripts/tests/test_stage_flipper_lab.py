import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import stage_flipper_lab as lab

MIT = (lab.ROOT / "website/community/techart_calendar.LICENSE.txt").read_text()


def bundle(license_text):
    output = io.BytesIO()
    with ZipFile(output, "w") as archive:
        archive.writestr("code/main.c", "int app(void);")
        archive.writestr("code/LICENSE", license_text)
        archive.writestr("code/NOTICE.txt", "Example upstream developer")
    return output.getvalue()


class LabStageTest(unittest.TestCase):
    def test_stages_new_clock_with_source_and_lists_an_unavailable_app(self):
        fap = b"example build"
        source = bundle(MIT)
        digest = hashlib.sha256(fap).hexdigest()
        test_clock = dict(name="Simple Clock", description="Test clock",
                          category="64971d11577d519190ede5c5", versionId="a" * 24,
                          api="88.2", sha256=digest)
        unsupported = dict(name="4 Test", description="", category="other", versionId="b" * 24)
        with tempfile.TemporaryDirectory() as temp:
            manifest = Path(temp, "main.json")
            manifest.write_text(json.dumps(dict(version="eddy-test", catalogCompatibility={
                "target":"f7", "api":"88.3", "catalog":"eddy-test/lab/index.json"})))
            with patch.object(lab, "records", side_effect=[{"4test":unsupported}, {"clock_demo":test_clock}]), \
                    patch.object(lab, "download", side_effect=[source, fap]):
                lab.stage(manifest)
            root = Path(temp, "eddy-test/lab")
            apps = json.loads((root / "index.json").read_text())["apps"]
            self.assertEqual(apps["clock_demo"]["sha256"], digest)
            self.assertTrue(apps["clock_demo"]["mirrored"])
            self.assertNotIn("sha256", apps["4test"])
            self.assertEqual((root / "clock_demo.source.zip").read_bytes(), source)
            self.assertIn("Example upstream developer", (root / "clock_demo.LICENSE.txt").read_text())

    def test_only_mirror_distributable_packages_with_matching_digests(self):
        self.assertIsNone(lab.notice_from_source(bundle("All rights reserved")))
        data = bundle(MIT)
        with tempfile.TemporaryDirectory() as tmp, patch.object(lab, "download", side_effect=[data,b"changed"]):
            with self.assertRaisesRegex(ValueError, "digest differs"):
                lab.stage_mirror(Path(tmp), "clock_demo", {"versionId":"0"*24,"sha256":"1"*64,"api":"88.2"})
            self.assertFalse(list(Path(tmp).iterdir()))
