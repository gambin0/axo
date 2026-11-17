import { clamp, hash2 } from '../../core/rng';
import type { Env } from '../../core/time';
import { Particles } from '../../render/particles';
import { dither, mix, Surface, VIEW_H, VIEW_W } from '../../render/surface';
import type { DropHint, Habitat, Stat, Status, Tool, UiEvent } from '../types';
import { ANTS_SPRITES, BROOD_SPRITES, FOOD_LOOK } from './art';
import {
  ANTS, Colony, FARM, JOBS, NODES, POLY, STAGE_NAMES, newColonyState, polyLength, polyPrefix,
  type AntFoodKind,
} from './model';

const CELL = 2;
const GW = VIEW_W / CELL, GH = VIEW_H / CELL;
const SOIL = [0xd0ab74, 0xbd935e, 0xa87e4d, 0x936a40, 0x7d5734];
const SKY_DAY = [0xc9ecf8, 0xa9dcf2, 0x8fcdea];
const SKY_NIGHT = [0x0d1530, 0x141f40, 0x1c2a4e];
const GRASS = [0x8fd05a, 0x5fae42, 0x3f8a34, 0x2c6a2c];
const TUNNEL = 0x3b2a1e;

const FOODS: { id: AntFoodKind; icon: string; label: string }[] = [
  { id: 'sugar', icon: '🍯', label: 'Honey' },
  { id: 'seed', icon: '🌰', label: 'Seed' },
  { id: 'crumb', icon: '🍞', label: 'Crumb' },
  { id: 'fruit', icon: '🍎', label: 'Fruit' },
  { id: 'bug', icon: '🪲', label: 'Bug' },
  { id: 'chocolate', icon: '🍫', label: 'Choc' },
];

export class AntHabitat implements Habitat {
  readonly id = 'ants';
  tool = 'look';
  model: Colony;
  private particles = new Particles();
  private grid = new Uint8Array(GW * GH);
  private gridKey = '';
  private soil = new Surface(VIEW_W, VIEW_H);
  private soilKey = '';
  private events: UiEvent[] = [];
  private dragDist = 0;
  private last: { x: number; y: number } | null = null;
  private shook = false;
  private hatchToast = 0;

  constructor(saved: unknown, seed: number) {
    this.model = saved ? Colony.load(saved, seed) : new Colony(newColonyState(seed));
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
    this.hatchToast = Math.max(0, this.hatchToast - dt);

    for (const fx of m.fx) {
      switch (fx.kind) {
        case 'dust':
          for (let i = 0; i < 3; i++) this.particles.spawn('dust', fx.x, fx.y, SOIL[1]);
          break;
        case 'crumb':
          this.particles.spawn('crumb', fx.x, fx.y - 2, 0xf2deaa);
          break;
        case 'no':
          this.particles.spawn('no', fx.x, fx.y);
          this.events.push({ type: 'sound', name: 'no' });
          break;
        case 'drop':
          this.particles.spawn('drop', fx.x, fx.y);
          break;
        case 'tap':
          this.particles.spawn('ripple', fx.x, fx.y);
          this.events.push({ type: 'sound', name: 'tap' });
          break;
        case 'plop':
          this.events.push({ type: 'sound', name: 'plop' });
          break;
        case 'hatch':
          this.particles.spawn('sparkle', fx.x, fx.y);
          break;
        case 'stage':
          this.events.push({ type: 'toast', text: `Your colony grew! It is now: ${STAGE_NAMES[m.s.stage]} 🎉` });
          break;
      }
    }
    m.fx.length = 0;

    if (m.hatchedSinceDrain > 0 && this.hatchToast <= 0) {
      this.hatchToast = 6;
      const n = m.hatchedSinceDrain;
      this.events.push({ type: 'toast', text: n === 1 ? 'A new ant hatched! 🐜' : `${n} new ants hatched! 🐜` });
      this.events.push({ type: 'sound', name: 'hatch' });
      m.hatchedSinceDrain = 0;
    }

    this.particles.update(dt, 0, FARM.surface);
  }

  coarseStep(dt: number, env: Env): void {
    this.model.coarseStep(dt, env);
  }

