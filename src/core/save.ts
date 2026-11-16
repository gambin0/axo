/** Versioned save file in localStorage. No network, no accounts. */
export const SAVE_KEY = 'critter-corner-save';
export const SAVE_VERSION = 2;

export interface Settings {
  sound: boolean;
}

export interface SaveData {
  version: number;
  lastSeen: number;
  settings: Settings;
  axolotl: unknown | null;
  ants: unknown | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function freshSave(now: number): SaveData {
  return { version: SAVE_VERSION, lastSeen: now, settings: { sound: true }, axolotl: null, ants: null };
}

type Raw = Record<string, unknown>;

/** Each entry upgrades a save from version N to N+1. */
const migrations: Record<number, (d: Raw) => Raw> = {
  // v1 had a top-level `sound` flag and no settings object.
  1: (d) => {
    const { sound, ...rest } = d;
    return { ...rest, settings: { sound: sound !== false }, version: 2 };
  },
};

export function migrate(raw: Raw): SaveData | null {
  let d = raw;
  let v = typeof d.version === 'number' ? d.version : 0;
  if (v < 1 || v > SAVE_VERSION) return null;
  while (v < SAVE_VERSION) {
    const step = migrations[v];
    if (!step) return null;
    d = step(d);
    v = d.version as number;
  }
  if (typeof d.lastSeen !== 'number') return null;
  const settings = (d.settings ?? {}) as Partial<Settings>;
  return {
    version: SAVE_VERSION,
    lastSeen: d.lastSeen,
    settings: { sound: settings.sound !== false },
    axolotl: d.axolotl ?? null,
    ants: d.ants ?? null,
  };
}

/** Returns null when there is no usable save (first run, or corrupt data). */
export function loadSave(storage: StorageLike): SaveData | null {
  try {
    const text = storage.getItem(SAVE_KEY);
    if (!text) return null;
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object') return null;
    return migrate(raw as Raw);
  } catch {
    return null;
  }
}

export function writeSave(storage: StorageLike, data: SaveData): boolean {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
