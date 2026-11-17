import { clamp, hash2 } from '../../core/rng';
import type { Env } from '../../core/time';
import { Particles } from '../../render/particles';
import { dither, mix, Surface, VIEW_H, VIEW_W } from '../../render/surface';
import type { DropHint, Habitat, Stat, Status, Tool, UiEvent } from '../types';
import { drawAxolotl } from './art';
import { AXO, Axolotl, newAxoState, TANK, type DecorId, type Morph } from './model';

const WATER = [0x58b7bd, 0x3d9aa8, 0x2c7d93, 0x20647f, 0x194f69];
const PEBBLE = [0xd2c2a2, 0xb3a283, 0x94846a, 0x766856, 0x5c5145];
const STONE = [0xa9aaa4, 0x868781, 0x65665f, 0x494a45, 0x31322f];
const WOOD = [0x9a7850, 0x7a5c3a, 0x5a4229, 0x3e2c1b];
const LEAF_BACK = [0x3f8f5a, 0x2f7448, 0x235a3a, 0x18432c];
const LEAF = [0x7fc85c, 0x55a844, 0x3a8636, 0x27652b];

const DECOR: { id: DecorId; icon: string; label: string }[] = [
  { id: 'cave', icon: '🪨', label: 'Cave' },
  { id: 'fern', icon: '🌿', label: 'Fern' },
  { id: 'wood', icon: '🪵', label: 'Wood' },
  { id: 'bubbler', icon: '🫧', label: 'Bubbles' },
];

const gravelTop = (x: number): number =>
  TANK.gravel + Math.round(Math.sin(x * 0.045) * 2 + Math.sin(x * 0.13 + 1) * 1.2);

/** Wavy plant blade that sways more toward its tip. */
function blade(
  sf: Surface, x0: number, y0: number, len: number, lean: number, width: number,
  ramp: readonly number[], t: number, phase: number, haze: number,
): void {
  for (let i = 0; i < len; i++) {
    const f = i / len;
    const w = Math.max(1, Math.round(width * Math.sin(Math.PI * Math.min(1, 0.15 + f * 0.85)) ** 0.6));
    const cx = x0 + lean * f * f * len * 0.35 + Math.sin(t * 0.9 + phase + f * 2.4) * 3.5 * f * f;
    const y = y0 - i;
    for (let j = 0; j < w; j++) {
      const x = Math.round(cx - w / 2 + j);
      let c = ramp[j === 0 ? 2 : j === w - 1 && w > 2 ? 3 : 1];
      if (w >= 3 && j === Math.floor(w / 2)) c = ramp[0]; // midrib catches the light
      if (hash2(x0 + i, j, 5) > 0.93) c = ramp[3];
      sf.px(x, y, haze > 0 ? mix(c, WATER[2], haze) : c);
    }
  }
}

function caveShape(x: number, y: number): 'rock' | 'hole' | null {
  const dx = x - TANK.caveX, dy = y - (TANK.gravel + 2);
  if (dy > 0) return null;
  const bump = hash2(Math.round(x / 3), 0, 9) * 0.12;
  const outer = (dx / 42) ** 2 + (dy / 27) ** 2;
  if (outer > 1 - bump) return null;
  const inner = (dx / 29) ** 2 + (dy / 16) ** 2;
  return inner < 1 ? 'hole' : 'rock';
}

function stoneColor(x: number, y: number, light: number): number {
  const n = hash2(x >> 1, y >> 1, 11) * 0.25 + hash2(x, y, 12) * 0.12;
  return dither(STONE, clamp(1 - light + n - 0.1, 0, 1), x, y);
}

export class AxolotlHabitat implements Habitat {
  readonly id = 'axolotl';
  tool = 'hand';
  model: Axolotl;
  private particles = new Particles();
  private bg = new Surface(VIEW_W, VIEW_H);
  private bgKey = '';
  private events: UiEvent[] = [];
  private bubbleClock = 0;
  private lastCare: number;
  private fullToast = 0;

  constructor(saved: unknown, seed: number) {
    this.model = saved ? Axolotl.load(saved, seed) : new Axolotl(newAxoState(seed));
    this.lastCare = this.model.s.care;
  }

