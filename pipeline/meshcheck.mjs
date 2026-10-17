// Mesh checks shared by the optimiser and the pack checker.

/**
 * Edge statistics for an indexed triangle mesh, after welding vertices that
 * share a position. A closed surface has every edge shared by exactly two
 * triangles; `defects` counts the edges that are not.
 */
export function edgeStats(positions, indices) {
  const canon = new Map();
  const ids = new Uint32Array(positions.length / 3);
  for (let v = 0; v < ids.length; v++) {
    const key = `${positions[3 * v]},${positions[3 * v + 1]},${positions[3 * v + 2]}`;
    let id = canon.get(key);
    if (id === undefined) canon.set(key, (id = canon.size));
    ids[v] = id;
  }
  const edges = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = ids[indices[t + k]], b = ids[indices[t + ((k + 1) % 3)]];
      if (a === b) continue;
      const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let defects = 0;
  for (const n of edges.values()) if (n !== 2) defects++;
  return { edges: edges.size, defects };
}

/** True if every edge is shared by exactly two triangles. */
export function isClosed(positions, indices) {
  const { edges, defects } = edgeStats(positions, indices);
  return edges > 0 && defects === 0;
}

/**
 * Good enough for the computed X-ray: a handful of defective edges means a
 * pinhole that affects a few pixels, not a visibly wrong image.
 */
export function isNearlyClosed(positions, indices) {
  const { edges, defects } = edgeStats(positions, indices);
  return edges > 0 && defects <= Math.max(16, 0.003 * edges);
}
