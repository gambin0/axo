import { clamp, hash2 } from '../../core/rng';
import type { Env } from '../../core/time';
import { Particles } from '../../render/particles';
import { dither, mix, Surface, VIEW_H, VIEW_W } from '../../render/surface';
import type { DropHint, Habitat, Stat, Status, Tool, UiEvent } from '../types';
import { drawSpawn, drawTadpole, FROG_SPRITES } from './art';
import { aquatic, bankY, DEV, hops, PERCHES, POND, Pond, PONDCFG, newPondState, stageOf } from './model';

const WATER = [0x7cc0a2, 0x5aa48c, 0x408873, 0x2e6c5c, 0x215347];
const MUD = [0x8a7450, 0x6e5a3c, 0x55452e, 0x3f3322];
const STONE = [0xb4b3a6, 0x90907f, 0x6c6c5e, 0x4d4d43, 0x35352f];
const SKY_DAY = [0xcdeefa, 0xb2e2f5, 0x9ad6ee];
const SKY_NIGHT = [0x0d1530, 0x141f40, 0x1c2a4e];
const REED = [0x9ac45a, 0x6f9c44, 0x4f7a36, 0x375a2a];
const PAD = [0x8fd05a, 0x5fae42, 0x3f8a34];

export class PondHabitat implements Habitat {
  readonly id = 'pond';
  tool = 'hand';
  model: Pond;
  private particles = new Particles();
  private bg = new Surface(VIEW_W, VIEW_H);
  private bgReady = false;
  private events: UiEvent[] = [];
  private said = new Set<string>();

  constructor(saved: unknown, seed: number) {
    this.model = saved ? Pond.load(saved, seed) : new Pond(newPondState(seed));
  }

  get name(): string {
    return this.model.s.name;
  }
  set name(v: string) {
    this.model.s.name = v;
  }

  // ---- simulation --------------------------------------------------------

