import { clamp, hash2 } from '../../core/rng';
import type { Env } from '../../core/time';
import { Particles } from '../../render/particles';
import { dither, Surface, VIEW_H, VIEW_W } from '../../render/surface';
import type { Habitat, Stat, Status, Tool, UiEvent } from '../types';
import { drawBee, drawCell, drawFeeder, drawFlower, drawJar, drawQueen } from './art';
import { BEE, cellPos, DANCE_SPOT, ENTR, FEEDER, FLOWERS, GROUND, Hive, HIVE, newHiveState, SLOT_X, type Bee } from './model';

const SKY = [0x7cc6ee, 0xa6dcf4, 0xcfeefa, 0xeaf8fc];
const GRASS = [0x6cc04a, 0x4ea03a, 0x388030, 0x286024];
const WOOD = [0xb88a58, 0x96693c, 0x6e4a28, 0x4a301a];
const INSIDE = [0x4a3220, 0x3a281a, 0x2a1c12];
const HIVE_W = 134;

export class HiveHabitat implements Habitat {
  readonly id = 'bees';
  tool = 'hand';
  model: Hive;
  private particles = new Particles();
  private bg = new Surface(VIEW_W, VIEW_H);
  private hiveBg = new Surface(HIVE_W, VIEW_H);
  private bgReady = false;
  private events: UiEvent[] = [];
  private said = new Set<string>();
  private told = false;

  constructor(saved: unknown, seed: number) {
    this.model = saved ? Hive.load(saved, seed) : new Hive(newHiveState(seed));
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
    if (kind !== 'down') return;
    if (this.tool === 'plant') {
      if (x < HIVE.right + 6) {
        this.events.push({ type: 'toast', text: 'Plant flowers out in the garden!' });
        return;
      }
      if (m.plant(x) === 'busy') this.events.push({ type: 'toast', text: 'That flower is still fresh. Try an empty spot.' });
      return;
    }
    if (Math.hypot(x - ENTR.x, y - ENTR.y) < 16) m.buzzGuards();
    else if (x < HIVE.right) m.tapHive(x, y);
    else this.particles.spawn('ripple', x, y);
  }

  tools(): Tool[] {
    const m = this.model;
    const next = FLOWERS[m.s.nextKind % FLOWERS.length];
    return [
      { id: 'hand', icon: '✋', label: 'Touch', kind: 'mode' },
      { id: 'plant', icon: next.icon, label: next.name, kind: 'mode' },
      { id: 'water', icon: '🚿', label: 'Water', kind: 'action' },
      { id: 'sugar', icon: '🧃', label: 'Sugar', kind: 'action', disabled: m.s.feeder > BEE.maxFeeder - 1 },
      { id: 'harvest', icon: '🍯', label: 'Honey', kind: 'action' },
      { id: 'lamp', icon: '💡', label: 'Lamp', kind: 'toggle', on: m.s.lamp },
    ];
  }

