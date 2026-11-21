"""Stage the website and its single matching F7 update for static hosting."""

import hashlib
import json
import re
import shutil
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def stage(package=None):
    packages = (
        [package]
        if package is not None
        else list((ROOT / "dist").glob("f7-*/flipper-z-f7-update-eddy-*.tgz"))
    )
    if len(packages) != 1:
        raise SystemExit(
            "Expected one Eddy archive under dist/f7-*. Use a clean distribution directory."
        )
    package = packages[0]
    version = package.stem.removeprefix("flipper-z-f7-update-")
    if not re.fullmatch(r"eddy-[A-Za-z0-9._-]+", version):
        raise SystemExit("Unsupported package name")
    with tarfile.open(package, "r:gz") as bundle:
        manifests = [
            m for m in bundle if m.isfile() and Path(m.name).name == "update.fuf"
        ]
        if len(manifests) != 1:
            raise SystemExit("Missing or ambiguous update manifest")
        manifest = bundle.extractfile(manifests[0]).read().decode().splitlines()
        if (
            "Target: 7" not in manifest
            or "Filetype: Flipper firmware upgrade configuration" not in manifest
        ):
            raise SystemExit("Expected a Flipper Zero (F7) update")
        if "Info: " + version not in manifest:
            raise SystemExit("Package version differs from the update manifest")

    metadata = json.loads(
        package.with_name(f"flipper-z-f7-full-{version}.json").read_text()
    )
    if metadata["firmware_origin"] != "Eddy" or metadata["firmware_target"] != 7:
        raise SystemExit("Firmware metadata does not identify an Eddy F7 build")
    commit = subprocess.check_output(
        ["git", "rev-parse", "--verify", metadata["firmware_commit"] + "^{commit}"],
        cwd=ROOT,
        text=True,
    ).strip()
    if metadata["firmware_dirty"]:
        commit = None
    site = ROOT / "dist/eddy-site"
    if site.exists():
        shutil.rmtree(site)
    shutil.copytree(ROOT / "website", site)
    shutil.copy2(package, site / "firmware" / package.name)
    build = dict(
        target="f7",
        version=version,
        file=package.name,
        commit=commit,
        sha256=hashlib.sha256(package.read_bytes()).hexdigest(),
    )
    (site / "firmware/main.json").write_text(json.dumps(build, indent=2) + "\n")
    shutil.copy2(ROOT / "LICENSE", site / "firmware/LICENSE.txt")
    shutil.copy2(
        ROOT / "lib/stm32wb_copro/firmware/LICENSE.md",
        site / "firmware/ST-radio-license.md",
    )
    print(site)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "package", nargs="?", type=Path, help="Specific Eddy F7 TGZ to stage"
    )
    stage(parser.parse_args().package)
