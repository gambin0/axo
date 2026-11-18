import { Sound } from './core/audio';
import { elapsedSeconds, runCatchup } from './core/catchup';
import { startLoop } from './core/loop';
import { freshSave, loadSave, SAVE_VERSION, writeSave, type SaveData } from './core/save';
import { envAt, realClock } from './core/time';
import { Speaker, wordSpans } from './core/speech';
import { BUILD, startUpdater } from './core/update';
import { AntHabitat } from './pets/ants/farm';
import { drawAxolotl } from './pets/axolotl/art';
import { MORPHS, type Morph } from './pets/axolotl/model';
import { HiveHabitat } from './pets/bees/hive';
import { AxolotlHabitat } from './pets/axolotl/tank';
import { ButterflyHabitat } from './pets/butterfly/jar';
import { CrabHabitat } from './pets/crab/tank';
import { CageHabitat } from './pets/hamster/cage';
import { PondHabitat } from './pets/pond/pond';
import { TerrariumHabitat } from './pets/snail/terrarium';
import type { DropHint, Habitat, PetId, Tool } from './pets/types';
import { Surface, VIEW_H, VIEW_W } from './render/surface';
import { el, fitCanvas, holdButton, present, Toasts } from './render/ui';

interface PetInfo {
  title: string;
  kind: string;
  defaultName: string;
  ask: string;
  create(saved: unknown, seed: number): Habitat;
}

/** Every pet in the app. Adding one here is all the shell needs. */
const PETS: Record<PetId, PetInfo> = {
  axolotl: {
    title: 'Aquarium', kind: 'axolotl', defaultName: 'Mochi', ask: 'What will you call your axolotl?',
    create: (saved, seed) => new AxolotlHabitat(saved, seed),
  },
  ants: {
    title: 'Ant Farm', kind: 'ant colony', defaultName: 'Antsville', ask: 'What will you call your ant colony?',
    create: (saved, seed) => new AntHabitat(saved, seed),
  },
  butterfly: {
    title: 'Butterfly Jar', kind: 'butterfly jar', defaultName: 'Flutter', ask: 'What will you call your caterpillar?',
    create: (saved, seed) => new ButterflyHabitat(saved, seed),
  },
  pond: {
    title: 'Tadpole Pond', kind: 'pond', defaultName: 'Lily Pond', ask: 'What will you call your pond?',
    create: (saved, seed) => new PondHabitat(saved, seed),
  },
  crab: {
    title: 'Hermit Crab', kind: 'hermit crab', defaultName: 'Pinchy', ask: 'What will you call your hermit crab?',
    create: (saved, seed) => new CrabHabitat(saved, seed),
  },
  snail: {
    title: 'Snail Garden', kind: 'snail terrarium', defaultName: 'Mossy', ask: 'What will you call your snail garden?',
    create: (saved, seed) => new TerrariumHabitat(saved, seed),
  },
  bees: {
    title: 'Beehive', kind: 'beehive', defaultName: 'Honeycomb', ask: 'What will you call your beehive?',
    create: (saved, seed) => new HiveHabitat(saved, seed),
  },
  hamster: {
    title: 'Hamster Cage', kind: 'hamster', defaultName: 'Peanut', ask: 'What will you call your hamster?',
    create: (saved, seed) => new CageHabitat(saved, seed),
  },
};
const PET_IDS = Object.keys(PETS) as PetId[];

