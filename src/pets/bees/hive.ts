import { clamp, hash2 } from '../../core/rng';
import type { Env } from '../../core/time';
import { Particles } from '../../render/particles';
import { drawDomeLamp } from '../../render/glass';
import { dither, mix, Surface, VIEW_H, VIEW_W } from '../../render/surface';
import { DecorBox, DECORATE_TOOL, unlockText } from '../decor';
import type { DecorPicker, DropHint, Habitat, Stat, Status, Tool, UiEvent } from '../types';
import { drawBee, drawCell, drawFeeder, drawFlower, drawJar, drawQueen } from './art';
import { HIVE_DECOR, HIVE_DECOR_AREAS, hivePreviewBg } from './decor';
import { BEE, cellPos, DANCE_SPOT, ENTR, FEEDER, FLOWERS, GROUND, Hive, HIVE, newHiveState, SLOT_X, type Bee } from './model';

const GRASS = [0x6cc04a, 0x4ea03a, 0x388030, 0x286024];
const WOOD = [0xb88a58, 0x96693c, 0x6e4a28, 0x4a301a];
const INSIDE = [0x4a3220, 0x3a281a, 0x2a1c12];
const HIVE_W = 134;
const FENCE_WOOD = [0xdccaa6, 0xbca47e, 0x907a56, 0x64543a];
const FENCE = { x0: 150, y: 138 };
const BED = { x0: 154, x1: 315 };
type Sky = 'day' | 'dusk' | 'night';
const skyAt = (hour: number): Sky => (hour >= 20 || hour < 6 ? 'night' : hour >= 18 || hour < 7.5 ? 'dusk' : 'day');

export class HiveHabitat implements Habitat {
  readonly id = 'bees';
  tool = 'hand';
  model: Hive;
  private particles = new Particles();
  private bg = new Surface(VIEW_W, VIEW_H);
  private hiveBg = new Surface(HIVE_W, VIEW_H);
  private bgReady = false;
  private sky: Sky = 'day';
  private events: UiEvent[] = [];
  private said = new Set<string>();
  private told = false;

  private decorBox: DecorBox;

