import { clamp, hash2 } from '../../core/rng';
import type { Env } from '../../core/time';
import { drawDomeLamp, drawGlassTank, groundShadow } from '../../render/glass';
import { Particles } from '../../render/particles';
import { dither, mix, Surface, VIEW_H, VIEW_W } from '../../render/surface';
import type { DropHint, Habitat, Stat, Status, Tool, UiEvent } from '../types';
import { drawHamster, type HamPoseName } from './art';
import {
  BOTTLE, CAGE, GROUND, HAM, Hamster, NEST, newHamsterState, polyPrefix, SPOT, STORE, SWEETS, TREATS, TUBE, tubePath, TUNNELS, tunnelOpen,
  WHEEL, type Pt,
} from './model';

const WALL = [0xf2e8d4, 0xe8dcc4, 0xdccdb0, 0xcbb898, 0xb8a482];
const BEDDING = [0xf6eed8, 0xe8dab8, 0xd6c49e, 0xbca880];
const TUNNEL = [0xa08060, 0x7a5c40, 0x54402a, 0x30221a];
const WOOD = [0xd8a868, 0xb8844a, 0x8a5e32, 0x5e3e20];
const HAY = [0xe0cc80, 0xc8ac5c, 0xa88c44];
const CURTAIN = [0xf4b8a4, 0xe0988a, 0xc47a70];
const WINDOW = { x0: 98, x1: 146, y0: 20, y1: 60 };
const LAMP = { x: 30, y: 13 };
const SKIN = [0xf4c8a8, 0xe0a888, 0xc08468];

type Sky = 'day' | 'dusk' | 'night';
const skyAt = (hour: number): Sky => (hour >= 20 || hour < 6 ? 'night' : hour >= 18 || hour < 7.5 ? 'dusk' : 'day');

const UNLOCK_TEXT: Record<string, (n: string) => string> = {
  sniff: (n) => `${n} trusts you enough to come and sniff your finger. Hold a finger in the cage!`,
  hand: (n) => `${n} will take treats from your hand now. Pick a treat and tap ${n}.`,
  climb: (n) => `${n} might climb onto your finger! Hold your finger next to it.`,
  sleepInView: (n) => `${n} feels safe enough to sleep out in the open.`,
  bath: () => 'A sand bath appeared! Hamsters roll in sand to keep their fur clean.',
  tube: () => 'A tube appeared! Hamsters love running through tunnels.',
};
const DUG_TEXT: Record<string, string> = {
  nest: 'a cosy nest chamber',
  store: 'a secret food store',
  exit: 'a back door',
};

export class CageHabitat implements Habitat {
  readonly id = 'hamster';
  tool = 'hand';
  model: Hamster;
  private particles = new Particles();
  private bg = new Surface(VIEW_W, VIEW_H);
  private bgReady = false;
  private soilKey = '';
  private events: UiEvent[] = [];
  private said = new Set<string>();
  /** The finger is drawn while it is held down with the hand tool. */
  private holding = false;

  constructor(saved: unknown, seed: number) {
    this.model = saved ? Hamster.load(saved, seed) : new Hamster(newHamsterState(seed));
  }

  get name(): string {
    return this.model.s.name;
  }
  set name(v: string) {
    this.model.s.name = v;
  }