  beginCatchup(): () => string[] {
    const before = this.model.s.workers;
    return () => {
      const s = this.model.s;
      this.model.hatchedSinceDrain = 0;
      this.model.fx.length = 0;
      const n = s.workers - before;
      const out: string[] = [];
      if (n > 0) out.push(n === 1 ? '1 new ant hatched' : `${n} new ants hatched`);
      if (s.foodStore < 1 && !s.foods.length) out.push('the ants ran out of food');
      else if (n === 0) out.push('the ants kept busy');
      return out;
    };
  }

  // ---- input -------------------------------------------------------------

  pointer(kind: 'down' | 'move' | 'up', x: number, y: number): void {
    const m = this.model;
    if (kind === 'up') {
      this.last = null;
      return;
    }
    if (kind === 'down') {
      this.last = { x, y };
      this.dragDist = 0;
      this.shook = false;
      m.tap(x, y);
      return;
    }
    // A vigorous drag gives the farm a (harmless) shake.
    if (this.last && this.tool === 'look') {
      this.dragDist += Math.hypot(x - this.last.x, y - this.last.y);
      this.last = { x, y };
      if (this.dragDist > 140 && !this.shook) {
        this.shook = true;
        m.shake();
        this.events.push({ type: 'sound', name: 'tap' });
      }
    }
  }

  tools(): Tool[] {
    const list: Tool[] = [{ id: 'look', icon: '👆', label: 'Tap', kind: 'mode' }];
    for (const f of FOODS) list.push({ id: f.id, icon: f.icon, label: f.label, kind: 'drag' });
    list.push({ id: 'water', icon: '🚿', label: 'Water', kind: 'drag' });
    list.push({ id: 'red', icon: '🔴', label: 'Red light', kind: 'toggle', on: this.model.s.redLight });
    return list;
  }

  useTool(id: string): void {
    if (id === 'red') this.model.s.redLight = !this.model.s.redLight;
    else this.tool = id;
  }

  drop(id: string, at: { x: number; y: number } | null): void {
    const m = this.model;
    // tapped: put it on the surface a little way from the nest entrance
    const x = at ? at.x : FARM.entranceX + 40 + (Math.random() - 0.5) * 40;
    if (id === 'water') {
      m.water(x);
      this.events.push({ type: 'sound', name: 'splash' });
      if (m.s.moisture > ANTS.soggyAbove) this.events.push({ type: 'toast', text: 'Too soggy! Let the soil dry out a bit.' });
      return;
    }
    if (!FOODS.some((f) => f.id === id)) return;
    const r = m.feed(x, id as AntFoodKind);
    if (r === 'bad') this.events.push({ type: 'toast', text: "Ants can't eat chocolate. They'll leave it alone." });
    else if (r === 'full') this.events.push({ type: 'toast', text: "That's plenty of food up there for now!" });
  }

  dropHint(_id: string, x: number): DropHint {
    // everything goes on the surface, above the soil
    return { x: Math.max(FARM.left + 8, Math.min(FARM.right - 8, x)), y: FARM.surface - 2, ok: true };
  }

  stats(): Stat[] {
    const m = this.model, s = m.s;
    return [
      { icon: '🐜', label: 'Ants', value: `${s.workers} + queen` },
      { icon: '🥚', label: 'Babies', value: String(s.brood.length) },
      { icon: '🍯', label: 'Food', value: (s.foodStore / m.foodCap()) * 100 },
      { icon: '💧', label: 'Damp', value: s.moisture },
      { icon: '🏠', label: 'Nest', value: STAGE_NAMES[s.stage] },
    ];
  }

