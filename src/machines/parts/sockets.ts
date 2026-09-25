import type { SocketDef, SocketType, Vec3 } from '../types';

export function sock(id: string, type: SocketType, pos: Vec3, normal: Vec3, extra: Partial<SocketDef> = {}): SocketDef {
  return { id, type, pos, normal, ...extra };
}

export function surf(id: string, pos: Vec3, normal: Vec3, size: [number, number], extra: Partial<SocketDef> = {}): SocketDef {
  return { id, type: 'surface', pos, normal, size, ...extra };
}

/** Create a right/left pair. The input describes the right (+X) side; the left is its reflection. */
export function sym(s: SocketDef): SocketDef[] {
  const r: SocketDef = { ...s, id: `${s.id}_r`, side: 1, mirror: `${s.id}_l` };
  const l: SocketDef = {
    ...s,
    id: `${s.id}_l`,
    side: -1,
    mirror: `${s.id}_r`,
    reflect: true,
    pos: [-s.pos[0], s.pos[1], s.pos[2]],
    normal: [-s.normal[0], s.normal[1], s.normal[2]],
    forward: s.forward ? [-s.forward[0], s.forward[1], s.forward[2]] : undefined,
    label: s.label ? s.label.replace('Right', 'Left') : undefined,
  };
  return [r, l];
}
