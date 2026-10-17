import { describe, expect, it } from 'vitest';
import { Registry, type RegistryData } from '../registry';
import { colourFor, jitter, SURFACE_SLOTS, SURFACES, surfaceColourArray } from './palette';
import raw from '../../public/registry.json?raw';

const published = JSON.parse(raw) as RegistryData;

describe('surface colours', () => {
  it('has a colour and label for every surface the pipeline publishes', () => {
    expect(published.surfaces[0]).toBe('default');
    for (const name of published.surfaces.slice(1)) expect(SURFACES[name], name).toBeDefined();
    expect(published.surfaces.length).toBeLessThanOrEqual(SURFACE_SLOTS);
  });

  it('keeps tissues that sit next to each other visibly apart', () => {
    const rgb = (n: string) => [1, 3, 5].map((i) => parseInt(SURFACES[n].colour.slice(i, i + 2), 16));
    const distance = (a: string, b: string) => Math.hypot(...rgb(a).map((c, i) => c - rgb(b)[i]));
    // Wider than the +/-10% brightness jitter applied per structure.
    for (const [a, b] of [['bone', 'cartilage'], ['bone', 'ligament'], ['cartilage', 'ligament'], ['bone', 'tendon'], ['enamel', 'dentine']]) {
      expect(distance(a, b), `${a} vs ${b}`).toBeGreaterThan(40);
    }
  });

  it('packs colours by surface id, leaving default and unknown surfaces to the structure', () => {
    const c = surfaceColourArray(['default', 'cartilage', 'not-a-tissue']);
    expect(c.length).toBe(SURFACE_SLOTS * 3);
    expect(c[0]).toBeLessThan(0);
    expect(c[3]).toBeCloseTo(0x86 / 255);
    expect(c[6]).toBeLessThan(0);
    expect(c[9]).toBeLessThan(0);
  });

  it('refuses more surfaces than the shader has slots', () => {
    expect(() => surfaceColourArray(Array.from({ length: SURFACE_SLOTS + 1 }, (_, i) => `s${i}`))).toThrow();
  });

  it('encodes jitter so it fits a byte', () => {
    for (const id of ['femur-left', 'body-hull', 'x']) {
      const k = jitter(id);
      expect(k).toBeGreaterThanOrEqual(0.9);
      expect(Math.round(k * 127.5)).toBeLessThanOrEqual(255);
    }
  });
});

describe('Registry.surfacesIn', () => {
  it('lists the surfaces drawn in the given layers, in registry order', () => {
    const r = new Registry(published);
    expect(r.surfacesIn(['skeleton'])).toEqual(expect.arrayContaining(['bone', 'cartilage', 'ligament']));
    expect(r.surfacesIn(['muscles-superficial'])).toContain('tendon');
    expect(r.surfacesIn(['organs', 'hull'])).toEqual([]);
    const both = r.surfacesIn(['muscles-deep', 'skeleton']);
    expect(both).toEqual(published.surfaces.filter((s) => both.includes(s)));
  });
});

describe('structure colours', () => {
  it('colours mucous linings apart from the organ wall they line', () => {
    const byId = new Map(published.structures.map((s) => [s.id, s]));
    const lining = colourFor(byId.get('mucosa-of-stomach')!);
    const wall = colourFor(byId.get('stomach')!);
    expect(Math.hypot(...lining.map((c, i) => c - wall[i]))).toBeGreaterThan(40);
    expect(colourFor(byId.get('mucosa-of-nasal-cavity')!)).toEqual(lining);
  });
});
