"""Stage the website and its single matching F7 update for static hosting."""

import csv
import hashlib
import io
import json
import re
import runpy
import os
import shutil
import struct
import subprocess
import tarfile
from pathlib import Path

from flipper.assets.coprobin import CoproBinary, get_stack_type
from flipper.assets.obdata import OptionBytesData

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

COMMUNITY_LIST = "eddy/community_apps.txt"
SPOTIFY_SIGNIN = "eddy/spotify_signin.xbm"


def fap_target(data):
    """Read the SDK version and hardware target from an ARM ELF32's .fapmeta section."""
    if (
        len(data) < 52
        or data[:6] != b"\x7fELF\x01\x01"
        or int.from_bytes(data[18:20], "little") != 40
    ):
        raise ValueError("Expected a little-endian ARM Flipper app")
    table = struct.unpack_from("<I", data, 32)[0]
    entry_size, count, names_index = struct.unpack_from("<HHH", data, 46)
    if (
        entry_size != 40
        or names_index >= count
        or table + count * entry_size > len(data)
    ):
        raise ValueError("Invalid Flipper app section table")

    def section(index):
        offset, size = struct.unpack_from("<II", data, table + index * entry_size + 16)
        return data[offset : offset + size]

    names = section(names_index)
    for index in range(count):
        start = struct.unpack_from("<I", data, table + index * entry_size)[0]
        if names[start : start + 9] == b".fapmeta\0":
            magic, version, api, target = struct.unpack_from("<IIIH", section(index))
            if magic == 0x52474448 and version == 1 and target == 7:
                return api, target
    raise ValueError("Missing or incompatible Flipper app metadata")


def catalog_compatibility(sdk_path, target, version):
    """Use the SDK shipped alongside this exact firmware, including its actual exports."""
    import zipfile

    with zipfile.ZipFile(sdk_path) as sdk:
        (api_table,) = [name for name in sdk.namelist() if name.endswith("/api_symbols.csv")]
        rows = list(csv.DictReader(io.StringIO(sdk.read(api_table).decode())))
    api, device = target
    api_version = f"{api >> 16}.{api & 0xFFFF}"
    if device != 7 or not any(r["entry"] == "Version" and r["name"] == api_version for r in rows):
        raise ValueError("The catalog SDK and release target must match")
    symbols = []
    for row in rows:
        if row["status"] != "+" or row["entry"] not in {"Function", "Variable"}:
            continue
        value = 5381
        for byte in row["name"].encode("ascii"):
            value = (33 * value + byte) & 0xFFFFFFFF
        symbols.append(value)
    if not symbols or len(symbols) != len(set(symbols)):
        raise ValueError("Invalid symbol table for catalog apps")
    return dict(api=api_version, target="f7", symbols=sorted(symbols), catalog=f"{version}/lab/index.json")


def community_artifacts(directory, target):
    catalog = {}
    for item in json.loads((directory / "catalog.json").read_text()):
        app_id, name, alias = (item[key] for key in ("id", "name", "alias"))
        if (
            not re.fullmatch(r"[a-z][a-z0-9_-]{0,47}", app_id)
            or app_id in catalog
            or not re.fullmatch(r"[A-Za-z0-9_-]+", alias)
            or not isinstance(name, str)
            or not name.strip()
        ):
            raise ValueError("Invalid or duplicate curated app")
        data = (directory / (app_id + ".fap")).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest != item["sha256"] or fap_target(data) != target:
            raise ValueError(f"Curated app hash or SDK does not match: {app_id}")
        license_file = app_id + ".LICENSE.txt"
        notice = (directory / license_file).read_bytes()
        if (
            item["licenseFile"] != license_file
            or not notice.strip()
            or notice != (ROOT / "applications_user" / app_id / "LICENSE").read_bytes()
        ):
            raise ValueError(f"Incorrect upstream license for {app_id}")
        catalog[app_id] = (
            dict(
                name=name,
                alias=alias,
                size=len(data),
                sha256=digest,
                license=notice.decode(),
            ),
            data,
        )
    return catalog


