// Simplify and compress the raw packs written by pipeline/export.py, and
// publish them with the registry and content into public/.
//
// Usage: node pipeline/optimize.mjs <export_dir> [public_dir]

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { isNearlyClosed } from './meshcheck.mjs';

// Fraction of triangles to keep per layer, and the simplifier's error bound
// (relative to each structure's size). Tuned for the P0 phone budget.
export const SIMPLIFY = {
  skin: { ratio: 0.6, error: 0.002 },
  fascia: { ratio: 0.2, error: 0.006 },
  'muscles-superficial': { ratio: 0.2, error: 0.006 },
  'muscles-deep': { ratio: 0.15, error: 0.006 },
  vessels: { ratio: 0.3, error: 0.005 },
  nerves: { ratio: 0.15, error: 0.006 },
  organs: { ratio: 0.5, error: 0.002 },
  skeleton: { ratio: 0.3, error: 0.004 },
  hull: { ratio: 0.08, error: 0.002 },
};

const [exportDir, publicDir = 'public'] = process.argv.slice(2);
if (!exportDir) {
  console.error('usage: node pipeline/optimize.mjs <export_dir> [public_dir]');
  process.exit(1);
}

// _SURFACE (the per-vertex tissue surface written by export.py) is already an
// unsigned byte holding small integers; the quantiser rightly leaves it alone
// but warns once per mesh. Weld, simplify and meshopt carry it through: weld
// only merges vertices whose attributes all match, and the simplifier keeps
// attribute seams together.
class PipelineLogger extends Logger {
  warn(text) {
    if (!/Skipping _SURFACE/.test(text)) super.warn(text);
  }
}

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .setLogger(new PipelineLogger(Logger.Verbosity.INFO))
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const registry = JSON.parse(await readFile(path.join(exportDir, 'registry.json'), 'utf8'));
await mkdir(path.join(publicDir, 'packs'), { recursive: true });
const structuresById = new Map(registry.structures.map((s) => [s.id, s]));

function countTriangles(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return tris;
}

for (const pack of registry.packs) {
  const cfg = SIMPLIFY[pack.layer] ?? { ratio: 0.3, error: 0.003 };
  const doc = await io.read(path.join(exportDir, 'raw', `${pack.id}.glb`));
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: cfg.ratio, error: cfg.error }),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  // Record, per structure, whether it is still (nearly) a closed volume after
  // simplification: only those take part in the computed X-ray.
  for (const node of doc.getRoot().listNodes()) {
    const s = structuresById.get(node.getName());
    const prim = node.getMesh()?.listPrimitives()[0];
    if (!s || !prim) continue;
    const closed = isNearlyClosed(prim.getAttribute('POSITION').getArray(), prim.getIndices().getArray());
    s.xray = closed && s.tissue !== 'none';
  }
  // Which tissue surfaces the pack draws, so the app can show a matching key.
  const present = new Set();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const surface = prim.getAttribute('_SURFACE')?.getArray();
      if (surface) for (const k of surface) present.add(k);
    }
  }
  present.delete(0);
  if (present.size) pack.surfaces = registry.surfaces.filter((_, k) => present.has(k));
  const out = path.join(publicDir, pack.file);
  await io.write(out, doc);
  pack.triangles = countTriangles(doc);
  pack.bytes = (await stat(out)).size;
  console.log(`${pack.id.padEnd(22)} ${String(pack.rawTriangles).padStart(9)} -> ${String(pack.triangles).padStart(8)} tris  ${(pack.bytes / 1e6).toFixed(2)} MB`);
}

const totals = registry.packs.reduce((a, p) => ({ tris: a.tris + p.triangles, bytes: a.bytes + p.bytes }), { tris: 0, bytes: 0 });
console.log(`${'total'.padEnd(22)} ${''.padStart(9)}    ${String(totals.tris).padStart(8)} tris  ${(totals.bytes / 1e6).toFixed(2)} MB`);

await writeFile(path.join(publicDir, 'registry.json'), JSON.stringify(registry));
await writeFile(path.join(publicDir, 'content.json'), await readFile(path.join(exportDir, 'content.json')));
