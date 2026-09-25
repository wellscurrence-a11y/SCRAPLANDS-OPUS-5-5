/** Keyboard + mouse input with pointer lock, edge detection and a scriptable override for automated tests. */
export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'boost'
  | 'handbrake'
  | 'fire1'
  | 'fire2'
  | 'interact'
  | 'lights'
  | 'camera'
  | 'map'
  | 'scan'
  | 'pause'
  | 'reset'
  | 'group1'
  | 'group2'
  | 'group3'
  | 'journal'
  | 'garage';

const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['Space'],
  down: ['KeyC', 'ControlLeft'],
  boost: ['ShiftLeft', 'ShiftRight'],
  handbrake: ['Space'],
  fire1: ['Mouse0'],
  fire2: ['Mouse2'],
  interact: ['KeyE'],
  lights: ['KeyF'],
  camera: ['KeyV'],
  map: ['KeyM'],
  scan: ['Tab'],
  pause: ['Escape', 'KeyP'],
  reset: ['KeyR'],
  group1: ['Digit1'],
  group2: ['Digit2'],
  group3: ['Digit3'],
  journal: ['KeyJ'],
  garage: ['KeyG'],
};

export class Input {
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private releasedThisFrame = new Set<string>();
  bindings = DEFAULT_BINDINGS;
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  mouseX = 0;
  mouseY = 0;
  pointerLocked = false;
  sensitivity = 1;
  invertY = false;
  /** When false, gameplay ignores input (menus open). */
  enabled = true;
  /** Scripted overrides for automated testing. */
  scripted = new Map<Action, number>();
  private canvas: HTMLElement | null = null;
  private listeners: Array<() => void> = [];

  attach(canvas: HTMLElement) {
    this.canvas = canvas;
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedThisFrame.add(e.code);
      this.down.add(e.code);
    };
    const ku = (e: KeyboardEvent) => {
      this.down.delete(e.code);
      this.releasedThisFrame.add(e.code);
    };
    const md = (e: MouseEvent) => {
      const code = `Mouse${e.button}`;
      if (!this.down.has(code)) this.pressedThisFrame.add(code);
      this.down.add(code);
    };
    const mu = (e: MouseEvent) => {
      const code = `Mouse${e.button}`;
      this.down.delete(code);
      this.releasedThisFrame.add(code);
    };
    const mm = (e: MouseEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (this.pointerLocked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    };
    const wh = (e: WheelEvent) => {
      this.wheel += Math.sign(e.deltaY);
    };
    const plc = () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    };
    const blur = () => {
      this.down.clear();
    };
    const ctx = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    window.addEventListener('mousemove', mm);
    window.addEventListener('wheel', wh, { passive: true });
    window.addEventListener('blur', blur);
    document.addEventListener('pointerlockchange', plc);
    canvas.addEventListener('contextmenu', ctx);
    this.listeners.push(
      () => window.removeEventListener('keydown', kd),
      () => window.removeEventListener('keyup', ku),
      () => window.removeEventListener('mousedown', md),
      () => window.removeEventListener('mouseup', mu),
      () => window.removeEventListener('mousemove', mm),
      () => window.removeEventListener('wheel', wh),
      () => window.removeEventListener('blur', blur),
      () => document.removeEventListener('pointerlockchange', plc),
      () => canvas.removeEventListener('contextmenu', ctx),
    );
  }

  requestPointerLock() {
    if (!this.canvas || this.pointerLocked) return;
    try {
      const p = (this.canvas as any).requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Continuous value 0..1 for an action. */
  value(a: Action): number {
    const s = this.scripted.get(a);
    if (s !== undefined) return s;
    if (!this.enabled) return 0;
    for (const code of this.bindings[a]) if (this.down.has(code)) return 1;
    return 0;
  }

  held(a: Action) {
    return this.value(a) > 0.5;
  }

  pressed(a: Action) {
    if (this.scriptedPress.has(a)) return true;
    if (!this.enabled && a !== 'pause' && a !== 'map' && a !== 'journal') return false;
    for (const code of this.bindings[a]) if (this.pressedThisFrame.has(code)) return true;
    return false;
  }

  released(a: Action) {
    for (const code of this.bindings[a]) if (this.releasedThisFrame.has(code)) return true;
    return false;
  }

  keyPressed(code: string) {
    return this.pressedThisFrame.has(code);
  }

  keyHeld(code: string) {
    return this.down.has(code);
  }

  scriptedPress = new Set<Action>();
  pressScripted(a: Action) {
    this.scriptedPress.add(a);
  }

  /** Axis helpers: -1..1 */
  axis(neg: Action, pos: Action) {
    return this.value(pos) - this.value(neg);
  }

  consumeMouse() {
    const dx = this.mouseDX * this.sensitivity;
    const dy = this.mouseDY * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.scriptedPress.clear();
  }

  dispose() {
    for (const l of this.listeners) l();
    this.listeners = [];
  }
}

export const input = new Input();
