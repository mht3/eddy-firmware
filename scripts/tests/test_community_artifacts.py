import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from eddy_site import ROOT, community_artifacts


class CommunityArtifactsTest(unittest.TestCase):
    def test_release_uses_pinned_f7_apps_and_upstream_notices(self):
        directory = ROOT / "website/community"
        sdk = (
            (ROOT / "targets/f7/api_symbols.csv")
            .read_text()
            .splitlines()[1]
            .split(",")[2]
        )
        major, minor = map(int, sdk.split("."))
        target = (major << 16 | minor, 7)
        records = community_artifacts(directory, target)
        self.assertEqual(set(records), {"techart_calendar"})
        for app_id, (meta, data) in records.items():
            self.assertEqual(meta["size"], len(data))
            self.assertEqual(
                meta["license"].encode(),
                (ROOT / "applications_user" / app_id / "LICENSE").read_bytes(),
            )
        with self.assertRaisesRegex(ValueError, "SDK"):
            community_artifacts(directory, (target[0] + 1, 7))
        with tempfile.TemporaryDirectory() as temp:
            copied = Path(temp) / "community"
            shutil.copytree(directory, copied)
            first = json.loads((copied / "catalog.json").read_text())[0]
            binary = copied / (first["id"] + ".fap")
            binary.write_bytes(binary.read_bytes() + b"!")
            with self.assertRaisesRegex(ValueError, "hash"):
                community_artifacts(copied, target)
