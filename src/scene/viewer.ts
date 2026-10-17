import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import type { Registry } from '../registry';
import { effectiveCoefficients, tissueCode, type Tissue } from '../xray/attenuation';
import { autoExposure, type Exposure } from '../xray/exposure';
import { anatomyMaterial, filmMaterial, STATE_TEX_WIDTH, xrayMaterial, type SharedUniforms } from './materials';
import { loadPack, type MergedPack } from './packs';
import { colourFor } from './palette';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type Mode = 'anatomy' | 'xray';

export interface ViewState {
  mode: Mode;
  layers: Set<string>;
  selected: string | null;
  isolate: string | null;
  kv: number;
  level: number;
  window: number;
}

export interface XrayHit {
  id: string;
  lengthCm: number;
  contribution: number;
}

interface LoadedPack {
  merged: MergedPack;
  opaque: THREE.Mesh;
  ghost: THREE.Mesh;
  xray: THREE.Mesh;
}

const TARGET = new THREE.Vector3(0, 0.88, 0);
const HOME = new THREE.Vector3(0, 0.95, 3.2);

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.05, 20);
  readonly controls: OrbitControls;
  private readonly scene = new THREE.Scene();
  private readonly xrayScene = new THREE.Scene();
  private readonly filmScene = new THREE.Scene();
  private readonly filmCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly packs = new Map<string, LoadedPack>();
  private readonly loading = new Map<string, Promise<void>>();

  private readonly stateData: Uint8Array;
  private readonly shared: SharedUniforms;
  private readonly mu = { value: new Array(7).fill(0) as number[] };
  private readonly ref = { value: 2.6 };
  private readonly xrayTarget: THREE.WebGLRenderTarget;
  /** Small copy of the radiograph used to meter automatic exposure. */
  private readonly meterTarget: THREE.WebGLRenderTarget;
  private meterBroken = false;
  private readonly film: THREE.ShaderMaterial;
  private readonly tissueCodes: Uint8Array;
  readonly floatBlend: boolean;

  private mode: Mode = 'anatomy';
  private resolutionScale = 1;
  private frameTimes: number[] = [];
  private lastFrame = performance.now();
  private onFrame?: (dt: number) => void;
  stats = { fps: 0, frameMs: 0, triangles: 0, calls: 0 };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly registry: Registry) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x0b0f14, 1);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.15;
    this.controls.maxDistance = 6;
    this.resetView();

    const n = registry.structures.length;
    const h = Math.ceil(n / STATE_TEX_WIDTH);
    this.stateData = new Uint8Array(STATE_TEX_WIDTH * h * 4);
    const colourData = new Uint8Array(STATE_TEX_WIDTH * h * 4);
    this.tissueCodes = new Uint8Array(n);
    registry.structures.forEach((s, i) => {
      const [r, g, b] = colourFor(s);
      colourData.set([r, g, b, 255], i * 4);
      this.tissueCodes[i] = s.xray ? tissueCode(s.tissue as Tissue) : 0;
    });
    const stateTex = new THREE.DataTexture(this.stateData, STATE_TEX_WIDTH, h, THREE.RGBAFormat);
    const colourTex = new THREE.DataTexture(colourData, STATE_TEX_WIDTH, h, THREE.RGBAFormat);
    colourTex.needsUpdate = true;
    this.shared = { uState: { value: stateTex }, uColor: { value: colourTex } };

    this.floatBlend = this.renderer.extensions.has('EXT_float_blend');
    this.xrayTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: this.floatBlend ? THREE.FloatType : THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
    });
    this.meterTarget = new THREE.WebGLRenderTarget(96, 96, {
      type: this.floatBlend ? THREE.FloatType : THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
    });
    this.film = filmMaterial(this.xrayTarget.texture);
    this.filmScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.film));

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  get gpu(): string {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  }

  isLoaded(layer: string): boolean {
    return (this.registry.packsByLayer.get(layer) ?? []).every((p) => this.packs.has(p.id));
  }

  /** Load every pack of a layer (once). */
  async loadLayer(base: string, layer: string): Promise<void> {
    const packs = this.registry.packsByLayer.get(layer) ?? [];
    await Promise.all(
      packs.map((p) => {
        if (!this.loading.has(p.id)) {
          this.loading.set(
            p.id,
            loadPack(base, p, this.registry).then((merged) => this.addPack(merged)),
          );
        }
        return this.loading.get(p.id)!;
      }),
    );
  }

  private addPack(merged: MergedPack): void {
    const opaque = new THREE.Mesh(merged.geometry, anatomyMaterial(this.shared, 0));
    const ghost = new THREE.Mesh(merged.geometry, anatomyMaterial(this.shared, 1));
    ghost.renderOrder = 1;
    const xray = new THREE.Mesh(merged.geometry, xrayMaterial(this.shared, this.mu, this.ref));
    for (const m of [opaque, ghost, xray]) m.frustumCulled = false;
    this.scene.add(opaque, ghost);
    this.xrayScene.add(xray);
    this.packs.set(merged.pack.id, { merged, opaque, ghost, xray });
  }

  /** Recompute per-structure state from the view state. */
  apply(state: ViewState): void {
    this.mode = state.mode;
    const hullOn = state.layers.has('hull');
    this.registry.structures.forEach((s, i) => {
      let vis = 0;
      if (state.layers.has(s.layer)) {
        if (s.layer === 'hull') vis = state.mode === 'xray' ? 1 : 2;
        else if (state.isolate && s.system !== state.isolate) vis = 2;
        else vis = 1;
      }
      const o = i * 4;
      this.stateData[o] = vis;
      this.stateData[o + 1] = state.selected === s.id ? 255 : 0;
      this.stateData[o + 2] = this.tissueCodes[i];
      this.stateData[o + 3] = s.xrayOnly ? 255 : 0;
    });
    this.shared.uState.value.needsUpdate = true;
    this.mu.value = effectiveCoefficients(state.kv, hullOn);
    this.film.uniforms.uLevel.value = state.level;
    this.film.uniforms.uWindow.value = state.window;
  }

  setResolutionScale(scale: number): void {
    this.resolutionScale = scale;
    this.resize();
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.resolutionScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.xrayTarget.setSize(size.x, size.y);
  }

  resetView(): void {
    this.camera.position.copy(HOME);
    this.controls.target.copy(TARGET);
    this.controls.update();
  }

  cameraState(): number[] {
    const p = this.camera.position;
    const t = this.controls.target;
    return [p.x, p.y, p.z, t.x, t.y, t.z].map((v) => Math.round(v * 1000) / 1000);
  }

  setCamera(v: number[]): void {
    if (v.length !== 6 || v.some((x) => !Number.isFinite(x))) return;
    this.camera.position.set(v[0], v[1], v[2]);
    this.controls.target.set(v[3], v[4], v[5]);
    this.controls.update();
  }

  /** Smoothly frame a structure (bounding sphere of its vertices). */
  focus(sid: number): void {
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    for (const { merged } of this.packs.values()) {
      const pos = merged.geometry.attributes.position;
      const ids = merged.geometry.attributes.sid;
      for (let i = 0; i < ids.count; i++) {
        if (ids.getX(i) === sid) box.expandByPoint(p.fromBufferAttribute(pos, i));
      }
    }
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = Math.max(sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)), 0.25);
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist * 1.2);
    this.controls.update();
  }

  private ensureBvh(meshes: THREE.Mesh[]): void {
    for (const m of meshes) if (!m.geometry.boundsTree) m.geometry.computeBoundsTree();
  }

  private ray(ndc: THREE.Vector2): THREE.Raycaster {
    const r = new THREE.Raycaster();
    r.setFromCamera(ndc, this.camera);
    return r;
  }

  /** Structure index under a point in normalised device coordinates. */
  pick(ndc: THREE.Vector2): number | null {
    const meshes = [...this.packs.values()].map((p) => p.opaque);
    this.ensureBvh(meshes);
    const hits = this.ray(ndc).intersectObjects(meshes, false);
    for (const h of hits) {
      const geom = (h.object as THREE.Mesh).geometry;
      const sid = geom.attributes.sid.getX(h.face!.a);
      const st = this.stateData.subarray(sid * 4, sid * 4 + 4);
      if (st[0] === 1 && st[3] === 0) return sid;
    }
    return null;
  }

  /** Structures along the ray through a radiograph pixel, ranked by attenuation. */
  probe(ndc: THREE.Vector2): XrayHit[] {
    const meshes = [...this.packs.values()].map((p) => p.xray);
    this.ensureBvh(meshes);
    const hits = this.ray(ndc).intersectObjects(meshes, false);
    const crossings = new Map<number, number[]>();
    for (const h of hits) {
      const sid = (h.object as THREE.Mesh).geometry.attributes.sid.getX(h.face!.a);
      if (this.stateData[sid * 4] === 0 || this.tissueCodes[sid] === 0) continue;
      if (!crossings.has(sid)) crossings.set(sid, []);
      crossings.get(sid)!.push(h.distance);
    }
    const out: XrayHit[] = [];
    for (const [sid, ds] of crossings) {
      ds.sort((a, b) => a - b);
      let length = 0;
      for (let k = 0; k + 1 < ds.length; k += 2) length += ds[k + 1] - ds[k];
      const contribution = Math.abs(this.mu.value[this.tissueCodes[sid]]) * length;
      if (length > 0) out.push({ id: this.registry.structures[sid].id, lengthCm: length * 100, contribution });
    }
    return out.sort((a, b) => b.contribution - a.contribution);
  }

  /**
   * Meter the current radiograph at low resolution and suggest a film window.
   * Returns null if nothing is in the beam or this device cannot read back
   * floating-point render targets.
   */
  async meterExposure(): Promise<Exposure | null> {
    if (this.meterBroken || this.mode !== 'xray') return null;
    try {
      this.renderer.setRenderTarget(this.meterTarget);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.render(this.xrayScene, this.camera);
      const n = 96 * 96 * 4;
      let samples: ArrayLike<number>;
      if (this.meterTarget.texture.type === THREE.FloatType) {
        const buf = new Float32Array(n);
        // Asynchronous readback avoids stalling the GPU pipeline every meter.
        await this.renderer.readRenderTargetPixelsAsync(this.meterTarget, 0, 0, 96, 96, buf);
        samples = buf;
      } else {
        const buf = new Uint16Array(n);
        await this.renderer.readRenderTargetPixelsAsync(this.meterTarget, 0, 0, 96, 96, buf);
        samples = Array.from(buf, (h) => THREE.DataUtils.fromHalfFloat(h));
      }
      return autoExposure(samples, 4);
    } catch {
      this.meterBroken = true;
      return null;
    } finally {
      this.renderer.setRenderTarget(null);
    }
  }

  /** Measure frame times while the camera orbits once. */
  benchmark(seconds = 8): Promise<{ fps: number; p95ms: number }> {
    return new Promise((resolve) => {
      const times: number[] = [];
      const start = performance.now();
      const startAngle = Math.atan2(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z);
      const radius = Math.hypot(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z);
      this.onFrame = (dt) => {
        times.push(dt);
        const t = (performance.now() - start) / (seconds * 1000);
        const a = startAngle + t * Math.PI * 2;
        this.camera.position.x = this.controls.target.x + radius * Math.sin(a);
        this.camera.position.z = this.controls.target.z + radius * Math.cos(a);
        if (t >= 1) {
          this.onFrame = undefined;
          times.shift();
          const sorted = [...times].sort((x, y) => x - y);
          const avg = times.reduce((a2, b) => a2 + b, 0) / times.length;
          resolve({ fps: 1000 / avg, p95ms: sorted[Math.floor(sorted.length * 0.95)] });
        }
      };
    });
  }

  private frame(): void {
    const now = performance.now();
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    this.onFrame?.(dt);
    this.controls.update();
    this.ref.value = this.camera.position.distanceTo(this.controls.target);

    if (this.mode === 'xray') {
      this.renderer.setRenderTarget(this.xrayTarget);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.render(this.xrayScene, this.camera);
      this.captureStats();
      this.renderer.setRenderTarget(null);
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.render(this.filmScene, this.filmCamera);
    } else {
      this.renderer.setClearColor(0x0b0f14, 1);
      this.renderer.render(this.scene, this.camera);
      this.captureStats();
    }

    this.frameTimes.push(dt);
    if (this.frameTimes.length >= 30) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.stats.fps = 1000 / avg;
      this.stats.frameMs = avg;
      this.frameTimes = [];
    }
  }

  private captureStats(): void {
    this.stats.triangles = this.renderer.info.render.triangles;
    this.stats.calls = this.renderer.info.render.calls;
  }
}
