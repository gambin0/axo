import { clamp, hash2 } from '../../core/rng';
import type { Env } from '../../core/time';
import { drawGlassTank } from '../../render/glass';
import { Particles } from '../../render/particles';
import { dither, mix, Surface, VIEW_H, VIEW_W } from '../../render/surface';
import { DecorBox, DECORATE_TOOL, unlockText } from '../decor';
import type { DecorPicker, DropHint, Habitat, Looks, Stat, Status, Tool, UiEvent } from '../types';
import { drawAxolotl } from './art';
import { AQUA_DECOR, AQUA_DECOR_AREAS, aquaPreviewBg } from './decor';
import { AXO, Axolotl, MORPHS, newAxoState, TANK, type Morph } from './model';
import { blade, gravelTop, LEAF, LEAF_BACK, PEBBLE, STONE, stoneColor, WATER } from './scenery';

export class AxolotlHabitat implements Habitat {
  readonly id = 'axolotl';
  tool = 'hand';
  model: Axolotl;
  private particles = new Particles();
  private bg = new Surface(VIEW_W, VIEW_H);
  private bgKey = '';
  private events: UiEvent[] = [];
  private bubbleClock = 0;
  private fullToast = 0;
  private decorBox: DecorBox;

  constructor(saved: unknown, seed: number) {
    this.model = saved ? Axolotl.load(saved, seed) : new Axolotl(newAxoState(seed));
    // decorations are earned with care points
    this.decorBox = new DecorBox({
      items: AQUA_DECOR, areas: AQUA_DECOR_AREAS, placed: () => this.model.s.decor, level: () => this.model.s.care, previewBg: aquaPreviewBg,
    });
  }

