import { clamp, hash2 } from '../../core/rng';
import type { Env } from '../../core/time';
import { Particles } from '../../render/particles';
import { dither, mix, Surface, VIEW_H, VIEW_W } from '../../render/surface';
import type { Habitat, Stat, Status, Tool, UiEvent } from '../types';
import { drawButterfly, drawCaterpillar, drawChrysalis, drawFlower, drawLeaf, drawOrange } from './art';
import {
  BFLY, FLOWER_X, HANG, JAR, Jar, ORANGE_X, SLOTS, STEM_TOP, newJarState, stemX,
  type Bug, type Pt, type Stage,
} from './model';

const BACK = [0xe6f3dc, 0xcfe6c8, 0xb4d6b6, 0x98c4a3];
const SOIL = [0x9a7a56, 0x7d6042, 0x634a32, 0x4c3826];
const POT = [0xd98a5a, 0xc0703f, 0xa0572e, 0x7d4222];
const WOOD = [0x8a6540, 0x6f4f31, 0x573c25];

const STAGE_WORD: Record<Stage, string> = { egg: 'Egg', cat: 'Caterpillar', pupa: 'Chrysalis', fly: 'Butterfly' };

export class ButterflyHabitat implements Habitat {
  readonly id = 'butterfly';
  tool = 'hand';
  model: Jar;
  private particles = new Particles();
  private bg = new Surface(VIEW_W, VIEW_H);
  private bgReady = false;
  private events: UiEvent[] = [];
  /** Where each caterpillar's head has been, so the body can follow. */
  private trails = new Map<number, Pt[]>();

  constructor(saved: unknown, seed: number) {
    this.model = saved ? Jar.load(saved, seed) : new Jar(newJarState(seed));
  }

  get name(): string {
    return this.model.s.name;
  }
  set name(v: string) {
    this.model.s.name = v;
  }

  // ---- simulation --------------------------------------------------------

  private trail(b: Bug): Pt[] {
    let t = this.trails.get(b.id);
    if (!t) {
      // start with the body laid out behind the head along the branch
      t = Array.from({ length: 40 }, (_, i) => ({ x: b.x - b.facing * (39 - i), y: b.y }));
      this.trails.set(b.id, t);
    }
    const last = t[t.length - 1];
    if (Math.hypot(last.x - b.x, last.y - b.y) > 0.5) {
      t.push({ x: b.x, y: b.y });
      if (t.length > 90) t.shift();
    }
    return t;
  }

  update(dt: number, slowDt: number, env: Env): void {
    const m = this.model;
    m.update(dt, slowDt, env);
    for (const b of m.s.bugs) if (b.stage === 'cat') this.trail(b);

    const toast = (text: string) => this.events.push({ type: 'toast', text });
    for (const fx of m.fx) {
      switch (fx.kind) {
        case 'munch':
          this.particles.spawn('crumb', fx.x, fx.y - 2, 0x6fbf45);
          this.events.push({ type: 'sound', name: 'munch' });
          break;
        case 'hatch':
          this.particles.spawn('sparkle', fx.x, fx.y);
          toast('The egg hatched! Say hello to a tiny caterpillar 🐛');
          this.events.push({ type: 'sound', name: 'hatch' });
          break;
        case 'moult':
          this.particles.spawn('sparkle', fx.x, fx.y - 3);
          toast('The caterpillar shed its skin and grew bigger!');
          break;
        case 'pupate':
          toast("It's turning into a chrysalis. Something amazing is happening inside!");
          this.events.push({ type: 'sound', name: 'pop' });
          break;
        case 'emerge':
          for (let i = 0; i < 5; i++) this.particles.spawn('sparkle', fx.x + (Math.random() - 0.5) * 16, fx.y + Math.random() * 12);
          toast(`A ${fx.text} butterfly came out! 🦋`);
          this.events.push({ type: 'sound', name: 'hatch' });
          break;
        case 'egg':
          this.particles.spawn('sparkle', fx.x, fx.y);
          toast('A butterfly laid a new egg on a leaf!');
          break;
        case 'heart':
          this.particles.spawn('heart', fx.x, fx.y);
          this.events.push({ type: 'sound', name: 'chirp' });
          break;
        case 'mist':
          for (let i = 0; i < 26; i++)
            this.particles.spawn('drop', JAR.left + 10 + Math.random() * (JAR.right - JAR.left - 20), JAR.top + Math.random() * 40);
          this.events.push({ type: 'sound', name: 'splash' });
          break;
        case 'sparkle':
          this.particles.spawn('sparkle', fx.x, fx.y);
          this.events.push({ type: 'sound', name: 'pop' });
          break;
        case 'plop':
          this.events.push({ type: 'sound', name: 'plop' });
          break;
        case 'no':
          this.particles.spawn('no', fx.x, fx.y);
          this.events.push({ type: 'sound', name: 'no' });
          break;
        case 'flutter':
          this.events.push({ type: 'sound', name: 'tap' });
          break;
      }
    }
    m.fx.length = 0;
    this.particles.update(dt, 0, JAR.floor);
  }

