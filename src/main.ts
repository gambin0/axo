import { Sound } from './core/audio';
import { elapsedSeconds, runCatchup } from './core/catchup';
import { startLoop } from './core/loop';
import { freshSave, loadSave, SAVE_VERSION, writeSave, type SaveData } from './core/save';
import { envAt, realClock } from './core/time';
import { AntHabitat } from './pets/ants/farm';
import { drawAxolotl } from './pets/axolotl/art';
import { MORPHS, type Morph } from './pets/axolotl/model';
import { AxolotlHabitat } from './pets/axolotl/tank';
import { ButterflyHabitat } from './pets/butterfly/jar';
import { PondHabitat } from './pets/pond/pond';
import type { Habitat, PetId } from './pets/types';
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
const toasts = new Toasts();
const surface = new Surface(VIEW_W, VIEW_H);
let active: PetId | null = null;
let speed = 1;

function persist(): void {
  save.version = SAVE_VERSION;
  save.lastSeen = clock.now();
  save.settings.sound = sound.enabled;
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
  const badge = el('span', { class: 'badge' });
  cards[id] = { canvas, name, badge };
  cardGrid.append(
    el('button', { class: 'card', type: 'button', onclick: () => open(id) }, canvas, el('div', { class: 'row' }, name, badge)),
  );
}
home.append(cardGrid, el('button', { class: 'pill', type: 'button', onclick: () => settingsDialog() }, '⚙️ Settings'));

const view = el('canvas', { id: 'view', width: VIEW_W, height: VIEW_H });
const stage = el('div', { id: 'stage' }, view);
const title = el('h2', {});
const badge = el('span', { class: 'badge' });
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
  sound.unlock();
  if (id && !habitats[id].name) return nameDialog(id);
  active = id;
  home.hidden = id !== null;
  habitatScreen.hidden = id === null;
  toolsKey = '';
  if (id) {
    title.textContent = habitats[id].name;
    resize();
  }
  refreshUi();
  persist();
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
  sound.unlock();
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
      if (typeof s.value === 'string') return el('div', { class: 'stat' }, ico, `${s.label}: `, el('b', {}, s.value));
      const pct = Math.round(Math.max(0, Math.min(100, s.value)));
      const fill = el('i', {});
      fill.style.width = `${pct}%`;
      return el(
        'div',
        { class: 'stat', role: 'meter', 'aria-label': s.label, 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
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
    ...tools.map((t) =>
      el(
        'button',
        {
          class: 'tool',
          type: 'button',
          disabled: t.disabled,
          'aria-pressed': String(t.kind === 'mode' ? h.tool === t.id : !!t.on),
          'aria-label': t.label,
          onclick: () => {
            sound.unlock();
            h.useTool(t.id);
            refreshUi();
          },
        },
        el('span', { class: 'ico', 'aria-hidden': 'true' }, t.icon),
        el('span', { class: 'lbl' }, t.label),
      ),
    ),
  );
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
  const parts: Node[] = [el('h3', {}, info.ask), input];

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

function settingsDialog(): void {
  const soundBtn = el('button', { class: 'plain', type: 'button' }, el('span', {}, ''));
  const paint = () => (soundBtn.firstElementChild!.textContent = sound.enabled ? '🔊 Sound is on' : '🔇 Sound is off');
  soundBtn.addEventListener('click', () => {
    sound.enabled = !sound.enabled;
    sound.unlock();
    paint();
    persist();
  });
  paint();

  const parts: Node[] = [el('h3', {}, 'Settings'), soundBtn, el('p', {}, 'Grown-ups: press and hold to start a pet over.')];
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
  parts.push(el('button', { class: 'big', type: 'button', onclick: () => dlg.close() }, 'Done'));
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
  if (document.hidden) persist();
});
window.addEventListener('pagehide', persist);

if (debug) Object.assign(window, { critters: { habitats, save, persist, setSpeed: (v: number) => (speed = v) } });
