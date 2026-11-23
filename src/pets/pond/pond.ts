import { clamp, hash2 } from '../../core/rng';
import type { Env } from '../../core/time';
import { Particles } from '../../render/particles';
import { dither, mix, Surface, VIEW_H, VIEW_W } from '../../render/surface';
import { DecorBox, DECORATE_TOOL, unlockText } from '../decor';
import type { DecorPicker, DropHint, Habitat, Stat, Status, Tool, UiEvent } from '../types';
import { drawSpawn, drawTadpole, FROG_SPRITES } from './art';
import { POND_DECOR, POND_DECOR_AREAS, pondPreviewBg } from './decor';
import { aquatic, bankY, DEV, hops, PERCHES, POND, Pond, PONDCFG, newPondState, stageOf } from './model';

const WATER = [0x7cc0a2, 0x5aa48c, 0x408873, 0x2e6c5c, 0x215347];
const MUD = [0x8a7450, 0x6e5a3c, 0x55452e, 0x3f3322];
const STONE = [0xb4b3a6, 0x90907f, 0x6c6c5e, 0x4d4d43, 0x35352f];
type Sky = 'day' | 'dusk' | 'night';
const skyAt = (hour: number): Sky => (hour >= 20 || hour < 6 ? 'night' : hour >= 18 || hour < 7.5 ? 'dusk' : 'day');
const REED = [0x9ac45a, 0x6f9c44, 0x4f7a36, 0x375a2a];
const PAD = [0x8fd05a, 0x5fae42, 0x3f8a34];

export class PondHabitat implements Habitat {
  readonly id = 'pond';
  tool = 'hand';
  model: Pond;
  private particles = new Particles();
  private bg = new Surface(VIEW_W, VIEW_H);
  private bgReady = false;
  private sky: Sky = 'day';
  private events: UiEvent[] = [];
  private said = new Set<string>();
  /** Where the net is while it is held in the pond, and the colours of what it has scooped up. */
  private netAt: { x: number; y: number } | null = null;
  private caught: number[] = [];
  private night = false;

  private decorBox: DecorBox;

