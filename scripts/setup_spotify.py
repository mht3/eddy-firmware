"""Configure the Spotify companion and Flipper QR in a personal development checkout."""

import argparse
import io
import re
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SCREEN = 64


def configure(root, site, client_id, card_file):
    import segno

    address = urlsplit(site)
    if (
        address.scheme != "https"
        or not address.hostname
        or address.username is not None
        or address.password is not None
        or not address.path.endswith("/spotify/")
        or any(c.isspace() or ord(c) < 32 for c in site)
        or any(c in site for c in "?#\\")
        or not site.isascii()
    ):
        raise ValueError(
            "Use the full HTTPS address of your own /spotify/ page, ending in a slash."
        )
    if not re.fullmatch("[a-fA-F0-9]{32}", client_id):
        raise ValueError(
            "Enter the 32-character Client ID shown in your Spotify app settings."
        )

    qr = segno.make_qr(site + "#link", error="L")
    matrix = list(qr.matrix_iter(border=4))
    side = len(matrix)
    if side > SCREEN:
        raise ValueError(
            "This address is too long for the Flipper display. Use a shorter site address."
        )
    bitmap = bytearray(SCREEN * SCREEN // 8)
    for y in range(SCREEN):
        for x in range(SCREEN):
            if matrix[y * side // SCREEN][x * side // SCREEN]:
                bitmap[(y * SCREEN + x) // 8] |= 1 << (x % 8)

    preview = io.BytesIO()
    qr.save(preview, kind="png", scale=1, border=4)
    rows = [
        "    " + ", ".join(f"0x{byte:02x}" for byte in bitmap[start : start + 16]) + ","
        for start in range(0, len(bitmap), 16)
    ]
    header = "\n".join(
        [
            "#pragma once",
            "#include <stdint.h>",
            "",
            "static const uint8_t spotify_setup_qr[] = {",
        ]
        + rows
        + ["};", ""]
    )
    config = root / "website/spotify/config.js"
    updated, count = re.subn(
        r"^export const spotifyClientId = '[^']*';$",
        f"export const spotifyClientId = '{client_id}';",
        config.read_text(),
        flags=re.MULTILINE,
    )
    if count != 1:
        raise ValueError(
            "Cannot identify spotifyClientId in website/spotify/config.js."
        )

    card_file.write_bytes(bitmap)
    (root / "applications/main/eddy_spotify/setup_qr.h").write_text(header)
    (root / "website/spotify/guide-qr.png").write_bytes(preview.getvalue())
    config.write_text(updated)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--site", required=True, help="Your hosted HTTPS /spotify/ callback"
    )
    parser.add_argument(
        "--client-id", required=True, help="Spotify Developer Dashboard Client ID"
    )
    args = parser.parse_args()
    try:
        configure(ROOT, args.site, args.client_id, Path("setup.qr"))
    except (ValueError, OSError) as error:
        parser.exit(1, f"{error}\n")
    except ModuleNotFoundError:
        parser.exit(
            1, "Install the QR generator with python3 -m pip install 'segno>=1.6,<2'.\n"
        )
    print(f"Publish your configured companion at {args.site}")
    print(
        "Personal firmware builds now include your QR. For an existing Eddy installation,"
    )
    print("copy setup.qr to SD Card/apps_data/eddy_spotify/ and reopen Apps → Spotify.")


if __name__ == "__main__":
    main()
