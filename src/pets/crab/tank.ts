import { clamp, hash2 } from '../../core/rng';
import type { Env } from '../../core/time';
import { drawDomeLamp, drawGlassTank, groundShadow } from '../../render/glass';
import { Particles } from '../../render/particles';
import { dither, mix, Surface, VIEW_H, VIEW_W } from '../../render/surface';
import { DecorBox, DECORATE_TOOL, unlockText } from '../decor';
import type { DecorPicker, DropHint, Habitat, Looks, Stat, Status, Tool, UiEvent } from '../types';
import { drawCrab, drawMound, drawShell, SHELL_HUES, shellRadius } from './art';
import { TANK_DECOR, TANK_DECOR_AREAS, tankPreviewBg } from './decor';
import { BRANCH, COCONUT, Crab, CRAB, DISH, newCrabState, sandY, SPARE_X, TANK, type Pt, type Shell } from './model';

const SAND = [0xe8d6a8, 0xd2bc8a, 0xb89f70, 0x967f58];
const DAMP = [0xb09670, 0x96805c, 0x7e6a4c, 0x66543c];
const DRIFT = [0xe6dcc6, 0xc4b496, 0x9a8a6c, 0x6a5e48];
const LAMP = { x: 30, y: 11 };
const GAUGE = { x: 292, y: 36 };
const COCO = [0x9a7248, 0x7a5430, 0x573a20, 0x3a2614];

const fitWord = { cramped: 'Too small', snug: 'Just right', roomy: 'Roomy' } as const;

export class CrabHabitat implements Habitat {
  readonly id = 'crab';
  tool = 'hand';
  model: Crab;
  private particles = new Particles();
  private bg = new Surface(VIEW_W, VIEW_H);
  private bgReady = false;
  private events: UiEvent[] = [];
  private said = new Set<string>();
  private told = false;

  private decorBox: DecorBox;

