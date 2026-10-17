"""Export Z-Anatomy into Somatlas asset packs.

Produces, in <out_dir>:
  raw/<pack>.glb      one node per structure, world space, glTF axes (+Y up)
  registry.json       the structure registry (single source of truth for the app)
  content.json        short descriptions keyed by content key
  hull-stats.json     how the closed body hull was built

The Node step (pipeline/optimize.mjs) then simplifies and compresses the packs.

Usage:
    python3 -I pipeline/export.py <Startup.blend> <TA2.csv> <out_dir>
"""

import collections
import csv
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402  (must come first: it puts bmesh on sys.path)
import bmesh  # noqa: E402
import numpy as np  # noqa: E402

import blendprep  # noqa: E402
import gltfwrite  # noqa: E402
import hull  # noqa: E402
import zanatomy  # noqa: E402

LICENCES = {
    "by-sa": {
        "licence": "CC BY-SA 4.0",
        "attribution": [
            "BodyParts3D, (c) The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan",
            "Z-Anatomy, the libre 3D atlas of anatomy, CC BY-SA 4.0 (Gauthier Kervyn, Marcin Zielinski and contributors)",
            "Adapted for Somatlas: converted, simplified and compressed",
        ],
    },
    "nc": {
        "licence": "CC BY-NC-SA 4.0 / CC BY-NC 4.0 (provenance unconfirmed)",
        "attribution": [
            "Possibly from third-party models bundled in Z-Anatomy: 'Anatomy of the Inner Ear', University of Dundee School of Medicine, CC BY-NC-SA 4.0; 'Kidney', Lissie Cowley, CC BY-NC 4.0",
            "Otherwise BodyParts3D (DBCLS, CC BY-SA 2.1 JP) via Z-Anatomy (CC BY-SA 4.0)",
            "Kept separate from BY-SA packs; non-commercial use only",
        ],
    },
}

SYSTEM_LABELS = {
    "integumentary": "Integumentary", "skeletal": "Skeletal", "muscular": "Muscular",
    "nervous": "Nervous", "endocrine": "Endocrine", "cardiovascular": "Cardiovascular",
    "lymphatic": "Lymphatic", "respiratory": "Respiratory", "digestive": "Digestive",
    "urinary": "Urinary", "reproductive": "Reproductive", "visceral": "Visceral (unassigned)",
}
LAYER_LABELS = {
    "skin": "Skin", "fascia": "Fascia", "muscles-superficial": "Superficial muscles", "muscles-deep": "Deep muscles",
    "vessels": "Vessels", "nerves": "Nerves", "organs": "Organs", "skeleton": "Skeleton", "hull": "Body outline",
}


def to_gltf_axes(a: np.ndarray) -> np.ndarray:
    """Blender is +Z up; glTF is +Y up. (x, y, z) -> (x, z, -y)."""
    return np.stack([a[:, 0], a[:, 2], -a[:, 1]], axis=1).astype(np.float32)


def split_by_surface(positions, normals, tris, face_surface):
    """Give every vertex a single surface by duplicating the vertices shared by
    faces of different surfaces. The copies keep the same position and normal,
    so shading stays continuous and the mesh stays closed by position (the
    simplifier keeps such seams together)."""
    lo, hi = int(face_surface.min(initial=0)), int(face_surface.max(initial=0))
    if lo == hi:
        return positions, normals, tris, np.full(len(positions), lo, np.uint8)
    key = tris.reshape(-1).astype(np.int64) * 256 + np.repeat(face_surface.astype(np.int64), 3)
    unique, inverse = np.unique(key, return_inverse=True)
    v = unique // 256
    return positions[v], normals[v], inverse.reshape(-1, 3).astype(np.uint32), (unique % 256).astype(np.uint8)


def triangle_areas(positions, tris):
    a, b, c = positions[tris[:, 0]], positions[tris[:, 1]], positions[tris[:, 2]]
    return 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)


