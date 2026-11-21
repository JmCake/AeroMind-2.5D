import { COLORS, HEIGHT, STATIONS, WIDTH } from './city';
import { drawDetection, drawRaw } from './camera-display';
import { Game, timeText } from './runtime';
import type { Frame } from './runtime';
import { defaults, PHASES } from './simulation';

const lessons = [
  { key: 'first-flight', title: '把包裹送到图书馆', topic: '视觉签收', chapter: 2, seed: 617, stops: [1],
    intro: '点「开始配送」，看无人机怎样认出图书馆的收件柜。', start: '开始配送' },
  { key: 'cover', title: '柜标被挡住了怎么办？', topic: '遮挡与重新观察', chapter: 4, seed: 617, stops: [1],
    intro: '点「遮住柜标并起飞」。无人机到达图书馆后，由你移开遮挡。', start: '遮住柜标并起飞' },
  { key: 'fleet', title: '让三架无人机一起送货', topic: '多机协作', chapter: 5, seed: 811, stops: [1, 2, 3],
    intro: '点「派出三架无人机」，看它们怎样分头送货、依次归港。', start: '派出三架无人机' },
];
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const raw = el<HTMLCanvasElement>('raw'), detected = el<HTMLCanvasElement>('detected');
const action = el<HTMLButtonElement>('action'), previous = el<HTMLButtonElement>('previous');
const pair = el('image-pair');
const say = (id: string, value: string) => {
  const node = el(id);
  if (node.textContent !== value) node.textContent = value;
};
type Stage = 'ready' | 'flying' | 'blocked' | 'finished';
const hashLesson = () => Math.max(0, lessons.findIndex((p) => '#' + p.key === location.hash));
let index = hashLesson(), stage: Stage = 'ready';
let coverId: number | undefined;
let best: Frame | undefined;
let bestQuality = -Infinity;
const lesson = () => lessons[index];
const config = () => ({ ...defaults, chapter: lesson().chapter, fleet: lesson().stops.length, seed: lesson().seed });
const demo = new Image();
let game: Game;

function example() {
  if (!demo.naturalWidth || stage !== 'ready') return;
  for (const [half, canvas] of [raw, detected].entries()) {
    canvas.getContext('2d')!.drawImage(demo, half * WIDTH, 0, WIDTH, HEIGHT, 0, 0, WIDTH, HEIGHT);
  }
  pair.dataset.source = 'example';
}

function showFrame(frame: Frame, source: 'live' | 'review') {
  drawRaw(raw, frame.input.pixels);
  drawDetection(detected, frame, true);
  pair.dataset.frame = String(frame.input.frame);
  pair.dataset.source = source;
  say('source', source === 'review' ? '本次飞行回看' : game.paused ? '暂停观察' : '机载实时画面');
  const target = game.sim.s.drones[frame.input.drone].order?.station;
  const hit = frame.result.detections.find((box) => box.label === target) ?? frame.result.detections[0];
  let reading = '这一帧还没有识别出柜标。';
  if (hit) {
    const name = STATIONS[hit.label].name;
    reading = hit.label === target
      ? '橙框圈出了「' + name + '」柜标。无人机用它对准收件柜。'
      : '模型认出了「' + name + '」标记。';
  }
  if (stage === 'blocked') reading = '遮挡盖住了图书馆柜标，这一帧没有图书馆识别框。';
  say('reading', reading);
  say('frame-caption', '蜂鸟 0' + (frame.input.drone + 1) + ' · 第 ' + frame.input.frame + ' 帧 · ' + timeText(frame.input.sample));
}

function clearImages() {
  for (const canvas of [raw, detected]) canvas.getContext('2d')!.clearRect(0, 0, WIDTH, HEIGHT);
  delete pair.dataset.frame;
  pair.dataset.source = 'pending';
}

