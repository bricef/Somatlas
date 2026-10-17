import { describe, expect, it } from 'vitest';
import { autoExposure, exposureChanged } from './exposure';

describe('autoExposure', () => {
  it('ignores empty background and spans the body', () => {
    const samples = [...new Array(500).fill(0), ...Array.from({ length: 500 }, (_, i) => 2 + (i / 500) * 8)];
    const e = autoExposure(samples)!;
    expect(e.level).toBeLessThan(2.1);
    expect(e.level + e.window).toBeGreaterThan(9.5);
  });

  it('returns null when almost nothing is in the beam', () => {
    expect(autoExposure([0, 0, 0, 3, 4])).toBeNull();
  });

  it('respects a stride, e.g. the red channel of RGBA data', () => {
    const rgba: number[] = [];
    for (let i = 0; i < 200; i++) rgba.push(5, 999, 999, 999);
    const e = autoExposure(rgba, 4)!;
    expect(e.level).toBeLessThanOrEqual(5);
    expect(e.level + e.window).toBeLessThan(10);
  });
});

describe('exposureChanged', () => {
  it('ignores tiny drifts and reacts to real changes', () => {
    expect(exposureChanged({ level: 1.5, window: 9 }, { level: 1.6, window: 9.1 })).toBe(false);
    expect(exposureChanged({ level: 4, window: 14 }, { level: 1.5, window: 9 })).toBe(true);
  });
});
