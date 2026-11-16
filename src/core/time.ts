/** Clock abstraction so tests can inject time. */
export interface Clock {
  /** Milliseconds since epoch. */
  now(): number;
  /** Local hour of day, 0..24 (fractional). */
  hour(): number;
}

export const realClock: Clock = {
  now: () => Date.now(),
  hour: () => {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  },
};

export function fixedClock(ms: number, hour = 12): Clock & { ms: number; h: number } {
  return {
    ms,
    h: hour,
    now() {
      return this.ms;
    },
    hour() {
      return this.h;
    },
  };
}

export interface Env {
  hour: number;
  night: boolean;
}

export const isNight = (hour: number): boolean => hour >= 20 || hour < 7;

export function envAt(hour: number): Env {
  const h = ((hour % 24) + 24) % 24;
  return { hour: h, night: isNight(h) };
}