  get name(): string {
    return this.model.s.name;
  }
  set name(v: string) {
    this.model.s.name = v;
  }
  setMorph(m: Morph): void {
    this.model.s.morph = m;
  }

  // ---- simulation --------------------------------------------------------

  update(dt: number, slowDt: number, env: Env): void {
    const m = this.model;
    m.update(dt, slowDt, env);
    this.fullToast = Math.max(0, this.fullToast - dt);

    if (m.s.decor.bubbler && m.s.waterChange === 0) {
      this.bubbleClock += dt;
      while (this.bubbleClock > 0.12) {
        this.bubbleClock -= 0.12;
        this.particles.spawn('bubble', TANK.bubblerX + (Math.random() - 0.5) * 4, TANK.gravel - 4);
      }
    }

    for (const fx of m.fx) {
      switch (fx.kind) {
        case 'heart':
        case 'zzz':
        case 'ripple':
        case 'no':
        case 'sparkle':
        case 'bubble':
          this.particles.spawn(fx.kind, fx.x, fx.y);
          break;
        case 'munch':
          for (let i = 0; i < 4; i++) this.particles.spawn('crumb', fx.x, fx.y, 0xc9a070);
          this.particles.spawn('bubble', fx.x, fx.y - 2);
          break;
        case 'plop':
        case 'splash':
          this.particles.spawn('ripple', fx.x, fx.y + 1);
          break;
        default:
          break;
      }
      const sound = ({ munch: 'munch', plop: 'plop', chirp: 'chirp', no: 'no', splash: 'splash', sparkle: 'pop' } as const)[
        fx.kind as 'munch'
      ];
      if (sound) this.events.push({ type: 'sound', name: sound });
    }
    m.fx.length = 0;

    for (const d of DECOR) {
      const need = AXO.decorUnlock[d.id];
      if (need > 0 && this.lastCare < need && m.s.care >= need)
        this.events.push({ type: 'toast', text: `New decoration unlocked: ${d.icon} ${d.label}!` });
    }
    this.lastCare = m.s.care;

    this.particles.update(dt, TANK.surface + 1);
  }

  coarseStep(dt: number, env: Env): void {
    this.model.coarseStep(dt, env);
  }

  beginCatchup(): () => string[] {
    return () => {
      const s = this.model.s;
      const who = s.name || 'Your axolotl';
      const out: string[] = [];
      if (s.fullness < 30) out.push(`${who} got hungry`);
      if (s.cleanliness < 50 || s.wastes.length > 0) out.push('the tank needs a clean');
      if (!out.length) out.push(`${who} missed you`);
      return out;
    };
  }

  // ---- input -------------------------------------------------------------

  pointer(kind: 'down' | 'move' | 'up', x: number, y: number): void {
    const m = this.model;
    if (kind === 'up') {
      m.finger = null;
      return;
    }
    switch (this.tool) {
      case 'siphon':
        if (m.siphon(x, y) === 0 && kind === 'down') this.particles.spawn('ripple', x, y);
        break;
      default:
        if (kind === 'down') {
          if (m.hit(x, y)) m.pet();
          else {
            m.tapGlass(x, y);
            this.events.push({ type: 'sound', name: 'tap' });
          }
        } else if (y > TANK.surface) {
          m.finger = { x, y };
        }
    }
  }

  tools(): Tool[] {
    const m = this.model;
    const list: Tool[] = [
      { id: 'hand', icon: '✋', label: 'Pet', kind: 'mode' },
      { id: 'pellet', icon: '🟤', label: 'Pellet', kind: 'drag' },
      { id: 'worm', icon: '🪱', label: 'Worm', kind: 'drag' },
      { id: 'siphon', icon: '🧹', label: 'Clean', kind: 'mode' },
      { id: 'water', icon: '💧', label: 'New water', kind: 'action', disabled: !m.canChangeWater() },
      { id: 'lamp', icon: '💡', label: 'Lamp', kind: 'toggle', on: m.s.lamp },
    ];
    for (const d of DECOR) {
      const open = m.unlocked(d.id);
      list.push({
        id: `decor:${d.id}`,
        icon: open ? d.icon : '🔒',
        label: d.label,
        kind: 'toggle',
        on: open && m.s.decor[d.id],
        disabled: !open,
      });
    }
    return list;
  }

