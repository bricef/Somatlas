// Display colours, keyed by system (presentation lives in the app; the
// registry only says which system a structure belongs to).

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

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Small, stable per-structure brightness jitter so neighbours read apart. */
function jitter(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return 0.9 + ((h >>> 0) % 1000) / 5000;
}

export function colourFor(s: Structure): [number, number, number] {
  let hex = SYSTEM_COLOURS[s.system] ?? '#bbbbbb';
  if (s.id === 'body-hull') hex = HULL;
  else if (s.system === 'cardiovascular' && /\bvein|venous|vena|venae|sinus/i.test(s.name)) hex = VEIN;
  const k = jitter(s.id);
  return hexToRgb(hex).map((c) => Math.min(255, Math.round(c * k))) as [number, number, number];
}
