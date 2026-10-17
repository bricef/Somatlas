"""Build a closed body hull from the anatomy surfaces.

Z-Anatomy has no single skin surface: the integument is a patchwork of region
meshes. The computed X-ray needs a closed body volume to supply the
soft-tissue baseline, so we rasterise the outer anatomy into a voxel grid,
close small gaps, fill the interior, and extract a smooth surface.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage
from skimage import measure


def _surface_points(positions: np.ndarray, indices: np.ndarray, spacing: float) -> np.ndarray:
    """Vertices plus enough random samples per triangle to leave no voxel gaps."""
    tri = positions[indices]  # (M, 3, 3)
    area = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
    per_tri = np.ceil(area / (0.25 * spacing * spacing)).astype(np.int64)
    pts = [positions]
    big = per_tri > 1
    if big.any():
        reps = np.repeat(np.nonzero(big)[0], per_tri[big])
        rng = np.random.default_rng(0)
        u, v = rng.random(len(reps)), rng.random(len(reps))
        flip = u + v > 1
        u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
        t = tri[reps]
        pts.append(t[:, 0] + u[:, None] * (t[:, 1] - t[:, 0]) + v[:, None] * (t[:, 2] - t[:, 0]))
    return np.concatenate(pts)


def build_hull(surfaces: list[tuple[np.ndarray, np.ndarray]], spacing: float = 0.004, close_iterations: int = 3):
    """surfaces: [(positions (N,3), indices (M,3))]. Returns (positions, indices, stats)."""
    pts = np.concatenate([_surface_points(p, i, spacing) for p, i in surfaces])
    pad = (close_iterations + 3) * spacing
    lo = pts.min(axis=0) - pad
    hi = pts.max(axis=0) + pad
    shape = np.ceil((hi - lo) / spacing).astype(int) + 1
    grid = np.zeros(shape, dtype=bool)
    ijk = np.floor((pts - lo) / spacing).astype(int)
    grid[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True

    # Close gaps between patches, fill the inside, then undo the dilation.
    structure = ndimage.generate_binary_structure(3, 1)
    solid = ndimage.binary_dilation(grid, structure, iterations=close_iterations)
    solid = ndimage.binary_fill_holes(solid)
    solid = ndimage.binary_erosion(solid, structure, iterations=close_iterations)

    # Keep the largest connected body.
    labels, n = ndimage.label(solid)
    if n > 1:
        sizes = ndimage.sum(solid, labels, range(1, n + 1))
        solid = labels == (int(np.argmax(sizes)) + 1)

    smooth = ndimage.gaussian_filter(solid.astype(np.float32), sigma=1.0)
    verts, faces, _, _ = measure.marching_cubes(smooth, level=0.5, spacing=(spacing,) * 3)
    verts = (verts + lo).astype(np.float32)
    faces = faces.astype(np.uint32)
    # marching_cubes winds faces so normals point towards lower values (outwards);
    # verify with the signed volume and flip if needed.
    tri = verts[faces]
    volume = np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum() / 6.0
    if volume < 0:
        faces = faces[:, ::-1].copy()
        volume = -volume
    stats = {
        "voxel_m": spacing,
        "grid": shape.tolist(),
        "filled_voxels": int(solid.sum()),
        "volume_litres": round(float(volume) * 1000, 1),
        "triangles": int(len(faces)),
    }
    return verts, faces, stats


def vertex_normals(positions: np.ndarray, indices: np.ndarray) -> np.ndarray:
    tri = positions[indices]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n = np.zeros_like(positions)
    for k in range(3):
        np.add.at(n, indices[:, k], fn)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    return n.astype(np.float32)
