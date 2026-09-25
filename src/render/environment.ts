import * as THREE from 'three';
import { SHADOW_LAYER } from '../machines/batch';
import { computeAtmosphere, AtmosphereState, Sky } from './sky';
import { G } from './globals';
import { clamp01, lerp, smoothstep } from '../core/math';
import { RNG } from '../core/random';

export type WeatherKind = 'clear' | 'hazy' | 'overcast' | 'dust' | 'storm';

export interface WeatherParams {
  overcast: number;
  dust: number;
  rain: number;
  wind: number;
  cloudCover: number;
  fogMul: number;
}

const WEATHER: Record<WeatherKind, WeatherParams> = {
  clear: { overcast: 0, dust: 0, rain: 0, wind: 0.2, cloudCover: 0.28, fogMul: 1 },
  hazy: { overcast: 0.1, dust: 0.25, rain: 0, wind: 0.35, cloudCover: 0.4, fogMul: 1.6 },
  overcast: { overcast: 0.75, dust: 0, rain: 0, wind: 0.45, cloudCover: 0.8, fogMul: 1.5 },
  dust: { overcast: 0.3, dust: 1, rain: 0, wind: 1, cloudCover: 0.5, fogMul: 5.5 },
  storm: { overcast: 0.95, dust: 0, rain: 1, wind: 0.85, cloudCover: 1, fogMul: 2.6 },
};

export const DAY_LENGTH_SECONDS = 24 * 60; // one in-game day = 24 real minutes

export class Environment {
  sky = new Sky();
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  atm: AtmosphereState;
  /** 0..1 fraction of the day (0.5 = noon). */
  time = 0.36;
  day = 1;
  timeScale = 1;
  weather: WeatherKind = 'clear';
  private weatherTarget: WeatherParams = { ...WEATHER.clear };
  current: WeatherParams = { ...WEATHER.clear };
  private weatherTimer = 240;
  private rng = new RNG(99);
  shadowRange = 120;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envScene = new THREE.Scene();
  private envSky: Sky;
  envMap: THREE.Texture | null = null;
  private envTimer = 0;
  private lastEnvSunY = 999;
  lightning = 0;
  private lightningTimer = 8;
  onLightning?: () => void;

