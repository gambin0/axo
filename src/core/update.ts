import { registerSW } from 'virtual:pwa-register';

/** Build stamp baked in at build time, e.g. "2026-11-18 · 42d3197". */
export const BUILD = `${__BUILD_DATE__} · ${__BUILD_HASH__}`;

export interface Updater {
  /** Ask the server now whether a newer build exists. */
  check(): Promise<void>;
  /** True once a newer build has downloaded and is waiting to be switched to. */
  readonly ready: boolean;
  /** Switch to the waiting build (reloads the page). */
  apply(): void;
}

/**
 * Keeps an installed app current. The browser only re-checks the service worker on a
 * fresh launch, and a tablet app is usually resumed rather than relaunched, so we also
 * check whenever the app comes back to the foreground and every half hour while open.
 * A new build waits until `onReady` decides it's a good moment (e.g. on the home screen).
 */
export function startUpdater(onReady: () => void): Updater {
  let ready = false;
  let reg: ServiceWorkerRegistration | undefined;
  const check = async () => {
    if (!reg || !navigator.onLine) return;
    try {
      await reg.update();
    } catch {
      /* offline or server hiccup: try again later */
    }
  };
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      ready = true;
      onReady();
    },
    onRegisteredSW(_url, r) {
      reg = r;
      setInterval(check, 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) void check();
      });
    },
  });
  return {
    check,
    get ready() {
      return ready;
    },
    apply: () => void updateSW(true),
  };
}
