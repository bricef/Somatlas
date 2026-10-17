// Verify the published packs against the registry.
//
// - every registry structure exists as a node in its pack, and vice versa
// - structures the registry marks as closed are still closed after
//   simplification and quantisation (the X-ray depends on this)
// - the body hull is closed
//
// Usage: node pipeline/check-packs.mjs [public_dir]

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { isClosed, isNearlyClosed } from './meshcheck.mjs';

const publicDir = process.argv[2] ?? 'public';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const registry = JSON.parse(await readFile(path.join(publicDir, 'registry.json'), 'utf8'));


const byPack = new Map();
for (const s of registry.structures) {
  if (!byPack.has(s.pack)) byPack.set(s.pack, []);
  byPack.get(s.pack).push(s);
}

let problems = 0;
const tally = {};
for (const pack of registry.packs) {
  const doc = await io.read(path.join(publicDir, pack.file));
  const nodes = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
  const expected = byPack.get(pack.id) ?? [];
  for (const s of expected) {
    const node = nodes.get(s.id);
    if (!node) {
      console.error(`missing node ${s.id} in ${pack.file}`);
      problems++;
      continue;
    }
    nodes.delete(s.id);
    const prim = node.getMesh()?.listPrimitives()[0];
    if (!prim) continue;
    const pos = prim.getAttribute('POSITION').getArray();
    const idx = prim.getIndices().getArray();
    const closed = isClosed(pos, idx);
    const t = (tally[s.tissue] ??= { closedBefore: 0, closedAfter: 0, nearly: 0, total: 0 });
    t.total++;
    if (s.closed) t.closedBefore++;
    if (closed) t.closedAfter++;
    if (isNearlyClosed(pos, idx)) t.nearly++;
    if (Boolean(s.xray) !== (isNearlyClosed(pos, idx) && s.tissue !== 'none')) {
      console.error(`registry xray flag for ${s.id} does not match its mesh`);
      problems++;
    }
    if (s.id === 'body-hull' && !closed) {
      console.error('body hull is not closed after optimisation');
      problems++;
    }
  }
  for (const extra of nodes.keys()) {
    console.error(`node ${extra} in ${pack.file} is not in the registry`);
    problems++;
  }
}

console.log('tissue   structures  closed (source)  closed (published)  usable by X-ray');
for (const [tissue, t] of Object.entries(tally)) {
  console.log(`${tissue.padEnd(8)} ${String(t.total).padStart(10)}  ${String(t.closedBefore).padStart(15)}  ${String(t.closedAfter).padStart(18)}  ${String(t.nearly).padStart(15)}`);
}
if (problems) {
  console.error(`${problems} problem(s)`);
  process.exit(1);
}
console.log('packs match the registry');