  constructor(public scene: THREE.Scene) {
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2;
    const cam = this.sun.shadow.camera;
    cam.layers.enable(SHADOW_LAYER); // machines' merged shadow proxies live only on this layer
    cam.near = 1;
    cam.far = 900;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x7a5c44, 0.6);
    scene.add(this.hemi);
    scene.add(this.sky.mesh);
    scene.fog = new THREE.FogExp2(0xffffff, 0.001);
    this.atm = computeAtmosphere(this.time, 0, 0);
    this.envSky = new Sky();
    this.envScene.add(this.envSky.mesh);
  }

  setShadowQuality(size: number, range: number) {
    this.shadowRange = range;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as any).map = null;
    }
    const cam = this.sun.shadow.camera;
    cam.left = -range;
    cam.right = range;
    cam.top = range;
    cam.bottom = -range;
    cam.updateProjectionMatrix();
  }

  setWeather(kind: WeatherKind, instant = false) {
    this.weather = kind;
    this.weatherTarget = { ...WEATHER[kind] };
    if (instant) this.current = { ...WEATHER[kind] };
  }

  get hours() {
    return this.time * 24;
  }

  get timeString() {
    const h = Math.floor(this.hours);
    const m = Math.floor((this.hours - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
    this.time += (dt * this.timeScale) / DAY_LENGTH_SECONDS;
    if (this.time >= 1) {
      this.time -= 1;
      this.day++;
    }
    // Weather state machine
    this.weatherTimer -= dt * this.timeScale;
    if (this.weatherTimer <= 0) {
      this.weatherTimer = this.rng.range(180, 420);
      const kinds: WeatherKind[] = ['clear', 'clear', 'clear', 'hazy', 'hazy', 'overcast', 'dust', 'storm'];
      this.setWeather(this.rng.pick(kinds));
    }
    const wk = 1 - Math.exp(-dt * 0.05);
    for (const k of Object.keys(this.current) as (keyof WeatherParams)[]) {
      this.current[k] = lerp(this.current[k], this.weatherTarget[k], wk);
    }
    const w = this.current;
    computeAtmosphere(this.time, w.overcast, w.dust, this.atm);
    const atm = this.atm;

    // Lightning during storms
    this.lightning = Math.max(0, this.lightning - dt * 4);
    if (w.rain > 0.6) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = this.rng.range(6, 18);
        this.lightning = 1;
        this.onLightning?.();
      }
    }

    // Lights
    this.sun.color.copy(atm.lightColor);
    this.sun.intensity = atm.lightIntensity;
    const d = this.shadowRange * 2.2;
    this.sun.position.copy(focus).addScaledVector(atm.lightDir, d);
    this.sun.target.position.copy(focus);
    // Texel snapping to reduce shimmering
    this.snapShadow(focus);
    this.hemi.color.copy(atm.ambient);
    this.hemi.groundColor.copy(atm.fog).multiplyScalar(0.55);
    this.hemi.intensity = atm.ambientIntensity + this.lightning * 2.5;

    // Globals
    G.sunDir.value.copy(atm.sunDir.y > -0.1 ? atm.sunDir : atm.moonDir);
    G.sunColor.value.copy(atm.lightColor);
    G.fogColor.value.copy(atm.fog).lerp(new THREE.Color(0.8, 0.85, 1.0), this.lightning * 0.4);
    G.fogSunColor.value.copy(atm.fogSun);
    const baseDensity = 0.00075 * w.fogMul * (1 + atm.night * 0.4);
    G.fogDensity.value = baseDensity;
    G.fogHeightFalloff.value = lerp(0.012, 0.006, clamp01(w.dust + w.rain * 0.5));
    G.fogBase.value = 0;
    G.nightFactor.value = atm.night;
    G.dust.value = w.dust;
    G.wetness.value = lerp(G.wetness.value, w.rain > 0.3 ? 1 : 0, 1 - Math.exp(-dt * (w.rain > 0.3 ? 0.05 : 0.01)));

    this.sky.update(atm, (camera as THREE.PerspectiveCamera).position, w.overcast, w.dust, w.cloudCover);

    // Environment map for reflections: refresh when the sun moved noticeably
    this.envTimer -= dt;
    if (!this.pmrem) {
      this.pmrem = new THREE.PMREMGenerator(renderer);
    }
    if (this.envTimer <= 0 && Math.abs(atm.sunDir.y - this.lastEnvSunY) > 0.015) {
      this.envTimer = 2;
      this.lastEnvSunY = atm.sunDir.y;
      this.envSky.update(atm, new THREE.Vector3(), w.overcast, w.dust, w.cloudCover);
      this.envSky.mesh.scale.setScalar(0.02);
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
      if (this.envMap) this.envMap.dispose();
      this.envMap = rt.texture;
      this.scene.environment = this.envMap;
      (this.scene as any).environmentIntensity = lerp(0.55, 0.2, atm.night);
    }
  }

  private snapShadow(focus: THREE.Vector3) {
    const cam = this.sun.shadow.camera;
    const size = this.sun.shadow.mapSize.x;
    const texel = (cam.right - cam.left) / size;
    // Project focus into light space, snap, project back
    const lightDir = this.sun.position.clone().sub(this.sun.target.position).normalize();
    const up = Math.abs(lightDir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, lightDir).normalize();
    const lup = new THREE.Vector3().crossVectors(lightDir, right).normalize();
    const px = focus.dot(right);
    const py = focus.dot(lup);
    const sx = Math.round(px / texel) * texel - px;
    const sy = Math.round(py / texel) * texel - py;
    const off = right.multiplyScalar(sx).add(lup.multiplyScalar(sy));
    this.sun.position.add(off);
    this.sun.target.position.add(off);
    this.sun.target.updateMatrixWorld();
  }

  isNight() {
    return this.atm.night > 0.5;
  }

  /** Visibility factor for AI detection. */
  visibility() {
    return lerp(1, 0.45, this.atm.night) * (1 - this.current.dust * 0.5) * (1 - this.current.rain * 0.25);
  }

  headlightsWanted() {
    return this.atm.night > 0.3 || this.current.dust > 0.5 || smoothstep(0.1, 0.02, this.atm.sunElevation) > 0.5;
  }
}
