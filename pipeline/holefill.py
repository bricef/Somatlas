"""Close large holes in a curved surface with a smooth cap.

`bmesh.ops.holes_fill` caps a hole with one flat polygon. That is fine for the
pinholes the export repairs everywhere, but a flat disc across a 5 cm window in
a curved organ wall reads as a dent. Here each hole is filled with concentric
rings, and the new vertices are placed on a quadratic surface fitted to the
wall around the hole, so the cap continues the wall's curvature. The fit's
error at the rim is spread inwards, so the cap meets the rim exactly.

A hole at the end of a tube (where the stomach meets the duodenum, say) is not
a window in a wall: the wall runs along the hole's axis rather than across it,
so there is no surface to continue. Those get a flat cap.
"""

from __future__ import annotations

import bmesh
import numpy as np
from mathutils import Vector

FIT_RINGS = 2      # edge rings of surrounding wall used for the fit
CAP_RINGS = 3      # concentric rings of new vertices inside each cap
WINDOW_ALIGNMENT = 0.6  # mean |cos| between rim faces' normals and the hole's axis


def boundary_loops(bm) -> list[list]:
    """Boundary edges grouped into connected loops."""
    seen, loops = set(), []
    for e in bm.edges:
        if not e.is_boundary or e in seen:
            continue
        stack, loop = [e], []
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            loop.append(x)
            for v in x.verts:
                stack.extend(y for y in v.link_edges if y.is_boundary and y not in seen)
        loops.append(loop)
    return loops


def _neighbourhood(loop_verts: set, rings: int) -> set:
    """Wall vertices within `rings` edge steps of the hole's rim."""
    found, frontier = set(loop_verts), set(loop_verts)
    for _ in range(rings):
        nxt = set()
        for v in frontier:
            for e in v.link_edges:
                o = e.other_vert(v)
                if o not in found:
                    nxt.add(o)
        found |= nxt
        frontier = nxt
    return found


def _fit_frame(rim: np.ndarray, wall: np.ndarray):
    """Local frame (centre, u, v, n) from the rim, and a quadratic height
    w(u, v) = a + b u + c v + d u^2 + e uv + f v^2 fitted to the wall."""
    centre = rim.mean(axis=0)
    _, vecs = np.linalg.eigh(np.cov((rim - centre).T))
    n, u, v = vecs[:, 0], vecs[:, 2], vecs[:, 1]
    q = wall - centre
    pu, pv, pw = q @ u, q @ v, q @ n
    a = np.stack([np.ones_like(pu), pu, pv, pu * pu, pu * pv, pv * pv], axis=1)
    coef, *_ = np.linalg.lstsq(a, pw, rcond=None)
    return centre, u, v, n, coef


def _ordered(loop: list) -> list | None:
    """The loop's vertices in walking order, or None if it is not a simple loop."""
    adj: dict = {}
    for e in loop:
        a, b = e.verts
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    if any(len(n) != 2 for n in adj.values()):
        return None
    start = loop[0].verts[0]
    order, prev, cur = [start], None, start
    while True:
        nxt = adj[cur][0] if adj[cur][0] is not prev else adj[cur][1]
        if nxt is start:
            break
        order.append(nxt)
        prev, cur = cur, nxt
    return order if len(order) == len(adj) else None


def fill_smooth(bm, loops: list[list]) -> dict:
    """Cap each boundary loop: curved patches for windows in a wall, flat caps
    for tube ends. Returns how many of each were made."""
    made = {"curved": 0, "flat": 0}
    bm.normal_update()
    for loop in loops:
        order = _ordered(loop)
        rim_verts = {v for e in loop for v in e.verts}
        wall_verts = _neighbourhood(rim_verts, FIT_RINGS)
        rim = np.array([tuple(v.co) for v in rim_verts])
        wall = np.array([tuple(v.co) for v in wall_verts])
        centre, u, v, n, coef = _fit_frame(rim, wall)
        rim_faces = {f for vert in rim_verts for f in vert.link_faces}
        alignment = float(np.mean([abs(np.dot(tuple(f.normal), n)) for f in rim_faces])) if rim_faces else 0.0

        if order is None or alignment < WINDOW_ALIGNMENT:
            cap = bmesh.ops.holes_fill(bm, edges=loop, sides=0)["faces"]
            bmesh.ops.triangulate(bm, faces=cap)
            made["flat"] += 1
            continue

        # Wind the cap against the wall: the wall face on the first rim edge
        # runs one way along it, so the cap must run the other way.
        first = bm.edges.get((order[0], order[1]))
        if first.link_loops[0].vert is order[0]:
            order.reverse()

        def height(pu, pv):
            return np.stack([np.ones_like(pu), pu, pv, pu * pu, pu * pv, pv * pv], axis=-1) @ coef

        # Rings are copies of the rim scaled towards its centre in the fit's
        # plane, which cannot fold for a star-shaped rim (a window is round).
        # Heights come from the fitted surface plus the rim's residuals
        # (actual minus fitted), spread inwards by inverse distance squared,
        # so the cap has no step at the rim.
        r = np.array([tuple(x.co) for x in order]) - centre
        rim_uv = np.stack([r @ u, r @ v], axis=1)
        rim_res = r @ n - height(rim_uv[:, 0], rim_uv[:, 1])
        mid = rim_uv.mean(axis=0)

        def place(uv):
            d2 = np.sum((rim_uv - uv) ** 2, axis=1)
            wt = 1.0 / np.maximum(d2, 1e-12)
            w = float(height(uv[0], uv[1])) + float(wt @ rim_res / wt.sum())
            return bm.verts.new(Vector(centre + uv[0] * u + uv[1] * v + w * n))

        rings = [order]
        for k in range(1, CAP_RINGS + 1):
            scale = 1.0 - k / (CAP_RINGS + 1)
            rings.append([place(mid + (p - mid) * scale) for p in rim_uv])
        hub = place(mid)
        faces, m = [], len(order)
        for outer, inner in zip(rings, rings[1:]):
            for i in range(m):
                j = (i + 1) % m
                faces.append(bm.faces.new((outer[i], outer[j], inner[j], inner[i])))
        for i in range(m):
            faces.append(bm.faces.new((rings[-1][i], rings[-1][(i + 1) % m], hub)))
        bmesh.ops.triangulate(bm, faces=faces)
        made["curved"] += 1
    return made
