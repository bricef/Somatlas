import './style.css';
import { defineOperations, initialState, type AppContext } from './app';
import { loadRegistry } from './registry';
import { Viewer } from './scene/viewer';
import { buildUi } from './ui';

const BASE = import.meta.env.BASE_URL;

async function main() {
  const root = document.getElementById('app')!;
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const registry = await loadRegistry(BASE);
  const viewer = new Viewer(canvas, registry);
  const ctx: AppContext = { state: initialState(), registry, viewer, base: BASE };

  let refresh = () => {};
  const ops = defineOperations(ctx, () => refresh());
  refresh = buildUi(ctx, ops, root);

  // Derived surface: keyboard shortcuts.
  ops.bindKeyboard(window);

  // Derived surface: URL state. Replay it first, then keep it in sync.
  const params = new URLSearchParams(location.search);
  if (!params.has('l')) params.set('l', [...ctx.state.layers].join(','));
  await ops.applySearchParams(params);
  ops.onChange(() => {
    refresh();
    const q = ops.toSearchParams().toString();
    history.replaceState(null, '', q ? `?${q}` : location.pathname);
  });
  refresh();
  document.body.classList.add('ready');
}

main().catch((err) => {
  console.error(err);
  document.getElementById('app')!.insertAdjacentHTML('beforeend', `<p class="fatal">Somatlas could not start: ${String(err)}</p>`);
});