  constructor(saved: unknown, seed: number) {
    this.model = saved ? Hive.load(saved, seed) : new Hive(newHiveState(seed));
    // decorations are earned as the colony grows
    this.decorBox = new DecorBox({
      items: HIVE_DECOR, areas: HIVE_DECOR_AREAS, placed: () => this.model.s.decor, level: () => this.model.s.workers, previewBg: hivePreviewBg,
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
    return this.model.s.name || 'Your hive';
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
    if (!this.told && m.liveFlowers() <= 1 && m.s.workers < 12) {
      this.told = true;
      toast('Bees need flowers! Tap 🌻 then tap the garden to plant one.');
    }
    for (const fx of m.fx) {
      switch (fx.kind) {
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
        case 'plop':
          sound('plop');
          break;
        case 'no':
          this.particles.spawn('no', fx.x, fx.y);
          sound('no');
          break;
        case 'pop':
          this.particles.spawn('crumb', fx.x, fx.y, 0xffd060);
          break;
        case 'build':
          this.particles.spawn('crumb', fx.x, fx.y, 0xf6dc86);
          break;
        case 'emerge':
          this.particles.spawn('sparkle', fx.x, fx.y);
          break;
        case 'honey':
          this.particles.spawn('sparkle', fx.x, fx.y);
          once('honey', 'A cell of nectar turned into honey! The bees fanned it and sealed it with wax.');
          break;
        case 'stage':
          this.particles.spawn('heart', fx.x, fx.y);
          sound('hatch');
          toast(`${this.who()} grew into a ${m.stageName()} hive!`);
          break;
        case 'dance':
          sound('chirp');
          once('dance', 'A forager found lots of nectar and is doing the waggle dance! The others will follow.');
          break;
        case 'wilt':
          once('wilt', 'A flower wilted. Tap 🌻 and plant a fresh one so the bees keep their food.');
          break;
        case 'jar':
          for (let i = 0; i < 5; i++) this.particles.spawn('sparkle', fx.x + i * 4 - 8, fx.y);
          sound('hatch');
          toast('You took a jar of honey! 🍯');
          break;
        case 'buzz':
          sound('chirp');
          for (let i = 0; i < 4; i++) this.particles.spawn('dust', fx.x, fx.y, 0xf2b930);
          break;
        case 'first':
          once('first', 'A forager brought nectar home. Watch it go into a cell!');
          break;
        case 'visit': {
          const what = HIVE_DECOR.find((d) => d.id === fx.text);
          if (what) once(`visit:${what.id}`, `A bee stopped for a rest on the ${what.label.toLowerCase()}!`);
          break;
        }
      }
    }
    m.fx.length = 0;
    this.particles.update(dt, 0, GROUND);
  }

  coarseStep(dt: number, env: Env): void {
    this.model.coarseStep(dt, env);
  }

  beginCatchup(): () => string[] {
    const before = this.model.s.workers, stage = this.model.stage(), jars = this.model.s.jars;
    const honey = this.model.count('honey');
    return () => {
      const m = this.model;
      m.fx.length = 0;
      const out: string[] = [];
      const born = m.s.workers - before;
      if (born > 0) out.push(`${born} new bee${born === 1 ? '' : 's'} hatched`);
      if (m.stage() > stage) out.push(`the hive grew to ${m.stageName()}`);
      if (m.count('honey') > honey + 1) out.push('the bees made more honey');
      if (m.s.jars < jars) out.push('a jar went missing'); // cannot happen offline, kept so the list stays truthful
      if (m.liveFlowers() === 0) out.push('every flower wilted');
      else if (m.hungry()) out.push('the honey ran low');
      if (!out.length) out.push('the bees were busy');
      return out;
    };
  }

  // ---- input -------------------------------------------------------------

  pointer(kind: 'down' | 'move' | 'up', x: number, y: number): void {
    const m = this.model;
    if (this.tool === 'decorate' || this.decorBox.held) {
      if (!this.decorBox.pointer(kind, x, y) && kind === 'down') this.particles.spawn('ripple', x, y);
      return;
    }
    if (kind !== 'down') return;
    if (Math.hypot(x - ENTR.x, y - ENTR.y) < 16) m.buzzGuards();
    else if (x < HIVE.right) m.tapHive(x, y);
    else this.particles.spawn('ripple', x, y);
  }

  tools(): Tool[] {
    const m = this.model;
    const next = FLOWERS[m.s.nextKind % FLOWERS.length];
    return [
      { id: 'hand', icon: '✋', label: 'Touch', kind: 'mode' },
      { id: 'plant', icon: next.icon, label: next.name, kind: 'drag' },
      { id: 'water', icon: '🚿', label: 'Water', kind: 'drag' },
      { id: 'sugar', icon: '🧃', label: 'Sugar', kind: 'drag', disabled: m.s.feeder > BEE.maxFeeder - 1 },
      { id: 'harvest', icon: '🍯', label: 'Honey', kind: 'action' },
      DECORATE_TOOL,
      { id: 'lamp', icon: '💡', label: 'Lamp', kind: 'toggle', on: m.s.lamp },
    ];
  }

  useTool(id: string): void {
    const m = this.model;
    const toast = (text: string) => this.events.push({ type: 'toast', text });
    // anything still being dragged is set down first
    this.decorBox.pointer('up', 0, 0);
    switch (id) {
      case 'harvest':
        if (m.harvest()) break;
        toast('The bees need that honey for themselves. Wait until there is plenty!');
        break;
      case 'lamp':
        m.s.lamp = !m.s.lamp;
        break;
      default:
        this.tool = id;
    }
  }

  /** The flower bed slot nearest x. */
  private slotAt(x: number): number {
    let slot = 0;
    for (let i = 1; i < SLOT_X.length; i++) if (Math.abs(SLOT_X[i] - x) < Math.abs(SLOT_X[slot] - x)) slot = i;
    return slot;
  }

  drop(id: string, at: { x: number; y: number } | null): void {
    const m = this.model;
    const toast = (text: string) => this.events.push({ type: 'toast', text });
    if (id === 'plant') {
      if (at && at.x < HIVE.right + 6) {
        toast('Plant flowers out in the garden!');
        return;
      }
      // tapped: the first empty or wilted spot in the bed
      const free = SLOT_X.findIndex((_, i) => !m.alive(i));
      if (!at && free < 0) {
        toast('Every spot has a fresh flower. Wait until one wilts.');
        return;
      }
      if (m.plant(at ? at.x : SLOT_X[free]) === 'busy') toast('That flower is still fresh. Try an empty spot.');
    } else if (id === 'water') {
      if (!m.waterAll()) toast('There are no flowers to water yet.');
      else toast('Watered flowers make nectar faster and last longer.');
    } else if (id === 'sugar') {
      if (!m.fillFeeder()) toast('The feeder is full.');
      else toast('Sugar water helps on a bad day, but flowers are better.');
    }
  }

  dropHint(id: string, x: number, _y?: number): DropHint {
    if (id === 'sugar') return { x: FEEDER.x, y: GROUND - 10, ok: true };
    if (id === 'plant' && x < HIVE.right + 6) return { x, y: GROUND, ok: false };
    const slot = this.slotAt(x);
    // a new flower only goes in a spot that is empty or wilted; water reaches the whole bed
    return { x: SLOT_X[slot], y: GROUND - 1, ok: id !== 'plant' || !this.model.alive(slot) };
  }

  stats(): Stat[] {
    const m = this.model, s = m.s;
    return [
      { icon: '🐝', label: 'Bees', value: `${s.workers} (${m.stageName()})` },
      { icon: '🍯', label: 'Honey', value: clamp((m.count('honey') / (BEE.reserve * 2.5)) * 100, 0, 100) },
      { icon: '🥚', label: 'Young', value: `${m.brood()}` },
      { icon: '🌼', label: 'Flowers', value: `${m.liveFlowers()} of ${SLOT_X.length}` },
      { icon: '🫙', label: 'Jars', value: `${s.jars}` },
    ];
  }

  status(env: Env): Status {
    const m = this.model;
    if (m.dark(env)) return { text: 'Asleep', tone: 'sleep' };
    if (m.liveFlowers() === 0 && m.sources().length === 0) return { text: 'Needs flowers!', tone: 'warn' };
    if (m.hungry()) return { text: 'Low on honey', tone: 'warn' };
    if (m.dance) return { text: 'Waggle dance!', tone: 'good' };
    return { text: 'Buzzing', tone: 'good' };
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

  /** The garden (sky by the real clock, hills, a fence for the honey jars, a raised flower bed), then the observation hive. */
  private buildBackground(sky: Sky): void {
    const sf = this.bg;
    const [top, bot] = sky === 'day' ? [0x6cbcec, 0xdcf2fa] : sky === 'dusk' ? [0x6a74b4, 0xf8b884] : [0x0e1634, 0x2a3866];
    for (let y = 0; y < VIEW_H; y++)
      for (let x = 0; x < VIEW_W; x++) {
        let c = mix(top, bot, Math.min(1, y / (GROUND - 20)));
        if (sky === 'night' && hash2(x, y, 235) > 0.993 && y < 110) c = hash2(x, y, 236) > 0.5 ? 0xfff8d8 : 0xc8d4f0;
        sf.px(x, y, c);
      }
    if (sky === 'day') {
      for (let dy = -14; dy <= 14; dy++)
        for (let dx = -14; dx <= 14; dx++) {
          const d = Math.hypot(dx, dy);
          if (d < 8) sf.px(290 + dx, 26 + dy, d < 6 ? 0xfff6c0 : 0xffe680);
          else if (d < 14) sf.blend(290 + dx, 26 + dy, 0xfff6d0, 0.35 * (1 - (d - 8) / 6));
        }
      const puff = (cx: number, cy: number, rx: number, ry: number) => {
        for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
          for (let x = Math.floor(cx - rx); x <= cx + rx; x++)
            if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1) sf.px(x, y, y > cy + ry * 0.3 ? 0xe4eef6 : 0xffffff);
      };
      puff(196, 40, 16, 5);
      puff(206, 35, 9, 5);
      puff(188, 37, 7, 4);
      puff(262, 72, 11, 3.5);
      puff(268, 69, 6, 3);
    } else if (sky === 'dusk') {
      for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) if (dx * dx + dy * dy < 81) sf.px(250 + dx, 124 + dy, 0xffd890);
    } else {
      for (let dy = -6; dy <= 6; dy++)
        for (let dx = -6; dx <= 6; dx++) {
          if (dx * dx + dy * dy >= 36) continue;
          sf.px(290 + dx, 26 + dy, (dx + 3) ** 2 + dy * dy < 25 ? mix(top, bot, (26 + dy) / (GROUND - 20)) : 0xfff4d0);
        }
    }
    // distant hills with a few trees
    for (let x = 0; x < VIEW_W; x++) {
      const h = Math.round(GROUND - 30 + Math.sin(x * 0.02) * 8 + Math.sin(x * 0.07 + 2) * 3);
      for (let y = h; y < GROUND; y++) sf.px(x, y, dither([0xa8dca4, 0x86c48a, 0x68ac6e], (y - h) / 26, x, y));
    }
    for (const [tx, s] of [[178, 1], [236, 0.8], [246, 0.6], [300, 0.9]]) {
      const ty = Math.round(GROUND - 30 + Math.sin(tx * 0.02) * 8 + Math.sin(tx * 0.07 + 2) * 3);
      sf.rect(tx, ty - 3, 1, 4, 0x6a7a5a);
      for (let dy = -9 * s; dy <= 0; dy++)
        for (let dx = -6 * s; dx <= 6 * s; dx++)
          if ((dx / (6 * s)) ** 2 + ((dy + 4.5 * s) / (5 * s)) ** 2 < 1) sf.px(Math.round(tx + dx), Math.round(ty - 3 + dy), dx > 1 ? 0x5a9a5e : 0x78b47a);
    }
    // a weathered fence, its top rail a shelf for the honey jars
    for (let x = FENCE.x0; x < VIEW_W; x++) {
      const post = (x - FENCE.x0) % 30 < 3;
      for (let y = FENCE.y - (post ? 3 : 0); y < GROUND; y++) {
        const board = (x - FENCE.x0) % 7 < 4;
        if (!post && !board) continue;
        let t = 0.2 + ((x - FENCE.x0) % 7 === 3 ? 0.35 : 0) + (hash2(x, y >> 2, 237) - 0.5) * 0.2;
        if (post) t = (x - FENCE.x0) % 30 === 2 ? 0.75 : 0.45;
        sf.px(x, y, dither(FENCE_WOOD, clamp(t, 0, 1), x, y));
      }
      sf.px(x, FENCE.y + 11, FENCE_WOOD[1]);
      sf.px(x, FENCE.y + 12, FENCE_WOOD[2]);
      // the cap board along the top
      sf.px(x, FENCE.y, FENCE_WOOD[0]);
      sf.px(x, FENCE.y + 1, FENCE_WOOD[1]);
      sf.px(x, FENCE.y + 2, FENCE_WOOD[3]);
      sf.blend(x, FENCE.y + 3, 0x000000, 0.2);
    }
    // grass
    for (let x = 0; x < VIEW_W; x++)
      for (let y = GROUND; y < VIEW_H; y++) {
        const n = hash2(x, y, 230);
        let c = dither(GRASS, (y - GROUND) / 22 + n * 0.3, x, y);
        if (n > 0.985) c = 0xffffff; // clover
        sf.px(x, y, c);
      }
    for (let x = 0; x < VIEW_W; x += 2) {
      const h = 1 + Math.floor(hash2(x, 1, 231) * 4);
      for (let k = 0; k < h; k++) sf.px(x, GROUND - 1 - k, GRASS[(k + x) % 2]);
    }
    // the raised bed the flowers grow in
    for (let x = BED.x0; x <= BED.x1; x++) {
      for (let y = GROUND - 2; y <= GROUND; y++) sf.px(x, y, dither([0x6a4a2c, 0x4e3420, 0x3a2616], (y - GROUND + 2) / 3 + hash2(x, y, 238) * 0.4, x, y));
      for (let y = GROUND + 1; y <= GROUND + 7; y++) {
        const plank = y === GROUND + 4;
        let t = (y - GROUND - 1) / 8 + (plank ? 0.4 : 0) + (hash2(x >> 2, y, 239) - 0.5) * 0.15;
        if (y === GROUND + 1) t = 0;
        sf.px(x, y, dither(WOOD, clamp(t, 0, 1), x, y));
      }
      sf.blend(x, GROUND + 8, 0x000000, 0.25);
    }
    for (const x of [BED.x0, BED.x1]) for (let y = GROUND - 3; y <= GROUND + 7; y++) sf.px(x, y, WOOD[2]);
    // the landing board outside the entrance, and a shadow from the hive
    for (let y = GROUND - 1; y < GROUND + 10; y++) for (let x = HIVE.right + 5; x < HIVE.right + 11; x++) sf.blend(x, y, 0x000000, 0.18 * (1 - (x - HIVE.right - 5) / 6));
    sf.rect(HIVE.right, GROUND - 1, 24, 2, WOOD[1]);
    sf.rect(HIVE.right, GROUND - 1, 24, 1, WOOD[0]);
    for (let x = HIVE.right; x < HIVE.right + 24; x++) sf.blend(x, GROUND + 1, 0x000000, 0.3);

    // the hive: a wooden frame with bevelled edges, a top bar for the comb, screws and a brass plate
    const h = this.hiveBg;
    const F = 5;
    for (let y = 0; y < VIEW_H; y++)
      for (let x = 0; x < HIVE_W; x++) {
        const inside = x >= HIVE.left && x < HIVE.right && y >= HIVE.top && y < HIVE.bottom;
        if (inside) {
          h.px(x, y, dither(INSIDE, 0.4 + ((x - 60) ** 2 + (y - 90) ** 2) / 14000 + hash2(x, y, 232) * 0.15, x, y));
          continue;
        }
        if (!(x < HIVE.right + F && y < HIVE.bottom + F && x >= HIVE.left - F && y >= HIVE.top - F)) {
          h.px(x, y, 0);
          continue;
        }
        const ox = Math.min(x - (HIVE.left - F), HIVE.right + F - 1 - x), oy = Math.min(y - (HIVE.top - F), HIVE.bottom + F - 1 - y);
        const edge = Math.min(ox, oy);
        const horiz = oy < ox; // top and bottom rails run sideways, sides run down
        const grain = hash2(horiz ? x >> 3 : x, horiz ? y : y >> 3, 233) > 0.7 ? 0.18 : 0;
        let t = 0.22 + grain + (hash2(x, y, 234) - 0.5) * 0.15;
        // bevel: light on the outer top-left, dark on the inner lip and the bottom-right
        if (edge === 0) t = 0.95;
        else if (edge === 1) t -= x < HIVE.left || y < HIVE.top ? 0.25 : -0.15;
        else if (edge === F - 1) t += 0.35;
        // mitred corners
        if (Math.abs(ox - oy) === 0 && edge < F) t += 0.3;
        h.px(x, y, dither(WOOD, clamp(t, 0, 1), x, y));
      }
    for (const [sx, sy] of [[HIVE.left - 3, HIVE.top - 3], [HIVE.right + 2, HIVE.top - 3], [HIVE.left - 3, HIVE.bottom + 2], [HIVE.right + 2, HIVE.bottom + 2]]) {
      h.px(sx, sy, 0xd8d0c0);
      h.px(sx + 1, sy, 0x8a8478);
      h.px(sx, sy + 1, 0x8a8478);
    }
    // the top bar the comb hangs from
    for (let y = HIVE.top; y < HIVE.top + 4; y++)
      for (let x = HIVE.left + 2; x < HIVE.right - 2; x++) h.px(x, y, dither(WOOD, y === HIVE.top + 3 ? 0.85 : y === HIVE.top ? 0.1 : 0.35, x, y));
    // a brass plate with a little bee on it
    for (let y = HIVE.bottom + 1; y < HIVE.bottom + 4; y++)
      for (let x = 56; x < 76; x++) h.px(x, y, y === HIVE.bottom + 1 ? 0xf4d47a : y === HIVE.bottom + 3 ? 0x9a7228 : 0xd8aa48);
    h.px(65, HIVE.bottom + 2, 0x3a2810);
    h.px(66, HIVE.bottom + 2, 0xf4d47a);
    h.px(67, HIVE.bottom + 2, 0x3a2810);
    h.px(66, HIVE.bottom + 1, 0xffffff);
    // the entrance: a dark slot through the frame to the garden
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -6; dx <= 6; dx++) h.px(ENTR.x + dx, ENTR.y + dy, dy > 3 ? WOOD[2] : dx > 2 ? 0x1c120a : 0x2a1c12);
    for (let x = HIVE.left; x < HIVE.right; x++) {
      h.px(x, HIVE.top, 0x1a100a);
      h.px(x, HIVE.bottom - 1, 0x1a100a);
    }
    for (let y = HIVE.top; y < HIVE.bottom; y++) {
      h.px(HIVE.left, y, 0x1a100a);
      h.px(HIVE.right - 1, y, 0x1a100a);
    }
  }

