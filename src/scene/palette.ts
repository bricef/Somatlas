// Display colours (presentation lives in the app; the registry only says
// which system a structure belongs to and which tissue surface each vertex is).

import type { Structure } from '../registry';

const SYSTEM_COLOURS: Record<string, string> = {
  skeletal: '#e6dcc6',
  muscular: '#b34a3e',
  cardiovascular: '#c4413a',
  lymphatic: '#6fae5a',
  nervous: '#e3c04f',
  respiratory: '#e1a2a6',
  digestive: '#d38b74',
  urinary: '#c08a5b',
  reproductive: '#c47fa4',
  endocrine: '#9c84cf',
  integumentary: '#d8a98c',
  visceral: '#cc9a86',
};
const VEIN = '#3f63b4';
const HULL = '#9fb6cc';

/**
 * Tissue surface colours, keyed by the surface names the registry publishes.
 * Chosen to read apart from each other and from their neighbours: ivory bone,
 * blue hyaline cartilage, ochre ligament, pearly tendon against red muscle.
 */
export const SURFACES: Record<string, { label: string; colour: string }> = {
  bone: { label: 'Bone', colour: '#e6dcc6' },
  cartilage: { label: 'Cartilage', colour: '#86bcdc' },
  ligament: { label: 'Ligament and joint capsule', colour: '#c9a25a' },
  tendon: { label: 'Tendon', colour: '#e3e9ee' },
  fascia: { label: 'Fascia', colour: '#aeb7c2' },
  bursa: { label: 'Bursa', colour: '#a68fd6' },
  enamel: { label: 'Tooth enamel', colour: '#f8f5ee' },
  dentine: { label: 'Tooth root', colour: '#d8c38c' },
  fat: { label: 'Fat', colour: '#efc94c' },
};

/** Upper bound on surfaces the shader can colour (size of its uniform array). */
export const SURFACE_SLOTS = 16;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Small, stable per-structure brightness jitter so neighbours read apart. */
export function jitter(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return 0.9 + ((h >>> 0) % 1000) / 5000;
}

/** A structure's own colour (before jitter), used where a vertex has no tissue surface. */
export function colourFor(s: Structure): [number, number, number] {
  let hex = SYSTEM_COLOURS[s.system] ?? '#bbbbbb';
  if (s.id === 'body-hull') hex = HULL;
  else if (s.system === 'cardiovascular' && /\bvein|venous|vena|venae|sinus/i.test(s.name)) hex = VEIN;
  return hexToRgb(hex);
}

/**
 * Surface colours as a flat RGB array (0-1) indexed by surface id, for the
 * shader. A negative red channel means "no surface colour": slot 0
 * ("default"), unknown surfaces and unused slots take the structure's colour.
 */
export function surfaceColourArray(surfaces: string[]): Float32Array {
  if (surfaces.length > SURFACE_SLOTS) throw new Error(`${surfaces.length} surfaces; the shader has ${SURFACE_SLOTS} slots`);
  const colours = new Float32Array(SURFACE_SLOTS * 3).fill(-1);
  surfaces.forEach((name, i) => {
    const entry = SURFACES[name];
    if (i > 0 && entry) colours.set(hexToRgb(entry.colour).map((c) => c / 255), i * 3);
  });
  return colours;
}
