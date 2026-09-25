/**
 * The garage builder: a 3D scene where machines are physically assembled from parts.
 * Parts attach to logical connection points (sockets and mounting surfaces); every change
 * immediately re-runs the engineering analysis.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Renderer } from '../render/renderer';
import { GarageEnvironment } from './environment';
import type { MachineDesign, PartDef, PartItem, PlacedPart, SocketDef } from '../machines/types';
import { getPart } from '../machines/parts/catalog';
import { getPartTemplate } from '../machines/parts/meshes';
import { MachineMaterials } from '../machines/materials';
import { assembleDesign, AssembledMachine } from '../machines/visual';
import { computeStats, MachineStats } from '../machines/stats';
import { canMount, layoutDesign, LayoutResult, placementCollides, placementLocal, socketFrame, PartLayout } from '../machines/layout';
import type { Profile } from '../gameplay/profile';
import { craneLimit, spend, canAfford, addResources } from '../gameplay/profile';
import { repairCost } from '../gameplay/economy';
import { clamp, damp, uid } from '../core/math';
import type { NodeTemplate } from '../machines/parts/kit';

export type GarageMode = 'select' | 'place';

export interface HoverInfo {
  parent: PartLayout;
  socket: SocketDef;
  offset: [number, number];
  valid: boolean;
  reason: string;
  matrix: THREE.Matrix4;
  mirrorTarget: { parent: PartLayout; socket: SocketDef; offset: [number, number]; mirror: boolean } | null;
}

const ghostOk = new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.45, depthWrite: false });
const ghostBad = new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.45, depthWrite: false });
const markerMat = new THREE.MeshBasicMaterial({ color: 0xffae3b, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
const markerHot = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
const pointMat = new THREE.MeshBasicMaterial({ color: 0xffae3b, transparent: true, opacity: 0.85, depthWrite: false });

export class Garage {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500);
  env = new GarageEnvironment();
  profile!: Profile;
  design: MachineDesign | null = null;
  mats: MachineMaterials | null = null;
  asm: AssembledMachine | null = null;
  layout: LayoutResult | null = null;
  stats: MachineStats | null = null;
  machineRoot = new THREE.Group();
  markers = new THREE.Group();
  ghost: THREE.Object3D | null = null;
  ghostMirror: THREE.Object3D | null = null;
  highlight: THREE.Box3Helper | null = null;
  comMarker: THREE.Sprite;
  parked = new THREE.Group();
  mode: GarageMode = 'select';
  placing: { item: PartItem; def: PartDef; rot: number; tilt: number } | null = null;
  mirrorMode = true;
  hover: HoverInfo | null = null;
  selected: string | null = null;
  hoverPart: string | null = null;
  yaw = 0.7;
  pitch = 0.32;
  dist = 11;
  target = new THREE.Vector3(0, 1.2, -1);
  private mouse = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  private dragging: 'orbit' | 'pan' | null = null;
  private dragStart = new THREE.Vector2();
  private moved = 0;
  private undo: string[] = [];
  private listeners: (() => void)[] = [];
  onChange: (() => void) | null = null;
  onMessage: ((text: string, kind?: string) => void) | null = null;
  active = false;
  time = 0;
  spin = 0;

  constructor(private renderer: Renderer) {
    this.scene.add(this.env.group);
    this.env.turntable.add(this.machineRoot);
    this.scene.add(this.markers);
    this.scene.add(this.parked);
    this.scene.background = new THREE.Color(0x0f0d0b);
    this.scene.fog = new THREE.FogExp2(0x1a1612, 0.012);
    const pmrem = new THREE.PMREMGenerator(renderer.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    (this.scene as any).environmentIntensity = 0.35;
    this.comMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: comTexture(), depthTest: false, transparent: true, sizeAttenuation: false }));
    this.comMarker.scale.setScalar(0.034);
    this.comMarker.renderOrder = 20;
    this.machineRoot.add(this.comMarker);
    // outside daylight backdrop
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(80, 30), new THREE.MeshBasicMaterial({ color: 0xd9c7a8 }));
    sky.position.set(0, 12, 40);
    sky.rotation.y = Math.PI;
    this.scene.add(sky);
  }

  // ------------------------------------------------------------------ lifecycle
  enter(profile: Profile, machineId: string) {
    this.profile = profile;
    this.env.applyUpgrades(profile);
    this.active = true;
    this.setMachine(machineId);
    this.attachInput();
    this.buildParked();
  }

  exit() {
    this.active = false;
    this.detachInput();
    this.cancelPlacing();
  }

  setMachine(id: string) {
    const d = this.profile.machines.find((m) => m.id === id) ?? this.profile.machines[0];
    this.design = d ?? null;
    this.selected = null;
    this.undo = [];
    this.cancelPlacing();
    this.rebuild();
    this.buildParked();
    this.frameMachine(true);
  }

  /** Fit the orbit distance to the machine and optionally snap the camera there. */
  frameMachine(snap = false) {
    if (this.stats && !this.stats.bounds.isEmpty()) {
      const size = this.stats.bounds.getSize(new THREE.Vector3());
      const radius = Math.max(1.2, size.length() * 0.5);
      // the machine sits between the two side panels (~45% of the screen width)
      if (this.renderer.width && this.renderer.height) this.camera.aspect = this.renderer.width / this.renderer.height;
      const vfov = THREE.MathUtils.degToRad(this.camera.fov);
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(0.5, this.camera.aspect) * 0.45);
      this.dist = clamp(radius / Math.sin(Math.min(vfov, hfov) / 2) * 0.9, 4, 30);
      this.target.set(0, Math.max(0.8, size.y * 0.5), -1);
    }
    if (snap) {
      this.yaw = 0.7;
      this.pitch = 0.32;
      const cp = Math.cos(this.pitch);
      this.camera.position.copy(this.target).add(new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist));
      this.camera.lookAt(this.target);
    }
  }

  // ------------------------------------------------------------------ building the visual
  rebuild() {
    this.machineRoot.children.filter((c) => c !== this.comMarker).forEach((c) => this.machineRoot.remove(c));
    this.mats?.dispose();
    this.asm = null;
    if (!this.design) {
      this.stats = null;
      this.layout = null;
      this.onChange?.();
      return;
    }
    this.mats = new MachineMaterials(this.design.paint);
    this.layout = layoutDesign(this.design);
    this.stats = computeStats(this.design);
    this.asm = assembleDesign(this.design, this.mats, { layout: this.layout });
    // rest the machine on the turntable
    const minY = this.stats.bounds.isEmpty() ? 0 : this.stats.bounds.min.y;
    this.asm.root.position.y = -minY;
    this.machineRoot.add(this.asm.root);
    this.asm.root.updateMatrixWorld(true);
    this.mats.setLights(true);
    this.comMarker.position.copy(this.stats.com).add(new THREE.Vector3(0, -minY, 0));
    // spin rotors/legs to a neutral pose: legs are already straight at rest
    this.updateHighlight();
    this.refreshMarkers();
    this.onChange?.();
  }

  private machineMatrix() {
    this.asm?.root.updateMatrixWorld(true);
    return this.asm ? this.asm.root.matrixWorld.clone() : new THREE.Matrix4();
  }

  private buildParked() {
    this.parked.clear();
    if (!this.profile) return;
    const spots: [number, number, number][] = [
      [-8.5, -6.5, 0.3],
      [8.5, -6.5, -0.3],
      [-9, 1.5, 0.9],
      [9, 1.5, -0.9],
      [-5, 6.5, 1.2],
    ];
    let i = 0;
    for (const d of this.profile.machines) {
      if (d.id === this.design?.id) continue;
      if (i >= spots.length) break;
      const mats = new MachineMaterials(d.paint);
      const a = assembleDesign(d, mats);
      const st = computeStats(d);
      a.root.position.set(spots[i][0], -st.bounds.min.y, spots[i][1]);
      a.root.rotation.y = spots[i][2];
      a.root.scale.setScalar(1);
      this.parked.add(a.root);
      i++;
    }
  }

  // ------------------------------------------------------------------ input
  private attachInput() {
    const el = this.renderer.renderer.domElement;
    const md = (e: MouseEvent) => {
      if (!this.active) return;
      this.dragStart.set(e.clientX, e.clientY);
      this.moved = 0;
      if (e.button === 2) this.dragging = 'orbit';
      else if (e.button === 1) this.dragging = 'pan';
      else if (e.button === 0) this.dragging = null;
    };
    const mm = (e: MouseEvent) => {
      if (!this.active) return;
      const rect = el.getBoundingClientRect();
      this.mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      if (this.dragging === 'orbit') {
        this.yaw -= e.movementX * 0.006;
        this.pitch = clamp(this.pitch + e.movementY * 0.005, -0.1, 1.35);
        this.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      } else if (this.dragging === 'pan') {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0);
        this.target.addScaledVector(right, -e.movementX * 0.01 * (this.dist / 10));
        this.target.addScaledVector(up, e.movementY * 0.01 * (this.dist / 10));
        this.target.y = clamp(this.target.y, 0.2, 6);
      }
    };
    const mu = (e: MouseEvent) => {
      if (!this.active) return;
      if (e.button === 0 && (e.target as HTMLElement) === el) this.click();
      this.dragging = null;
    };
    const wh = (e: WheelEvent) => {
      if (!this.active || (e.target as HTMLElement) !== el) return;
      this.dist = clamp(this.dist * (e.deltaY > 0 ? 1.1 : 0.9), 3, 30);
    };
    const kd = (e: KeyboardEvent) => {
      if (!this.active) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.key(e);
    };
    el.addEventListener('mousedown', md);
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
    el.addEventListener('wheel', wh, { passive: true });
    window.addEventListener('keydown', kd);
    this.listeners = [
      () => el.removeEventListener('mousedown', md),
      () => window.removeEventListener('mousemove', mm),
      () => window.removeEventListener('mouseup', mu),
      () => el.removeEventListener('wheel', wh),
      () => window.removeEventListener('keydown', kd),
    ];
  }

  private detachInput() {
    for (const l of this.listeners) l();
    this.listeners = [];
  }

  private key(e: KeyboardEvent) {
    const shift = e.shiftKey;
    if (e.code === 'Escape') {
      if (this.placing) this.cancelPlacing();
      else if (this.selected) this.select(null);
    } else if (e.code === 'KeyR') {
      if (this.placing) this.placing.rot = (this.placing.rot + (shift ? -45 : 45) + 360) % 360;
      else if (this.selected) this.adjustSelected({ rot: shift ? -45 : 45 });
    } else if (e.code === 'KeyT') {
      if (this.placing && this.placing.def.tiltable) this.placing.tilt = clamp(this.placing.tilt + (shift ? -15 : 15), -90, 90);
      else if (this.selected) this.adjustSelected({ tilt: shift ? -15 : 15 });
    } else if (e.code === 'KeyX') {
      this.mirrorMode = !this.mirrorMode;
      this.onMessage?.(`Mirror placement ${this.mirrorMode ? 'ON' : 'OFF'}`);
      this.onChange?.();
    } else if (e.code === 'Delete' || e.code === 'Backspace') {
      if (this.selected) this.removePart(this.selected);
    } else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) {
      this.popUndo();
    } else if (this.selected && e.code.startsWith('Arrow')) {
      const step = shift ? 0.25 : 0.05;
      const du = e.code === 'ArrowLeft' ? -step : e.code === 'ArrowRight' ? step : 0;
      const dv = e.code === 'ArrowUp' ? -step : e.code === 'ArrowDown' ? step : 0;
      this.adjustSelected({ du, dv });
      e.preventDefault();
    }
  }

  // ------------------------------------------------------------------ undo
  private snapshot() {
    this.undo.push(JSON.stringify({ design: this.design, inv: this.profile.inventory }));
    if (this.undo.length > 40) this.undo.shift();
  }

  popUndo() {
    const s = this.undo.pop();
    if (!s || !this.design) return;
    const { design, inv } = JSON.parse(s);
    const idx = this.profile.machines.findIndex((m) => m.id === this.design!.id);
    if (idx >= 0) this.profile.machines[idx] = design;
    this.design = design;
    this.profile.inventory = inv;
    this.selected = null;
    this.rebuild();
  }

  // ------------------------------------------------------------------ placing
  startPlacing(item: PartItem) {
    const def = getPart(item.defId);
    this.placing = { item, def, rot: 0, tilt: 0 };
    // Jump jets & boosters default to pointing their exhaust downward on vertical surfaces
    this.mode = 'place';
    this.selected = null;
    this.updateHighlight();
    this.refreshMarkers();
    this.onChange?.();
  }

  cancelPlacing() {
    this.placing = null;
    this.mode = 'select';
    this.hover = null;
    this.clearGhost();
    this.refreshMarkers();
    this.onChange?.();
  }

  private occupied(parentUid: string, socketId: string) {
    return !!this.design?.parts.some((p) => p.parent === parentUid && p.socket === socketId);
  }

  /** Visual markers for every compatible free socket. */
  refreshMarkers() {
    this.markers.clear();
    if (!this.placing || !this.layout || !this.design) return;
    const def = this.placing.def;
    const mm = this.machineMatrix();
    for (const lay of this.layout.parts) {
      for (const s of lay.def.sockets ?? []) {
        if (!canMount(def, s, this.design.cls)) continue;
        if (s.type !== 'surface' && this.occupied(lay.placed.uid, s.id)) continue;
        const frame = mm.clone().multiply(lay.matrix).multiply(socketFrame(s));
        let marker: THREE.Mesh;
        if (s.type === 'surface' && s.size) {
          const g = new THREE.PlaneGeometry(Math.max(0.12, s.size[0]), Math.max(0.12, s.size[1]));
          g.rotateX(-Math.PI / 2);
          g.translate(0, 0.01, 0);
          marker = new THREE.Mesh(g, markerMat);
        } else {
          const g = new THREE.CylinderGeometry(0.16, 0.16, 0.03, 20);
          g.translate(0, 0.02, 0);
          marker = new THREE.Mesh(g, pointMat);
          const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 10), pointMat);
          arrow.position.y = 0.18;
          marker.add(arrow);
        }
        frame.decompose(marker.position, marker.quaternion, marker.scale);
        marker.userData = { parentUid: lay.placed.uid, socketId: s.id };
        marker.renderOrder = 15;
        this.markers.add(marker);
      }
    }
  }

  private clearGhost() {
    if (this.ghost) this.scene.remove(this.ghost);
    if (this.ghostMirror) this.scene.remove(this.ghostMirror);
    this.ghost = null;
    this.ghostMirror = null;
  }

  private buildGhost(def: PartDef, matrix: THREE.Matrix4, ok: boolean) {
    const t = getPartTemplate(def);
    const mat = ok ? ghostOk : ghostBad;
    const make = (n: NodeTemplate): THREE.Object3D => {
      const o = new THREE.Object3D();
      o.position.copy(n.pos);
      o.quaternion.copy(n.quat);
      for (const g of n.merged.values()) o.add(new THREE.Mesh(g, mat));
      for (const c of n.children) o.add(make(c));
      return o;
    };
    const g = make(t.root);
    matrix.decompose(g.position, g.quaternion, g.scale);
    g.traverse((o) => ((o as THREE.Mesh).renderOrder = 16));
    return g;
  }

  /** Evaluate a candidate placement. */
  private evaluate(parent: PartLayout, socket: SocketDef, offset: [number, number], rot: number, tilt: number, mirror: boolean, def: PartDef, ignore: Set<string> = new Set()) {
    const local = placementLocal({ offset, rot, tilt, mirror });
    const partM = parent.matrix.clone().multiply(socketFrame(socket)).multiply(local);
    const tpl = getPartTemplate(def);
    const box = tpl.bounds.clone().applyMatrix4(partM);
    let valid = true;
    let reason = '';
    const coll = this.layout ? placementCollides({ ...this.layout, parts: this.layout.parts.filter((p) => !ignore.has(p.placed.uid)) }, box, parent.placed.uid) : null;
    const blockingCats = ['gear', 'suspension', 'wheel', 'track', 'leg', 'arm', 'actuator', 'foot', 'rotor', 'cockpit'];
    if (coll && !blockingCats.includes(def.category)) {
      valid = false;
      reason = `Blocked by ${coll.def.name}`;
    }
    if (socket.type === 'surface' && socket.size) {
      if (Math.abs(offset[0]) > socket.size[0] / 2 + 1e-3 || Math.abs(offset[1]) > socket.size[1] / 2 + 1e-3) {
        valid = false;
        reason = 'Outside the mounting surface';
      }
    }
    const newMass = (this.stats?.mass ?? 0) + def.mass;
    if (newMass > craneLimit(this.profile)) {
      valid = false;
      reason = `Too heavy for your crane (${(craneLimit(this.profile) / 1000).toFixed(1)} t limit)`;
    }
    return { valid, reason, partM };
  }

  private updateHover() {
    this.hover = null;
    if (!this.placing || !this.layout || !this.design) {
      this.clearGhost();
      return;
    }
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.markers.children, false);
    for (const m of this.markers.children) (m as THREE.Mesh).material = (m as THREE.Mesh).geometry.type === 'PlaneGeometry' ? markerMat : pointMat;
    if (!hits.length) {
      this.clearGhost();
      return;
    }
    const hit = hits[0];
    const mk = hit.object as THREE.Mesh;
    if (mk.geometry.type === 'PlaneGeometry') mk.material = markerHot;
    const { parentUid, socketId } = mk.userData;
    const parent = this.layout.byUid.get(parentUid)!;
    const socket = parent.def.sockets!.find((s) => s.id === socketId)!;
    let offset: [number, number] = [0, 0];
    if (socket.type === 'surface' && socket.size) {
      const local = mk.worldToLocal(hit.point.clone());
      const snap = 0.05;
      offset = [clamp(Math.round(local.x / snap) * snap, -socket.size[0] / 2, socket.size[0] / 2), clamp(Math.round(local.z / snap) * snap, -socket.size[1] / 2, socket.size[1] / 2)];
    }
    const def = this.placing.def;
    const ev = this.evaluate(parent, socket, offset, this.placing.rot, this.placing.tilt, false, def);
    const mm = this.machineMatrix();
    // mirror twin
    let mirrorTarget: HoverInfo['mirrorTarget'] = null;
    const others = this.profile.inventory.filter((i) => i.defId === def.id && i.uid !== this.placing!.item.uid);
    if (this.mirrorMode && others.length) {
      if (socket.mirror) {
        const twin = parent.def.sockets!.find((s) => s.id === socket.mirror);
        if (twin && (twin.type === 'surface' || !this.occupied(parent.placed.uid, twin.id))) mirrorTarget = { parent, socket: twin, offset, mirror: false };
      } else if (socket.type === 'surface' && Math.abs(offset[0]) > 0.15) {
        mirrorTarget = { parent, socket, offset: [-offset[0], offset[1]], mirror: true };
      }
    }
    this.hover = { parent, socket, offset, valid: ev.valid, reason: ev.reason, matrix: ev.partM, mirrorTarget };
    this.clearGhost();
    this.ghost = this.buildGhost(def, mm.clone().multiply(ev.partM), ev.valid);
    this.scene.add(this.ghost);
    if (mirrorTarget) {
      const ev2 = this.evaluate(mirrorTarget.parent, mirrorTarget.socket, mirrorTarget.offset, this.placing.rot, this.placing.tilt, mirrorTarget.mirror, def);
      this.ghostMirror = this.buildGhost(def, mm.clone().multiply(ev2.partM), ev2.valid);
      this.scene.add(this.ghostMirror);
    }
  }

  private place() {
    if (!this.placing || !this.hover || !this.design) return;
    if (!this.hover.valid) {
      this.onMessage?.(this.hover.reason || 'Invalid placement', 'bad');
      return;
    }
    this.snapshot();
    const { item, def, rot, tilt } = this.placing;
    const h = this.hover;
    const add = (it: PartItem, parent: PartLayout, socket: SocketDef, offset: [number, number], mirror: boolean) => {
      const idx = this.profile.inventory.findIndex((x) => x.uid === it.uid);
      if (idx < 0) return;
      this.profile.inventory.splice(idx, 1);
      const placed: PlacedPart = { uid: it.uid, defId: it.defId, parent: parent.placed.uid, socket: socket.id, offset: [...offset], rot, tilt, cond: it.cond, mirror: mirror || undefined };
      if (def.category === 'weapon') placed.group = 1;
      if (def.category === 'melee') placed.group = 2;
      this.design!.parts.push(placed);
    };
    add(item, h.parent, h.socket, h.offset, false);
    if (h.mirrorTarget) {
      const other = this.profile.inventory.filter((i) => i.defId === def.id).sort((a, b) => b.cond - a.cond)[0];
      if (other) {
        const ev2 = this.evaluate(h.mirrorTarget.parent, h.mirrorTarget.socket, h.mirrorTarget.offset, rot, tilt, h.mirrorTarget.mirror, def);
        if (ev2.valid) add(other, h.mirrorTarget.parent, h.mirrorTarget.socket, h.mirrorTarget.offset, h.mirrorTarget.mirror);
      }
    }
    this.onMessage?.(`Installed ${def.name}`, 'good');
    // keep placing more of the same part if available
    const next = this.profile.inventory.filter((i) => i.defId === def.id).sort((a, b) => b.cond - a.cond)[0];
    this.rebuild();
    if (next) {
      this.placing = { item: next, def, rot, tilt };
      this.refreshMarkers();
    } else this.cancelPlacing();
  }

  // ------------------------------------------------------------------ selection & editing
  private click() {
    if (this.moved > 6) return;
    if (this.placing) {
      this.updateHover();
      this.place();
      return;
    }
    this.raycaster.setFromCamera(this.mouse, this.camera);
    if (!this.asm) return;
    const hits = this.raycaster.intersectObject(this.asm.root, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.uid) o = o.parent;
      if (o) {
        this.select(o.userData.uid);
        return;
      }
    }
    this.select(null);
  }

  select(uidSel: string | null) {
    this.selected = uidSel;
    this.updateHighlight();
    this.onChange?.();
  }

  private updateHighlight() {
    if (this.highlight) {
      this.highlight.parent?.remove(this.highlight);
      this.highlight = null;
    }
    if (!this.selected || !this.asm) return;
    const pv = this.asm.parts.get(this.selected);
    if (!pv) {
      this.selected = null;
      return;
    }
    const box = new THREE.Box3().setFromObject(pv.node);
    this.highlight = new THREE.Box3Helper(box, 0xffae3b);
    (this.highlight.material as THREE.LineBasicMaterial).depthTest = false;
    this.highlight.renderOrder = 18;
    this.scene.add(this.highlight);
  }

  selectedPart(): PlacedPart | null {
    return this.design?.parts.find((p) => p.uid === this.selected) ?? null;
  }

  adjustSelected(d: { rot?: number; tilt?: number; du?: number; dv?: number }) {
    const p = this.selectedPart();
    if (!p || !p.parent || !this.layout) return;
    const lay = this.layout.byUid.get(p.uid)!;
    const parent = lay.parent!;
    const socket = lay.socket!;
    const def = getPart(p.defId);
    const next = { rot: p.rot, tilt: p.tilt, offset: [...p.offset] as [number, number] };
    if (d.rot) next.rot = (next.rot + d.rot + 360) % 360;
    if (d.tilt) {
      if (!def.tiltable) {
        this.onMessage?.(`${def.name} can't be tilted`, 'bad');
        return;
      }
      next.tilt = clamp(next.tilt + d.tilt, -90, 90);
    }
    if (d.du || d.dv) {
      if (socket.type !== 'surface' || !socket.size) {
        this.onMessage?.('Only parts on mounting surfaces can be moved', 'bad');
        return;
      }
      next.offset = [clamp(next.offset[0] + (d.du ?? 0), -socket.size[0] / 2, socket.size[0] / 2), clamp(next.offset[1] + (d.dv ?? 0), -socket.size[1] / 2, socket.size[1] / 2)];
    }
    const ignore = new Set<string>();
    const collect = (l: PartLayout) => {
      ignore.add(l.placed.uid);
      l.children.forEach(collect);
    };
    collect(lay);
    const ev = this.evaluate(parent, socket, next.offset, next.rot, next.tilt, !!p.mirror, def, ignore);
    if (!ev.valid) {
      this.onMessage?.(ev.reason, 'bad');
      return;
    }
    this.snapshot();
    p.rot = next.rot;
    p.tilt = next.tilt;
    p.offset = next.offset;
    this.rebuild();
  }

  /** Remove a part and everything mounted on it back into storage. */
  removePart(partUid: string) {
    if (!this.design) return;
    const p = this.design.parts.find((x) => x.uid === partUid);
    if (!p) return;
    if (p.parent === null) {
      this.onMessage?.('The frame is the machine. Dismantle the machine from the Machines tab instead.', 'bad');
      return;
    }
    this.snapshot();
    const remove = new Set<string>();
    const collect = (u: string) => {
      remove.add(u);
      for (const c of this.design!.parts.filter((x) => x.parent === u)) collect(c.uid);
    };
    collect(partUid);
    for (const u of remove) {
      const pp = this.design.parts.find((x) => x.uid === u)!;
      this.profile.inventory.push({ uid: pp.uid, defId: pp.defId, cond: pp.cond });
    }
    this.design.parts = this.design.parts.filter((x) => !remove.has(x.uid));
    this.selected = null;
    this.onMessage?.(`Removed ${getPart(p.defId).name}${remove.size > 1 ? ` (+${remove.size - 1} attached)` : ''}`);
    this.rebuild();
  }

  /** Swap a placed part for an inventory item of a compatible type, keeping its placement. */
  replacePart(partUid: string, item: PartItem) {
    if (!this.design || !this.layout) return false;
    const p = this.design.parts.find((x) => x.uid === partUid);
    const lay = this.layout.byUid.get(partUid);
    if (!p || !lay || !lay.socket) return false;
    const def = getPart(item.defId);
    if (!canMount(def, lay.socket, this.design.cls)) {
      this.onMessage?.(`${def.name} doesn't fit that mount`, 'bad');
      return false;
    }
    this.snapshot();
    const newSockets = new Set((def.sockets ?? []).map((s) => s.id));
    // children that can't be re-mounted go back to storage
    const toStore: PlacedPart[] = [];
    const collect = (u: string) => {
      for (const c of this.design!.parts.filter((x) => x.parent === u)) {
        toStore.push(c);
        collect(c.uid);
      }
    };
    for (const c of this.design.parts.filter((x) => x.parent === partUid)) {
      if (!newSockets.has(c.socket!)) {
        toStore.push(c);
        collect(c.uid);
      }
    }
    for (const c of toStore) this.profile.inventory.push({ uid: c.uid, defId: c.defId, cond: c.cond });
    const storeSet = new Set(toStore.map((c) => c.uid));
    this.design.parts = this.design.parts.filter((x) => !storeSet.has(x.uid));
    // put old part back, new one in
    this.profile.inventory.push({ uid: p.uid, defId: p.defId, cond: p.cond });
    this.profile.inventory = this.profile.inventory.filter((x) => x.uid !== item.uid);
    const oldUid = p.uid;
    p.uid = item.uid;
    p.defId = item.defId;
    p.cond = item.cond;
    if (!def.tiltable) p.tilt = 0;
    for (const c of this.design.parts) if (c.parent === oldUid) c.parent = p.uid;
    this.selected = p.uid;
    this.onMessage?.(`Swapped in ${def.name}`, 'good');
    this.rebuild();
    return true;
  }

  setGroup(partUid: string, group: number) {
    const p = this.design?.parts.find((x) => x.uid === partUid);
    if (!p) return;
    p.group = group;
    this.onChange?.();
  }

  // ------------------------------------------------------------------ repair
  repairCostFor(parts: PlacedPart[]) {
    let credits = 0;
    const res: Record<string, number> = {};
    for (const p of parts) {
      const c = repairCost(getPart(p.defId), p.cond);
      credits += c.credits;
      for (const [k, v] of Object.entries(c.res)) res[k] = (res[k] ?? 0) + (v ?? 0);
    }
    return { credits, res };
  }

  repairAll(): boolean {
    if (!this.design) return false;
    const damaged = this.design.parts.filter((p) => p.cond < 0.999);
    if (!damaged.length) return false;
    const cost = this.repairCostFor(damaged);
    if (!canAfford(this.profile, cost.credits, cost.res)) {
      this.onMessage?.('Not enough credits or materials for a full repair', 'bad');
      return false;
    }
    spend(this.profile, cost.credits, cost.res);
    for (const p of damaged) p.cond = 1;
    this.onMessage?.(`Repaired ${damaged.length} components`, 'good');
    this.rebuild();
    return true;
  }

  repairOne(partUid: string) {
    const p = this.design?.parts.find((x) => x.uid === partUid);
    if (!p || p.cond >= 0.999) return;
    const c = repairCost(getPart(p.defId), p.cond);
    if (!spend(this.profile, c.credits, c.res)) {
      this.onMessage?.('Cannot afford repair', 'bad');
      return;
    }
    p.cond = 1;
    this.rebuild();
  }

  // ------------------------------------------------------------------ machines
  createMachine(frameItem: PartItem, name: string) {
    const def = getPart(frameItem.defId);
    if (!def.rootOf) return null;
    const d: MachineDesign = {
      id: uid('mach'),
      name,
      cls: def.rootOf,
      parts: [{ uid: frameItem.uid, defId: frameItem.defId, parent: null, socket: null, offset: [0, 0], rot: 0, tilt: 0, cond: frameItem.cond }],
      paint: { primary: '#8a6a4a', secondary: '#d0b070', accent: '#ffae3b', pattern: 'none', wear: 0.5 },
      created: Date.now(),
      kills: 0,
      distance: 0,
    };
    this.profile.inventory = this.profile.inventory.filter((i) => i.uid !== frameItem.uid);
    this.profile.machines.push(d);
    this.setMachine(d.id);
    return d;
  }

  dismantleMachine(id: string) {
    const idx = this.profile.machines.findIndex((m) => m.id === id);
    if (idx < 0) return;
    const d = this.profile.machines[idx];
    for (const p of d.parts) this.profile.inventory.push({ uid: p.uid, defId: p.defId, cond: p.cond });
    this.profile.machines.splice(idx, 1);
    if (this.profile.activeMachine === id) this.profile.activeMachine = this.profile.machines[0]?.id ?? '';
    this.setMachine(this.profile.machines[0]?.id ?? '');
  }

  scrapItem(item: PartItem, yieldFn: (d: PartDef, c: number) => Record<string, number>) {
    this.profile.inventory = this.profile.inventory.filter((i) => i.uid !== item.uid);
    addResources(this.profile, yieldFn(getPart(item.defId), item.cond) as any);
  }

  // ------------------------------------------------------------------ frame update
  update(dt: number) {
    this.time += dt;
    // camera orbit
    const cp = Math.cos(this.pitch);
    const want = this.target.clone().add(new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist));
    this.camera.position.lerp(want, damp(12, dt));
    this.camera.lookAt(this.target);
    if (this.stats && !this.stats.bounds.isEmpty()) {
      const size = this.stats.bounds.getSize(new THREE.Vector3());
      const wantTarget = new THREE.Vector3(0, Math.max(0.8, size.y * 0.5), -1);
      if (!this.dragging) this.target.lerp(wantTarget, damp(1.5, dt) * 0.1);
    }
    if (this.placing) this.updateHover();
    this.env.update(this.time);
    if (this.env.craneHook) this.env.craneHook.position.y = 7.5 - 1.6 + Math.sin(this.time * 0.6) * 0.15;
    // gentle rotor idle spin in the garage for life
    if (this.asm) {
      for (const pv of this.asm.parts.values()) {
        const spin = pv.nodes.get('spin');
        if (spin && pv.layout.def.category === 'rotor') spin.rotation.y += dt * 0.6;
        if (spin && pv.layout.def.category === 'sensor') spin.rotation.y += dt * 1.2;
      }
    }
    if (this.highlight && this.selected && this.asm) {
      const pv = this.asm.parts.get(this.selected);
      if (pv) (this.highlight as any).box.setFromObject(pv.node);
    }
  }

  render(dt: number) {
    this.update(dt);
    this.renderer.render(this.scene, this.camera, dt);
  }
}

/** The classic quartered centre-of-mass symbol, drawn at a constant screen size. */
function comTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = 26;
  g.translate(32, 32);
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, r, (i * Math.PI) / 2, ((i + 1) * Math.PI) / 2);
    g.closePath();
    g.fillStyle = i % 2 ? '#ffffff' : '#ff3aa0';
    g.fill();
  }
  g.lineWidth = 4;
  g.strokeStyle = '#1a0a12';
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
