import { CityView } from './renderer';
import { Simulation, defaults } from './simulation';
import type { Config, Policy, Receipt, State } from './simulation';
import { HEIGHT, WIDTH, STATIONS } from './city';
import type { Point } from './city';
import type { Capture, Observation } from './vision-types';

export interface Frame {
  input: Capture;
  result: Observation;
  pose: Point;
}
export interface TickRecord {
  time: number;
  positions: Point[];
  decision: string[];
  frame: number[];
}
interface Snapshot {
  state: State;
  frames: Capture[];
  timeline: TickRecord[];
}
export const quantile = (v: number[], p: number) =>
  v.length ? [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))] : 0;
export const timeText = (t: number) =>
  String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t) % 60).padStart(2, '0');
export class Game {
  sim: Simulation;
  view: CityView;
  worker: Worker;
  ready = false;
  error = '';
  epoch = 1;
  serial = 0;
  paused = false;
  speed = 1;
  selected = 0;
  verifiedMode = false;
  forward = false;
  frameClock = 0;
  nextDrone = 0;
  pending: Promise<void> | null = null;
  frames = new Map<number, Frame>();
  rawHistory: Capture[] = [];
  archive: Frame[] = [];
  timeline: TickRecord[] = [];
  snapshot: Snapshot | null = null;
  previous: { trace: Point[]; outcomes: Receipt[]; name: string; time: number } | null = null;
  training: any = null;
  metrics = { intervals: [] as number[], inference: [] as number[], dropped: 0 };
  fps = 0;
  previousWall = 0;
  accumulator = 0;
  lastUI = 0;
  lastRecord = -1;
  lastCompleted = 0;
  lectureTime = -1;
  lectureCue = -1;
  lectureSnapshot: Snapshot | null = null;
  lectureReport: Receipt[] = [];
  lectureFirst: Point[] = [];
  onUpdate = () => {};
  onFrame = (_f: Frame) => {};
  onError = (_s: string) => {};
  onNotice = (_s: string) => {};
  onComplete = (_r: Receipt) => {};
  onCamera = (_pixels: Uint8Array) => {};
  onReset = () => {};
  resolver: ((obs: Observation | null) => void) | null = null;
  constructor(element: HTMLElement, config: Config = { ...defaults }) {
    this.sim = new Simulation(config);
    this.view = new CityView(element, this.sim);
    this.worker = new Worker('./vision.js', { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'ready') {
        this.ready = true;
        this.onUpdate();
      }
      if (data.type === 'result') this.resolver?.(data.result);
      if (data.type === 'error') {
        this.error = data.message;
        this.resolver?.(null);
        this.onError(this.error);
      }
    };
    this.worker.onerror = (e) => {
      this.error = e.message || '图像工作线程启动失败';
      this.resolver?.(null);
      this.onError(this.error);
    };
    this.worker.postMessage({ type: 'init' });
    Promise.all([
      fetch('./models/policy.json').then((v) => v.json()),
      fetch('./models/training.json').then((v) => v.json()),
    ])
      .then(([p, t]) => {
        this.sim.policy = p.stages as Policy;
        this.training = t;
      })
      .catch((e) => {
        this.error = String(e);
        this.onError(this.error);
      });
  }
  start() {
    requestAnimationFrame(this.loop);
  }
  loop = (now: number) => {
    if (!this.previousWall) this.previousWall = now;
    const delta = (now - this.previousWall) / 1000;
    this.previousWall = now;
    if (!this.verifiedMode) {
      if (delta > 0 && delta < 2) {
        this.metrics.intervals.push(delta * 1000);
        if (this.metrics.intervals.length > 4000) this.metrics.intervals.shift();
      }
      if (!this.paused) {
        this.accumulator += Math.min(0.25, delta) * this.speed;
        let ticks = 0;
        while (this.accumulator >= 1 / 30 && ticks++ < 30) {
          this.step();
          this.accumulator -= 1 / 30;
        }
      }
      this.view.selected = this.selected;
      this.view.render();
      if (this.ready && !this.pending && !this.paused && now - this.frameClock >= 110) {
        this.frameClock = now;
        void this.sample(this.nextDrone++ % this.sim.s.drones.length);
      }
      if (now - this.lastUI > 145) {
        this.lastUI = now;
        this.fps = 1000 / Math.max(1, quantile(this.metrics.intervals.slice(-100), 0.5));
        this.onUpdate();
      }
    }
    requestAnimationFrame(this.loop);
  };
  step() {
    this.sim.step(1 / 30);
    const s = this.sim.s;
    if (s.time - this.lastRecord >= 0.45 || s.time < this.lastRecord) {
      this.lastRecord = s.time;
      this.timeline.push({
        time: s.time,
        positions: s.drones.map((d) => ({ ...d.p })),
        decision: s.drones.map((d) => d.reason),
        frame: s.drones.map((d) => d.frame),
      });
      if (this.timeline.length > 1100) this.timeline.shift();
    }
    if (s.completed.length > this.lastCompleted) {
      const receipt = s.completed[s.completed.length - 1];
      this.onComplete(receipt);
      if (this.lectureTime >= 0) this.lectureReport.push({ ...receipt });
      this.lastCompleted = s.completed.length;
    }
    if (this.lectureTime >= 0) {
      this.lectureTime += 1 / 30;
      this.advanceLecture();
    }
  }
  ask(input: Capture): Promise<Observation | null> {
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        this.resolver = null;
        this.error = '推理线程响应超时';
        this.onError(this.error);
        resolve(null);
      }, 10000);
      this.resolver = (r) => {
        clearTimeout(timeout);
        this.resolver = null;
        resolve(r);
      };
      const pixels = input.pixels.slice();
      this.worker.postMessage({ ...input, pixels }, [pixels.buffer]);
    });
  }
  async sample(id: number) {
    if (this.pending) return this.pending;
    const job = async () => {
      const s = this.sim.s,
        d = s.drones[id];
      if (!d || !this.ready || this.error) return;
      const wall = performance.now(),
        capture: Capture = {
          type: 'frame',
          drone: id,
          epoch: this.epoch,
          frame: ++this.serial,
          sample: s.time,
          wall,
          model: s.config.model,
          width: WIDTH,
          height: HEIGHT,
          pixels: this.view.capture(id),
        };
      const pose = { ...d.pose };
      const result = await this.ask(capture);
      if (!result || result.epoch !== this.epoch) return;
      const accepted = this.sim.receive(result, performance.now() - wall);
      if (!accepted) {
        this.metrics.dropped++;
        return;
      }
      const current = { input: capture, result, pose };
      this.frames.set(id, current);
      this.archive.push(current);
      if (this.archive.length > 55) this.archive.shift();
      this.rawHistory.push(capture);
      if (this.rawHistory.length > this.sim.s.drones.length * 2) this.rawHistory.shift();
      this.metrics.inference.push(result.ms);
      if (this.metrics.inference.length > 2400) this.metrics.inference.shift();
      if (id === this.selected) {
        this.onFrame(current);
        if (this.forward) this.onCamera(this.view.capture(id, true));
      }
    };
    this.pending = job().finally(() => (this.pending = null));
    return this.pending;
  }
  clearTemporal() {
    this.epoch++;
    this.frames.clear();
    this.archive = [];
    this.rawHistory = [];
    this.lastRecord = -1;
    this.nextDrone = 0;
    this.metrics.dropped = 0;
    this.view.lastRoute = -10;
    this.view.lastTraffic = -10;
    this.frameClock = 0;
    this.accumulator = 0;
  }
  reset(config: Config = { ...this.sim.s.config }, keepLecture = false) {
    const policy = this.sim.policy;
    this.sim = new Simulation(config);
    this.sim.policy = policy;
    this.view.sim = this.sim;
    this.view.setCity();
    this.view.ghost = [];
    this.timeline = [];
    this.lastCompleted = 0;
    this.selected = 0;
    this.snapshot = null;
    this.previous = null;
    this.clearTemporal();
    this.paused = false;
    if (!keepLecture) {
      this.lectureTime = -1;
      this.lectureCue = -1;
    }
    this.onReset();
    this.onUpdate();
  }
  checkpoint(): Snapshot {
    return {
      state: structuredClone(this.sim.s),
      frames: structuredClone(this.rawHistory),
      timeline: structuredClone(this.timeline),
    };
  }
  async save() {
    const was = this.paused;
    this.paused = true;
    await this.pending;
    this.snapshot = this.checkpoint();
    this.paused = was;
    this.onNotice('已保存实验起点和机载历史帧');
  }
  async restore(snapshot: Snapshot, adaptive: boolean) {
    this.paused = true;
    await this.pending;
    this.restoreWorld(snapshot, adaptive);
    for (const f of snapshot.frames) {
      const warmed = await this.ask({ ...f, epoch: this.epoch, wall: performance.now() });
      if (!warmed) break;
    }
    this.paused = false;
    this.onUpdate();
  }
  restoreWorld(snapshot: Snapshot, adaptive: boolean) {
    this.clearTemporal();
    this.sim.restore(snapshot.state);
    this.sim.s.config.adaptive = adaptive;
    this.timeline = structuredClone(snapshot.timeline);
    this.lastCompleted = this.sim.s.completed.length;
    this.view.sim = this.sim;
    this.view.lastWeather = '';
    this.selected = Math.min(this.selected, this.sim.s.drones.length - 1);
    this.onReset();
  }
  async branch(adaptive: boolean) {
    if (!this.snapshot) {
      this.onNotice('请先保存一个实验起点');
      return;
    }
    const d = this.sim.s.drones[this.selected];
    this.previous = {
      name: this.sim.s.config.adaptive ? '主动配置' : '基线配置',
      trace: structuredClone(d.trace),
      outcomes: structuredClone(this.sim.s.completed.slice(this.snapshot.state.completed.length)),
      time: this.sim.s.time,
    };
    await this.restore(this.snapshot, adaptive);
    this.view.ghost = this.previous.trace;
    this.onNotice('同条件重演已开始 · 上一分支轨迹以紫色虚线显示');
  }
  beginLecture() {
    this.reset({ ...defaults, chapter: 1, seed: this.sim.s.config.seed }, true);
    this.lectureTime = 0;
    this.lectureCue = -1;
    this.lectureReport = [];
    this.lectureFirst = [];
    this.lectureSnapshot = null;
    this.speed = 1;
    this.advanceLecture();
  }
  advanceLecture() {
    const t = this.lectureTime,
      s = this.sim.s;
    const times = [0, 35, 80, 105, 135, 220, 248, 285, 325, 350, 375, 420];
    const cue = times.reduce((n, v, i) => (t >= v ? i : n), -1);
    if (cue === this.lectureCue) return;
    this.lectureCue = cue;
    if (cue === 0) {
      this.sim.order(1);
      this.onNotice('接单与起飞 · 观察物流枢纽');
    }
    if (cue === 1) {
      const st = STATIONS[3];
      this.sim.place('occupied', st.i, st.j, 4, 26);
      this.sim.order(3);
    }
    if (cue === 2) {
      s.config.chapter = 2;
      this.forward = false;
      this.sim.order(4);
      this.onNotice('视觉识别 · 查看检测框与原始帧');
    }
    if (cue === 3) {
      s.config.chapter = 3;
      this.onNotice('视觉与建图 · 比较机载画面与认知地图');
    }
    if (cue === 4) {
      s.config.chapter = 4;
      const st = STATIONS[2];
      this.sim.place('occupied', st.i, st.j, 8, 19);
      this.sim.order(2);
    }
    if (cue === 5) {
      s.config.chapter = 4;
      this.sim.order(1);
      this.sim.place('closed', 4, 6, 3, 18);
      this.lectureSnapshot = this.checkpoint();
      s.config.adaptive = false;
      this.onNotice('相同起点 · 正在运行固定航线基线');
    }
    if (cue === 6 && this.lectureSnapshot) {
      this.lectureFirst = structuredClone(s.drones[0].trace);
      this.restoreWorld(this.lectureSnapshot, true);
      this.view.ghost = this.lectureFirst;
      this.onNotice('相同起点 · 当前分支重新采集机载画面');
    }
    if (cue === 7) {
      const state = this.sim.s;
      state.config.chapter = 5;
      this.sim.setFleet(3);
      this.sim.order(1);
      this.sim.order(2);
      this.sim.order(3);
      this.onNotice('协同配送 · 三架无人机接单');
    }
    if (cue === 8) {
      this.sim.s.config.link = '延迟';
      this.sim.place('traffic', 6, 4, 0, 20);
    }
    if (cue === 9) {
      this.sim.s.config.link = '正常';
      this.sim.order(4);
    }
    if (cue === 10) {
      this.sim.s.config.link = '正常';
      this.sim.order(2);
      this.onNotice('视觉签收 · 查看任务记录');
    }
    if (cue === 11) {
      this.lectureTime = -1;
      this.onNotice('七分钟讲演结束 · 可查看每笔订单的实际结果');
    }
    this.onUpdate();
  }
  async advance(seconds: number, capturePeriod = 0.22) {
    // Automated classroom regression uses the same city, cameras, worker and controller.
    // Only the simulation clock is accelerated. Pause between camera samples for CPU work.
    this.verifiedMode = true;
    await this.pending;
    for (let tick = 0; tick < Math.round(seconds * 30); tick++) {
      this.step();
      if (tick % Math.max(1, Math.round(capturePeriod * 30)) === 0) {
        this.view.render();
        await this.sample(this.nextDrone++ % this.sim.s.drones.length);
        if (this.error) throw Error(this.error);
      }
    }
    this.view.render();
    this.onUpdate();
  }
}
