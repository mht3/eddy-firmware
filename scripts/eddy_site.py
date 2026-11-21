"""Stage the website and its single matching F7 update for static hosting."""

import hashlib
import io
import json
import re
import runpy
import os
import shutil
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# These settings are opened from the system menu independently of the app picker.
SYSTEM_APPS = {
    "about",
    "bt_settings",
    "clock_settings",
    "desktop_settings",
    "expansion_settings",
    "input_settings",
    "notification_settings",
    "passport",
    "power_settings",
    "storage_settings",
    "system_settings",
}


def resource_index(data, profile):
    """Locate app binaries, launcher layout and SD manifest in the verified resource tar."""
    apps = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        manifest = archive.getmember("Manifest")
        if not manifest.isfile() or manifest.offset_data != manifest.offset + 512:
            raise ValueError("Unsupported SD resource manifest")
        rows = set(archive.extractfile(manifest).read().decode().splitlines())
        layout = archive.getmember("eddy/launcher_order.txt")
        if not layout.isfile() or layout.offset_data != layout.offset + 512:
            raise ValueError("Unsupported launcher layout entry")
        layout_data = archive.extractfile(layout).read()
        layout_md5 = hashlib.md5(layout_data, usedforsecurity=False).hexdigest()
        if f"F:{layout_md5}:{layout.size}:{layout.name}" not in rows:
            raise ValueError("Launcher layout does not match the SD resource manifest")
        for member in archive:
            if (
                member.name.endswith(".fal")
                and member.name != "apps_data/cli/plugins/cli_src.fal"
            ):
                raise ValueError(
                    f"Unexpected plugin in the Eddy release: {member.name}"
                )
            if not re.fullmatch(r"apps/[^/]+/[A-Za-z0-9_-]+\.fap", member.name):
                if member.name.endswith(".fap"):
                    raise ValueError(f"Unexpected app path: {member.name}")
                continue
            app_id = Path(member.name).stem
            if app_id not in profile and app_id not in SYSTEM_APPS:
                raise ValueError(f"App outside the Eddy release profile: {member.name}")
            if (
                not member.isfile()
                or member.offset_data != member.offset + 512
                or app_id in apps
            ):
                raise ValueError(f"Unexpected app record: {member.name}")
            digest = hashlib.md5(
                archive.extractfile(member).read(), usedforsecurity=False
            )
            if f"F:{digest.hexdigest()}:{member.size}:{member.name}" not in rows:
                raise ValueError(f"Resource manifest mismatch: {member.name}")
            apps[app_id] = {"name": member.name, "offset": member.offset}
    return {"manifest": manifest.offset, "launcherOrder": layout.offset, "apps": apps}


def stage(package=None):
    options = runpy.run_path(str(ROOT / "fbt_options.py"))
    if package is None:
        suffix = os.environ.get("DIST_SUFFIX") or options["DIST_SUFFIX"]
        package = ROOT / "dist/f7-C" / f"flipper-z-f7-update-{suffix}.tgz"
        if not package.is_file():
            raise SystemExit(
                "Build the current F7 revision first, or specify an existing Eddy TGZ."
            )
    version = package.stem.removeprefix("flipper-z-f7-update-")
    if not re.fullmatch(r"eddy-[A-Za-z0-9._-]+", version):
        raise SystemExit("Unsupported package name")
    components = {}
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

        # Publish the same flat F7 package members that selfupdate.py sends over USB.
        folder = Path(manifests[0].name).parent
        for member in bundle.getmembers():
            if member.isdir():
                continue
            path = Path(member.name)
            if (
                not member.isfile()
                or path.parent != folder
                or not re.fullmatch(r"[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+", path.name)
                or path.name in components
            ):
                raise SystemExit(f"Unexpected update component: {member.name}")
            components[path.name] = bundle.extractfile(member).read()

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
    indexed_apps = resource_index(
        components["resources.tar.gz"], options["FIRMWARE_APPS"]["eddy"]
    )
    site = ROOT / "dist/eddy-site"
    if site.exists():
        shutil.rmtree(site)
    shutil.copytree(ROOT / "website", site)
    shutil.copy2(package, site / "firmware" / package.name)
    parts_dir = site / "firmware" / version
    parts_dir.mkdir()
    parts = []
    for name, data in components.items():
        (parts_dir / name).write_bytes(data)
        parts.append(
            {
                "name": name,
                "size": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "md5": hashlib.md5(data, usedforsecurity=False).hexdigest(),
            }
        )
    build = dict(
        parts=parts,
        resourceIndex=indexed_apps,
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
