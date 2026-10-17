"""Audit Z-Anatomy meshes for real-time display and X-ray suitability.

For every anatomy object (meshes, and bevelled curves converted to meshes) this
records triangle counts and the properties the computed X-ray needs: a closed
surface (no boundary or non-manifold edges), consistent winding, and positive
volume. Results are written as JSON (per object) and Markdown (summary).

Usage:
    python3 -I pipeline/audit.py <Startup.blend> <out_dir>
"""

import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402  (must come first: it puts bmesh on sys.path)
import bmesh  # noqa: E402

import blendprep  # noqa: E402
import zanatomy  # noqa: E402


def measure(obj, depsgraph):
    ev = obj.evaluated_get(depsgraph)
    me = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.transform(obj.matrix_world)
    # Measure geometric closedness: seams where vertices are duplicated only
    # for normals or UVs (e.g. curve caps) are not holes.
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    non_manifold = sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
    inconsistent = sum(1 for e in bm.edges if e.is_manifold and not e.is_contiguous)
    degenerate = sum(1 for f in bm.faces if f.calc_area() < 1e-12)
    volume = bm.calc_volume(signed=True) if bm.faces else 0.0
    xs = [v.co.x for v in bm.verts] or [0]
    ys = [v.co.y for v in bm.verts] or [0]
    zs = [v.co.z for v in bm.verts] or [0]
    result = {
        "verts": len(bm.verts),
        "tris": len(bm.faces),
        "boundary_edges": boundary,
        "non_manifold_edges": non_manifold,
        "inconsistent_edges": inconsistent,
        "degenerate_tris": degenerate,
        "watertight": boundary == 0 and non_manifold == 0 and len(bm.faces) > 0,
        "winding_consistent": inconsistent == 0,
        "volume_m3": volume,
        "bbox": [[min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)]],
    }
    bm.free()
    ev.to_mesh_clear()
    return result


def main(blend_path: str, out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    blendprep.open_blend(blend_path)
    candidates = blendprep.anatomy_objects()

    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()

    rows = []
    for obj, info in candidates:
        m = measure(obj, depsgraph)
        mirrored = obj.matrix_world.determinant() < 0
        # bm.transform() bakes a mirroring transform without reversing faces, so a
        # mirrored but otherwise correct mesh reports negative volume.
        m["mirrored"] = mirrored
        m["inside_out"] = (m["volume_m3"] < 0) != mirrored
        rows.append({"name": obj.name, "id": zanatomy.structure_id(obj.name), "type": obj.type, **info, **m})

    with open(os.path.join(out_dir, "audit.json"), "w") as f:
        json.dump(rows, f, indent=1)

    # Summary by layer and by X-ray tissue class.
    def summarise(key):
        groups = collections.defaultdict(list)
        for r in rows:
            groups[r[key]].append(r)
        lines = [f"| {key} | structures | triangles | watertight | consistent winding | inside-out | mirrored |", "|---|---|---|---|---|---|---|"]
        for k in sorted(groups):
            g = groups[k]
            n = len(g)
            wt = sum(r["watertight"] for r in g)
            wc = sum(r["winding_consistent"] for r in g)
            inv = sum(r["inside_out"] for r in g)
            mir = sum(r["mirrored"] for r in g)
            lines.append(f"| {k} | {n} | {sum(r['tris'] for r in g):,} | {wt} ({100*wt/n:.0f}%) | {wc} ({100*wc/n:.0f}%) | {inv} | {mir} |")
        return "\n".join(lines)

    allx = [r["bbox"] for r in rows if r["tris"]]
    lo = [min(b[0][i] for b in allx) for i in range(3)]
    hi = [max(b[1][i] for b in allx) for i in range(3)]
    nc = sorted(r["name"] for r in rows if r["nc_suspect"])
    ids = collections.Counter(r["id"] for r in rows)
    dupes = sorted(i for i, c in ids.items() if c > 1)
    xray = [r for r in rows if r["tissue"] != "none"]
    xray_ok = sum(r["watertight"] and r["winding_consistent"] for r in xray)

    md = [
        "# Z-Anatomy mesh audit",
        "",
        f"Source: {zanatomy.ZANATOMY_REPO} @ `{zanatomy.ZANATOMY_COMMIT[:7]}`",
        "",
        f"- Anatomy objects: **{len(rows)}** ({sum(r['type'] == 'CURVE' for r in rows)} converted from curves)",
        f"- Triangles: **{sum(r['tris'] for r in rows):,}**",
        f"- Model extent (m): x {lo[0]:.3f}..{hi[0]:.3f}, y {lo[1]:.3f}..{hi[1]:.3f}, z {lo[2]:.3f}..{hi[2]:.3f} (height {hi[2]-lo[2]:.3f})",
        f"- X-ray-eligible objects that are closed with consistent winding: **{xray_ok} of {len(xray)}** ({100*xray_ok/max(1,len(xray)):.0f}%)",
        f"- Objects flagged as possibly non-commercial (published in separate -nc packs): **{len(nc)}**",
        f"- Duplicate structure ids: **{len(dupes)}** (disambiguated by system on export)",
        "",
        "## By layer",
        "",
        summarise("layer"),
        "",
        "## By X-ray tissue class",
        "",
        summarise("tissue"),
        "",
        "## Possibly non-commercial objects",
        "",
        "\n".join(f"- {n}" for n in nc) or "- none",
        "",
    ]
    if dupes:
        md += ["## Duplicate ids", "", "\n".join(f"- `{d}`" for d in dupes[:50]), ""]
    with open(os.path.join(out_dir, "audit.md"), "w") as f:
        f.write("\n".join(md))
    print("\n".join(md[:12]))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
