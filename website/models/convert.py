"""Convert the original STEP sources in this directory to web-ready glTF 2.0."""

import argparse
import collections
import gzip
import json
from pathlib import Path
import struct
import subprocess
import tempfile


def read_glb(path):
    data = path.read_bytes()
    json_size = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20 : 20 + json_size]), data[28 + json_size :]


def values(doc, data, index):
    accessor = doc["accessors"][index]
    view = doc["bufferViews"][accessor["bufferView"]]
    offset = accessor.get("byteOffset", 0) + view.get("byteOffset", 0)
    count = accessor["count"]
    component = {5123: "H", 5125: "I", 5126: "f"}[accessor["componentType"]]
    width = {"VEC3": 3, "SCALAR": 1}[accessor["type"]]
    size = struct.calcsize("<" + component * width) * count
    return list(
        struct.iter_unpack("<" + component * width, data[offset : offset + size])
    )


# OCCT exports individual analytic CAD faces. Use the extrema of each face
# so material boundaries coincide with machined contours on the STEP part.
def shell_material(bounds, p):
    xmin, xmax, ymin, ymax, zmin, zmax = bounds
    x, y, z = p
    if (
        zmin >= 0.29
        and xmin >= -28.15
        and xmax <= -6.84
        and ymin >= 40.84
        and ymax <= 68.82
        and zmax > 1.75
    ):
        if (
            zmin > 2.08
            and (xmax - xmin < 3.4 and ymax - ymin < 3.6)
            and (abs(x + 17.5) > 4 or abs(y - 51.5) > 4)
        ):
            return "Key legend"
        return "Key orange"
    if 0.25 < z < 1.3 and 40 < y < 70 and -29 < x < -6.3:
        return "Key well"
    if (
        zmin > 1.4
        and xmin >= -28.41
        and xmax <= -6.58
        and ymin >= 0.99
        and ymax <= 38.01
    ):
        return "Screen lens"
    if (
        -10.5 < z < -6.8
        and -13.6 < x < -4.85
        and 67 < y < 76
        and xmax - xmin < 9.4
        and zmax - zmin < 4.2
    ):
        return "Jack metal" if ymin > 75.65 else "Jack insert"
    if (
        x < -30
        and -13 < z < -4.5
        and ((-4 < y < 18.2) or (32 < y < 59.7))
        and ymax - ymin < 27
        and zmax - zmin < 5
    ):
        return "GPIO"
    return "Case"


PALETTE = {
    "Case": "#eee9df",
    "Key orange": "#f57925",
    "Key well": "#8a8174",
    "Key legend": "#db691c",
    "Screen lens": "#343530",
    "GPIO": "#3a3833",
    "Jack insert": "#1c1c19",
    "Jack metal": "#aaa9a2",
    "Shell metal": "#bcc2c2",
    "Insulator": "#252825",
    "Contacts": "#d2ac60",
}


