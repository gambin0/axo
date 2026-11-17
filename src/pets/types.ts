import type { Env } from '../core/time';
import type { Surface } from '../render/surface';

export type SoundName = 'plop' | 'munch' | 'chirp' | 'bubble' | 'no' | 'tap' | 'splash' | 'pop' | 'hatch' | 'croak';

/** Things the shell should surface to the player. */
export type UiEvent = { type: 'sound'; name: SoundName } | { type: 'toast'; text: string };

export interface Tool {
  id: string;
  icon: string;
  label: string;
  /**
   * mode: stays selected and changes what a tap does. action: fires once. toggle: on/off.
   * drag: something you give the pet. Drag it into the habitat to put it there, or tap it to
   * put it in its usual place (the bowl, the dish, next to the pet).
   */
  kind: 'mode' | 'action' | 'toggle' | 'drag';
  on?: boolean;
  disabled?: boolean;
}

/** Where a dragged thing would land if it were let go now. ok is false when it cannot go there. */
export interface DropHint {
  x: number;
  y: number;
  ok: boolean;
}

export interface Stat {
  icon: string;
  label: string;
  /** 0..100 for a bar, or text for a plain value. */
  value: number | string;
}

export interface Status {
  text: string;
  tone: 'good' | 'warn' | 'sleep';
}

export type PetId = 'axolotl' | 'ants' | 'butterfly' | 'pond' | 'crab' | 'snail' | 'bees' | 'hamster';

/** One habitat: a pet's simulation plus how it draws and responds to touch. */
export interface Habitat {
  readonly id: PetId;
  /** Empty until the player names the pet. */
  name: string;
  /** Currently selected mode tool id. */
  tool: string;
  /** dt: real seconds for movement. slowDt: seconds for needs/growth (dt x debug speed). */
  update(dt: number, slowDt: number, env: Env): void;
  /** Offline catch-up step: needs and growth only. */
  coarseStep(dt: number, env: Env): void;
  /** Call before a catch-up; the returned function reports what changed. */
  beginCatchup(): () => string[];
  render(s: Surface, time: number, env: Env): void;
  pointer(kind: 'down' | 'move' | 'up', x: number, y: number): void;
  tools(): Tool[];
  useTool(id: string): void;
  /** A drag tool let go at a point in the habitat, or tapped (null) to put it in its usual place. */
  drop(id: string, at: { x: number; y: number } | null): void;
  /** Where a drag tool held at (x, y) would land, so it can be shown while dragging. */
  dropHint(id: string, x: number, y: number): DropHint | null;
  stats(): Stat[];
  status(env: Env): Status;
  serialize(): unknown;
  drainEvents(): UiEvent[];
}
