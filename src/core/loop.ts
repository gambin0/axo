export const STEP = 1 / 60;
const MAX_STEPS = 5;
/** A frame gap longer than this means the tab was asleep, not slow. */
const GAP_SEC = 1;

/**
 * Fixed-timestep loop. `step` always gets the same dt, so the simulation is
 * deterministic; `gap` is told about long pauses (a hidden tab) so the app can
 * catch up coarsely instead of spinning through thousands of steps.
 */
export function startLoop(step: (dt: number) => void, render: (time: number) => void, gap: (seconds: number) => void): void {
  let last = performance.now();
  let acc = 0;
  let time = 0;
  const frame = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    if (dt > GAP_SEC) {
      gap(dt);
      acc = 0;
    } else {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n++ < MAX_STEPS) {
        step(STEP);
        acc -= STEP;
        time += STEP;
      }
      if (acc > STEP) acc = 0;
    }
    render(time);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
