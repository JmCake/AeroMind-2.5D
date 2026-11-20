export const COLS = 11,
  ROWS = 9,
  UNIT = 6,
  LAYERS = [5.4, 9, 13];
export const WIDTH = 192,
  HEIGHT = 144,
  FOV = 65;
export interface Point {
  x: number;
  y: number;
  z: number;
}
export interface Cell {
  i: number;
  j: number;
  l: number;
}
export interface Box extends Point {
  w: number;
  d: number;
  h: number;
}
export type Weather = '晴朗' | '薄雾' | '小雨' | '夜航' | '阵风';
export type EventKind = 'crane' | 'ceiling' | 'closed' | 'occupied' | 'traffic';
export interface CityEvent {
  id: number;
  kind: EventKind;
  i: number;
  j: number;
  at: number;
  duration: number;
  minLayer?: number;
  maxLayer?: number;
}
export const EVENT_NAMES: Record<EventKind, string> = {
  crane: '横移吊臂',
  ceiling: '限高走廊',
  closed: '禁飞体积',
  occupied: '平台占用',
  traffic: '对向交通',
};
export const STATIONS = [
  { key: 'hub', name: '物流枢纽', place: '南港物流', i: 1, j: 7, priority: 1, mass: 0.6 },
  { key: 'library', name: '图书馆', place: '大学校园', i: 7, j: 1, priority: 2, mass: 0.5 },
  { key: 'clinic', name: '医院', place: '东岸社区', i: 9, j: 5, priority: 4, mass: 0.4 },
  { key: 'works', name: '工程站', place: '中央工地', i: 5, j: 3, priority: 1, mass: 1.2 },
  { key: 'dorm', name: '宿舍', place: '西岭学园', i: 3, j: 1, priority: 2, mass: 0.8 },
] as const;
export const COLORS = ['#ff7739', '#1eada8', '#a887f4'];
export const isInside = (i: number, j: number) => i >= 0 && i < COLS && j >= 0 && j < ROWS;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const idx = (c: Cell) => c.i + COLS * (c.j + ROWS * c.l);
export const toCell = (p: Point): Cell => ({
  i: clamp(Math.round(p.x / UNIT) + (COLS - 1) / 2, 0, COLS - 1),
  j: clamp(Math.round(p.z / UNIT) + (ROWS - 1) / 2, 0, ROWS - 1),
  l: LAYERS.reduce((best, v, i) => (Math.abs(v - p.y) < Math.abs(LAYERS[best] - p.y) ? i : best), 0),
});
export const ground = (i: number, j: number) => ({
  x: (i - (COLS - 1) / 2) * UNIT,
  z: (j - (ROWS - 1) / 2) * UNIT,
});
export const center = (c: Cell): Point => ({ ...ground(c.i, c.j), y: LAYERS[c.l] });
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const flat = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
export function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
export function active(e: CityEvent, t: number) {
  return t >= e.at && t < e.at + e.duration;
}
export function constraint(e: CityEvent, c: Cell, t: number) {
  return (
    active(e, t) &&
    e.i === c.i &&
    e.j === c.j &&
    (e.kind === 'closed' || e.kind === 'ceiling') &&
    c.l >= (e.minLayer ?? (e.kind === 'ceiling' ? 1 : 0)) &&
    c.l <= (e.maxLayer ?? 2)
  );
}
export interface Lot extends Box {
  kind: number;
  tone: number;
}
export interface Fixture extends Point {
  station: number;
}
export class City {
  lots: Lot[] = [];
  fixtures: Fixture[] = [];
  constructor(readonly seed: number) {
    const rng = random(seed);
    for (let j = 1; j < ROWS; j += 2)
      for (let i = 1; i < COLS; i += 2) {
        const anchor = ground(i, j),
          station = STATIONS.findIndex((s) => s.i === i && s.j === j);
        if (station >= 0) {
          const h = 1.15 + station * 0.13;
          this.lots.push({ ...anchor, y: 0, w: 5.65, d: 5.65, h, kind: 4 + station, tone: station });
          this.fixtures[station] = {
            ...anchor,
            x: anchor.x + (rng() - 0.5) * 1.15,
            z: anchor.z + (rng() - 0.5) * 1.15,
            y: h,
            station,
          };
        } else {
          const kind = i === 3 && j === 5 ? 10 : Math.floor(rng() * 4),
            h = kind === 10 ? 0.44 : kind === 3 ? 1.25 : 3 + rng() * 7.8;
          this.lots.push({
            ...anchor,
            y: 0,
            w: 3.8 + rng() * 1.1,
            d: 3.7 + rng() * 1.3,
            h,
            kind,
            tone: Math.floor(rng() * 5),
          });
          if (h > 4)
            this.lots.push({
              x: anchor.x + 0.4,
              z: anchor.z - 0.35,
              y: h,
              w: 2.5,
              d: 2.4,
              h: (i + j) % 3 === 0 ? 2.85 : 0.48,
              kind: (i + j) % 3 === 0 ? 11 : 9,
              tone: 1,
            });
          if (kind === 0 || kind === 2)
            this.lots.push({
              x: anchor.x + 2.67,
              z: anchor.z + 0.75,
              y: 0,
              w: 1.52,
              d: 2.72,
              h: 1.68 + kind * 0.42,
              kind: 12,
              tone: kind,
            });
        }
      }
  }
  home(id: number): Point {
    const f = this.fixtures[0],
      offset = [
        [-1.85, 1.72],
        [1.86, 1.68],
        [1.8, -1.62],
      ][id];
    return { ...f, x: f.x + offset[0], z: f.z + offset[1], y: f.y + 0.52 };
  }
  obstacles(events: CityEvent[], t: number): Box[] {
    const boxes: Box[] = [];
    for (const e of events) {
      if (!active(e, t)) continue;
      const p = ground(e.i, e.j),
        phase = t - e.at;
      if (e.kind === 'crane')
        boxes.push({ ...p, x: p.x + Math.sin(phase * 0.46) * 2.1, y: 4.35, w: 6.7, d: 1.7, h: 2.3 });
      if (e.kind === 'traffic')
        boxes.push({ ...p, z: p.z + Math.sin(phase * 0.65) * 4, y: 4.8, w: 1.85, d: 1.65, h: 1.3 });
      if (e.kind === 'occupied')
        boxes.push({ ...p, y: this.surface(p.x, p.z) + 0.04, w: 4.5, d: 4.4, h: 1.7 });
    }
    return boxes;
  }
  surface(x: number, z: number, extra: Box[] = []): number {
    let floor = 0;
    for (const b of [...this.lots, ...extra])
      if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) floor = Math.max(floor, b.y + b.h);
    return floor;
  }
  judge(station: number, p: Point, extra: Box[]) {
    const fixture = this.fixtures[station],
      error = flat(fixture, p);
    const floor = this.surface(p.x, p.z, extra);
    return {
      accepted: error <= 1.38 && Math.abs(p.y - fixture.y - 0.55) < 0.25 && floor <= fixture.y + 0.09,
      error,
    };
  }
}
// The game samples a bounded range beam. The perception side receives only ranges.
export function beam(origin: Point, dx: number, dz: number, boxes: Box[], limit: number): number {
  let nearest = limit;
  for (const b of boxes) {
    if (origin.y < b.y - 0.12 || origin.y > b.y + b.h + 0.12) continue;
    const x0 = b.x - b.w / 2 - 0.18,
      x1 = b.x + b.w / 2 + 0.18,
      z0 = b.z - b.d / 2 - 0.18,
      z1 = b.z + b.d / 2 + 0.18;
    let low = 0,
      high = nearest;
    if (Math.abs(dx) < 1e-6) {
      if (origin.x < x0 || origin.x > x1) continue;
    } else {
      const a = (x0 - origin.x) / dx,
        c = (x1 - origin.x) / dx;
      low = Math.max(low, Math.min(a, c));
      high = Math.min(high, Math.max(a, c));
    }
    if (Math.abs(dz) < 1e-6) {
      if (origin.z < z0 || origin.z > z1) continue;
    } else {
      const a = (z0 - origin.z) / dz,
        c = (z1 - origin.z) / dz;
      low = Math.max(low, Math.min(a, c));
      high = Math.min(high, Math.max(a, c));
    }
    if (high >= low) nearest = Math.min(nearest, low);
  }
  return nearest;
}
export function touches(p: Point, boxes: Box[]) {
  return boxes.some(
    (b) =>
      p.y - 0.36 < b.y + b.h &&
      p.y + 0.28 > b.y &&
      Math.abs(p.x - b.x) < b.w * 0.5 + 0.36 &&
      Math.abs(p.z - b.z) < b.d * 0.5 + 0.36
  );
}
// Axial depths from the down-facing tabletop camera, measured against the game's collision meshes.
export function tabletopDepth(origin: Point, boxes: Box[], limit: number, noise: () => number) {
  const samples: Point[] = [],
    tangent = Math.tan((FOV * Math.PI) / 360);
  for (let v = -4; v <= 4; v++)
    for (let u = -6; u <= 6; u++) {
      const dx = ((u / 6) * tangent * WIDTH) / HEIGHT,
        dz = (v / 4) * tangent;
      let nearest = origin.y;
      for (const b of boxes) {
        let lo = Math.max(0.045, origin.y - b.y - b.h),
          hi = Math.min(nearest, origin.y - b.y);
        if (hi < lo) continue;
        for (const [offset, dir, half] of [
          [b.x - origin.x, dx, b.w / 2],
          [b.z - origin.z, dz, b.d / 2],
        ]) {
          if (Math.abs(dir) < 1e-5) {
            if (Math.abs(offset) > half) {
              hi = -1;
              break;
            }
          } else {
            const a = (offset - half) / dir,
              c = (offset + half) / dir;
            lo = Math.max(lo, Math.min(a, c));
            hi = Math.min(hi, Math.max(a, c));
          }
        }
        if (lo <= hi) nearest = lo;
      }
      if (nearest < 0.05 || nearest > limit) continue;
      const depth = Math.round((nearest + (noise() - 0.5) * 0.035) * 80) / 80;
      samples.push({ x: dx * depth, y: -depth, z: dz * depth });
    }
  return samples;
}
