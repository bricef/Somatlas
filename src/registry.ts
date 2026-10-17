// The structure registry: the single source of truth the rest of the app
// derives from (layer panel, search, picking, X-ray scan sets, credits).

import type { Tissue } from './xray/attenuation';

export interface Structure {
  id: string;
  name: string;
  side: 'left' | 'right' | null;
  system: string;
  layer: string;
  tissue: Tissue;
  pack: string;
  closed: boolean;
  xray?: boolean;
  xrayOnly?: boolean;
  generated?: boolean;
  variant?: boolean;
  contentKey?: string;
  ta2?: number;
  latin?: string;
  licence?: 'nc';
  sourceName: string | null;
}

export interface Pack {
  id: string;
  file: string;
  layer: string;
  licence: string;
  attribution: string[];
  structures: number;
  triangles: number;
  bytes: number;
}

export interface Layer {
  id: string;
  label: string;
  order: number;
}

export interface RegistryData {
  version: number;
  source: { repo: string; commit: string };
  layers: Layer[];
  systems: { id: string; label: string }[];
  packs: Pack[];
  structures: Structure[];
}

/** Registry plus the indexes every consumer needs, computed once. */
export class Registry {
  readonly structures: Structure[];
  readonly byId = new Map<string, Structure>();
  readonly indexOf = new Map<string, number>();
  readonly packsByLayer = new Map<string, Pack[]>();
  readonly layers: Layer[];
  readonly systems: Map<string, string>;

  constructor(readonly data: RegistryData) {
    this.structures = data.structures;
    data.structures.forEach((s, i) => {
      this.byId.set(s.id, s);
      this.indexOf.set(s.id, i);
    });
    for (const p of data.packs) {
      if (!this.packsByLayer.has(p.layer)) this.packsByLayer.set(p.layer, []);
      this.packsByLayer.get(p.layer)!.push(p);
    }
    this.layers = [...data.layers].sort((a, b) => a.order - b.order).filter((l) => this.packsByLayer.has(l.id));
    this.systems = new Map(data.systems.map((s) => [s.id, s.label]));
  }

  /** Human label, e.g. "Femur (left)". */
  label(s: Structure): string {
    return s.side ? `${s.name} (${s.side})` : s.name;
  }

  layerBytes(layer: string): number {
    return (this.packsByLayer.get(layer) ?? []).reduce((a, p) => a + p.bytes, 0);
  }

  /** Searchable entries, excluding generated X-ray-only helpers. */
  searchEntries(): { id: string; label: string }[] {
    return this.structures
      .filter((s) => !s.xrayOnly)
      .map((s) => ({ id: s.id, label: this.label(s) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
}

export async function loadRegistry(base: string): Promise<Registry> {
  const res = await fetch(`${base}registry.json`);
  if (!res.ok) throw new Error(`registry.json: HTTP ${res.status}`);
  return new Registry((await res.json()) as RegistryData);
}

let contentPromise: Promise<Record<string, string>> | null = null;

/** Descriptions are loaded on first use; they are not needed to render. */
export function loadContent(base: string): Promise<Record<string, string>> {
  contentPromise ??= fetch(`${base}content.json`)
    .then((r) => r.json())
    .then((j: { entries: Record<string, string> }) => j.entries);
  return contentPromise;
}
