import { makeSprite, type Surface } from './surface';

export type ParticleKind = 'bubble' | 'heart' | 'zzz' | 'ripple' | 'dust' | 'crumb' | 'no' | 'drop' | 'sparkle';

interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  seed: number;
  color: number;
}

const HEART = makeSprite([' r.r ', 'rRrrr', 'rrrrr', ' rrr ', '  r  '], { r: 0xe8456b, R: 0xffb3c4, '.': 0xe8456b });
const ZED = makeSprite(['zzz', ' z ', 'zzz'], { z: 0xdfe9ff });
const CROSS = makeSprite(['x   x', ' x x ', '  x  ', ' x x ', 'x   x'], { x: 0xe23a3a });

/** Purely visual effects. Uses Math.random: never touches the sim RNG. */
export class Particles {
  private list: Particle[] = [];

  spawn(kind: ParticleKind, x: number, y: number, color = 0xffffff): void {
    if (this.list.length > 300) return;
    const r = Math.random;
    const p: Particle = { kind, x, y, vx: 0, vy: 0, age: 0, life: 1, seed: r() * 100, color };
    switch (kind) {
      case 'bubble':
        p.vy = -14 - r() * 10;
        p.life = 12;
        break;
      case 'heart':
        p.vy = -12;
        p.vx = (r() - 0.5) * 8;
        p.life = 1.4;
        break;
      case 'zzz':
        p.vy = -6;
        p.vx = 3;
        p.life = 2.2;
        break;
      case 'ripple':
        p.life = 0.6;
        break;
      case 'dust':
      case 'crumb':
        p.vx = (r() - 0.5) * 16;
        p.vy = -6 - r() * 10;
        p.life = 0.5 + r() * 0.4;
        break;
      case 'no':
        p.vy = -5;
        p.life = 1.2;
        break;
      case 'drop':
        p.vy = 70;
        p.life = 3;
        break;
      case 'sparkle':
        p.life = 0.5;
        break;
    }
    this.list.push(p);
  }

  /** `top` is where bubbles pop (water surface) and `floor` where drops land. */
  update(dt: number, top = 0, floor = 1e9): void {
    for (const p of this.list) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'bubble') {
        p.x += Math.sin(p.age * 5 + p.seed) * 6 * dt;
        if (p.y <= top) p.age = p.life;
      } else if (p.kind === 'dust' || p.kind === 'crumb') {
        p.vy += 60 * dt;
      } else if (p.kind === 'drop' && p.y >= floor) {
        p.age = p.life;
      }
    }
    this.list = this.list.filter((p) => p.age < p.life);
  }

  render(s: Surface): void {
    for (const p of this.list) {
      const x = Math.round(p.x), y = Math.round(p.y);
      const fade = Math.min(1, (p.life - p.age) * 3);
      switch (p.kind) {
        case 'bubble': {
          const big = p.seed > 60;
          if (big) {
            s.blend(x, y - 1, 0xdff6ff, 0.6);
            s.blend(x - 1, y, 0xdff6ff, 0.6);
            s.blend(x + 1, y, 0xbfe8f5, 0.4);
            s.blend(x, y + 1, 0xbfe8f5, 0.4);
            s.blend(x - 1, y - 1, 0xffffff, 0.9);
          } else {
            s.blend(x, y, 0xdff6ff, 0.6);
            s.blend(x, y - 1, 0xffffff, 0.35);
          }
          break;
        }
        case 'heart':
          s.blit(HEART, x - 2, y - 2, false, false, fade);
          break;
        case 'zzz':
          s.blit(ZED, x, y, false, false, fade * 0.9);
          break;
        case 'no':
          s.blit(CROSS, x - 2, y - 2, false, false, fade);
          break;
        case 'ripple': {
          const r = 2 + (p.age / p.life) * 9;
          const a = (1 - p.age / p.life) * 0.7;
          for (let i = 0; i < 20; i++) {
            const t = (i / 20) * Math.PI * 2;
            s.blend(x + Math.cos(t) * r, y + Math.sin(t) * r * 0.7, 0xffffff, a);
          }
          break;
        }
        case 'dust':
        case 'crumb':
          s.blend(x, y, p.color, fade);
          break;
        case 'drop':
          s.blend(x, y, 0x9fd8ff, 0.9);
          s.blend(x, y - 1, 0x6bb8f0, 0.8);
          s.blend(x, y - 2, 0x6bb8f0, 0.4);
          break;
        case 'sparkle': {
          const a = 1 - p.age / p.life;
          s.blend(x, y, 0xffffff, a);
          s.blend(x - 1, y, 0xfff3b0, a * 0.6);
          s.blend(x + 1, y, 0xfff3b0, a * 0.6);
          s.blend(x, y - 1, 0xfff3b0, a * 0.6);
          s.blend(x, y + 1, 0xfff3b0, a * 0.6);
          break;
        }
      }
    }
  }
}