  decor(): DecorPicker {
    return this.decorBox;
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
  looks(): Looks {
    return {
      what: 'colour',
      names: MORPHS.map((m) => m[0].toUpperCase() + m.slice(1)),
      current: Math.max(0, MORPHS.indexOf(this.model.s.morph)),
      preview: (sf, i) => {
        sf.rect(0, 0, sf.w, sf.h, 0x2c7d93);
        drawAxolotl(sf, { x: sf.w / 2, y: sf.h / 2, turn: 1, size: 1.4, morph: MORPHS[i], swimPhase: 1, gillPhase: 0, swim: 0.3, mouth: 0, pale: 0, grounded: false });
      },
      choose: (i) => this.setMorph(MORPHS[i]),
    };
  }

  // ---- simulation --------------------------------------------------------

  update(dt: number, slowDt: number, env: Env): void {
    const m = this.model;
    m.update(dt, slowDt, env);
    this.fullToast = Math.max(0, this.fullToast - dt);

    // a stream of bubbles from the air stone, wherever it has been put (not while it is being moved)
    const bubbler = m.decorAt('bubbler');
    if (bubbler && m.s.waterChange === 0) {
      this.bubbleClock += dt;
      while (this.bubbleClock > 0.12) {
        this.bubbleClock -= 0.12;
        this.particles.spawn('bubble', bubbler.x + (Math.random() - 0.5) * 4, gravelTop(bubbler.x) - 4);
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

    for (const d of this.decorBox.newlyUnlocked()) this.events.push({ type: 'sound', name: 'pop' }, { type: 'toast', text: unlockText(d) });
    this.decorBox.update(dt);

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
      this.decorBox.pointer('up', x, y);
      return;
    }
    switch (this.tool) {
      case 'decorate':
        if (!this.decorBox.pointer(kind, x, y) && kind === 'down') this.particles.spawn('ripple', x, y);
        break;
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
      DECORATE_TOOL,
      { id: 'lamp', icon: '💡', label: 'Lamp', kind: 'toggle', on: m.s.lamp },
    ];
    return list;
  }

  useTool(id: string): void {
    const m = this.model;
    // anything still being dragged is set down first
    this.decorBox.pointer('up', 0, 0);
    if (id === 'water') {
      if (m.startWaterChange()) this.events.push({ type: 'toast', text: 'Fresh water coming in!' });
    } else if (id === 'lamp') m.s.lamp = !m.s.lamp;
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

  /** Everything that never moves: water gradient, back wall, gravel and rocks. */
  private buildBackground(): void {
    const sf = this.bg;
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
    // a planted back wall, lost in the blue
    for (let c = 0; c < 7; c++) {
      // clumps, not a hedge: a few blades of different heights, leaning apart
      const cx = 20 + c * 46 + hash2(c, 0, 50) * 24;
      for (let i = 0; i < 4; i++) {
        const len = 30 + hash2(c, i, 51) * 90;
        blade(sf, cx + (i - 1.5) * 3, TANK.gravel + 2, len, (i - 1.5) * 0.5 + (hash2(c, i, 52) - 0.5) * 0.6, 2 + (hash2(c, i, 53) > 0.6 ? 1 : 0), LEAF_BACK, 0, c * 2 + i, 0.72 + hash2(c, i, 54) * 0.12);
      }
    }

    // gravel bed: rounded pebbles of different sizes and colours, packed together
    const CW = 8, CH = 5, G0 = TANK.gravel - 8;
    const RAMPS = [PEBBLE, PEBBLE, PEBBLE, PEBBLE, STONE, STONE, [0xa88a68, 0x8a6c4e, 0x6c5038, 0x523c2a, 0x3a2a1e]];
    for (let x = 0; x < VIEW_W; x++) {
      const top = gravelTop(x);
      for (let y = top; y < VIEW_H; y++) {
        const gx = Math.floor(x / CW), gy = Math.floor((y - G0) / CH);
        let d1 = 1e9, d2 = 1e9, best = [0, 0, 0, 0];
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const cx = gx + ox, cy = gy + oy;
            const px = cx * CW + 1 + hash2(cx, cy, 40) * (CW - 2), py = G0 + cy * CH + 1 + hash2(cx, cy, 41) * (CH - 2);
            const d = Math.hypot((x - px) * 0.8, y - py);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              best = [cx, cy, px, py];
            } else if (d < d2) d2 = d;
          }
        const [cx, cy, px, py] = best;
        const ramp = RAMPS[Math.floor(hash2(cx, cy, 42) * RAMPS.length)];
        // lit from above-left, a dark crack between pebbles, darker further down
        // round shading: light on the upper left of each pebble, darker toward its rim
        let t = 0.15 + hash2(cx, cy, 43) * 0.25 + (y - py) * 0.07 + (x - px) * 0.025 + (y - top) / 70 + d1 * 0.04;
        if (y - py < -1 && x - px < 0 && d1 < 2.6) t -= 0.22;
        if (d2 - d1 < 1.4) t = 0.75 + (d2 - d1 < 0.7 ? 0.2 : 0);
        const c = dither(ramp, clamp(t, 0, 1), x, y);
        sf.px(x, y, y === top ? mix(c, 0xfff6dd, 0.2) : c);
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
  }

  render(sf: Surface, time: number, env: Env): void {
    const m = this.model;
    const s = m.s;
    if (!this.bgKey) {
      this.bgKey = 'built';
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
    // decorations, behind the axolotl (the cave's rock goes in front of it, below)
    this.decorBox.draw(sf, time);

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

    this.decorBox.drawFront(sf, time);
    if (this.tool === 'decorate') this.decorBox.drawDecorating(sf, time);

    // foreground plant, bottom left
    for (let i = 0; i < 5; i++)
      blade(sf, 296 + (i - 2) * 4, gy(296) + 2, 15 + hash2(i, 4, 34) * 12, (i - 2) * 0.9, 6, LEAF, time, i, 0);

    this.particles.render(sf);
    // tiny specks drifting in the water
    for (let i = 0; i < 28; i++) {
      const x = (((hash2(i, 1, 51) * VIEW_W + time * (hash2(i, 2, 51) - 0.5) * 3) % VIEW_W) + VIEW_W) % VIEW_W;
      const y = TANK.surface + 6 + hash2(i, 3, 51) * (TANK.gravel - TANK.surface - 10) + Math.sin(time * 0.4 + i) * 3;
      sf.blend(x, y, 0xe8fff8, 0.18 + 0.12 * Math.sin(time + i));
    }

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
      for (let x = 0; x < VIEW_W; x++) sf.blend(x, y, y < TANK.surface ? 0x31505a : 0x27424e, y < TANK.surface ? 0.8 : 0.7);
    for (let x = 0; x < VIEW_W; x++) {
      const w = Math.sin(x * 0.18 + time * 2.2) + Math.sin(x * 0.07 - time * 1.4);
      sf.blend(x, level, 0xe6fbff, 0.75);
      sf.blend(x, level + 1, 0xbfeef2, w > 0.6 ? 0.7 : 0.3);
      if (w > 1.4) sf.blend(x, level + 2, 0xbfeef2, 0.35);
      // the underside of the surface works like a rippling mirror
      for (let k = 3; k < 8; k++) if (Math.sin(x * 0.11 + k * 1.7 - time * 1.8) + w * 0.4 > 1.1) sf.blend(x, level + k, 0xd8f6f6, 0.16 * (1 - k / 8));
    }

    if (dark) sf.multiply(0.3, 0.38, 0.62);
    else if (s.lamp) for (let y = 0; y < 46; y++) for (let x = 0; x < VIEW_W; x++) sf.add(x, y, 0xfff0c0, 0.16 * (1 - y / 46));

    drawGlassTank(sf, TANK.left, TANK.right, 8);
    // an LED light bar along the lid
    for (let x = 40; x < 280; x++) {
      sf.px(x, 3, 0x5a5a64);
      sf.px(x, 4, 0x44444e);
      sf.px(x, 5, 0x2c2c34);
      sf.px(x, 6, s.lamp ? (x % 4 ? 0xfff4d0 : 0xffe8a8) : x % 4 ? 0x6a6a74 : 0x54545e);
    }
    sf.px(40, 3, 0x2c2c34);
    sf.px(279, 3, 0x2c2c34);
  }
}