def resource_index(data, profile):
    """Locate app binaries, launcher layout and SD manifest in the verified resource tar."""
    apps = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        manifest = archive.getmember("Manifest")
        if not manifest.isfile() or manifest.offset_data != manifest.offset + 512:
            raise ValueError("Unsupported SD resource manifest")
        rows = set(archive.extractfile(manifest).read().decode().splitlines())
        if any(row.endswith(":" + SPOTIFY_SIGNIN) for row in rows):
            raise ValueError("A shared resource manifest must preserve personal Spotify settings")
        layout = archive.getmember("eddy/launcher_order.txt")
        if not layout.isfile() or layout.offset_data != layout.offset + 512:
            raise ValueError("Unsupported launcher layout entry")
        layout_data = archive.extractfile(layout).read()
        layout_md5 = hashlib.md5(layout_data, usedforsecurity=False).hexdigest()
        if f"F:{layout_md5}:{layout.size}:{layout.name}" not in rows:
            raise ValueError("Launcher layout does not match the SD resource manifest")
        community = archive.getmember(COMMUNITY_LIST)
        if (
            not community.isfile()
            or community.offset_data != community.offset + 512
            or community.size
            or f"F:d41d8cd98f00b204e9800998ecf8427e:0:{COMMUNITY_LIST}" not in rows
        ):
            raise ValueError(
                "Expected an empty community app list in the base firmware"
            )
        for member in archive:
            if member.name == SPOTIFY_SIGNIN:
                raise ValueError("A shared release must not include a personal Spotify sign-in code")
            if member.name == "apps/Community" or member.name.startswith(
                "apps/Community/"
            ):
                raise ValueError("Community apps must be opt-in")
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
        spotify_binary = archive.extractfile(apps["eddy_spotify"]["name"]).read()
        target = fap_target(spotify_binary)
        index = dict(
            manifest=manifest.offset,
            launcherOrder=layout.offset,
            communityList=community.offset,
            spotifySignIn=SPOTIFY_SIGNIN.encode("ascii") in spotify_binary,
            archiveEnd=archive.offset,
            apps=apps,
        )
    return index, target


def validate_radio_layout(components, manifest, options):
    fields = dict(line.split(": ", 1) for line in manifest if ": " in line)
    radio_path = ROOT / options["COPRO_STACK_BIN_DIR"] / options["COPRO_STACK_BIN"]
    if components.get(fields.get("Radio")) != radio_path.read_bytes():
        raise ValueError("Update must include the configured ST Bluetooth stack")

    radio = CoproBinary(radio_path)
    address = radio.get_flash_load_addr()
    offset = address - 0x08000000
    footer = radio.img_sig
    # The WB55 stores the flash boundary in pages and the CPU2 boot vector in words.
    boundaries = {
        "SFSA": offset // footer.FLASH_PAGE_SIZE,
        "SBRV": offset // 4,
        "SBRSA": footer.sram2a_1ks,
        "SNBRSA": footer.sram2b_1ks,
    }
    baseline = OptionBytesData(ROOT / "scripts/ob.data")
    for option in baseline.obs:
        if option.name in boundaries:
            option.value = boundaries[option.name]
    expected = baseline.gen_values().export()
    version = bytes(
        (
            footer.version_major,
            footer.version_minor,
            footer.version_sub,
            footer.version_branch,
            footer.version_build,
            get_stack_type(options["COPRO_STACK_TYPE"]),
        )
    )
    for key, value in {
        "Radio address": address.to_bytes(4, "little"),
        "Radio version": version,
        "OB reference": expected.reference,
        "OB mask": expected.compare_mask,
        "OB write mask": expected.write_mask,
    }.items():
        if bytes.fromhex(fields.get(key, "")) != value:
            raise ValueError(
                f"{key} does not match the bundled ST Bluetooth stack and device profile"
            )


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

    validate_radio_layout(components, manifest, options)
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
    indexed_apps, target = resource_index(
        components["resources.tar.gz"], options["FIRMWARE_APPS"]["eddy"]
    )
    community = community_artifacts(ROOT / "website/community", target)
    site = ROOT / "dist/eddy-site"
    if site.exists():
        shutil.rmtree(site)
    shutil.copytree(ROOT / "website", site, ignore=shutil.ignore_patterns("*.fap"))
    invite = os.environ.get("EDDY_TESTFLIGHT_URL", "").strip()
    if invite:
        if not re.fullmatch(r"https://testflight\.apple\.com/join/[A-Za-z0-9]{8}", invite):
            raise ValueError("Expected an Apple TestFlight public invitation")
        app_page = site / "app/index.html"
        app_page.write_text(app_page.read_text().replace(
            '<p id="beta-availability">TestFlight invitations aren’t open yet.</p>',
            f'<p id="beta-availability"><a class="small-cta" href="{invite}">Join the TestFlight beta</a></p>',
        ))
    shutil.copy2(package, site / "firmware" / package.name)
    parts_dir = site / "firmware" / version
    parts_dir.mkdir()
    community_dir = parts_dir / "community"
    community_dir.mkdir()
    for app_id, (_, data) in community.items():
        (community_dir / (app_id + ".fap")).write_bytes(data)
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
        communityApps={app_id: meta for app_id, (meta, _) in community.items()},
        catalogCompatibility=catalog_compatibility(
            package.with_name(f"flipper-z-f7-sdk-{version}.zip"), target, version
        ),
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
