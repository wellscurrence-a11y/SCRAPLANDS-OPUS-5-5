import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { installFogChunks, G } from './globals';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  pixelRatio: number;
  shadowSize: number;
  shadowRange: number;
  bloom: boolean;
  msaa: number;
  particles: number; // multiplier
  drawDistance: number;
  propDensity: number;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 0.75, shadowSize: 1024, shadowRange: 70, bloom: false, msaa: 0, particles: 0.5, drawDistance: 900, propDensity: 0.5 },
  medium: { pixelRatio: 1, shadowSize: 2048, shadowRange: 95, bloom: true, msaa: 0, particles: 0.8, drawDistance: 1300, propDensity: 0.75 },
  high: { pixelRatio: 1, shadowSize: 4096, shadowRange: 120, bloom: true, msaa: 4, particles: 1, drawDistance: 1800, propDensity: 1 },
  ultra: { pixelRatio: 1.5, shadowSize: 4096, shadowRange: 150, bloom: true, msaa: 4, particles: 1.25, drawDistance: 2400, propDensity: 1.25 },
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 },
    uDamage: { value: 0 },
    uAberration: { value: 0.0 },
    uSaturation: { value: 1.14 },
    uContrast: { value: 1.1 },
    uTint: { value: new THREE.Color(1.02, 1.0, 0.97) },
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

  constructor(public container: HTMLElement) {
    installFogChunks();
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.preset = QUALITY[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * this.preset.pixelRatio);
    this.buildComposer();
    this.resize();
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
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, dt: number) {
    if (this.camera !== camera) {
      this.camera = camera;
      camera.aspect = this.width / this.height;
      camera.updateProjectionMatrix();
    }
    this.grade.uniforms.uTime.value = G.time.value;
    if (this.postEnabled) {
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
      this.composer.render(dt);
    } else {
      this.renderer.render(scene, camera);
    }
  }

  get gradeUniforms() {
    return this.grade.uniforms;
  }
}
