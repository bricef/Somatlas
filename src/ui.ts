// DOM panel. Every control calls an operation; nothing here mutates state
// directly, so the URL and keyboard stay in step with the UI for free.

import * as THREE from 'three';
import type { AppContext } from './app';
import type { Operations } from './ops';
import { loadContent } from './registry';
import { SURFACES } from './scene/palette';
import { exposureChanged } from './xray/exposure';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

export function buildUi(ctx: AppContext, ops: Operations<AppContext>, root: HTMLElement) {
  const { registry, viewer } = ctx;
  const key = (name: string) => {
    const k = ops.shortcutFor(name);
    return k ? ` (${k === 'Escape' ? 'Esc' : k.toUpperCase()})` : '';
  };

  // --- Mode ---------------------------------------------------------------
  const anatomyBtn = el('button', { type: 'button' }, 'Anatomy');
  const xrayBtn = el('button', { type: 'button', title: `Toggle${key('mode.toggle')}` }, 'X-ray');
  anatomyBtn.onclick = () => ops.run('mode.set', 'anatomy');
  xrayBtn.onclick = () => ops.run('mode.set', 'xray');

  // --- Search (derived from the registry) ---------------------------------
  const list = el('datalist', { id: 'structures' });
  const labelToId = new Map<string, string>();
  for (const e of registry.searchEntries()) {
    labelToId.set(e.label, e.id);
    list.append(el('option', { value: e.label }));
  }
  const search = el('input', { type: 'search', list: 'structures', placeholder: `Search ${labelToId.size.toLocaleString()} structures`, 'aria-label': 'Search structures' });
  search.addEventListener('change', () => {
    const id = labelToId.get(search.value);
    if (id) void ops.run('structure.focus', id);
  });

  // --- Layers (derived from the registry) ----------------------------------
  const layerRows = registry.layers.map((layer) => {
    const box = el('input', { type: 'checkbox', id: `layer-${layer.id}` });
    const status = el('span', { class: 'muted' });
    box.addEventListener('change', () => ops.run('layer.toggle', { layer: layer.id, on: box.checked }));
    const label = layer.id === 'hull' ? 'Body outline (soft tissue)' : layer.label;
    const row = el('label', { class: 'row', for: `layer-${layer.id}` }, box, el('span', {}, label), el('span', { class: 'muted' }, mb(registry.layerBytes(layer.id))), status);
    return { layer: layer.id, box, status, row };
  });

  // --- Tissue key (derived from the surfaces in the visible layers) ---------
  const tissueList = el('ul', { class: 'key' });
  const tissueKey = el('section', {}, el('h2', {}, 'Tissues'), tissueList);
  let tissueShown = '';
  function renderTissueKey(layers: Set<string>, mode: string) {
    const surfaces = mode === 'xray' ? [] : registry.surfacesIn(layers).filter((n) => SURFACES[n]);
    tissueKey.hidden = surfaces.length === 0;
    const k = surfaces.join();
    if (k === tissueShown) return;
    tissueShown = k;
    tissueList.replaceChildren(...surfaces.map((n) =>
      el('li', {}, el('span', { class: 'swatch', style: `background:${SURFACES[n].colour}` }), SURFACES[n].label)));
  }

  // --- X-ray controls -----------------------------------------------------
  const slider = (label: string, min: number, max: number, step: number, field: 'kv' | 'level' | 'window') => {
    const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    const value = el('output');
    input.addEventListener('input', () =>
      ops.run('xray.set', field === 'kv' ? { kv: Number(input.value) } : { [field]: Number(input.value), autoExposure: false }));
    return { field, input, value, row: el('label', { class: 'row' }, el('span', {}, label), input, value) };
  };
  const sliders = [slider('kV', 40, 150, 1, 'kv'), slider('Level', 0, 15, 0.1, 'level'), slider('Window', 0.5, 40, 0.1, 'window')];
  const auto = el('input', { type: 'checkbox', id: 'auto-exposure' });
  auto.addEventListener('change', () => ops.run('xray.set', { autoExposure: auto.checked }));
  const autoRow = el('label', { class: 'row', for: 'auto-exposure' }, auto, el('span', {}, 'Automatic exposure'));
  const xraySection = el('section', {}, el('h2', {}, 'Exposure'), ...sliders.map((s) => s.row), autoRow,
    el('p', { class: 'muted' }, 'The scan set is the visible layers. Drag to move the source. Tap the image to identify a shadow.'));

  // --- Selection ----------------------------------------------------------
  const selection = el('section', { class: 'card' });
  const probe = el('section', { class: 'card' });

  // --- Tools --------------------------------------------------------------
  const reset = el('button', { type: 'button' }, `Reset view${key('view.reset')}`);
  reset.onclick = () => ops.run('view.reset', undefined);
  const bench = el('button', { type: 'button' }, `Benchmark${key('bench.run')}`);
  bench.onclick = () => ops.run('bench.run', undefined);
  const resolution = el('select', { 'aria-label': 'Render resolution' },
    ...[['1', 'Full resolution'], ['0.75', '75% resolution'], ['0.5', '50% resolution']].map(([v, t]) => el('option', { value: v }, t)));
  resolution.addEventListener('change', () => viewer.setResolutionScale(Number(resolution.value)));
  const benchOut = el('pre', { class: 'bench' });
  const credits = el('details', {}, el('summary', {}, 'Credits and licences'),
    ...registry.data.packs.map((p) => el('p', { class: 'muted' }, el('strong', {}, `${p.id}: ${p.licence}. `), p.attribution.join('. '))),
    el('p', { class: 'muted' }, 'Descriptions: Z-Anatomy definitions, largely from Wikipedia (CC BY-SA). X-ray attenuation: NIST mass attenuation coefficients (ICRU-44 tissues). Educational only, not medical advice.'));

  const toggle = el('button', { type: 'button', class: 'panel-toggle', 'aria-expanded': 'true' }, 'Hide panel');
  const panel = el('aside', { class: 'panel' },
    el('header', {}, el('h1', {}, 'Somatlas'), el('span', { class: 'muted' }, 'P0 spike'), toggle),
    el('div', { class: 'body' },
      el('div', { class: 'modes' }, anatomyBtn, xrayBtn),
      search, list,
      el('section', {}, el('h2', {}, 'Layers'), ...layerRows.map((r) => r.row)),
      tissueKey, xraySection, selection, probe,
      el('section', { class: 'tools' }, reset, bench, resolution),
      benchOut, credits));
  toggle.onclick = () => {
    const hidden = panel.classList.toggle('collapsed');
    toggle.textContent = hidden ? 'Show panel' : 'Hide panel';
    toggle.setAttribute('aria-expanded', String(!hidden));
  };
  const statsEl = el('div', { class: 'stats' });
  root.append(panel, statsEl);

  // --- Canvas: tap to select / identify, drag to orbit ---------------------
  const canvas = viewer.renderer.domElement;
  let down: { x: number; y: number; t: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 500) return;
    const r = canvas.getBoundingClientRect();
    const ndc = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
    if (ctx.state.mode === 'xray') void ops.run('xray.probe', ndc);
    else {
      const sid = viewer.pick(new THREE.Vector2(ndc.x, ndc.y));
      void ops.run('structure.select', sid === null ? null : registry.structures[sid].id);
    }
  });
  viewer.controls.addEventListener('end', () => void ops.run('camera.set', viewer.cameraState()));

  // --- Refresh from state -------------------------------------------------
  let shownKey: string | undefined;
  async function renderSelection() {
    const id = ctx.state.selected;
    const k = `${id}|${ctx.state.isolate}|${ctx.state.mode}`;
    if (k === shownKey) return;
    shownKey = k;
    selection.replaceChildren();
    if (!id) {
      selection.append(el('p', { class: 'muted' }, ctx.state.mode === 'xray' ? '' : 'Tap a structure to see what it is.'));
      return;
    }
    const s = registry.byId.get(id)!;
    const iso = el('button', { type: 'button' }, ctx.state.isolate ? `Show all systems${key('system.isolateSelected')}` : `Isolate ${registry.systems.get(s.system)} system${key('system.isolateSelected')}`);
    iso.onclick = () => ops.run('system.isolateSelected', undefined);
    const desc = el('p', { class: 'desc muted' }, '…');
    selection.append(
      el('h2', {}, registry.label(s)),
      el('p', { class: 'muted' }, [s.latin, s.ta2 ? `TA2 ${s.ta2}` : null].filter(Boolean).join(' · ')),
      el('p', {}, `${registry.systems.get(s.system)} system · ${registry.layers.find((l) => l.id === s.layer)?.label ?? s.layer}`),
      desc,
      ...(s.licence === 'nc' ? [el('p', { class: 'warn' }, 'Possibly from a non-commercial model (see credits).')] : []),
      iso,
    );
    if (s.contentKey) {
      const content = await loadContent(ctx.base);
      if (ctx.state.selected === id) desc.textContent = content[s.contentKey] ?? '';
    } else desc.textContent = 'No description yet.';
  }

  function refresh() {
    const st = ctx.state;
    anatomyBtn.classList.toggle('active', st.mode === 'anatomy');
    xrayBtn.classList.toggle('active', st.mode === 'xray');
    document.body.classList.toggle('xray', st.mode === 'xray');
    xraySection.hidden = st.mode !== 'xray';
    for (const r of layerRows) {
      r.box.checked = st.layers.has(r.layer);
      r.status.textContent = st.loading.has(r.layer) ? 'loading…' : '';
    }
    renderTissueKey(st.layers, st.mode);
    auto.checked = st.autoExposure;
    for (const s of sliders) {
      s.input.value = String(st[s.field]);
      s.value.textContent = s.field === 'kv' ? `${st.kv}` : st[s.field].toFixed(1);
    }
    void renderSelection();
    probe.hidden = st.mode !== 'xray' || !st.probe;
    probe.replaceChildren();
    if (st.probe) {
      probe.append(el('h2', {}, 'This shadow is mostly'));
      if (!st.probe.length) probe.append(el('p', { class: 'muted' }, 'Nothing in the scan set along this ray.'));
      for (const h of st.probe) {
        const s = registry.byId.get(h.id)!;
        const b = el('button', { type: 'button', class: 'link' }, registry.label(s));
        b.onclick = () => ops.run('structure.select', s.id);
        probe.append(el('p', {}, b, el('span', { class: 'muted' }, ` ${h.lengthCm.toFixed(1)} cm of ${s.tissue}`)));
      }
    }
    benchOut.textContent = st.bench ?? '';
    benchOut.hidden = !st.bench;
  }

  // Automatic exposure: re-meter a few times a second while in X-ray mode.
  let metering = false;
  setInterval(async () => {
    if (metering || ctx.state.mode !== 'xray' || !ctx.state.autoExposure) return;
    metering = true;
    try {
      const e = await viewer.meterExposure();
      if (e && ctx.state.autoExposure && exposureChanged(e, { level: ctx.state.level, window: ctx.state.window })) await ops.run('xray.set', e);
    } finally {
      metering = false;
    }
  }, 400);

  setInterval(() => {
    const v = viewer.stats;
    statsEl.textContent = `${v.fps.toFixed(0)} fps · ${v.frameMs.toFixed(1)} ms · ${(v.triangles / 1e6).toFixed(2)}M tris · ${v.calls} draws${viewer.floatBlend ? '' : ' · fp16'}`;
  }, 500);

  return refresh;
}
