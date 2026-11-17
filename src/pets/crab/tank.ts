import { clamp, hash2 } from '../../core/rng';
import type { Env } from '../../core/time';
import { Particles } from '../../render/particles';
import { dither, mix, Surface, VIEW_H, VIEW_W } from '../../render/surface';
import type { Habitat, Stat, Status, Tool, UiEvent } from '../types';
import { drawCrab, drawMound, drawShell, shellRadius } from './art';
import { BRANCH, COCONUT, Crab, CRAB, DISH, newCrabState, sandY, TANK, type Shell } from './model';

const SAND = [0xe8d6a8, 0xd2bc8a, 0xb89f70, 0x967f58];
const WALL = [0xf2e2c4, 0xe6cfa6, 0xd2b88a];
const WOOD = [0xa27c52, 0x82603c, 0x5e4528, 0x3e2d1a];
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

  constructor(saved: unknown, seed: number) {
    this.model = saved ? Crab.load(saved, seed) : new Crab(newCrabState(seed));
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
      return;
    }
    if (this.tool === 'chips') {
      if (kind === 'down') m.dropChip(x);
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
      { id: 'food', icon: '🍓', label: 'Food', kind: 'action', disabled: m.s.food > 0.85 },
      { id: 'water', icon: '🥤', label: 'Water', kind: 'action', disabled: m.s.fresh > 0.85 && m.s.salt > 0.85 },
      { id: 'mist', icon: '💦', label: 'Mist', kind: 'action' },
      { id: 'shell', icon: '🐚', label: 'Shell', kind: 'action' },
      { id: 'chips', icon: '🥔', label: 'Crisps', kind: 'mode' },
      { id: 'tidy', icon: '🧹', label: 'Tidy', kind: 'mode' },
      { id: 'lamp', icon: '💡', label: 'Lamp', kind: 'toggle', on: m.s.lamp },
    ];
  }

  useTool(id: string): void {
    const m = this.model;
    const toast = (text: string) => this.events.push({ type: 'toast', text });
    switch (id) {
      case 'food':
        if (!m.fillFood()) toast('The food dish is full already.');
        break;
      case 'water':
        if (!m.fillWater()) toast('Both water dishes are full.');
        break;
      case 'mist':
        m.mist();
        break;
      case 'shell': {
        const r = m.offerShell();
        if (r === 'full') toast('The shell pile is full. Use 🧹 Tidy to clear the ones it did not like.');
        else if (r === 'wait') toast(`Let ${this.who()} look at the shells first!`);
        else if (m.cramped()) toast('A new shell! Will it be a better fit?');
        break;
      }
      case 'lamp':
        m.s.lamp = !m.s.lamp;
        break;
      default:
        this.tool = id;
        if (id === 'chips') toast('Crisps are salty and bad for hermit crabs. Watch what it does!');
    }
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

  /** Back wall, sand bed, branch and coconut hide: everything that never moves. */
  private buildBackground(): void {
    const sf = this.bg;
    for (let y = 0; y < VIEW_H; y++)
      for (let x = 0; x < VIEW_W; x++) sf.px(x, y, dither(WALL, y / TANK.sand + Math.sin(x * 0.02) * 0.05, x, y));
    // the branch: a gnarled limb leaning up and to the left
    const limb = (pts: readonly { x: number; y: number }[], r0: number, r1: number) => {
      for (let i = 1; i < pts.length; i++) {
        const A = pts[i - 1], B = pts[i];
        const n = Math.ceil(Math.hypot(B.x - A.x, B.y - A.y));
        for (let k = 0; k <= n; k++) {
          const f = k / n, cx = A.x + (B.x - A.x) * f, cy = A.y + (B.y - A.y) * f;
          const r = r0 + (r1 - r0) * ((i - 1 + f) / (pts.length - 1));
          for (let d = -Math.ceil(r); d <= Math.ceil(r); d++) {
            if (Math.abs(d) > r) continue;
            const t = (d + r) / (2 * r) + (hash2(Math.round(cx / 3), d, 121) > 0.8 ? 0.15 : 0);
            sf.px(Math.round(cx), Math.round(cy + d - 3), dither(WOOD, clamp(t, 0, 1), Math.round(cx), Math.round(cy + d)));
          }
        }
      }
    };
    // the root runs down below the surface, so the sand (drawn after) covers its foot
    limb([{ x: 146, y: 152 }, ...BRANCH], 6, 1);
    limb([BRANCH[2], { x: 112, y: 70 }, { x: 118, y: 52 }], 2.2, 0.4);
    limb([BRANCH[4], { x: 56, y: 88 }, { x: 44, y: 100 }], 1.8, 0.4);
    // sand
    for (let x = 0; x < VIEW_W; x++) {
      const top = sandY(x);
      for (let y = top; y < VIEW_H; y++) {
        const n = hash2(x, y, 120);
        let c = dither(SAND, (y - top) / 36 + n * 0.4, x, y);
        if (y === top) c = mix(c, 0xfff3d0, 0.4);
        if (n > 0.97) c = 0x7a6a50;
        else if (n < 0.02) c = 0xfff3d0;
        sf.px(x, y, c);
      }
    }
    // coconut hide: half a husk with a doorway
    for (let y = TANK.sand - COCONUT.r - 4; y <= TANK.sand + 4; y++)
      for (let x = COCONUT.x - COCONUT.r - 2; x <= COCONUT.x + COCONUT.r + 2; x++) {
        const dx = (x - COCONUT.x) / COCONUT.r, dy = (y - (TANK.sand + 2)) / (COCONUT.r * 0.95);
        const e = dx * dx + dy * dy;
        if (e > 1 || dy > 0) continue;
        const door = ((x - (COCONUT.x - 6)) / 14) ** 2 + ((y - (TANK.sand + 2)) / 14) ** 2 < 1;
        if (door) {
          sf.px(x, y, dither([0x2a1c10, 0x3a281a], hash2(x, y, 122), x, y));
          continue;
        }
        let t = 0.35 + -dy * 0.5 - dx * 0.2 + (hash2(x >> 1, y, 123) - 0.5) * 0.3;
        if (e > 0.9) t -= 0.2;
        sf.px(x, y, dither(COCO, clamp(1 - t, 0, 1), x, y));
      }
  }

  private dish(sf: Surface, x: number, level: number, kind: 'fresh' | 'salt'): void {
    const y = sandY(x);
    for (let dx = -11; dx <= 11; dx++) {
      const depth = Math.round(3 * Math.sqrt(1 - (dx / 11) ** 2));
      for (let k = 0; k < depth + 1; k++) sf.px(x + dx, y - 1 + k, k === 0 ? 0xd9d2c2 : dither([0xbdb4a2, 0x9a917f], k / 4, x + dx, y + k));
      // water in the bowl
      if (level > 0.02 && Math.abs(dx) < 10)
        sf.px(x + dx, y - 1 + Math.max(0, 2 - Math.round(level * 2)), kind === 'salt' ? (dx % 3 ? 0x8fd0d8 : 0xbfe8ee) : dx % 3 ? 0xa8dcf2 : 0xd4f0fb);
    }
    sf.rect(x - 11, y - 2, 23, 1, 0xf0eadc);
    if (kind === 'salt' && level > 0.02) for (let i = 0; i < 3; i++) sf.px(x - 6 + i * 5, y - 1, 0xffffff);
  }

  private foodDish(sf: Surface, x: number, level: number): void {
    const y = sandY(x);
    for (let dx = -10; dx <= 10; dx++) {
      const depth = Math.round(2.5 * Math.sqrt(1 - (dx / 10) ** 2));
      for (let k = 0; k < depth + 1; k++) sf.px(x + dx, y - 1 + k, k === 0 ? 0xcf6a3a : dither([0xa84e2a, 0x7e3a1e], k / 3, x + dx, y + k));
    }
    const bits = Math.round(level * 9);
    const cols = [0xe0405a, 0x8fbf4a, 0xf2b84a, 0xf08a6a];
    for (let i = 0; i < bits; i++) {
      const bx = x - 7 + ((i * 5) % 15), by = y - 2 - ((i * 7) % 3) - (i > 5 ? 1 : 0);
      sf.px(bx, by, cols[i % 4]);
      sf.px(bx + 1, by, mix(cols[i % 4], 0x000000, 0.2));
    }
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
    this.foodDish(sf, DISH.food, s.food);
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
      const moving = ['walk', 'follow', 'shop', 'sniff', 'climb', 'descend', 'eat', 'drink'].includes(s.state) && (Math.abs(s.tx - s.x) > 1.5 || s.step >= 0);
      const reach = s.state === 'inspect' ? 0.5 + 0.5 * Math.sin(time * 9) : s.state === 'eat' || s.state === 'drink' ? 0.5 + 0.5 * Math.sin(m.eatPhase * 8) : 0;
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

    this.particles.render(sf);

    // humid air: droplets run down the glass
    for (let i = 0; i < Math.round(s.humidity / 6); i++) {
      const x = 12 + hash2(i, 1, 124) * 296, y = 14 + ((hash2(i, 2, 124) * 100 + time * (1 + hash2(i, 3, 124) * 2)) % 100);
      sf.blend(x, y, 0xffffff, 0.55);
      sf.blend(x, y + 1, 0xd8eef2, 0.4);
    }

    if (s.lamp) {
      // a heat lamp glowing in the top corner
      for (let y = 0; y < 90; y++)
        for (let x = 0; x < 150; x++) {
          const d = Math.hypot(x - 10, y - 2) / 110;
          if (d < 1) sf.add(x, y, 0xffd890, 0.28 * (1 - d) ** 1.5);
        }
      sf.rect(0, 0, 26, 5, 0x3a3a3a);
      sf.rect(2, 5, 22, 2, 0xffd890);
    }
    if (dark) sf.multiply(0.45, 0.5, 0.72);

    for (let i = 0; i < 80; i++) {
      sf.add(50 + i, 14 + i * 1.5, 0xffffff, 0.05);
      sf.add(51 + i, 14 + i * 1.5, 0xffffff, 0.05);
    }
    for (let x = 0; x < VIEW_W; x++) {
      sf.px(x, 0, 0x14100c);
      sf.px(x, 1, 0x14100c);
      sf.px(x, VIEW_H - 1, 0x14100c);
      sf.px(x, VIEW_H - 2, 0x14100c);
    }
    for (let y = 0; y < VIEW_H; y++) {
      sf.px(0, y, 0x14100c);
      sf.px(1, y, 0x14100c);
      sf.px(VIEW_W - 1, y, 0x14100c);
      sf.px(VIEW_W - 2, y, 0x14100c);
    }
  }
}
