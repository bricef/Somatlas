// Shaders. Per-structure state lives in two small textures indexed by the
// `sid` vertex attribute, so showing, hiding, ghosting, selecting or changing
// the X-ray scan set never touches geometry.
//
// uState (RGBA8, one texel per structure):
//   r  visibility: 0 hidden, 1 shown, 2 ghosted (x255)
//   g  selected (255) or not (0)
//   b  X-ray tissue code (see xray/attenuation.ts), 0 if not X-ray eligible
//   a  255 if the structure is X-ray-only (never drawn in anatomy views)
// uColor (RGBA8, one texel per structure):
//   rgb  the structure's own colour
//   a    brightness jitter / 2, so neighbouring structures read apart
// uSurface: colour per tissue surface (the `surface` vertex attribute), or a
//   negative red channel to use the structure's colour instead.

import * as THREE from 'three';
import { SURFACE_SLOTS } from './palette';

export const STATE_TEX_WIDTH = 64;

const vertex = /* glsl */ `
  in float sid;
  in float surface;
  flat out int vSid;
  flat out int vSurface;
  out vec3 vNormal;
  out vec3 vViewPos;
  void main() {
    vSid = int(sid + 0.5);
    vSurface = int(surface + 0.5);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const lookup = /* glsl */ `
  precision highp int;
  layout(location = 0) out highp vec4 fragColor;
  uniform highp sampler2D uState;
  uniform highp sampler2D uColor;
  flat in int vSid;
  in vec3 vNormal;
  in vec3 vViewPos;
  ivec2 texelOf(int i) { return ivec2(i % ${STATE_TEX_WIDTH}, i / ${STATE_TEX_WIDTH}); }
  vec4 stateOf(int i) { return texelFetch(uState, texelOf(i), 0); }
  int byteOf(float v) { return int(v * 255.0 + 0.5); }
`;

const anatomyFragment = /* glsl */ `
  ${lookup}
  uniform int uPass;       // 0 opaque, 1 ghost
  uniform float uGhostAlpha;
  uniform vec3 uSurface[${SURFACE_SLOTS}];
  flat in int vSurface;
  void main() {
    vec4 st = stateOf(vSid);
    int vis = byteOf(st.r);
    if (st.a > 0.5) discard;
    if (uPass == 0 && vis != 1) discard;
    if (uPass == 1 && vis != 2) discard;

    vec4 own = texelFetch(uColor, texelOf(vSid), 0);
    vec3 tissue = uSurface[clamp(vSurface, 0, ${SURFACE_SLOTS - 1})];
    vec3 base = (tissue.r >= 0.0 ? tissue : own.rgb) * (own.a * 2.0);
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(-vViewPos);
    float key = max(dot(n, normalize(vec3(0.35, 0.55, 1.0))), 0.0);
    float fill = 0.5 + 0.5 * n.y;
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    vec3 col = base * (0.22 + 0.62 * key + 0.22 * fill) + rim * 0.12;
    if (st.g > 0.5) col = mix(col, vec3(1.0, 0.82, 0.25), 0.55);
    float alpha = uPass == 1 ? uGhostAlpha * (0.35 + 0.65 * rim) : 1.0;
    fragColor = vec4(col, alpha);
  }
`;

// Signed path-length accumulation. For a closed, outward-facing surface a
// ray enters through front faces and leaves through back faces, so adding
// -d on entry and +d on exit sums to the length inside. Each fragment adds
// mu * (+/-d); the target ends up holding sum(mu_i * L_i), the exponent of
// Beer-Lambert. Distances are measured relative to uRef to keep magnitudes
// (and half-float rounding) small; the offset cancels for closed meshes.
const xrayFragment = /* glsl */ `
  ${lookup}
  uniform float uMu[7];
  uniform float uRef;
  void main() {
    vec4 st = stateOf(vSid);
    if (byteOf(st.r) == 0) discard;
    float mu = uMu[byteOf(st.b)];
    if (mu == 0.0) discard;
    float d = length(vViewPos) - uRef;
    fragColor = vec4((gl_FrontFacing ? -d : d) * mu, 0.0, 0.0, 1.0);
  }
`;

export interface SharedUniforms {
  uState: { value: THREE.DataTexture };
  uColor: { value: THREE.DataTexture };
  uSurface: { value: Float32Array };
}

export function anatomyMaterial(shared: SharedUniforms, pass: 0 | 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vertex,
    fragmentShader: anatomyFragment,
    uniforms: { ...shared, uPass: { value: pass }, uGhostAlpha: { value: 0.22 } },
    transparent: pass === 1,
    depthWrite: pass === 0,
    side: pass === 1 ? THREE.FrontSide : THREE.DoubleSide,
  });
}

export function xrayMaterial(shared: SharedUniforms, mu: { value: number[] }, ref: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vertex,
    fragmentShader: xrayFragment,
    uniforms: { ...shared, uMu: mu, uRef: ref },
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

/** Maps accumulated attenuation to a radiograph: bone bright, air dark. */
export function filmMaterial(target: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uAtt: { value: target },
      uLevel: { value: 1.5 },
      uWindow: { value: 9.0 },
      uGamma: { value: 0.85 },
    },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      layout(location = 0) out highp vec4 fragColor;
      uniform highp sampler2D uAtt;
      uniform float uLevel, uWindow, uGamma;
      in vec2 vUv;
      void main() {
        float a = texture(uAtt, vUv).r;
        float v = pow(clamp((a - uLevel) / uWindow, 0.0, 1.0), uGamma);
        fragColor = vec4(v * vec3(0.93, 0.97, 1.0), 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}
