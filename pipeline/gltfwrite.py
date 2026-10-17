"""Minimal GLB writer: one node and mesh per anatomical structure.

Kept deliberately small and dependency-free (numpy only) so the pipeline's
output is easy to reason about. Compression and simplification happen later
in the Node optimisation step.
"""

from __future__ import annotations

import json
import struct

import numpy as np

FLOAT, UINT16, UINT32 = 5126, 5123, 5125
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963


def write_glb(path: str, primitives: list[dict], asset_extras: dict | None = None) -> None:
    """primitives: [{name, positions (N,3) f32, normals (N,3) f32, indices (M,3) u32, extras}]"""
    blob = bytearray()
    buffer_views, accessors, meshes, nodes = [], [], [], []

    def add_view(data: bytes, target: int) -> int:
        while len(blob) % 4:
            blob.append(0)
        buffer_views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data), "target": target})
        blob.extend(data)
        return len(buffer_views) - 1

    for p in primitives:
        pos = np.ascontiguousarray(p["positions"], dtype=np.float32)
        nor = np.ascontiguousarray(p["normals"], dtype=np.float32)
        idx = np.ascontiguousarray(p["indices"]).reshape(-1)
        if len(pos) == 0 or len(idx) == 0:
            continue
        if len(pos) < 65536:
            idx, ctype = idx.astype(np.uint16), UINT16
        else:
            idx, ctype = idx.astype(np.uint32), UINT32

        accessors.append({
            "bufferView": add_view(pos.tobytes(), ARRAY_BUFFER), "componentType": FLOAT,
            "count": len(pos), "type": "VEC3",
            "min": pos.min(axis=0).tolist(), "max": pos.max(axis=0).tolist(),
        })
        a_pos = len(accessors) - 1
        accessors.append({"bufferView": add_view(nor.tobytes(), ARRAY_BUFFER), "componentType": FLOAT, "count": len(nor), "type": "VEC3"})
        a_nor = len(accessors) - 1
        accessors.append({"bufferView": add_view(idx.tobytes(), ELEMENT_ARRAY_BUFFER), "componentType": ctype, "count": len(idx), "type": "SCALAR"})
        a_idx = len(accessors) - 1

        meshes.append({"name": p["name"], "primitives": [{"attributes": {"POSITION": a_pos, "NORMAL": a_nor}, "indices": a_idx, "mode": 4}]})
        nodes.append({"name": p["name"], "mesh": len(meshes) - 1, "extras": p.get("extras", {})})

    while len(blob) % 4:
        blob.append(0)
    gltf = {
        "asset": {"version": "2.0", "generator": "somatlas pipeline", **({"extras": asset_extras} if asset_extras else {})},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(blob)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", len(blob), 0x004E4942))
        f.write(blob)