def pack(source, output, is_plug):
    doc, data = read_glb(source)
    vertices = {}
    groups = collections.defaultdict(list)
    for primitive in doc["meshes"][0]["primitives"]:
        a = primitive["attributes"]
        pos = values(doc, data, a["POSITION"])
        nrm = values(doc, data, a["NORMAL"])
        index = values(doc, data, primitive["indices"])
        if is_plug:
            material = ["Shell metal", "Insulator", "Contacts", "Contacts"][
                primitive["material"]
            ]
        else:
            # Recover the source STEP XYZ from glTF metres.
            source_points = [(x * 1000, -z * 1000, y * 1000) for x, y, z in pos]
            bounds = [v for axis in zip(*source_points) for v in (min(axis), max(axis))]
            center = [(bounds[i] + bounds[i + 1]) / 2 for i in (0, 2, 4)]
            material = shell_material(bounds, center)
        remap = []
        for (x, y, z), (nx, ny, nz) in zip(pos, nrm):
            if is_plug:
                point = (0.00695 - y, -z, x)
                normal = (-ny, -nz, nx)
            else:
                point = (-z - 0.02614, -x - 0.01355, y + 0.0102)
                normal = (-nz, -nx, ny)
            vertex = tuple(round(v, 7) for v in point + normal)
            remap.append(vertices.setdefault(vertex, len(vertices)))
        groups[material].extend(remap[i] for i, in index)

    binary = bytearray()
    views, accessors = [], []

    def append(array, fmt, kind, component, target):
        while len(binary) % 4:
            binary.append(0)
        offset = len(binary)
        for row in array:
            binary.extend(struct.pack("<" + fmt, *row))
        view = {
            "buffer": 0,
            "byteOffset": offset,
            "byteLength": len(binary) - offset,
            "target": target,
        }
        views.append(view)
        acc = {
            "bufferView": len(views) - 1,
            "componentType": component,
            "count": len(array),
            "type": kind,
        }
        accessors.append(acc)
        return len(accessors) - 1

    points = [v[:3] for v in vertices]
    position = append(points, "3f", "VEC3", 5126, 34962)
    accessors[position].update(
        min=list(map(min, zip(*points))), max=list(map(max, zip(*points)))
    )
    normal = append([v[3:] for v in vertices], "3f", "VEC3", 5126, 34962)
    primitives, materials = [], []
    for name, indices in groups.items():
        rgb = bytes.fromhex(PALETTE[name][1:])
        linear = [((channel / 255 + 0.055) / 1.055) ** 2.4 for channel in rgb]
        materials.append(
            {
                "name": name,
                "pbrMetallicRoughness": {
                    "baseColorFactor": linear + [1],
                    "roughnessFactor": 0.48,
                    "metallicFactor": 0.88 if "metal" in name.lower() else 0.0,
                },
            }
        )
        idx = append([(i,) for i in indices], "H", "SCALAR", 5123, 34963)
        primitives.append(
            {
                "attributes": {"POSITION": position, "NORMAL": normal},
                "indices": idx,
                "material": len(materials) - 1,
            }
        )

    gltf = {
        "asset": {
            "version": "2.0",
            "generator": "Eddy Firmware / KiCad / Open CASCADE",
            "copyright": (
                "KiCad library contributors (CC BY-SA 4.0)"
                if is_plug
                else "Flipper Devices Inc. (GPL-3.0)"
            ),
        },
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [
            {
                "name": "USB-C plug" if is_plug else "Flipper Zero F7B9C6",
                "primitives": primitives,
            }
        ],
        "buffers": [{"byteLength": len(binary)}],
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
    }
    metadata = json.dumps(gltf, separators=(",", ":")).encode()
    metadata += b" " * (-len(metadata) % 4)
    binary.extend(bytes(-len(binary) % 4))
    output.write_bytes(
        struct.pack(
            "<4sIIII",
            b"glTF",
            2,
            28 + len(metadata) + len(binary),
            len(metadata),
            0x4E4F534A,
        )
        + metadata
        + struct.pack("<I4s", len(binary), b"BIN\0")
        + binary
    )
    print(
        f"{output.name}: {len(vertices)} vertices, {sum(map(len, groups.values())) // 3} triangles"
    )


def export_step(kicad, source, output, temporary):
    # Use a board with a single model and omit its board body. The CAD importer
    # supplies smooth analytic surface normals and respects STEP materials.
    step = temporary / "part.step"
    step.write_bytes(gzip.decompress(source.read_bytes()))
    board = temporary / "part.kicad_pcb"
    board.write_text(
        f"""(kicad_pcb (version 20241229) (generator pcbnew) (general (thickness 1.6))
(layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
(setup (pad_to_mask_clearance 0))
(footprint "Model" (layer "F.Cu") (at 0 0) (attr through_hole)
(property "Reference" "U1" (at 0 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.1))))
(model "{step.as_posix()}" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0))))
(gr_rect (start -10 -10) (end 10 10) (stroke (width 0.05) (type default))
(fill none) (layer "Edge.Cuts")))"""
    )
    subprocess.run(
        [
            kicad,
            "pcb",
            "export",
            "glb",
            "--no-board-body",
            "--force",
            "-o",
            str(output),
            str(board),
        ],
        check=True,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kicad-cli", default="kicad-cli")
    opts = parser.parse_args()
    directory = Path(__file__).resolve().parent
    for source, target, is_plug in [
        ("flipper-zero.stp.gz", "flipper-zero.glb", False),
        ("usb-c.step.gz", "usb-c.glb", True),
    ]:
        with tempfile.TemporaryDirectory() as scratch:
            temp = Path(scratch)
            export_step(opts.kicad_cli, directory / source, temp / "model.glb", temp)
            pack(temp / "model.glb", directory / target, is_plug)
