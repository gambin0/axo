import { clamp, hash2, lerp } from '../../core/rng';
import type { Env } from '../../core/time';
import { groundShadow } from '../../render/glass';
import { Particles } from '../../render/particles';
import { dither, mix, Surface, VIEW_H, VIEW_W } from '../../render/surface';
import type { DecorPicker, DropHint, Habitat, Looks, Stat, Status, Tool, UiEvent } from '../types';
import { DecorBox, DECORATE_TOOL, unlockText } from '../decor';
import { BREEDS, drawChicken, drawEgg, type ChickPose, type ChickPoseName } from './art';
import { COOP_DECOR, COOP_DECOR_AREAS, coopPreviewBg } from './decor';
import {
  Bird, BROODER, CHOCOLATE, COOP, CORN, Flock, GROUND, HEN, NEST, newFlockState, PERCH, RAMP, SPOT, STAGE, SWING, TREATS, YARD, type Pt,
} from './model';

/** Names offered for a new chick when the child does not pick one. */
const CHICK_NAMES = ['Pip', 'Nugget', 'Peep', 'Sunny', 'Biscuit', 'Clover', 'Pebble', 'Dot'];

const GRASS = [0x3a7030, 0x4e8c38, 0x66a844, 0x84c056, 0xa4d470];
const DIRT = [0x6a4a2e, 0x8a6642, 0xa8845a, 0xc4a276, 0xdcc09a];
const WOOD = [0xd8a868, 0xb8844a, 0x8a5e32, 0x5e3e20, 0x3e2814];
const PAINT = [0x6a2420, 0x92322a, 0xb4443a, 0xd0604c];
const TRIM = [0xfff8ec, 0xe8dccc, 0xc4b8a8];
const ROOF = [0x2e323e, 0x424858, 0x5a6274, 0x767e92];
const STRAW = [0xa88838, 0xc8a84c, 0xe0c468, 0xf4dc90];
const METAL = [0x5a5e66, 0x8a9098, 0xb4bac2, 0xdce0e6];
const SKIN = [0xf4c8a8, 0xe0a888, 0xc08468];
/** Where the land meets the sky, and where the fence meets the ground. */
const HORIZON = 100;
const FENCE_BASE = 140;
const LANTERN = { x: 221, y: 82 };

/** Sky colours through the day: [hour, top, bottom]. */
const SKY: [number, number, number][] = [
  [0, 0x0a1030, 0x1c2652],
  [5, 0x0a1030, 0x1c2652],
  [6.2, 0x404c8c, 0xf4a07a],
  [7.6, 0x64a8e4, 0xcfe6f4],
  [17.6, 0x64a8e4, 0xcfe6f4],
  [19.2, 0x5a58a0, 0xf8a868],
  [20.6, 0x141a40, 0x2a3060],
  [24, 0x0a1030, 0x1c2652],
];
function skyAt(hour: number): { top: number; bot: number; night: number } {
  let i = 0;
  while (i < SKY.length - 2 && hour >= SKY[i + 1][0]) i++;
  const [h0, t0, b0] = SKY[i], [h1, t1, b1] = SKY[i + 1];
  const t = clamp((hour - h0) / (h1 - h0), 0, 1);
  const night = hour < 5.5 || hour > 20.2 ? 1 : hour < 6.6 ? (6.6 - hour) / 1.1 : hour > 19.2 ? (hour - 19.2) : 0;
  return { top: mix(t0, t1, t), bot: mix(b0, b1, t), night: clamp(night, 0, 1) };
}

const UNLOCK_TEXT: Record<string, (n: string) => string> = {
  hand: (n) => `${n} trusts you enough to take treats from your hand. Pick a treat and tap ${n}!`,
  swing: () => 'A swing appeared! Some chickens love to sit on a swing.',
  hop: (n) => `${n} might hop onto your hand! Hold your finger still on the grass next to it.`,
};

export class CoopHabitat implements Habitat {
  readonly id = 'chicken';
  tool = 'hand';
  model: Flock;
  private particles = new Particles();
  private bg = new Surface(VIEW_W, VIEW_H);
  /** Which pixels of the background are open sky, for clouds and stars. */
  private skyMask = new Uint8Array(VIEW_W * VIEW_H);
  private bgKey = '';
  private events: UiEvent[] = [];
  private said = new Set<string>();
  private holding = false;
  private lastState = new Map<number, string>();

  private decorBox: DecorBox;

  constructor(saved: unknown, seed: number) {
    this.model = saved ? Flock.load(saved, seed) : new Flock(newFlockState(seed));
    this.decorBox = new DecorBox({
      items: COOP_DECOR, areas: COOP_DECOR_AREAS, placed: () => this.model.s.decor, level: () => this.model.s.friend, previewBg: coopPreviewBg,
    });
  }

  decor(): DecorPicker {
    return this.decorBox;
  }

  /** The pet's name is the first bird's. */
  get name(): string {
    return this.model.lead.s.name;
  }
  set name(v: string) {
    this.model.lead.s.name = v;
  }

  private who(b?: Bird): string {
    return b?.s.name || (b && b !== this.model.lead ? 'The new chick' : this.model.lead.s.name || 'Your chick');
  }

  looks(): Looks {
    const lead = this.model.lead.s;
    return {
      what: 'colour',
      names: BREEDS.map((b) => b.name),
      current: lead.breed,
      // the chick, and the hen it will grow into
      preview: (sf, i) => {
        for (let y = 0; y < sf.h; y++) for (let x = 0; x < sf.w; x++) sf.px(x, y, y < sf.h - 7 ? mix(0xcfe6f4, 0x84c4ec, 1 - y / sf.h) : dither(GRASS, 0.5 + (y - sf.h) / 20, x, y));
        const base = { face: 1 as const, pose: 'stand' as const, breed: i, phase: 0, breath: 0.5, blink: false };
        drawChicken(sf, { ...base, x: 18, y: sf.h - 4, grow: 0.08 });
        for (let k = 0; k < 3; k++) sf.px(32 + k * 3, sf.h - 16, 0xffffff);
        sf.px(41, sf.h - 17, 0xffffff);
        sf.px(41, sf.h - 15, 0xffffff);
        drawChicken(sf, { ...base, x: 58, y: sf.h - 3, grow: 1 });
      },
      choose: (i) => (lead.breed = i),
    };
  }

  newcomer(): { ask: string; fallback: string } | null {
    const b = this.model.unnamed();
    if (!b) return null;
    const taken = new Set(this.model.birds.map((x) => x.s.name));
    const fallback = CHICK_NAMES.find((n) => !taken.has(n)) ?? 'Peep';
    return { ask: 'A new chick hatched! What will you call it?', fallback };
  }

  nameNewcomer(name: string): void {
    const b = this.model.unnamed();
    if (!b) return;
    b.s.name = name;
    this.events.push({ type: 'toast', text: `Hello, ${name}! Chicks can't keep warm on their own yet, so ${name} stays near the heat lamp.` });
    this.events.push({ type: 'sound', name: 'cheep' });
  }

  // ---- simulation --------------------------------------------------------

