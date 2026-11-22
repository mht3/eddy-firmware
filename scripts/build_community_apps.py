"""Build the opt-in Flipper Lab utilities with Eddy's F7 toolchain and stage their metadata."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "website/community"
APPS = {
    "techart_calendar": {
        "name": "Calendar",
        "author": "TechArtDev",
        "source": "https://github.com/techartdev/Calendar/tree/3f29994837002986dbf9afc117338d5ee633c1ee",
    },
    "resistors": {
        "name": "Resistance calculator",
        "author": "Lewis Westbury",
        "source": "https://github.com/xMasterX/all-the-plugins/tree/1066d17ad1e8fbf75cea5c6612d79ba539ec8a33/apps_source_code/resistors",
    },
}


def main():
    subprocess.run(
        [
            str(ROOT / "fbt"),
            "--extra-ext-apps=" + ",".join(APPS),
            "STRICT_FAP_IMPORT_CHECK=1",
            *("fap_" + app_id for app_id in APPS),
        ],
        cwd=ROOT,
        check=True,
        env={**os.environ, "FBT_NO_SYNC": "1"},
    )
    archive_dir = ROOT / "build/f7-firmware-C/.extapps"
    OUTPUT.mkdir(exist_ok=True)
    catalog = []
    for app_id, metadata in APPS.items():
        binary = archive_dir / (app_id + ".fap")
        shutil.copyfile(binary, OUTPUT / binary.name)
        license_file = app_id + ".LICENSE.txt"
        shutil.copyfile(
            ROOT / "applications_user" / app_id / "LICENSE", OUTPUT / license_file
        )
        catalog.append(
            {
                "id": app_id,
                "alias": app_id,
                **metadata,
                "lab": "https://lab.flipper.net/apps/" + app_id,
                "license": "MIT",
                "licenseFile": license_file,
                "sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
            }
        )
    (OUTPUT / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n")


if __name__ == "__main__":
    main()
