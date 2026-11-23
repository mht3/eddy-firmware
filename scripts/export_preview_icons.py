"""Export preview bitmaps used by the website from the firmware assets."""

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
icons = ROOT / "assets/icons"
paths = [
    *sorted((icons / "Keyboard").glob("*.png")),
    next(icons.rglob("Updating_32x40.png")),
    next(icons.rglob("Updating_Logo_62x15.png")),
    next(icons.rglob("WarningDolphin_45x42.png")),
    next(icons.rglob("InfraredLearnShort_128x31.png")),
    next(icons.rglob("DolphinMafia_119x62.png")),
    next(icons.rglob("DolphinSaved_92x58.png")),
    next(icons.rglob("DolphinReadingSuccess_59x63.png")),
    next(icons.rglob("InfraredArrowUp_4x8.png")),
    next(icons.rglob("InfraredArrowDown_4x8.png")),
    next(icons.rglob("Muted_8x8.png")),
    next(icons.rglob("Voldwn_6x6.png")),
    next(icons.rglob("Volup_8x6.png")),
    next(icons.rglob("back_10px.png")),
    next(icons.rglob("ButtonDown_7x4.png")),
    next(icons.rglob("ButtonUp_7x4.png")),
    next(icons.rglob("ButtonCenter_7x7.png")),
    next(icons.rglob("ArrowUpEmpty_14x15.png")),
]
sprites = {}
for path in paths:
    if "KeySign" in path.name:
        continue
    image = Image.open(path).convert("1")
    width, height = image.size
    rows = []
    for y in range(height):
        bits = sum((not image.getpixel((x, y))) << x for x in range(width))
        rows.append(bits.to_bytes((width + 7) // 8, "little").hex())
    sprites[path.stem.rsplit("_", 1)[0]] = [width, "".join(rows)]
output = ROOT / "website/lcd-icons.js"
output.write_text(
    "// Generated from assets/icons by scripts/export_preview_icons.py.\n"
    "export const icons = " + json.dumps(sprites, indent=2) + ";\n"
)


# Tile images are centered using the same integer division as loader_menu.c.
def mono_sprite(source):
    image = Image.open(source).convert("RGBA")
    ink = Image.new("RGBA", image.size)
    ink.putdata(
        [
            (67, 42, 20, 255) if red < 128 and alpha >= 128 else (0, 0, 0, 0)
            for red, _, _, alpha in image.getdata()
        ]
    )
    return ink


tile_names = [
    "Plugins_14",
    "Settings_14",
    "PowerOff_16x16",
    "Sub1ghz_14",
    "125khz_14",
    "NFC_14",
    "Infrared_14",
    "GPIO_14",
    "iButton_14",
    "FocusTimer_14x14",
    "Metronome_14x14",
    "RemoteLayout_14x14",
    "Ble_connected_15x15",
    "music_10px",
    "Spotify_16x16",
    "CC_Settings_16x16",
    "SDcardMounted_11x8",
    "Bluetooth_Idle_5x8",
]
tiles = Image.new("RGBA", (18 * len(tile_names), 18))
for index, name in enumerate(tile_names):
    path = next(icons.rglob(f"{name}.png"), None)
    if path is None:
        path = icons / "MainMenu" / name / "frame_01.png"
    sprite = mono_sprite(path)
    tiles.paste(sprite, (18 * index + 9 - sprite.width // 2, 9 - sprite.height // 2))
tiles.save(ROOT / "website/launcher.png")

settings_names = [
    "passport_128x64",
    "passport_happy_46x49",
    "BatteryBody_52x28",
    "FaceNormal_29x14",
    "Battery_16x16",
    "Temperature_16x16",
    "Voltage_16x16",
    "Health_16x16",
    "Certification1_103x56",
    "Certification2_46x33",
    "CertificationChina0_121x41",
    "CertificationChina1_124x47",
    "CertificationTaiwan_33x32",
    "CertificationMexico_98x41",
]
settings = [mono_sprite(next(icons.rglob(f"{name}.png"))) for name in settings_names]
sheet = Image.new("RGBA", (128, sum(sprite.height for sprite in settings)))
top = 0
for sprite in settings:
    sheet.paste(sprite, (0, top))
    top += sprite.height
sheet.save(ROOT / "website/settings-sprites.png")