  private flying(b: Bee): boolean {
    return b.state === 'out' || b.state === 'home' || b.state === 'buzz';
  }

  private drawBeeAt(sf: Surface, b: Bee, time: number): void {
    const fan = (b.state === 'pause' && b.id % 3 === 0) || b.state === 'dance' || b.state === 'gather';
    drawBee(sf, { x: b.x, y: b.y, face: b.face, ph: time * 30 + b.id, flying: this.flying(b), load: b.load > 0, fan });
  }

  render(sf: Surface, time: number, env: Env): void {
    const m = this.model, s = m.s;
    const sky = skyAt(env.hour);
    if (!this.bgReady || sky !== this.sky) {
      this.bgReady = true;
      this.sky = sky;
      this.buildBackground(sky);
    }
    sf.copyFrom(this.bg);
    const dark = m.dark(env);

    // garden: shelf of jars, feeder, flowers
    for (let i = 0; i < Math.min(s.jars, 11); i++) drawJar(sf, 160 + i * 14, FENCE.y - 8);
    drawFeeder(sf, FEEDER.x, GROUND, s.feeder);
    s.flowers.forEach((f, i) => {
      if (!f) return;
      const bend = Math.sin(time * 0.9 + i * 1.7) * 1.4;
      drawFlower(sf, SLOT_X[i], GROUND, f.kind, m.wilted(i), m.nectarAt(i) >= 1, bend, time);
    });
    if (s.flowers.every((f) => !f)) {
      // an empty bed: a gentle hint, since planting is the main job
      for (const x of SLOT_X) for (let k = 0; k < 3; k++) sf.px(x - 2 + k * 2, GROUND - 2, 0x8a6a40);
    }
    // decorations along the front of the garden
    this.decorBox.draw(sf, time);
    if (this.tool === 'decorate') this.decorBox.drawDecorating(sf, time);
    if (env.night) sf.multiply(0.5, 0.56, 0.78);

    // the hive layer: frame, comb, bees inside
    sf.blit(this.hiveBg, 0, 0);
    s.cells.forEach((c, i) => {
      const p = cellPos(i);
      drawCell(sf, Math.round(p.x), Math.round(p.y), c.kind, c.kind === 'nectar' ? c.t / BEE.cellLoads : 1, time, i * 3);
    });

    // the waggle dance: a glowing floor with a dotted line pointing toward the flower
    const dancer = m.bees.find((b) => b.state === 'dance');
    if (dancer && m.dance) {
      const fp = m.flowerPoint(m.dance.flower);
      const a = Math.atan2(fp.y - ENTR.y, fp.x - ENTR.x);
      for (let k = 0; k < 20; k++) {
        const t = (k / 20) * Math.PI * 2;
        sf.blend(DANCE_SPOT.x + Math.cos(t) * 17, DANCE_SPOT.y + Math.sin(t) * 10, 0xfff3a8, 0.5 + 0.3 * Math.sin(time * 6 + k));
      }
      for (let k = 1; k <= 6; k++) sf.blend(DANCE_SPOT.x + Math.cos(a) * (18 + k * 4), DANCE_SPOT.y + Math.sin(a) * (18 + k * 4), 0xffffff, 0.8 - k * 0.1);
    }

    drawQueen(sf, m.queen.x, m.queen.y, m.queen.face, time * 30);
    const inside = m.bees.filter((b) => b.x < HIVE.right - 1 && !this.flying(b));
    for (const b of inside) this.drawBeeAt(sf, b, time);

    if (dark) sf.rect(HIVE.left, HIVE.top, HIVE.right - HIVE.left, HIVE.bottom - HIVE.top, 0x0c1426, s.lamp ? 0 : 0.38);
    if (s.lamp) {
      for (let y = 0; y < 150; y++)
        for (let x = 0; x < 134; x++) {
          const d = Math.hypot(x - 20, y - 14) / 140;
          if (d < 1) sf.add(x, y, 0xffd890, 0.22 * (1 - d) ** 1.4);
        }
    }
    drawDomeLamp(sf, 30, 8, s.lamp, [0xe8c070, 0xc89a48, 0x9a7228], 0x6a4a18);

    // bees out in the garden or in the doorway
    for (const b of m.bees) if (b.x >= HIVE.right - 1 || this.flying(b)) this.drawBeeAt(sf, b, time);
    this.particles.render(sf);

    // glass: soft shines across the hive window
    for (let y = HIVE.top; y < HIVE.bottom; y++) {
      const x0 = HIVE.left + 8 + (HIVE.bottom - y) * 0.4;
      for (let k = 0; k < 8; k++) if (x0 + k < HIVE.right) sf.add(Math.round(x0 + k), y, 0xffffff, 0.04);
      for (let k = 0; k < 2; k++) if (x0 + 12 + k < HIVE.right) sf.add(Math.round(x0 + 12 + k), y, 0xffffff, 0.06);
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
