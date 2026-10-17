// Automatic exposure: choose the film window from what is actually in the
// beam, like a radiographer adjusting for a lateral versus a PA view.

export interface Exposure {
  level: number;
  window: number;
}

/**
 * Pick level/window from sampled attenuation values (sum of mu * L per pixel).
 * Pixels outside the body (near zero) are ignored. Returns null when too few
 * pixels are covered to judge.
 */
export function autoExposure(samples: ArrayLike<number>, stride = 1, minPixels = 40): Exposure | null {
  const values: number[] = [];
  for (let i = 0; i < samples.length; i += stride) {
    const v = samples[i];
    if (v > 0.05 && Number.isFinite(v)) values.push(v);
  }
  if (values.length < minPixels) return null;
  values.sort((a, b) => a - b);
  const at = (q: number) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  // Thin edges of the body sit near the bottom of the range; keep the level
  // above zero so empty background stays black. Ignore the densest 2% (bone
  // overlaps, contrast) so they saturate rather than flatten everything else.
  const lo = at(0.05);
  const hi = at(0.98);
  const level = Math.max(0, lo * 0.5);
  return { level: round1(level), window: round1(Math.min(40, Math.max(hi - level, 0.5))) };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Only worth re-applying when the change is visible. */
export function exposureChanged(a: Exposure, b: Exposure): boolean {
  return Math.abs(a.level - b.level) > 0.15 * b.window || Math.abs(a.window - b.window) > 0.12 * b.window;
}
