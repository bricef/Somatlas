import { describe, expect, it } from 'vitest';
import { Operations } from './ops';

interface State {
  layers: Set<string>;
  selected: string | null;
}

function setup() {
  const ctx = { state: { layers: new Set(['skin']), selected: null } as State };
  const ops = new Operations(ctx);
  ops.define<string[]>({
    name: 'layers.set',
    label: 'Set layers',
    url: {
      param: 'l',
      encode: (s) => [...s.layers].sort().join(','),
      decode: (v) => v.split(',').filter(Boolean),
    },
    run: (c, layers) => {
      c.state.layers = new Set(layers);
    },
  });
  ops.define<string | null>({
    name: 'structure.select',
    label: 'Select',
    shortcut: 'Escape',
    shortcutInput: null,
    url: { param: 's', encode: (s) => s.selected, decode: (v) => v },
    run: (c, id) => {
      c.state.selected = id;
    },
  });
  return { ctx, ops };
}

describe('Operations', () => {
  it('derives URL state from the operations that declare a binding', async () => {
    const { ops } = setup();
    await ops.run('layers.set', ['skeleton', 'organs']);
    await ops.run('structure.select', 'femur-left');
    expect(ops.toSearchParams().toString()).toBe('l=organs%2Cskeleton&s=femur-left');
  });

  it('omits parameters whose state is empty', () => {
    const { ops } = setup();
    expect(ops.toSearchParams().has('s')).toBe(false);
  });

  it('round-trips state through the URL', async () => {
    const a = setup();
    await a.ops.run('layers.set', ['nerves', 'skeleton']);
    await a.ops.run('structure.select', 'heart');
    const b = setup();
    await b.ops.applySearchParams(a.ops.toSearchParams());
    expect([...b.ctx.state.layers].sort()).toEqual(['nerves', 'skeleton']);
    expect(b.ctx.state.selected).toBe('heart');
  });

  it('notifies listeners after each operation', async () => {
    const { ops } = setup();
    const seen: string[] = [];
    ops.onChange((n) => seen.push(n));
    await ops.run('structure.select', 'x');
    expect(seen).toEqual(['structure.select']);
  });

  it('rejects duplicate definitions and unknown operations', async () => {
    const { ops } = setup();
    expect(() => ops.define({ name: 'layers.set', label: '', run: () => {} })).toThrow();
    await expect(ops.run('nope', null)).rejects.toThrow();
  });

  it('exposes shortcuts from operation metadata', () => {
    const { ops } = setup();
    expect(ops.shortcutFor('structure.select')).toBe('Escape');
  });
});