  constructor(saved: unknown, seed: number) {
    this.model = saved ? Crab.load(saved, seed) : new Crab(newCrabState(seed));
    // decorations are earned with the crab's trust
    this.decorBox = new DecorBox({
      items: TANK_DECOR, areas: TANK_DECOR_AREAS, placed: () => this.model.s.decor, level: () => this.model.s.trust, previewBg: tankPreviewBg,
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

  private who(): string {
    return this.model.s.name || 'Your crab';
  }

  /** The colour of the shell it is wearing now. Its next shell will be whatever it finds. */
  looks(): Looks {
    const sh = this.model.s.shell;
    return {
      what: 'shell colour',
      names: SHELL_HUES.map((h) => h.name),
      current: sh.hue % SHELL_HUES.length,
      preview: (sf, i) => {
        sf.rect(0, 0, sf.w, sf.h, 0xe6cf9c);
        drawCrab(sf, {
          x: sf.w / 2 + 3, y: sf.h - 6, facing: 1, size: 5, hidden: 0, phase: 0, moving: false, cramped: false, reach: 0,
          shell: { size: 5, shape: sh.shape, pattern: sh.pattern, hue: i },
        });
      },
      choose: (i) => (sh.hue = i),
    };
  }

  // ---- simulation --------------------------------------------------------

  update(dt: number, slowDt: number, env: Env): void {
    const m = this.model;
    m.update(dt, slowDt, env);
    const toast = (text: string) => this.events.push({ type: 'toast', text });
    const sound = (name: Extract<UiEvent, { type: 'sound' }>['name']) => this.events.push({ type: 'sound', name });
    const once = (key: string, text: string) => {
      if (this.said.has(key)) return;
      this.said.add(key);
      toast(text);
    };
    for (const d of this.decorBox.newlyUnlocked()) {
      sound('pop');
      toast(unlockText(d));
    }
    this.decorBox.update(dt);
    if (!this.told && m.cramped() && !m.s.spare.length && m.s.moult === 0) {
      this.told = true;
      toast(`${this.who()} looks squished in that tiny shell. Tap 🐚 to offer a bigger one!`);
    }
    for (const fx of m.fx) {
      switch (fx.kind) {
        case 'heart':
          this.particles.spawn('heart', fx.x, fx.y);
          break;
        case 'no':
          this.particles.spawn('no', fx.x, fx.y);
          sound('no');
          break;
        case 'ripple':
          this.particles.spawn('ripple', fx.x, fx.y);
          sound('tap');
          break;
        case 'sparkle':
          this.particles.spawn('sparkle', fx.x, fx.y);
          sound('pop');
          break;
        case 'dust':
          for (let i = 0; i < 2; i++) this.particles.spawn('dust', fx.x, fx.y, SAND[1]);
          break;
        case 'drop':
          this.particles.spawn('drop', fx.x, fx.y);
          sound('splash');
          break;
        case 'crumb':
          this.particles.spawn('crumb', fx.x, fx.y, 0xe8a04a);
          sound('munch');
          break;
        case 'sip':
          this.particles.spawn('bubble', fx.x, fx.y);
          sound('bubble');
          break;
        case 'plop':
          sound('plop');
          break;
        case 'zzz':
          this.particles.spawn('zzz', fx.x, fx.y);
          break;
        case 'bury':
          for (let i = 0; i < 8; i++) this.particles.spawn('dust', fx.x, fx.y, SAND[1]);
          toast(`${this.who()} is burying itself in the sand to moult. Shh, let it rest!`);
          break;
        case 'emerge':
          for (let i = 0; i < 6; i++) this.particles.spawn('sparkle', fx.x + (Math.random() - 0.5) * 20, fx.y - Math.random() * 14);
          sound('hatch');
          toast(`${this.who()} came out of its moult, and it's bigger now!`);
          break;
        case 'cramped':
          once('cramped', `${this.who()} outgrew its shell! Offer a new one with 🐚.`);
          break;
        case 'swapped':
          this.particles.spawn('sparkle', fx.x, fx.y);
          this.particles.spawn('heart', fx.x, fx.y - 6);
          sound('hatch');
          toast(m.fit() === 'cramped' ? `${this.who()} moved in, but it's still a squeeze.` : `${this.who()} moved into the new shell! 🐚`);
          break;
        case 'rejected':
          once('rejected', `${this.who()} looked it over and walked away. Not every shell is right!`);
          break;
        case 'visit':
          once('visit', `${this.who()} is feeling the big shell with a claw. Hermit crabs can't resist a shell, even one far too big to wear!`);
          break;
      }
    }
    m.fx.length = 0;
    this.particles.update(dt, 0, TANK.sand);
  }

  coarseStep(dt: number, env: Env): void {
    this.model.coarseStep(dt, env);
  }

  beginCatchup(): () => string[] {
    const before = this.model.s.size;
    const wasMoulting = this.model.moulting();
    return () => {
      const m = this.model;
      m.fx.length = 0;
      const s = m.s;
      const out: string[] = [];
      if (s.size > before) out.push(`${this.who()} moulted and grew`);
      else if (wasMoulting && m.moulting()) out.push(`${this.who()} is still moulting`);
      if (s.fullness < 30 || s.food <= 0.05) out.push('the food dish ran low');
      if (s.fresh <= 0.05 && s.salt <= 0.05) out.push('the water dishes ran dry');
      if (!out.length) out.push(`${this.who()} was exploring`);
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
    if (this.tool === 'decorate') {
      if (!this.decorBox.pointer(kind, x, y) && kind === 'down') this.particles.spawn('ripple', x, y);
      return;
    }
    if (this.tool === 'tidy') {
      if (m.tidy(x) === 0 && kind === 'down') this.particles.spawn('ripple', x, y);
      return;
    }
    if (kind === 'down') {
      if (m.hit(x, y)) m.poke();
      else m.tapGlass(x, y);
    } else if (y > TANK.sand - 30 && !m.moulting()) m.finger = { x, y };
  }

  tools(): Tool[] {
    const m = this.model;
    return [
      { id: 'hand', icon: '✋', label: 'Touch', kind: 'mode' },
      { id: 'food', icon: '🍓', label: 'Food', kind: 'drag', disabled: m.s.food > 0.85 },
      { id: 'water', icon: '🥤', label: 'Water', kind: 'drag', disabled: m.s.fresh > 0.85 && m.s.salt > 0.85 },
      { id: 'mist', icon: '💦', label: 'Mist', kind: 'action' },
      { id: 'shell', icon: '🐚', label: 'Shell', kind: 'drag' },
      { id: 'chips', icon: '🥔', label: 'Crisps', kind: 'drag' },
      { id: 'tidy', icon: '🧹', label: 'Tidy', kind: 'mode' },
      DECORATE_TOOL,
      { id: 'lamp', icon: '💡', label: 'Lamp', kind: 'toggle', on: m.s.lamp },
    ];
  }

  useTool(id: string): void {
    const m = this.model;
    // anything still being dragged is set down first
    this.decorBox.pointer('up', 0, 0);
    switch (id) {
      case 'mist':
        m.mist();
        break;
      case 'lamp':
        m.s.lamp = !m.s.lamp;
        break;
      default:
        this.tool = id;
    }
  }

  drop(id: string, at: { x: number; y: number } | null): void {
    const m = this.model;
    const toast = (text: string) => this.events.push({ type: 'toast', text });
    switch (id) {
      case 'food':
        if (!m.fillFood()) toast('The food dish is full already.');
        break;
      case 'water':
        if (!m.fillWater()) toast('Both water dishes are full.');
        break;
      case 'shell': {
        const r = m.offerShell();
        if (r === 'full') toast('The shell pile is full. Use 🧹 Tidy to clear the ones it did not like.');
        else if (r === 'wait') toast(`Let ${this.who()} look at the shells first!`);
        else if (m.cramped()) toast('A new shell! Will it be a better fit?');
        break;
      }
      case 'chips':
        if (m.dropChip(at ? at.x : m.s.x + m.s.facing * 20)) toast('Crisps are salty and bad for hermit crabs. Watch what it does!');
        break;
    }
  }

  dropHint(id: string, x: number): DropHint {
    // food and water go in their dishes, shells on the shell pile, crisps where they are dropped
    if (id === 'food') return { x: DISH.food, y: sandY(DISH.food) - 2, ok: true };
    if (id === 'water') {
      const d = Math.abs(x - DISH.fresh) < Math.abs(x - DISH.salt) ? DISH.fresh : DISH.salt;
      return { x: d, y: sandY(d) - 2, ok: true };
    }
    if (id === 'shell') {
      const taken = new Set(this.model.s.spare.map((sh) => sh.x));
      const px = SPARE_X.find((p) => !taken.has(p));
      return { x: px ?? SPARE_X[0], y: sandY(px ?? SPARE_X[0]) - 4, ok: px !== undefined };
    }
    const hx = Math.max(TANK.minX, Math.min(TANK.maxX, Math.round(x)));
    return { x: hx, y: sandY(hx) - 1, ok: true };
  }

  stats(): Stat[] {
    const m = this.model, s = m.s;
    return [
      { icon: '🦀', label: 'Size', value: `${s.size} of ${CRAB.maxSize}${m.grown() ? ' (grown!)' : ''}` },
      { icon: '🍓', label: 'Tummy', value: s.fullness },
      { icon: '💧', label: 'Thirst', value: s.thirst },
      { icon: '🌫️', label: 'Damp', value: s.humidity },
      { icon: '🐚', label: 'Shell', value: fitWord[m.fit()] },
    ];
  }

  status(env: Env): Status {
    const m = this.model, s = m.s;
    if (m.moulting()) return { text: 'Moulting…', tone: 'sleep' };
    if (m.cramped()) return { text: 'Needs a new shell', tone: 'warn' };
    if (s.fullness < 30) return { text: 'Hungry!', tone: 'warn' };
    if (s.thirst < 30) return { text: 'Thirsty!', tone: 'warn' };
    if (s.humidity < CRAB.dryBelow) return { text: 'Too dry', tone: 'warn' };
    if (!env.night && !s.lamp) return { text: 'Dozing', tone: 'sleep' };
    return { text: 'Exploring', tone: 'good' };
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

  /** The beach poster on the back glass, sand bed, driftwood, vine and coconut hide: everything that never moves. */
  private buildBackground(): void {
    const sf = this.bg;
    // a beach scene printed on the back glass, a little faded
    const HORIZON = 86, SHORE = 110;
    for (let y = 0; y < VIEW_H; y++)
      for (let x = 0; x < VIEW_W; x++) {
        let c: number;
        if (y < HORIZON) {
          c = mix(0x84c4ec, 0xdcf0f6, y / HORIZON);
          const sun = Math.hypot(x - 268, y - 30);
          if (sun < 8) c = 0xfff4c0;
          else if (sun < 20) c = mix(c, 0xfff4d0, 0.5 * (1 - (sun - 8) / 12));
          const puff = (cx: number, cy: number, rx: number, ry: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;
          if (puff(70, 34, 16, 5) || puff(80, 29, 9, 5) || puff(62, 31, 7, 4)) c = mix(c, 0xffffff, y > 34 ? 0.75 : 0.92);
          if (puff(176, 52, 13, 3.5) || puff(184, 49, 7, 3.5)) c = mix(c, 0xffffff, y > 52 ? 0.7 : 0.88);
          // a little island with a palm on the horizon
          const isle = HORIZON - 7 * Math.sqrt(Math.max(0, 1 - ((x - 214) / 24) ** 2));
          if (y >= isle && Math.abs(x - 214) < 24) c = y < isle + 2 ? 0x7ab85a : 0x5a9a48;
          const trunkX = 210 + (HORIZON - 7 - y) * 0.25;
          if (y > 62 && y < HORIZON - 6 && Math.abs(x - trunkX) < 1) c = 0x8a6a48;
          for (const [a, l] of [[-2.6, 12], [-2.1, 10], [-0.6, 12], [-1.1, 10], [-1.6, 7]]) {
            const fx = x - 216, fy = y - 62;
            const along = fx * Math.cos(a) + fy * Math.sin(a), across = -fx * Math.sin(a) + fy * Math.cos(a);
            if (along > 0 && along < l && Math.abs(across - along * along * 0.03) < 1.4 - along / l) c = 0x4a8a3e;
          }
        } else if (y < SHORE) {
          // the sea: deep at the horizon, turquoise in the shallows, with lines of surf
          const t = (y - HORIZON) / (SHORE - HORIZON);
          c = dither([0x3a8ab8, 0x4aa4c4, 0x6cc4c8, 0x8ad8cc], t, x, y);
          if (hash2(Math.floor((x + y * 7) / 9), y, 130) > 0.82 - t * 0.2) c = mix(c, 0xffffff, 0.45 + t * 0.3);
          if (y >= SHORE - 2 - Math.round(Math.sin(x * 0.09) * 1.5)) c = 0xf4fbfa;
        } else {
          c = dither([0xf6e8c4, 0xead8ac], (y - SHORE) / 22 + hash2(x, y, 131) * 0.3, x, y);
          // a starfish on the poster beach
          const fx = x - 186, fy = y - 118, r = Math.hypot(fx, fy), ang = Math.atan2(fy, fx);
          if (r < 2.2 + 2.6 * Math.max(0, Math.cos(ang * 5 + 0.3)) ** 2) c = r < 1.5 ? 0xf8a070 : 0xe8784a;
        }
        // faded print, darker near the sand where the glass meets the substrate
        c = mix(c, 0xf4ecdc, 0.25);
        if (y > TANK.sand - 14) c = mix(c, 0x6a5a44, ((y - (TANK.sand - 14)) / 14) * 0.3);
        sf.px(x, y, c);
      }

    // a plastic vine clipped along the lid, drooping in loops
    const vine: Pt[] = [];
    for (let x = 300; x >= 130; x -= 0.5) {
      const loop = Math.max(0, Math.sin((x - 130) * 0.055)) ** 2;
      vine.push({ x, y: TANK.top + 2 + loop * (18 + 10 * Math.sin(x * 0.013)) });
    }
    vine.forEach((p, i) => {
      sf.px(Math.round(p.x), Math.round(p.y), 0x3a6a2e);
      if (i % 9 === 0) {
        const side = (i / 9) % 2 ? 1 : -1;
        sf.disc(p.x, p.y + side * 2.2, 2.2, 1.6, 0x4a8a3a);
        sf.disc(p.x - 0.5, p.y + side * 2.2 - 0.5, 1.2, 0.8, 0x7ab85a);
      }
    });

    // the driftwood: a gnarled, sun-bleached limb leaning up and to the left
    const limb = (pts: readonly { x: number; y: number }[], r0: number, r1: number) => {
      let arc = 0;
      for (let i = 1; i < pts.length; i++) {
        const A = pts[i - 1], B = pts[i];
        const n = Math.ceil(Math.hypot(B.x - A.x, B.y - A.y));
        for (let k = 0; k <= n; k++) {
          const f = k / n, cx = A.x + (B.x - A.x) * f, cy = A.y + (B.y - A.y) * f;
          const r = r0 + (r1 - r0) * ((i - 1 + f) / (pts.length - 1));
          for (let d = -Math.ceil(r); d <= Math.ceil(r); d++) {
            if (Math.abs(d) > r) continue;
            let t = (d + r) / (2 * r);
            // grain running along the wood
            if (hash2(Math.round(((d + r) / (2 * r)) * 6), Math.floor((arc + k) / 7), 121) > 0.72) t += 0.22;
            if (Math.abs(d) > r - 0.8) t += 0.25;
            sf.px(Math.round(cx), Math.round(cy + d - 3), dither(DRIFT, clamp(t, 0, 1), Math.round(cx), Math.round(cy + d)));
          }
        }
        arc += n;
      }
    };
    // the root runs down below the surface, so the sand (drawn after) covers its foot
    limb([{ x: 146, y: 152 }, ...BRANCH], 6.5, 1.4);
    limb([BRANCH[2], { x: 112, y: 70 }, { x: 118, y: 52 }], 2.4, 0.6);
    limb([BRANCH[4], { x: 56, y: 88 }, { x: 44, y: 100 }], 2, 0.6);
    for (const [kx, ky] of [[110, 102], [74, 73]]) {
      sf.disc(kx, ky, 1.6, 1.2, DRIFT[3]);
      sf.px(kx - 1, ky - 1, DRIFT[1]);
    }

    // sand: dry and pale on top, damp and darker further down, with pebbles and bits of coral
    for (let x = 0; x < VIEW_W; x++) {
      const top = sandY(x);
      for (let y = top; y < VIEW_H; y++) {
        const n = hash2(x, y, 120);
        const depth = y - top;
        let c = depth < 16 ? dither(SAND, depth / 30 + n * 0.35, x, y) : dither(DAMP, (depth - 16) / 30 + n * 0.35 + Math.sin(x * 0.05) * 0.08, x, y);
        if (depth >= 14 && depth < 18) c = mix(c, DAMP[1], (depth - 14) / 8);
        if (y === top) c = mix(c, 0xfff3d0, 0.4);
        if (n > 0.975) c = 0x7a6a50;
        else if (n < 0.018) c = depth < 16 ? 0xfff3d0 : SAND[2];
        else if (n < 0.024) c = 0xf4b0a8; // crushed coral
        sf.px(x, y, c);
      }
    }
    for (let i = 0; i < 22; i++) {
      const px = 10 + hash2(i, 1, 126) * 300, py = sandY(Math.round(px)) + 4 + hash2(i, 2, 126) * 40;
      const r = 1 + hash2(i, 3, 126) * 1.6;
      const grey = mix(0x8a8478, 0xc8c0b0, hash2(i, 4, 126));
      sf.disc(px, py, r + 0.6, r, grey);
      sf.px(Math.round(px - r * 0.4), Math.round(py - r * 0.4), mix(grey, 0xffffff, 0.4));
    }
    // moss tucked in the corners
    for (const [mx, mw] of [[18, 12], [306, 8]])
      for (let dx = -mw; dx <= mw; dx++) {
        const h = Math.round(3 * Math.sqrt(1 - (dx / (mw + 0.5)) ** 2) + hash2(mx + dx, 0, 127) * 1.5);
        for (let k = 0; k < h; k++) sf.px(mx + dx, sandY(mx + dx) - k, k === h - 1 ? 0x8ac65a : hash2(mx + dx, k, 128) > 0.5 ? 0x5a9a40 : 0x4a8434);
      }

    // coconut hide: half a husk with a doorway, its cut edge pale
    groundShadow(sf, COCONUT.x + 2, TANK.sand + 2, COCONUT.r + 3, 0.4);
    for (let y = TANK.sand - COCONUT.r - 4; y <= TANK.sand + 4; y++)
      for (let x = COCONUT.x - COCONUT.r - 2; x <= COCONUT.x + COCONUT.r + 2; x++) {
        const dx = (x - COCONUT.x) / COCONUT.r, dy = (y - (TANK.sand + 2)) / (COCONUT.r * 0.95);
        const e = dx * dx + dy * dy;
        if (e > 1 || dy > 0) continue;
        const doorE = ((x - (COCONUT.x - 6)) / 14) ** 2 + ((y - (TANK.sand + 2)) / 14) ** 2;
        if (doorE < 1) {
          sf.px(x, y, doorE > 0.8 ? 0xd8b888 : dither([0x2a1c10, 0x3a281a], hash2(x, y, 122), x, y));
          continue;
        }
        // hairy husk: fibres running over the dome
        let t = 0.35 + -dy * 0.5 - dx * 0.25 + (hash2(x, y >> 2, 123) - 0.5) * 0.4;
        if (e > 0.9) t -= 0.25;
        sf.px(x, y, dither(COCO, clamp(1 - t, 0, 1), x, y));
      }
  }

  /** A shallow dish sunk into the sand, seen from just above. */
  private dish(sf: Surface, x: number, level: number, kind: 'fresh' | 'salt' | 'food'): void {
    const y = sandY(x) - 1;
    const body = kind === 'food' ? [0xd8784a, 0xb05a32, 0x82401e] : [0xf0ebe0, 0xd0c8b8, 0xa49c8c];
    groundShadow(sf, x + 1, y + 3, 14, 0.25);
    for (let k = 1; k <= 3; k++)
      for (let dx = -12 + k; dx <= 12 - k; dx++) sf.px(x + dx, y + k, dither(body, k / 3.5 + (dx > 6 ? 0.3 : 0), x + dx, y + k));
    const wet = kind === 'salt' ? [0xa8e2e2, 0x6ec4c8, 0x4aa4b0] : [0xc4ecfa, 0x8ccff0, 0x5aa8d8];
    const wr = 10 * (0.55 + 0.45 * level);
    for (let py = y - 4; py <= y + 1; py++)
      for (let dx = -12; dx <= 12; dx++) {
        const oy = py - (y - 1.5);
        if ((dx / 12) ** 2 + (oy / 3.5) ** 2 > 1) continue;
        let c = oy < 0 ? body[0] : mix(body[0], body[1], 0.4);
        if ((dx / 10) ** 2 + (oy / 2.4) ** 2 <= 1) {
          c = mix(body[1], 0x000000, 0.15);
          if (kind !== 'food' && level > 0.02 && (dx / wr) ** 2 + (oy / (2.4 * wr / 10)) ** 2 <= 1) c = oy < -0.5 ? wet[0] : dx > 3 ? wet[2] : wet[1];
        }
        sf.px(x + dx, py, c);
      }
    if (kind !== 'food' && level > 0.02) {
      sf.px(x - 4, y - 2, 0xffffff);
      sf.px(x - 3, y - 2, 0xffffff);
      if (kind === 'salt') for (let i = 0; i < 3; i++) sf.px(x - 5 + i * 5, y - 1 + (i % 2), 0xffffff);
    }
    if (kind === 'food') {
      const bits = Math.round(level * 11);
      const cols = [0xe0405a, 0x8fbf4a, 0xf2b84a, 0xf08a6a];
      for (let i = 0; i < bits; i++) {
        const bx = x - 7 + ((i * 5) % 14), by = y - 2 - ((i * 7) % 3) - (i > 6 ? 1 : 0);
        sf.px(bx, by, cols[i % 4]);
        sf.px(bx + 1, by, mix(cols[i % 4], 0x000000, 0.25));
        sf.px(bx, by - 1, mix(cols[i % 4], 0xffffff, 0.35));
      }
    }
  }

  /** A humidity gauge stuck to the glass. Its needle follows how damp the air is. */
  private gauge(sf: Surface, humidity: number): void {
    const cx = GAUGE.x, cy = GAUGE.y, R = 11;
    const ang = (v: number) => ((150 + v * 2.4) * Math.PI) / 180;
    for (let y = cy - R - 1; y <= cy + R + 1; y++)
      for (let x = cx - R - 1; x <= cx + R + 1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > R + 0.5) continue;
        if (d > R - 0.5) sf.px(x, y, 0x4a4a54);
        else if (d > R - 1.5) sf.px(x, y, y < cy ? 0xe8e8f0 : 0xa8a8b4);
        else sf.px(x, y, 0xfaf6ec);
      }
    for (let v = 0; v <= 100; v += 2) {
      const a = ang(v);
      const c = v < 35 ? 0xe06048 : v < 55 ? 0xf0b840 : 0x5ab05a;
      for (const r of [7.5, 8.5]) sf.px(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), c);
    }
    const a = ang(clamp(humidity, 0, 100));
    for (let r = 0; r < 7; r += 0.5) sf.px(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 0x2a2a30);
    sf.px(cx, cy, 0xc03030);
    // a little water drop printed on the face
    sf.px(cx, cy + 4, 0x5aa8d8);
    sf.px(cx - 1, cy + 5, 0x5aa8d8);
    sf.px(cx, cy + 5, 0x8ccff0);
    sf.px(cx + 1, cy + 5, 0x5aa8d8);
    sf.px(cx, cy + 6, 0x5aa8d8);
  }

  render(sf: Surface, time: number, env: Env): void {
    const m = this.model, s = m.s;
    if (!this.bgReady) {
      this.bgReady = true;
      this.buildBackground();
    }
    sf.copyFrom(this.bg);
    const dark = m.dark(env);

    // dishes, spare shells, crisps
    this.dish(sf, DISH.fresh, s.fresh, 'fresh');
    this.dish(sf, DISH.salt, s.salt, 'salt');
    this.dish(sf, DISH.food, s.food, 'food');
    const drawSpare = (sh: Shell) => {
      const r = shellRadius(sh.size);
      drawShell(sf, sh.x, sandY(sh.x) - r * 0.75, sh.size, sh.shape, sh.pattern, sh.hue, 1, 0.5);
      if (!sh.looked) for (let k = 0; k < 2; k++) sf.blend(sh.x + Math.sin(time * 3 + k * 3) * (r + 2), sandY(sh.x) - r * 1.8 + k * 3, 0xffffff, 0.6 + 0.4 * Math.sin(time * 5 + k)); // "new" twinkle
    };
    s.spare.forEach(drawSpare);
    for (const c of s.chips) {
      const y = sandY(c.x);
      for (let dx = -3; dx <= 3; dx++) sf.px(c.x + dx, y - 2 + (Math.abs(dx) > 2 ? 1 : 0), dx % 2 ? 0xe8b84a : 0xd4a030);
      sf.px(c.x, y - 3, 0xf2d070);
    }

    // the crab, or the mound it hides under to moult
    if (m.moulting()) drawMound(sf, Math.round(s.x), s.y, s.size, SAND, time);
    else {
      const swapping = s.state === 'swap' && m.swapTo;
      const bare = swapping && s.timer > 0.9;
      const lift = s.state === 'dig' ? 3 : 0;
      const visiting = s.state === 'visit' && s.step === 2;
      const moving = (['walk', 'follow', 'shop', 'sniff', 'climb', 'descend', 'eat', 'drink'].includes(s.state) && (Math.abs(s.tx - s.x) > 1.5 || s.step >= 0)) || (s.state === 'visit' && !visiting);
      const reach = s.state === 'inspect' || visiting ? 0.5 + 0.5 * Math.sin(time * 9) : s.state === 'eat' || s.state === 'drink' ? 0.5 + 0.5 * Math.sin(m.eatPhase * 8) : 0;
      if (s.state === 'inspect' || swapping) {
        // the crab holds its claw out to the shell it is trying
        const sh = swapping ? m.swapTo! : s.spare.find((x) => !x.looked);
        if (sh) s.facing = sh.x >= s.x ? 1 : -1;
      }
      drawCrab(sf, {
        x: s.x, y: s.y + lift, facing: s.facing, size: s.size, hidden: m.hidden, phase: m.eatPhase, moving, cramped: m.cramped(), reach,
        shell: bare ? null : s.shell,
      });
      if (bare && m.swapTo) {
        // the empty old shell waits where it was dropped
        drawShell(sf, s.x - s.facing * 18, s.y - shellRadius(s.shell.size) * 0.75, s.shell.size, s.shell.shape, s.shell.pattern, s.shell.hue, s.facing, 0.5);
      }
    }

    // decorations along the front of the sand, in front of the crab
    this.decorBox.draw(sf, time);
    if (this.tool === 'decorate') this.decorBox.drawDecorating(sf, time);
    this.particles.render(sf);

    // humid air: the glass mists up at the top, and droplets run down it
    for (let y = TANK.top; y < TANK.top + 24; y++) {
      const a = (s.humidity / 100) * 0.22 * (1 - (y - TANK.top) / 24);
      for (let x = TANK.left; x < TANK.right; x++) sf.blend(x, y, 0xffffff, a * (0.8 + 0.2 * hash2(x >> 2, y >> 1, 129)));
    }
    for (let i = 0; i < Math.round(s.humidity / 6); i++) {
      const x = 12 + hash2(i, 1, 124) * 296, y = 14 + ((hash2(i, 2, 124) * 100 + time * (1 + hash2(i, 3, 124) * 2)) % 100);
      sf.blend(x, y, 0xffffff, 0.55);
      sf.blend(x, y + 1, 0xd8eef2, 0.4);
    }
    this.gauge(sf, s.humidity);

    if (s.lamp)
      for (let y = TANK.top; y < 110; y++)
        for (let x = TANK.left; x < 170; x++) {
          const d = Math.hypot(x - LAMP.x, (y - LAMP.y) * 1.1) / 140;
          if (d < 1) sf.add(x, y, 0xffc070, 0.3 * (1 - d) ** 1.5);
        }
    if (dark) sf.multiply(0.45, 0.5, 0.72);
    drawGlassTank(sf, TANK.left, TANK.right, TANK.top);
    drawDomeLamp(sf, LAMP.x, LAMP.y, s.lamp, [0x9a9aa4, 0x6a6a74, 0x44444e], 0x2a2a30);
  }
}
