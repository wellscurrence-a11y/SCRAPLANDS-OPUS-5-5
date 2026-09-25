import type { PartRuntime } from '../part';

export interface Telemetry {
  speed: number;
  rpm?: number;
  maxRpm?: number;
  gear?: string;
  altitude?: number;
  vspeed?: number;
  throttle?: number;
  grounded?: boolean;
  boost?: number; // 0..1 charge
  label?: string;
  warnings?: string[];
}

export interface Controller {
  fixedUpdate(dt: number): void;
  update(dt: number): void;
  onPartChanged(p: PartRuntime): void;
  alternatorPower?(): number;
  telemetry(): Telemetry;
  /** Try to put the machine back on its feet/wheels. */
  selfRight?(): boolean;
  dispose?(): void;
}
