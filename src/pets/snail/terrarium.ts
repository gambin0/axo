import { clamp, hash2 } from '../../core/rng';
import type { Env } from '../../core/time';
import { Particles } from '../../render/particles';
import { dither, mix, Surface, VIEW_H, VIEW_W } from '../../render/surface';
import type { Habitat, Stat, Status, Tool, UiEvent } from '../types';
import { drawBone, drawDropping, drawEggs, drawFood, drawSnail, drawSnailGlass } from './art';
import { BONE, BOX, groundY, SNAIL, STONE, Terrarium, newTerrariumState } from './model';

const SOIL = [0x6a4c34, 0x543a26, 0x402c1c, 0x2e1e12];
const WALL = [0xcfdcc8, 0xbccdb4, 0xa6b89c];
const MOSS = [0x9acb62, 0x6fa840, 0x4a7e2c, 0x32581e];
const BARK = [0x9a7650, 0x7a5a3a, 0x58402a, 0x3a2a1a];
const STONE_C = [0xc4c4be, 0x9e9e98, 0x76766f, 0x55554f];
const FOODS = [
  { icon: '🥬', label: 'Lettuce' },
  { icon: '🥒', label: 'Cucumber' },
  { icon: '🥕', label: 'Carrot' },
] as const;

export class TerrariumHabitat implements Habitat {
  readonly id = 'snail';
  tool = 'hand';
  model: Terrarium;
  private particles = new Particles();
  private bg = new Surface(VIEW_W, VIEW_H);
  private bgReady = false;
  private events: UiEvent[] = [];
  private warnedDry = false;
  private toldFood = false;

  constructor(saved: unknown, seed: number) {
    this.model = saved ? Terrarium.load(saved, seed) : new Terrarium(newTerrariumState(seed));
  }

  get name(): string {
    return this.model.s.name;
  }
  set name(v: string) {
    this.model.s.name = v;
  }

  private who(): string {
    return this.model.s.name || 'Your snails';
  }

  // ---- simulation --------------------------------------------------------