function preparePage() {
  const p = lesson();
  clearImages();
  say('lesson-count', '第 ' + (index + 1) + ' 课 / 共 ' + lessons.length + ' 课');
  document.querySelectorAll('.ticks i').forEach((tick, i) => tick.classList.toggle('past', i <= index));
  say('lesson-title', p.title);
  say('lesson-name', '本课观察 · ' + p.topic);
  previous.hidden = index === 0;
  document.querySelector<HTMLAnchorElement>('.lab-link')!.href = './lab.html#' + p.key;
  const labels = [0, ...p.stops].map((station) => {
    const tag = document.createElement('span');
    tag.className = station ? 'pin destination' : 'pin';
    tag.dataset.station = String(station);
    tag.textContent = station ? STATIONS[station].name : '起点';
    return tag;
  });
  el('pins').replaceChildren(...labels);
  el('aircraft').replaceChildren(...game.sim.s.drones.map((d) => {
    const ring = document.createElement('span'), number = document.createElement('b');
    ring.className = 'aircraft';
    ring.style.setProperty('--flight', COLORS[d.id]);
    number.textContent = '0' + (d.id + 1);
    ring.append(number);
    return ring;
  }));
  say('itinerary', index === 2 ? '物流枢纽 → 图书馆、医院、工程站' : '物流枢纽 → 大学图书馆');
  say('source', '识别示例');
  say('reading', '左边是相机拍到的屋顶，右边的橙框标出了图书馆柜标。');
  say('frame-caption', '示例来自一次实际配送，起飞后切换为实时画面');
  example();
}

function update() {
  const s = game.sim.s, d = s.drones[game.selected], p = lesson();
  for (const tag of el('pins').children as HTMLCollectionOf<HTMLElement>) {
    const pos = game.view.project(game.sim.city.fixtures[Number(tag.dataset.station)]);
    tag.style.left = pos.x + 'px';
    tag.style.top = pos.y - 8 + 'px';
  }
  const airborne = el('aircraft');
  airborne.hidden = stage === 'ready' || stage === 'finished';
  for (const drone of s.drones) {
    const ring = airborne.children[drone.id] as HTMLElement | undefined;
    if (!ring || airborne.hidden) continue;
    const pos = game.view.project(drone.p);
    ring.style.left = pos.x + 'px';
    ring.style.top = pos.y + 'px';
  }
  say('mission-time', timeText(s.time));
  const signed = s.completed.filter((r) => r.signed && r.result === '已签收并归港').length;
  const total = p.stops.length;
  let button = p.start, instruction = p.intro, status = '准备起飞';
  if (stage === 'blocked') {
    button = '移开遮挡';
    status = '等你移开遮挡';
    instruction = '柜标看不见，无人机正在等待。点「移开遮挡」，观察右边的识别框。';
  } else if (stage === 'finished') {
    const success = signed === total;
    status = success ? '已签收并归港' : '本次配送已结束';
    button = !success ? '再试一次' : index === 2 ? '再上一次课' : '下一课';
    instruction = success
      ? ['图书馆已签收，无人机已归港。下一课试试把柜标遮住。', '移开遮挡后，无人机重新识别了图书馆柜标，完成了配送。', '三份包裹均已签收，三架无人机都已归港。'][index]
      : '本次有 ' + signed + ' / ' + total + ' 单签收归港。点「再试一次」重新派单。';
  } else if (stage === 'flying') {
    if (pair.dataset.source === 'live') say('source', game.paused ? '暂停观察' : '机载实时画面');
    button = game.paused ? '继续配送' : '暂停配送';
    status = game.paused ? '已暂停' : total === 1 ? PHASES[d.phase] : signed + ' / ' + total + ' 单已归港';
    instruction = game.paused ? '画面已暂停。点「继续配送」接着观察。'
      : index === 2 ? '三架无人机正在配送。右侧跟随蜂鸟 01，地图上可看三条航线。'
      : d.signed ? '图书馆已签收。无人机正在返航，到港后就可以进入下一课。'
      : index === 1 ? (coverId === undefined ? '遮挡已移开。观察识别框怎样帮助无人机重新对准柜口。'
        : '图书馆的柜标已被遮住。等无人机到达，我们一起看它能否认出来。')
      : '无人机正在配送。观察两张机载图像，看看橙色识别框什么时候出现。';
  }
  if (game.error) {
    button = '重新加载';
    status = '视觉暂不可用';
    instruction = '机载视觉未能运行。点「重新加载」重新启动本课。';
  } else if (!game.ready) button = '正在准备';
  say('action-text', button);
  say('instruction', instruction);
  say('flight-state', status);
  action.disabled = !game.ready && !game.error;
  action.classList.toggle('watching', stage === 'flying' && !game.paused && !game.error);
}