const clock = realClock;
const debug = new URLSearchParams(location.search).has('debug');
const newSeed = () => (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;

// ---- state ---------------------------------------------------------------

const save: SaveData = loadSave(localStorage) ?? freshSave(clock.now());
const habitats = {} as Record<PetId, Habitat>;
for (const id of PET_IDS) habitats[id] = PETS[id].create(save.pets[id] ?? null, newSeed());
const sound = new Sound();
sound.enabled = save.settings.sound;
const speaker = new Speaker();
speaker.enabled = save.settings.readAloud;
const toasts = new Toasts(speaker);
/** Any touch counts as permission to make sound. (Speech starts from taps too, which is what tablets need.) */
const unlock = () => sound.unlock();
/** Say an on-screen label when it's tapped, lighting up its words. */
const hear = (text: string, marks: HTMLElement[] = []) => speaker.sayNow(text, marks);
/** Text that lights up word by word when read. */
function readable(text: string): { node: HTMLElement; marks: HTMLElement[] } {
  const { nodes, marks } = wordSpans(text);
  return { node: el('span', {}, ...nodes), marks };
}
const surface = new Surface(VIEW_W, VIEW_H);
let active: PetId | null = null;
let speed = 1;

function persist(): void {
  save.version = SAVE_VERSION;
  save.lastSeen = clock.now();
  save.settings.sound = sound.enabled;
  save.settings.readAloud = speaker.enabled;
  // A pet is only saved once it has been named, i.e. adopted.
  save.pets = {};
  for (const id of PET_IDS) if (habitats[id].name) save.pets[id] = habitats[id].serialize();
  writeSave(localStorage, save);
}

/** Simulate time the app was closed or hidden, and say what happened. */
function catchUp(seconds: number): void {
  if (seconds <= 0) return;
  const lines: string[] = [];
  for (const h of Object.values(habitats)) {
    if (!h.name) continue;
    const report = h.beginCatchup();
    runCatchup(h, seconds, clock.hour());
    lines.push(...report());
  }
  if (lines.length && seconds > 600) toasts.show(`While you were away… ${lines.join(', ')}.`, 6000);
}

// ---- screens -------------------------------------------------------------

const app = document.getElementById('app')!;

const cards = {} as Record<PetId, { canvas: HTMLCanvasElement; name: HTMLElement; badge: HTMLElement }>;
const home = el('section', { id: 'home' }, el('h1', {}, 'Critter Corner'));
const cardGrid = el('div', { class: 'cards' });
for (const id of PET_IDS) {
  const canvas = el('canvas', { width: VIEW_W, height: VIEW_H, 'aria-hidden': 'true' });
  const name = el('span', {});
  const badge = el('span', { class: 'badge', onpointerdown: () => (unlock(), hear(badge.textContent ?? '')) });
  cards[id] = { canvas, name, badge };
  cardGrid.append(
    el('button', { class: 'card', type: 'button', onclick: () => open(id) }, canvas, el('div', { class: 'row' }, name, badge)),
  );
}
home.append(cardGrid, el('button', { class: 'pill', type: 'button', onclick: () => settingsDialog() }, '⚙️ Settings'));

const view = el('canvas', { id: 'view', width: VIEW_W, height: VIEW_H });
const stage = el('div', { id: 'stage' }, view);
const title = el('h2', { onpointerdown: () => (unlock(), active && hear(petIntro(active))) });
const petIntro = (id: PetId) => `${habitats[id].name} the ${PETS[id].kind}`;
const badge = el('span', { class: 'badge', onpointerdown: () => (unlock(), hear(badge.textContent ?? '')) });
const statsBox = el('div', { id: 'stats' });
const toolsBox = el('div', { id: 'tools', role: 'toolbar', 'aria-label': 'Tools' });
const habitatScreen = el(
  'section',
  { id: 'habitat', hidden: true },
  el('header', {}, el('button', { class: 'round', type: 'button', 'aria-label': 'Home', onclick: () => open(null) }, '🏠'), title, badge),
  stage,
  el('div', { id: 'side' }, statsBox, toolsBox),
);
app.append(home, habitatScreen, toasts.root);

function open(id: PetId | null): void {
  unlock();
  if (id && !habitats[id].name) return nameDialog(id);
  active = id;
  home.hidden = id !== null;
  habitatScreen.hidden = id === null;
  toolsKey = '';
  if (id) {
    hear(petIntro(id));
    if (!toldDrag) {
      toldDrag = true;
      toasts.show('Drag food from the buttons into the habitat, or just tap a button to put it in its usual place.');
    }
    title.textContent = habitats[id].name;
    resize();
  }
  refreshUi();
  persist();
  if (id === null) maybeUpdate();
}

function resize(): void {
  if (active) fitCanvas(view, stage.clientWidth - 8, stage.clientHeight - 8);
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(stage);

// ---- pointer input -------------------------------------------------------

function toArt(ev: PointerEvent): [number, number] {
  const r = view.getBoundingClientRect();
  return [((ev.clientX - r.left) / r.width) * VIEW_W, ((ev.clientY - r.top) / r.height) * VIEW_H];
}
let pressed = false;
view.addEventListener('pointerdown', (ev) => {
  if (!active) return;
  unlock();
  pressed = true;
  view.setPointerCapture(ev.pointerId);
  habitats[active].pointer('down', ...toArt(ev));
  ev.preventDefault();
});
view.addEventListener('pointermove', (ev) => {
  if (active && pressed) habitats[active].pointer('move', ...toArt(ev));
});
for (const type of ['pointerup', 'pointercancel'] as const)
  view.addEventListener(type, (ev) => {
    if (active && pressed) habitats[active].pointer('up', ...toArt(ev));
    pressed = false;
  });
view.addEventListener('contextmenu', (ev) => ev.preventDefault());

// ---- status, stats and tools --------------------------------------------

let toolsKey = '';

function setBadge(node: HTMLElement, h: Habitat): void {
  const env = envAt(clock.hour());
  const st = h.name ? h.status(env) : { text: 'Tap to meet!', tone: 'good' as const };
  node.textContent = st.text;
  node.className = `badge ${st.tone}`;
}

function refreshUi(): void {
  for (const id of PET_IDS) {
    cards[id].name.textContent = habitats[id].name || PETS[id].title;
    setBadge(cards[id].badge, habitats[id]);
  }
  if (!active) return;
  const h = habitats[active];
  setBadge(badge, h);

  statsBox.replaceChildren(
    ...h.stats().map((s) => {
      const ico = el('span', { class: 'ico', 'aria-hidden': 'true' }, s.icon);
      const say = () => (unlock(), hear(typeof s.value === 'string' ? `${s.label}: ${s.value}` : s.label));
      if (typeof s.value === 'string') return el('div', { class: 'stat', onpointerdown: say }, ico, `${s.label}: `, el('b', {}, s.value));
      const pct = Math.round(Math.max(0, Math.min(100, s.value)));
      const fill = el('i', {});
      fill.style.width = `${pct}%`;
      return el(
        'div',
        { class: 'stat', onpointerdown: say, role: 'meter', 'aria-label': s.label, 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
        ico,
        s.label,
        el('div', { class: `bar${pct < 30 ? ' low' : ''}` }, fill),
      );
    }),
  );

  // Rebuild the toolbar only when it actually changes, so a press is never interrupted.
  const tools = h.tools();
  const key = JSON.stringify([active, h.tool, tools]);
  if (key === toolsKey) return;
  toolsKey = key;
  toolsBox.replaceChildren(
    ...tools.map((t) => {
      const label = readable(t.label);
      return el(
        'button',
        {
          class: 'tool',
          type: 'button',
          disabled: t.disabled,
          'data-drag': t.kind === 'drag' ? '' : undefined,
          'aria-pressed': t.kind === 'drag' ? undefined : String(t.kind === 'mode' ? h.tool === t.id : !!t.on),
          'aria-label': t.kind === 'drag' ? `${t.label}: drag it in, or tap to put it in its usual place` : t.label,
          onpointerdown: (ev: PointerEvent) => {
            unlock();
            if (!t.disabled) hear(t.label, label.marks);
            if (t.kind === 'drag') startDrag(t, ev);
          },
          onclick: (ev: MouseEvent) => {
            unlock();
            // a drag tool's taps and drags are handled by its pointer events; a keyboard press puts it in its usual place
            if (t.kind === 'drag') {
              if (ev.detail === 0) h.drop(t.id, null);
            } else h.useTool(t.id);
            refreshUi();
          },
        },
        el('span', { class: 'ico', 'aria-hidden': 'true' }, t.icon),
        el('span', { class: 'lbl' }, label.node),
      );
    }),
  );
}

// ---- dragging things in from the toolbar ----------------------------------

interface Drag {
  id: string;
  sx: number;
  sy: number;
  moved: boolean;
  ghost: HTMLElement;
  /** The point in the habitat under the finger, or null when it is off the habitat. */
  at: { x: number; y: number } | null;
  hint: DropHint | null;
}
let drag: Drag | null = null;
let toldDrag = false;

function startDrag(t: Tool, ev: PointerEvent): void {
  if (!active || t.disabled || ev.button > 0) return;
  unlock();
  drag = { id: t.id, sx: ev.clientX, sy: ev.clientY, moved: false, ghost: el('div', { class: 'ghost', 'aria-hidden': 'true' }, t.icon), at: null, hint: null };
  ev.preventDefault();
}

window.addEventListener('pointermove', (ev) => {
  if (!drag || !active) return;
  if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 10) {
    drag.moved = true;
    document.body.append(drag.ghost);
  }
  if (!drag.moved) return;
  drag.ghost.style.left = `${ev.clientX}px`;
  drag.ghost.style.top = `${ev.clientY}px`;
  const r = view.getBoundingClientRect();
  const over = ev.clientX >= r.left && ev.clientX < r.right && ev.clientY >= r.top && ev.clientY < r.bottom;
  drag.at = over ? (([x, y]) => ({ x, y }))(toArt(ev)) : null;
  drag.hint = drag.at ? habitats[active].dropHint(drag.id, drag.at.x, drag.at.y) : null;
  drag.ghost.classList.toggle('over', over);
  drag.ghost.classList.toggle('no', !!drag.hint && !drag.hint.ok);
});

function endDrag(cancel: boolean): void {
  const d = drag;
  drag = null;
  if (!d) return;
  d.ghost.remove();
  if (!active || cancel) return;
  const h = habitats[active];
  if (!d.moved) h.drop(d.id, null);
  else if (d.at) h.drop(d.id, d.at);
  else return; // let go off the habitat: nothing happens
  refreshUi();
}
window.addEventListener('pointerup', () => endDrag(false));
window.addEventListener('pointercancel', () => endDrag(true));

/** A pulsing target on the spot where the dragged thing would land: white when it can go there, red when not. */
function drawDropHint(sf: Surface, hint: DropHint, time: number): void {
  const c = hint.ok ? 0xffffff : 0xff5a4a;
  const r = 8 + Math.sin(time * 7) * 1.2;
  for (let a = 0; a < Math.PI * 2; a += 0.05) {
    if (Math.floor((a + time) * 3) % 2) continue;
    sf.blend(Math.round(hint.x + Math.cos(a) * r), Math.round(hint.y + Math.sin(a) * r * 0.55), c, 0.9);
  }
  // a little arrow pointing down at it
  const top = Math.round(hint.y - 16 + Math.sin(time * 7) * 1.5);
  for (let k = 0; k < 6; k++) sf.blend(Math.round(hint.x), top + k, c, 0.9);
  for (let k = 1; k <= 3; k++) {
    sf.blend(Math.round(hint.x) - k, top + 5 - k, c, 0.9);
    sf.blend(Math.round(hint.x) + k, top + 5 - k, c, 0.9);
  }
}

// ---- dialogs -------------------------------------------------------------

function dialog(...children: Node[]): { close(): void } {
  const scrim = el('div', { class: 'scrim' }, el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, ...children));
  const close = () => scrim.remove();
  scrim.addEventListener('pointerdown', (ev) => {
    if (ev.target === scrim) close();
  });
  document.body.append(scrim);
  return { close };
}

function nameDialog(id: PetId): void {
  const info = PETS[id];
  const input = el('input', { type: 'text', maxLength: 16, placeholder: info.defaultName, 'aria-label': 'Name', autocomplete: 'off' });
  let morph: Morph = 'leucistic';
  const ask = readable(info.ask);
  const parts: Node[] = [el('h3', { onpointerdown: () => hear(info.ask, ask.marks) }, ask.node), input];
  hear(info.ask, ask.marks);

  if (id === 'axolotl') {
    const grid = el('div', { class: 'morphs' });
    const buttons = MORPHS.map((m) => {
      const c = el('canvas', { width: 80, height: 40 });
      const sf = new Surface(80, 40);
      for (let i = 0; i < sf.data.length; i += 4) sf.data.set([44, 125, 147, 255], i);
      drawAxolotl(sf, { x: 40, y: 20, turn: 1, size: 1.4, morph: m, swimPhase: 1, gillPhase: 0, swim: 0.3, mouth: 0, pale: 0, grounded: false });
      present(c, sf);
      const b = el('button', { type: 'button', 'aria-label': m, 'aria-pressed': String(m === morph) }, c);
      b.addEventListener('click', () => {
        morph = m;
        buttons.forEach((o, i) => o.setAttribute('aria-pressed', String(MORPHS[i] === m)));
      });
      return b;
    });
    grid.append(...buttons);
    parts.push(el('p', {}, 'Pick a colour:'), grid);
  }

  const start = () => {
    const h = habitats[id];
    h.name = input.value.trim().slice(0, 16) || info.defaultName;
    if (h instanceof AxolotlHabitat) h.setMorph(morph);
    dlg.close();
    open(id);
  };
  input.addEventListener('keydown', (ev) => ev.key === 'Enter' && start());
  parts.push(el('button', { class: 'big', type: 'button', onclick: start }, "Let's go!"));
  const dlg = dialog(...parts);
  input.focus();
}

// ---- updates -------------------------------------------------------------

/** Switch to a downloaded update, but only when nobody is mid-play: on the home screen with no dialog open, or while the app is hidden. */
function maybeUpdate(): void {
  if (!updater.ready) return;
  if (!document.hidden && (active !== null || document.querySelector('.scrim'))) return;
  persist();
  updater.apply();
}
const updater = startUpdater(maybeUpdate);

function updateRow(): HTMLElement {
  const status = el('span', {}, `Version ${BUILD}`);
  const btn = el('button', { class: 'plain', type: 'button' }, '🔄 Check for updates');
  btn.addEventListener('click', async () => {
    if (updater.ready) {
      persist();
      return updater.apply();
    }
    if (!navigator.onLine) return void (status.textContent = `Version ${BUILD} · offline, can't check`);
    btn.disabled = true;
    status.textContent = `Version ${BUILD} · checking…`;
    await updater.check();
    // the new build takes a moment to download after the check finds it
    await new Promise((r) => setTimeout(r, 2500));
    btn.disabled = false;
    if (updater.ready) {
      status.textContent = `Version ${BUILD} · update downloaded`;
      btn.textContent = '✨ Update now';
    } else status.textContent = `Version ${BUILD} · up to date`;
  });
  return el('div', { class: 'version' }, status, btn);
}

function settingsDialog(): void {
  const soundBtn = el('button', { class: 'plain', type: 'button' }, el('span', {}, ''));
  const paint = () => (soundBtn.firstElementChild!.textContent = sound.enabled ? '🔊 Sound is on' : '🔇 Sound is off');
  soundBtn.addEventListener('click', () => {
    sound.enabled = !sound.enabled;
    unlock();
    paint();
    persist();
  });
  paint();

  const readBtn = el('button', { class: 'plain', type: 'button' }, el('span', {}, ''));
  const paintRead = () =>
    (readBtn.firstElementChild!.textContent = !speaker.available
      ? '🗣️ Read aloud isn’t available on this device'
      : speaker.enabled
        ? '🗣️ Read aloud is on'
        : '🤫 Read aloud is off');
  readBtn.disabled = !speaker.available;
  readBtn.addEventListener('click', () => {
    speaker.enabled = !speaker.enabled;
    if (!speaker.enabled) speaker.stop();
    unlock();
    paintRead();
    persist();
    hear('Read aloud is on');
  });
  paintRead();

  const parts: Node[] = [el('h3', {}, 'Settings'), soundBtn, readBtn, el('p', {}, 'Grown-ups: press and hold to start a pet over.')];
  for (const id of PET_IDS)
    parts.push(
      holdButton(`Hold to reset the ${PETS[id].kind}`, 2000, () => {
        habitats[id] = PETS[id].create(null, newSeed());
        persist();
        refreshUi();
        toasts.show(`The ${PETS[id].kind} has been reset.`);
      }),
    );

  if (debug) {
    const select = el('select', { 'aria-label': 'Time speed' });
    for (const v of [1, 60, 600, 3600]) select.append(el('option', { value: String(v), selected: v === speed }, `${v}×`));
    select.addEventListener('change', () => (speed = Number(select.value)));
    parts.push(el('div', { class: 'line' }, el('span', {}, 'Debug: time speed'), select));
  }
  parts.push(updateRow());
  parts.push(el('button', { class: 'big', type: 'button', onclick: () => (dlg.close(), maybeUpdate()) }, 'Done'));
  const dlg = dialog(...parts);
}

// ---- main loop -----------------------------------------------------------

let uiClock = 0;
let saveClock = 0;
let previewClock = 0;

function step(dt: number): void {
  const env = envAt(clock.hour());
  for (const id of PET_IDS) {
    const h = habitats[id];
    // A pet's clock only starts once it has been adopted (named).
    if (!h.name) continue;
    h.update(dt, dt * speed, env);
    for (const ev of h.drainEvents()) {
      if (ev.type === 'toast') toasts.show(ev.text);
      else if (id === active) sound.play(ev.name);
    }
  }
  uiClock += dt;
  if (uiClock >= 0.25) {
    uiClock = 0;
    refreshUi();
  }
  saveClock += dt;
  if (saveClock >= 10) {
    saveClock = 0;
    persist();
  }
}

function render(time: number): void {
  const env = envAt(clock.hour());
  if (active) {
    habitats[active].render(surface, time, env);
    if (drag?.hint) drawDropHint(surface, drag.hint, time);
    present(view, surface);
    return;
  }
  // Home screen: live previews at a gentle frame rate.
  if (time - previewClock < 0.1 && previewClock <= time) return;
  previewClock = time;
  for (const id of PET_IDS) {
    habitats[id].render(surface, time, env);
    present(cards[id].canvas, surface);
  }
}

catchUp(elapsedSeconds(save.lastSeen, clock.now()));
refreshUi();
startLoop(step, render, (seconds) => catchUp(elapsedSeconds(0, seconds * 1000)));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    persist();
    maybeUpdate();
  }
});
window.addEventListener('pagehide', persist);

if (debug) Object.assign(window, { critters: { habitats, save, persist, setSpeed: (v: number) => (speed = v) } });
