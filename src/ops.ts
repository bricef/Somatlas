// Operation registry: every user-visible action is defined once, and the
// interface surfaces (buttons, keyboard shortcuts, URL state, and later an MCP
// adapter) are derived from these definitions rather than written by hand.

export interface UrlBinding<S, I> {
  /** Query parameter name. */
  param: string;
  /** Serialise the current state for this operation, or null to omit it. */
  encode: (state: S) => string | null;
  /** Turn a parameter value back into this operation's input. */
  decode: (value: string) => I | undefined;
}

export interface Operation<C, S, I> {
  name: string;
  label: string;
  /** KeyboardEvent.key that triggers the operation with `shortcutInput`. */
  shortcut?: string;
  shortcutInput?: I;
  url?: UrlBinding<S, I>;
  run: (ctx: C, input: I) => void | Promise<void>;
}

export class Operations<C extends { state: S }, S = C['state']> {
  // Operations are heterogeneous in their input type; the registry erases it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly ops = new Map<string, Operation<C, S, any>>();
  private readonly listeners = new Set<(name: string) => void>();

  constructor(private readonly ctx: C) {}

  define<I>(op: Operation<C, S, I>): Operation<C, S, I> {
    if (this.ops.has(op.name)) throw new Error(`operation ${op.name} defined twice`);
    this.ops.set(op.name, op);
    return op;
  }

  get(name: string) {
    return this.ops.get(name);
  }

  list() {
    return [...this.ops.values()];
  }

  async run<I>(name: string, input: I): Promise<void> {
    const op = this.ops.get(name);
    if (!op) throw new Error(`unknown operation ${name}`);
    await op.run(this.ctx, input);
    for (const l of this.listeners) l(name);
  }

  /** Called after every operation, e.g. to refresh UI and the URL. */
  onChange(listener: (name: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- Derived surface: URL state -------------------------------------------

  toSearchParams(): URLSearchParams {
    const params = new URLSearchParams();
    for (const op of this.ops.values()) {
      if (!op.url) continue;
      const v = op.url.encode(this.ctx.state);
      if (v !== null) params.set(op.url.param, v);
    }
    return params;
  }

  /** Replays URL state by running each bound operation, in definition order. */
  async applySearchParams(params: URLSearchParams): Promise<void> {
    for (const op of this.ops.values()) {
      if (!op.url) continue;
      const raw = params.get(op.url.param);
      if (raw === null) continue;
      const input = op.url.decode(raw);
      if (input !== undefined) await this.run(op.name, input);
    }
  }

  // --- Derived surface: keyboard --------------------------------------------

  shortcutFor(name: string): string | undefined {
    return this.ops.get(name)?.shortcut;
  }

  bindKeyboard(target: Window): void {
    target.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      for (const op of this.ops.values()) {
        if (op.shortcut && op.shortcut === e.key) {
          e.preventDefault();
          void this.run(op.name, op.shortcutInput);
          return;
        }
      }
    });
  }
}