  status(): Status {
    const s = this.model.s;
    if (s.foodStore < 1 && !s.foods.some((f) => f.bad <= 0)) return { text: 'Hungry!', tone: 'warn' };
    if (s.moisture < ANTS.dryBelow) return { text: 'Too dry', tone: 'warn' };
    if (s.moisture > ANTS.soggyAbove) return { text: 'Too soggy', tone: 'warn' };
    if (s.brood.length) return { text: 'Growing', tone: 'good' };
    return { text: 'Busy', tone: 'good' };
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

  /** Rebuild the dug-out cell grid from job progress. */
  private carve(): void {
    const g = this.grid;
    g.fill(0);
    const blob = (cx: number, cy: number, rx: number, ry: number) => {
      for (let gy = Math.floor((cy - ry) / CELL); gy <= Math.ceil((cy + ry) / CELL); gy++)
        for (let gx = Math.floor((cx - rx) / CELL); gx <= Math.ceil((cx + rx) / CELL); gx++) {
          if (gx < 0 || gy < FARM.surface / CELL || gx >= GW || gy >= GH) continue;
          const dx = (gx * CELL + 1 - cx) / rx, dy = (gy * CELL + 1 - cy) / ry;
          if (dx * dx + dy * dy <= 1) g[gy * GW + gx] = 1;
        }
    };
    JOBS.forEach((job, i) => {
      const f = this.model.s.dug[i];
      if (f <= 0) return;
      if (job.type === 'edge') {
        const pts = polyPrefix(POLY[job.id], f);
        for (let k = 1; k < pts.length; k++) {
          const n = Math.max(1, Math.ceil(Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y)));
          for (let t = 0; t <= n; t++)
            blob(pts[k - 1].x + ((pts[k].x - pts[k - 1].x) * t) / n, pts[k - 1].y + ((pts[k].y - pts[k - 1].y) * t) / n, 3.4, 3.4);
        }
      } else {
        const node = NODES[job.id], ch = node.chamber!;
        const grow = Math.sqrt(f);
        blob(node.x, node.y, Math.max(4, ch.rx * grow), Math.max(3.5, ch.ry * grow));
      }
    });
  }

  private paintSoil(dug: (x: number, y: number) => boolean, wet: number): void {
    const soil = this.soil;
    for (let y = FARM.surface; y < VIEW_H; y++)
      for (let x = 0; x < VIEW_W; x++) {
        const n = hash2(x, y, 50);
        if (dug(x, y)) {
          let c = mix(TUNNEL, 0x2f2118, hash2(x >> 1, y >> 1, 51) * 0.6);
          if (!dug(x, y - 2)) c = 0x241810; // roof shadow
          else if (!dug(x, y + 2)) c = 0x6b5038; // lit floor
          else if (!dug(x - 2, y)) c = mix(c, 0x241810, 0.5);
          soil.px(x, y, c);
          continue;
        }
        const depth = (y - FARM.surface) / (VIEW_H - FARM.surface);
        // wavy strata with speckle
        const band = depth * 0.8 + Math.sin(x * 0.03 + y * 0.09) * 0.05 + Math.sin(x * 0.011 - y * 0.05) * 0.06 + (n - 0.5) * 0.14;
        let c = dither(SOIL, clamp(band + 0.08, 0, 1), x, y);
        if (n > 0.975) c = 0xe6cc9c;
        else if (n < 0.03) c = 0x6a492b;
        else if (hash2(x >> 1, y >> 1, 52) > 0.985) c = 0x9c9a92; // tiny stones
        if (y < FARM.surface + 5) c = mix(c, 0x4e3620, 0.75 - (y - FARM.surface) * 0.12); // dark topsoil
        // a darker rim where soil meets a tunnel
        if (dug(x, y + 2) || dug(x, y - 2) || dug(x + 2, y) || dug(x - 2, y)) c = mix(c, 0x4a321e, 0.35);
        soil.px(x, y, mix(c, 0x3f2a18, wet * 0.42 * (1 - depth * 0.45)));
      }

  }

  private dugWork(): number {
    return JOBS.reduce((sum, j, i) => sum + j.work * this.model.s.dug[i], 0);
  }

