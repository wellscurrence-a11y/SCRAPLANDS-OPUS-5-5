import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { installFogChunks, G } from './globals';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  /** Maximum render scale (multiplied by the display's pixel ratio, capped at 2). */
  pixelRatio: number;
  /** Floor for dynamic resolution scaling. */
  minScale: number;
  /** Upper bound on rendered pixels, so high-DPI screens don't explode the fill cost. */
  maxPixels: number;
  shadowSize: number;
  shadowRange: number;
  bloom: boolean;
  msaa: number;
  /** Full post chain (bloom, grade pass). false = render straight to the screen, grading in the tone mapper. */
  post: boolean;
  particles: number; // multiplier
  /** Geometry detail for world machines and props: 0 light, 1 full. */
  detail: number;
  terrainShadows: boolean;
  /** Terrain LOD switch distance multiplier. */
  lodScale: number;
  /** View distance multiplier for rocks and plants. */
  scatterDistance: number;
  scatterDensity: number;
  /** Beyond this distance (m) machines hide their small moving parts (shocks, links). */
  smallPartDistance: number;
  /** Cap on simultaneous roaming/zone enemies. */
  maxEnemies: number;
  /** Frosted-glass HUD panels (CSS backdrop blur re-runs over the live canvas every frame). */
  uiBlur: boolean;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 0.85, minScale: 0.55, maxPixels: 0.9e6, shadowSize: 1024, shadowRange: 55, bloom: false, msaa: 0, post: false, particles: 0.5, detail: 0, terrainShadows: false, lodScale: 0.6, scatterDistance: 0.6, scatterDensity: 0.5, smallPartDistance: 40, maxEnemies: 6, uiBlur: false },
  medium: { pixelRatio: 1, minScale: 0.65, maxPixels: 1.6e6, shadowSize: 2048, shadowRange: 85, bloom: true, msaa: 0, post: true, particles: 0.8, detail: 1, terrainShadows: true, lodScale: 0.8, scatterDistance: 0.8, scatterDensity: 0.75, smallPartDistance: 70, maxEnemies: 8, uiBlur: false },
  high: { pixelRatio: 1, minScale: 0.75, maxPixels: 3.7e6, shadowSize: 4096, shadowRange: 120, bloom: true, msaa: 4, post: true, particles: 1, detail: 1, terrainShadows: true, lodScale: 1, scatterDistance: 1, scatterDensity: 1, smallPartDistance: 120, maxEnemies: 9, uiBlur: true },
  ultra: { pixelRatio: 1.5, minScale: 0.9, maxPixels: 8.3e6, shadowSize: 4096, shadowRange: 150, bloom: true, msaa: 4, post: true, particles: 1.25, detail: 1, terrainShadows: true, lodScale: 1.3, scatterDistance: 1.3, scatterDensity: 1, smallPartDistance: 200, maxEnemies: 9, uiBlur: true },
};

/** Colour grade shared by both paths (applied in display space). */
const GRADE = { saturation: 1.14, contrast: 1.1, tint: [1.02, 1.0, 0.97] as const };

/**
 * Tone mapper for the direct (no post) path: ACES plus the same grade the post chain applies,
 * so LOW looks like the other presets without extra full-screen passes.
 */
function installGradedToneMapping() {
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  const stub = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  if (!chunk.includes(stub)) return;
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(
    stub,
    `vec3 CustomToneMapping( vec3 color ) {
      color = ACESFilmicToneMapping( color );
      vec3 d = pow( max( color, 0.0 ), vec3( 1.0 / 2.2 ) ) * vec3( ${GRADE.tint.map((v) => v.toFixed(3)).join(', ')} );
      float l = dot( d, vec3( 0.2126, 0.7152, 0.0722 ) );
      d = mix( vec3( l ), d, ${GRADE.saturation.toFixed(3)} );
      d = ( d - 0.5 ) * ${GRADE.contrast.toFixed(3)} + 0.5;
      return pow( clamp( d, 0.0, 1.0 ), vec3( 2.2 ) );
    }`,
  );
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 },
    uDamage: { value: 0 },
    uAberration: { value: 0.0 },
    uSaturation: { value: GRADE.saturation },
    uContrast: { value: GRADE.contrast },
    uTint: { value: new THREE.Color(...GRADE.tint) },
    uFlash: { value: 0 },
    uFade: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uDamage, uAberration, uSaturation, uContrast, uFlash, uFade;
    uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 3.7) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float ab = uAberration + uDamage * 0.004;
      vec3 col;
      if (ab > 0.0001) {
        col.r = texture2D(tDiffuse, vUv + c * ab).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - c * ab).b;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }
      col *= uTint;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      float v = smoothstep(0.85, 0.2, length(c * vec2(1.1, 1.0)));
      col *= mix(1.0 - uVignette, 1.0, v);
      // damage: red edge pulse
      float edge = smoothstep(0.25, 0.75, length(c));
      col = mix(col, vec3(0.55, 0.05, 0.02), edge * uDamage * 0.55);
      col += vec3(1.0, 0.95, 0.9) * uFlash;
      col += (hash(vUv * 512.0) - 0.5) * uGrain;
      col = mix(col, vec3(0.0), uFade);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

