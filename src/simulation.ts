import {
  City,
  FOV,
  HEIGHT,
  WIDTH,
  LAYERS,
  STATIONS,
  beam,
  center,
  clamp,
  constraint,
  distance,
  flat,
  ground,
  idx,
  tabletopDepth,
  toCell,
  touches,
} from './city';
import type { Box, Cell, CityEvent, EventKind, Point, Weather } from './city';
import { bearing, frontier, fuseScan, plan, reserve } from './navigation';
import type { Evidence, MapData, Range, Reservation } from './navigation';
import type { Checkpoint, Detection, Observation } from './vision-types';

export const PHASES = {
  idle: '待命',
  load: '装载',
  up: '起飞',
  out: '巡航',
  search: '落点搜索',
  dock: '进柜交接',
  back: '返航',
  down: '归港',
  done: '已归港',
  abort: '任务中止',
};
export type Phase = keyof typeof PHASES;
export type Mode = '课程' | '运营' | '挑战';
export interface Config {
  chapter: number;
  mode: Mode;
  weather: Weather;
  fleet: number;
  share: boolean;
  link: '正常' | '延迟' | '断开';
  policy: 'classic' | 'learned';
  model: Checkpoint;
  adaptive: boolean;
  seed: number;
  navigation: '融合' | '视觉惯性' | '惯性';
}
export const defaults: Config = {
  chapter: 1,
  mode: '课程',
  weather: '晴朗',
  fleet: 1,
  share: true,
  link: '正常',
  policy: 'classic',
  model: 'mature',
  adaptive: true,
  seed: 617,
  navigation: '融合',
};
export interface Receipt {
  station: number;
  drone: number;
  signed: boolean;
  result: string;
  time: number;
  path: number;
  energy: number;
  collisions: number;
  error: number | null;
  closest: number | null;
  poseRms: number;
  wait: number;
  samples: number;
}
export interface Order {
  id: number;
  station: number;
  priority: number;
  mass: number;
  deadline: number;
  wait: boolean;
  avoid: number | null;
  created: number;
}
interface PixelEvidence {
  frame: number;
  time: number;
  wall: number;
  detections: Detection[];
  model: Checkpoint;
  features: number;
  ms: number;
  latency: number;
}
export interface Drone {
  id: number;
  phase: Phase;
  p: Point;
  v: Point;
  pose: Point;
  vi: Point;
  base: Point;
  yaw: number;
  bank: number;
  order: Order | null;
  route: Cell[];
  map: MapData;
  stamps: Record<number, Point>;
  evidence: PixelEvidence | null;
  lastEye: number;
  eyePose: Point;
  lastControl: number;
  lastScan: number;
  nextPlan: number;
  since: number;
  start: number;
  destination: Point;
  dock: Point | null;
  signed: boolean;
  reason: string;
  energy: number;
  travelled: number;
  collisions: number;
  touching: boolean;
  error: number | null;
  closest: number | null;
  poseError: number;
  poseN: number;
  waited: number;
  samples: number;
  trace: Point[];
  lastTrace: number;
  front: number;
  closing: number;
  headroom: number;
  frame: number;
  battery: number;
  views: number;
  choices: { cell: Cell; score: number }[];
  scanYaw: number;
  shared: number;
  accepted: number;
  received: number;
  lost: number;
  lastSend: number;
  manual: boolean;
  attempted: number;
  lastFix: number;
  reservedUntil: number;
  cloud: Point[];
  roughness: number;
  depthSamples: number;
  lastDepth: number;
  actionName: string;
  viewGain: number;
  beforeView: number;
  homeLocked: boolean;
  observeUntil: number;
  observation: Point | null;
  sensorHeading: number;
  predicted: CityEvent | null;
  ttc: number | null;
  survey: { cell: Cell; until: number } | null;
  lastRequest: number;
}
interface Message {
  arrive: number;
  stamp: number;
  from: number;
  to: number;
  key: number;
  observation: Evidence;
  frame: 'harbor';
  sigma: number;
}
export interface Journal {
  time: number;
  drone: number;
  message: string;
  frame: number;
}
export interface State {
  time: number;
  config: Config;
  drones: Drone[];
  events: CityEvent[];
  orders: Order[];
  completed: Receipt[];
  log: Journal[];
  reservations: Reservation[];
  messages: Message[];
  requests: { from: number; to: number; cell: Cell; stamp: number; arrive: number }[];
  counter: number;
  rng: number;
  externalRng: number;
  nextOrder: number;
  routeCount: number;
  docks: Record<number, { drone: number; until: number }>;
}
export type Policy = Record<Checkpoint, { q: number[][]; mean_test_return: number }>;
const point = (x = 0, y = 0, z = 0): Point => ({ x, y, z });
const working = (d: Drone) => d.phase !== 'idle' && d.phase !== 'done' && d.phase !== 'abort';
export const level = (s: State) => (s.config.adaptive ? s.config.chapter : Math.max(1, s.config.chapter - 1));
const canAdapt = (s: State) => level(s) >= 4;
function aircraft(city: City, id: number): Drone {
  const p = city.home(id);
  return {
    id,
    phase: 'idle',
    p: { ...p },
    v: point(),
    pose: { ...p },
    vi: point(),
    base: { ...p },
    yaw: Math.PI,
    bank: 0,
    order: null,
    route: [],
    map: {},
    stamps: {},
    evidence: null,
    lastEye: -1,
    eyePose: { ...p },
    lastControl: -1,
    lastScan: -1,
    nextPlan: 0,
    since: 0,
    start: 0,
    destination: { ...p },
    dock: null,
    signed: false,
    reason: '等待调度',
    energy: 0,
    travelled: 0,
    collisions: 0,
    touching: false,
    error: null,
    closest: null,
    poseError: 0,
    poseN: 0,
    waited: 0,
    samples: 0,
    trace: [],
    lastTrace: -1,
    front: 12,
    closing: 0,
    headroom: 1,
    frame: 0,
    battery: 100,
    views: 0,
    choices: [],
    scanYaw: 0,
    shared: 0,
    accepted: 0,
    received: 0,
    lost: 0,
    lastSend: -1,
    manual: false,
    attempted: 0,
    lastFix: 0,
    reservedUntil: 0,
    cloud: [],
    roughness: 0,
    depthSamples: 0,
    lastDepth: -2,
    actionName: '',
    viewGain: 0,
    beforeView: 0,
    homeLocked: false,
    observeUntil: 0,
    observation: null,
    sensorHeading: 0,
    predicted: null,
    ttc: null,
    survey: null,
    lastRequest: -10,
  };
}
export class Simulation {
  city: City;
  s: State;
  extra: Box[] = [];
  policy: Policy | null = null;
  manualInput = point();
  latencies: number[] = [];
  constructor(config: Config = { ...defaults }) {
    this.city = new City(config.seed);
    this.s = {
      time: 0,
      config: { ...config },
      drones: [],
      events: [],
      orders: [],
      completed: [],
      log: [],
      reservations: [],
      messages: [],
      requests: [],
      counter: 0,
      rng: config.seed >>> 0,
      externalRng: (config.seed + 937) >>> 0,
      nextOrder: 6,
      routeCount: 0,
      docks: {},
    };
    this.setFleet(config.fleet);
  }
  setFleet(n: number) {
    const s = this.s;
    n = clamp(n, 1, 3);
    while (s.drones.length < n) s.drones.push(aircraft(this.city, s.drones.length));
    if (s.drones.slice(n).some(working)) return false;
    s.drones.length = n;
    s.config.fleet = n;
    return true;
  }
  rand() {
    this.s.rng = (Math.imul(this.s.rng, 1664525) + 1013904223) >>> 0;
    return this.s.rng / 4294967296;
  }
  external() {
    this.s.externalRng = (Math.imul(this.s.externalRng, 1664525) + 1013904223) >>> 0;
    return this.s.externalRng / 4294967296;
  }
  log(drone: number, message: string, frame = 0) {
    this.s.log.push({ time: this.s.time, drone, message, frame });
    if (this.s.log.length > 240) this.s.log.shift();
  }
  reason(d: Drone, message: string) {
    if (message !== d.reason) {
      d.reason = message;
      this.log(d.id, message, d.evidence?.frame ?? 0);
    }
  }
  phase(d: Drone, p: Phase, message: string) {
    d.phase = p;
    d.since = this.s.time;
    this.reason(d, message);
  }
  place(
    kind: EventKind,
    i: number,
    j: number,
    delay = 0,
    duration = 22,
    minLayer?: number,
    maxLayer?: number
  ) {
    const s = this.s;
    s.events.push({ id: ++s.counter, kind, i, j, at: s.time + delay, duration, minLayer, maxLayer });
    this.log(-1, '主持人已安排空域事件 · ' + String.fromCharCode(65 + i) + (j + 1));
    for (const d of s.drones) d.nextPlan = 0;
  }
  order(station: number, options: Partial<Pick<Order, 'priority' | 'deadline' | 'wait' | 'avoid'>> = {}) {
    if (!STATIONS[station] || !station) return;
    const s = this.s,
      st = STATIONS[station];
    s.orders.push({
      id: ++s.counter,
      station,
      priority: st.priority,
      mass: st.mass,
      deadline: s.time + 115,
      wait: true,
      avoid: null,
      created: s.time,
      ...options,
    });
    this.log(-1, st.name + '订单进入队列');
    this.dispatch();
  }
  dispatch() {
    const s = this.s;
    s.orders.sort((a, b) => b.priority - a.priority || a.deadline - b.deadline || a.id - b.id);
    for (const o of [...s.orders]) {
      const target = { ...ground(STATIONS[o.station].i, STATIONS[o.station].j), y: 5 };
      const candidates = s.drones.filter(
        (d) =>
          (d.phase === 'idle' || d.phase === 'done') && d.battery > 18 && [1.5, 0.85, 1.8][d.id] >= o.mass
      );
      const cost = (d: Drone) => flat(d.pose, target) + 0.4 * (100 - d.battery) + d.id * 0.01;
      candidates.sort((a, b) => cost(a) - cost(b));
      const d = candidates[0];
      if (!d) continue;
      const fresh = aircraft(this.city, d.id);
      Object.assign(d, fresh, {
        map: d.map,
        stamps: d.stamps,
        battery: d.battery,
        pose: { ...d.pose },
        p: { ...d.p },
        order: o,
        start: s.time,
        trace: [{ ...d.p }],
      });
      s.orders = s.orders.filter((v) => v.id !== o.id);
      this.phase(d, 'load', STATIONS[o.station].name + ' · 柜台装载');
    }
  }
  receive(obs: Observation, latency: number) {
    const s = this.s,
      d = s.drones[obs.drone];
    if (
      !d ||
      obs.model !== s.config.model ||
      s.time - obs.sample > 1.25 ||
      obs.sample < d.lastEye ||
      latency > 650
    )
      return false;
    d.evidence = {
      frame: obs.frame,
      time: obs.sample,
      wall: obs.wall,
      model: obs.model,
      detections: obs.detections,
      features: obs.flow.count,
      ms: obs.ms,
      latency,
    };
    d.samples++;
    d.frame = obs.frame;
    if (
      level(s) >= 3 &&
      s.config.navigation !== '惯性' &&
      d.lastEye >= 0 &&
      d.headroom > 1.4 &&
      Math.abs(d.v.y) < 0.45 &&
      obs.flow.count >= 5
    ) {
      const scale = (2 * d.headroom * Math.tan((FOV * Math.PI) / 360)) / HEIGHT;
      const measured = { x: d.eyePose.x - obs.flow.x * scale, z: d.eyePose.z - obs.flow.y * scale };
      const withinImageSearch = Math.hypot(d.vi.x, d.vi.z) * (obs.sample - d.lastEye) < scale * 10;
      if (withinImageSearch && Math.hypot(measured.x - d.pose.x, measured.z - d.pose.z) < 0.34) {
        d.pose.x += (measured.x - d.pose.x) * 0.075;
        d.pose.z += (measured.z - d.pose.z) * 0.075;
      }
    }
    if (level(s) >= 3 && s.config.navigation !== '惯性')
      for (const sign of obs.detections) {
        const scale = (2 * d.headroom * Math.tan((FOV * Math.PI) / 360)) / HEIGHT;
        const local = {
          x: d.pose.x + (sign.x - WIDTH / 2) * scale,
          z: d.pose.z + (sign.y - HEIGHT / 2) * scale,
          y: d.pose.y - d.headroom,
        };
        const station = STATIONS[sign.label],
          district = ground(station.i, station.j);
        // Public cabinet districts are surveyed to one street cell. The precise sign position is hidden.
        if (sign.score > 0.91 && flat(local, { ...district, y: 0 }) < 4) {
          const residual = (v: number) => Math.sign(v) * Math.max(0, Math.abs(v) - 0.65);
          d.pose.x += residual(district.x - local.x) * 0.13;
          d.pose.z += residual(district.z - local.z) * 0.13;
        }
        const old = d.stamps[sign.label];
        if (old && flat(old, local) < 2.8 && sign.score > 0.86) {
          d.pose.x += (old.x - local.x) * 0.08;
          d.pose.z += (old.z - local.z) * 0.08;
          d.lastFix = s.time;
        } else if (!old) d.stamps[sign.label] = local;
      }
    d.lastEye = obs.sample;
    d.eyePose = { ...d.pose };
    return true;
  }
  sensor(d: Drone, all: Box[]) {
    const s = this.s,
      t = s.time,
      rays: Range[] = [],
      limit = s.config.weather === '薄雾' ? 7.5 : 11.5;
    const forward = bearing(d.pose, d.destination);
    const clearance = beam(d.p, Math.sin(forward), Math.cos(forward), all, limit);
    const turn = Math.abs(
      Math.atan2(Math.sin(forward - d.sensorHeading), Math.cos(forward - d.sensorHeading))
    );
    d.closing = turn < 0.25 ? clamp((d.front - clearance) / Math.max(0.17, t - d.lastScan), -12, 12) : 0;
    d.sensorHeading = forward;
    d.ttc = d.closing > 0.5 && clearance < limit - 0.3 ? clearance / d.closing : null;
    if (canAdapt(s) && d.ttc !== null && d.ttc < 1.3 && clearance > 1.3) {
      const c = toCell({
        x: d.pose.x + Math.sin(forward) * clearance,
        y: d.pose.y,
        z: d.pose.z + Math.cos(forward) * clearance,
      });
      d.predicted = {
        id: -2,
        kind: 'closed',
        i: c.i,
        j: c.j,
        minLayer: c.l,
        maxLayer: c.l,
        at: t,
        duration: 2.1,
      };
    }
    d.front = clearance;
    const down = d.p.y - this.city.surface(d.p.x, d.p.z, this.extra);
    d.headroom = clamp(Math.round((down + 0.009 * Math.sin(t * 3 + d.id)) * 80) / 80, 0.12, limit + 4);
    if (level(s) >= 2 && t - d.lastDepth >= 0.48) {
      const samples = tabletopDepth({ ...d.p, y: d.p.y + 0.12 }, all, limit + 4, () => this.rand());
      const footprint = samples.filter((p) => Math.abs(p.x) < 0.87 && Math.abs(p.z) < 0.87).map((p) => -p.y);
      d.depthSamples = footprint.length;
      d.roughness = footprint.length ? Math.max(...footprint) - Math.min(...footprint) : Infinity;
      if (level(s) >= 3 && s.config.navigation === '融合') {
        const cloud = samples.map((p) => ({
          x: p.x + d.pose.x,
          y: p.y + d.pose.y + 0.12,
          z: p.z + d.pose.z,
        }));
        d.cloud.push(...cloud);
        if (d.cloud.length > 620) d.cloud.splice(0, d.cloud.length - 620);
      }
      d.lastDepth = t;
    }
    if (level(s) >= 3 && s.config.navigation === '融合') {
      const scanning =
        d.survey && d.survey.until >= t ? bearing(d.pose, center(d.survey.cell)) : forward + d.scanYaw;
      for (let k = 0; k < 20; k++) {
        const a = scanning + (k - 9.5) * 0.163,
          dx = Math.sin(a),
          dz = Math.cos(a);
        const raw = beam(d.p, dx, dz, all, limit);
        rays.push({
          dx,
          dz,
          range: clamp(Math.round((raw + (this.rand() - 0.5) * 0.045) * 25) / 25, 0, limit),
          limit,
        });
      }
      const changed = fuseScan(d.map, d.pose, rays, t, d.id, d.frame);
      if (t - d.lastSend > 0.7 && level(s) >= 5 && s.config.share) {
        d.lastSend = t;
        const evidence = changed
          .sort((a, b) => Math.abs(d.map[idx(b)].value) - Math.abs(d.map[idx(a)].value))
          .slice(0, 7);
        for (const peer of s.drones)
          if (peer !== d)
            for (const c of evidence) {
              if (s.config.link === '断开' || (s.config.link === '延迟' && this.rand() < 0.36)) {
                d.lost++;
                continue;
              }
              s.messages.push({
                arrive: t + (s.config.link === '延迟' ? 2.4 : 0.25) + 0.15 * this.rand(),
                stamp: t,
                from: d.id,
                to: peer.id,
                key: idx(c),
                observation: { ...d.map[idx(c)] },
                frame: 'harbor',
                sigma: Math.min(2, (t - d.lastFix) * 0.015 + 0.12),
              });
              d.shared++;
            }
      }
    }
    d.lastScan = t;
  }
  communication() {
    const s = this.s;
    s.requests = s.requests.filter((req) => {
      if (req.arrive > s.time) return true;
      const peer = s.drones[req.to];
      if (!peer || level(s) < 5 || !s.config.share || s.config.link === '断开' || s.time - req.stamp > 3.5)
        return false;
      peer.survey = { cell: req.cell, until: s.time + 1.6 };
      this.log(peer.id, '响应蜂鸟 0' + (req.from + 1) + '的协查，转动测距扫描方向', peer.frame);
      return false;
    });
    s.messages = s.messages.filter((m) => {
      if (m.arrive > s.time) return true;
      const d = s.drones[m.to];
      if (!d) return false;
      const old = d.map[m.key];
      if (
        !s.config.share ||
        s.config.link === '断开' ||
        m.frame !== 'harbor' ||
        s.time - m.stamp > 3.5 ||
        m.sigma > 1.4 ||
        (old && old.t >= m.stamp)
      ) {
        d.lost++;
        return false;
      }
      d.map[m.key] = { ...m.observation, value: m.observation.value * 0.82 };
      d.received++;
      return false;
    });
    s.reservations = s.reservations.filter((r) => r.end >= s.time - 0.1);
  }
  rules(d: Drone) {
    const s = this.s,
      avoid = d.order?.avoid;
    const rules = s.events.filter((e) => e.kind === 'closed' || e.kind === 'ceiling');
    if (canAdapt(s) && d.predicted && d.predicted.at + d.predicted.duration > s.time) rules.push(d.predicted);
    if (avoid != null) {
      const st = STATIONS[avoid] ?? { i: 3, j: 5 };
      rules.push({ id: -1, kind: 'closed', i: st.i, j: st.j, at: 0, duration: 1e7 });
    }
    return rules;
  }
  route(d: Drone, goal: Cell) {
    const s = this.s,
      adaptive = canAdapt(s),
      from = toCell(d.pose),
      rules = this.rules(d);
    const team = level(s) >= 5 && s.config.link !== '断开' ? s.reservations : [];
    const fresh = s.time >= d.nextPlan;
    if (fresh) {
      const path = plan(from, goal, adaptive ? d.map : {}, s.time, rules, team, d.id, adaptive);
      d.route = path;
      d.nextPlan = s.time + (path.length ? 3.2 : 1.1);
      s.routeCount++;
      if (level(s) >= 5 && s.config.link !== '断开') {
        s.reservations = s.reservations
          .filter((r) => r.drone !== d.id)
          .concat(reserve(path, from, s.time, d.id));
        d.reservedUntil = s.time + 3.8;
      }
    }
    let next = d.route[0];
    if (next && distance(d.pose, center(next)) < 0.85) {
      d.route.shift();
      next = d.route[0];
    }
    if (!next) {
      if (idx(from) === idx(goal)) {
        d.destination = center(goal);
        return distance(d.pose, center(goal)) < 1.05;
      }
      d.destination = { ...d.pose };
      d.waited += 0.16;
      this.reason(d, '通道证据或预约不足 · 等待重规划');
      return false;
    }
    if (rules.some((e) => constraint(e, next, s.time))) {
      d.destination = { ...d.pose };
      d.waited += 0.16;
      this.reason(d, '航务通告限制了下一格 · 等待');
      return false;
    }
    if (level(s) >= 5 && s.config.link === '断开' && s.time > d.reservedUntil) {
      d.destination = { ...d.pose };
      this.reason(d, '通信中断 · 空域预约到期，就地等待');
      d.waited += 0.16;
      return false;
    }
    if (team.some((r) => r.drone !== d.id && r.key === idx(next) && r.start <= s.time && r.end >= s.time)) {
      d.destination = { ...d.pose };
      d.waited += 0.16;
      this.reason(d, '队友已预约该航段 · 让行');
      return false;
    }
    const p = center(next),
      aligned = bearing(d.pose, p);
    const stopDistance =
      0.7 + Math.hypot(d.v.x, d.v.z) * 0.22 + (canAdapt(s) && d.ttc !== null && d.ttc < 1 ? 0.48 : 0);
    if (
      Math.abs(d.pose.y - p.y) < 1.1 &&
      d.front < stopDistance &&
      Math.abs(Math.atan2(Math.sin(aligned - d.yaw), Math.cos(aligned - d.yaw))) < 1.1
    ) {
      d.destination = { ...d.pose };
      d.waited += 0.16;
      d.nextPlan = s.time + 0.22;
      d.scanYaw = adaptive ? Math.sin(s.time) * 0.8 : 0;
      this.reason(d, d.closing > 1 ? '前方距离正在缩短 · 提前制动' : '测距触发保护 · 悬停复核');
      return false;
    }
    d.destination = p;
    this.reason(d, adaptive ? '依据当前认知地图沿可用航段飞行' : '执行公布的城市航线');
    return false;
  }
  search(d: Drone) {
    const s = this.s,
      station = d.order!.station,
      st = STATIONS[station],
      anchor = ground(st.i, st.j),
      t = s.time;
    const fresh = d.evidence && t - d.evidence.time < 1.05;
    const sign = fresh
      ? d.evidence!.detections.find((v) => v.label === station && v.score > 0.72)
      : undefined;
    const levelPatch = d.depthSamples > 0 && d.roughness < 0.43;
    if (level(s) === 1 || (sign && levelPatch)) {
      if (level(s) >= 5 && s.drones.length > 1) {
        const lease = s.docks[station];
        if (s.config.link === '断开' || (lease && lease.drone !== d.id && lease.until > t)) {
          d.destination = { ...d.pose };
          d.waited += 0.16;
          this.reason(d, '等待柜台预约 · 保持当前飞行层');
          return;
        }
        s.docks[station] = { drone: d.id, until: t + 9 };
      }
      if (sign && level(s) >= 2) {
        // Only one of the tabletop cabinet's nine intake slots can be selected.
        const slot = (a: number) => clamp(Math.round(a / 0.55), -1, 1) * 0.55;
        const scale = (2 * d.headroom * Math.tan((FOV * Math.PI) / 360)) / HEIGHT;
        d.dock = {
          x: anchor.x + slot(d.pose.x - anchor.x + (sign.x - WIDTH / 2) * scale),
          z: anchor.z + slot(d.pose.z - anchor.z + (sign.y - HEIGHT / 2) * scale),
          y: d.pose.y - d.headroom + 0.55,
        };
        d.accepted++;
        if (d.views > 0) d.viewGain = Math.max(d.viewGain, sign.score - d.beforeView);
      } else d.dock = { ...anchor, y: d.pose.y - d.headroom + 0.55 };
      d.destination = { ...d.dock, y: Math.max(2.8, d.dock.y + 1.2) };
      this.phase(
        d,
        'dock',
        sign && level(s) >= 2 ? '视觉确认指定柜口 · 等待落稳交接' : '按航单的已知柜区着陆'
      );
      return;
    }
    d.waited += 0.16;
    if (!d.order!.wait && t - d.since > 2.5) {
      d.route = [];
      d.nextPlan = 0;
      this.phase(d, 'back', '指令要求不停留 · 包裹返仓');
      return;
    }
    if (canAdapt(s) && t - d.since > 1 && t >= d.nextPlan) {
      d.choices = frontier(d.map, toCell(d.pose), t, { ...anchor, y: 5.4 });
      d.views++;
      if (level(s) >= 5 && s.config.share && s.config.link !== '断开' && t - d.lastRequest > 3.5) {
        d.lastRequest = t;
        const sector = toCell(d.pose),
          nearby = s.drones
            .filter((peer) => peer.id !== d.id && flat(peer.pose, d.pose) < 12)
            .sort((a, b) => flat(a.pose, d.pose) - flat(b.pose, d.pose))[0];
        if (nearby && (s.config.link === '正常' || this.rand() > 0.36))
          s.requests.push({
            from: d.id,
            to: nearby.id,
            cell: sector,
            stamp: t,
            arrive: t + (s.config.link === '延迟' ? 2.4 : 0.25),
          });
      }
      const act = this.action(d, d.headroom < 3 ? 3 : d.closing > 1 ? 2 : 0);
      const chosen = d.choices[0];
      d.actionName = ['等待', '换视角', '绕行复查'][act];
      d.beforeView = sign?.score ?? 0;
      if (act === 0) {
        d.destination = { ...d.pose };
        this.reason(d, '策略选择等待 · 等候新的柜口画面');
      } else if (act === 2 && chosen) {
        d.observation = center(chosen.cell);
        d.observeUntil = t + 2.2;
        d.destination = d.observation;
        d.route = [];
        d.nextPlan = 0;
        this.phase(d, 'out', '训练策略选择绕行 · 从另一个已观测航段重新接近');
        return;
      } else if (chosen) {
        const p = center(chosen.cell),
          dx = p.x - anchor.x,
          dz = p.z - anchor.z;
        d.destination = {
          x: anchor.x + clamp(dx, -2.1, 2.1),
          z: anchor.z + clamp(dz, -2.1, 2.1),
          y: 5.4 + (d.views % 2) * 1.1,
        };
        d.scanYaw += 0.6;
        this.reason(d, '柜口证据不足 · 移到已观测区域换视角');
      } else {
        d.scanYaw += 0.7;
        this.reason(d, '可用视点不足 · 扫描邻近格');
      }
      d.nextPlan = t + 1.45;
    } else this.reason(d, '等待机载图像确认订单标记');
  }
  action(d: Drone, evidence: number) {
    if (this.s.config.policy !== 'learned' || !this.policy) return 1;
    const key = evidence * 4 + (d.order!.priority >= 3 ? 2 : 0) + (this.s.drones.length > 1 ? 1 : 0);
    const q = this.policy[this.s.config.model].q[key];
    return q.indexOf(Math.max(...q));
  }
  control(d: Drone) {
    const s = this.s,
      t = s.time,
      o = d.order;
    if (!o || !working(d)) return;
    if (t > o.deadline + 40 || d.battery <= 2) {
      this.finish(d, 'abort', d.signed ? '已签收，返航超时' : '超时或电量不足');
      return;
    }
    if (!d.signed && t > o.deadline && d.phase !== 'back' && d.phase !== 'down') {
      this.phase(d, 'back', '订单超时 · 包裹返仓');
      d.route = [];
      d.nextPlan = 0;
    }
    const st = STATIONS[o.station],
      band = s.config.chapter >= 5 ? d.id : 0,
      cruise = LAYERS[band];
    if (d.manual) {
      d.destination = {
        x: d.pose.x + this.manualInput.x * 2,
        y: clamp(d.pose.y + this.manualInput.y * 2, 1, 15),
        z: d.pose.z + this.manualInput.z * 2,
      };
      this.reason(d, '手动接管 · 键盘控制');
      return;
    }
    if (d.phase === 'out' && d.observation && t < d.observeUntil) {
      d.destination = d.observation;
      return;
    }
    switch (d.phase) {
      case 'load':
        if (t - d.since > 0.7 + (s.config.chapter >= 5 ? d.id * 1.1 : 0)) {
          d.destination = { ...d.base, y: cruise };
          this.phase(d, 'up', '装载完成 · 离开起降位');
        }
        break;
      case 'up':
        d.destination.y = cruise;
        if (Math.abs(d.pose.y - cruise) < 0.5) {
          this.phase(d, 'out', '进入城市配送航线');
          d.route = [];
        }
        break;
      case 'out':
        if (this.route(d, { i: st.i, j: st.j, l: band })) {
          d.nextPlan = t + 1;
          this.phase(d, 'search', '进入订单目标区域');
        }
        break;
      case 'search':
        this.search(d);
        break;
      case 'dock': {
        if (!d.dock) break;
        if (flat(d.pose, d.dock) < 0.43) d.destination = { ...d.dock };
        if (d.headroom < 0.81 && Math.abs(d.v.y) < 1.25 && flat(d.pose, d.dock) < 0.65) {
          const judge = this.city.judge(o.station, d.p, this.extra);
          if (judge.accepted) {
            d.signed = true;
            d.error = judge.error;
            d.route = [];
            d.nextPlan = 0;
            d.destination = { ...d.pose, y: LAYERS[0] };
            this.phase(d, 'back', '柜台已签收 · 返回物流枢纽');
          } else if (t - d.since > 1.1) {
            d.attempted++;
            d.dock = null;
            d.destination = { ...ground(st.i, st.j), y: LAYERS[0] };
            this.phase(d, 'search', '柜台占用或未落稳 · 重新观察');
          }
        } else if (t - d.since > 8) {
          d.destination = { ...ground(st.i, st.j), y: LAYERS[0] };
          this.phase(d, 'search', '交接条件变化 · 再次识别');
        }
        break;
      }
      case 'back': {
        if (d.pose.y < cruise - 0.45 && flat(d.pose, { ...ground(st.i, st.j), y: 0 }) < 3) {
          d.destination = { ...d.pose, y: cruise };
          break;
        }
        const hub = STATIONS[0];
        if (this.route(d, { i: hub.i, j: hub.j, l: band })) {
          d.destination = { ...d.base, y: cruise };
          this.phase(d, 'down', '进入归港起降位');
        }
        break;
      }
      case 'down': {
        if (!d.homeLocked && level(s) >= 2) {
          const hub =
            d.evidence && t - d.evidence.time < 1
              ? d.evidence.detections.find((v) => v.label === 0 && v.score > 0.74)
              : null;
          if (hub) {
            const chart = ground(STATIONS[0].i, STATIONS[0].j),
              scale = (2 * (d.headroom + 0.12) * Math.tan((FOV * Math.PI) / 360)) / HEIGHT;
            d.pose.x += clamp(chart.x - d.pose.x - (hub.x - WIDTH / 2) * scale, -1.4, 1.4);
            d.pose.z += clamp(chart.z - d.pose.z - (hub.y - HEIGHT / 2) * scale, -1.4, 1.4);
            d.homeLocked = true;
          } else {
            d.destination = { ...ground(STATIONS[0].i, STATIONS[0].j), y: cruise };
            this.reason(d, '归港复核 · 寻找枢纽标记');
            break;
          }
        }
        d.destination = {
          ...d.base,
          y: flat(d.pose, d.base) < 0.67 ? d.base.y : Math.max(d.pose.y, d.base.y + 1.3),
        };
        if (flat(d.p, d.base) < 1.05 && Math.abs(d.p.y - d.base.y) < 0.32 && Math.abs(d.v.y) < 1.45)
          this.finish(d, 'done', d.signed ? '已签收并归港' : '包裹返仓');
        else if (t - d.since > 9) {
          d.homeLocked = false;
          d.since = t;
          d.destination = { ...ground(STATIONS[0].i, STATIONS[0].j), y: cruise };
        }
        break;
      }
    }
  }
  finish(d: Drone, p: 'abort' | 'done', message: string) {
    this.phase(d, p, message);
    d.v = point();
    d.vi = point();
    d.destination = { ...d.p };
    d.manual = false;
    this.s.completed.push({
      station: d.order!.station,
      drone: d.id,
      signed: d.signed,
      result: message,
      time: this.s.time - d.start,
      path: d.travelled,
      energy: d.energy,
      collisions: d.collisions,
      error: d.error,
      closest: d.closest,
      poseRms: Math.sqrt(d.poseError / Math.max(1, d.poseN)),
      wait: d.waited,
      samples: d.samples,
    });
    if (this.s.completed.length > 200) this.s.completed.shift();
    this.s.reservations = this.s.reservations.filter((r) => r.drone !== d.id);
  }
  step(dt: number) {
    const s = this.s;
    s.time += dt;
    this.extra = this.city.obstacles(s.events, s.time);
    const boxes: Box[] = [...this.city.lots, ...this.extra];
    const peerHulls = s.drones.map((d) => ({
      x: d.p.x,
      y: d.p.y - 0.24,
      z: d.p.z,
      w: 1.05,
      h: 0.48,
      d: 1.05,
    }));
    this.communication();
    for (const d of s.drones) {
      const local = s.drones.length > 1 ? boxes.concat(peerHulls.filter((_, i) => i !== d.id)) : boxes;
      if (s.time - d.lastScan >= 0.19) this.sensor(d, local);
      if (!working(d)) {
        d.battery = Math.min(100, d.battery + dt * 2.3);
        continue;
      }
      if (s.time - d.lastControl >= 0.145) {
        this.control(d);
        d.lastControl = s.time;
        if (
          d.evidence &&
          d.evidence.frame !== 0 &&
          d.evidence.time >= s.time - 0.35 &&
          d.evidence.latency >= 0
        ) {
          this.latencies.push(performance.now() - d.evidence.wall);
          if (this.latencies.length > 2400) this.latencies.shift();
          d.evidence.latency = -1;
        }
      }
      if (!working(d)) continue;
      const prev = { ...d.p },
        v0 = { ...d.v },
        to = d.destination,
        wind = s.config.weather === '阵风' ? 0.22 : 0;
      const speed = 6.8 / (1 + 0.12 * (d.signed ? 0 : d.order!.mass));
      const velocity = (a: number, b: number, max: number) => clamp((a - b) * 2.9, -max, max);
      const vx = velocity(to.x, d.pose.x, speed),
        vz = velocity(to.z, d.pose.z, speed),
        mag = Math.hypot(vx, vz);
      const factor = Math.min(1, speed / Math.max(mag, 0.01)),
        response = Math.min(1, dt * 5.2);
      d.v.x += (vx * factor + wind * Math.sin(s.time * 0.8) - d.v.x) * response;
      d.v.z += (vz * factor + wind * Math.cos(s.time * 0.65) - d.v.z) * response;
      d.v.y += (velocity(to.y, d.pose.y, 3.9) - d.v.y) * response;
      const proposed = {
        x: d.p.x + d.v.x * dt,
        y: Math.max(0.54, d.p.y + d.v.y * dt),
        z: d.p.z + d.v.z * dt,
      };
      const hit = touches(proposed, local);
      if (hit) {
        if (!d.touching) d.collisions++;
        d.v = point();
        d.nextPlan = 0;
      } else d.p = proposed;
      d.touching = hit;
      // The inertial sensor quantizes changes in velocity and adds a repeatable bias.
      for (const a of ['x', 'z'] as const) {
        const dv = Math.round((d.v[a] - v0[a]) * 10000) / 10000;
        d.vi[a] += dv + dt * 0.0007 * Math.sin(s.time * 0.37 + d.id + (a === 'x' ? 0 : 2));
        d.pose[a] += d.vi[a] * dt;
      }
      d.pose.y = Math.round((d.p.y + 0.014 * Math.sin(s.time * 2 + d.id)) * 50) / 50;
      if (s.config.chapter < 3) {
        d.pose.x += (Math.round((d.p.x + 0.065 * Math.sin(s.time)) * 10) / 10 - d.pose.x) * 0.18;
        d.pose.z += (Math.round((d.p.z + 0.065 * Math.cos(s.time)) * 10) / 10 - d.pose.z) * 0.18;
      }
      if (Math.hypot(d.v.x, d.v.z) > 0.25) {
        const target = bearing(prev, d.p),
          delta = Math.atan2(Math.sin(target - d.yaw), Math.cos(target - d.yaw));
        d.yaw += delta * Math.min(1, dt * 6);
        d.bank = clamp(delta, -0.18, 0.18);
      }
      const len = distance(prev, d.p);
      d.travelled += len;
      const energy = dt * 0.016 + len * 0.012 + Math.max(0, d.p.y - prev.y) * 0.035;
      d.energy += energy;
      d.battery -= energy;
      d.poseError += distance(d.pose, d.p) ** 2;
      d.poseN++;
      if (s.time - d.lastTrace > 0.32) {
        d.trace.push({ ...d.p });
        if (d.trace.length > 1200) d.trace.shift();
        d.lastTrace = s.time;
      }
    }
    for (let i = 0; i < s.drones.length; i++)
      for (let j = i + 1; j < s.drones.length; j++) {
        const a = s.drones[i],
          b = s.drones[j],
          gap = distance(a.p, b.p);
        for (const d of [a, b]) if (working(d)) d.closest = Math.min(d.closest ?? Infinity, gap);
      }
    if (s.config.mode === '运营' && s.time >= s.nextOrder) {
      s.nextOrder = s.time + 12 + this.external() * 9;
      if (s.orders.length < 6) this.order(1 + Math.floor(this.external() * 4));
    }
    if (s.orders.length) this.dispatch();
  }
  restore(saved: State) {
    this.s = structuredClone(saved);
    this.city = new City(saved.config.seed);
    this.s.externalRng ??= (saved.config.seed + 937) >>> 0;
    this.s.docks ??= {};
    this.s.requests ??= [];
    this.s.config.navigation ??= '融合';
    this.s.drones = this.s.drones.map((d) => Object.assign(aircraft(this.city, d.id), d));
    for (const d of this.s.drones) if (d.evidence) d.evidence.latency = -1;
    this.extra = this.city.obstacles(this.s.events, this.s.time);
    this.latencies = [];
    this.manualInput = point();
  }
}