  private who(): string {
    return this.model.s.name || 'Your hamster';
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
    const n = this.who();
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
          this.particles.spawn('dust', fx.x, fx.y, BEDDING[2]);
          break;
        case 'drop':
          this.particles.spawn('drop', fx.x, fx.y);
          sound('splash');
          break;
        case 'crumb':
          this.particles.spawn('crumb', fx.x, fx.y, 0xc8a060);
          sound('munch');
          break;
        case 'zzz':
          this.particles.spawn('zzz', fx.x, fx.y);
          break;
        case 'plop':
          sound('plop');
          break;
        case 'stuff':
          this.particles.spawn('crumb', fx.x, fx.y, 0xc8a060);
          sound('munch');
          once('stuff', `Look! ${n} stuffed it into its cheek pouches!`);
          break;
        case 'hoard':
          for (let i = 0; i < 4; i++) this.particles.spawn('crumb', fx.x, fx.y, 0xc8a060);
          sound('plop');
          once('hoard', `${n} emptied its cheeks into its hoard. Hamsters save food for later!`);
          break;
        case 'squeak':
          sound('chirp');
          break;
        case 'unlock':
          this.particles.spawn('heart', fx.x, fx.y);
          sound('hatch');
          if (fx.text && UNLOCK_TEXT[fx.text]) toast(UNLOCK_TEXT[fx.text](n));
          break;
        case 'dug':
          sound('pop');
          if (fx.text && DUG_TEXT[fx.text]) toast(`${n} dug ${DUG_TEXT[fx.text]} in its burrow!`);
          break;
        case 'startle':
          this.particles.spawn('no', fx.x, fx.y);
          sound('no');
          toast(`Too many taps! ${n} got a fright. Gentle and slow is best.`);
          break;
        case 'sweets':
          once('sweets', `Sweets and chocolate are bad for hamsters, so ${n} won't eat them.`);
          break;
        case 'handfed':
          sound('munch');
          once('handfed', `${n} took it right from your hand!`);
          break;
        case 'climb':
          for (let i = 0; i < 3; i++) this.particles.spawn('heart', fx.x + i * 5 - 5, fx.y);
          sound('hatch');
          once('climb', `${n} climbed onto your finger!`);
          break;
        case 'wake':
          this.particles.spawn('zzz', fx.x, fx.y);
          once('wake', `${n} was asleep! Hamsters sleep in the day and play at night.`);
          break;
        case 'notyet':
          once('notyet', `${n} isn't ready to take food from your hand yet, so it went on the floor. Keep visiting!`);
          break;
      }
    }
    m.fx.length = 0;
    this.particles.update(dt, 0, GROUND);
  }

  coarseStep(dt: number, env: Env): void {
    this.model.coarseStep(dt, env);
  }

  beginCatchup(): () => string[] {
    const m0 = this.model.s;
    const burrow = this.model.burrow(), hoard = m0.hoard, drops = m0.droppings.length;
    return () => {
      const m = this.model, s = m.s;
      m.fx.length = 0;
      const out: string[] = [];
      if (m.burrow() > burrow + 0.01) out.push(`${this.who()} dug more of its burrow`);
      if (s.hoard < hoard - 0.5) out.push('it ate from its hoard');
      if (s.bowl < 1 && s.hoard < 1) out.push('the food ran out');
      if (s.bottle <= HAM.floors.bottle + 0.01) out.push('the water bottle is nearly empty');
      if (s.droppings.length > drops) out.push('the cage needs a clean');
      if (!out.length) out.push(`${this.who()} was snoozing`);
      return out;
    };
  }

  // ---- input -------------------------------------------------------------

  pointer(kind: 'down' | 'move' | 'up', x: number, y: number): void {
    const m = this.model;
    if (kind === 'up') {
      m.finger = null;
      this.holding = false;
      return;
    }
    if (this.tool === 'clean') {
      if (m.clean(x) === 0 && kind === 'down') this.particles.spawn('ripple', x, y);
      return;
    }
    if (kind === 'down') {
      if (m.hit(x, y)) m.poke();
      else m.tapCage(x, y);
    }
    // a finger held in the cage, above the bedding
    if (y < GROUND + 2 && y > CAGE.top + 10) {
      this.holding = true;
      m.finger = { x, y };
    }
  }

  tools(): Tool[] {
    const m = this.model, s = m.s;
    return [
      { id: 'hand', icon: '✋', label: 'Hand', kind: 'mode' },
      { id: 'seeds', icon: '🌾', label: 'Seeds', kind: 'drag' },
      // each treat is its own button (sunflower seeds come from the Seeds button)
      ...TREATS.slice(1).map((t, i) => ({ id: `treat:${i + 1}`, icon: t.icon, label: t.name.split(' ')[0], kind: 'drag' as const })),
      { id: 'water', icon: '💧', label: 'Water', kind: 'drag', disabled: s.bottle > 0.9 },
      { id: 'clean', icon: '🧹', label: 'Clean', kind: 'mode' },
      { id: 'lamp', icon: '💡', label: 'Lamp', kind: 'toggle', on: s.lamp },
    ];
  }

  useTool(id: string): void {
    if (id === 'lamp') this.model.s.lamp = !this.model.s.lamp;
    else this.tool = id;
  }


  /** Close enough to the hamster to hand it something, rather than dropping it on the floor. */
  private onHamster(x: number, y: number): boolean {
    const m = this.model, s = m.s;
    return m.hit(x, y) || (!m.underground() && Math.abs(x - s.x) < 30 && y > s.y - 44 && y < GROUND + 4);
  }

  private nearBowl(x: number, y: number): boolean {
    return Math.abs(x - SPOT.bowl) < 18 && y > GROUND - 30 && y < GROUND + 10;
  }

  drop(id: string, at: { x: number; y: number } | null): void {
    const m = this.model, s = m.s;
    const toast = (text: string) => this.events.push({ type: 'toast', text });
    const tooMany = () => toast('There are enough treats in the cage already.');
    if (id === 'water') {
      if (!m.refill()) toast('The bottle is full.');
      return;
    }
    // seeds fill the bowl, unless they are put somewhere else: then it is a single sunflower seed
    if (id === 'seeds' && (!at || this.nearBowl(at.x, at.y))) {
      if (!m.fillBowl()) toast('The bowl is full.');
      return;
    }
    const kind = id === 'seeds' ? 0 : Number(id.split(':')[1]);
    if (!(kind >= 0 && kind < TREATS.length)) return;
    // tapped: offer it to the hamster if it is up and about, otherwise drop it near it
    const x = at ? at.x : s.x + (s.facing || 1) * 12;
    if (!at ? !m.underground() && !m.asleep() : this.onHamster(at.x, at.y)) {
      if (m.offerTreat(x, kind) === 'full') tooMany();
    } else if (kind === SWEETS) m.offerTreat(x, kind);
    else if (!m.dropTreat(x, kind)) tooMany();
  }

  dropHint(id: string, x: number, y: number): DropHint {
    const s = this.model.s;
    if (id === 'water') return { x: BOTTLE.x, y: BOTTLE.bottom - 10, ok: true };
    if (id === 'seeds' && this.nearBowl(x, y)) return { x: SPOT.bowl, y: GROUND - 3, ok: true };
    if (this.onHamster(x, y)) return { x: s.x, y: s.y - 6, ok: true };
    // dropped treats land on the bedding, away from the wheel
    return { x: clamp(Math.round(x), CAGE.left + 14, SPOT.wheel - 40), y: GROUND - 1, ok: true };
  }

  stats(): Stat[] {
    const m = this.model, s = m.s;
    return [
      { icon: '🌾', label: 'Tummy', value: s.fullness },
      { icon: '💧', label: 'Water', value: s.bottle * 100 },
      { icon: '🧹', label: 'Clean', value: m.cleanliness() },
      { icon: '💛', label: 'Trust', value: s.trust },
      { icon: '🕳️', label: 'Burrow', value: `${Math.round(m.burrow() * 100)}%` },
    ];
  }

  status(_env: Env): Status {
    const m = this.model, s = m.s;
    if (m.asleep()) return { text: 'Sleeping', tone: 'sleep' };
    if (m.hungry()) return { text: 'Hungry!', tone: 'warn' };
    if (s.bottle < 0.05) return { text: 'Needs water', tone: 'warn' };
    if (m.cleanliness() < 45) return { text: 'Needs a clean', tone: 'warn' };
    if (s.state === 'wheel') return { text: 'Running!', tone: 'good' };
    if (s.cheeks > 0) return { text: 'Cheeks full!', tone: 'good' };
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

  /**
   * Everything that stays put: the room seen through the back glass (with a window that follows
   * the real sky), the deep bedding with the burrow carved into it, the house, the chew block and
   * the wheel stand.
   */
  private buildBackground(sky: Sky): void {
    const sf = this.bg;
    const s = this.model.s;
    // wallpaper with a little sprig pattern; darker under the lid and where the bedding meets the back glass
    for (let y = 0; y < VIEW_H; y++)
      for (let x = 0; x < VIEW_W; x++) {
        let t = 0.12 + y / 300 + Math.abs(x - 160) / 900;
        t += Math.max(0, (24 - y) / 14) * 0.4 + Math.max(0, 1 - (GROUND - y) / 16) * 0.5;
        let c = dither(WALL, t, x, y);
        const row = Math.floor(y / 14), sx = x + (row % 2) * 9;
        const px = sx % 18, py = y % 14;
        if ((px === 8 && py >= 5 && py <= 8) || (py === 6 && (px === 7 || px === 9))) c = mix(c, 0xb8a47e, 0.4);
        sf.px(x, y, c);
      }
    this.drawWindow(sf, sky);

    // bedding: strips of paper running sideways, packed denser further down
    for (let x = CAGE.left; x < CAGE.right; x++)
      for (let y = GROUND; y < CAGE.bottom; y++) {
        const depth = (y - GROUND) / (CAGE.bottom - GROUND);
        const strip = hash2((x + Math.floor(hash2(0, y, 410) * 9)) >> 2, y, 411);
        let c = dither(BEDDING, 0.15 + depth * 0.6 + (hash2(x, y, 400) - 0.5) * 0.3, x, y);
        if (strip > 0.86) c = mix(c, BEDDING[0], 0.75);
        else if (strip < 0.1) c = mix(c, BEDDING[3], 0.55);
        sf.px(x, y, c);
      }
    // strands of hay mixed through it
    for (let i = 0; i < 80; i++) {
      const x0 = CAGE.left + hash2(i, 1, 413) * (CAGE.right - CAGE.left), y0 = GROUND + 3 + hash2(i, 2, 413) * (CAGE.bottom - GROUND - 6);
      const a = (hash2(i, 3, 413) - 0.5) * 1.3, len = 5 + hash2(i, 4, 413) * 9;
      const c = HAY[Math.floor(hash2(i, 5, 413) * HAY.length)];
      for (let k = 0; k < len; k++) {
        const x = Math.round(x0 + Math.cos(a) * k), y = Math.round(y0 + Math.sin(a) * k);
        if (x >= CAGE.left && x < CAGE.right && y >= GROUND && y < CAGE.bottom) sf.px(x, y, c);
      }
    }

    // the burrow: ragged holes in the bedding, shadowed under the roof, with loose bedding on the floor
    const hole = new Uint8Array(VIEW_W * VIEW_H);
    const carve = (cx: number, cy: number, rx: number, ry: number) => {
      for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
        for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
          if (y < GROUND || x < 0 || y < 0 || x >= VIEW_W || y >= VIEW_H) continue;
          if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 + (hash2(x, y, 412) - 0.5) * 0.35) hole[y * VIEW_W + x] = 1;
        }
    };
    const line = (pts: Pt[]) => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
        for (let k = 0; k <= n; k++) carve(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n - 9, 10, 9.5);
      }
    };
    line(polyPrefix(TUNNELS.entrance, s.dug[0]));
    line(polyPrefix(TUNNELS.nest, tunnelOpen(1, s.dug[1])));
    if (s.dug[1] > 0.4) {
      const f = clamp((s.dug[1] - 0.4) / 0.6, 0.3, 1);
      carve(NEST.x, NEST.y - NEST.ry * f, NEST.rx * f, NEST.ry * f + 1);
    }
    if (s.dug[2] > 0) line(polyPrefix(TUNNELS.store, s.dug[2]));
    if (s.dug[2] > 0.7) {
      const f = clamp((s.dug[2] - 0.7) / 0.3, 0.3, 1);
      carve(STORE.x, STORE.y - STORE.ry * f, STORE.rx * f, STORE.ry * f + 1);
    }
    if (s.dug[3] > 0) line(polyPrefix(TUNNELS.exit, s.dug[3]));
    const isHole = (x: number, y: number) => x >= 0 && y >= 0 && x < VIEW_W && y < VIEW_H && hole[y * VIEW_W + x] === 1;
    const near = (x: number, y: number, r: number) => isHole(x, y - r) || isHole(x, y + r) || isHole(x - r, y) || isHole(x + r, y);
    for (let y = GROUND; y < CAGE.bottom; y++)
      for (let x = CAGE.left; x < CAGE.right; x++) {
        if (!isHole(x, y)) {
          // packed walls: darker right at the edge, fading into the loose bedding
          if (near(x, y, 1)) sf.blend(x, y, TUNNEL[3], 0.5);
          else if (near(x, y, 2)) sf.blend(x, y, TUNNEL[2], 0.2);
          continue;
        }
        let up = 0;
        while (up < 18 && isHole(x, y - up - 1)) up++;
        let down = 0;
        while (down < 18 && isHole(x, y + down + 1)) down++;
        // dark under the roof, warmer and lighter toward the floor, with loose bedding lying on it
        const t = clamp((down / (up + down + 1)) * 1.1, 0, 1);
        let c = dither(TUNNEL, t, x, y);
        if (down < 2 || (down === 2 && hash2(x, 0, 409) > 0.5)) c = hash2(x, y, 407) > 0.4 ? BEDDING[2] : BEDDING[1];
        else if (down === 2) c = mix(c, BEDDING[3], 0.5);
        if (hash2(x, y, 408) > 0.97) c = mix(c, HAY[1], 0.5);
        sf.px(x, y, c);
      }
    // soft bedding in the nest
    if (s.dug[1] > 0.4)
      for (let x = NEST.x - 18; x <= NEST.x + 18; x++) {
        const h = Math.round(4 * Math.sqrt(Math.max(0, 1 - ((x - NEST.x) / 19) ** 2)) + hash2(x, 0, 403) * 2);
        for (let k = 0; k < h; k++) sf.px(x, NEST.y + 1 - k, hash2(x, k, 404) > 0.5 ? 0xfff6e2 : 0xeadcc0);
      }

    // a lumpy surface, with kicked-out bedding piled either side of the burrow mouth
    for (let x = CAGE.left; x < CAGE.right; x++) {
      const mouth = Math.abs(x - SPOT.entrance);
      let h = Math.round(0.8 + Math.sin(x * 0.23) * 0.7 + Math.sin(x * 0.071 + 2) * 0.8 + hash2(x, 0, 414) * 0.9);
      if (mouth < 20) h = mouth < 9 ? 0 : Math.round(4 * Math.sin(((mouth - 9) / 11) * Math.PI) + hash2(x, 1, 414));
      for (let k = 1; k <= h; k++) sf.px(x, GROUND - k, k === h ? 0xfffaf0 : hash2(x, k, 415) > 0.5 ? BEDDING[0] : BEDDING[1]);
    }
    // tufts of hay on top
    for (const tx of [64, 236, 303])
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + (i - 4) * 0.28 + (hash2(tx, i, 416) - 0.5) * 0.3, len = 4 + hash2(tx, i, 417) * 5;
        for (let k = 0; k < len; k++) sf.px(Math.round(tx + (i - 4) * 0.8 + Math.cos(a) * k), Math.round(GROUND + Math.sin(a) * k), HAY[(i + k) % 3]);
      }

    // a little wooden house
    const hx = SPOT.house;
    groundShadow(sf, hx + 2, GROUND, 22);
    for (let y = GROUND - 22; y < GROUND; y++)
      for (let x = hx - 17; x <= hx + 17; x++) {
        const door = Math.abs(x - hx) < 6 && y > GROUND - 13 && (y > GROUND - 9 || (x - hx) ** 2 + (y - (GROUND - 9)) ** 2 < 36);
        const plank = (x - hx + 17) % 6 === 0;
        let c = dither(WOOD, 0.22 + (x > hx + 11 ? 0.32 : 0) + (plank ? 0.3 : 0) + hash2(x, y >> 2, 418) * 0.12, x, y);
        if (door) c = y < GROUND - 12 ? 0x3a2818 : 0x24180e;
        else if (Math.abs(x - hx) === 6 && y > GROUND - 10) c = WOOD[3];
        if (x === hx - 17 || x === hx + 17) c = WOOD[3];
        sf.px(x, y, c);
      }
    for (let y = GROUND - 22; y < GROUND - 19; y++) for (let x = hx - 17; x <= hx + 17; x++) sf.blend(x, y, 0x000000, 0.25);
    sf.disc(hx + 12, GROUND - 14, 2.6, 2.6, WOOD[3]);
    sf.disc(hx + 12, GROUND - 14, 1.6, 1.6, 0x2a1c12);
    // a shingled roof with a little overhang
    for (let k = 0; k < 15; k++)
      for (let x = hx - 21 + k; x <= hx + 21 - k; x++) {
        const edge = x === hx - 21 + k || x === hx + 21 - k;
        const row = Math.floor(k / 3);
        let c = x < hx ? 0xd0604e : 0xb04c3c;
        if (k % 3 === 0) c = 0x8a3a2a;
        else if ((x + (row % 2) * 3) % 6 === 0) c = 0x9a4232;
        sf.px(x, GROUND - 22 - k, edge ? 0x7a3224 : c);
      }
    // a wooden chew block
    groundShadow(sf, SPOT.chew, GROUND, 9);
    for (let y = GROUND - 11; y < GROUND; y++)
      for (let x = SPOT.chew - 6; x <= SPOT.chew + 6; x++) sf.px(x, y, dither(WOOD, y < GROUND - 9 ? 0.05 : x > SPOT.chew + 3 ? 0.6 : 0.3, x, y));
    sf.px(SPOT.chew + 6, GROUND - 7, 0xfff0d0);
    sf.px(SPOT.chew + 6, GROUND - 6, 0xf0d8a8);
    // the wheel stand: two legs down to a base
    groundShadow(sf, WHEEL.x, GROUND, 20, 0.3);
    for (const side of [-1, 1])
      for (let y = WHEEL.y; y < GROUND - 1; y++) {
        const x = Math.round(WHEEL.x + (side * (y - WHEEL.y) * 15) / (GROUND - WHEEL.y));
        sf.px(x, y, 0xa4a4ae);
        sf.px(x + 1, y, 0x6a6a74);
      }
    for (let x = WHEEL.x - 18; x <= WHEEL.x + 19; x++) {
      sf.px(x, GROUND - 2, 0x9a9aa4);
      sf.px(x, GROUND - 1, 0x5a5a64);
    }
  }

  /** A window on the wall behind the tank, showing the real sky, with curtains and a plant on the sill. */
  private drawWindow(sf: Surface, sky: Sky): void {
    const W = WINDOW;
    for (let x = W.x0 - 12; x <= W.x1 + 12; x++) {
      sf.px(x, W.y0 - 5, 0x9a7a54);
      sf.px(x, W.y0 - 4, 0x6a4e34);
    }
    const [top, bot] = sky === 'day' ? [0x84c4ec, 0xd4ecf8] : sky === 'dusk' ? [0x7a7ab8, 0xf4b088] : [0x141c3c, 0x2a3462];
    const midX = (W.x0 + W.x1) >> 1, midY = (W.y0 + W.y1) >> 1;
    for (let y = W.y0; y <= W.y1; y++)
      for (let x = W.x0; x <= W.x1; x++) {
        const frame = x - W.x0 < 3 || W.x1 - x < 3 || y - W.y0 < 3 || W.y1 - y < 3 || Math.abs(x - midX) <= 1 || Math.abs(y - midY) <= 1;
        if (frame) {
          sf.px(x, y, x === W.x0 || y === W.y0 ? 0xfffaf0 : x === W.x1 || y === W.y1 ? 0xc8beb0 : 0xf0e8dc);
          continue;
        }
        let c = mix(top, bot, (y - W.y0) / (W.y1 - W.y0));
        if (sky === 'day') {
          const cloud = ((x - 112) / 9) ** 2 + ((y - 30) / 3.5) ** 2 < 1 || ((x - 118) / 6) ** 2 + ((y - 27) / 3) ** 2 < 1 || ((x - 135) / 7) ** 2 + ((y - 47) / 2.5) ** 2 < 1;
          if (cloud) c = mix(c, 0xffffff, y < 29 || y < 46 && y > 44 ? 0.95 : 0.8);
        } else if (sky === 'dusk') {
          if ((x - 112) ** 2 + (y - 57) ** 2 < 40) c = 0xffd890;
        } else {
          if (hash2(x, y, 420) > 0.985) c = 0xfff8d8;
          const mx = x - 135, my = y - 29;
          if (mx * mx + my * my < 20) c = (mx + 2) ** 2 + my * my < 14 ? c : 0xfff4d0;
        }
        sf.px(x, y, mix(c, WALL[0], 0.12));
      }
    // a soft glass glint across the panes
    for (let k = 0; k < 8; k++) sf.blend(W.x0 + 5 + k, W.y0 + 14 - k, 0xffffff, 0.3);
    // the sill and a little potted plant
    for (let x = W.x0 - 4; x <= W.x1 + 4; x++) {
      sf.px(x, W.y1 + 1, 0xfffaf0);
      sf.px(x, W.y1 + 2, 0xe8e0d4);
      sf.px(x, W.y1 + 3, 0xb8ae9e);
    }
    for (let y = W.y1 - 6; y <= W.y1; y++)
      for (let x = 104 - (W.y1 - y) * 0.3; x <= 112 + (W.y1 - y) * 0.3; x++) sf.px(Math.round(x), y, y === W.y1 - 6 ? 0xd88a60 : x > 109 ? 0xa85a3a : 0xc8704a);
    for (const [cx, cy, rx, ry] of [[104, W.y1 - 9, 3, 2], [113, W.y1 - 10, 3, 2], [108, W.y1 - 12, 2.5, 3.5], [110, W.y1 - 8, 2.5, 1.5]]) {
      sf.disc(cx, cy, rx, ry, 0x4a8a3e);
      sf.disc(cx - 0.6, cy - 0.6, rx - 1, ry - 1, 0x74b45a);
    }
    // curtains, gathered at the sides
    for (const side of [-1, 1]) {
      const xa = side < 0 ? W.x0 - 11 : W.x1 + 2;
      for (let y = W.y0 - 3; y <= W.y1 + 8; y++) {
        const pinch = y > W.y1 - 14 && y < W.y1 - 8 ? 3 : 0;
        for (let i = 0; i < 10 - pinch; i++) {
          const x = side < 0 ? xa + i : xa + pinch + i;
          const fold = Math.sin(i * 1.4 + y * 0.04);
          let c = dither(CURTAIN, 0.45 - fold * 0.4 + (y - W.y0) / 220, x, y);
          if (y === W.y1 + 8) c = CURTAIN[2];
          sf.px(x, y, c);
        }
      }
    }
  }

  private drawWheel(sf: Surface): void {
    const a0 = this.model.wheel, R = WHEEL.r;
    for (let y = WHEEL.y - R - 2; y <= WHEEL.y + R + 2; y++)
      for (let x = WHEEL.x - R - 2; x <= WHEEL.x + R + 2; x++) {
        const dx = x - WHEEL.x, dy = y - WHEEL.y;
        const d = Math.hypot(dx, dy);
        if (d > R + 1.5) continue;
        const ang = Math.atan2(dy, dx);
        if (d > R + 0.5) sf.px(x, y, 0x2a5e94);
        else if (d > R - 0.5) sf.px(x, y, ang < -1.3 && ang > -2.9 ? 0xc8ecff : 0x4a94d0);
        else if (d > R - 1.5) sf.px(x, y, 0x3a7ab8);
        else {
          // the see-through back of the wheel, with spokes that turn as it spins
          const u = ((((ang - a0) / (Math.PI * 2)) * 6) % 1 + 1) % 1;
          const spoke = Math.min(u, 1 - u) * ((Math.PI * 2) / 6) * d;
          if (d > 4 && d < R - 3 && spoke < 0.7) sf.blend(x, y, 0x2a6aa8, 0.5);
          else if (Math.abs(d - R * 0.62) < 0.5) sf.blend(x, y, 0x2a6aa8, 0.3);
          else sf.blend(x, y, 0xb4def6, 0.22);
        }
      }
    // the running surface: rungs that move as it spins
    for (let k = 0; k < 30; k++) {
      const a = a0 + (k / 30) * Math.PI * 2;
      sf.px(Math.round(WHEEL.x + Math.cos(a) * (R - 2.5)), Math.round(WHEEL.y + Math.sin(a) * (R - 2.5)), 0x1e4a78);
    }
    sf.disc(WHEEL.x, WHEEL.y, 3, 3, 0x8a8a94);
    sf.disc(WHEEL.x - 0.7, WHEEL.y - 0.7, 1.5, 1.5, 0xd4d4dc);
  }

  private drawBottle(sf: Surface, level: number, time: number): void {
    const { x, top, bottom, spout } = BOTTLE;
    // hung from the lid on a wire
    for (let y = CAGE.top; y < top - 1; y++) {
      sf.px(x - 3, y, 0xa4a4ae);
      sf.px(x + 3, y, 0x7a7a84);
    }
    const waterTop = bottom - Math.round((bottom - top - 4) * level);
    for (let y = top - 2; y <= bottom; y++) {
      const r = y < top + 1 ? 5 - (top + 1 - y) * 1.5 : 5;
      for (let dx = -5; dx <= 5; dx++) {
        const ad = Math.abs(dx);
        if (ad > r) continue;
        if (ad >= r - 0.5) sf.blend(x + dx, y, dx < 0 ? 0xffffff : 0x6a9ab8, 0.75);
        else if (y >= waterTop) sf.px(x + dx, y, dx === -3 ? 0xe4f6ff : dx < -1 ? 0xb4e2f6 : dx > 2 ? 0x6ab4dc : 0x8ccbea);
        else sf.blend(x + dx, y, 0xdff2fa, dx === -3 ? 0.6 : 0.25);
      }
    }
    if (level > 0.02 && waterTop > top) for (let dx = -4; dx <= 4; dx++) sf.px(x + dx, waterTop, 0xd8f2ff);
    for (let dx = -6; dx <= 6; dx++) {
      sf.px(x + dx, top + 14, 0xa4a4ae);
      sf.px(x + dx, top + 15, 0x5a5a64);
    }
    for (let y = bottom + 1; y <= bottom + 5; y++) for (let dx = -4; dx <= 4; dx++) sf.px(x + dx, y, dx < -2 ? 0x7ab8e8 : dx > 2 ? 0x2a6aa8 : 0x4a90c8);
    // the metal spout angling down to the hamster, with a ball at the tip
    for (let k = 0; k < 14; k++) {
      const px = Math.round(x - k * 0.5), py = bottom + 5 + Math.round(k * 0.9);
      sf.px(px, py, 0xc8c8d0);
      sf.px(px + 1, py, 0x8a8a92);
    }
    sf.px(spout.x, spout.y, 0xf0f0f6);
    sf.px(spout.x + 1, spout.y, 0xa4a4ae);
    // now and then a drip forms
    const dp = (time * 0.2) % 1;
    if (level > 0.05 && dp > 0.85) sf.px(spout.x, spout.y + 1 + Math.round((dp - 0.85) * 12), 0xbfe6f8);
  }

  /** The tube never moves, so its see-through pixels are worked out once. */
  private tubePx: { x: number; y: number; c: number; a: number }[] | null = null;
  private tubePixels(): { x: number; y: number; c: number; a: number }[] {
    if (this.tubePx) return this.tubePx;
    const pts = tubePath();
    const cl: { x: number; y: number; tx: number; ty: number; s: number }[] = [];
    let arc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const tx = (b.x - a.x) / len, ty = (b.y - a.y) / len;
      for (let k = 0; k < len; k += 0.5) cl.push({ x: a.x + tx * k, y: a.y + ty * k - 6.5, tx, ty, s: arc + k });
      arc += len;
    }
    const out: { x: number; y: number; c: number; a: number }[] = [];
    const R = 7.5;
    for (let y = TUBE.peak - 16; y <= GROUND; y++)
      for (let x = TUBE.a - 10; x <= TUBE.b + 10; x++) {
        let best = Infinity, n = 0;
        for (let i = 0; i < cl.length; i++) {
          const d = (x - cl[i].x) ** 2 + (y - cl[i].y) ** 2;
          if (d < best) {
            best = d;
            n = i;
          }
        }
        if (best > (R + 0.5) ** 2) continue;
        const c0 = cl[n];
        const along = (x - c0.x) * c0.tx + (y - c0.y) * c0.ty;
        if ((n === 0 && along < -0.5) || (n === cl.length - 1 && along > 0.5)) continue;
        const off = (x - c0.x) * -c0.ty + (y - c0.y) * c0.tx; // across the tube, positive downward
        const ao = Math.abs(off);
        let c = 0x9ae8b8, a = 0.14;
        if (c0.s < 2.5 || c0.s > arc - 3) {
          c = ao > 6.5 ? 0x2e7a48 : off < -4 ? 0x8ae0a8 : 0x4aa86a;
          a = 0.95;
        } else if (ao > 6.5) {
          c = 0x2e8a50;
          a = 0.85;
        } else if (off < -4.5 && off > -6.2) {
          c = 0xffffff;
          a = 0.5;
        } else if (off > 4) {
          c = 0x2e8a50;
          a = 0.25;
        } else if (c0.s % 10 < 1) {
          c = 0x4aa86a;
          a = 0.3;
        }
        out.push({ x, y, c, a });
      }
    return (this.tubePx = out);
  }

  private drawFinger(sf: Surface, f: Pt): void {
    // a finger reaching in from the right
    const y0 = Math.round(f.y);
    for (let x = Math.round(f.x); x < VIEW_W; x++)
      for (let dy = -3; dy <= 3; dy++) {
        const tip = x - f.x;
        if (tip < 3 && dy * dy + (3 - tip) ** 2 > 12) continue;
        sf.px(x, y0 + dy, dy < -1 ? SKIN[0] : dy > 1 ? SKIN[2] : SKIN[1]);
      }
    for (let dy = -2; dy <= 0; dy++) sf.px(Math.round(f.x) + 2, y0 + dy, 0xfbe0d4); // nail
    for (let dy = -2; dy <= 0; dy++) sf.px(Math.round(f.x) + 3, y0 + dy, 0xfbe0d4);
  }

  private drawFood(sf: Surface, time: number): void {
    const m = this.model, s = m.s;
    // the bowl
    groundShadow(sf, SPOT.bowl, GROUND, 13, 0.3);
    for (let dx = -11; dx <= 11; dx++) {
      const d = Math.round(5 * Math.sqrt(1 - (dx / 11) ** 2));
      for (let k = 0; k <= d; k++) {
        let c = k === 0 ? 0xffc8d4 : dither([0xec92a6, 0xd07088, 0xa85068], k / 6 + (dx > 6 ? 0.3 : 0), SPOT.bowl + dx, k);
        if (k === d && k > 0) c = 0x8a3a52;
        sf.px(SPOT.bowl + dx, GROUND - 6 + k, c);
      }
    }
    sf.px(SPOT.bowl - 7, GROUND - 4, 0xffe4ec);
    sf.px(SPOT.bowl - 6, GROUND - 4, 0xffe4ec);
    const seeds = Math.round(s.bowl * 2.2);
    for (let i = 0; i < seeds; i++) {
      const x = SPOT.bowl - 8 + ((i * 7) % 17), y = GROUND - 7 - ((i * 3) % 3) - (i > 9 ? 1 : 0);
      sf.px(x, y, i % 3 === 0 ? 0x5a4630 : i % 3 === 1 ? 0xe8c878 : 0xc89a50);
    }
    // the hoard
    const hp = m.placePt(m.hoardPlace());
    // the hoard: a heap of seeds that grows as it fills
    const cx = hp.x + (m.hoardPlace() === 'nest' ? 14 : 2);
    const hw = 3 + Math.round(Math.min(1, s.hoard / HAM.hoardMax) * 9), hh = 1 + Math.round(Math.min(1, s.hoard / HAM.hoardMax) * 6);
    if (s.hoard >= 0.5)
      for (let dx = -hw; dx <= hw; dx++) {
        const h = Math.round(hh * Math.sqrt(Math.max(0, 1 - (dx / (hw + 0.5)) ** 2)));
        for (let k = 0; k < h; k++) {
          const r = hash2(cx + dx, k, 409);
          sf.px(cx + dx, hp.y - 1 - k, r < 0.3 ? 0x5a4630 : r < 0.6 ? 0xe8c878 : r < 0.85 ? 0xc89a50 : 0xf4e4b0);
        }
      }
    // treats on the bedding
    for (const t of s.treats) {
      const c = t.age > HAM.treatSpoil ? 0x7a6a50 : TREATS[t.kind].color;
      const x = t.x, y = GROUND - 1;
      if (t.kind === 0) {
        sf.px(x, y, c);
        sf.px(x + 1, y, c);
        sf.px(x, y - 1, 0xe8e0d0);
        sf.px(x + 1, y - 1, c);
      } else if (t.kind === 1) {
        for (let k = 0; k < 5; k++) sf.px(x + k, y, k === 4 ? 0x4a9a3a : c);
        sf.px(x + 1, y - 1, c);
      } else if (t.kind === 2) {
        for (let dy = -2; dy <= 0; dy++) for (let dx = -1; dx <= 1; dx++) sf.px(x + dx, y + dy, dy === -2 && dx === 0 ? 0xfff0d8 : c);
      } else {
        sf.px(x - 1, y - 1, 0xffd0f0);
        sf.px(x, y - 1, c);
        sf.px(x + 1, y - 1, c);
        sf.px(x + 2, y - 1, 0xffd0f0);
        if (Math.sin(time * 4) > 0.6) sf.px(x, y - 2, 0xffffff);
      }
    }
    for (const d of s.droppings) {
      sf.px(d, GROUND - 1, 0x4a3420);
      sf.px(d + 1, GROUND - 1, 0x3a2818);
    }
  }

  render(sf: Surface, time: number, env: Env): void {
    const m = this.model, s = m.s;
    const sky = skyAt(env.hour);
    const key = s.dug.map((d) => d.toFixed(3)).join(',') + sky;
    if (!this.bgReady || key !== this.soilKey) {
      this.bgReady = true;
      this.soilKey = key;
      this.buildBackground(sky);
    }
    sf.copyFrom(this.bg);

    // the sand bath, once it is unlocked: sand heaped in a little dish
    if (m.can('bath')) {
      groundShadow(sf, SPOT.bath, GROUND, 16, 0.3);
      for (let dx = -12; dx <= 12; dx++) {
        const h = Math.round(3 * Math.sqrt(1 - (dx / 12.5) ** 2));
        for (let k = 0; k < h; k++) sf.px(SPOT.bath + dx, GROUND - 5 - k, k === h - 1 ? 0xf8ecc8 : hash2(dx, k, 417) > 0.5 ? 0xead6a4 : 0xdcc490);
      }
      for (let dx = -14; dx <= 14; dx++) {
        const d = Math.round(4 * Math.sqrt(1 - (dx / 14.5) ** 2));
        for (let k = 0; k <= d; k++)
          sf.px(SPOT.bath + dx, GROUND - 5 + k, k === 0 ? 0xe4defa : k === d ? 0x6a62a0 : dither([0xc4bce8, 0xa49cd0, 0x8078b4], k / 5 + (dx > 8 ? 0.3 : 0), SPOT.bath + dx, k));
      }
    }
    this.drawFood(sf, time);
    this.drawWheel(sf);
    this.drawBottle(sf, s.bottle, time);

    // the hamster
    const pose = this.pose(time);
    if (s.state === 'climb' && m.finger) this.drawFinger(sf, m.finger);
    if (pose) drawHamster(sf, pose);
    if (s.state === 'hide') {
      // eyes glinting in the doorway
      if (Math.sin(time * 1.3) > -0.6) {
        sf.px(SPOT.house - 2, GROUND - 7, 0x140c08);
        sf.px(SPOT.house + 2, GROUND - 7, 0x140c08);
        sf.px(SPOT.house - 2, GROUND - 8, 0xffffff);
        sf.px(SPOT.house + 2, GROUND - 8, 0xffffff);
      }
    }
    if (s.state === 'sleep' && s.where === 'nest' && !m.can('sleepInView')) {
      // tucked under the bedding, just its back and an ear showing
      for (let x = NEST.x - 18; x <= NEST.x + 20; x++) {
        const h = Math.round(7 * Math.sqrt(Math.max(0, 1 - ((x - NEST.x - 1) / 20) ** 2)) + hash2(x, 1, 405) * 2);
        for (let k = 0; k < h; k++) sf.px(x, NEST.y - k, hash2(x, k, 406) > 0.5 ? 0xfff6e2 : 0xeadcc0);
      }
    }
    // the tube goes over the hamster so it can be seen inside
    if (m.can('tube')) for (const p of this.tubePixels()) sf.blend(p.x, p.y, p.c, p.a);
    if (this.holding && m.finger && s.state !== 'climb') this.drawFinger(sf, m.finger);
    this.particles.render(sf);

    if (s.lamp)
      for (let y = CAGE.top; y < 130; y++)
        for (let x = CAGE.left; x < 190; x++) {
          const d = Math.hypot(x - LAMP.x, (y - LAMP.y) * 1.1) / 150;
          if (d < 1) sf.add(x, y, 0xffd890, 0.26 * (1 - d) ** 1.5);
        }
    if (m.dark(env)) sf.multiply(0.42, 0.48, 0.72);
    drawGlassTank(sf, CAGE.left, CAGE.right, CAGE.top);
    drawDomeLamp(sf, LAMP.x, LAMP.y, s.lamp, [0x6aaa96, 0x4a8a78, 0x2e6a5a], 0x1e4a3e);
  }

  /** How the hamster looks right now, or null when it is hidden. */
  private pose(time: number) {
    const m = this.model, s = m.s;
    if (s.state === 'hide') return null;
    let pose: HamPoseName = 'sit';
    let x = s.x, y = s.y, face = s.facing;
    let holding = 0;
    let cheeks = s.cheeks / 3;
    let phase = time * 2.5;
    switch (s.state) {
      case 'walk':
      case 'tube':
        pose = 'walk';
        phase = time * 3.2;
        break;
      case 'sniff':
      case 'refuse':
        pose = 'sniff';
        break;
      case 'stuff':
        pose = 'eat';
        holding = 0xc89a50;
        break;
      case 'hoard':
        pose = 'dig';
        cheeks = (s.cheeks / 3) * clamp(s.timer / 2, 0, 1);
        phase = time * 2;
        break;
      case 'eat':
        pose = 'eat';
        holding = m.held || 0xc89a50;
        phase = time;
        break;
      case 'chew':
        pose = 'eat';
        phase = time;
        break;
      case 'drink':
        pose = 'sit';
        face = 1;
        break;
      case 'groom':
        pose = 'groom';
        phase = time * 0.8;
        break;
      case 'bath':
        pose = 'curl';
        face = Math.sin(time * 6) > 0 ? 1 : -1;
        x += Math.sin(time * 9) * 1.5;
        break;
      case 'dig':
        pose = 'dig';
        phase = time * 2;
        break;
      case 'sleep':
        pose = 'curl';
        break;
      case 'wheel':
        pose = 'run';
        x = WHEEL.x;
        y = WHEEL.y + WHEEL.r - 2;
        face = 1;
        phase = time * 5;
        break;
      case 'climb':
        if (m.finger) {
          pose = 'sit';
          x = m.finger.x + 10;
          y = m.finger.y - 3;
          face = -1;
        }
        break;
      case 'wake':
        pose = 'sit';
        break;
      default:
        pose = Math.sin(time * 0.4 + s.x) > -0.3 ? 'sit' : 'sniff';
    }
    const blink = s.state === 'wake' ? Math.sin(time * 3) > -0.3 : Math.sin(time * 1.1 + 2) > 0.985;
    const twitch = Math.sin(time * 14) * (Math.sin(time * 0.9) > 0.3 ? 1 : 0.2);
    return { x, y, face, pose, phase, cheeks, coat: s.coat, breath: 0.5 + 0.5 * Math.sin(time * (s.state === 'sleep' ? 1.6 : 3)), blink, twitch, holding };
  }
}