  useTool(id: string): void {
    const m = this.model;
    if (id === 'water') {
      if (m.startWaterChange()) this.events.push({ type: 'toast', text: 'Fresh water coming in!' });
    } else if (id === 'lamp') m.s.lamp = !m.s.lamp;
    else if (id.startsWith('decor:')) m.toggleDecor(id.slice(6) as DecorId);
    else this.tool = id;
  }

  drop(id: string, at: { x: number; y: number } | null): void {
    if (id !== 'pellet' && id !== 'worm') return;
    const m = this.model;
    const full = !m.willEat();
    // tapped: drop it in just above the axolotl
    const x = at ? at.x : m.s.x + (Math.random() - 0.5) * 20;
    if (m.dropFood(x, id) && full && this.fullToast <= 0) {
      this.fullToast = 8;
      this.events.push({ type: 'toast', text: `${m.s.name || 'Your axolotl'} is full. Leftover food makes the water dirty!` });
    }
  }

  dropHint(_id: string, x: number): DropHint {
    // food goes in at the surface and sinks
    return { x: Math.max(TANK.left + 10, Math.min(TANK.right - 10, x)), y: TANK.surface + 4, ok: true };
  }

  stats(): Stat[] {
    const s = this.model.s;
    return [
      { icon: '🍤', label: 'Tummy', value: s.fullness },
      { icon: '💗', label: 'Happy', value: s.happiness },
      { icon: '💧', label: 'Water', value: s.cleanliness },
      { icon: '⚡', label: 'Energy', value: s.energy },
      { icon: '📏', label: 'Size', value: s.growth < 0.34 ? 'Baby' : s.growth < 0.8 ? 'Young' : 'Grown-up' },
    ];
  }

  status(env: Env): Status {
    const s = this.model.s;
    switch (this.model.mood(env)) {
      case 'hungry':
        return { text: 'Hungry!', tone: 'warn' };
      case 'sad':
        return { text: s.cleanliness < 35 ? 'Tank is dirty' : 'Feeling down', tone: 'warn' };
      case 'sleepy':
        return { text: 'Sleepy…', tone: 'sleep' };
      case 'happy':
        return { text: 'Happy!', tone: 'good' };
      default:
        return { text: 'Doing fine', tone: 'good' };
    }
  }

  serialize(): unknown {
    return this.model.serialize();
  }

  drainEvents(): UiEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---- drawing -----------------------------------------------------------