  useTool(id: string): void {
    const m = this.model;
    const toast = (text: string) => this.events.push({ type: 'toast', text });
    switch (id) {
      case 'water':
        if (!m.waterAll()) toast('There are no flowers to water yet.');
        else toast('Watered flowers make nectar faster and last longer.');
        break;
      case 'sugar':
        if (!m.fillFeeder()) toast('The feeder is full.');
        else toast('Sugar water helps on a bad day, but flowers are better.');
        break;
      case 'harvest':
        if (m.harvest()) break;
        toast('The bees need that honey for themselves. Wait until there is plenty!');
        break;
      case 'lamp':
        m.s.lamp = !m.s.lamp;
        break;
      default:
        this.tool = id;
        if (id === 'plant') toast('Tap the garden to plant. Wilted flowers can be replaced.');
    }
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

  /** Sky, hills and grass, then the observation hive's wooden frame and dark glass interior. */
  private buildBackground(): void {
    const sf = this.bg;
    for (let y = 0; y < VIEW_H; y++) for (let x = 0; x < VIEW_W; x++) sf.px(x, y, dither(SKY, 1 - y / GROUND, x, y));
    // distant hills
    for (let x = 0; x < VIEW_W; x++) {
      const h = Math.round(GROUND - 26 + Math.sin(x * 0.02) * 8 + Math.sin(x * 0.07 + 2) * 3);
      for (let y = h; y < GROUND; y++) sf.px(x, y, dither([0x9ed6a0, 0x7cbc84, 0x5ea468], (y - h) / 26, x, y));
    }
    // a sun
    for (let dy = -9; dy <= 9; dy++)
      for (let dx = -9; dx <= 9; dx++) if (dx * dx + dy * dy <= 64) sf.px(290 + dx, 26 + dy, dx * dx + dy * dy < 40 ? 0xfff3a8 : 0xffe070);
    // grass
    for (let x = 0; x < VIEW_W; x++)
      for (let y = GROUND; y < VIEW_H; y++) {
        const n = hash2(x, y, 230);
        sf.px(x, y, dither(GRASS, (y - GROUND) / 22 + n * 0.3, x, y));
      }
    for (let x = 0; x < VIEW_W; x += 2) {
      const h = 1 + Math.floor(hash2(x, 1, 231) * 4);
      for (let k = 0; k < h; k++) sf.px(x, GROUND - 1 - k, GRASS[(k + x) % 2]);
    }
    // the shelf for honey jars
    // hung from two ropes so it is not floating in the sky
    for (const rx of [152, 304])
      for (let y = 0; y < 36; y++) {
        sf.px(rx, y, y % 2 ? 0xa88a58 : 0x7a5e38);
        sf.px(rx + 1, y, 0x5a4428);
      }
    sf.rect(146, 36, 166, 3, WOOD[1]);
    sf.rect(146, 36, 166, 1, WOOD[0]);
    sf.rect(146, 39, 166, 1, WOOD[3]);
    // a feeder stand and the landing board outside the entrance
    sf.rect(HIVE.right, GROUND - 1, 24, 2, WOOD[1]);
    sf.rect(HIVE.right, GROUND - 1, 24, 1, WOOD[0]);

    // the hive
    const h = this.hiveBg;
    for (let y = 0; y < VIEW_H; y++)
      for (let x = 0; x < HIVE_W; x++) {
        const inside = x >= HIVE.left && x < HIVE.right && y >= HIVE.top && y < HIVE.bottom;
        if (inside) {
          h.px(x, y, dither(INSIDE, 0.4 + ((x - 60) ** 2 + (y - 90) ** 2) / 14000 + hash2(x, y, 232) * 0.15, x, y));
        } else if (x < HIVE.right + 5 && y < HIVE.bottom + 5 && x >= HIVE.left - 5 && y >= HIVE.top - 5) {
          const grain = hash2(x >> 3, y, 233) > 0.7 ? 0.2 : 0;
          h.px(x, y, dither(WOOD, 0.25 + grain + (hash2(x, y, 234) - 0.5) * 0.2, x, y));
        } else h.px(x, y, 0);
      }
    // the entrance: a dark slot through the frame to the garden
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -6; dx <= 6; dx++) h.px(ENTR.x + dx, ENTR.y + dy, dy > 3 ? WOOD[2] : dx > 2 ? 0x1c120a : 0x2a1c12);
    // a darker line where the glass meets the wood
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
    if (!this.bgReady) {
      this.bgReady = true;
      this.buildBackground();
    }
    sf.copyFrom(this.bg);
    const dark = m.dark(env);

    // garden: shelf of jars, feeder, flowers
    for (let i = 0; i < Math.min(s.jars, 11); i++) drawJar(sf, 154 + i * 14, 27);
    drawFeeder(sf, FEEDER.x, GROUND, s.feeder);
    s.flowers.forEach((f, i) => {
      if (!f) return;
      const bend = Math.sin(time * 0.9 + i * 1.7) * 1.4;
      drawFlower(sf, SLOT_X[i], GROUND, f.kind, m.wilted(i), m.nectarAt(i) >= 1, bend, time);
    });
    if (s.flowers.every((f) => !f)) {
      // an empty bed: a gentle hint, since planting is the main job
      for (const x of SLOT_X) for (let k = 0; k < 3; k++) sf.px(x - 2 + k * 2, GROUND + 3, 0x5a3a1c);
    }
    if (dark) sf.multiply(0.42, 0.5, 0.76);

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
      sf.rect(8, 4, 26, 4, 0x3a3a3a);
      sf.rect(10, 8, 22, 2, 0xffd890);
    }

    // bees out in the garden or in the doorway
    for (const b of m.bees) if (b.x >= HIVE.right - 1 || this.flying(b)) this.drawBeeAt(sf, b, time);
    this.particles.render(sf);

    // glass: a diagonal shine over the hive, and a dark frame around everything
    for (let i = 0; i < 90; i++) {
      sf.add(14 + i * 0.6, 18 + i * 1.5, 0xffffff, 0.06);
      sf.add(15 + i * 0.6, 18 + i * 1.5, 0xffffff, 0.06);
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
