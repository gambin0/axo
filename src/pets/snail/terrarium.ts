import { clamp, hash2 } from '../../core/rng';
import type { Env } from '../../core/time';
import { drawDomeLamp, drawGlassTank, groundShadow } from '../../render/glass';
import { Particles } from '../../render/particles';
import { dither, mix, Surface, VIEW_H, VIEW_W } from '../../render/surface';
import { DecorBox, DECORATE_TOOL, unlockText } from '../decor';
import type { DecorPicker, DropHint, Habitat, Stat, Status, Tool, UiEvent } from '../types';
import { drawBone, drawDropping, drawEggs, drawFood, drawSnail, drawSnailGlass } from './art';
import { SNAIL_DECOR, SNAIL_DECOR_AREAS, snailPreviewBg } from './decor';
import { BONE, BOX, groundY, SNAIL, STONE, Terrarium, newTerrariumState } from './model';

const SOIL = [0x6a4c34, 0x543a26, 0x402c1c, 0x2e1e12];
const WALL = [0xe2ecd8, 0xd4e2c8, 0xc2d4b4];
const MIST = 0xdce8d0;
const LEAF = [0x7ab85a, 0x5a9a44, 0x3a7030];
const FERN = [0x8ac85e, 0x6aa848, 0x4a8034];
const LITTER = [0xb87a3a, 0x9a5a2a, 0xc89a48, 0x8a6a3a];
const LAMP = { x: 30, y: 11 };
const MOSS = [0x9acb62, 0x6fa840, 0x4a7e2c, 0x32581e];
const BARK = [0xb08a62, 0x8a6a48, 0x644a30, 0x3a2a1a];
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

  private decorBox: DecorBox;

  constructor(saved: unknown, seed: number) {
    this.model = saved ? Terrarium.load(saved, seed) : new Terrarium(newTerrariumState(seed));
    // decorations are earned as the snails grow
    this.decorBox = new DecorBox({
      items: SNAIL_DECOR, areas: SNAIL_DECOR_AREAS, placed: () => this.model.s.decor, level: () => this.model.progress(), previewBg: snailPreviewBg,
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
    return this.model.s.name || 'Your snails';
  }

  // ---- simulation --------------------------------------------------------

  update(dt: number, slowDt: number, env: Env): void {
    const m = this.model;
    m.update(dt, slowDt, env);
    const toast = (text: string) => this.events.push({ type: 'toast', text });
    const sound = (name: Extract<UiEvent, { type: 'sound' }>['name']) => this.events.push({ type: 'sound', name });

    for (const d of this.decorBox.newlyUnlocked()) {
      sound('pop');
      toast(unlockText(d));
    }
    this.decorBox.update(dt);
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
      { id: 'food', icon: next.icon, label: next.label, kind: 'drag' },
      { id: 'mist', icon: '💦', label: 'Mist', kind: 'action' },
      { id: 'bone', icon: '🦴', label: 'Bone', kind: 'drag', disabled: m.s.cuttlebone > 0.8 },
      { id: 'salt', icon: '🧂', label: 'Salt', kind: 'drag' },
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
    if (id === 'food') {
      // tapped: put it down near a snail on the floor
      const near = m.s.snails.find((sn) => sn.surface === 'floor') ?? m.s.snails[0];
      const x = at ? at.x : (near ? near.x + 24 : 150);
      if (!m.feed(x)) toast('That is plenty of food. Wait until they have eaten some.');
    } else if (id === 'bone') {
      if (!m.replaceBone()) toast('The cuttlebone is still nice and big.');
    } else if (id === 'salt') m.refuseSalt();
  }

  dropHint(id: string, x: number): DropHint {
    // the cuttlebone always goes back in its corner; everything else goes on the soil where it is dropped
    const hx = id === 'bone' ? BONE.x : Math.max(BOX.minX + 6, Math.min(BOX.maxX - 12, Math.round(x)));
    return { x: hx, y: groundY(hx), ok: true };
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

  /**
   * Everything that never moves: misty greenery at the back, a fern and a trailing vine, coco-fibre
   * soil with leaf litter, a cork bark hide, the stone, a water dish and a couple of tiny mushrooms.
   * The back stays pale so snails on the front glass stand out against it.
   */
  private buildBackground(): void {
    const sf = this.bg;
    for (let y = 0; y < VIEW_H; y++)
      for (let x = 0; x < VIEW_W; x++) sf.px(x, y, dither(WALL, y / BOX.floor + Math.sin(x * 0.03) * 0.06, x, y));

    /** A leaf from its base along angle a: rib down the middle, one side lit, faded toward the mist. */
    const leaf = (bx: number, by: number, a: number, len: number, wid: number, ramp: readonly number[], fade: number) => {
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let t = 0; t <= len; t += 0.5) {
        const w = wid * Math.sin(Math.PI * Math.min(1, t / len)) ** 0.7;
        for (let u = -w; u <= w; u += 0.5) {
          let c = u < 0 ? ramp[0] : ramp[1];
          if (Math.abs(u) < 0.5 && t < len * 0.85) c = ramp[2];
          else if (Math.abs(u) > w - 0.7) c = ramp[2];
          sf.px(Math.round(bx + ca * t - sa * u), Math.round(by + sa * t + ca * u), mix(c, MIST, fade));
        }
      }
    };
    const stem = (x0: number, y0: number, x1: number, y1: number, c: number) => {
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
      for (let k = 0; k <= n; k++) sf.px(Math.round(x0 + ((x1 - x0) * k) / n + Math.sin(k * 0.2) * 0.6), Math.round(y0 + ((y1 - y0) * k) / n), c);
    };
    // far back: big soft leaves fading into the mist
    for (let i = 0; i < 16; i++) {
      const bx = 14 + i * 19 + hash2(i, 1, 150) * 10, top = 58 + hash2(i, 2, 150) * 56;
      const fade = 0.62 + (Math.abs(bx - 160) < 70 ? 0.12 : 0);
      stem(bx, BOX.floor, bx + (hash2(i, 3, 150) - 0.5) * 10, top, mix(MOSS[2], MIST, fade + 0.15));
      leaf(bx + (hash2(i, 3, 150) - 0.5) * 10, top, -Math.PI / 2 + (hash2(i, 4, 150) - 0.5) * 1.6, 18 + hash2(i, 5, 150) * 14, 5 + hash2(i, 6, 150) * 3, LEAF, fade);
    }
    // ferns rising from the soil at both ends
    const fern = (bx: number, dir: number, len: number, seed: number) => {
      let px = bx, py = BOX.floor - 1;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // upright at the base, arching outward toward the tip
        const a = -Math.PI / 2 + dir * (0.12 + t * t * 1.5);
        px += Math.cos(a);
        py += Math.sin(a);
        sf.px(Math.round(px), Math.round(py), MOSS[3]);
        if (i > 4 && i % 3 === 0) {
          const l = (1 - t) * 8 + 2;
          for (const side of [-1, 1]) leaf(px, py, a + side * 1.05, l, 1.1, FERN, hash2(i, side, seed) * 0.1 + (seed % 2) * 0.15);
        }
      }
    };
    for (let i = 0; i < 4; i++) fern(34 + i * 5, i % 2 ? 1 : -1, 46 + i * 7, 160 + i);
    for (let i = 0; i < 4; i++) fern(268 + i * 5, i % 2 ? 1 : -1, 50 + (i % 3) * 8, 170 + i);
    // a trailing vine hanging from the lid
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const vx = 92 + t * 96, vy = BOX.top + 1 + Math.sin(t * Math.PI) * 30 + Math.sin(t * 9) * 1.5;
      sf.px(Math.round(vx), Math.round(vy), MOSS[3]);
      if (i % 8 === 4) leaf(vx, vy, Math.PI / 2 + ((i / 8) % 2 ? 0.8 : -0.8), 7, 3.2, LEAF, 0);
    }

    // soil: coco fibre, darker further down, with strands through it
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
    for (let i = 0; i < 140; i++) {
      const x0 = hash2(i, 1, 147) * VIEW_W, y0 = BOX.floor + 4 + hash2(i, 2, 147) * 34, a = (hash2(i, 3, 147) - 0.5) * 1.2;
      for (let k = 0; k < 3 + hash2(i, 4, 147) * 5; k++) sf.px(Math.round(x0 + Math.cos(a) * k), Math.round(y0 + Math.sin(a) * k), hash2(i, 5, 147) > 0.5 ? 0x7a5a3c : 0x8e6c48);
    }
    // the flat stone, rounded, with a shadow under it
    groundShadow(sf, STONE.x + 1, BOX.floor, STONE.w / 2 + 2, 0.35, 0x1e140c);
    for (let x = STONE.x - STONE.w / 2; x <= STONE.x + STONE.w / 2; x++) {
      const d = (x - STONE.x) / (STONE.w / 2);
      if (Math.abs(d) >= 1) continue;
      const top = groundY(x);
      for (let y = top; y < BOX.floor + 2; y++) {
        let t = (y - top) / (BOX.floor + 2 - top) * 0.7 + (d + 1) * 0.15 + hash2(x, y, 142) * 0.15;
        if (y === top) t = d < 0.2 ? -0.1 : 0.2;
        sf.px(Math.round(x), y, dither(STONE_C, clamp(t, 0, 1), x, y));
      }
    }
    // moss tufts and fallen leaves on the soil
    for (let x = 14; x < 300; x += 3) {
      if (hash2(x, 1, 141) < 0.5) continue;
      const h = 1 + Math.floor(hash2(x, 2, 141) * 3);
      for (let k = 0; k < h; k++) sf.px(x, groundY(x) - k - 1, MOSS[(k + x) % 3]);
    }
    for (let i = 0; i < 26; i++) {
      const x = 10 + hash2(i, 1, 148) * 300;
      if (Math.abs(x - STONE.x) < STONE.w / 2 + 2 || Math.abs(x - 252) < 14) continue;
      const col = LITTER[Math.floor(hash2(i, 2, 148) * LITTER.length)];
      const a = (hash2(i, 3, 148) - 0.5) * 0.5 + (i % 2 ? 0 : Math.PI);
      leaf(x, groundY(Math.round(x)) - 0.5, a, 5 + hash2(i, 4, 148) * 3, 1.3, [col, mix(col, 0xffffff, 0.2), mix(col, 0x000000, 0.3)], 0);
    }
    // a curved piece of cork bark, half buried, for hiding under
    groundShadow(sf, 58, BOX.floor, 38, 0.35, 0x1e140c);
    for (let x = 22; x <= 92; x++) {
      const d = (x - 57) / 35;
      const top = BOX.floor - Math.round(16 * Math.sqrt(Math.max(0, 1 - d * d))) - 1;
      for (let y = top; y < BOX.floor + 2; y++) {
        if (y > BOX.floor - 6 && Math.abs(d) < 0.38) continue; // the doorway under it
        // cork: rough, with deep cracks running along the curve
        const crack = hash2(x >> 2, Math.round((y - top) / 2.5), 143) > 0.7 && hash2(x, y, 149) > 0.3;
        let t = (y - top) / 20 + (crack ? 0.45 : 0) + (hash2(x, y, 144) - 0.5) * 0.25 - (d < -0.3 ? 0.1 : 0);
        if (y === top) t = -0.1;
        sf.px(x, y, dither(BARK, clamp(t, 0, 1), x, y));
      }
      // a little moss growing on top
      if (Math.abs(d + 0.15) < 0.35 && hash2(x, 0, 151) > 0.3) {
        sf.px(x, top - 1, MOSS[hash2(x, 1, 151) > 0.5 ? 0 : 1]);
        if (hash2(x, 2, 151) > 0.5) sf.px(x, top - 2, MOSS[0]);
      }
    }
    for (let y = BOX.floor - 6; y < BOX.floor + 2; y++)
      for (let x = 44; x <= 70; x++) sf.px(x, y, dither([0x1a120a, 0x2a1c10, 0x3a281a], (y - (BOX.floor - 6)) / 10 + hash2(x, y, 145) * 0.3, x, y));
    // a shallow water dish sunk into the soil, seen from just above
    const wx = 252, wy = groundY(252) - 1;
    groundShadow(sf, wx + 1, wy + 3, 14, 0.3, 0x1e140c);
    for (let k = 1; k <= 3; k++)
      for (let dx = -12 + k; dx <= 12 - k; dx++) sf.px(wx + dx, wy + k, dither([0xe8e2d6, 0xc8c0b0, 0xa49c8c], k / 3.5 + (dx > 6 ? 0.3 : 0), wx + dx, wy + k));
    for (let py = wy - 4; py <= wy + 1; py++)
      for (let dx = -12; dx <= 12; dx++) {
        const oy = py - (wy - 1.5);
        if ((dx / 12) ** 2 + (oy / 3.5) ** 2 > 1) continue;
        let c = oy < 0 ? 0xf0ebe0 : 0xdcd4c4;
        if ((dx / 10) ** 2 + (oy / 2.4) ** 2 <= 1) c = oy < -0.5 ? 0xc4ecfa : dx > 3 ? 0x5aa8d8 : 0x8ccff0;
        sf.px(wx + dx, py, c);
      }
    sf.px(wx - 4, wy - 2, 0xffffff);
    sf.px(wx - 3, wy - 2, 0xffffff);
    // two tiny mushrooms by the bark
    for (const [mx, h, r] of [[100, 6, 3.5], [106, 4, 2.5]]) {
      const g = groundY(mx);
      for (let y = g - h; y < g; y++) sf.px(mx, y, 0xf0e6d0);
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        const ch = Math.round(Math.sqrt(Math.max(0, 1 - (dx / (r + 0.5)) ** 2)) * r * 0.7);
        for (let k = 0; k <= ch; k++) sf.px(mx + dx, g - h - k, k === ch ? 0xd8a070 : dx > 0 ? 0x9a5e34 : 0xb87442);
        sf.px(mx + dx, g - h + 1, 0xe0d0b0);
      }
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
    // decorations along the front of the soil; snails on the glass stay in front of them
    this.decorBox.draw(sf, time);
    if (this.tool === 'decorate') this.decorBox.drawDecorating(sf, time);
    for (const sn of s.snails) if (sn.surface === 'glass') drawSnailGlass(sf, sn);

    this.particles.render(sf);

    // damp air: the glass mists up at the top, and droplets run down it
    for (let y = BOX.top; y < BOX.top + 22; y++) {
      const a = (s.moisture / 100) * 0.2 * (1 - (y - BOX.top) / 22);
      for (let x = BOX.left; x < BOX.right; x++) sf.blend(x, y, 0xffffff, a * (0.8 + 0.2 * hash2(x >> 2, y >> 1, 152)));
    }
    for (let i = 0; i < Math.round(s.moisture / 7); i++) {
      const x = 12 + hash2(i, 1, 146) * 296, y = 14 + ((hash2(i, 2, 146) * 110 + time * (0.8 + hash2(i, 3, 146) * 1.6)) % 110);
      sf.blend(x, y, 0xffffff, 0.5);
      sf.blend(x, y + 1, 0xd8eef2, 0.35);
    }

    if (s.lamp)
      for (let y = BOX.top; y < 110; y++)
        for (let x = BOX.left; x < 170; x++) {
          const d = Math.hypot(x - LAMP.x, (y - LAMP.y) * 1.1) / 140;
          if (d < 1) sf.add(x, y, 0xffe8a8, 0.26 * (1 - d) ** 1.5);
        }
    if (dark) sf.multiply(0.45, 0.52, 0.74);
    drawGlassTank(sf, BOX.left, BOX.right, BOX.top);
    drawDomeLamp(sf, LAMP.x, LAMP.y, s.lamp, [0xf0ece4, 0xd0c8bc, 0xa8a094], 0x787068);
  }
}