  /** Everything that never moves: water gradient, gravel, rocks, decorations. */
  private buildBackground(): void {
    const sf = this.bg;
    const d = this.model.s.decor;
    for (let y = 0; y < VIEW_H; y++)
      for (let x = 0; x < VIEW_W; x++) {
        const depth = (y - TANK.surface) / (VIEW_H - TANK.surface);
        // darker toward the corners, like a real tank lit from above
        const edge = Math.abs(x - 160) / 160;
        sf.px(x, y, dither(WATER, clamp(depth * 0.85 + edge * edge * 0.25, 0, 1), x, y));
      }
    // distant rockwork silhouettes on the back wall
    for (let x = 0; x < VIEW_W; x++) {
      const h = 22 + Math.sin(x * 0.035 + 2) * 12 + Math.sin(x * 0.11) * 5 + hash2(x >> 2, 0, 4) * 4;
      for (let y = Math.round(TANK.gravel - h); y < TANK.gravel + 4; y++) sf.blend(x, y, 0x164458, 0.42);
    }

    if (d.wood) {
      // driftwood: a leaning log with a forked branch
      const limb = (x0: number, y0: number, x1: number, y1: number, r0: number, r1: number) => {
        const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
        for (let i = 0; i <= n; i++) {
          const f = i / n;
          const cx = x0 + (x1 - x0) * f + Math.sin(f * 5) * 2, cy = y0 + (y1 - y0) * f;
          const r = r0 + (r1 - r0) * f;
          for (let j = -Math.ceil(r); j <= Math.ceil(r); j++) {
            if (Math.abs(j) > r) continue;
            const v = (j + r) / (2 * r);
            const x = Math.round(cx), y = Math.round(cy + j);
            const grain = hash2(i >> 2, j, 21) > 0.8 ? 0.2 : 0;
            sf.px(x, y, dither(WOOD, clamp(v * 0.9 + grain, 0, 1), x, y));
            sf.px(x + 1, y, dither(WOOD, clamp(v * 0.9 + grain, 0, 1), x + 1, y));
          }
        }
      };
      limb(92, TANK.gravel + 2, 150, 118, 5, 2.5);
      limb(124, 134, 142, 98, 2.5, 1);
      limb(150, 118, 176, 110, 2.2, 0.8);
    }

    if (d.cave) {
      for (let y = TANK.gravel - 30; y <= TANK.gravel + 2; y++)
        for (let x = TANK.caveX - 44; x <= TANK.caveX + 44; x++)
          if (caveShape(x, y) === 'hole') sf.px(x, y, dither([0x0c1d26, 0x112934], hash2(x, y, 2), x, y));
    }

    // gravel bed of individual pebbles
    for (let x = 0; x < VIEW_W; x++) {
      const top = gravelTop(x);
      for (let y = top; y < VIEW_H; y++) {
        const row = Math.floor((y - TANK.gravel + 8) / 3);
        const px = x + (row & 1) * 2;
        const cell = Math.floor(px / 4);
        const tone = hash2(cell, row, 1);
        const inX = px % 4, inY = (y - TANK.gravel + 8) % 3;
        let t = tone * 0.6 + (y - top) / 60;
        if (inY === 0 && inX < 3) t -= 0.18; // lit top of each pebble
        if (inX === 3 || inY === 2) t += 0.25; // gap shadow
        const grey = hash2(cell, row, 6) > 0.82;
        const c = dither(grey ? STONE : PEBBLE, clamp(t, 0, 1), x, y);
        sf.px(x, y, y === top ? mix(c, 0xfff6dd, 0.25) : c);
      }
    }
    // a few smooth stones resting on the gravel
    for (const [cx, rx, ry] of [[34, 9, 5], [118, 6, 4], [200, 11, 6]] as const) {
      const cy = gravelTop(cx) + 1;
      for (let y = cy - ry; y <= cy + 2; y++)
        for (let x = cx - rx; x <= cx + rx; x++) {
          const dx = (x - cx) / rx, dy = (y - cy) / ry;
          if (dx * dx + dy * dy > 1) continue;
          sf.px(x, y, stoneColor(x, y, clamp(0.75 - dy * -0.5 - dx * 0.2 + (dy < -0.5 ? 0.25 : 0), 0, 1)));
        }
    }
    if (d.bubbler) {
      const y = gravelTop(TANK.bubblerX) - 3;
      sf.rect(TANK.bubblerX - 4, y, 9, 4, 0x6d7780);
      sf.rect(TANK.bubblerX - 4, y, 9, 1, 0xa9b4bd);
      sf.rect(TANK.bubblerX - 4, y + 3, 9, 1, 0x424a52);
      for (let i = -3; i <= 3; i += 2) sf.px(TANK.bubblerX + i, y + 1, 0x2f363c);
    }
  }

  private drawCaveFront(sf: Surface): void {
    for (let y = TANK.gravel - 30; y <= TANK.gravel + 2; y++)
      for (let x = TANK.caveX - 44; x <= TANK.caveX + 44; x++) {
        if (caveShape(x, y) !== 'rock') continue;
        const dy = (y - (TANK.gravel + 2)) / 27;
        const dx = (x - TANK.caveX) / 42;
        const inner = ((x - TANK.caveX) / 29) ** 2 + ((y - TANK.gravel - 2) / 16) ** 2;
        let light = 0.35 + -dy * 0.55 - dx * 0.15;
        if (inner < 1.25) light -= 0.3; // lip of the opening falls into shadow
        sf.px(x, y, stoneColor(x, y, clamp(light, 0, 1)));
        // moss on top
        if (dy < -0.82 && hash2(x, y, 8) > 0.35) sf.px(x, y, dither(LEAF_BACK, hash2(x, y, 3), x, y));
      }
  }

