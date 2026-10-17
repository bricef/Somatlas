// Application wiring: state, the operations that change it, and the
// surfaces derived from those operations (UI, keyboard, URL).

import * as THREE from 'three';
import { Operations } from './ops';
import type { Registry } from './registry';
import type { Mode, Viewer, ViewState, XrayHit } from './scene/viewer';

export interface AppState extends ViewState {
  autoExposure: boolean;
  camera: number[] | null;
  loading: Set<string>;
  probe: XrayHit[] | null;
  bench: string | null;
}

export interface AppContext {
  state: AppState;
  registry: Registry;
  viewer: Viewer;
  base: string;
}

export const DEFAULT_LAYERS = ['hull', 'skeleton', 'organs'];
export const XRAY_DEFAULTS = { kv: 80, level: 1.5, window: 9 };

export function initialState(): AppState {
  return {
    mode: 'anatomy',
    layers: new Set(DEFAULT_LAYERS),
    selected: null,
    isolate: null,
    ...XRAY_DEFAULTS,
    autoExposure: true,
    camera: null,
    loading: new Set(),
    probe: null,
    bench: null,
  };
}

async function ensureLayers(ctx: AppContext, layers: Iterable<string>, refresh: () => void) {
  const pending = [...layers].filter((l) => !ctx.viewer.isLoaded(l));
  for (const l of pending) ctx.state.loading.add(l);
  refresh();
  await Promise.all(
    pending.map((l) =>
      ctx.viewer.loadLayer(ctx.base, l).finally(() => {
        ctx.state.loading.delete(l);
        ctx.viewer.apply(ctx.state);
        refresh();
      }),
    ),
  );
}

export function defineOperations(ctx: AppContext, refresh: () => void): Operations<AppContext> {
  const ops = new Operations(ctx);
  const s = () => ctx.state;
  const apply = () => ctx.viewer.apply(ctx.state);

  ops.define<Mode>({
    name: 'mode.set',
    label: 'Switch view',
    url: { param: 'm', encode: (st) => (st.mode === 'xray' ? 'xray' : null), decode: (v) => (v === 'xray' ? 'xray' : 'anatomy') },
    run: (_, mode) => {
      s().mode = mode;
      s().probe = null;
      apply();
    },
  });

  ops.define<void>({
    name: 'mode.toggle',
    label: 'Toggle X-ray',
    shortcut: 'x',
    run: async () => ops.run('mode.set', s().mode === 'xray' ? 'anatomy' : 'xray'),
  });

  ops.define<string[]>({
    name: 'layers.set',
    label: 'Set layers',
    url: {
      param: 'l',
      encode: (st) => [...st.layers].sort().join(','),
      decode: (v) => v.split(',').filter((l) => ctx.registry.packsByLayer.has(l)),
    },
    run: async (_, layers) => {
      s().layers = new Set(layers);
      apply();
      await ensureLayers(ctx, layers, refresh);
    },
  });

  ops.define<{ layer: string; on: boolean }>({
    name: 'layer.toggle',
    label: 'Toggle layer',
    run: async (_, { layer, on }) => {
      const next = new Set(s().layers);
      if (on) next.add(layer);
      else next.delete(layer);
      await ops.run('layers.set', [...next]);
    },
  });

  ops.define<string | null>({
    name: 'structure.select',
    label: 'Select structure',
    shortcut: 'Escape',
    shortcutInput: null,
    url: { param: 's', encode: (st) => st.selected, decode: (v) => (ctx.registry.byId.has(v) ? v : undefined) },
    run: async (_, id) => {
      s().selected = id;
      if (id) {
        const st = ctx.registry.byId.get(id)!;
        if (!s().layers.has(st.layer)) await ops.run('layer.toggle', { layer: st.layer, on: true });
      }
      apply();
    },
  });

  ops.define<string>({
    name: 'structure.focus',
    label: 'Find structure',
    run: async (_, id) => {
      await ops.run('structure.select', id);
      const sid = ctx.registry.indexOf.get(id);
      if (sid !== undefined) ctx.viewer.focus(sid);
      await ops.run('camera.set', ctx.viewer.cameraState());
    },
  });

  ops.define<string | null>({
    name: 'system.isolate',
    label: 'Isolate system',
    url: { param: 'iso', encode: (st) => st.isolate, decode: (v) => (ctx.registry.systems.has(v) ? v : undefined) },
    run: (_, system) => {
      s().isolate = system;
      apply();
    },
  });

  ops.define<void>({
    name: 'system.isolateSelected',
    label: 'Isolate selected system',
    shortcut: 'i',
    run: async () => {
      const sel = s().selected ? ctx.registry.byId.get(s().selected!) : null;
      await ops.run('system.isolate', s().isolate || !sel ? null : sel.system);
    },
  });

  ops.define<Partial<Pick<AppState, 'kv' | 'level' | 'window' | 'autoExposure'>>>({
    name: 'xray.set',
    label: 'X-ray exposure',
    url: {
      param: 'xr',
      // "80,auto" or "80,1.5,9" (kV, then automatic or manual level/window)
      encode: (st) =>
        st.autoExposure
          ? st.kv === XRAY_DEFAULTS.kv ? null : `${st.kv},auto`
          : `${st.kv},${st.level},${st.window}`,
      decode: (v) => {
        const [kvRaw, a, b] = v.split(',');
        const kv = Number(kvRaw);
        if (!Number.isFinite(kv)) return undefined;
        if (a === 'auto' || a === undefined) return { kv, autoExposure: true };
        const [level, window] = [Number(a), Number(b)];
        return Number.isFinite(level) && Number.isFinite(window) ? { kv, level, window, autoExposure: false } : undefined;
      },
    },
    run: (_, patch) => {
      Object.assign(s(), patch);
      apply();
    },
  });

  ops.define<{ x: number; y: number }>({
    name: 'xray.probe',
    label: 'Identify shadow',
    run: (_, ndc) => {
      s().probe = ctx.viewer.probe(new THREE.Vector2(ndc.x, ndc.y)).slice(0, 6);
    },
  });

  ops.define<number[]>({
    name: 'camera.set',
    label: 'Set camera',
    url: {
      param: 'c',
      encode: (st) => (st.camera ? st.camera.join(',') : null),
      decode: (v) => {
        const c = v.split(',').map(Number);
        return c.length === 6 && c.every(Number.isFinite) ? c : undefined;
      },
    },
    run: (_, cam) => {
      s().camera = cam;
      ctx.viewer.setCamera(cam);
    },
  });

  ops.define<void>({
    name: 'view.reset',
    label: 'Reset view',
    shortcut: 'r',
    run: async () => {
      ctx.viewer.resetView();
      s().camera = null;
    },
  });

  ops.define<void>({
    name: 'bench.run',
    label: 'Run benchmark',
    shortcut: 'b',
    run: async () => {
      s().bench = 'running…';
      refresh();
      const r = await ctx.viewer.benchmark();
      const v = ctx.viewer.stats;
      s().bench = [
        `${r.fps.toFixed(1)} fps avg, p95 ${r.p95ms.toFixed(1)} ms`,
        `${s().mode} · ${[...s().layers].sort().join('+')}`,
        `${(v.triangles / 1e6).toFixed(2)}M tris · ${v.calls} draws`,
        `${ctx.viewer.renderer.getDrawingBufferSize(new THREE.Vector2()).toArray().join('×')} px`,
        ctx.viewer.gpu,
      ].join('\n');
    },
  });

  return ops;
}