export class Renderer {
  renderer: THREE.WebGLRenderer;
  composer!: EffectComposer;
  renderPass!: RenderPass;
  bloom!: UnrealBloomPass;
  grade!: ShaderPass;
  output!: OutputPass;
  quality: Quality = 'high';
  preset: QualityPreset = QUALITY.high;
  width = 1;
  height = 1;
  scene: THREE.Scene | null = null;
  camera: THREE.PerspectiveCamera | null = null;
  postEnabled = true;
  /** Dynamic resolution: fraction of the preset's render scale currently used. */
  dynScale = 1;
  dynamicResolution = true;
  private frameAvg = 16.7;
  private drsCooldown = 2;
  private drsProbe: { before: number } | null = null;
  private vignette: HTMLElement;

  constructor(public container: HTMLElement) {
    installFogChunks();
    installGradedToneMapping();
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    // Vignette for the direct path: drawn by the compositor, costs no GPU pass of ours
    this.vignette = document.createElement('div');
    this.vignette.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:none;background:radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.3) 100%)';
    container.appendChild(this.vignette);
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.preset = QUALITY[q];
    this.dynScale = 1;
    this.drsProbe = null;
    this.postEnabled = this.preset.post;
    // the direct path grades inside the tone mapper; the post chain does it in its own passes
    this.renderer.toneMapping = this.postEnabled ? THREE.ACESFilmicToneMapping : THREE.CustomToneMapping;
    this.vignette.style.display = this.postEnabled ? 'none' : '';
    if (this.postEnabled) this.buildComposer();
    else {
      this.composer?.dispose();
      this.composer = undefined as unknown as EffectComposer;
    }
    this.resize();
  }

  /** Render scale actually used, after the preset, dynamic scaling and the pixel budget. */
  private pixelRatioFor(w: number, h: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let pr = dpr * this.preset.pixelRatio * this.dynScale;
    const px = w * h * pr * pr;
    if (px > this.preset.maxPixels) pr *= Math.sqrt(this.preset.maxPixels / px);
    return pr;
  }

  private buildComposer() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      samples: this.preset.msaa,
    });
    this.composer?.dispose();
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.6, 0.92);
    this.bloom.enabled = this.preset.bloom;
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    const pr = this.pixelRatioFor(w, h);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Dynamic resolution: lower the render scale while frames run long, raise it again with headroom.
   * If a step down doesn't make frames faster the bottleneck is the CPU, so the step is undone.
   */
  adapt(dt: number) {
    if (!this.dynamicResolution || dt <= 0) return;
    this.frameAvg += (Math.min(dt, 0.1) * 1000 - this.frameAvg) * 0.05;
    this.drsCooldown -= dt;
    if (this.drsCooldown > 0) return;
    const lo = this.preset.minScale / this.preset.pixelRatio;
    if (this.drsProbe) {
      const helped = this.frameAvg < this.drsProbe.before * 0.95;
      this.drsProbe = null;
      if (!helped) {
        this.setDynScale(Math.min(1, this.dynScale + 0.1));
        this.drsCooldown = 20; // CPU-bound: don't blur the picture for nothing
        return;
      }
    }
    if (this.frameAvg > 22.5 && this.dynScale > lo + 0.001) {
      this.drsProbe = { before: this.frameAvg };
      this.setDynScale(Math.max(lo, this.dynScale - 0.1));
      this.drsCooldown = 1.5;
    } else if (this.frameAvg < 17.8 && this.dynScale < 1) {
      this.setDynScale(Math.min(1, this.dynScale + 0.05));
      this.drsCooldown = 3;
    } else this.drsCooldown = 0.5;
  }

  /** Smoothed frame time in ms (real frames). */
  get frameMs() {
    return this.frameAvg;
  }

  /** Render scale in use relative to the display (after dynamic scaling and the pixel budget). */
  get renderScale() {
    return this.renderer.getPixelRatio() / Math.min(window.devicePixelRatio || 1, 2);
  }

  private setDynScale(v: number) {
    if (Math.abs(v - this.dynScale) < 0.001) return;
    this.dynScale = v;
    this.resize();
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, dt: number) {
    if (this.camera !== camera) {
      this.camera = camera;
      camera.aspect = this.width / this.height;
      camera.updateProjectionMatrix();
    }
    if (this.postEnabled && this.composer) {
      this.grade.uniforms.uTime.value = G.time.value;
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
      this.composer.render(dt);
    } else {
      this.renderer.render(scene, camera);
    }
  }

  get gradeUniforms() {
    return this.grade?.uniforms;
  }
}