def extract(obj, layer, depsgraph, scratch_mesh):
    ev = obj.evaluated_get(depsgraph)
    me = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    ev.to_mesh_clear()
    bm.transform(obj.matrix_world)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    if not bm.faces:
        bm.free()
        return None
    # Repair small holes (a few missing triangles are common upstream); leave
    # genuinely open sheets such as fasciae alone.
    boundary = [e for e in bm.edges if e.is_boundary]
    if 0 < len(boundary) <= 64:
        bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
    defects = sum(1 for e in bm.edges if not e.is_manifold)
    closed = defects == 0
    # Mirrored objects (negative-determinant transforms) come out inside-out once
    # the transform is baked; some upstream meshes are inside-out anyway. Orient
    # every closed or nearly closed mesh outwards so the X-ray's front/back test
    # is reliable. (For open sheets the volume sign is meaningless; leave them.)
    if defects <= 64 and bm.calc_volume(signed=True) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.normal_update()
    bm.to_mesh(scratch_mesh)
    bm.free()

    scratch_mesh.calc_loop_triangles()
    nv, nt = len(scratch_mesh.vertices), len(scratch_mesh.loop_triangles)
    co = np.empty(nv * 3, np.float32)
    scratch_mesh.vertices.foreach_get("co", co)
    no = np.empty(nv * 3, np.float32)
    scratch_mesh.vertex_normals.foreach_get("vector", no)
    tri = np.empty(nt * 3, np.int64)
    scratch_mesh.loop_triangles.foreach_get("vertices", tri)
    tri = tri.reshape(-1, 3).astype(np.uint32)

    # Per-face tissue surface from the upstream material in that face's slot.
    poly = np.empty(nt, np.int64)
    scratch_mesh.loop_triangles.foreach_get("polygon_index", poly)
    mat_index = np.empty(len(scratch_mesh.polygons), np.int64)
    scratch_mesh.polygons.foreach_get("material_index", mat_index)
    slots = [s.material.name if s.material else None for s in obj.material_slots]
    slot_surface = np.array([zanatomy.surface_of_material(m, layer) for m in slots] or [0], np.uint8)
    face_surface = slot_surface[np.clip(mat_index[poly], 0, len(slot_surface) - 1)]

    positions, normals = to_gltf_axes(co.reshape(-1, 3)), to_gltf_axes(no.reshape(-1, 3))
    areas = triangle_areas(positions, tri)
    surface_area = {zanatomy.SURFACES[k]: float(areas[face_surface == k].sum()) for k in np.unique(face_surface)}
    positions, normals, tri, surface = split_by_surface(positions, normals, tri, face_surface)
    return {
        "positions": positions,
        "normals": normals,
        "indices": tri,
        "surface": surface,
        "surface_area": surface_area,
        "closed": closed,
    }


def load_ta2(path: str) -> dict:
    """TA2.csv rows are whole quoted lines with ';'-separated fields."""
    table = {}
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip().strip('"')
            if not line or line.startswith("TA2ID"):
                continue
            row = next(csv.reader(io.StringIO(line), delimiter=";"))
            if len(row) >= 3 and row[0].isdigit():
                table.setdefault(row[1].strip().lower(), {"ta2": int(row[0]), "latin": row[2].strip()})
    return table


def clean_definition(text: str) -> str:
    lines = [ln.strip() for ln in text.splitlines()]
    body = [ln for ln in lines if ln and not (ln.isupper() and len(ln) < 120)]
    s = re.sub(r"\s+", " ", " ".join(body)).strip()
    if len(s) > 700:
        cut = s.rfind(". ", 0, 700)
        s = s[: cut + 1] if cut > 200 else s[:700].rstrip() + "…"
    return s