  constructor(saved: unknown, seed: number) {
    this.model = saved ? Pond.load(saved, seed) : new Pond(newPondState(seed));
    // decorations are earned as the tadpoles grow up
    this.decorBox = new DecorBox({
      items: POND_DECOR, areas: POND_DECOR_AREAS, placed: () => this.model.s.decor, level: () => this.model.progress(), previewBg: pondPreviewBg,
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

  private toast(text: string): void {
    this.events.push({ type: 'toast', text });
  }
  /** A tip shown only the first time it applies this session. */
  private once(key: string, text: string): void {
    if (this.said.has(key)) return;
    this.said.add(key);
    this.toast(text);
  }

  // ---- simulation --------------------------------------------------------

  update(dt: number, slowDt: number, env: Env): void {
    const m = this.model;
    m.update(dt, slowDt, env);
    this.night = env.night;
    const toast = (text: string) => this.toast(text);
    const sound = (name: Extract<UiEvent, { type: 'sound' }>['name']) => this.events.push({ type: 'sound', name });
    const once = (key: string, text: string) => this.once(key, text);
    for (const d of this.decorBox.newlyUnlocked()) {
      sound('splash');
      toast(unlockText(d));
    }
    this.decorBox.update(dt);
    if (m.s.cleanliness < PONDCFG.muckyBelow)
      once('mucky', 'The water is getting mucky! Pick the 🥅 net and sweep it over the leaves and old food to scoop them out.');
    for (const fx of m.fx) {
      switch (fx.kind) {
        case 'hatch':
          this.particles.spawn('sparkle', fx.x, fx.y);
          sound('hatch');
          toast('A tadpole wriggled out of its egg!');
          break;
        case 'legs':
          this.particles.spawn('sparkle', fx.x, fx.y);
          once('legs', 'Look! A tadpole is growing back legs.');
          break;
        case 'arms':
          this.particles.spawn('sparkle', fx.x, fx.y);
          once('arms', 'Front legs now! It stops eating for a while and lives off its tail.');
          break;
        case 'froglet':
          this.particles.spawn('sparkle', fx.x, fx.y);
          sound('hatch');
          toast('A froglet climbed out of the water! Its tail is shrinking away.');
          break;
        case 'frog':
          this.particles.spawn('sparkle', fx.x, fx.y);
          once('frog', 'The tail is gone. It is a real frog now, and it loves flies! 🐸');
          break;
        case 'spawn':
          toast('The frogs laid new frogspawn!');
          break;
        case 'nibble':
          this.particles.spawn('crumb', fx.x, fx.y, 0xb8d67a);
          sound('munch');
          break;
        case 'plop':
          this.particles.spawn('ripple', fx.x, fx.y + 1);
          sound('plop');
          break;
        case 'splash':
          this.particles.spawn('ripple', fx.x, fx.y + 1);
          for (let i = 0; i < 5; i++) this.particles.spawn('dust', fx.x, fx.y, 0xdff5ee);
          sound('splash');
          break;
        case 'croak':
          sound('croak');
          break;
        case 'snap':
          this.particles.spawn('sparkle', fx.x, fx.y);
          sound('munch');
          break;
        case 'ripple':
          this.particles.spawn('ripple', fx.x, fx.y);
          sound('tap');
          break;
        case 'sparkle':
          this.particles.spawn('sparkle', fx.x, fx.y);
          sound('pop');
          break;
        case 'no':
          this.particles.spawn('no', fx.x, fx.y);
          sound('no');
          break;
        case 'heart':
          this.particles.spawn('heart', fx.x, fx.y);
          break;
        case 'leaf':
          break;
      }
    }
    m.fx.length = 0;
    // tadpoles gathered round a finger are a happy sight
    if (m.finger && Math.random() < dt * 0.6) {
      const near = m.s.frogs.find((f) => f.state === 'follow' && Math.hypot(f.x - m.finger!.x, f.y - m.finger!.y) < 14);
      if (near) this.particles.spawn('heart', near.x, near.y - 6);
    }
    this.particles.update(dt, POND.surface + 1);
  }

  coarseStep(dt: number, env: Env): void {
    this.model.coarseStep(dt, env);
  }

  beginCatchup(): () => string[] {
    const before = new Map(this.model.s.frogs.map((f) => [f.id, stageOf(f.dev)]));
    return () => {
      const m = this.model;
      m.fx.length = 0;
      const changed = new Set<string>();
      for (const f of m.s.frogs) {
        const was = before.get(f.id), now = stageOf(f.dev);
        if (!was) changed.add('the frogs laid new frogspawn');
        else if (was !== now)
          changed.add(
            { tadpole: 'the eggs hatched', hind: 'a tadpole grew back legs', front: 'a tadpole grew front legs', froglet: 'a froglet climbed out', frog: 'a froglet became a frog', egg: '' }[now],
          );
      }
      const out = [...changed].filter(Boolean);
      if (m.s.debris.length > 3) out.push('leaves fell in the pond');
      if (!out.length) out.push('the pond was calm');
      return out;
    };
  }

  // ---- input -------------------------------------------------------------

  pointer(kind: 'down' | 'move' | 'up', x: number, y: number): void {
    const m = this.model;
    if (kind === 'up') {
      m.finger = null;
      this.netAt = null;
      this.caught = [];
      this.decorBox.pointer('up', x, y);
      return;
    }
    switch (this.tool) {
      case 'decorate':
        if (!this.decorBox.pointer(kind, x, y) && kind === 'down') this.particles.spawn('ripple', x, y);
        break;
      case 'net': {
        // the net stays in the water: it can't be lifted above the surface or pushed into the bank
        const nx = clamp(x, POND.left + 4, 228), ny = clamp(y, POND.surface + 2, POND.bottom - 2);
        const last = this.netAt;
        this.netAt = { x: nx, y: ny };
        const kinds = m.s.debris.filter((d) => Math.abs(d.x - nx) <= 10 && Math.abs(d.y - ny) <= 10).map((d) => d.kind);
        const n = m.net(nx, ny);
        for (const k of kinds) if (this.caught.length < 8) this.caught.push(k === 'leaf' ? 0xb07a3a : 0x6a6a44);
        if (kind === 'down' || (last && Math.hypot(last.x - nx, last.y - ny) > 6 && Math.random() < 0.3)) this.particles.spawn('ripple', nx, POND.surface + 1);
        if (n && !m.s.debris.length) this.toast(m.s.cleanliness < PONDCFG.muckyBelow ? 'All scooped out! The water will clear up by itself now.' : 'All scooped out! 🌟');
        break;
      }
      default:
        if (kind === 'down') m.tap(x, y);
        else if (y > POND.surface + 4 && x < 232) m.finger = { x, y };
    }
  }

  tools(): Tool[] {
    return [
      { id: 'hand', icon: '✋', label: 'Touch', kind: 'mode' },
      { id: 'flakes', icon: '🟡', label: 'Flakes', kind: 'drag' },
      { id: 'lettuce', icon: '🥬', label: 'Lettuce', kind: 'drag' },
      { id: 'flies', icon: '🪰', label: 'Flies', kind: 'drag' },
      { id: 'net', icon: '🥅', label: 'Net', kind: 'mode' },
      DECORATE_TOOL,
      { id: 'torch', icon: '🔦', label: 'Torch', kind: 'toggle', on: this.model.s.torch },
    ];
  }

  useTool(id: string): void {
    const m = this.model;
    // anything still being dragged is set down first
    this.decorBox.pointer('up', 0, 0);
    if (id === 'torch') {
      m.s.torch = !m.s.torch;
      if (!this.night) this.once('torch-day', 'The torch is for night-time. After dark it lights up the pond and wakes everyone up.');
      else this.toast(m.s.torch ? 'Torch on! The light wakes the tadpoles and frogs up.' : 'Torch off. Night-night, pond!');
      return;
    }
    this.tool = id;
    if (id === 'net')
      this.once('net', m.s.debris.length ? 'Sweep the net over the leaves and old food to scoop them out.' : 'The pond is clean! Leaves fall in every few hours, so come back with the net later.');
  }

  drop(id: string, at: { x: number; y: number } | null): void {
    const m = this.model;
    const toast = (text: string) => this.events.push({ type: 'toast', text });
    // tapped: drop it in toward the middle of the water
    const x = at ? at.x : 90 + Math.random() * 100;
    if (id === 'flakes') m.dropFlakes(x);
    else if (id === 'lettuce') {
      if (!m.dropLettuce(x)) toast('There is plenty of lettuce floating already.');
    } else if (id === 'flies') {
      const c = m.counts();
      if (!m.releaseFlies()) toast('There are lots of flies buzzing about already.');
      else if (!c.frogs && !c.froglets) toast('Bzzz! Only frogs catch flies. Tadpoles like flakes and lettuce.');
    }
  }

  dropHint(id: string, x: number): DropHint {
    const hx = Math.max(POND.left + 10, Math.min(POND.right - 10, x));
    // flies are let go into the air; food lands on the water
    return { x: hx, y: id === 'flies' ? POND.surface - 14 : POND.surface, ok: true };
  }

  stats(): Stat[] {
    const m = this.model, c = m.counts();
    const parts: string[] = [];
    const say = (n: number, one: string, many: string) => n && parts.push(`${n} ${n === 1 ? one : many}`);
    say(c.eggs, 'egg', 'eggs');
    say(c.tadpoles, 'tadpole', 'tadpoles');
    say(c.froglets, 'froglet', 'froglets');
    say(c.frogs, 'frog', 'frogs');
    return [
      { icon: '🐸', label: 'Pond', value: parts.join(', ') },
      { icon: '🍽️', label: 'Tummies', value: m.hunger() },
      { icon: '🌿', label: 'Algae', value: m.s.algae },
      { icon: '💧', label: 'Water', value: m.s.cleanliness },
    ];
  }

  status(env: Env): Status {
    const m = this.model, c = m.counts();
    if (m.hunger() < 30) return { text: 'Hungry!', tone: 'warn' };
    if (m.s.cleanliness < PONDCFG.muckyBelow) return { text: 'Pond is mucky', tone: 'warn' };
    if (m.dark(env)) return { text: c.frogs ? 'Croaking…' : 'Sleepy…', tone: 'sleep' };
    if (c.eggs && !c.tadpoles && !c.froglets && !c.frogs) return { text: 'Hatching soon', tone: 'good' };
    if (c.tadpoles) return { text: m.s.frogs.some((f) => f.dev >= DEV.hind && f.dev < DEV.froglet) ? 'Growing legs!' : 'Wriggling', tone: 'good' };
    return { text: 'Hopping', tone: 'good' };
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

  /** Sky, the far shore, water, mud and the stony bank: everything that never moves. */
  private buildBackground(sky: Sky): void {
    const sf = this.bg;
    const S = POND.surface;
    // sky by the real clock
    const [top, bot] = sky === 'day' ? [0x8ccbee, 0xdaf2fa] : sky === 'dusk' ? [0x6a74b4, 0xf8b884] : [0x0d1530, 0x22305a];
    for (let y = 0; y < S; y++) for (let x = 0; x < VIEW_W; x++) sf.px(x, y, mix(top, bot, y / S));
    if (sky === 'day') {
      for (const [cx, cy, rx, ry] of [[70, 12, 14, 4], [80, 9, 8, 4], [210, 18, 11, 3], [217, 15, 6, 3]] as const)
        sf.disc(cx, cy, rx, ry, 0xffffff, 0.85);
    } else if (sky === 'dusk') sf.disc(150, 34, 8, 8, 0xffd890);
    else {
      for (let i = 0; i < 30; i++) sf.px((hash2(i, 1, 104) * VIEW_W) | 0, (hash2(i, 2, 104) * 26) | 0, 0xfff8d8);
      sf.disc(60, 12, 5, 5, 0xf3f0d8);
    }
    // the far shore: a line of trees fading into the distance, then nearer bushes
    const far = sky === 'night' ? 0x1c2a40 : mix(0x6a9a78, top, 0.35), near = sky === 'night' ? 0x1a3024 : 0x4f8a48;
    for (let i = 0; i < 22; i++) {
      const cx = i * 15 + hash2(i, 1, 111) * 10, r = 8 + hash2(i, 2, 111) * 7;
      sf.disc(cx, S - 12 - r * 0.4, r, r * 0.9, far);
    }
    for (let x = 0; x < VIEW_W; x++) {
      const h = 7 + Math.sin(x * 0.05) * 2.5 + Math.sin(x * 0.17 + 2) * 1.5 + hash2(x >> 1, 0, 105) * 1.5;
      for (let y = Math.round(S - h); y < S; y++) {
        const t = (y - (S - h)) / h;
        let c = mix(near, 0x000000, t * 0.35);
        if (y === Math.round(S - h)) c = mix(near, 0xffffff, 0.2);
        else if (hash2(x, y, 106) > 0.8) c = mix(c, 0x000000, 0.15);
        sf.px(x, y, c);
      }
    }
    // water: lighter near the top, with a hazy slope of the far pond bed
    for (let y = S; y < VIEW_H; y++)
      for (let x = 0; x < VIEW_W; x++) {
        const depth = (y - S) / (VIEW_H - S);
        sf.px(x, y, dither(WATER, clamp(depth * 0.9 + (Math.abs(x - 150) / 160) ** 2 * 0.2, 0, 1), x, y));
      }
    for (let x = 0; x < 232; x++) {
      const h = POND.bottom - 22 - Math.sin(x * 0.03 + 1) * 8 - Math.sin(x * 0.09) * 3;
      for (let y = Math.round(h); y < POND.bottom + 2; y++) sf.blend(x, y, 0x1e4a40, 0.3);
    }
    // mud floor with pebbles
    for (let x = 0; x < VIEW_W; x++) {
      const top = POND.bottom + Math.round(Math.sin(x * 0.05) * 2 + Math.sin(x * 0.17) * 1);
      for (let y = top; y < VIEW_H; y++) {
        const n = hash2(x, y, 100);
        let c = dither(MUD, (y - top) / 26 + n * 0.45, x, y);
        if (y === top) c = mix(c, 0xb09a70, 0.5);
        sf.px(x, y, c);
      }
    }
    for (let i = 0; i < 26; i++) {
      const px = hash2(i, 1, 112) * 228, py = POND.bottom + 2 + hash2(i, 2, 112) * 18, r = 1 + hash2(i, 3, 112) * 1.8;
      sf.disc(px, py, r * 1.3, r, dither(STONE, 0.3 + hash2(i, 4, 112) * 0.5, px | 0, py | 0));
      sf.px(Math.round(px - r * 0.4), Math.round(py - r * 0.5), STONE[0]);
    }
    // a sunken branch half in the mud, gone green with slime
    for (let x = 120; x <= 196; x++) {
      const f = (x - 120) / 76, cy = POND.bottom - 1 - f * 5 + Math.sin(f * 7) * 0.8, r = 3 - f * 1.4;
      for (let d = -Math.ceil(r); d <= r; d++) {
        const y = Math.round(cy + d);
        let c = dither([0x6a5a40, 0x54462f, 0x3e3322, 0x2c241a], clamp((d + r) / (2 * r) + (hash2(x >> 2, d, 113) > 0.7 ? 0.2 : 0), 0, 1), x, y);
        if (d <= -r + 1 && hash2(x, 0, 114) > 0.4) c = mix(c, 0x4f8a48, 0.55);
        sf.px(x, y, c);
      }
    }
    // the bank: rounded stones stacked up out of the water, mossy on top and slimy below the waterline
    const CW = 13, CH = 9;
    for (let x = 222; x < VIEW_W; x++) {
      const top = Math.round(bankY(x) + Math.sin(x * 0.35) * 1.5);
      for (let y = top; y < VIEW_H; y++) {
        const gx = Math.floor(x / CW), gy = Math.floor(y / CH);
        let d1 = 1e9, d2 = 1e9, bx = 0, by = 0, bid = 0;
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const cx = gx + ox, cy = gy + oy;
            const px = cx * CW + 2 + hash2(cx, cy, 115) * (CW - 4), py = cy * CH + 2 + hash2(cx, cy, 116) * (CH - 4);
            const d = Math.hypot((x - px) * 0.75, y - py);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              bx = px;
              by = py;
              bid = cx * 31 + cy;
            } else if (d < d2) d2 = d;
          }
        let t = 0.15 + hash2(bid, 0, 117) * 0.3 + (y - by) * 0.05 + (x - bx) * 0.015 + d1 * 0.03;
        if (y - by < -1.5 && x - bx < 1 && d1 < 4) t -= 0.2;
        if (d2 - d1 < 1.5) t = 0.85 + (d2 - d1 < 0.7 ? 0.15 : 0);
        let c = dither(STONE, clamp(t, 0, 1), x, y);
        const wet = y > S + 1;
        if (wet) {
          c = mix(c, 0x2e5a3a, 0.35);
          if (hash2(x, y, 103) > 0.7) c = mix(c, 0x4f8a48, 0.35);
        } else if (y - top < 2 + hash2(x, 0, 118) * 2) c = mix(c, 0x7ab85a, 0.6); // moss along the top
        sf.px(x, y, c);
      }
    }
    // grass and a fern on top of the bank
    for (let x = 262; x < VIEW_W - 2; x += 2) {
      const top = Math.round(bankY(x) + Math.sin(x * 0.35) * 1.5);
      const h = 2 + Math.floor(hash2(x, 1, 119) * 4);
      for (let k = 1; k <= h; k++) sf.px(x + (k > 2 && x % 4 ? 1 : 0), top - k, k === h ? REED[0] : REED[1]);
    }
    for (let f = 0; f < 5; f++) {
      const a = -Math.PI / 2 + (f - 2) * 0.45, by = Math.round(bankY(300)) - 1;
      for (let k = 0; k < 14; k++) {
        const x = Math.round(300 + Math.cos(a) * k + (f - 2) * k * k * 0.02), y = Math.round(by + Math.sin(a) * k + k * k * 0.03);
        sf.px(x, y, REED[2]);
        if (k % 2 === 0 && k > 2) {
          sf.px(x - 1, y, REED[1]);
          sf.px(x + 1, y, REED[0]);
        }
      }
    }
  }

  /** A pond net held at (x, y): a mesh bag hanging from a hoop, on a long handle reaching up out of the water. */
  private drawNet(sf: Surface, x: number, y: number, time: number): void {
    const cx = Math.round(x), cy = Math.round(y);
    const R = 11, D = 11;
    const sway = (dy: number) => Math.round(Math.sin(time * 4) * 1.2 * (dy / D));
    // the back of the hoop, behind the bag
    for (let a = Math.PI; a < Math.PI * 2; a += 0.05) sf.px(Math.round(cx + Math.cos(a) * R), Math.round(cy + Math.sin(a) * 3), 0x4a525c);
    // the bag hangs below the hoop and holds whatever was caught
    for (let dy = 1; dy <= D; dy++) {
      const w = Math.round(R * Math.sqrt(1 - (dy / (D + 1)) ** 2));
      for (let dx = -w; dx <= w; dx++) {
        const px = cx + dx + sway(dy), py = cy + dy;
        if (Math.abs(dx) === w || dy === D) sf.blend(px, py, 0xfbf8ee, 0.9);
        else if ((dx + dy) % 3 === 0 || (dx - dy) % 3 === 0) sf.blend(px, py, 0xf4f0e0, 0.55);
        else sf.blend(px, py, 0xdfe8e0, 0.12);
      }
    }
    this.caught.forEach((c, i) => {
      const bx = cx - 6 + (i % 4) * 4 + sway(D - 2), by = cy + D - 3 - Math.floor(i / 4) * 2;
      sf.px(bx, by, mix(c, 0xffffff, 0.2));
      sf.px(bx + 1, by, c);
      sf.px(bx + 2, by, mix(c, 0x000000, 0.2));
      sf.px(bx + 1, by + 1, mix(c, 0x000000, 0.3));
    });
    // the front of the hoop
    for (let a = 0; a <= Math.PI; a += 0.05) sf.px(Math.round(cx + Math.cos(a) * R), Math.round(cy + Math.sin(a) * 3), 0x9aa6b2);
    sf.px(cx + R, cy, 0xc8d2dc);
    // the handle, up and to the right out of the pond
    for (let k = 0; k < 200; k++) {
      const px = Math.round(cx + R + k * 0.7), py = cy - k;
      if (py < 2 || px > VIEW_W - 4) break;
      sf.px(px, py, 0xc89058);
      sf.px(px + 1, py, 0x9a6634);
      sf.px(px + 2, py, 0x5e3c1e);
    }
  }

  render(sf: Surface, time: number, env: Env): void {
    const m = this.model, s = m.s;
    const sky = skyAt(env.hour);
    if (!this.bgReady || sky !== this.sky) {
      this.bgReady = true;
      this.sky = sky;
      this.buildBackground(sky);
    }
    const dark = m.dark(env);
    const night = env.night;
    sf.copyFrom(this.bg);

    // stars twinkle
    if (night) for (let i = 0; i < 12; i++) sf.blend((hash2(i, 5, 104) * VIEW_W) | 0, (hash2(i, 6, 104) * 24) | 0, 0xffffff, 0.5 * Math.abs(Math.sin(time * 0.7 + i)));

    // reeds and cattails
    for (let i = 0; i < 9; i++) {
      const x = 12 + i * 5 + (i > 5 ? 262 : 0), h = 26 + hash2(i, 0, 107) * 18;
      for (let k = 0; k < h; k++) {
        const bend = Math.round(Math.sin(time * 0.9 + i) * 2 * (k / h) ** 2 + (hash2(i, 1, 107) - 0.5) * 6 * (k / h));
        sf.px(x + bend, POND.surface + 6 - k, REED[k % 7 === 0 ? 3 : 1 + (i % 2)]);
        if (i % 3 === 0 && k > h - 7 && k < h - 1) {
          sf.px(x + bend - 1, POND.surface + 6 - k, 0x5a3a22);
          sf.px(x + bend + 1, POND.surface + 6 - k, 0x7a5230);
          sf.px(x + bend, POND.surface + 6 - k, 0x6b4428);
        }
      }
    }

    // soft light from above, and waterweed on the bottom
    if (!dark)
      for (let i = 0; i < 3; i++) {
        const base = 40 + i * 80 + Math.sin(time * 0.12 + i * 2) * 10;
        for (let y = POND.surface; y < POND.bottom; y++) {
          const a = 0.07 * (1 - (y - POND.surface) / 120);
          for (let j = 0; j < 12; j++) sf.add(Math.round(base + (y - POND.surface) * 0.25) + j, y, 0xe6f7d8, a);
        }
      }
    for (let i = 0; i < 14; i++) {
      const x0 = 16 + hash2(i, 0, 108) * 200, h = 14 + hash2(i, 1, 108) * 30;
      for (let k = 0; k < h; k++) {
        const x = Math.round(x0 + Math.sin(time * 0.8 + i + k * 0.15) * 3 * (k / h));
        sf.px(x, POND.bottom + 1 - k, k % 3 === 0 ? 0x2f6a3a : 0x3f8a4a);
        if (k % 3 === 1) sf.px(x + (k % 2 ? 1 : -1), POND.bottom + 1 - k, 0x57a85a);
      }
    }
    // algae fuzz grows where nobody has grazed
    for (let i = 0; i < Math.round(s.algae * 1.2); i++) {
      const x = (hash2(i, 0, 109) * 226) | 0;
      sf.blend(x, POND.bottom - 1 + ((hash2(i, 1, 109) * 5) | 0), 0x7fd05a, 0.6);
    }

    // lily pads floating flat, seen from just above, with their stalks, and a water lily on one
    PERCHES.slice(0, 3).forEach((p, i) => {
      for (let y = POND.surface + 3; y < POND.bottom; y += 1) sf.blend(Math.round(p.x + Math.sin(y * 0.08 + i + time * 0.4) * 3), y, 0x3f7a44, 0.5);
      const bob = Math.sin(time * 0.9 + i * 2) * 0.4;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -14; dx <= 14; dx++) {
          if ((dx / 14) ** 2 + ((dy + 0.2) / 1.9) ** 2 > 1) continue;
          if (dy <= 0 && dx > 1 && dx < 3 + (dy + 1) * 2) continue; // the notch
          let c = dy < 0 ? PAD[0] : dy === 0 ? PAD[1] : PAD[2];
          if (dy <= 0 && (dx === -6 || dx === 7) ) c = mix(c, 0xd8f0a0, 0.4); // veins
          if (Math.abs(dx) > 12 && dy === 0) c = PAD[2];
          sf.px(p.x + dx, Math.round(POND.surface + dy + bob), c);
        }
      if (i === 1) {
        // a water lily: white petals around a yellow middle
        const fx = p.x - 8, fy = Math.round(POND.surface - 2 + bob);
        for (const [dx, dy, c] of [
          [-3, 0, 0xf4e8f0], [3, 0, 0xf4e8f0], [-2, -1, 0xffffff], [2, -1, 0xffffff], [-1, -2, 0xfff4fa], [1, -2, 0xfff4fa], [0, -3, 0xffffff],
          [-2, 0, 0xf8d0e0], [2, 0, 0xf8d0e0], [-1, 0, 0xf7e36a], [0, 0, 0xf7c84a], [1, 0, 0xf7e36a], [0, -1, 0xf7e36a], [-1, -1, 0xffffff], [1, -1, 0xffffff],
        ] as const)
          sf.px(fx + dx, fy + dy, c);
      }
    });

    // decorations on the bottom, behind the swimmers
    this.decorBox.draw(sf, time);
    if (this.tool === 'decorate') this.decorBox.drawDecorating(sf, time);

    // food and fallen leaves
    for (const f of s.foods) {
      if (f.kind === 'flake') {
        sf.px(f.x, f.y, mix(0xe8b84a, 0x7a7a4a, clamp(f.age / PONDCFG.flakeRot, 0, 1)));
        sf.px(f.x + 1, f.y, 0xc9902e);
      } else {
        const w = 3 + Math.round(f.left);
        for (let dx = -w; dx <= w; dx++) {
          sf.px(f.x + dx, f.y, dx % 3 === 0 ? 0xd6f09a : 0xa8d86a);
          if (Math.abs(dx) < w - 1) sf.px(f.x + dx, f.y + 1, 0x86bf55);
        }
      }
    }
    for (const d of s.debris) {
      const c = d.kind === 'leaf' ? 0xb07a3a : 0x6a6a44;
      const bob = d.kind === 'leaf' ? Math.round(Math.sin(time * 1.5 + d.x) * 0.6) : 0;
      for (let dx = -3; dx <= 3; dx++) sf.px(d.x + dx, d.y + bob, Math.abs(dx) === 3 ? mix(c, 0x000000, 0.3) : dx === 0 ? mix(c, 0xffffff, 0.25) : c);
      for (let dx = -1; dx <= 2; dx++) sf.px(d.x + dx, d.y + 1 + bob, mix(c, 0x000000, 0.25));
    }

    // everyone who lives here
    for (const f of s.frogs) {
      const st = stageOf(f.dev);
      if (st === 'egg') drawSpawn(sf, Math.round(f.x), Math.round(f.y), f.dev, time);
    }
    for (const f of s.frogs) {
      const st = stageOf(f.dev);
      if (aquatic(st)) {
        const sp = Math.hypot(f.vx, f.vy);
        drawTadpole(sf, f.x, f.y, f.facing, f.dev, time * (6 + sp * 0.5) + f.id * 2, clamp(sp / 24, 0.1, 1));
      } else if (hops(st)) {
        const small = st === 'froglet' || f.dev < (DEV.frog + DEV.adult) / 2;
        const moving = f.state === 'jump' || f.perch < 0;
        const sprite = moving ? (small ? FROG_SPRITES.smallLeap : FROG_SPRITES.leap) : small ? FROG_SPRITES.smallSit : FROG_SPRITES.sit;
        const left = f.facing < 0;
        const x0 = Math.round(f.x - sprite.w / 2), y0 = Math.round(f.y - sprite.h + (moving ? sprite.h / 2 : 1));
        // a froglet still has the last of its tail
        if (st === 'froglet') {
          const tail = Math.round(8 * (1 - (f.dev - DEV.froglet) / (DEV.frog - DEV.froglet)));
          for (let i = 0; i < tail; i++) sf.px(f.x - f.facing * (sprite.w / 2 - 1 + i), y0 + sprite.h - 3 + Math.round(Math.sin(time * 5 + i * 0.6)), i < tail - 2 ? 0x3f7a2e : 0x2f5a24);
        }
        sf.blit(sprite, x0, y0, left);
        if (f.croak > 0 && !moving) {
          // throat puffs out
          const tx = Math.round(f.x + f.facing * (sprite.w / 2 - 2)), ty = y0 + sprite.h - 4;
          sf.disc(tx, ty, 2.5, 2.5, 0xf2eec0);
          sf.px(tx - 1, ty - 1, 0xffffff);
        }
        if (f.tongue > 0) {
          const mx = f.x + f.facing * (sprite.w / 2 - 1), my = y0 + 3;
          const reach = Math.sin(f.tongue * Math.PI);
          sf.line(mx, my, mx + (f.tongueX - mx) * reach, my + (f.tongueY - my) * reach, 0xf06a8a);
        }
      }
    }
    for (const fly of m.flies) {
      sf.px(fly.x, fly.y, 0x16161a);
      sf.px(fly.x + 1, fly.y, 0x16161a);
      if (Math.sin(time * 60 + fly.seed) > 0) {
        sf.blend(fly.x, fly.y - 1, 0xffffff, 0.7);
        sf.blend(fly.x + 1, fly.y - 1, 0xffffff, 0.7);
      }
    }

    this.particles.render(sf);

    // murk, then the shimmering water line
    const murk = clamp((70 - s.cleanliness) / 70, 0, 1) * 0.5;
    if (murk > 0) for (let y = POND.surface; y < VIEW_H; y++) for (let x = 0; x < VIEW_W; x++) sf.blend(x, y, 0x6a6a3a, murk * (0.8 + 0.2 * hash2(x >> 3, y >> 3, 110)));
    for (let x = 0; x < VIEW_W; x++) {
      if (x >= 226 && bankY(x) <= POND.surface) continue;
      const w = Math.sin(x * 0.2 + time * 2) + Math.sin(x * 0.07 - time * 1.3);
      sf.blend(x, POND.surface, 0xeafff6, w > 0.2 ? 0.75 : 0.4);
      if (w > 1.3) sf.blend(x, POND.surface + 1, 0xcff5e6, 0.4);
    }

    if (this.netAt) this.drawNet(sf, this.netAt.x, this.netAt.y, time);

    if (dark) sf.multiply(0.32, 0.38, 0.6);
    else if (night) {
      // torchlight: dark all round, with a beam shining down into the water
      sf.multiply(0.42, 0.48, 0.66);
      const ox = 18, oy = 2, dir = Math.atan2(120, 120) + Math.sin(time * 0.3) * 0.06;
      for (let y = 0; y < VIEW_H; y++)
        for (let x = 0; x < VIEW_W; x++) {
          const dx = x - ox, dy = y - oy, d = Math.hypot(dx, dy);
          const off = Math.abs(Math.atan2(dy, dx) - dir);
          if (off > 0.34 || d > 240) continue;
          const a = (1 - off / 0.34) ** 1.4 * (1 - d / 240) * 0.55;
          sf.add(x, y, 0xfff0c0, a);
        }
    }

    for (let x = 0; x < VIEW_W; x++) {
      sf.px(x, 0, 0x0b1216);
      sf.px(x, 1, 0x0b1216);
      sf.px(x, VIEW_H - 1, 0x0b1216);
      sf.px(x, VIEW_H - 2, 0x0b1216);
    }
    for (let y = 0; y < VIEW_H; y++) {
      sf.px(0, y, 0x0b1216);
      sf.px(1, y, 0x0b1216);
      sf.px(VIEW_W - 1, y, 0x0b1216);
      sf.px(VIEW_W - 2, y, 0x0b1216);
    }
  }
}