  update(dt: number, slowDt: number, env: Env): void {
    const m = this.model;
    m.update(dt, slowDt, env);
    const toast = (text: string) => this.events.push({ type: 'toast', text });
    const sound = (name: Extract<UiEvent, { type: 'sound' }>['name']) => this.events.push({ type: 'sound', name });
    /** Explain each milestone the first time it happens this session. */
    const once = (key: string, text: string) => {
      if (this.said.has(key)) return;
      this.said.add(key);
      toast(text);
    };
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
      return;
    }
    switch (this.tool) {
      case 'net':
        if (m.net(x, y) === 0 && kind === 'down') this.particles.spawn('ripple', x, y);
        break;
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
      { id: 'torch', icon: '🔦', label: 'Torch', kind: 'toggle', on: this.model.s.torch },
    ];
  }

  useTool(id: string): void {
    const m = this.model;
    if (id === 'torch') m.s.torch = !m.s.torch;
    else this.tool = id;
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

  /** Water, mud, and the stony bank: everything that never moves. */
  private buildBackground(): void {
    const sf = this.bg;
    for (let y = POND.surface; y < VIEW_H; y++)
      for (let x = 0; x < VIEW_W; x++) {
        const depth = (y - POND.surface) / (VIEW_H - POND.surface);
        sf.px(x, y, dither(WATER, clamp(depth * 0.9 + (Math.abs(x - 150) / 160) ** 2 * 0.2, 0, 1), x, y));
      }
    // mud floor
    for (let x = 0; x < VIEW_W; x++) {
      const top = POND.bottom + Math.round(Math.sin(x * 0.05) * 2 + Math.sin(x * 0.17) * 1);
      for (let y = top; y < VIEW_H; y++) {
        const n = hash2(x, y, 100);
        let c = dither(MUD, (y - top) / 26 + n * 0.45, x, y);
        if (y === top) c = mix(c, 0xb09a70, 0.5);
        if (hash2(x >> 1, y >> 1, 101) > 0.95) c = dither(STONE, n, x, y);
        sf.px(x, y, c);
      }
    }
    // the bank: rounded stones stacked up out of the water
    for (let x = 226; x < VIEW_W; x++) {
      const top = Math.round(bankY(x) + Math.sin(x * 0.35) * 1.5);
      for (let y = top; y < VIEW_H; y++) {
        const cx = Math.floor(x / 9), cy = Math.floor((y + (cx & 1) * 4) / 7);
        const inX = x % 9, inY = (y + (cx & 1) * 4) % 7;
        let t = hash2(cx, cy, 102) * 0.5 + (inY / 7) * 0.35 + (y - top) / 200;
        if (inX === 0 || inY === 0) t += 0.3;
        if (inY === 1 && inX > 1) t -= 0.2;
        let c = dither(STONE, clamp(t, 0, 1), x, y);
        if (y === top) c = mix(c, 0xe6e4d2, 0.4);
        // green slime below the waterline
        if (y > POND.surface + 2 && hash2(x, y, 103) > 0.6) c = mix(c, 0x4f8a48, 0.35);
        sf.px(x, y, c);
      }
    }
  }

  render(sf: Surface, time: number, env: Env): void {
    const m = this.model, s = m.s;
    if (!this.bgReady) {
      this.bgReady = true;
      this.buildBackground();
    }
    const dark = m.dark(env);
    const night = env.night;
    sf.copyFrom(this.bg);

    // sky and the far bank
    for (let y = 0; y < POND.surface; y++)
      for (let x = 0; x < VIEW_W; x++) sf.px(x, y, dither(night ? SKY_NIGHT : SKY_DAY, y / POND.surface, x, y));
    if (night) {
      for (let i = 0; i < 22; i++) sf.blend((hash2(i, 1, 104) * VIEW_W) | 0, (hash2(i, 2, 104) * 24) | 0, 0xffffff, 0.4 + 0.5 * Math.abs(Math.sin(time * 0.7 + i)));
      sf.disc(60, 12, 5, 5, 0xf3f0d8);
    }
    for (let x = 0; x < VIEW_W; x++) {
      const h = 9 + Math.sin(x * 0.04) * 3 + Math.sin(x * 0.13 + 2) * 2 + hash2(x, 0, 105) * 3;
      for (let y = Math.round(POND.surface - h); y < POND.surface; y++) sf.px(x, y, dither(REED, 0.55 + (POND.surface - y) / 40 + hash2(x, y, 106) * 0.2, x, y));
    }
    // the bank stones above the waterline were covered by the sky: redraw them
    for (let x = 226; x < VIEW_W; x++)
      for (let y = Math.round(bankY(x) - 2); y < POND.surface; y++) {
        const i = (y * VIEW_W + x) * 4;
        if (y >= Math.round(bankY(x) + Math.sin(x * 0.35) * 1.5)) sf.data.set(this.bg.data.subarray(i, i + 4), i);
      }

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

    // lily pads with their stalks, and one flower
    PERCHES.slice(0, 3).forEach((p, i) => {
      for (let y = POND.surface + 2; y < POND.bottom; y += 1) sf.blend(Math.round(p.x + Math.sin(y * 0.08 + i + time * 0.4) * 3), y, 0x3f7a44, 0.5);
      for (let dx = -13; dx <= 13; dx++) {
        if (dx > 2 && dx < 5) continue; // the notch
        const edge = Math.abs(dx) > 11;
        sf.px(p.x + dx, POND.surface, edge ? PAD[2] : PAD[dx < 0 ? 0 : 1]);
        if (!edge) sf.px(p.x + dx, POND.surface + 1, PAD[2]);
      }
      if (i === 1) {
        for (const [dx, dy, c] of [[-9, -1, 0xf7b4d0], [-8, -2, 0xffffff], [-7, -1, 0xf7b4d0], [-8, -1, 0xf7e36a], [-10, -2, 0xf48ab8], [-6, -2, 0xf48ab8], [-8, -3, 0xf7b4d0]] as const)
          sf.px(p.x + dx, POND.surface + dy, c);
      }
    });

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

    if (dark) sf.multiply(0.32, 0.38, 0.6);
    else if (night) sf.multiply(0.8, 0.82, 0.7); // torchlight

    for (let i = 0; i < 70; i++) {
      sf.add(40 + i, 56 + i * 1.5, 0xffffff, 0.05);
      sf.add(41 + i, 56 + i * 1.5, 0xffffff, 0.05);
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
