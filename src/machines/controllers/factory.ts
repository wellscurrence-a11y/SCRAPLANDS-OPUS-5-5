import type { Machine } from '../machine';
import type { Controller } from './controller';
import { GroundController } from './ground';
import { AirController } from './air';
import { MechController } from './mech';

export function createController(m: Machine): Controller {
  switch (m.cls) {
    case 'ground':
      return new GroundController(m);
    case 'air':
      return new AirController(m);
    case 'mech':
      return new MechController(m);
  }
}
