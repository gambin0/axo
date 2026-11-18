/** Versioned save file in localStorage. No network, no accounts. */
export const SAVE_KEY = 'critter-corner-save';
export const SAVE_VERSION = 3;

export interface Settings {
  sound: boolean;
  /** Read messages and labels aloud (for children who can't read yet). */
  readAloud: boolean;
  /** Read-aloud voice name; '' follows the device's own voice setting. */
  voice: string;
}

export interface SaveData {
  version: number;
  lastSeen: number;
  settings: Settings;
  /** Saved state per pet id. A pet is missing until it has been adopted. */
  pets: Record<string, unknown>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function freshSave(now: number): SaveData {
  return { version: SAVE_VERSION, lastSeen: now, settings: { sound: true, readAloud: true, voice: '' }, pets: {} };
}

type Raw = Record<string, unknown>;

/** Each entry upgrades a save from version N to N+1. */
const migrations: Record<number, (d: Raw) => Raw> = {
  // v1 had a top-level `sound` flag and no settings object.
  1: (d) => {
    const { sound, ...rest } = d;
    return { ...rest, settings: { sound: sound !== false }, version: 2 };
  },
  // v2 had one top-level field per pet; v3 keeps them in a map so new pets need no migration.
  2: (d) => {
    const { axolotl, ants, ...rest } = d;
    const pets: Raw = {};
    if (axolotl) pets.axolotl = axolotl;
    if (ants) pets.ants = ants;
    return { ...rest, pets, version: 3 };
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
    settings: {
      sound: settings.sound !== false,
      readAloud: settings.readAloud !== false,
      voice: typeof settings.voice === 'string' ? settings.voice : '',
    },
    pets: d.pets && typeof d.pets === 'object' ? { ...(d.pets as Raw) } : {},
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
