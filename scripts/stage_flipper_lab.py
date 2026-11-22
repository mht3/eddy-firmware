"""Stage the official Flipper Lab catalog for the firmware served by GitHub Pages."""

import argparse
import hashlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path
import re
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zipfile import ZipFile

CATALOG = "https://catalog.flipperzero.one/api/v0"
ROOT = Path(__file__).resolve().parents[1]
PAGE_SIZE = 500
# Small, frequently used utilities with a one-click download. Other catalog apps
# use the same package check on a download made directly from Flipper Lab.
MIRRORS = {"f0_claude_remote", "dice_app", "sudoku"}
# These are stable category IDs from the official /0/category endpoint.
UTILITIES = {
    "64971d11577d519190ede5c5": re.compile(r"\b(clock|timer|stopwatch|calculator)$", re.I),
    "64971d116617ba37a4bc79bc": re.compile(r"\b(player|tracker|tuner|metronome|tuning fork)$", re.I),
}

MAX_DOWNLOAD = 16 * 1024 * 1024
ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,47}")
VERSION_ID = re.compile(r"[0-9a-f]{24}")
API = re.compile(r"(\d+)\.(\d+)")


class DownloadTooLarge(ValueError):
    pass


def download(url):
    request = Request(url, headers={"User-Agent": "Eddy-Firmware/catalog-release"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=45) as response:
                content = response.read(MAX_DOWNLOAD + 1)
            break
        except (URLError, TimeoutError) as error:
            if attempt == 2 or (isinstance(error, HTTPError) and error.code < 500 and error.code != 429):
                raise
            time.sleep(2 ** attempt)
    if len(content) > MAX_DOWNLOAD:
        raise DownloadTooLarge("Catalog file exceeds the 16 MiB limit: " + url)
    return content


def records(target=None, api=None):
    """Paginate in creation order so newly added entries do not shift page boundaries."""
    apps = {}
    offset = 0
    while True:
        params = dict(limit=PAGE_SIZE, offset=offset, sort_by="created_at", sort_order=1)
        if target:
            params.update(target=target, api=api)
        query = urlencode(params)
        page = json.loads(download(CATALOG + "/0/application?" + query))
        if not isinstance(page, list):
            raise ValueError("Flipper Lab returned an invalid application list")
        for item in page:
            alias = item["alias"]
            if not ID.fullmatch(alias):
                continue
            version = item["current_version"]
            version_id = version["_id"]
            if not VERSION_ID.fullmatch(version_id):
                raise ValueError("Invalid catalog version ID for " + alias)
            record = dict(name=version["name"], description=version.get("short_description") or "",
                          versionId=version_id, category=item["category_id"])
            build = version.get("current_build") or {}
            sdk = build.get("sdk") or {}
            if (target and sdk.get("target") == target and API.fullmatch(sdk.get("api") or "")
                    and re.fullmatch(r"[0-9a-f]{64}", build.get("fap_hash") or "")):
                record.update(api=sdk["api"], sha256=build["fap_hash"])
            apps[alias] = record
        if len(page) < PAGE_SIZE:
            break
        offset += len(page)
    if not apps:
        raise ValueError("Flipper Lab returned an empty catalog")
    return apps


def notice_from_source(source):
    """Keep complete source and upstream notices for mirrored, redistributable builds."""
    with ZipFile(io.BytesIO(source)) as archive:
        notices = [
            entry for entry in archive.infolist()
            if re.fullmatch(r"code/(?:licen[cs]e|copying|notice)(?:\.(?:txt|md))?",
                            entry.filename, re.IGNORECASE)
        ]
        if not notices or sum(e.file_size for e in notices) > 512 * 1024:
            return None
        notice = "\n\n".join(archive.read(e).decode("utf-8") for e in notices)
    # Mirror only recognized upstream grants. Other apps can still be selected
    # from an official download, without Eddy redistributing their FAPs.
    normalized = " ".join(notice.split()).lower()
    gpl = " ".join((ROOT / "LICENSE").read_text().split()).lower()
    terms = gpl[gpl.index("0. definitions.") : gpl.index("end of terms and conditions")]
    mit = " ".join((ROOT / "website/community/techart_calendar.LICENSE.txt").read_text().split()).lower()
    if terms in normalized or mit[mit.index("permission is hereby granted") :] in normalized:
        return notice
    return None


def stage_mirror(directory, alias, record):
    version_id = record["versionId"]
    version_url = CATALOG + "/application/version/" + version_id
    source = download(version_url + "/bundle")
    notice = notice_from_source(source)
    if not notice:
        print("Official download required for " + alias + " (no supported license notice)")
        return
    data = download(version_url + "/build/f7/" + record["api"])
    if hashlib.sha256(data).hexdigest() != record["sha256"]:
        raise ValueError("Official build digest differs from catalog metadata: " + alias)
    (directory / (alias + ".source.zip")).write_bytes(source)
    (directory / (alias + ".LICENSE.txt")).write_text(
        record["name"] + "\nFlipper Lab: https://lab.flipper.net/apps/" + alias +
        "\nUpstream source bundle: " + version_url + "/bundle\n\n" + notice, encoding="utf-8")
    (directory / (alias + ".fap")).write_bytes(data)
    record["mirrored"] = True


def stage(manifest):
    build = json.loads(manifest.read_text(encoding="utf-8"))
    compat = build["catalogCompatibility"]
    version = build["version"]
    if (not re.fullmatch(r"eddy-[\w.-]+", version)
            or compat["catalog"] != f"{version}/lab/index.json"
            or compat["target"] != "f7" or not API.fullmatch(compat["api"])):
        raise ValueError("Invalid Eddy catalog target or path")
    directory = manifest.parent / version / "lab"
    # The filtered catalog omits apps without a matching build. Keep their names
    # as well so a valid link can explain the version mismatch.
    apps = records()
    apps.update(records(compat["target"], compat["api"]))
    directory.mkdir(parents=True, exist_ok=True)
    # Stage before replacing any files. The index is published after all FAPs
    # and notices have arrived and passed their digest checks.
    with tempfile.TemporaryDirectory(dir=directory.parent) as temp:
        temp_dir = Path(temp)
        for alias, record in sorted(apps.items()):
            pattern = UTILITIES.get(record.pop("category"))
            match = alias in MIRRORS or (pattern and pattern.search(record["name"]))
            if match and record.get("sha256"):
                try:
                    stage_mirror(temp_dir, alias, record)
                except DownloadTooLarge:
                    print("Official download required for " + alias + " (large source bundle)")
        index = dict(date=datetime.now(timezone.utc).date().isoformat(),
                     target=compat["target"], api=compat["api"], apps=apps)
        for path in sorted(temp_dir.iterdir()):
            path.replace(directory / path.name)
        index_path = temp_dir / "index.json"
        index_path.write_text(json.dumps(index, separators=(",", ":")) + "\n", encoding="utf-8")
        index_path.replace(directory / "index.json")
    print(f"Staged {len(apps)} Flipper Lab entries and "
          f"{sum(bool(r.get('mirrored')) for r in apps.values())} mirrors in {directory}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="Path to the staged firmware/main.json")
    stage(parser.parse_args().manifest)