  render(sf: Surface, time: number, env: Env): void {
    const m = this.model;
    const s = m.s;
    const key = JSON.stringify(s.decor);
    if (key !== this.bgKey) {
      this.bgKey = key;
      this.buildBackground();
    }
    sf.copyFrom(this.bg);
    const dark = m.dark(env);

    // light shafts slanting down from the surface
    if (!dark) {
      for (let i = 0; i < 4; i++) {
        const base = 30 + i * 78 + Math.sin(time * 0.13 + i * 1.7) * 12;
        const width = 9 + (i % 2) * 9;
        for (let y = TANK.surface; y < TANK.gravel; y++) {
          const a = 0.085 * (1 - (y - TANK.surface) / 150);
          const x0 = Math.round(base + (y - TANK.surface) * 0.28);
          for (let j = 0; j < width; j++) sf.add(x0 + j, y, 0xd8f5ee, j < 2 || j >= width - 2 ? a * 0.45 : a);
        }
      }
    }

    // background plants
    const gy = (x: number) => gravelTop(x) + 1;
    for (const [x, n, seed] of [[18, 5, 1], [286, 6, 2], [168, 3, 3]] as const)
      for (let i = 0; i < n; i++) {
        const h = hash2(i, seed, 31), h2 = hash2(i, seed, 32);
        blade(sf, x + i * 5 - n * 2, gy(x), 60 + h * 62, (h2 - 0.5) * 0.5, 2 + (h2 > 0.6 ? 1 : 0), LEAF_BACK, time, i * 1.3 + seed, 0.35);
      }
    if (s.decor.fern)
      for (let i = 0; i < 8; i++) {
        const h = hash2(i, 9, 33);
        blade(sf, 206 + (i - 4) * 2, gy(206), 26 + h * 34, (i - 3.5) * 0.45, 5, LEAF, time, i * 0.8, 0);
      }

    // waste and food
    for (const w of s.wastes) {
      sf.px(w.x - 1, w.y, 0x3d2c1a);
      sf.px(w.x, w.y, 0x3d2c1a);
      sf.px(w.x + 1, w.y, 0x2a1d10);
      sf.px(w.x, w.y - 1, 0x5a4226);
    }
    for (const f of s.foods) {
      const rot = clamp(f.age / AXO.rotAfter, 0, 1);
      if (f.kind === 'pellet') {
        sf.px(f.x, f.y, mix(0x9a6732, 0x5d6b3a, rot));
        sf.px(f.x + 1, f.y, mix(0x7a4c20, 0x4a552c, rot));
        sf.px(f.x, f.y + 1, mix(0x7a4c20, 0x4a552c, rot));
        sf.px(f.x + 1, f.y + 1, mix(0x5c3615, 0x39421f, rot));
      } else {
        for (let i = 0; i < 6; i++) {
          const wy = f.landed ? 0 : Math.sin(time * 9 + i * 1.1 + f.x) * 1.2;
          sf.px(f.x - 3 + i, f.y + wy, mix(i % 3 === 0 ? 0xe26a5a : 0xb92e2e, 0x5d6b3a, rot));
        }
      }
    }

    // the axolotl, with a soft shadow when it is near the bottom
    const k = m.size();
    const lift = TANK.floor - s.y;
    if (lift < 24) sf.disc(s.x, gravelTop(Math.round(s.x)) + 2, 17 * k * (1 - lift / 40), 1.6, 0x0d2a36, 0.28 * (1 - lift / 24));
    const speed = Math.hypot(s.vx, s.vy);
    const sad = s.cleanliness < 50 ? 1 - s.cleanliness / 50 : 0;
    drawAxolotl(sf, {
      x: s.x,
      y: s.y + Math.sin(time * 1.6) * (lift > 3 ? 1 : 0),
      turn: m.turn,
      size: k,
      morph: s.morph,
      swimPhase: m.swimPhase,
      gillPhase: m.gillPhase,
      swim: clamp(speed / 26 + m.wiggle * 0.9, 0.04, 1),
      mouth: m.mouth,
      pale: clamp(sad + (s.happiness < 30 ? 0.5 : 0), 0, 1),
      grounded: lift < 2,
    });

    if (s.decor.cave) this.drawCaveFront(sf);

    // foreground plant, bottom left
    for (let i = 0; i < 5; i++)
      blade(sf, 296 + (i - 2) * 4, gy(296) + 2, 15 + hash2(i, 4, 34) * 12, (i - 2) * 0.9, 6, LEAF, time, i, 0);

    this.particles.render(sf);

    // caustics rippling over the gravel
    if (!dark)
      for (let y = TANK.gravel - 4; y < VIEW_H; y++)
        for (let x = 0; x < VIEW_W; x++) {
          const v =
            Math.sin(x * 0.21 + time * 1.3) + Math.sin(x * 0.13 - y * 0.3 + time * 0.9) + Math.sin((x + y) * 0.09 - time * 0.6);
          if (v > 1.85 && y >= gravelTop(x)) sf.add(x, y, 0xffffff, 0.1);
        }

    // murk builds as water quality drops
    const murk = clamp((70 - s.cleanliness) / 70, 0, 1) * 0.5;
    if (murk > 0) {
      for (let y = TANK.surface; y < VIEW_H; y++)
        for (let x = 0; x < VIEW_W; x++) sf.blend(x, y, 0x6f7a45, murk * (0.8 + 0.2 * hash2(x >> 3, y >> 3, 14)));
      for (let i = 0; i < 40 * murk; i++) {
        const x = (hash2(i, 1, 15) * VIEW_W + Math.sin(time * 0.3 + i) * 6) | 0;
        const y = (TANK.surface + 6 + hash2(i, 2, 15) * 130 + Math.sin(time * 0.2 + i * 2) * 4) | 0;
        sf.blend(x, y, 0xc9cf9a, 0.5);
      }
    }

    // water line; it drops and refills during a water change
    let level = TANK.surface;
    if (s.waterChange > 0) {
      const f = s.waterChange < 0.5 ? s.waterChange * 2 : (1 - s.waterChange) * 2;
      level = Math.round(TANK.surface + f * 95);
    }
    for (let y = 0; y < level; y++)
      for (let x = 0; x < VIEW_W; x++) sf.blend(x, y, y < TANK.surface ? 0x1b2c36 : 0x27424e, y < TANK.surface ? 0.82 : 0.7);
    for (let x = 0; x < VIEW_W; x++) {
      const w = Math.sin(x * 0.18 + time * 2.2) + Math.sin(x * 0.07 - time * 1.4);
      sf.blend(x, level, 0xe6fbff, 0.75);
      sf.blend(x, level + 1, 0xbfeef2, w > 0.6 ? 0.7 : 0.3);
      if (w > 1.4) sf.blend(x, level + 2, 0xbfeef2, 0.35);
    }

    if (dark) sf.multiply(0.3, 0.38, 0.62);
    else if (s.lamp) for (let y = 0; y < 46; y++) for (let x = 0; x < VIEW_W; x++) sf.add(x, y, 0xfff0c0, 0.16 * (1 - y / 46));

    // glass: a diagonal glare and a dark frame
    for (let i = 0; i < 70; i++) {
      sf.add(40 + i - 0, 20 + i * 1.6, 0xffffff, 0.05);
      sf.add(41 + i, 20 + i * 1.6, 0xffffff, 0.05);
      sf.add(52 + i, 20 + i * 1.6, 0xffffff, 0.03);
    }
    for (let x = 0; x < VIEW_W; x++) {
      sf.px(x, 0, 0x0b1216);
      sf.px(x, 1, 0x0b1216);
      sf.px(x, 2, 0x27343b);
      sf.px(x, VIEW_H - 1, 0x0b1216);
      sf.px(x, VIEW_H - 2, 0x0b1216);
    }
    for (let y = 0; y < VIEW_H; y++) {
      sf.px(0, y, 0x0b1216);
      sf.px(1, y, 0x0b1216);
      sf.blend(2, y, 0xcfeef5, 0.25);
      sf.px(VIEW_W - 1, y, 0x0b1216);
      sf.px(VIEW_W - 2, y, 0x0b1216);
      sf.blend(VIEW_W - 3, y, 0xcfeef5, 0.18);
    }
  }
}