def main(blend_path: str, ta2_path: str, out_dir: str) -> None:
    raw_dir = os.path.join(out_dir, "raw")
    os.makedirs(raw_dir, exist_ok=True)

    blendprep.open_blend(blend_path)
    objects = blendprep.anatomy_objects()
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    scratch = bpy.data.meshes.new("somatlas-scratch")

    ta2 = load_ta2(ta2_path)
    texts = {t.name: t.as_string() for t in bpy.data.texts}

    packs = collections.defaultdict(list)
    structures, content = [], {}
    seen_ids = collections.Counter()
    hull_inputs = []
    lung_inputs = {"left": [], "right": []}

    for obj, info in objects:
        data = extract(obj, info["layer"], depsgraph, scratch)
        if data is None:
            continue
        sid = zanatomy.structure_id(obj.name)
        if seen_ids[sid]:
            sid = f"{sid}-{info['system']}"
        seen_ids[zanatomy.structure_id(obj.name)] += 1
        seen_ids[sid] += 1

        base = zanatomy.base_name(obj.name)
        display = base.replace("(", "").replace(")", "").strip()
        content_key = zanatomy.structure_id(base)
        if content_key not in content and base in texts:
            summary = clean_definition(texts[base])
            if summary:
                content[content_key] = summary

        pack = info["layer"] + ("-nc" if info["nc_suspect"] else "")
        packs[pack].append({
            "name": sid, "positions": data["positions"], "normals": data["normals"], "indices": data["indices"],
            "surface": data["surface"], "extras": {"id": sid},
        })

        entry = {
            "id": sid,
            "name": display,
            "side": zanatomy.side_of(obj.name),
            "system": info["system"],
            "layer": info["layer"],
            "tissue": zanatomy.refine_tissue(info["tissue"], data["surface_area"]),
            "pack": pack,
            "closed": data["closed"],
            "sourceName": obj.name,
        }
        if base.startswith("("):
            entry["variant"] = True
        if content_key in content:
            entry["contentKey"] = content_key
        t = ta2.get(display.lower())
        if t:
            entry["ta2"] = t["ta2"]
            entry["latin"] = t["latin"]
        if info["nc_suspect"]:
            entry["licence"] = "nc"
        structures.append(entry)

        if info["layer"] in ("skin", "fascia", "muscles-superficial", "muscles-deep", "skeleton"):
            hull_inputs.append((data["positions"], data["indices"]))
        if info["tissue"] == "lung":
            # The lobe meshes are open at the hilum; display them, but let the
            # X-ray use a closed volume generated from them instead.
            lung_inputs[zanatomy.lung_side(obj.name)].append((data["positions"], data["indices"]))
            entry["tissue"] = "none"

    # Closed body hull for the X-ray soft-tissue baseline and a smooth outline.
    hv, hf, hstats = hull.build_hull(hull_inputs)
    packs["hull"].append({
        "name": "body-hull", "positions": hv, "normals": hull.vertex_normals(hv, hf),
        "indices": hf, "extras": {"id": "body-hull"},
    })
    structures.append({
        "id": "body-hull", "name": "Body outline", "side": None, "system": "integumentary",
        "layer": "hull", "tissue": "hull", "pack": "hull", "closed": True, "generated": True,
        "sourceName": None,
    })

    lung_stats = {}
    for side, surfaces in lung_inputs.items():
        if not surfaces:
            continue
        lv, lf, lstats = hull.build_hull(surfaces, spacing=0.003, close_iterations=4)
        lid = f"lung-volume-{side}"
        packs["organs"].append({"name": lid, "positions": lv, "normals": hull.vertex_normals(lv, lf), "indices": lf, "extras": {"id": lid}})
        structures.append({
            "id": lid, "name": f"{side.capitalize()} lung (volume)", "side": side, "system": "respiratory",
            "layer": "organs", "tissue": "lung", "pack": "organs", "closed": True, "generated": True,
            "xrayOnly": True, "sourceName": None,
        })
        lung_stats[side] = lstats
    hstats = {"body": hstats, "lungs": lung_stats}

    surface_tris = collections.Counter()
    for prims in packs.values():
        for p in prims:
            if "surface" in p:
                for k, n in zip(*np.unique(p["surface"][p["indices"][:, 0]], return_counts=True)):
                    surface_tris[zanatomy.SURFACES[k]] += int(n)

    pack_meta = []
    for key in sorted(packs):
        layer = key.removesuffix("-nc")
        lic = "nc" if key.endswith("-nc") else "by-sa"
        gltfwrite.write_glb(os.path.join(raw_dir, f"{key}.glb"), packs[key])
        pack_meta.append({
            "id": key,
            "file": f"packs/{key}.glb",
            "layer": layer,
            "licence": LICENCES[lic]["licence"],
            "attribution": LICENCES[lic]["attribution"] if key != "hull" else
                ["Generated by Somatlas from the BY-SA meshes (voxelised, filled and resurfaced)"] + LICENCES["by-sa"]["attribution"][:2],
            "structures": len(packs[key]),
            "rawTriangles": int(sum(len(p["indices"]) for p in packs[key])),
        })

    used_systems = sorted({s["system"] for s in structures})
    registry = {
        "version": 1,
        "source": {"repo": zanatomy.ZANATOMY_REPO, "commit": zanatomy.ZANATOMY_COMMIT},
        "units": "metre",
        "up": "+Y",
        "front": "+Z",
        "layers": [{"id": lid, "label": LAYER_LABELS[lid], "order": i} for i, lid in enumerate(zanatomy.LAYER_ORDER + ["hull"])],
        "surfaces": zanatomy.SURFACES,
        "systems": [{"id": s, "label": SYSTEM_LABELS[s]} for s in used_systems],
        "packs": pack_meta,
        "structures": structures,
    }
    with open(os.path.join(out_dir, "registry.json"), "w") as f:
        json.dump(registry, f, indent=1)
    with open(os.path.join(out_dir, "content.json"), "w") as f:
        json.dump({
            "source": "Z-Anatomy definitions, largely from Wikipedia (CC BY-SA 3.0 / 4.0)",
            "licence": "CC BY-SA 4.0",
            "entries": content,
        }, f, separators=(",", ":"), ensure_ascii=False)
    with open(os.path.join(out_dir, "hull-stats.json"), "w") as f:
        json.dump(hstats, f, indent=1)

    print(json.dumps({
        "structures": len(structures),
        "with_ta2": sum("ta2" in s for s in structures),
        "with_content": sum("contentKey" in s for s in structures),
        "surface_triangles": surface_tris,
        "packs": {p["id"]: [p["structures"], p["rawTriangles"]] for p in pack_meta},
        "hull": hstats,
    }, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