  update(dt: number, slowDt: number, env: Env): void {
    const m = this.model;
    m.update(dt, slowDt, env);
    const toast = (text: string) => this.events.push({ type: 'toast', text });
    const sound = (name: Extract<UiEvent, { type: 'sound' }>['name']) => this.events.push({ type: 'sound', name });

    if (m.dry() && !this.warnedDry) {
      this.warnedDry = true;
      toast(`${this.who()} sealed themselves up because the air got dry. Tap 💦 to mist them!`);
    } else if (!m.dry()) this.warnedDry = false;

    let waked = false;
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
        case 'drop':
          this.particles.spawn('drop', fx.x, fx.y);
          sound('splash');
          break;
        case 'crumb':
          this.particles.spawn('crumb', fx.x, fx.y, 0x9fd06a);
          sound('munch');
          break;
        case 'plop':
          sound('plop');
          break;
        case 'zzz':
          this.particles.spawn('zzz', fx.x, fx.y);
          break;
        case 'wake':
          this.particles.spawn('sparkle', fx.x, fx.y);
          if (!waked) {
            waked = true;
            sound('hatch');
            toast('The snails woke up and their eyes came out!');
          }
          break;
        case 'laid':
          this.particles.spawn('sparkle', fx.x, fx.y);
          sound('pop');
          toast('Look in the soil! Tiny pearly eggs. They hatch in about two days.');
          break;
        case 'hatched':
          for (let i = 0; i < 4; i++) this.particles.spawn('sparkle', fx.x + (i - 2) * 5, fx.y);
          sound('hatch');
          toast('Baby snails hatched! They are almost see-through.');
          break;
        case 'salt':
          toast('Never give snails salt. It hurts them. So we will not!');
          break;
        case 'full':
          toast('That is plenty of food. Wait until they have eaten some.');
          break;
      }
    }
    m.fx.length = 0;
    this.particles.update(dt, 0, BOX.floor);
    if (!this.toldFood && m.s.foods.length && m.s.snails.some((sn) => sn.state === 'eat')) {
      this.toldFood = true;
      toast(`${this.who()} found the leaf. Watch the bites!`);
    }
  }

  coarseStep(dt: number, env: Env): void {
    this.model.coarseStep(dt, env);
  }

  beginCatchup(): () => string[] {
    const before = this.model.s.snails.length;
    const growth = this.model.s.snails.reduce((a, sn) => a + sn.growth, 0);
    return () => {
      const m = this.model;
      m.fx.length = 0;
      const s = m.s;
      const out: string[] = [];
      if (s.snails.length > before) out.push('baby snails hatched');
      if (s.eggs) out.push('there are eggs in the soil');
      if (m.dry()) out.push('the air got dry and the snails sealed up');
      else if (s.snails.reduce((a, sn) => a + sn.growth, 0) > growth + 0.02) out.push('the snails grew a little');
      if (m.hungriest() < 30 || !s.foods.length) out.push('the food ran low');
      if (!out.length) out.push('the snails were gliding about');
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
    if (this.tool === 'food') {
      if (kind === 'down' && !m.feed(x)) this.events.push({ type: 'toast', text: 'That is plenty of food. Wait until they have eaten some.' });
      return;
    }
    if (this.tool === 'tidy') {
      if (m.tidy(x) === 0 && kind === 'down') this.particles.spawn('ripple', x, y);
      return;
    }
    if (kind === 'down') {
      const h = m.hit(x, y);
      if (h) m.poke(h.sn, h.stalk);
      else m.tapGlass(x, y);
    } else if (y > BOX.floor - 30) m.finger = { x, y };
  }

  tools(): Tool[] {
    const m = this.model;
    const next = FOODS[m.s.foodKind % 3];
    return [
      { id: 'hand', icon: '✋', label: 'Touch', kind: 'mode' },
      { id: 'food', icon: next.icon, label: next.label, kind: 'mode' },
      { id: 'mist', icon: '💦', label: 'Mist', kind: 'action' },
      { id: 'bone', icon: '🦴', label: 'Bone', kind: 'action', disabled: m.s.cuttlebone > 0.8 },
      { id: 'salt', icon: '🧂', label: 'Salt', kind: 'action' },
      { id: 'tidy', icon: '🧹', label: 'Tidy', kind: 'mode' },
      { id: 'lamp', icon: '💡', label: 'Lamp', kind: 'toggle', on: m.s.lamp },
    ];
  }

  useTool(id: string): void {
    const m = this.model;
    const toast = (text: string) => this.events.push({ type: 'toast', text });
    switch (id) {
      case 'mist':
        m.mist();
        break;
      case 'bone':
        if (!m.replaceBone()) toast('The cuttlebone is still nice and big.');
        break;
      case 'salt':
        m.refuseSalt();
        break;
      case 'lamp':
        m.s.lamp = !m.s.lamp;
        break;
      default:
        this.tool = id;
        if (id === 'food') toast('Tap the soil to put the food down.');
    }
  }

  stats(): Stat[] {
    const m = this.model, s = m.s;
    return [
      { icon: '🐌', label: 'Snails', value: `${s.snails.length} of ${SNAIL.maxSnails}` },
      { icon: '🥬', label: 'Tummy', value: m.hungriest() },
      { icon: '🌫️', label: 'Damp', value: s.moisture },
      { icon: '🦴', label: 'Calcium', value: m.lowestCalcium() },
      { icon: '🥚', label: 'Eggs', value: s.eggs ? 'In the soil!' : 'None' },
    ];
  }

  status(env: Env): Status {
    const m = this.model, s = m.s;
    if (m.dry()) return { text: 'Sealed up, needs a mist', tone: 'warn' };
    if (m.hungriest() < 30) return { text: 'Hungry!', tone: 'warn' };
    if (m.lowestCalcium() < 25) return { text: 'Needs calcium', tone: 'warn' };
    if (s.eggs) return { text: 'Eggs in the soil', tone: 'good' };
    if (!m.awake(env)) return { text: 'Snoozing', tone: 'sleep' };
    return { text: 'Gliding about', tone: 'good' };
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

  /** Back wall, soil, bark, stone and plants: everything that never moves. */
  private buildBackground(): void {
    const sf = this.bg;
    for (let y = 0; y < VIEW_H; y++)
      for (let x = 0; x < VIEW_W; x++) sf.px(x, y, dither(WALL, y / BOX.floor + Math.sin(x * 0.03) * 0.05, x, y));
    // a little fern and a leafy plant at the back
    const frond = (bx: number, by: number, dir: number, len: number, seed: number) => {
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const px = bx + dir * i * 0.9, py = by - i * 1.1 + t * t * 14;
        sf.px(Math.round(px), Math.round(py), MOSS[2]);
        for (let k = 1; k <= 3 - Math.floor(t * 2.5); k++) {
          sf.px(Math.round(px), Math.round(py - k), MOSS[hash2(i, k, seed) > 0.5 ? 0 : 1]);
          sf.px(Math.round(px), Math.round(py + k), MOSS[1]);
        }
      }
    };
    for (let i = 0; i < 7; i++) frond(40 + i * 3, BOX.floor - 2, i % 2 ? 1 : -1, 22 + i * 3, 150 + i);
    for (let i = 0; i < 6; i++) frond(262 + i * 3, BOX.floor - 2, i % 2 ? 1 : -1, 26 + (i % 3) * 5, 160 + i);
    // soil
    for (let x = 0; x < VIEW_W; x++) {
      const top = groundY(x);
      for (let y = top; y < VIEW_H; y++) {
        const n = hash2(x, y, 140);
        let c = dither(SOIL, (y - top) / 40 + n * 0.45, x, y);
        if (y === top) c = mix(c, 0xa87c58, 0.4);
        if (n > 0.975) c = 0x8a6a4a;
        else if (n < 0.02) c = 0x1e140c;
        sf.px(x, y, c);
      }
    }
    // moss tufts along the soil
    for (let x = 14; x < 300; x += 3) {
      if (hash2(x, 1, 141) < 0.45) continue;
      const h = 1 + Math.floor(hash2(x, 2, 141) * 3);
      for (let k = 0; k < h; k++) sf.px(x, groundY(x) - k - 1, MOSS[(k + x) % 3]);
    }
    // the flat stone
    for (let x = STONE.x - STONE.w / 2; x <= STONE.x + STONE.w / 2; x++) {
      const d = (x - STONE.x) / (STONE.w / 2);
      if (Math.abs(d) >= 1) continue;
      const top = groundY(x);
      for (let y = top; y < top + 5; y++) sf.px(Math.round(x), y, dither(STONE_C, (y - top) / 5 + (d + 1) * 0.15 + hash2(x, y, 142) * 0.2, x, y));
    }
    // a curved piece of bark leaning on the left
    for (let x = 22; x <= 92; x++) {
      const d = (x - 57) / 35;
      const top = BOX.floor - Math.round(16 * Math.sqrt(Math.max(0, 1 - d * d))) - 1;
      for (let y = top; y < BOX.floor + 2; y++) {
        if (y > BOX.floor - 6 && Math.abs(d) < 0.38) continue; // the doorway under it
        const ridge = hash2(x >> 1, y, 143) > 0.78 ? 0.18 : 0;
        sf.px(x, y, dither(BARK, (y - top) / 18 + ridge + (hash2(x, y, 144) - 0.5) * 0.15, x, y));
      }
    }
    for (let y = BOX.floor - 6; y < BOX.floor + 2; y++) for (let x = 44; x <= 70; x++) sf.px(x, y, dither([0x2a1c10, 0x3a281a], hash2(x, y, 145), x, y));
    // a shallow water dish
    const dx0 = 252;
    for (let dx = -12; dx <= 12; dx++) {
      const depth = Math.round(3 * Math.sqrt(1 - (dx / 12) ** 2));
      for (let k = 0; k <= depth; k++) sf.px(dx0 + dx, BOX.floor - 1 + k, k === 0 ? 0xd9d2c2 : dither([0xbdb4a2, 0x9a917f], k / 4, dx0 + dx, k));
      if (Math.abs(dx) < 11) sf.px(dx0 + dx, BOX.floor - 1, dx % 3 ? 0xa8dcf2 : 0xd4f0fb);
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

    // dry soil goes pale
    const pale = clamp((60 - s.moisture) / 60, 0, 1) * 0.22;
    if (pale > 0.01) sf.rect(0, BOX.floor - 14, VIEW_W, VIEW_H - BOX.floor + 14, 0xe8d8b8, pale * 0.5);

    // slime trails
    for (const trail of m.trails.values()) {
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1], b = trail[i];
        if (Math.hypot(a.x - b.x, a.y - b.y) > 6) continue;
        const k = 1 - b.age / SNAIL.trailFade;
        if (k <= 0) continue;
        sf.line(Math.round(a.x), Math.round(a.y) - 0, Math.round(b.x), Math.round(b.y) - 0, 0xe4eef6, 0.55 * k);
        sf.blend(Math.round(b.x), Math.round(b.y) + 1, 0xc4d8e8, 0.25 * k);
      }
    }

    // droppings, food, cuttlebone, eggs
    for (const d of s.droppings) drawDropping(sf, d, groundY(d));
    for (const f of s.foods) drawFood(sf, f.x, groundY(f.x), f.kind, f.left, !m.fresh(f) && f.left > 0.02, f.id * 7);
    drawBone(sf, BONE.x, BOX.floor + 1, s.cuttlebone);
    if (s.eggs) drawEggs(sf, Math.round(s.eggs.x), groundY(Math.round(s.eggs.x)), s.eggs.t, time);

    // floor snails first, then the ones on the front glass
    for (const sn of s.snails) if (sn.surface === 'floor') drawSnail(sf, sn, time, Math.sin(time * 2));
    for (const sn of s.snails) if (sn.surface === 'glass') drawSnailGlass(sf, sn);

    this.particles.render(sf);

    // damp air: droplets on the glass
    for (let i = 0; i < Math.round(s.moisture / 7); i++) {
      const x = 12 + hash2(i, 1, 146) * 296, y = 14 + ((hash2(i, 2, 146) * 110 + time * (0.8 + hash2(i, 3, 146) * 1.6)) % 110);
      sf.blend(x, y, 0xffffff, 0.5);
      sf.blend(x, y + 1, 0xd8eef2, 0.35);
    }

    if (s.lamp) {
      for (let y = 0; y < 100; y++)
        for (let x = 0; x < 170; x++) {
          const d = Math.hypot(x - 14, y - 2) / 120;
          if (d < 1) sf.add(x, y, 0xffe8a8, 0.26 * (1 - d) ** 1.5);
        }
      sf.rect(0, 0, 28, 5, 0x3a3a3a);
      sf.rect(2, 5, 24, 2, 0xffe8a8);
    }
    if (dark) sf.multiply(0.45, 0.52, 0.74);

    for (let i = 0; i < 70; i++) {
      sf.add(190 + i, 14 + i * 1.6, 0xffffff, 0.05);
      sf.add(191 + i, 14 + i * 1.6, 0xffffff, 0.05);
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
