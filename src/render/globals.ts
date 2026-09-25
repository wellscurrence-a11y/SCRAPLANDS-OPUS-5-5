import * as THREE from 'three';

/**
 * Shared uniform objects referenced by every world material (fog, sun, time, wetness).
 * Updating `.value` here updates all materials at once.
 */
export const G = {
  time: { value: 0 },
  sunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
  sunColor: { value: new THREE.Color(1, 0.95, 0.85) },
  fogColor: { value: new THREE.Color(0.75, 0.72, 0.68) },
  fogSunColor: { value: new THREE.Color(1.0, 0.8, 0.55) },
  fogDensity: { value: 0.0016 },
  fogHeightFalloff: { value: 0.012 },
  fogBase: { value: 0 },
  wetness: { value: 0 },
  dust: { value: 0 },
  nightFactor: { value: 0 },
};

const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
#endif
`;

const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogWorldPos = (inverse(viewMatrix) * vec4(mvPosition.xyz, 1.0)).xyz;
#endif
`;

export const FOG_FUNCTIONS = /* glsl */ `
  uniform vec3 uFogSunDir;
  uniform vec3 uFogColor;
  uniform vec3 uFogSunColor;
  uniform float uFogDensity;
  uniform float uFogFalloff;
  uniform float uFogBase;
  vec3 applyWorldFog(vec3 col, vec3 worldPos) {
    vec3 d = worldPos - cameraPosition;
    float dist = length(d);
    vec3 rd = d / max(dist, 1e-4);
    float b = uFogFalloff;
    float h0 = max(cameraPosition.y - uFogBase, 0.0);
    float ry = rd.y;
    float heightTerm;
    if (abs(ry) < 1e-3) heightTerm = dist * exp(-h0 * b);
    else heightTerm = exp(-h0 * b) * (1.0 - exp(-dist * ry * b)) / (ry * b);
    float amount = uFogDensity * (heightTerm * 0.85 + dist * 0.15);
    float f = 1.0 - exp(-amount);
    float sunAmt = pow(max(dot(rd, uFogSunDir), 0.0), 6.0);
    vec3 fogCol = mix(uFogColor, uFogSunColor, sunAmt * 0.75);
    return mix(col, fogCol, clamp(f, 0.0, 1.0));
  }
`;

const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
  ${FOG_FUNCTIONS}
#endif
`;

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = applyWorldFog(gl_FragColor.rgb, vFogWorldPos);
#endif
`;

/** Attach shared fog uniforms to a compiled shader. */
export function bindFogUniforms(shader: { uniforms: Record<string, THREE.IUniform> }) {
  shader.uniforms.uFogSunDir = G.sunDir;
  shader.uniforms.uFogColor = G.fogColor;
  shader.uniforms.uFogSunColor = G.fogSunColor;
  shader.uniforms.uFogDensity = G.fogDensity;
  shader.uniforms.uFogFalloff = G.fogHeightFalloff;
  shader.uniforms.uFogBase = G.fogBase;
}

let patched = false;
/** Globally replace three's fog chunks with height-based, sun-tinted atmospheric fog. */
export function installFogChunks() {
  if (patched) return;
  patched = true;
  THREE.ShaderChunk.fog_pars_vertex = FOG_PARS_VERTEX;
  THREE.ShaderChunk.fog_vertex = FOG_VERTEX;
  THREE.ShaderChunk.fog_pars_fragment = FOG_PARS_FRAGMENT;
  THREE.ShaderChunk.fog_fragment = FOG_FRAGMENT;

  // Every built-in material gets the shared fog uniforms injected at compile time.
  const proto = THREE.Material.prototype as any;
  const original = proto.onBeforeCompile;
  proto.onBeforeCompile = function (shader: any, renderer: any) {
    bindFogUniforms(shader);
    if (original) original.call(this, shader, renderer);
  };
}

/** Compose extra onBeforeCompile work on top of fog binding. */
export function extendMaterial<T extends THREE.Material>(
  mat: T,
  key: string,
  fn: (shader: THREE.WebGLProgramParametersWithUniforms) => void,
): T {
  mat.onBeforeCompile = (shader) => {
    bindFogUniforms(shader as any);
    fn(shader);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}
