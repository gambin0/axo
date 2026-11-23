import { clamp, hash2 } from '../../core/rng';
import type { Env } from '../../core/time';
import { drawDomeLamp } from '../../render/glass';
import { Particles } from '../../render/particles';
import { dither, mix, Surface, VIEW_H, VIEW_W } from '../../render/surface';
import { DecorBox, DECORATE_TOOL, unlockText } from '../decor';
import type { DecorPicker, DropHint, Habitat, Stat, Status, Tool, UiEvent } from '../types';
import { drawButterfly, drawCaterpillar, drawChrysalis, drawFlower, drawLeaf, drawOrange } from './art';
import { JAR_DECOR, JAR_DECOR_AREAS, jarPreviewBg } from './decor';
import {
  BFLY, FLOWER_X, HANG, JAR, Jar, ORANGE_X, SLOTS, STEM_TOP, newJarState, stemX,
  type Bug, type Pt, type Stage,
} from './model';

const SOIL = [0x9a7a56, 0x7d6042, 0x634a32, 0x4c3826];
const POT = [0xd98a5a, 0xc0703f, 0xa0572e, 0x7d4222];
const RIM = [0x7ab8a0, 0x5a9a84, 0x3e7a68, 0x2a5a4c];
const LAMP = { x: 44, y: 13 };
type Sky = 'day' | 'dusk' | 'night';
const skyAt = (hour: number): Sky => (hour >= 20 || hour < 6 ? 'night' : hour >= 18 || hour < 7.5 ? 'dusk' : 'day');

const STAGE_WORD: Record<Stage, string> = { egg: 'Egg', cat: 'Caterpillar', pupa: 'Chrysalis', fly: 'Butterfly' };

export class ButterflyHabitat implements Habitat {
  readonly id = 'butterfly';
  tool = 'hand';
  model: Jar;
  private particles = new Particles();
  private bg = new Surface(VIEW_W, VIEW_H);
  private bgReady = false;
  private sky: Sky = 'day';
  private events: UiEvent[] = [];
  /** Where each caterpillar's head has been, so the body can follow. */
  private trails = new Map<number, Pt[]>();

  private decorBox: DecorBox;
  /** Decorations a butterfly has been seen resting on, so each is told once. */
  private landed = new Set<string>();

