import { COLS, ROWS, LAYERS, UNIT, center, clamp, constraint, idx, isInside, toCell } from './city';
import type { Cell, CityEvent, Point } from './city';

export interface Evidence {
  value: number;
  t: number;
  source: number;
  frame: number;
  hits: number;
}
export type MapData = Record<number, Evidence>;
export interface Range {
  dx: number;
  dz: number;
  range: number;
  limit: number;
}
export interface Reservation {
  key: number;
  from: number;
  start: number;
  end: number;
  drone: number;
}
export function addEvidence(
  map: MapData,
  cell: Cell,
  occupied: boolean,
  t: number,
  source: number,
  frame: number
) {
  const key = idx(cell),
    old = map[key],
    prior = old ? old.value * Math.exp(-(t - old.t) / 10) : 0;
  map[key] = {
    value: clamp(prior + (occupied ? 1.55 : -0.78), -4, 4),
    t,
    source,
    frame,
    hits: (old?.hits ?? 0) + 1,
  };
}
export function confidence(e: Evidence | undefined, t: number) {
  return e ? e.value * Math.exp(-Math.max(0, t - e.t) / 13) : 0;
}
export function fuseScan(
  map: MapData,
  origin: Point,
  rays: Range[],
  time: number,
  source: number,
  frame: number
) {
  const free = new Map<number, Cell>(),
    occupied = new Map<number, Cell>();
  for (const r of rays) {
    for (let d = 0; d < r.range - 0.25; d += 1.35) {
      const pos = { x: origin.x + r.dx * d, y: origin.y, z: origin.z + r.dz * d },
        c = toCell(pos);
      free.set(idx(c), c);
    }
    if (r.range < r.limit - 0.16) {
      const c = toCell({
        x: origin.x + r.dx * (r.range + 0.35),
        y: origin.y,
        z: origin.z + r.dz * (r.range + 0.35),
      });
      occupied.set(idx(c), c);
    }
  }
  const changed: Cell[] = [];
  for (const [key, c] of free)
    if (!occupied.has(key)) {
      addEvidence(map, c, false, time, source, frame);
      changed.push(c);
    }
  for (const c of occupied.values()) {
    addEvidence(map, c, true, time, source, frame);
    changed.push(c);
  }
  return changed;
}
export function neighbours(c: Cell) {
  return [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ]
    .map(([i, j, l]) => ({ i: c.i + i, j: c.j + j, l: c.l + l }))
    .filter((p) => isInside(p.i, p.j) && p.l >= 0 && p.l < LAYERS.length);
}
export function information(map: MapData, c: Cell, t: number) {
  return neighbours(c).reduce((s, n) => s + 1 / (1 + Math.abs(confidence(map[idx(n)], t))), 0);
}
export function observationCells(map: MapData, c: Cell, t: number) {
  return neighbours(c)
    .filter((n) => confidence(map[idx(n)], t) < -0.55)
    .map((n) => ({ cell: n, gain: information(map, n, t), cost: n.l === c.l ? 1 : 1.6 }))
    .sort((a, b) => b.gain - b.cost - (a.gain - a.cost));
}
interface Entry {
  cell: Cell;
  step: number;
  cost: number;
  score: number;
  parent: Entry | null;
}
class Heap {
  items: Entry[] = [];
  push(v: Entry) {
    let i = this.items.push(v) - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].score <= v.score) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = v;
  }
  pop() {
    const top = this.items[0],
      last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= this.items.length) break;
        if (c + 1 < this.items.length && this.items[c + 1].score < this.items[c].score) c++;
        if (this.items[c].score >= last.score) break;
        this.items[i] = this.items[c];
        i = c;
      }
      this.items[i] = last;
    }
    return top;
  }
}
export function plan(
  start: Cell,
  goal: Cell,
  map: MapData,
  t: number,
  rules: CityEvent[],
  reservations: Reservation[],
  drone: number,
  adaptive: boolean
): Cell[] {
  const h = (c: Cell) => Math.abs(c.i - goal.i) + Math.abs(c.j - goal.j) + 0.75 * Math.abs(c.l - goal.l);
  const heap = new Heap(),
    best = new Map<number, number>(),
    timed = adaptive && reservations.some((r) => r.drone !== drone && r.end >= t);
  heap.push({ cell: start, step: 0, cost: 0, score: h(start), parent: null });
  for (let n = 0; heap.items.length && n < 5200; n++) {
    const cur = heap.pop();
    if (idx(cur.cell) === idx(goal)) {
      const route: Cell[] = [];
      for (let p: Entry | null = cur; p?.parent; p = p.parent) route.push(p.cell);
      return route.reverse();
    }
    if (cur.step >= 35) continue;
    const next = neighbours(cur.cell);
    if (timed) next.push(cur.cell);
    for (const c of next) {
      const key = idx(c),
        step = cur.step + 1,
        stamp = t + step * 1.25,
        ev = confidence(map[key], t);
      if (adaptive && (ev > 1.18 || rules.some((e) => constraint(e, c, stamp)))) continue;
      if (
        timed &&
        reservations.some(
          (r) =>
            r.drone !== drone &&
            r.start < stamp + 0.65 &&
            r.end > stamp - 0.65 &&
            (r.key === key || (r.key === idx(cur.cell) && r.from === key))
        )
      )
        continue;
      const buildingLot = c.i % 2 === 1 && c.j % 2 === 1 && key !== idx(goal) && key !== idx(start);
      // City-issued corridors follow the streets. Their clearance still needs a measurement.
      const cost =
        cur.cost +
        (c.l !== cur.cell.l ? 1.45 : 1) +
        (buildingLot ? 7 : 0) +
        c.l * 0.16 +
        (adaptive && Math.abs(ev) < 0.75 ? 0.17 : 0);
      const state = key + (timed ? step * COLS * ROWS * 3 : 0);
      if ((best.get(state) ?? Infinity) <= cost) continue;
      best.set(state, cost);
      heap.push({ cell: c, step, cost, score: cost + h(c), parent: cur });
    }
  }
  return [];
}
export function reserve(route: Cell[], start: Cell, at: number, drone: number): Reservation[] {
  return route
    .slice(0, 9)
    .map((c, i) => ({
      key: idx(c),
      from: idx(i ? route[i - 1] : start),
      start: at + i * 1.25 - 0.25,
      end: at + (i + 1) * 1.25 + 0.6,
      drone,
    }));
}
export function bearing(a: Point, b: Point) {
  return Math.atan2(b.x - a.x, b.z - a.z);
}
export function frontier(map: MapData, c: Cell, t: number, goal: Point) {
  const choices = observationCells(map, c, t);
  return choices
    .map((v) => ({
      ...v,
      score: v.gain - v.cost - Math.hypot(center(v.cell).x - goal.x, center(v.cell).z - goal.z) / (3 * UNIT),
    }))
    .sort((a, b) => b.score - a.score);
}