  coarseStep(dt: number, env: Env): void {
    this.model.coarseStep(dt, env);
  }

  beginCatchup(): () => string[] {
    const before = new Map(this.model.s.bugs.map((b) => [b.id, b.stage]));
    return () => {
      const m = this.model;
      m.fx.length = 0;
      this.trails.clear();
      const out: string[] = [];
      for (const b of m.s.bugs) {
        const was = before.get(b.id);
        if (was === b.stage) continue;
        if (!was) out.push('a butterfly laid an egg');
        else if (b.stage === 'cat') out.push('the egg hatched');
        else if (b.stage === 'pupa') out.push('the caterpillar became a chrysalis');
        else if (b.stage === 'fly') out.push('a butterfly came out of its chrysalis');
      }
      if (m.count('cat') && m.freshLeafAmount() < 0.1) out.push('the caterpillar ate all its leaves');
      if (!out.length) out.push('the jar was peaceful');
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
    if (this.tool === 'clean') {
      if (m.brush(x, y) === 0 && kind === 'down') this.particles.spawn('ripple', x, y);
      return;
    }
    if (kind === 'down') {
      const b = m.hit(x, y);
      if (b) m.touch(b);
      else {
        this.particles.spawn('ripple', x, y);
        this.events.push({ type: 'sound', name: 'tap' });
      }
    }
    // a finger held inside the jar invites a butterfly to land on it
    if (x > JAR.left && x < JAR.right && y > JAR.top && y < JAR.floor) m.finger = { x, y };
  }

  tools(): Tool[] {
    return [
      { id: 'hand', icon: '✋', label: 'Touch', kind: 'mode' },
      { id: 'leaf', icon: '🍃', label: 'Leaf', kind: 'action' },
      { id: 'flower', icon: '🌼', label: 'Flower', kind: 'action' },
      { id: 'orange', icon: '🍊', label: 'Orange', kind: 'action' },
      { id: 'mist', icon: '💦', label: 'Mist', kind: 'action' },
      { id: 'clean', icon: '🧹', label: 'Tidy', kind: 'mode' },
      { id: 'lamp', icon: '💡', label: 'Lamp', kind: 'toggle', on: this.model.s.lamp },
    ];
  }

  useTool(id: string): void {
    const m = this.model;
    const toast = (text: string) => this.events.push({ type: 'toast', text });
    switch (id) {
      case 'leaf':
        if (!m.addLeaf()) toast('The plant is full of fresh leaves already!');
        break;
      case 'flower':
        if (!m.addFlower()) toast('There is no room for more flowers.');
        else if (!m.count('fly')) toast('Pretty! Butterflies drink from flowers. Caterpillars only eat leaves.');
        break;
      case 'orange':
        if (!m.addOrange()) toast('There is still plenty of orange left.');
        break;
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

  stats(): Stat[] {
    const m = this.model;
    const f = m.focus();
    const stage = f.stage === 'cat' ? `Caterpillar (size ${m.instar(f) + 1} of ${BFLY.instars})` : STAGE_WORD[f.stage];
    const out: Stat[] = [{ icon: f.stage === 'fly' ? '🦋' : f.stage === 'egg' ? '🥚' : '🐛', label: 'Now', value: stage }];
    if (f.stage === 'cat' || f.stage === 'fly') out.push({ icon: '🍽️', label: 'Tummy', value: f.fullness });
    out.push(
      { icon: '🍃', label: 'Leaves', value: clamp((m.freshLeafAmount() / 3) * 100, 0, 100) },
      { icon: '💧', label: 'Damp', value: m.s.humidity },
      { icon: '✨', label: 'Tidy', value: m.cleanliness() },
    );
    if (m.count('fly') && f.stage !== 'fly') out.push({ icon: '🦋', label: 'Butterflies', value: String(m.count('fly')) });
    return out;
  }

  status(env: Env): Status {
    const m = this.model;
    const bugs = m.s.bugs;
    if (bugs.some((b) => b.stage === 'cat' && b.fullness < 30) && m.freshLeafAmount() < 0.05) return { text: 'Needs leaves!', tone: 'warn' };
    if (bugs.some((b) => b.stage === 'fly' && b.fullness < 30) && !m.feeds().length) return { text: 'Needs flowers!', tone: 'warn' };
    if (m.s.humidity < BFLY.dryBelow) return { text: 'Too dry', tone: 'warn' };
    if (m.cleanliness() < BFLY.messyBelow) return { text: 'Messy jar', tone: 'warn' };
    if (m.dark(env)) return { text: 'Sleeping…', tone: 'sleep' };
    const f = m.focus();
    const text = { egg: 'Hatching soon', cat: f.state === 'eat' ? 'Munching' : 'Growing', pupa: 'Changing…', fly: 'Fluttering' }[f.stage];
    return { text, tone: 'good' };
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

  /** The parts that never change: soft garden backdrop, soil, pot, stem, jar. */
  private buildBackground(): void {
    const sf = this.bg;
    for (let y = 0; y < VIEW_H; y++)
      for (let x = 0; x < VIEW_W; x++) sf.px(x, y, dither(BACK, y / VIEW_H + Math.sin(x * 0.02) * 0.06, x, y));
    // out-of-focus garden light
    for (let i = 0; i < 16; i++) {
      const cx = hash2(i, 1, 90) * VIEW_W, cy = hash2(i, 2, 90) * 120, r = 7 + hash2(i, 3, 90) * 13;
      sf.disc(cx, cy, r, r, i % 3 ? 0xf6fbe6 : 0x8fc49a, 0.2);
    }
    // soil
    for (let y = JAR.floor; y < 172; y++)
      for (let x = JAR.left - 4; x < JAR.right + 4; x++) {
        const n = hash2(x, y, 91);
        let c = dither(SOIL, (y - JAR.floor) / 16 + n * 0.5, x, y);
        if (y === JAR.floor) c = mix(c, 0xc9a877, 0.5);
        if (n > 0.96) c = 0xc9b08a;
        sf.px(x, y, c);
      }
    // shelf under the jar
    for (let y = 172; y < VIEW_H; y++) for (let x = 0; x < VIEW_W; x++) sf.px(x, y, dither(WOOD, (y - 172) / 8 + hash2(x >> 3, y, 92) * 0.3, x, y));
    // terracotta pot
    for (let y = JAR.potTop; y < JAR.floor + 2; y++) {
      const half = 14 - Math.round(((y - JAR.potTop) / (JAR.floor - JAR.potTop)) * 4) + (y < JAR.potTop + 3 ? 2 : 0);
      for (let dx = -half; dx <= half; dx++) sf.px(JAR.potX + dx, y, dither(POT, (dx + half) / (2 * half) + (y < JAR.potTop + 3 ? -0.1 : 0.05), JAR.potX + dx, y));
    }
    // stem and side branches
    const twig = (a: Pt, b: Pt, w: number) => {
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
      for (let i = 0; i <= n; i++) {
        const x = Math.round(a.x + ((b.x - a.x) * i) / n), y = Math.round(a.y + ((b.y - a.y) * i) / n);
        for (let k = 0; k < w; k++) sf.px(x, y + k, k === 0 ? 0x7fae4e : 0x4f7f36);
      }
    };
    for (let y = JAR.potTop; y >= STEM_TOP; y--) {
      const x = Math.round(stemX(y));
      sf.px(x - 1, y, 0x4f7f36);
      sf.px(x, y, 0x7fae4e);
      sf.px(x + 1, y, 0x3d6a2c);
    }
    for (const sl of SLOTS) twig(sl.j, sl.tip, 2);
    twig(HANG.j, HANG.tip, 2);
  }

  render(sf: Surface, time: number, env: Env): void {
    const m = this.model, s = m.s;
    if (!this.bgReady) {
      this.bgReady = true;
      this.buildBackground();
    }
    sf.copyFrom(this.bg);
    const dark = m.dark(env);
    const sway = Math.sin(time * 0.8);

    // flowers, orange, droppings
    s.flowers.forEach((f, i) => f && drawFlower(sf, FLOWER_X[i], JAR.floor, i, !m.flowerFresh(i), f.left, Math.sin(time * 0.7 + i) * 1.5));
    if (s.orange) drawOrange(sf, ORANGE_X, JAR.floor, s.orange.left, !m.orangeFresh());
    for (const fx of s.frass) {
      sf.px(fx, JAR.floor - 1, 0x2e2a1c);
      sf.px(fx + 1, JAR.floor - 1, 0x3d3826);
    }

    // leaves, then eggs resting on them
    s.leaves.forEach((l, i) => l && drawLeaf(sf, SLOTS[i].tip, SLOTS[i].dir, l.left, !m.leafFresh(i), sway + i));

    for (const b of s.bugs) {
      if (b.stage === 'egg') {
        sf.px(b.x + SLOTS[b.slot]?.dir * 6, b.y, 0xfbf6dc);
        sf.px(b.x + SLOTS[b.slot]?.dir * 6, b.y - 1, 0xfffdf0);
        sf.px(b.x + SLOTS[b.slot]?.dir * 6 + 1, b.y, 0xd9d2b0);
      } else if (b.stage === 'cat') {
        const moving = b.path.length > 0;
        if (b.state === 'hang') {
          // hanging in a J before the change
          const look = Array.from({ length: 30 }, (_, i) => ({ x: b.x + Math.max(0, i - 24) * 0.8, y: b.y + 26 - i * 0.9 + Math.max(0, i - 24) }));
          drawCaterpillar(sf, look.reverse(), b.t, b.species, time, false, false);
        } else drawCaterpillar(sf, this.trail(b), b.t, b.species, time, moving, b.state === 'rear' || b.state === 'moult');
      } else if (b.stage === 'pupa') {
        drawChrysalis(sf, Math.round(b.x), Math.round(b.y), b.t, b.species, Math.sin(time * 3 + b.id) * (b.t > 0.9 ? 0.6 : 0.12));
      }
    }
    for (const b of s.bugs) {
      if (b.stage !== 'fly') continue;
      const flying = b.state === 'fly' || b.state === 'toFeed' || b.state === 'toFinger';
      const asleep = dark && !flying;
      let flap: number;
      if (b.emerge < 1) flap = 1;
      else if (flying) flap = Math.sin(time * 16 + b.id * 2);
      else flap = 0.7 + 0.3 * Math.sin(time * (b.state === 'sip' ? 1.4 : 2.2) + b.id); // slow basking beats
      drawButterfly(sf, Math.round(b.x), Math.round(b.y), b.facing, flap, 0.35 + 0.65 * b.emerge, b.species, asleep || b.emerge < 0.5);
    }

    this.particles.render(sf);

    // beads of water on the glass when it is nice and damp
    for (let i = 0; i < Math.round(s.humidity / 5); i++) {
      const left = i % 2 === 0;
      const x = left ? JAR.left - 2 + hash2(i, 1, 93) * 10 : JAR.right - 8 + hash2(i, 1, 93) * 10;
      const y = JAR.top + 8 + hash2(i, 2, 93) * 130;
      sf.blend(x, y, 0xffffff, 0.7);
      sf.blend(x, y + 1, 0xbfe8f5, 0.5);
    }

    if (dark) sf.multiply(0.32, 0.38, 0.6);
    else if (s.lamp) for (let y = 0; y < 50; y++) for (let x = 0; x < VIEW_W; x++) sf.add(x, y, 0xfff0c0, 0.14 * (1 - y / 50));

    // the jar: glass walls, a metal lid with air holes, and a glare
    for (let y = JAR.top - 4; y < 174; y++) {
      for (const [x, a] of [[JAR.left - 6, 0.55], [JAR.left - 5, 0.3], [JAR.right + 5, 0.3], [JAR.right + 6, 0.55]] as const) sf.blend(x, y, 0xffffff, a);
      sf.blend(JAR.left - 7, y, 0x5a7a80, 0.5);
      sf.blend(JAR.right + 7, y, 0x5a7a80, 0.5);
    }
    for (let x = JAR.left - 7; x <= JAR.right + 7; x++) sf.blend(x, 174, 0x5a7a80, 0.6);
    const LID = [0xcfd6da, 0xa9b3b9, 0x7f8a91, 0x5c666c];
    for (let y = 0; y < JAR.top - 4; y++)
      for (let x = JAR.left - 10; x <= JAR.right + 10; x++) sf.px(x, y, dither(LID, y / 12 + (x % 9 === 0 ? 0.25 : 0), x, y));
    for (let x = JAR.left + 12; x < JAR.right - 8; x += 22) sf.rect(x, 4, 4, 2, 0x2a3034);
    for (let i = 0; i < 90; i++) {
      sf.add(34 + i * 0.5, 22 + i * 1.5, 0xffffff, 0.06);
      sf.add(35 + i * 0.5, 22 + i * 1.5, 0xffffff, 0.06);
      sf.add(42 + i * 0.5, 22 + i * 1.5, 0xffffff, 0.03);
    }
  }
}