  update(dt: number, slowDt: number, env: Env): void {
    const m = this.model, s = m.s;
    m.update(dt, slowDt, env);
    const toast = (text: string) => this.events.push({ type: 'toast', text });
    const sound = (name: Extract<UiEvent, { type: 'sound' }>['name']) => this.events.push({ type: 'sound', name });
    const once = (key: string, text: string) => {
      if (this.said.has(key)) return;
      this.said.add(key);
      toast(text);
    };
    for (const fx of m.fx) {
      const b = fx.bird !== undefined ? m.bird(fx.bird) : undefined;
      const n = this.who(b);
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
          this.particles.spawn('dust', fx.x, fx.y, DIRT[2]);
          break;
        case 'drop':
          this.particles.spawn('drop', fx.x, fx.y);
          sound('splash');
          break;
        case 'crumb':
          this.particles.spawn('crumb', fx.x, fx.y, 0xe8c050);
          sound('munch');
          break;
        case 'zzz':
          this.particles.spawn('zzz', fx.x, fx.y);
          break;
        case 'plop':
          sound('plop');
          break;
        case 'crack':
          this.particles.spawn('crumb', fx.x, fx.y, 0xf4ece0);
          sound('tap');
          once(`crack:${fx.bird}`, 'The egg is wobbling! Something inside is tapping to get out…');
          break;
        case 'hatch':
          for (let i = 0; i < 6; i++) this.particles.spawn('crumb', fx.x, fx.y, 0xf4ece0);
          this.particles.spawn('sparkle', fx.x, fx.y - 4);
          sound('hatch');
          // a new chick is named as soon as it is out; the first one already has its name
          if (b && b.s.name) toast(`${n} hatched! Hello, little chick! Chicks can't keep warm on their own yet, so ${n} stays near the heat lamp.`);
          break;
        case 'cheep':
          sound('cheep');
          break;
        case 'cluck':
          sound('cluck');
          break;
        case 'cold':
          once('cold', `${n} is getting chilly, so it's running back to the warm lamp.`);
          sound('cheep');
          break;
        case 'worm':
          sound('munch');
          once('worm', `Chickens love worms! ${n} gobbled it right up.`);
          break;
        case 'unlock':
          this.particles.spawn('heart', fx.x, fx.y);
          sound('hatch');
          if (fx.text && UNLOCK_TEXT[fx.text]) toast(UNLOCK_TEXT[fx.text](n));
          break;
        case 'startle':
          this.particles.spawn('no', fx.x, fx.y);
          sound('no');
          toast(`Too many taps! ${n} got a fright. Gentle and slow is best.`);
          break;
        case 'chocolate':
          once('chocolate', `Chocolate is bad for chickens, so ${n} won't eat it.`);
          break;
        case 'handfed':
          sound('munch');
          once('handfed', `${n} took it right from your hand!`);
          break;
        case 'hop':
          for (let i = 0; i < 3; i++) this.particles.spawn('heart', fx.x + i * 5 - 5, fx.y);
          sound('cluck');
          once('hop', `${n} hopped onto your hand!`);
          break;
        case 'wake':
          this.particles.spawn('zzz', fx.x, fx.y);
          once('wake', `${n} was asleep! Chickens go to bed when it gets dark and get up at sunrise.`);
          break;
        case 'notyet':
          once('notyet', `${n} is too shy to take food from your hand yet, so it went on the grass. Keep visiting!`);
          break;
        case 'pullet':
          for (let i = 0; i < 4; i++) this.particles.spawn('sparkle', fx.x + i * 6 - 9, fx.y);
          sound('hatch');
          toast(`${n} is growing real feathers! It's warm enough without the heat lamp now, and can sleep in the hen house.`);
          break;
        case 'hen':
          for (let i = 0; i < 3; i++) this.particles.spawn('heart', fx.x + i * 6 - 6, fx.y);
          sound('hatch');
          toast(`${n} is all grown up into a hen! Look at that red comb. Hens lay eggs, so keep an eye on the nest box.`);
          break;
        case 'egg':
          for (let i = 0; i < 3; i++) this.particles.spawn('sparkle', fx.x + i * 5 - 5, fx.y);
          sound('cluck');
          if (!this.said.has('egg')) {
            this.said.add('egg');
            toast(`${n} laid an egg! Tap the nest box to collect it, or drag 🥚 to the heat lamp to hatch it into a chick.`);
          } else toast(`${n} laid an egg!`);
          break;
        case 'broody':
          for (let i = 0; i < 3; i++) this.particles.spawn('heart', fx.x + i * 5 - 5, fx.y);
          sound('cluck');
          toast(`${n} has gone broody! She's sitting on her egg to keep it warm, and in about half a day it will hatch.`);
          break;
        case 'incubate':
          this.particles.spawn('sparkle', fx.x, fx.y);
          sound('plop');
          if (!this.said.has('incubate')) {
            this.said.add('incubate');
            toast('The egg is snug in the warm straw under the heat lamp. In about half a day, a chick will hatch!');
          } else toast('Another egg is keeping warm under the lamp.');
          break;
        case 'collect': {
          this.particles.spawn('sparkle', fx.x, fx.y);
          sound('pop');
          const k = Number(fx.text) || 1;
          toast(`You collected ${k === 1 ? 'an egg' : `${k} eggs`}! That's ${s.collected} so far.`);
          break;
        }
      }
    }
    m.fx.length = 0;
    // a decoration earned: say so
    for (const d of this.decorBox.newlyUnlocked()) {
      sound('hatch');
      toast(unlockText(d));
    }
    this.decorBox.update(dt);
    for (const b of m.birds) {
      const st = b.s.state;
      if (st !== this.lastState.get(b.s.id)) {
        if (st === 'dust') once('dust', `${this.who(b)} is having a dust bath! Rolling in dry dirt keeps feathers clean.`);
        if (st === 'swing') once('swing', `${this.who(b)} is on the swing! Wheee!`);
        this.lastState.set(b.s.id, st);
      }
    }
    this.particles.update(dt, 0, GROUND);
  }

  coarseStep(dt: number, env: Env): void {
    this.model.coarseStep(dt, env);
  }

  beginCatchup(): () => string[] {
    const m0 = this.model;
    const stages = new Map(m0.birds.map((b) => [b.s.id, b.stage()]));
    const eggs = m0.s.nest.length, drops = m0.s.droppings.length, birds = m0.birds.length;
    return () => {
      const m = this.model, s = m.s;
      m.fx.length = 0;
      const out: string[] = [];
      for (const b of m.birds) {
        const was = stages.get(b.s.id);
        const n = this.who(b);
        if (was === undefined) continue;
        if (was === 'egg' && b.stage() === 'egg') {
          if (b.s.hatchIn <= HEN.hatchOnReturn) out.push(b === m.lead ? `${n} is about to hatch` : 'an egg is about to hatch');
        } else if (was === 'egg') out.push(`${n} hatched`);
        else if (b.stage() === 'pullet' && was === 'chick') out.push(`${n} grew real feathers`);
        else if (b.stage() === 'hen' && was !== 'hen') out.push(`${n} grew up into a hen`);
        else if (was !== 'hen') out.push(`${n} grew a bit bigger`);
      }
      if (m.birds.length > birds) out.push("a broody hen's egg is about to hatch");
      if (s.nest.length > eggs) out.push(s.nest.length - eggs === 1 ? 'there is an egg in the nest box' : `there are ${s.nest.length} eggs in the nest box`);
      if (s.feeder < 1) out.push('the feeder is empty');
      if (s.water <= HEN.floors.water + 0.01) out.push('the water is nearly gone');
      if (s.droppings.length > drops + 1) out.push('the run needs a clean');
      return out;
    };
  }

  // ---- input -------------------------------------------------------------

  private onNest(x: number, y: number): boolean {
    return x > NEST.x0 - 4 && x < NEST.x1 + 4 && y > NEST.lip - 16 && y < COOP.floor + 4;
  }

  pointer(kind: 'down' | 'move' | 'up', x: number, y: number): void {
    const m = this.model;
    if (kind === 'up') {
      m.finger = null;
      this.holding = false;
      this.decorBox.pointer('up', x, y);
      return;
    }
    if (this.tool === 'clean') {
      if (m.clean(x) === 0 && kind === 'down') this.particles.spawn('ripple', x, y);
      return;
    }
    if (this.tool === 'decorate') {
      if (!this.decorBox.pointer(kind, x, y) && kind === 'down') this.particles.spawn('ripple', x, y);
      return;
    }
    if (kind === 'down') {
      const b = m.birdAt(x, y);
      if (b) m.poke(b);
      else if (this.onNest(x, y) && m.s.nest.length > 0) m.collect();
      else m.tapYard(x, y);
    }
    // a finger held down in the run, below the fence top
    if (y > 96 && y < GROUND + 6 && x < RAMP.foot.x && m.hatched().length) {
      this.holding = true;
      m.finger = { x, y: Math.min(y, GROUND - 2) };
    } else if (kind === 'move') {
      m.finger = null;
      this.holding = false;
    }
  }

  tools(): Tool[] {
    const m = this.model, s = m.s;
    const out: Tool[] = [
      { id: 'hand', icon: '✋', label: 'Hand', kind: 'mode' },
      ...TREATS.map((t, i) => ({ id: `treat:${i}`, icon: t.icon, label: t.name, kind: 'drag' as const })),
      { id: 'water', icon: '💧', label: 'Water', kind: 'drag', disabled: s.water > 0.9 },
      { id: 'clean', icon: '🧹', label: 'Clean', kind: 'mode' },
    ];
    // once there is a hen, an egg from the nest box can go under the lamp to hatch
    if (m.hasHen() || s.nest.length) out.push({ id: 'egg', icon: '🥚', label: 'Hatch', kind: 'drag' });
    out.push(DECORATE_TOOL);
    out.push({ id: 'light', icon: '💡', label: 'Light', kind: 'toggle', on: s.light });
    return out;
  }

  useTool(id: string): void {
    // anything still being dragged is set down first
    this.decorBox.pointer('up', 0, 0);
    if (id === 'light') this.model.s.light = !this.model.s.light;
    else this.tool = id;
  }

  /** The bird a treat dropped at (x, y) is meant for, if any. */
  private birdNear(x: number, y: number): Bird | null {
    const m = this.model;
    return m.birdAt(x, y) ?? m.birds.find((b) => b.awake() && b.s.where === 'yard' && Math.abs(x - b.s.x) < 26 && y > b.s.y - 40 && y < GROUND + 6) ?? null;
  }

  private nearFeeder(x: number, y: number): boolean {
    return Math.abs(x - SPOT.feeder) < 18 && y > GROUND - 40 && y < GROUND + 10;
  }

  drop(id: string, at: { x: number; y: number } | null): void {
    const m = this.model;
    const toast = (text: string) => this.events.push({ type: 'toast', text });
    const tooMany = () => toast('There are enough treats on the grass already.');
    if (id === 'water') {
      if (!m.refill()) toast('The water is full.');
      return;
    }
    if (id === 'egg') {
      const r = m.incubate();
      if (r === 'none') toast('There are no eggs in the nest box. Wait for a hen to lay one!');
      if (r === 'full') toast(`The run is full! ${HEN.maxBirds} chickens is plenty, so you can collect the eggs instead.`);
      return;
    }
    const kind = Number(id.split(':')[1]);
    if (!(kind >= 0 && kind < TREATS.length)) return;
    // corn fills the feeder, unless it is scattered somewhere else
    if (kind === CORN && (!at || this.nearFeeder(at.x, at.y))) {
      if (!m.fillFeeder()) toast('The feeder is full.');
      return;
    }
    const awake = m.birds.filter((b) => b.awake() && b.s.where === 'yard');
    if (!m.hatched().length) {
      if (!m.dropTreat(at ? at.x : BROODER.x + 30, kind)) tooMany();
      return;
    }
    // tapped: offer it to a bird up and about in the run, otherwise drop it near one
    const lead = awake[0] ?? m.lead;
    const x = at ? at.x : lead.s.where === 'yard' ? lead.s.x + (lead.s.facing || 1) * 12 : RAMP.foot.x - 20;
    const offer = at ? !!this.birdNear(at.x, at.y) : awake.length > 0;
    if (offer || kind === CHOCOLATE) {
      if (m.offerTreat(x, kind) === 'full') tooMany();
    } else if (!m.dropTreat(x, kind)) tooMany();
  }

  dropHint(id: string, x: number, y: number): DropHint {
    const m = this.model;
    if (id === 'water') return { x: SPOT.water, y: GROUND - 14, ok: true };
    if (id === 'egg') return { x: m.eggSpot(), y: GROUND - 4, ok: m.s.nest.length > 0 && m.room() > 0 };
    if (id === `treat:${CORN}` && this.nearFeeder(x, y)) return { x: SPOT.feeder, y: GROUND - 6, ok: true };
    const b = this.birdNear(x, y);
    if (b) return { x: b.s.x, y: b.s.y - 6, ok: true };
    return { x: clamp(Math.round(x), YARD.left + 12, RAMP.foot.x - 8), y: GROUND - 1, ok: true };
  }

  stats(): Stat[] {
    const m = this.model, s = m.s;
    const out: Stat[] = [];
    const fed = m.hatched();
    // the hungriest bird, so a bar running low always means someone needs feeding
    if (fed.length) out.push({ icon: '🌽', label: 'Tummy', value: Math.min(...fed.map((b) => b.s.fullness)) });
    else out.push({ icon: '🌽', label: 'Tummy', value: m.lead.s.fullness });
    out.push({ icon: '💧', label: 'Water', value: s.water * 100 }, { icon: '🧹', label: 'Clean', value: m.cleanliness() }, { icon: '💛', label: 'Friends', value: s.friend });
    // the youngest bird still growing, or the egg count once everyone is grown
    const young = m.birds.filter((b) => b.hatched() && b.stage() !== 'hen').sort((a, b) => a.s.grow - b.s.grow)[0];
    if (young) out.push({ icon: '🐣', label: m.birds.length > 1 ? `${this.who(young)} growing` : 'Growing up', value: (young.s.grow / STAGE.hen) * 100 });
    else if (m.hasHen()) out.push({ icon: '🥚', label: 'Eggs', value: String(s.collected) });
    else out.push({ icon: '🐣', label: 'Growing up', value: 0 });
    return out;
  }

  status(_env: Env): Status {
    const m = this.model, s = m.s;
    const birds = m.birds;
    const any = (st: string) => birds.some((b) => b.s.state === st);
    if (any('hatch')) return { text: 'Hatching!', tone: 'good' };
    if (birds.some((b) => b.s.state === 'egg' && b.s.hatchIn < 60)) return { text: 'About to hatch!', tone: 'good' };
    const up = m.hatched();
    if (up.length && up.every((b) => b.asleep())) return { text: 'Sleeping', tone: 'sleep' };
    if (m.hungry()) return { text: 'Hungry!', tone: 'warn' };
    if (s.water < 0.05) return { text: 'Needs water', tone: 'warn' };
    if (m.cleanliness() < 45) return { text: 'Needs a clean', tone: 'warn' };
    if (s.nest.length > 0) return { text: s.nest.length === 1 ? 'Laid an egg!' : 'Eggs to collect!', tone: 'good' };
    if (any('lay')) return { text: 'Laying an egg…', tone: 'good' };
    if (birds.some((b) => b.s.broody > 0)) return { text: 'Sitting on an egg', tone: 'good' };
    if (birds.some((b) => b.s.state === 'egg')) return { text: 'Egg keeping warm', tone: 'good' };
    const lead = m.lead;
    if (lead.s.state === 'warm') return { text: 'Keeping warm', tone: 'good' };
    if (any('swing')) return { text: 'Swinging!', tone: 'good' };
    if (any('dust')) return { text: 'Dust bath', tone: 'good' };
    return { text: up.length > 1 ? 'Pecking about together' : lead.isChick() ? 'Peeping' : 'Pecking about', tone: 'good' };
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
   * Everything that stays put: the sky at this time of day with its sun, hills and a far-off
   * farm, a tree and sunflowers behind the run's fence, the grass and dirt of the run, the
   * feeder and drinker stands, the heat lamp while there is a chick, and the hen house.
   */
  private buildBackground(hour: number, lamp: boolean, swing: boolean): void {
    const sf = this.bg;
    const sky = skyAt(hour);
    const skyRamp = Array.from({ length: 12 }, (_, i) => mix(sky.top, sky.bot, i / 11));
    this.skyMask.fill(0);
    for (let y = 0; y < HORIZON + 10; y++)
      for (let x = 0; x < VIEW_W; x++) {
        sf.px(x, y, dither(skyRamp, y / (HORIZON + 4), x, y));
        this.skyMask[y * VIEW_W + x] = 1;
      }
    // the sun crosses the sky through the day
    if (hour > 5.8 && hour < 19.8) {
      const t = (hour - 6) / 13.6;
      const cx = 24 + t * 272, cy = 96 - Math.sin(t * Math.PI) * 74;
      const low = 1 - Math.sin(t * Math.PI);
      for (let y = Math.floor(cy - 16); y <= cy + 16; y++)
        for (let x = Math.floor(cx - 16); x <= cx + 16; x++) {
          if (y < 0 || y >= HORIZON + 10) continue;
          const d = Math.hypot(x - cx, y - cy);
          if (d < 6) sf.px(x, y, d < 4.5 ? mix(0xfffbe0, 0xffc070, low) : mix(0xffe890, 0xff9850, low));
          else if (d < 16) sf.add(x, y, mix(0xfff0b0, 0xff9050, low), 0.22 * (1 - (d - 6) / 10) ** 2);
        }
    }
    // far hills, hazy with the sky colour, with tiny trees and a farm
    const hill = (base: number, amp: number, k: number, seed: number, ramp: number[], haze: number) => {
      for (let x = 0; x < VIEW_W; x++) {
        const top = Math.round(base - amp * (0.6 * Math.sin(x * k + seed) + 0.4 * Math.sin(x * k * 2.3 + seed * 3)));
        for (let y = top; y < FENCE_BASE; y++) {
          let c = dither(ramp, 0.75 - (y - top) / 40 + (x < 160 ? 0.05 : -0.05), x, y);
          c = mix(c, sky.bot, haze);
          sf.px(x, y, c);
          this.skyMask[y * VIEW_W + x] = 0;
        }
      }
    };
    const skyOnly = sf.data.slice();
    hill(84, 7, 0.018, 1.2, [0x4a7a52, 0x5e9060, 0x74a46c], 0.45);
    for (const [tx, ty] of [[38, 80], [44, 82], [186, 78], [266, 84], [272, 86]]) {
      sf.disc(tx, ty, 3, 3.5, mix(0x3a6a40, sky.bot, 0.45));
      sf.disc(tx - 0.8, ty - 0.8, 1.8, 2, mix(0x5a8a50, sky.bot, 0.45));
    }
    // a little red barn and silo on the far hill
    for (let y = 80; y < 90; y++) for (let x = 140; x < 152; x++) sf.px(x, y, mix(x > 148 ? 0x8a3028 : 0xb04434, sky.bot, 0.35));
    for (let k = 0; k < 6; k++) for (let x = 140 + k; x < 152 - k; x++) sf.px(x, 79 - k, mix(0x5a4a4a, sky.bot, 0.35));
    for (let y = 76; y < 90; y++) for (let x = 153; x < 157; x++) sf.px(x, y, mix(x < 155 ? 0xc8c8c4 : 0x9a9a98, sky.bot, 0.35));
    sf.disc(155, 76, 2, 1.5, mix(0x8a8a90, sky.bot, 0.35));
    hill(98, 5, 0.026, 4.1, [0x3e7036, 0x52883e, 0x6ca04c], 0.2);

    // a big leafy tree beyond the fence on the left
    for (let y = 56; y < FENCE_BASE; y++)
      for (let x = 20; x < 32; x++) {
        const w = 4 + Math.max(0, (y - 120) / 6);
        if (Math.abs(x - 26) > w) continue;
        sf.px(x, y, dither([0x3a2616, 0x5a3e24, 0x7a5634], 0.5 - (x - 26) / 10 + hash2(x >> 1, y, 600) * 0.2, x, y));
      }
    const leaves: [number, number, number][] = [[26, 40, 22], [8, 52, 15], [46, 50, 16], [24, 24, 15], [44, 32, 12], [6, 32, 11]];
    for (let y = 0; y < 80; y++)
      for (let x = 0; x < 72; x++) {
        let best = -1, bl = leaves[0];
        for (const l of leaves) {
          const v = 1 - Math.hypot(x - l[0], (y - l[1]) * 1.15) / l[2];
          if (v > best) {
            best = v;
            bl = l;
          }
        }
        if (best + (hash2(x, y, 601) - 0.5) * 0.18 <= 0) continue;
        const t = 0.55 + ((bl[1] - y) / bl[2]) * 0.35 + ((bl[0] - x) / bl[2]) * 0.15 + (hash2(x >> 1, y >> 1, 602) - 0.5) * 0.4;
        sf.px(x, y, dither([0x24502a, 0x346a34, 0x488a40, 0x64a64c, 0x8cc060], t, x, y));
        this.skyMask[y * VIEW_W + x] = 0;
      }
    // red apples here and there
    for (const [ax, ay] of [[14, 46], [36, 30], [50, 52], [28, 56], [10, 30], [58, 40]]) {
      sf.px(ax, ay, 0xd8302a);
      sf.px(ax + 1, ay, 0xb02420);
      sf.px(ax, ay - 1, 0xff7860);
    }

    // sunflowers peeking over the fence
    for (const [fx, top] of [[78, 92], [90, 86], [146, 94], [160, 88]] as const) {
      for (let y = top; y < FENCE_BASE; y++) sf.px(fx, y, y % 7 === 0 ? 0x3e7a2a : 0x5a9a38);
      for (const side of [-1, 1]) {
        const ly = top + 14 + (side > 0 ? 6 : 0);
        for (let k = 1; k < 6; k++) sf.px(fx + side * k, ly - Math.round(k * 0.4), k < 5 ? 0x4e8e34 : 0x6aaa44);
        for (let k = 1; k < 4; k++) sf.px(fx + side * k, ly - Math.round(k * 0.4) + 1, 0x3e7a2a);
      }
      for (let a = 0; a < 14; a++) {
        const ang = (a / 14) * Math.PI * 2;
        for (let r = 3; r < 7; r++) sf.px(Math.round(fx + Math.cos(ang) * r), Math.round(top + Math.sin(ang) * r * 0.9), r === 6 ? 0xe8a020 : 0xffd040);
      }
      sf.disc(fx, top, 3.2, 3, 0x5a3818);
      sf.disc(fx - 0.7, top - 0.7, 1.6, 1.4, 0x7a5028);
    }

    // the ground of the run: grass at the back, a worn dirt path where the chickens walk, grass in front
    for (let y = FENCE_BASE; y < VIEW_H; y++)
      for (let x = 0; x < VIEW_W; x++) {
        const depth = (y - FENCE_BASE) / (VIEW_H - FENCE_BASE);
        const path = 1 - Math.abs(y - (GROUND + 2)) / (7 + 3 * Math.sin(x * 0.05) + hash2(x >> 2, 0, 603) * 3);
        let c = dither(GRASS, 0.7 - depth * 0.45 + (hash2(x, y, 604) - 0.5) * 0.35, x, y);
        if (path > 0 && hash2(x, y, 605) < path * 1.6) c = dither(DIRT, 0.55 + (hash2(x, y, 606) - 0.5) * 0.4 - depth * 0.2, x, y);
        if (hash2(x, y, 607) > 0.985 && path <= 0) c = hash2(x, y, 608) > 0.5 ? 0xfff8f0 : 0xf8e070; // daisies and buttercups
        sf.px(x, y, c);
      }
    // the dust bath: a scooped-out hollow of soft dry dirt
    for (let dx = -16; dx <= 16; dx++) {
      const h = 3.5 * Math.sqrt(Math.max(0, 1 - (dx / 16.5) ** 2));
      for (let k = -2; k <= h; k++) sf.px(SPOT.dust + dx, GROUND - 1 + k, dither(DIRT, k < 0 ? 0.85 : 0.25 + k / 10 + hash2(dx, k, 609) * 0.2, SPOT.dust + dx, k));
    }
    // grass blades along the bottom edge and tufts at the fence
    for (let x = 0; x < VIEW_W; x += 2) {
      const h = 2 + Math.floor(hash2(x, 1, 610) * 5);
      for (let k = 0; k < h; k++) sf.px(x + (k > 2 ? 1 : 0), VIEW_H - 1 - k, k === h - 1 ? GRASS[4] : GRASS[2 + (k & 1)]);
      const f = 1 + Math.floor(hash2(x, 2, 610) * 4);
      for (let k = 0; k < f; k++) sf.px(x, FENCE_BASE - k, k === f - 1 ? GRASS[3] : GRASS[1]);
    }

    // the run's fence: wooden posts and a rail, with chicken wire between
    for (let y = 104; y < FENCE_BASE + 2; y++)
      for (let x = 0; x < COOP.x0; x++) {
        const hex = ((x + (Math.floor(y / 3) % 2) * 2) % 4 === 0 && y % 3 !== 0) || (y % 3 === 0 && x % 4 !== 2);
        if (hex) sf.blend(x, y, 0xe8ecf0, 0.28);
      }
    for (let x = 0; x < VIEW_W; x++) {
      for (let y = 104; y < 108; y++) sf.px(x, y, dither(WOOD, y === 104 ? 0.05 : y === 107 ? 0.75 : 0.35 + hash2(x >> 3, y, 611) * 0.1, x, y));
    }
    for (const px of [6, 66, 126, 186])
      for (let y = 100; y < FENCE_BASE + 3; y++)
        for (let x = px - 2; x <= px + 2; x++) sf.px(x, y, y === 100 ? WOOD[1] : dither(WOOD, x === px - 2 ? 0.1 : x === px + 2 ? 0.8 : 0.45, x, y));

    if (lamp) this.drawBrooder(sf);
    this.drawFeederStand(sf);
    if (swing) this.drawSwingFrame(sf);
    this.drawCoop(sf, sky.bot);
    // anything painted over the sky (the coop roof, the lamp post) hides clouds and stars
    for (let i = 0; i < this.skyMask.length; i++) {
      const j = i * 4;
      if (this.skyMask[i] && (sf.data[j] !== skyOnly[j] || sf.data[j + 1] !== skyOnly[j + 1] || sf.data[j + 2] !== skyOnly[j + 2])) this.skyMask[i] = 0;
    }
  }

  /** The heat lamp on its post, and a bed of straw under it. */
  private drawBrooder(sf: Surface): void {
    const bx = BROODER.x;
    for (let dx = -24; dx <= 24; dx++) {
      const h = Math.round(4 * Math.sqrt(Math.max(0, 1 - (dx / 25) ** 2)) + hash2(dx, 0, 620) * 2);
      for (let k = -1; k < h; k++) sf.px(bx + dx, GROUND + 2 - k, dither(STRAW, 0.3 + k / 6 + hash2(bx + dx, k, 621) * 0.3, bx + dx, k));
    }
    for (let i = 0; i < 26; i++) {
      const x0 = bx - 22 + hash2(i, 1, 622) * 44, y0 = GROUND - 2 + hash2(i, 2, 622) * 4, a = (hash2(i, 3, 622) - 0.5) * 1.2;
      for (let k = 0; k < 5; k++) sf.px(Math.round(x0 + Math.cos(a) * k), Math.round(y0 + Math.sin(a) * k), STRAW[3]);
    }
    // the post and the arm it hangs from
    const post = bx - 30;
    for (let y = 56; y < GROUND + 3; y++) for (let x = post - 1; x <= post + 1; x++) sf.px(x, y, dither(WOOD, x === post - 1 ? 0.15 : x === post + 1 ? 0.8 : 0.45, x, y));
    for (let x = post - 1; x <= bx + 2; x++) {
      sf.px(x, 56, WOOD[1]);
      sf.px(x, 57, WOOD[2]);
      sf.px(x, 58, WOOD[3]);
    }
    for (let k = 0; k < 8; k++) sf.px(post + 2 + k, 59 + k, WOOD[2]);
    // the cord, then the shiny reflector with the bulb glowing red inside
    for (let y = 59; y < BROODER.lampY - 9; y++) sf.px(bx, y, y % 2 ? 0x2a2a2e : 0x4a4a52);
    for (let k = 0; k < 10; k++) {
      const w = 2 + k * 0.85;
      for (let dx = -Math.round(w); dx <= Math.round(w); dx++)
        sf.px(bx + dx, BROODER.lampY - 9 + k, dither(METAL, 0.85 - (dx + w) / (2 * w) * 0.7 + (k === 9 ? -0.4 : 0), bx + dx, k));
    }
    for (let dx = -5; dx <= 5; dx++) {
      sf.px(bx + dx, BROODER.lampY + 1, Math.abs(dx) < 4 ? 0xff7040 : 0xc84020);
      if (Math.abs(dx) < 3) sf.px(bx + dx, BROODER.lampY + 2, 0xd83a20);
    }
  }

  private drawFeederStand(sf: Surface): void {
    // the feeder: a metal hopper on a round tray
    const fx = SPOT.feeder;
    groundShadow(sf, fx, GROUND, 15, 0.35, 0x3a2a18);
    for (let y = GROUND - 26; y < GROUND - 6; y++)
      for (let dx = -7; dx <= 7; dx++) sf.px(fx + dx, y, y === GROUND - 26 ? METAL[3] : dither(METAL, 0.8 - (dx + 7) / 14 * 0.65 + (y % 6 === 0 ? -0.2 : 0), fx + dx, y));
    for (let dx = -8; dx <= 8; dx++) {
      sf.px(fx + dx, GROUND - 28, METAL[1]);
      sf.px(fx + dx, GROUND - 27, METAL[2]);
    }
    sf.px(fx, GROUND - 30, METAL[1]);
    sf.px(fx, GROUND - 29, METAL[1]);
    // the drinker: a clear jar on a red base (the water inside is drawn each frame)
    const wx = SPOT.water;
    groundShadow(sf, wx, GROUND, 13, 0.35, 0x3a2a18);
    for (let dx = -9; dx <= 9; dx++) for (let k = 0; k < 4; k++) sf.px(wx + dx, GROUND - 4 + k, k === 0 ? 0xf06a5a : dither([0xa82a22, 0xc83a30, 0xe05a48], 0.8 - (dx + 9) / 18 - k * 0.1, wx + dx, k));
  }

  private drawSwingFrame(sf: Surface): void {
    for (const [i, px] of SWING.posts.entries())
      for (let y = SWING.bar; y < GROUND + 2; y++) {
        const x = Math.round(px + (i ? 1 : -1) * ((y - SWING.bar) / (GROUND - SWING.bar)) * 4);
        sf.px(x, y, WOOD[1]);
        sf.px(x + 1, y, WOOD[3]);
      }
    for (let x = SWING.posts[0] - 2; x <= SWING.posts[1] + 3; x++) {
      sf.px(x, SWING.bar - 1, WOOD[0]);
      sf.px(x, SWING.bar, WOOD[1]);
      sf.px(x, SWING.bar + 1, WOOD[3]);
    }
  }

  /** The hen house: red walls, a slate roof, on legs, with its front cut away to see inside. */
  private drawCoop(sf: Surface, haze: number): void {
    const C = COOP;
    // shade under the house, and its legs
    for (let y = C.floor + 3; y < GROUND + 3; y++)
      for (let x = C.x0 + 2; x <= C.x1 - 2; x++) sf.blend(x, y, 0x1a2a10, 0.28 * (1 - (y - C.floor) / 50));
    groundShadow(sf, (C.x0 + C.x1) / 2, GROUND, 42, 0.3, 0x1a2a10);
    for (const lx of [C.x0 + 4, C.x1 - 6])
      for (let y = C.floor; y < GROUND + 2; y++) for (let x = lx; x < lx + 4; x++) sf.px(x, y, dither(WOOD, x === lx ? 0.15 : x === lx + 3 ? 0.85 : 0.5, x, y));
    // straw that has fallen through
    for (let i = 0; i < 14; i++) {
      const x0 = C.x0 + 8 + hash2(i, 1, 630) * (C.x1 - C.x0 - 16), y0 = GROUND - 1 + hash2(i, 2, 630) * 3, a = (hash2(i, 3, 630) - 0.5) * 0.8;
      for (let k = 0; k < 4; k++) sf.px(Math.round(x0 + Math.cos(a) * k), Math.round(y0 + Math.sin(a) * k), STRAW[2]);
    }
    // the inside: back wall planks in warm shadow, darker up under the roof
    for (let y = C.ceil; y < C.floor; y++)
      for (let x = C.x0; x <= C.x1; x++) {
        const plank = (y - C.ceil) % 7 === 0;
        let t = 0.5 + (y - C.ceil) / 120 + hash2(x >> 3, Math.floor((y - C.ceil) / 7), 631) * 0.12 - (C.floor - y < 6 ? 0.1 : 0);
        t -= Math.max(0, (C.ceil + 10 - y) / 10) * 0.25;
        let c = dither(WOOD, 1 - t, x, y);
        if (plank) c = WOOD[4];
        sf.px(x, y, mix(c, 0x2a1a10, 0.25));
      }
    // a little window in the back wall, showing the sky
    const wx = 272, wy = 84;
    for (let y = wy; y < wy + 12; y++)
      for (let x = wx; x < wx + 14; x++) {
        const fr = x === wx || x === wx + 13 || y === wy || y === wy + 11 || x === wx + 6 || x === wx + 7 || y === wy + 6;
        sf.px(x, y, fr ? TRIM[1] : mix(haze, 0xffffff, 0.15 + (y - wy) * 0.02));
      }
    // straw on the floor
    for (let x = C.x0 + 3; x < C.x1 - 2; x++) {
      const h = 1 + Math.round(hash2(x, 0, 632) * 2);
      for (let k = 0; k < h; k++) sf.px(x, C.floor - 1 - k, dither(STRAW, 0.4 + k * 0.2 + hash2(x, k, 633) * 0.3, x, k));
    }
    // the floor boards
    for (let x = C.x0 - 2; x <= C.x1 + 2; x++) {
      sf.px(x, C.floor, WOOD[1]);
      sf.px(x, C.floor + 1, WOOD[2]);
      sf.px(x, C.floor + 2, WOOD[3]);
      sf.px(x, C.floor + 3, WOOD[4]);
    }
    // the perch: a round pole on two brackets
    for (const bx of [PERCH.x0 + 2, PERCH.x1 - 2]) for (let y = PERCH.y; y < C.floor; y++) sf.px(bx, y, WOOD[3]);
    for (let x = PERCH.x0; x <= PERCH.x1; x++) {
      sf.px(x, PERCH.y - 1, WOOD[0]);
      sf.px(x, PERCH.y, WOOD[1]);
      sf.px(x, PERCH.y + 1, WOOD[3]);
    }
    // the nest box: its back and sides (the front lip is drawn over the hen)
    for (let y = NEST.lip - 14; y < C.floor; y++)
      for (let x = NEST.x0; x <= NEST.x1; x++) {
        const side = x === NEST.x0 || x === NEST.x1 || x === NEST.x0 + 1 || x === NEST.x1 - 1;
        sf.px(x, y, side ? dither(WOOD, x < NEST.x0 + 2 ? 0.2 : 0.7, x, y) : y === NEST.lip - 14 ? WOOD[1] : mix(WOOD[3], 0x1a1008, 0.4));
      }
    for (let x = NEST.x0 - 1; x <= NEST.x1 + 1; x++) {
      sf.px(x, NEST.lip - 16, PAINT[3]);
      sf.px(x, NEST.lip - 15, PAINT[1]);
    }
    for (let x = NEST.x0 + 2; x < NEST.x1 - 1; x++) {
      const h = 3 + Math.round(hash2(x, 0, 634) * 2 + Math.sin(((x - NEST.x0) / (NEST.x1 - NEST.x0)) * Math.PI) * 1.5);
      for (let k = 0; k < h; k++) sf.px(x, NEST.lip - k, dither(STRAW, 0.35 + k * 0.15 + hash2(x, k, 635) * 0.3, x, k));
    }

    // the walls: the left side wall with the door, and the right side wall, in barn red with white trim
    const wall = (x0: number, x1: number, door: boolean) => {
      for (let y = C.ceil - 2; y < C.floor; y++)
        for (let x = x0; x <= x1; x++) {
          if (door && y > C.floor - 22 && (y > C.floor - 16 || (x - (x0 + x1) / 2) ** 2 + (y - (C.floor - 16)) ** 2 < 36)) {
            if (x === x1) sf.px(x, y, 0x2a1810);
            continue;
          }
          sf.px(x, y, x === x0 ? PAINT[0] : x === x1 ? PAINT[1] : dither(PAINT, 0.6 - (x - x0) / 10, x, y));
        }
    };
    wall(C.x0 - 3, C.x0 + 3, true);
    wall(C.x1 - 3, C.x1 + 3, false);
    // white corner trims at the front edges
    for (let y = C.ceil - 2; y < C.floor + 4; y++) {
      for (const tx of [C.x0 - 4, C.x0 + 3, C.x1 - 4, C.x1 + 3]) sf.px(tx, y, tx === C.x0 + 3 || tx === C.x1 + 3 ? TRIM[2] : TRIM[0]);
    }
    // the gable above, in red boards with a round vent, then the roof
    const peakX = (C.x0 + C.x1) / 2;
    for (let y = C.roof + 6; y < C.ceil; y++) {
      const half = ((y - C.roof - 6) / (C.ceil - C.roof - 6)) * ((C.x1 - C.x0) / 2 + 4);
      for (let x = Math.round(peakX - half); x <= Math.round(peakX + half); x++)
        sf.px(x, y, (x - C.x0) % 6 === 0 ? PAINT[0] : dither(PAINT, 0.55 + (x > peakX + 20 ? -0.2 : 0) + hash2(x, y >> 2, 636) * 0.1, x, y));
    }
    for (let x = C.x0 - 5; x <= C.x1 + 5; x++) {
      sf.px(x, C.ceil - 2, TRIM[0]);
      sf.px(x, C.ceil - 1, TRIM[1]);
      sf.px(x, C.ceil, 0x1a100a);
    }
    sf.disc(peakX, C.ceil - 11, 4.5, 4.5, TRIM[0]);
    sf.disc(peakX, C.ceil - 11, 3.2, 3.2, 0x2a1a12);
    sf.px(peakX - 1, C.ceil - 12, 0x4a3020);
    // the roof: overhanging eaves with rows of slate shingles
    for (let y = C.roof - 4; y < C.ceil - 6; y++) {
      const k = y - (C.roof - 4);
      const half = 4 + k * 2.2;
      for (let x = Math.round(peakX - half); x <= Math.round(peakX + half); x++) {
        const edge = Math.abs(x - peakX) > half - 2.5;
        if (edge) {
          sf.px(x, y, TRIM[x < peakX ? 0 : 1]);
          continue;
        }
        const row = Math.floor(k / 4);
        let c = dither(ROOF, 0.65 - k / 60 + (x > peakX ? -0.2 : 0), x, y);
        if (k % 4 === 3) c = ROOF[0];
        else if ((x + row * 3) % 7 === 0) c = ROOF[1];
        sf.px(x, y, c);
      }
    }
    // the ramp, with little slats to grip
    const { foot, top } = RAMP;
    const len = Math.hypot(top.x - foot.x, top.y - foot.y);
    for (let k = 0; k <= len; k += 0.5) {
      const x = foot.x + ((top.x - foot.x) * k) / len - 2, y = foot.y + ((top.y - foot.y) * k) / len;
      for (let t = 0; t < 4; t++) sf.px(Math.round(x + t * 0.6), Math.round(y + t), t === 0 ? WOOD[0] : t === 3 ? WOOD[4] : WOOD[2]);
      if (Math.round(k) % 6 === 0) {
        sf.px(Math.round(x), Math.round(y) - 1, WOOD[1]);
        sf.px(Math.round(x) + 1, Math.round(y) - 1, WOOD[1]);
      }
    }
    // a lantern on a hook under the eave, for looking in at night
    for (let y = C.ceil - 4; y < LANTERN.y - 4; y++) sf.px(LANTERN.x, y, 0x2a2a2e);
  }

  private drawLantern(sf: Surface, on: boolean): void {
    const { x, y } = LANTERN;
    for (let dx = -3; dx <= 3; dx++) sf.px(x + dx, y - 4, 0x2a2a2e);
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -2; dx <= 2; dx++) sf.px(x + dx, y + dy, Math.abs(dx) === 2 ? 0x2a2a2e : on ? (dy < 0 ? 0xfff6c8 : 0xffd870) : 0x8a8a7a);
    for (let dx = -3; dx <= 3; dx++) sf.px(x + dx, y + 4, 0x2a2a2e);
  }

  private drawFinger(sf: Surface, f: Pt): void {
    // a short fingertip pointing left, held where the player is touching
    const L = 22;
    const x0 = Math.round(f.x), y0 = Math.round(f.y);
    for (let dx = 0; dx <= L; dx++)
      for (let dy = -3; dy <= 3; dy++) {
        const tip = dx < 3 && dy * dy + (3 - dx) ** 2 > 12;
        const back = dx > L - 3 && dy * dy + (dx - (L - 3)) ** 2 > 12;
        if (tip || back) continue;
        let c = dy < -1 ? SKIN[0] : dy > 1 ? SKIN[2] : SKIN[1];
        if ((dx === 12 || dx === 14) && dy > -3 && dy < 3) c = SKIN[2];
        sf.px(x0 + dx, y0 + dy, c);
      }
    for (let dy = -2; dy <= 0; dy++) {
      sf.px(x0 + 2, y0 + dy, 0xfbe0d4);
      sf.px(x0 + 3, y0 + dy, 0xfbe0d4);
    }
  }

  private drawFood(sf: Surface, time: number): void {
    const m = this.model, s = m.s;
    // feed in the feeder's tray
    const fx = SPOT.feeder;
    for (let dx = -12; dx <= 12; dx++) {
      const d = Math.round(3 * Math.sqrt(1 - (dx / 12.5) ** 2));
      for (let k = 0; k <= d; k++) sf.px(fx + dx, GROUND - 5 + k, k === 0 ? METAL[3] : k === d ? METAL[0] : dither(METAL, 0.6 - k / 6 - (dx > 6 ? 0.3 : 0), fx + dx, k));
    }
    const kernels = Math.round((s.feeder / m.feederMax()) * 20);
    for (let i = 0; i < kernels; i++) sf.px(fx - 10 + ((i * 7) % 21), GROUND - 6 - (i % 2), i % 3 === 0 ? 0xf8d850 : i % 3 === 1 ? 0xe8b030 : 0xc89028);
    // water in the clear drinker
    const wx = SPOT.water, top = GROUND - 24, bottom = GROUND - 5;
    const level = bottom - Math.round((bottom - top - 3) * s.water);
    for (let y = top; y <= bottom; y++) {
      const r = y < top + 4 ? 3 + (y - top) * 1.2 : 7;
      for (let dx = -Math.round(r); dx <= Math.round(r); dx++) {
        const edge = Math.abs(dx) >= r - 0.6;
        if (edge) sf.blend(wx + dx, y, dx < 0 ? 0xffffff : 0x8aaab8, 0.8);
        else if (y >= level) sf.px(wx + dx, y, dx === -4 ? 0xe4f6ff : dx < -2 ? 0xa8daf4 : dx > 3 ? 0x5aa4d4 : 0x7cc0e8);
        else sf.blend(wx + dx, y, 0xf0faff, dx === -4 ? 0.6 : 0.22);
      }
    }
    if (s.water > 0.02) for (let dx = -6; dx <= 6; dx++) sf.px(wx + dx, level, 0xd0f0ff);
    sf.px(wx, top - 1, 0xd8303a);
    sf.px(wx - 1, top - 1, 0xb02a2a);
    sf.px(wx + 1, top - 1, 0xb02a2a);
    // a ring of water in the base
    for (let dx = -8; dx <= 8; dx++) if (s.water > 0.03) sf.px(wx + dx, GROUND - 5, Math.abs(dx) > 6 ? 0x7cc0e8 : 0xa8daf4);

    // treats on the grass
    for (const t of s.treats) {
      const stale = t.age > HEN.treatSpoil;
      const x = t.x, y = GROUND;
      if (t.kind === CORN) {
        for (let i = 0; i < t.bits; i++) {
          const kx = x - 5 + Math.round(hash2(t.id, i, 640) * 10), ky = y - Math.round(hash2(t.id, i, 641) * 2);
          sf.px(kx, ky, stale ? 0x9a8a50 : i % 2 ? 0xf8d850 : 0xe8b030);
        }
      } else if (t.kind === 1) {
        // a wriggling worm
        for (let k = 0; k < 7; k++) {
          const wy = y - 1 + Math.round(Math.sin(time * 6 + k * 0.9 + t.id) * 0.8);
          sf.px(x - 3 + k, wy, stale ? 0x8a6a5a : k === 6 ? 0xe89890 : 0xd07870);
          if (k % 2 === 0) sf.px(x - 3 + k, wy + 1, 0xa85850);
        }
      } else if (t.kind === 2) {
        for (let dy = -3; dy <= 0; dy++)
          for (let dx = -3; dx <= 3; dx++) if ((dx / 3.5) ** 2 + ((dy + 1.5) / 2.2) ** 2 <= 1) sf.px(x + dx, y + dy, stale ? 0x8a8a50 : dx === 0 ? 0xc8f0a0 : dy < -1 ? 0x9ae070 : 0x5aa83a);
      } else {
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 0; dy++) sf.px(x + dx, y + dy, dy === -2 || dx === 2 ? 0x3a2010 : 0x6a3a20);
        if (Math.sin(time * 4) > 0.6) sf.px(x - 1, y - 2, 0xffffff);
      }
    }
    for (const d of s.droppings) {
      sf.px(d, GROUND, 0x5a4a30);
      sf.px(d + 1, GROUND, 0x4a3a24);
      sf.px(d, GROUND - 1, 0xf0ece0);
    }
  }

  render(sf: Surface, time: number, env: Env): void {
    const m = this.model, s = m.s;
    const lamp = m.hasChick();
    const swing = m.can('swing');
    const key = `${Math.floor(env.hour * 10)}|${lamp}|${swing}`;
    if (key !== this.bgKey) {
      this.bgKey = key;
      this.buildBackground(env.hour, lamp, swing);
    }
    sf.copyFrom(this.bg);
    const sky = skyAt(env.hour);

    // clouds drift across the open sky
    if (sky.night < 1)
      for (let i = 0; i < 4; i++) {
        const cx = ((hash2(i, 0, 650) * 400 + time * (1.5 + i * 0.6)) % 400) - 40, cy = 14 + hash2(i, 1, 650) * 40;
        const w = 12 + hash2(i, 2, 650) * 10;
        const col = mix(0xffffff, sky.bot, 0.2 + sky.night * 0.6);
        for (let y = Math.floor(cy - 7); y <= cy + 4; y++)
          for (let x = Math.floor(cx - w - 2); x <= cx + w + 2; x++) {
            if (x < 0 || x >= VIEW_W || y < 0 || !this.skyMask[y * VIEW_W + x]) continue;
            const puff = Math.max(1 - ((x - cx) / w) ** 2 - ((y - cy) / 4) ** 2, 1 - ((x - cx + w * 0.3) / (w * 0.5)) ** 2 - ((y - cy + 4) / 4) ** 2, 1 - ((x - cx - w * 0.25) / (w * 0.45)) ** 2 - ((y - cy + 3) / 3.5) ** 2);
            if (puff > 0 && y <= cy + 2) sf.blend(x, y, y > cy ? mix(col, 0x8a9ab0, 0.3) : col, 0.85 * (1 - sky.night));
          }
      }

    this.drawFood(sf, time);
    // the swing's seat on its ropes
    if (swing) {
      const a = m.swing;
      const sx = SWING.x + Math.sin(a) * (SWING.seat - SWING.bar), sy = SWING.bar + Math.cos(a) * (SWING.seat - SWING.bar);
      for (const off of [-13, 13]) sf.line(SWING.x + off, SWING.bar + 1, sx + off, sy, 0xc8b490);
      for (let dx = -15; dx <= 15; dx++) {
        sf.px(Math.round(sx + dx), Math.round(sy), WOOD[0]);
        sf.px(Math.round(sx + dx), Math.round(sy) + 1, WOOD[2]);
      }
    }

    // egg shell halves left in the straw for a while after a chick hatches there
    const fresh = m.birds.find((b) => b.hatched() && b.s.age < 600 && b.isChick());
    if (fresh && lamp) {
      const c = BREEDS[fresh.s.breed].egg;
      for (const [ox, flip] of [[BROODER.x - 6, 0], [BROODER.x + 1, 1]] as const)
        for (let dx = 0; dx < 5; dx++)
          for (let k = 0; k < 3; k++) {
            const edge = k === 0 && (dx + flip) % 2 === 0;
            if (!edge) sf.px(ox + dx, GROUND + 1 - k, k === 0 ? mix(c, 0xffffff, 0.4) : dx === 4 - flip * 4 ? mix(c, 0x6a5a4a, 0.4) : c);
          }
    }

    // the eggs in the nest box
    s.nest.forEach((breed, i) => drawEgg(sf, NEST.x - 7 + i * 7, NEST.lip + 1, BREEDS[breed].egg, 0, 0, 0.8));

    // decorations under the hen house stand behind the birds
    this.decorBox.draw(sf, time, (p) => p.y <= GROUND);
    // birds further back (up in the coop, then by height) are drawn first
    const order = [...m.birds].sort((a, b) => (a.s.where === b.s.where ? a.s.y - b.s.y || a.s.id - b.s.id : a.s.where === 'coop' ? -1 : 1));
    for (const b of order) this.drawBird(sf, b, time);
    // the nest box lip goes over a hen sitting in it, and over the eggs
    for (let y = NEST.lip; y < COOP.floor; y++)
      for (let x = NEST.x0; x <= NEST.x1; x++) sf.px(x, y, y === NEST.lip ? WOOD[0] : dither(WOOD, 0.35 + (x > NEST.x1 - 4 ? 0.3 : 0) + hash2(x >> 2, y, 637) * 0.1, x, y));
    if (s.nest.length > 0 && Math.sin(time * 3) > 0.4) this.particles.spawn('sparkle', NEST.x - 7 + Math.floor(Math.random() * s.nest.length) * 7, NEST.lip - 7);

    // decorations along the front of the run stand in front of everything
    this.decorBox.draw(sf, time, (p) => p.y > GROUND);
    if (this.tool === 'decorate') this.decorBox.drawDecorating(sf, time);

    const hopping = m.birds.some((b) => b.s.state === 'hop');
    if (this.holding && m.finger && !hopping) this.drawFinger(sf, m.finger);
    this.particles.render(sf);

    // night: dark unless the lantern is on; stars and the moon come out in the open sky
    const dark = m.dark(env);
    if (dark) sf.multiply(0.4, 0.46, 0.7);
    else if (env.night) sf.multiply(0.62, 0.64, 0.8);
    if (sky.night > 0) {
      for (let i = 0; i < 70; i++) {
        const x = Math.floor(hash2(i, 0, 660) * VIEW_W), y = Math.floor(hash2(i, 1, 660) * HORIZON);
        if (!this.skyMask[y * VIEW_W + x]) continue;
        const tw = 0.5 + 0.5 * Math.sin(time * (1 + hash2(i, 2, 660) * 2) + i);
        sf.blend(x, y, 0xfff8e0, sky.night * (0.35 + 0.5 * tw));
      }
      const t = ((env.hour + 24 - 19) % 24) / 12;
      if (t < 1) {
        const mx = 30 + t * 260, my = 70 - Math.sin(t * Math.PI) * 54;
        for (let y = Math.floor(my - 9); y <= my + 9; y++)
          for (let x = Math.floor(mx - 9); x <= mx + 9; x++) {
            if (x < 0 || y < 0 || x >= VIEW_W || !this.skyMask[y * VIEW_W + x]) continue;
            const d = Math.hypot(x - mx, y - my);
            if (d < 5 && Math.hypot(x - mx - 2, y - my + 1) > 4) sf.blend(x, y, 0xfff4d0, sky.night);
            else if (d < 9) sf.add(x, y, 0x8090c0, 0.08 * sky.night);
          }
      }
    }
    // the heat lamp glows warm red on the straw, brightest at night
    if (lamp)
      for (let y = BROODER.lampY; y < GROUND + 6; y++)
        for (let x = BROODER.x - 30; x <= BROODER.x + 30; x++) {
          const d = Math.hypot((x - BROODER.x) / 1.3, y - BROODER.lampY) / 46;
          if (d < 1) sf.add(x, y, 0xff7038, (dark ? 0.32 : 0.14) * (1 - d) ** 1.6 * (0.95 + 0.05 * Math.sin(time * 2)));
        }
    if (s.light)
      for (let y = 0; y < VIEW_H; y++)
        for (let x = LANTERN.x - 110; x < VIEW_W; x++) {
          const d = Math.hypot(x - LANTERN.x, (y - LANTERN.y) * 1.2) / 110;
          if (d < 1) sf.add(x, y, 0xffd890, (env.night ? 0.42 : 0.2) * (1 - d) ** 1.5);
        }
    this.drawLantern(sf, s.light);
  }

  /** One bird: an egg, a chick popping out of one, or a bird in its current pose. */
  private drawBird(sf: Surface, b: Bird, time: number): void {
    const m = this.model, s = b.s;
    if (s.state === 'egg' || s.state === 'hatch') {
      const crack = s.state === 'hatch' ? 1 : clamp(1 - s.hatchIn / 14, 0, 1);
      // eggs wobble out of step with each other
      const t = time + s.id * 1.3;
      const wob = s.state === 'hatch' ? 0 : crack > 0 ? Math.sin(t * 18) * (Math.sin(t * 1.7) > 0.3 ? 1 : 0.15) * crack : 0;
      const floor = s.y;
      const c = BREEDS[s.breed].egg;
      if (s.where === 'yard') groundShadow(sf, s.x, floor, 6, 0.3, 0x3a2a10);
      if (s.state === 'egg') drawEgg(sf, s.x, floor + 1, c, crack, wob, s.where === 'coop' ? 0.9 : 1.25);
      else {
        // the chick pops out between two halves of shell
        const k = clamp(1 - s.timer / 2.5, 0, 1);
        drawChicken(sf, { x: s.x + 1, y: floor, face: 1, pose: 'sit', grow: 0, breed: s.breed, phase: 0, breath: 0.5, blink: k < 0.4, fluff: 0.5 });
        for (let dx = -5; dx <= 5; dx++)
          for (let dy = 0; dy < 5; dy++) if ((dx / 5.4) ** 2 + ((dy - 4) / 4.5) ** 2 <= 1 && !(dy === 0 && dx % 2)) sf.px(s.x + dx, floor + 1 - (4 - dy), dx > 2 ? mix(c, 0x6a5a4a, 0.3) : c);
        const lid = { x: s.x - 6 - k * 6, y: floor - 10 + k * 8 };
        for (let dx = -4; dx <= 4; dx++) for (let dy = -3; dy <= 0; dy++) if ((dx / 4.4) ** 2 + ((dy + 0.5) / 3.6) ** 2 <= 1 && dy < 0) sf.px(lid.x + dx, lid.y + dy, c);
      }
      return;
    }
    const pose = this.pose(b, time);
    if (s.state === 'hop' && m.finger) this.drawFinger(sf, m.finger);
    // a bird stands over a soft shadow, unless it is up on the swing or a hand
    if (s.state !== 'swing' && s.state !== 'hop') {
      const floor = s.where === 'coop' ? (s.y < COOP.floor - 1 ? s.y : COOP.floor) : GROUND;
      groundShadow(sf, s.x, floor, Math.round(5 + 8 * b.growth()), 0.25, 0x2a2010);
    }
    // a broody hen's egg peeks out from under her
    if (s.broody > 0 && (s.state === 'brood' || s.state === 'sleep') && s.where === 'coop') drawEgg(sf, s.x - 9 * s.facing, NEST.lip + 1, BREEDS[s.broodBreed].egg, 0, 0, 0.8);
    drawChicken(sf, pose);
    // roosting: the perch goes in front of its feet
    if (s.where === 'coop' && s.y < COOP.floor - 1 && s.state !== 'walk')
      for (let x = PERCH.x0; x <= PERCH.x1; x++) {
        sf.px(x, PERCH.y - 1, WOOD[0]);
        sf.px(x, PERCH.y, WOOD[1]);
        sf.px(x, PERCH.y + 1, WOOD[3]);
      }
  }

  /** How a bird looks right now. */
  private pose(b: Bird, time: number): ChickPose {
    const s = b.s;
    let pose: ChickPoseName = 'stand';
    const at = b.drawnAt();
    let face = s.facing;
    // birds keep their own time, so a flock does not move in step
    time += s.id * 0.77;
    let phase = time * 2;
    let fluff = 0;
    const g = b.growth();
    switch (s.state) {
      case 'walk':
        pose = 'walk';
        phase = time * (g < 0.4 ? 4 : 2.6);
        break;
      case 'peck':
      case 'eat':
        pose = 'peck';
        phase = time * 1.6;
        break;
      case 'drink':
        pose = 'peck';
        phase = time * 0.7;
        break;
      case 'scratch':
        pose = 'scratch';
        phase = time * 2.4;
        break;
      case 'warm':
        pose = 'sit';
        fluff = 0.8;
        break;
      case 'sleep':
        pose = 'sleep';
        fluff = 1;
        break;
      case 'lay':
        pose = 'sit';
        fluff = 0.6;
        break;
      case 'brood':
        pose = 'sit';
        fluff = 1;
        break;
      case 'swing':
      case 'hop':
        pose = 'sit';
        if (s.state === 'hop') face = -1;
        break;
      case 'flap':
        pose = 'flap';
        phase = time * 3;
        break;
      case 'dust':
        pose = 'dust';
        face = Math.sin(time * 3) > 0 ? 1 : -1;
        fluff = 1;
        break;
      case 'cheep':
      case 'refuse':
        pose = 'cheep';
        break;
      case 'wake':
        pose = 'stand';
        fluff = 0.5;
        break;
      default:
        pose = Math.sin(time * 0.5 + s.x) > 0.2 ? 'stand' : Math.sin(time * 0.31 + s.x * 2) > 0 ? 'peck' : 'cheep';
        phase = time * 1.2;
    }
    const blink = s.state === 'wake' ? Math.sin(time * 3) > -0.3 : s.state === 'warm' || s.state === 'brood' ? Math.sin(time * 0.8) > 0.3 : Math.sin(time * 1.1 + 2) > 0.985;
    // a sitting bird is drawn a touch lower, nestled in
    const y = at.y + (pose === 'sit' || pose === 'sleep' ? 1 : 0);
    return { x: at.x, y, face, pose, grow: lerp(0, 1, g), breed: s.breed, phase, breath: 0.5 + 0.5 * Math.sin(time * (s.state === 'sleep' ? 1.6 : 3)), blink, fluff };
  }
}