  render(sf: Surface, time: number, env: Env): void {
    const m = this.model, s = m.s;
    const key = s.dug.map((v) => v.toFixed(3)).join();
    if (key !== this.gridKey) {
      this.gridKey = key;
      this.carve();
    }
    const g = this.grid;
    const dug = (x: number, y: number) => y >= FARM.surface && g[(y >> 1) * GW + (x >> 1)] === 1;
    const wet = s.moisture / 100;
    const night = env.night;

    // sky
    for (let y = 0; y < FARM.surface; y++)
      for (let x = 0; x < VIEW_W; x++) sf.px(x, y, dither(night ? SKY_NIGHT : SKY_DAY, y / FARM.surface, x, y));
    if (night) {
      for (let i = 0; i < 26; i++) {
        const x = (hash2(i, 1, 40) * VIEW_W) | 0, y = (hash2(i, 2, 40) * 20) | 0;
        sf.blend(x, y, 0xffffff, 0.4 + 0.5 * Math.abs(Math.sin(time * 0.7 + i)));
      }
      sf.disc(268, 11, 5, 5, 0xf3f0d8);
      sf.disc(266, 10, 4, 4, 0x141f40, 0.0);
    } else {
      // drifting clouds
      for (let i = 0; i < 3; i++) {
        const cx = ((i * 130 + time * (1.5 + i * 0.4)) % (VIEW_W + 60)) - 30, cy = 7 + i * 4;
        sf.disc(cx, cy, 11, 3, 0xffffff, 0.75);
        sf.disc(cx + 6, cy - 2, 6, 3, 0xffffff, 0.75);
        sf.disc(cx - 6, cy - 1, 5, 2, 0xffffff, 0.75);
      }
    }

    // soil and tunnels: static until something is dug or the soil dries, so cached
    const soilKey = `${key}|${Math.round(s.moisture / 2)}`;
    if (soilKey !== this.soilKey) {
      this.soilKey = soilKey;
      this.paintSoil(dug, wet);
    }
    const from = FARM.surface * VIEW_W * 4;
    sf.data.set(this.soil.data.subarray(from), from);

    // grass along the surface
    for (let x = 0; x < VIEW_W; x++) {
      if (Math.abs(x - FARM.entranceX) < 5) continue;
      const h = 1 + Math.floor(hash2(x, 0, 53) * 4);
      const lean = Math.sin(time * 1.2 + x * 0.3) > 0.6 ? 1 : 0;
      for (let i = 0; i < h; i++) sf.px(x + (i === h - 1 ? lean : 0), FARM.surface - 1 - i, GRASS[Math.min(3, 3 - i + (hash2(x, 1, 53) > 0.5 ? 0 : 1))] ?? GRASS[0]);
    }

    // the spoil heap grows as the nest does
    const heap = clamp(this.dugWork() / 45, 2, 12);
    for (let dx = -Math.ceil(heap * 1.6); dx <= heap * 1.6; dx++) {
      const hh = Math.round(heap * 0.55 * (1 - (dx / (heap * 1.6)) ** 2));
      for (let i = 0; i < hh; i++) {
        const x = FARM.moundX + dx, y = FARM.surface - 1 - i;
        sf.px(x, y, dither(SOIL, hash2(x, y, 54) * 0.7 + (i === hh - 1 ? 0 : 0.2), x, y));
      }
    }

    // food stored underground, and brood
    const storeNode = NODES[m.chamberOf('food')];
    const floorY = (node: (typeof NODES)[number], fx: number) => {
      const ch = node.chamber!;
      const grow = node === NODES[2] ? Math.sqrt(Math.max(0.3, s.dug[2])) : 1;
      return node.y + ch.ry * grow * Math.sqrt(Math.max(0, 1 - fx * fx)) - 3;
    };
    for (let i = 0; i < Math.min(40, Math.round(s.foodStore / 1.5)); i++) {
      const fx = (hash2(i, 3, 60) - 0.5) * 1.3 + (storeNode === NODES[2] ? 0.2 : 0);
      const x = storeNode.x + clamp(fx, -0.85, 0.85) * storeNode.chamber!.rx * 0.9;
      const y = floorY(storeNode, clamp(fx, -0.85, 0.85)) + 1 - (i % 3 === 0 ? 1 : 0);
      sf.px(x, y, [0xf2deaa, 0xe2c27a, 0xd89a4a][i % 3]);
      sf.px(x + 1, y, 0xc9a45e);
    }
    const broodNode = NODES[m.chamberOf('brood')];
    s.brood.slice(0, 60).forEach((age, i) => {
      const fx = (hash2(i, 7, 61) - 0.5) * 1.4 - (broodNode === NODES[2] ? 0.15 : 0);
      const cx = clamp(fx, -0.8, 0.8);
      const x = Math.round(broodNode.x + cx * broodNode.chamber!.rx * 0.9);
      const y = Math.round(floorY(broodNode, cx) - (i % 4 === 0 ? 1 : 0));
      const sprite = age < ANTS.eggTime ? BROOD_SPRITES.egg : age < ANTS.eggTime + ANTS.larvaTime ? BROOD_SPRITES.larva : BROOD_SPRITES.pupa;
      sf.blit(sprite, x - 1, y - sprite.h + 2, hash2(i, 8, 61) > 0.5);
    });

    // the queen ambles about her chamber
    const q = NODES[2];
    const qx = q.x + Math.sin(time * 0.17) * 5 - 2, qdir = Math.cos(time * 0.17) < 0;
    sf.blit(ANTS_SPRITES.queen[Math.floor(time * 2) % 2], qx - 6, floorY(q, (qx - q.x) / q.chamber!.rx) - 3, qdir);

    // food on the surface
    for (const f of s.foods) {
      const look = FOOD_LOOK[f.kind];
      const k = f.bad > 0 ? 1 : Math.sqrt(clamp(f.units / f.max, 0.15, 1));
      const rx = look.rx * k, ry = look.ry * k;
      const cy = FARM.surface - 1 - ry;
      sf.disc(f.x, cy, rx, ry, look.base);
      sf.disc(f.x + rx * 0.25, cy + ry * 0.3, rx * 0.7, ry * 0.6, look.shade, 0.7);
      sf.px(f.x - rx * 0.4, cy - ry * 0.5, look.light);
      if (f.kind === 'bug') for (let i = -1; i <= 1; i++) sf.px(f.x + i * 2, FARM.surface - 1, 0x1c241c);
      if (f.kind === 'fruit') sf.px(f.x, cy - ry - 1, 0x3f8a34);
    }

    // the ants
    const frame = (walked: number) => Math.floor(walked / 2) & 1;
    for (const a of m.ants) {
      let x = a.x, y = a.y;
      const onTop = y <= FARM.surface + 1;
      const horizontal = onTop || Math.abs(a.dx) >= Math.abs(a.dy);
      if (!onTop) {
        x += -a.dy * a.lane;
        y += a.dx * a.lane;
      }
      if (a.digging) x += Math.sin(time * 30 + a.lane * 9) > 0 ? 1 : 0;
      const moving = a.path.length > 0 || a.digging;
      const fr = moving ? frame(a.walked + (a.digging ? time * 12 : 0)) : 0;
      if (horizontal) {
        const sp = ANTS_SPRITES.walk[fr];
        const left = a.dx < 0;
        const top = onTop ? FARM.surface - 4 : y - 2;
        sf.blit(sp, x - 3, top, left);
        if (a.carry) this.drawCarry(sf, a.carry, x + (left ? -4 : 3), top - 1);
      } else {
        const sp = ANTS_SPRITES.climb[fr];
        const up = a.dy < 0;
        sf.blit(sp, x - 2, y - 3, a.lane > 0, up);
        if (a.carry) this.drawCarry(sf, a.carry, x - 1, y + (up ? -5 : 4));
      }
    }

    this.particles.render(sf);

    if (s.redLight) sf.multiply(1, 0.42, 0.38);
    else if (night) sf.multiply(0.34, 0.38, 0.58);

    // frame and glass
    const WOODS = [0x8a6540, 0x6f4f31, 0x573c25, 0x3e2a19];
    for (let i = 0; i < 4; i++) {
      for (let x = i; x < VIEW_W - i; x++) {
        sf.px(x, i, WOODS[i]);
        sf.px(x, VIEW_H - 1 - i, WOODS[3 - i]);
      }
      for (let y = i; y < VIEW_H - i; y++) {
        sf.px(i, y, WOODS[i]);
        sf.px(VIEW_W - 1 - i, y, WOODS[3 - i]);
      }
    }
    for (let i = 0; i < 80; i++) {
      sf.add(34 + i, 12 + i * 1.5, 0xffffff, 0.05);
      sf.add(35 + i, 12 + i * 1.5, 0xffffff, 0.05);
      sf.add(46 + i, 12 + i * 1.5, 0xffffff, 0.03);
    }
  }

  private drawCarry(sf: Surface, carry: 'grain' | 'food' | 'egg', x: number, y: number): void {
    const c = carry === 'grain' ? SOIL[0] : carry === 'food' ? 0xf6e7b4 : 0xf7f4ea;
    sf.px(x, y, c);
    sf.px(x + 1, y, mix(c, 0x000000, 0.18));
    if (carry !== 'grain') sf.px(x, y - 1, c);
  }
}

/** Total tunnel length in the blueprint, handy for debugging and tests. */
export const BLUEPRINT_LENGTH = POLY.reduce((sum, p) => sum + polyLength(p), 0);
