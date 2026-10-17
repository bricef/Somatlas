// Load asset packs and merge each into one geometry.
//
// A pack holds one glTF node per structure. Drawing ~800 meshes per layer
// would cost ~800 draw calls, which phones cannot afford, so each pack is
// merged into a single geometry with a per-vertex `sid` attribute (the
// structure's index in the registry). Shaders look up per-structure state
// (visible, ghosted, selected, X-ray tissue) from a texture by `sid`.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Pack, Registry } from '../registry';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

type AnyAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function readVec3(attr: AnyAttribute, matrix: THREE.Matrix4 | THREE.Matrix3, out: Float32Array, offset: number, isNormal: boolean) {
  const v = new THREE.Vector3();
  for (let i = 0; i < attr.count; i++) {
    // getX/Y/Z de-quantise normalised attributes (KHR_mesh_quantization).
    v.set(attr.getX(i), attr.getY(i), attr.getZ(i));
    if (isNormal) v.applyMatrix3(matrix as THREE.Matrix3).normalize();
    else v.applyMatrix4(matrix as THREE.Matrix4);
    out[offset + 3 * i] = v.x;
    out[offset + 3 * i + 1] = v.y;
    out[offset + 3 * i + 2] = v.z;
  }
}

export interface MergedPack {
  pack: Pack;
  geometry: THREE.BufferGeometry;
  structures: number;
}

export async function loadPack(base: string, pack: Pack, registry: Registry): Promise<MergedPack> {
  const gltf = await loader.loadAsync(`${base}${pack.file}`);
  gltf.scene.updateMatrixWorld(true);

  const parts: { mesh: THREE.Mesh; sid: number }[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // GLTFLoader puts node extras on the parent Object3D when a node's mesh
    // becomes a child; fall back to names.
    const id = (mesh.userData.id as string) ?? (mesh.parent?.userData.id as string) ?? mesh.name;
    const sid = registry.indexOf.get(id);
    if (sid === undefined) return;
    parts.push({ mesh, sid });
  });

  let vertices = 0;
  let indices = 0;
  for (const { mesh } of parts) {
    const g = mesh.geometry;
    vertices += g.attributes.position.count;
    indices += g.index ? g.index.count : g.attributes.position.count;
  }

  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const sid = new Float32Array(vertices);
  const index = new Uint32Array(indices);
  const normalMatrix = new THREE.Matrix3();

  let vOff = 0;
  let iOff = 0;
  for (const part of parts) {
    const g = part.mesh.geometry;
    const pos = g.attributes.position as AnyAttribute;
    const nor = g.attributes.normal as AnyAttribute | undefined;
    const m = part.mesh.matrixWorld;
    readVec3(pos, m, position, vOff * 3, false);
    if (nor) readVec3(nor, normalMatrix.getNormalMatrix(m), normal, vOff * 3, true);
    sid.fill(part.sid, vOff, vOff + pos.count);
    const flip = m.determinant() < 0;
    if (g.index) {
      const src = g.index.array;
      for (let t = 0; t < g.index.count; t += 3) {
        index[iOff + t] = src[t] + vOff;
        index[iOff + t + 1] = src[flip ? t + 2 : t + 1] + vOff;
        index[iOff + t + 2] = src[flip ? t + 1 : t + 2] + vOff;
      }
      iOff += g.index.count;
    } else {
      for (let k = 0; k < pos.count; k++) index[iOff + k] = vOff + k;
      iOff += pos.count;
    }
    vOff += pos.count;
    g.dispose();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('sid', new THREE.BufferAttribute(sid, 1));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { pack, geometry, structures: parts.length };
}
