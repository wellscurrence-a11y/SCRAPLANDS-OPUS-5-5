/** Maps keyboard/mouse into a MachineInput depending on the machine class. */
import type { Input } from '../core/input';
import type { Machine } from '../machines/machine';
import type { ChaseCamera } from '../core/camera';

export class PlayerControl {
  lights = false;
  resetHold = 0;

  constructor(private input: Input) {}

  apply(m: Machine, cam: ChaseCamera, dt: number) {
    const i = this.input;
    const mi = m.input;
    const fwd = i.axis('back', 'forward');
    const side = i.axis('left', 'right');
    mi.aimPoint = cam.aimPoint.clone();
    mi.lockTarget = cam.aimMachine && cam.aimPart ? { machine: cam.aimMachine, part: cam.aimPart } : mi.lockTarget && mi.lockTarget.machine.alive ? mi.lockTarget : null;
    mi.fire[0] = i.held('fire1');
    mi.fire[1] = i.held('fire2');
    mi.fire[2] = i.keyHeld('Mouse1');
    mi.boost = i.held('boost');
    if (i.pressed('lights')) this.lights = !this.lights;
    mi.lights = this.lights;
    switch (m.cls) {
      case 'ground':
        mi.throttle = fwd;
        mi.steer = side;
        mi.brake = i.value('handbrake');
        // omni wheels: hold Space and steer to crab sideways
        mi.strafe = side;
        mi.vertical = 0;
        mi.yawTarget = null;
        break;
      case 'air':
        mi.throttle = fwd;
        mi.strafe = side;
        mi.steer = 0;
        mi.vertical = i.value('up') - i.value('down');
        mi.yawTarget = cam.yaw;
        break;
      case 'mech':
        mi.throttle = fwd;
        mi.strafe = side;
        mi.steer = 0;
        mi.vertical = i.value('up');
        mi.yawTarget = cam.yaw;
        break;
    }
    // Hold R to self-right
    if (i.held('reset')) {
      this.resetHold += dt;
      if (this.resetHold > 0.6) {
        m.controller.selfRight?.();
        this.resetHold = -1.5;
      }
    } else this.resetHold = Math.min(0, this.resetHold + dt);
  }
}
