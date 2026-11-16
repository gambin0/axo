import { envAt, type Env } from './time';

/** Longest absence we simulate. Beyond this the pets simply waited. */
export const MAX_CATCHUP_SEC = 72 * 3600;
export const COARSE_STEP_SEC = 60;
/** Gaps shorter than this are ignored (a reload, a quick tab switch). */
export const MIN_CATCHUP_SEC = 30;

export interface Coarse {
  /** Advance needs/growth by dt seconds with no per-frame movement. */
  coarseStep(dt: number, env: Env): void;
}

export function elapsedSeconds(lastSeen: number, now: number): number {
  const sec = (now - lastSeen) / 1000;
  if (!Number.isFinite(sec) || sec < MIN_CATCHUP_SEC) return 0;
  return Math.min(sec, MAX_CATCHUP_SEC);
}

/**
 * Simulate `seconds` of absence in one-minute steps. `endHour` is the local
 * hour now; each step gets the hour it would have happened at, so night-time
 * rules apply to the right part of the absence.
 */
export function runCatchup(pet: Coarse, seconds: number, endHour: number): void {
  let left = Math.min(seconds, MAX_CATCHUP_SEC);
  while (left > 0) {
    const dt = Math.min(COARSE_STEP_SEC, left);
    pet.coarseStep(dt, envAt(endHour - left / 3600));
    left -= dt;
  }
}