function openLesson(next: number) {
  index = next;
  stage = 'ready';
  best = undefined;
  coverId = undefined;
  bestQuality = -Infinity;
  history.replaceState(null, '', '#' + lesson().key);
  game.reset(config());
  game.paused = true;
  game.view.render();
  preparePage();
  update();
  window.scrollTo(0, 0);
}

function dispatch() {
  stage = 'flying';
  clearImages();
  say('source', '正在取景');
  say('reading', '正在读取无人机的第一帧画面。');
  say('frame-caption', '等待机载相机');
  if (index === 1) {
    const { i, j } = STATIONS[1];
    game.sim.place('occupied', i, j, 0, 150);
    coverId = game.sim.s.events.at(-1)!.id;
  }
  for (const stop of lesson().stops) game.sim.order(stop);
  game.paused = false;
}

function activate() {
  if (game.error) return location.reload();
  if (!game.ready) return;
  if (stage === 'ready') dispatch();
  else if (stage === 'blocked') {
    game.sim.s.events = game.sim.s.events.filter((e) => e.id !== coverId);
    coverId = undefined;
    stage = 'flying';
    game.paused = false;
  } else if (stage === 'finished') {
    const success = game.sim.s.completed.every((r) => r.signed && r.result === '已签收并归港');
    if (success) openLesson((index + 1) % lessons.length);
    else { openLesson(index); dispatch(); }
  } else game.paused = !game.paused;
  update();
}

function start() {
  game = new Game(el('city'), config());
  game.paused = true;
  game.view.zoom = 1.02;
  game.view.render();
  game.onUpdate = update;
  game.onFrame = (frame) => {
    if (stage !== 'flying') return;
    const d = game.sim.s.drones[frame.input.drone];
    const hit = frame.result.detections.find((v) => v.label === d.order?.station);
    if (hit && !d.signed && ['out', 'search', 'dock'].includes(d.phase)) {
      // Prefer a centered, legible sign with surrounding rooftop still in view.
      const quality = -Math.abs(hit.w - WIDTH / 3) - Math.hypot(hit.x - WIDTH / 2, hit.y - HEIGHT / 2) / 3;
      if (quality > bestQuality) { best = frame; bestQuality = quality; }
    }
    if (coverId !== undefined && d.phase === 'search' && frame.input.sample >= d.since && !hit) {
      stage = 'blocked';
      game.paused = true;
      update();
    }
    showFrame(frame, 'live');
  };
  game.onComplete = () => {
    if (game.sim.s.completed.length < lesson().stops.length) return;
    stage = 'finished';
    game.paused = true;
    const last = best ?? game.frames.get(game.selected);
    if (last) showFrame(last, 'review');
    update();
  };
  game.onError = (message) => {
    game.paused = true;
    el('fault').hidden = false;
    say('fault', message);
    update();
  };
  action.addEventListener('click', activate);
  previous.addEventListener('click', () => openLesson(Math.max(0, index - 1)));
  window.addEventListener('hashchange', () => openLesson(hashLesson()));
  demo.onload = example;
  demo.src = './guide-example.png';
  if (new URLSearchParams(location.search).has('verify')) Object.assign(window, { aeromind: game });
  preparePage();
  update();
  game.start();
}
try {
  start();
} catch (error) {
  say('instruction', '城市未能启动，请在 Edge 或 Chrome 中启用图形加速后重新加载。');
  say('action-text', '重新加载');
  el('fault').hidden = false;
  say('fault', String(error));
  action.disabled = false;
  action.onclick = () => location.reload();
}