  constructor(saved: unknown, seed: number) {
    this.model = saved ? Jar.load(saved, seed) : new Jar(newJarState(seed));
    // decorations are earned along the life cycle: caterpillar, chrysalis, butterfly
    this.decorBox = new DecorBox({
      items: JAR_DECOR, areas: JAR_DECOR_AREAS, placed: () => this.model.s.decor, level: () => this.model.progress(), previewBg: jarPreviewBg,
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
    for (const d of this.decorBox.newlyUnlocked()) {
      this.events.push({ type: 'sound', name: 'pop' });
      toast(unlockText(d));
    }
    this.decorBox.update(dt);
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
        case 'land': {
          const what = JAR_DECOR.find((d) => d.id === fx.text);
          if (what && !this.landed.has(what.id)) {
            this.landed.add(what.id);
            toast(`A butterfly is resting on the ${what.label.toLowerCase()}!`);
          }
          break;
        }
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
      this.decorBox.pointer('up', x, y);
      return;
    }
    if (this.tool === 'decorate') {
      if (!this.decorBox.pointer(kind, x, y) && kind === 'down') this.particles.spawn('ripple', x, y);
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
      { id: 'leaf', icon: '🍃', label: 'Leaf', kind: 'drag' },
      { id: 'flower', icon: '🌼', label: 'Flower', kind: 'drag' },
      { id: 'orange', icon: '🍊', label: 'Orange', kind: 'drag' },
      { id: 'mist', icon: '💦', label: 'Mist', kind: 'action' },
      { id: 'clean', icon: '🧹', label: 'Tidy', kind: 'mode' },
      DECORATE_TOOL,
      { id: 'lamp', icon: '💡', label: 'Lamp', kind: 'toggle', on: this.model.s.lamp },
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

  drop(id: string, _at?: { x: number; y: number } | null): void {
    const m = this.model;
    const toast = (text: string) => this.events.push({ type: 'toast', text });
    // each of these has its own place in the jar, wherever it is let go
    if (id === 'leaf') {
      if (!m.addLeaf()) toast('The plant is full of fresh leaves already!');
    } else if (id === 'flower') {
      if (!m.addFlower()) toast('There is no room for more flowers.');
      else if (!m.count('fly')) toast('Pretty! Butterflies drink from flowers. Caterpillars only eat leaves.');
    } else if (id === 'orange') {
      if (!m.addOrange()) toast('There is still plenty of orange left.');
    }
  }

  dropHint(id: string): DropHint | null {
    const m = this.model, s = m.s;
    if (id === 'leaf') {
      let i = s.leaves.findIndex((l) => !l);
      if (i < 0) i = s.leaves.findIndex((_, k) => !m.leafFresh(k));
      const sl = SLOTS[Math.max(0, i)];
      return { x: sl.tip.x + sl.dir * 10, y: sl.tip.y, ok: i >= 0 };
    }
    if (id === 'flower') {
      let i = s.flowers.findIndex((f) => !f);
      if (i < 0) i = s.flowers.findIndex((_, k) => !m.flowerFresh(k));
      return { x: FLOWER_X[Math.max(0, i)], y: JAR.floor - 20, ok: i >= 0 };
    }
    if (id === 'orange') return { x: ORANGE_X, y: JAR.floor - 4, ok: !(m.orangeFresh() && s.orange!.left > 0.5) };
    return null;
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

  /**
   * The parts that never change: a garden window behind, the windowsill, the habitat's floor,
   * the pot and the plant. The habitat itself (mesh, rim, zip) is drawn over everything each frame.
   */
  private buildBackground(sky: Sky): void {
    const sf = this.bg;
    // the garden outside the window, soft and out of focus
    const [top, bot] = sky === 'day' ? [0x9cd2ee, 0xe4f4ea] : sky === 'dusk' ? [0x7a7ab8, 0xf6c09a] : [0x141c3c, 0x2e3a64];
    for (let y = 0; y < VIEW_H; y++)
      for (let x = 0; x < VIEW_W; x++) sf.px(x, y, mix(top, bot, Math.min(1, y / 90)));
    const leafy = sky === 'night' ? [0x24364a, 0x2e4456] : [0x8cc48a, 0x6aac74];
    // a hedge along the bottom of the window, soft-edged because it is out of focus
    for (let x = 0; x < VIEW_W; x++) {
      const h = 96 + Math.sin(x * 0.035) * 8 + Math.sin(x * 0.11 + 1) * 4;
      for (let y = Math.floor(h - 6); y < 168; y++) {
        const a = clamp((y - (h - 6)) / 10, 0, 1);
        sf.blend(x, y, mix(leafy[0], leafy[1], clamp((y - h) / 60, 0, 1)), a * 0.75);
      }
    }
    for (let i = 0; i < 26; i++) {
      // flowers in the hedge, just soft blobs of colour
      const cx = hash2(i, 4, 90) * VIEW_W, cy = 112 + hash2(i, 5, 90) * 44, r = 2.5 + hash2(i, 6, 90) * 3;
      const col = sky === 'night' ? 0x3a4a66 : [0xf4a6c0, 0xfff0a0, 0xffffff, 0xc8a8f0][i % 4];
      sf.disc(cx, cy, r + 1.5, r + 1.5, col, 0.15);
      sf.disc(cx, cy, r, r, col, 0.35);
    }
    if (sky === 'night')
      for (let i = 0; i < 40; i++) sf.px(hash2(i, 7, 90) * VIEW_W, hash2(i, 8, 90) * 60, 0xfff8d8);
    // the windowsill
    for (let y = 168; y < VIEW_H; y++)
      for (let x = 0; x < VIEW_W; x++) sf.px(x, y, y === 168 ? 0xffffff : y < 171 ? 0xf2ece2 : dither([0xe0d8ca, 0xc8beac, 0xa89e8c], (y - 171) / 9, x, y));
    // the habitat's floor: soil with moss, a few fallen leaves and pebbles
    for (let y = JAR.floor; y < 168; y++)
      for (let x = JAR.left - 6; x < JAR.right + 6; x++) {
        const n = hash2(x, y, 91);
        let c = dither(SOIL, (y - JAR.floor) / 12 + n * 0.5, x, y);
        if (y === JAR.floor) c = mix(c, 0xc9a877, 0.45);
        if (n > 0.96) c = 0xc9b08a;
        sf.px(x, y, c);
      }
    for (const [mx, w] of [[40, 14], [96, 9], [176, 12], [292, 10]])
      for (let dx = -w; dx <= w; dx++) {
        const h = Math.round(3 * Math.sqrt(1 - (dx / (w + 0.5)) ** 2) + hash2(mx + dx, 0, 94) * 1.5);
        for (let k = 0; k < h; k++) sf.px(mx + dx, JAR.floor - k, k === h - 1 ? 0x9ad46a : hash2(mx + dx, k, 95) > 0.5 ? 0x6aa848 : 0x548c3a);
      }
    for (let i = 0; i < 9; i++) {
      const x = 30 + hash2(i, 1, 96) * 260, a = (hash2(i, 2, 96) - 0.5) * 0.6;
      const col = [0xc88a3a, 0xa86a2a, 0xd8b050][i % 3];
      for (let t = 0; t < 6; t++) for (let u = -1; u <= 1; u++) if (Math.abs(u) <= Math.sin((t / 6) * Math.PI) * 1.6) sf.px(Math.round(x + Math.cos(a) * t), Math.round(JAR.floor + 1 + Math.sin(a) * t + u * 0.6), u === 0 ? mix(col, 0x000000, 0.2) : col);
    }
    for (const [px, r] of [[150, 2.2], [252, 1.6], [70, 1.4]]) {
      sf.disc(px, JAR.floor, r * 1.3, r, 0x9a968c);
      sf.px(Math.round(px - r * 0.5), Math.round(JAR.floor - r * 0.5), 0xd8d4ca);
    }
    // terracotta pot with a rim, a highlight and soil showing
    for (let y = JAR.potTop; y < JAR.floor + 2; y++) {
      const rim = y < JAR.potTop + 4;
      const half = rim ? 16 : 14 - Math.round(((y - JAR.potTop - 4) / (JAR.floor - JAR.potTop - 4)) * 3);
      for (let dx = -half; dx <= half; dx++) {
        let t = (dx + half) / (2 * half) * 0.75 + (rim ? -0.1 : 0.1);
        if (dx === -half + 3) t -= 0.25;
        if (rim && y === JAR.potTop) t = 0;
        if (!rim && y === JAR.potTop + 4) t += 0.35;
        sf.px(JAR.potX + dx, y, dither(POT, clamp(t, 0, 1), JAR.potX + dx, y));
      }
    }
    for (let dx = -13; dx <= 13; dx++) sf.px(JAR.potX + dx, JAR.potTop + 1, dx % 3 ? 0x4c3826 : 0x634a32);
    // the stem: thicker at the base, with a little node where each branch leaves
    for (let y = JAR.potTop + 1; y >= STEM_TOP; y--) {
      const x = Math.round(stemX(y));
      const w = y > 100 ? 2 : 1;
      for (let k = -w; k <= w - 1 + (w > 1 ? 1 : 0); k++) sf.px(x + k, y, k === -w ? 0x9ac868 : k >= w - 1 + (w > 1 ? 1 : 0) - 0 && k > -w ? 0x3d6a2c : 0x5a8c3c);
    }
    // branches curve gently out and end in a bud, so a branch without a leaf still looks alive
    const twig = (a: Pt, b: Pt) => {
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        const x = Math.round(a.x + (b.x - a.x) * f), y = Math.round(a.y + (b.y - a.y) * f - Math.sin(f * Math.PI) * 3);
        sf.px(x, y, 0x6a9c44);
        if (f < 0.6) sf.px(x, y + 1, 0x3d6a2c);
      }
      sf.disc(b.x, b.y - 1, 1.6, 1.3, 0x8ac458);
      sf.px(Math.round(b.x), Math.round(b.y) - 2, 0xc8ec90);
      sf.disc(a.x, a.y, 1.6, 1.6, 0x4a7c34);
    };
    for (const sl of SLOTS) twig(sl.j, sl.tip);
    twig(HANG.j, HANG.tip);
  }

  /** The pop-up habitat in front: fine mesh, sides curving away, a fabric rim along the top with a zip. */
  private drawHabitat(sf: Surface): void {
    const L = JAR.left - 8, R = JAR.right + 8;
    for (let y = 14; y < 168; y++)
      for (let x = L; x <= R; x++) {
        // the sides curve away from us, so the mesh looks denser and darker there
        const e = Math.max(0, 1 - Math.min(x - L, R - x) / 16);
        if (x % 3 === 0 && y % 3 === 0) sf.blend(x, y, 0x1c2a24, 0.06 + e * 0.12);
        else if ((x + y) % 3 === 0) sf.blend(x, y, 0x1c2a24, 0.015 + e * 0.05);
        if (e > 0) sf.blend(x, y, 0x1c2a24, e * e * 0.25);
      }
    // seams down the sides and along the base
    for (let y = 14; y < 168; y++) {
      sf.px(L, y, 0x2e3a34);
      sf.px(L + 1, y, 0x58685e);
      sf.px(R, y, 0x2e3a34);
      sf.px(R - 1, y, 0x58685e);
    }
    for (let x = L; x <= R; x++) {
      sf.px(x, 166, 0x58685e);
      sf.px(x, 167, 0x2e3a34);
    }
    // the fabric rim over the top hoop
    for (let y = 2; y < 14; y++)
      for (let x = L - 2; x <= R + 2; x++) {
        let t = 0.3 + (y - 2) / 24 + (y === 2 ? -0.3 : 0) + (y === 13 ? 0.5 : 0);
        if (y === 7) t += 0.25; // the stitched seam
        if (y === 7 && x % 4 < 2) t -= 0.35;
        sf.px(x, y, dither(RIM, clamp(t, 0, 1), x, y));
      }
    // a zip along the rim, with its pull tab
    for (let x = L + 30; x < R - 30; x++) {
      sf.px(x, 11, x % 2 ? 0xc8ccd0 : 0x7a8086);
      sf.px(x, 12, 0x3a4248);
    }
    sf.rect(R - 34, 10, 4, 4, 0xd8dce0);
    sf.rect(R - 33, 14, 2, 4, 0xa8b0b6);
    sf.px(R - 33, 17, 0x6a7278);
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
    const sway = Math.sin(time * 0.8);

    // flowers, orange, droppings
    s.flowers.forEach((f, i) => f && drawFlower(sf, FLOWER_X[i], JAR.floor, i, !m.flowerFresh(i), f.left, Math.sin(time * 0.7 + i) * 1.5));
    if (s.orange) drawOrange(sf, ORANGE_X, JAR.floor, s.orange.left, !m.orangeFresh());
    for (const fx of s.frass) {
      sf.px(fx, JAR.floor - 1, 0x2e2a1c);
      sf.px(fx + 1, JAR.floor - 1, 0x3d3826);
    }

    // decorations on the floor, in the gaps between the pot, the orange and the flowers
    this.decorBox.draw(sf, time);
    if (this.tool === 'decorate') this.decorBox.drawDecorating(sf, time);

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

    // beads of water on the mesh when it is nice and damp
    for (let i = 0; i < Math.round(s.humidity / 5); i++) {
      const left = i % 2 === 0;
      const x = left ? JAR.left - 4 + hash2(i, 1, 93) * 12 : JAR.right - 8 + hash2(i, 1, 93) * 12;
      const y = JAR.top + 8 + hash2(i, 2, 93) * 130;
      sf.blend(x, y, 0xffffff, 0.7);
      sf.blend(x, y + 1, 0xbfe8f5, 0.5);
    }

    if (s.lamp)
      for (let y = 14; y < 120; y++)
        for (let x = JAR.left; x < 190; x++) {
          const d = Math.hypot(x - LAMP.x, (y - LAMP.y) * 1.1) / 150;
          if (d < 1) sf.add(x, y, 0xfff0c0, 0.24 * (1 - d) ** 1.5);
        }
    // the habitat is in the room, so it goes dark at night too
    this.drawHabitat(sf);
    drawDomeLamp(sf, LAMP.x, LAMP.y, s.lamp, [0xf8f2e4, 0xe0d8c4, 0xb8ae98], 0x7a7060);
    if (dark) sf.multiply(0.32, 0.38, 0.6);
  }
}
