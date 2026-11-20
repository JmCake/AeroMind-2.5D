import { COLS, ROWS, WIDTH, HEIGHT, STATIONS, EVENT_NAMES, LAYERS, COLORS, clamp, idx } from './city';
import type { Cell, EventKind } from './city';
import { confidence } from './navigation';
import { defaults, PHASES } from './simulation';
import type { Config, Mode, State, Receipt } from './simulation';
import { Game, quantile, timeText } from './runtime';
import type { Frame } from './runtime';
import { interpret } from './command';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const select = (id: string) => el<HTMLSelectElement>(id),
  canvas = (id: string) => el<HTMLCanvasElement>(id);
const text = (id: string, value: string) => {
  const node = el(id);
  if (node.textContent !== value) node.textContent = value;
};
const click = (id: string, fn: () => void) => (el(id).onclick = fn);
const lessons = [
  '航点与保护',
  '像素、类别与柜口签收',
  '视觉里程计与观测地图',
  '不确定性与主动观察',
  '共享证据与空域预约',
];
const cues = [
  '接单与起飞',
  '固定航线遇到占用',
  '机载识别',
  '视觉定位与建图',
  '现场遮挡与观察',
  '分支 A · 固定航线',
  '分支 B · 主动规划',
  '三机配送',
  '通信受限',
  '恢复协作',
  '签收与复盘',
];
const labels = ['物流枢纽', '大学图书馆', '社区医院', '中央工程站', '学园宿舍'];
const glyph = ['○', 'Ⅲ', '✚', '△', '×'];
const getSaved = (k: string) => {
  try {
    return JSON.parse(localStorage.getItem('aeromind.v1.' + k) || 'null');
  } catch {
    return null;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem('aeromind.v1.' + k, JSON.stringify(v));
  } catch {
    /* Storage may be disabled. */
  }
};
const safe = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
const opt = (value: string | number, title: string, selected: unknown) =>
  '<option value="' +
  safe(value) +
  '"' +
  (String(value) === String(selected) ? ' selected' : '') +
  '>' +
  safe(title) +
  '</option>';
const field = (title: string, id: string, options: string) =>
  '<label>' + title + '<select id="' + id + '">' + options + '</select></label>';
const action = (id: string, title: string, strong = false) =>
  '<button id="' + id + '" class="' + (strong ? 'strong' : '') + '">' + title + '</button>';
const fact = (name: string, v: string) => '<span>' + name + ' <b>' + safe(v) + '</b></span>';
const num = (v: number | null, n = 1) => (v == null ? '—' : v.toFixed(n));
const titles = (node: string, values: string[], v: unknown) =>
  field(node, node, values.map((a) => opt(a, a, v)).join(''));
const ids = (a: NodeListOf<HTMLElement>) => Array.from(a);
const selectedConfig = getSaved('config') as Partial<Config> | null;
const config = { ...defaults, ...selectedConfig };
config.fleet = clamp(Number(config.fleet) || 1, 1, 3);
config.chapter = clamp(Number(config.chapter) || 1, 1, 5);
let game: Game;
try {
  game = new Game(el('viewport'), config);
} catch (error) {
  el('fatal').hidden = false;
  el('fatal').textContent =
    'WebGL 2 启动失败。请在 Edge 或 Chrome 中启用图形加速并重新启动。 ' + String(error);
  throw error;
}
game.forward = true;
text('eye-mode', '航向相机 ▾');
const sim = () => game.sim,
  state = () => game.sim.s,
  drone = () => state().drones[game.selected] ?? state().drones[0];
const panel = el<HTMLDialogElement>('panel');
let noticeTimer = 0,
  mapOpen = false,
  layer = 0,
  segmentation = false,
  sound = false;
let placement: { kind: EventKind; delay: number; duration: number; min?: number; max?: number } | null = null,
  inspected: Cell | null = null,
  replayIndex = -1;
let audioContext: AudioContext | null = null;
function chime(high = false) {
  if (!sound) return;
  try {
    audioContext ??= new AudioContext();
    void audioContext.resume();
    const osc = audioContext.createOscillator(),
      gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(high ? 680 : 430, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(high ? 960 : 570, audioContext.currentTime + 0.11);
    gain.gain.setValueAtTime(0.045, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.22);
    osc.connect(gain).connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.23);
  } catch {}
}
function notice(message: string) {
  text('notice', message);
  el('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => (el('notice').hidden = true), 4500);
}
function open(title: string, html: string) {
  text('panel-title', title);
  el('panel-body').innerHTML = html;
  if (!panel.open) panel.showModal();
}
function close() {
  if (panel.open) panel.close();
}
click('close', close);
panel.addEventListener('click', (e) => {
  if (e.target === panel) {
    const r = panel.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  }
});
function remember() {
  save('config', state().config);
}
function order() {
  const station = Number(select('station').value);
  sim().order(station);
  game.paused = false;
  game.forward = false;
  text('eye-mode', '下视相机 ▾');
  chime();
  notice(labels[station] + '订单已提交');
  update();
}
click('dispatch', order);
function drawRaw(c: HTMLCanvasElement, pixels: Uint8Array) {
  const context = c.getContext('2d')!;
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), WIDTH, HEIGHT), 0, 0);
}
function renderFrame(frame: Frame, c = canvas('feed'), mask = segmentation) {
  const ctx = c.getContext('2d')!;
  drawRaw(c, frame.input.pixels);
  if (mask) {
    const img = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    for (let i = 0; i < frame.result.mask.length; i++)
      if (frame.result.mask[i]) {
        img.data[i * 4] = 255;
        img.data[i * 4 + 1] = 144;
        img.data[i * 4 + 2] = 55;
      }
    ctx.putImageData(img, 0, 0);
  }
  ctx.lineWidth = 1;
  ctx.font = '9px Consolas';
  for (const box of frame.result.detections) {
    ctx.strokeStyle = '#fc994d';
    ctx.fillStyle = '#173430';
    ctx.strokeRect(box.x - box.w / 2, box.y - box.h / 2, box.w, box.h);
    const str = STATIONS[box.label].key + ' ' + Math.round(box.score * 100) + '%';
    const x = clamp(box.x - box.w / 2, 0, WIDTH - 68),
      y = clamp(box.y - box.h / 2 - 10, 0, HEIGHT - 10);
    ctx.fillRect(x, y, ctx.measureText(str).width + 3, 11);
    ctx.fillStyle = '#ffe0ad';
    ctx.fillText(str, x + 1, y + 8);
  }
}
game.onFrame = (frame) => {
  if (!game.forward) renderFrame(frame);
  text('frame', '#' + frame.result.frame + ' · ' + (game.forward ? '航向' : '下视'));
  const hit = frame.result.detections[0];
  text(
    'vision-label',
    game.forward
      ? '航向画面 · 推理使用下视相机'
      : hit
        ? labels[hit.label] + ' · ' + Math.round(hit.score * 100) + '%'
        : '本帧未识别到柜标'
  );
};
game.onCamera = (pixels) => drawRaw(canvas('feed'), pixels);
game.onNotice = notice;
game.onError = (message) => {
  text('engine', '推理不可用');
  notice('CPU 推理错误 · ' + message);
};
game.onComplete = (r) => {
  const past = getSaved('receipts') || [];
  save('receipts', [...past, r].slice(-80));
  if (r.signed) {
    const progress = new Set<number>(getSaved('progress') || []);
    progress.add(state().config.chapter);
    save('progress', [...progress]);
    chime(true);
  }
  notice(labels[r.station] + ' · ' + r.result);
};
function mapRect() {
  const c = canvas('knowledge'),
    w = c.clientWidth,
    h = c.clientHeight,
    unit = Math.min((w - 68) / COLS, (h - 107) / ROWS);
  return { w, h, unit, x: (w - unit * COLS) / 2, y: (h - unit * ROWS) / 2 + 5 };
}
function drawMap() {
  const c = canvas('knowledge'),
    { w, h, unit, x, y } = mapRect();
  if (unit <= 0) return;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const g = c.getContext('2d')!,
    s = state(),
    d = drone();
  g.fillStyle = '#1b3331';
  g.fillRect(0, 0, w, h);
  for (let j = 0; j < ROWS; j++)
    for (let i = 0; i < COLS; i++) {
      const key = idx({ i, j, l: layer }),
        e = d.map[key],
        v = confidence(e, s.time);
      g.fillStyle = !e ? '#24403e' : Math.abs(v) < 0.85 ? '#837d55' : v > 0 ? '#ba7758' : '#739c81';
      g.fillRect(x + i * unit + 1, y + j * unit + 1, unit - 2, unit - 2);
      if (e && e.source !== d.id) {
        g.fillStyle = '#d6c8f7';
        g.fillRect(x + i * unit + 3, y + j * unit + 3, 4, 4);
      }
    }
  g.font = '11px Consolas';
  g.fillStyle = '#b0c4b9';
  for (let i = 0; i < COLS; i++) g.fillText(String.fromCharCode(65 + i), x + (i + 0.43) * unit, y - 4);
  for (let j = 0; j < ROWS; j++) g.fillText(String(j + 1), x - 14, y + (j + 0.6) * unit);
  const project = (p: { x: number; z: number }) => [x + (p.x / 6 + 5.5) * unit, y + (p.z / 6 + 4.5) * unit];
  g.strokeStyle = '#eac48c';
  g.lineWidth = 2;
  g.setLineDash([6, 5]);
  g.beginPath();
  let [px, py] = project(d.pose);
  g.moveTo(px, py);
  for (const c of d.route) g.lineTo(x + (c.i + 0.5) * unit, y + (c.j + 0.5) * unit);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = COLORS[d.id];
  g.beginPath();
  g.arc(px, py, 5, 0, Math.PI * 2);
  g.fill();
  for (const [n, choice] of d.choices.entries())
    if (choice.cell.l === layer) {
      g.strokeStyle = n === 0 ? '#ffba77' : '#a1d6b7';
      g.beginPath();
      g.arc(x + (choice.cell.i + 0.5) * unit, y + (choice.cell.j + 0.5) * unit, unit * 0.22, 0, Math.PI * 2);
      g.stroke();
    }
  if (inspected) {
    g.strokeStyle = '#fff0bd';
    g.strokeRect(x + inspected.i * unit + 2, y + inspected.j * unit + 2, unit - 4, unit - 4);
  }
  g.fillStyle = '#d4e1d5';
  g.font = '12px Microsoft YaHei UI';
  g.fillText(
    '未知 ▪　不确定 ▨　已确认空闲 / 占据　·　' + LAYERS[layer] + ' 城市米',
    x,
    y + ROWS * unit + 19
  );
}
function toggleMap() {
  mapOpen = !mapOpen;
  canvas('knowledge').hidden = !mapOpen;
  el('labels').hidden = mapOpen;
  el('viewport').classList.toggle('knowledge', mapOpen);
  text('map', mapOpen ? '城市全景' : '认知地图');
  text('maptitle', mapOpen ? '认知地图' : '城市全景');
  if (mapOpen) drawMap();
}
click('map', toggleMap);
const cityLabels = STATIONS.map((_, i) => {
  const node = document.createElement('span');
  node.className = 'label';
  node.textContent = glyph[i] + ' ' + labels[i];
  el('labels').append(node);
  return node;
});
function update() {
  const s = state(),
    cfg = s.config,
    d = drone();
  game.view.selected = game.selected;
  text('engine', game.error ? '推理不可用' : game.ready ? 'CPU 推理就绪' : '启动推理');
  text('phase', PHASES[d.phase]);
  text('call', '蜂鸟 0' + (d.id + 1));
  text('alt', d.pose.y.toFixed(1) + ' m');
  text('battery', Math.round(d.battery) + '%');
  text('clock', timeText(s.time));
  text('fps', game.fps ? Math.round(game.fps) + ' FPS' : '— FPS');
  text('pause', game.paused ? '▶' : 'Ⅱ');
  el('pause').setAttribute('aria-label', game.paused ? '继续仿真' : '暂停仿真');
  text('speed', game.speed + '×');
  text('reason', d.reason);
  text('lesson', lessons[cfg.chapter - 1]);
  text('lecture', game.lectureTime >= 0 ? '讲演 ' + timeText(game.lectureTime) : '课堂讲演');
  text('eye-mode', game.forward ? '航向相机 ▾' : '下视相机 ▾');
  const step = ['idle', 'abort'].includes(d.phase)
    ? -1
    : ['load', 'up'].includes(d.phase)
      ? 0
      : d.phase === 'out'
        ? 1
        : d.phase === 'search'
          ? 2
          : d.phase === 'dock'
            ? 3
            : 4;
  ids(document.querySelectorAll('.flight-steps span')).forEach((n, i) => {
    n.classList.toggle('done', i < step || d.phase === 'done');
    n.classList.toggle('current', i === step && d.phase !== 'done');
  });
  const recent = s.log.at(-1);
  text('recent', recent ? timeText(recent.time) + ' · ' + recent.message : '尚未接单');
  if (select('drone').options.length !== s.drones.length)
    select('drone').innerHTML = s.drones.map((v) => opt(v.id, '蜂鸟 0' + (v.id + 1), game.selected)).join('');
  select('drone').value = String(game.selected);
  const dest = STATIONS[Number(select('station').value)];
  text('mass', '载荷 ' + dest.mass.toFixed(2) + ' kg');
  text(
    'deadline',
    d.order && !['done', 'idle', 'abort'].includes(d.phase)
      ? '剩余 ' + Math.max(0, Math.ceil(d.order.deadline - s.time)) + ' s'
      : '时限 115 s'
  );
  const progress: number[] = getSaved('progress') || [];
  ids(document.querySelectorAll('[data-chapter]')).forEach((n) => {
    n.classList.toggle('chosen', Number(n.dataset.chapter) === cfg.chapter);
    n.classList.toggle('studied', progress.includes(Number(n.dataset.chapter)));
  });
  ids(document.querySelectorAll('[data-mode]')).forEach((n) =>
    n.classList.toggle('active', n.dataset.mode === cfg.mode)
  );
  el('labels').hidden = mapOpen || game.view.firstPerson;
  if (mapOpen) drawMap();
  else
    cityLabels.forEach((n, i) => {
      const f = sim().city.fixtures[i];
      if (!f) return;
      const pos = game.view.project({ ...f, y: f.y + 2.4 });
      n.style.left = pos.x + 'px';
      n.style.top = pos.y + 'px';
    });
}
game.onUpdate = update;
game.onReset = () => {
  replayIndex = -1;
  inspected = null;
  canvas('feed').getContext('2d')!.clearRect(0, 0, WIDTH, HEIGHT);
};
select('station').onchange = update;
select('drone').onchange = () => {
  game.selected = Number(select('drone').value);
  update();
};
ids(document.querySelectorAll('[data-chapter]')).forEach(
  (n) =>
    (n.onclick = () => {
      const cfg = state().config;
      cfg.chapter = Number(n.dataset.chapter);
      if (cfg.chapter === 5) sim().setFleet(3);
      remember();
      update();
      notice(lessons[cfg.chapter - 1]);
    })
);
ids(document.querySelectorAll('[data-mode]')).forEach(
  (n) =>
    (n.onclick = () => {
      const mode = n.dataset.mode as Mode;
      state().config.mode = mode;
      if (mode === '运营') {
        state().config.chapter = 5;
        sim().setFleet(3);
        state().nextOrder = state().time + 1;
      }
      if (mode === '挑战') challenges();
      remember();
      update();
    })
);
click('reset', () => {
  game.reset();
  notice('已按当前种子重置订单、环境与观测');
});
click('camera', () => {
  if (game.view.firstPerson) {
    game.view.firstPerson = false;
    game.view.top = false;
  } else if (game.view.top) {
    game.view.firstPerson = true;
    game.view.top = false;
  } else game.view.top = true;
  text('camera', game.view.firstPerson ? '斜俯视' : game.view.top ? '机载视角' : '正顶视');
  if (!mapOpen) text('maptitle', game.view.firstPerson ? '机载航向' : '城市全景');
  update();
});
click('follow', () => {
  game.view.follow = !game.view.follow;
  el('follow').classList.toggle('on', game.view.follow);
});
click('rotate', () => (game.view.angle += Math.PI / 4));
click('minus', () => (game.view.zoom = clamp(game.view.zoom * 0.86, 0.62, 2.5)));
click('plus', () => (game.view.zoom = clamp(game.view.zoom * 1.15, 0.62, 2.5)));
click('pause', () => {
  game.paused = !game.paused;
  update();
});
click('speed', () => {
  const speeds = [0.5, 1, 2];
  game.speed = speeds[(speeds.indexOf(game.speed) + 1) % speeds.length];
  update();
});
click('eye-mode', () => {
  game.forward = !game.forward;
  text('eye-mode', game.forward ? '航向相机 ▾' : '下视相机 ▾');
});
const view = el('viewport');
let dragging = false,
  dragX = 0;
view.addEventListener(
  'wheel',
  (e) => {
    if (mapOpen) return;
    e.preventDefault();
    game.view.zoom = clamp(game.view.zoom * Math.exp(-e.deltaY * 0.001), 0.62, 2.5);
  },
  { passive: false }
);
view.onpointerdown = (e) => {
  if (e.target !== game.view.renderer.domElement) return;
  dragging = true;
  dragX = e.clientX;
};
view.onpointermove = (e) => {
  if (dragging && !placement) {
    game.view.angle -= (e.clientX - dragX) * 0.007;
    dragX = e.clientX;
  }
};
window.addEventListener('pointerup', () => (dragging = false));
game.view.renderer.domElement.onclick = (e) => {
  if (!placement) return;
  const c = game.view.pick(e.clientX, e.clientY);
  if (!c) {
    notice('请选择城市边界内的位置');
    return;
  }
  sim().place(placement.kind, c.i, c.j, placement.delay, placement.duration, placement.min, placement.max);
  notice(EVENT_NAMES[placement.kind] + '已安排在 ' + String.fromCharCode(65 + c.i) + (c.j + 1));
  placement = null;
  view.style.cursor = '';
};
canvas('knowledge').onclick = (e) => {
  const rect = canvas('knowledge').getBoundingClientRect(),
    m = mapRect();
  const i = Math.floor((e.clientX - rect.left - m.x) / m.unit),
    j = Math.floor((e.clientY - rect.top - m.y) / m.unit);
  if (i >= 0 && j >= 0 && i < COLS && j < ROWS) {
    inspected = { i, j, l: layer };
    evidence();
  }
};
const keySet = new Set<string>();
const updateKeys = () => {
  game.sim.manualInput = {
    x: Number(keySet.has('d')) - Number(keySet.has('a')),
    y: Number(keySet.has('e')) - Number(keySet.has('q')),
    z: Number(keySet.has('s')) - Number(keySet.has('w')),
  };
};
window.onkeydown = (e) => {
  if (panel.open || /INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement).tagName)) return;
  const k = e.key.toLowerCase();
  if (k === ' ') {
    e.preventDefault();
    if (!e.repeat) el('pause').click();
  }
  if (k === 'm' && !e.repeat) {
    drone().manual = !drone().manual;
    notice(drone().manual ? '手动接管 · WASD 平移，Q/E 升降' : '已交还自主控制');
  }
  if (k === 'v' && !e.repeat) el('camera').click();
  if (k === 'escape') {
    placement = null;
    view.style.cursor = '';
  }
  keySet.add(k);
  updateKeys();
};
window.onkeyup = (e) => {
  keySet.delete(e.key.toLowerCase());
  updateKeys();
};
window.onblur = () => {
  keySet.clear();
  updateKeys();
};
function settings() {
  const cfg = state().config;
  open(
    '飞行设置与操作',
    '<div class="fields">' +
      titles('天气', ['晴朗', '薄雾', '小雨', '夜航', '阵风'], cfg.weather) +
      field('机群规模', 'fleet-size', [1, 2, 3].map((v) => opt(v, v + ' 架', cfg.fleet)).join('')) +
      field(
        '模型检查点',
        'checkpoint',
        ['early', 'middle', 'mature'].map((v, i) => opt(v, ['初期', '中期', '成熟'][i], cfg.model)).join('')
      ) +
      field(
        '决策模块',
        'policy',
        opt('classic', '经典规划', cfg.policy) + opt('learned', '训练后的 Q 策略', cfg.policy)
      ) +
      field(
        '导航传感器',
        'nav-sensors',
        ['融合', '视觉惯性', '惯性']
          .map((v, i) => opt(v, ['视觉惯性 + 深度建图', '视觉惯性定位', '惯性定位'][i], cfg.navigation))
          .join('')
      ) +
      field(
        '地图共享',
        'sharing',
        opt('yes', '启用', cfg.share ? 'yes' : 'no') + opt('no', '停用', cfg.share ? 'yes' : 'no')
      ) +
      titles('通信', ['正常', '延迟', '断开'], cfg.link) +
      '<label>城市种子<input id="seed" type="number" min="1" max="999999" value="' +
      cfg.seed +
      '"></label>' +
      field(
        '交互音效',
        'audio',
        opt('off', '关闭', sound ? 'on' : 'off') + opt('on', '开启', sound ? 'on' : 'off')
      ) +
      '</div>' +
      '<p class="muted">拖动旋转，滚轮缩放，V 切换视角，空格暂停。M 手动接管，WASD 平移，Q/E 升降。改变城市种子将建立新实验。</p>' +
      '<div class="actions">' +
      action('apply', '应用设置', true) +
      action('store', '保存实验条件') +
      action('load', '恢复实验条件') +
      '</div>'
  );
  click('apply', () => {
    const st = state().config;
    Object.assign(st, {
      weather: select('天气').value,
      model: select('checkpoint').value,
      policy: select('policy').value,
      share: select('sharing').value === 'yes',
      link: select('通信').value,
      navigation: select('nav-sensors').value,
    });
    sound = select('audio').value === 'on';
    const n = Number(select('fleet-size').value),
      seed = clamp(Number(el<HTMLInputElement>('seed').value) || 617, 1, 999999);
    if (seed !== st.seed) game.reset({ ...st, seed, fleet: n });
    else if (!sim().setFleet(n)) notice('仍有无人机在途，返航后可缩减机群');
    remember();
    chime();
    close();
    update();
  });
  click('store', () => {
    save('experiment', state());
    notice('实验状态已保存在本机');
    close();
  });
  click('load', () => {
    const s = getSaved('experiment') as State | null;
    if (!s?.config) {
      notice('尚无保存的实验');
      return;
    }
    game.reset(s.config);
    sim().restore(s);
    game.lastCompleted = s.completed.length;
    close();
    notice('实验条件已恢复 · 重新采集机载图像');
  });
}
click('settings', settings);
function challenges() {
  const s = state(),
    options = Object.entries(EVENT_NAMES)
      .map(([key, name]) => opt(key, name, 'occupied'))
      .join('');
  open(
    '布置现场挑战',
    '<div class="fields">' +
      field('事件类型', 'event-kind', options) +
      field(
        '部署位置',
        'event-position',
        opt('map', '在地图上点选', 'map') +
          STATIONS.slice(1)
            .map((v, i) => opt(i + 1, v.name, 'map'))
            .join('')
      ) +
      '<label>延迟生效（秒）<input type="number" id="delay" value="0" min="0" max="180"></label><label>持续时间（秒）<input type="number" id="duration" value="22" min="2" max="180"></label>' +
      field(
        '通告作用高度',
        'event-layer',
        opt('default', '按事件类型', 'default') +
          LAYERS.map((v, i) => opt(i, '仅 ' + v + ' m 飞行层', 'default')).join('')
      ) +
      '</div>' +
      '<p class="muted">吊臂与交通占用飞行高度，柜区占用会遮住标记。禁飞体积覆盖三层空域，限高走廊仅开放低层。</p>' +
      '<div class="actions">' +
      action('place-event', '安排事件', true) +
      action('undo-event', '撤回最近事件') +
      '</div>' +
      s.events
        .slice(-5)
        .reverse()
        .map(
          (e) =>
            '<div class="record">' +
            EVENT_NAMES[e.kind] +
            ' · ' +
            String.fromCharCode(65 + e.i) +
            (e.j + 1) +
            ' · ' +
            timeText(e.at) +
            ' 至 ' +
            timeText(e.at + e.duration) +
            '</div>'
        )
        .join('')
  );
  click('place-event', () => {
    const kind = select('event-kind').value as EventKind,
      where = select('event-position').value;
    const delay = clamp(Number(el<HTMLInputElement>('delay').value), 0, 180),
      duration = clamp(Number(el<HTMLInputElement>('duration').value), 2, 180);
    const band = select('event-layer').value,
      b = band === 'default' ? undefined : Number(band);
    close();
    if (where === 'map') {
      if (mapOpen) toggleMap();
      if (game.view.firstPerson) el('camera').click();
      placement = { kind, delay, duration, min: b, max: b };
      view.style.cursor = 'crosshair';
      notice('点击城市中的事件位置，Esc 取消');
    } else {
      const st = STATIONS[Number(where)];
      sim().place(kind, st.i, st.j, delay, duration, b, b);
      notice(EVENT_NAMES[kind] + '已安排在' + st.name);
    }
  });
  click('undo-event', () => {
    const e = s.events.pop();
    if (e) sim().log(-1, '已撤回' + EVENT_NAMES[e.kind]);
    challenges();
  });
}
click('events', challenges);
function command() {
  open(
    '中文任务指令',
    '<label class="wide">离线结构化解析<input id="language" value="先把包裹送到图书馆，避开体育馆上空，如果屋顶被占用就等一会儿"></label>' +
      '<div class="actions">' +
      action('parse', '解析指令', true) +
      '</div><div id="parsed"></div>'
  );
  click('parse', () => {
    const result = interpret(el<HTMLInputElement>('language').value),
      p = el('parsed');
    if (!result.destinations.length) {
      p.textContent = '请选择图书馆、医院、工程站或宿舍作为收货点。';
      return;
    }
    p.innerHTML =
      field(
        result.destinations.length > 1 ? '有多个目的地，请选定一个' : '目的地',
        'resolved',
        result.destinations.map((v) => opt(v, labels[v], result.destinations[0])).join('')
      ) +
      '<p>优先级 ' +
      result.priority +
      ' · ' +
      result.seconds +
      ' 秒 · ' +
      (result.wait ? '占用时等待' : '占用时返仓') +
      (result.avoid != null ? ' · 避开' + (labels[result.avoid] ?? '体育馆') : '') +
      '</p><div class="actions">' +
      action('submit-command', '确认派单', true) +
      '</div>';
    click('submit-command', () => {
      sim().order(Number(select('resolved').value), {
        priority: result.priority,
        deadline: state().time + result.seconds,
        avoid: result.avoid,
        wait: result.wait,
      });
      close();
      game.paused = false;
      chime();
      notice('结构化指令已进入调度队列');
    });
  });
}
click('command', command);
function evidence() {
  const d = drone(),
    s = state(),
    e = inspected ? d.map[idx(inspected)] : null;
  let f =
    inspected && e
      ? game.archive.find((v) => v.result.frame === e.frame && v.result.drone === e.source)
      : game.frames.get(d.id);
  if (inspected && !e) f = undefined;
  const frames = e
    ? '最近证据来自蜂鸟 0' + (e.source + 1) + ' · ' + timeText(e.t) + ' · 相邻 RGB 帧 #' + e.frame
    : '';
  const title = inspected
    ? '地图格 ' +
      String.fromCharCode(65 + inspected.i) +
      (inspected.j + 1) +
      ' · ' +
      LAYERS[inspected.l] +
      ' m'
    : '机载证据';
  open(
    title,
    '<div class="facts">' +
      fact('定位', s.config.chapter < 3 ? '模拟 GPS' : '惯性 / 图像特征') +
      fact('深度', '模拟测距 ' + d.headroom.toFixed(2) + ' m') +
      fact('视觉特征', String(d.evidence?.features ?? 0)) +
      fact('证据来源', inspected ? (e ? '深度光束' : '未知') : '下视 RGB') +
      fact('表面起伏', Number.isFinite(d.roughness) ? d.roughness.toFixed(2) + ' m' : '待采样') +
      fact('局部几何', d.cloud.length + ' 点') +
      fact('候选视点', String(d.choices.length)) +
      fact('观测后类别分数增量', d.viewGain.toFixed(2)) +
      fact('相对接近时间', d.ttc === null ? '—' : num(d.ttc) + ' s') +
      fact('Q 策略动作', d.actionName || '尚未触发') +
      '</div>' +
      (frames ? '<p>' + frames + '</p>' : '') +
      (f
        ? '<canvas id="detail-frame" width="192" height="144" class="evidence-image"></canvas><p>帧 #' +
          f.result.frame +
          ' · ' +
          f.result.model +
          '</p>'
        : '<p class="muted">该位置尚无可查看的原始帧，或历史帧已离开缓存。</p>') +
      '<p class="muted">下视透视相机 192 × 144，垂直视场 65°。模型分数表示柜标类别置信度。地图保留来源、时间和置信状态。</p>' +
      '<div class="actions">' +
      action('mask', '切换像素分割') +
      action('next-layer', '下一高度层') +
      action('cloud', '查看局部点云') +
      '</div><canvas id="cloud-view" width="440" height="170" hidden></canvas>'
  );
  if (f) {
    renderFrame(f, canvas('detail-frame'));
    const line = canvas('detail-frame').nextElementSibling!;
    line.textContent =
      '帧 #' +
      f.result.frame +
      ' · ' +
      timeText(f.result.sample) +
      ' · ' +
      f.result.model +
      ' · CPU ' +
      f.result.ms.toFixed(1) +
      ' ms';
  }
  click('mask', () => {
    segmentation = !segmentation;
    if (f) renderFrame(f, canvas('detail-frame'));
  });
  click('cloud', () => {
    const c = canvas('cloud-view');
    c.hidden = !c.hidden;
    if (c.hidden) return;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#193532';
    ctx.fillRect(0, 0, c.width, c.height);
    if (!d.cloud.length) {
      ctx.fillStyle = '#e6edda';
      ctx.fillText('第 3 章开始以模拟深度积累表面点。', 14, 30);
      return;
    }
    for (const p of d.cloud) {
      const x = p.x - d.pose.x,
        z = p.z - d.pose.z;
      ctx.fillStyle = 'hsl(' + clamp(155 - p.y * 7, 29, 155) + ',50%,66%)';
      ctx.fillRect(210 + (x - z) * 6.2, 108 + (x + z) * 2.7 - p.y * 5.3, 2.5, 2.5);
    }
    ctx.fillStyle = '#dce7d6';
    ctx.fillText('近期深度表面点 · 高度着色', 10, 16);
  });
  click('next-layer', () => {
    layer = (layer + 1) % 3;
    if (!mapOpen) toggleMap();
    inspected = null;
    close();
    drawMap();
  });
}
click('evidence', () => {
  inspected = null;
  evidence();
});
function laboratory() {
  const s = state(),
    snap = game.snapshot,
    prev = game.previous,
    trained = game.training?.checkpoints;
  const summary = (name: string, receipts: Receipt[]) =>
    '<div class="record">' +
    name +
    ' · 已归港 ' +
    receipts.filter((r) => r.result === '已签收并归港').length +
    '/' +
    receipts.length +
    ' 单 · 等待 ' +
    num(receipts.reduce((v, r) => v + r.wait, 0)) +
    ' s · 总路径 ' +
    num(receipts.reduce((v, r) => v + r.path, 0)) +
    ' m</div>';
  open(
    '同条件对照实验',
    '<p>保存城市、订单、动力学、认知地图、消息、随机流及最近的机载帧。各分支从同一时刻再次观察；界面以紫色虚线叠加上一分支的实际航迹。</p>' +
      '<div class="facts">' +
      fact('恢复方式', '同条件重演') +
      fact('保存起点', snap ? timeText(snap.state.time) : '尚未保存') +
      fact('当前配置', s.config.adaptive ? '观测规划' : '固定航线') +
      fact('前一分支', prev ? prev.name + ' ' + timeText(prev.time) : '—') +
      '</div>' +
      (prev && snap
        ? summary('上一分支', prev.outcomes) +
          summary('当前分支', s.completed.slice(snap.state.completed.length))
        : '') +
      '<p class="muted">每章基线保留上一阶段的能力。第 3 章两组均关闭 GPS，第 4 章比较固定航线与观测规划，第 5 章比较独立与协同调度。共同先验为公布的走廊和目标区，动态占用由各分支重新观测。</p>' +
      '<div class="actions">' +
      action('save-snap', '保存当前起点', true) +
      action('baseline', '重演本章基线') +
      action('adaptive', '重演本章完整配置') +
      '</div>' +
      (trained
        ? '<div class="record">独立柜标裁片测试 · 初期 ' +
          (trained.early.accuracy * 100).toFixed(1) +
          '% / 中期 ' +
          (trained.middle.accuracy * 100).toFixed(1) +
          '% / 成熟 ' +
          (trained.mature.accuracy * 100).toFixed(1) +
          '%。</div>'
        : '')
  );
  click('save-snap', async () => {
    await game.save();
    laboratory();
  });
  for (const [id, adapt] of [
    ['baseline', false],
    ['adaptive', true],
  ] as const)
    click(id, async () => {
      if (!game.snapshot) {
        notice('请先保存当前起点');
        return;
      }
      close();
      await game.branch(adapt);
    });
}
click('laboratory', laboratory);
function journal() {
  const s = state(),
    d = drone(),
    list = s.completed.slice(-6).reverse();
  open(
    '任务记录与回放',
    '<div class="facts">' +
      fact('待分配', s.orders.length + ' 单') +
      fact('归档', s.completed.length + ' 单') +
      fact('共享 / 接收', d.shared + ' / ' + d.received) +
      fact('过期 / 丢包', String(d.lost)) +
      fact('控制延迟 P95', num(quantile(sim().latencies, 0.95)) + ' ms') +
      fact('路线计算', String(s.routeCount)) +
      '</div>' +
      (list.length
        ? list
            .map(
              (r) =>
                '<div class="record"><b>' +
                labels[r.station] +
                ' · ' +
                r.result +
                '</b><br>' +
                num(r.time) +
                ' s · 路径 ' +
                num(r.path) +
                ' m · 能耗 ' +
                num(r.energy, 2) +
                ' · 碰撞 ' +
                r.collisions +
                ' · 柜口误差 ' +
                num(r.error, 2) +
                ' m<br>等待 ' +
                num(r.wait) +
                ' s · 定位 RMS ' +
                num(r.poseRms, 2) +
                ' m · 机间最小距离 ' +
                num(r.closest, 2) +
                ' m</div>'
            )
            .join('')
        : '<p class="muted">订单归档后显示耗时、路径、能耗、碰撞与交接误差。</p>') +
      '<label class="wide">回看实际轨迹<input id="rewind" type="range" min="0" max="' +
      Math.max(0, game.timeline.length - 1) +
      '" value="' +
      Math.max(0, game.timeline.length - 1) +
      '"></label><div id="replay-text"></div>' +
      s.log
        .slice(-8)
        .reverse()
        .map(
          (l) =>
            '<div class="record"><small>' +
            timeText(l.time) +
            (l.frame ? ' · #' + l.frame : '') +
            '</small>' +
            safe(l.message) +
            '</div>'
        )
        .join('')
  );
  el<HTMLInputElement>('rewind').oninput = (e) => {
    replayIndex = Number((e.target as HTMLInputElement).value);
    const r = game.timeline[replayIndex];
    if (!r) return;
    game.view.ghost = game.timeline
      .slice(0, replayIndex + 1)
      .map((c) => c.positions[game.selected])
      .filter(Boolean);
    text(
      'replay-text',
      timeText(r.time) + ' · ' + (r.decision[game.selected] ?? '') + ' · 帧 #' + (r.frame[game.selected] ?? 0)
    );
  };
}
click('journal', journal);
click('lecture', () => {
  if (game.lectureTime < 0) {
    game.beginLecture();
    close();
    return;
  }
  open(
    '七分钟课堂讲演',
    '<p>' +
      timeText(game.lectureTime) +
      ' / 07:00 · ' +
      (cues[game.lectureCue] ?? '') +
      '</p>' +
      '<div class="actions">' +
      action('resume-lecture', '返回讲演', true) +
      action('stop-lecture', '结束讲演') +
      '</div>'
  );
  click('resume-lecture', close);
  click('stop-lecture', () => {
    game.lectureTime = -1;
    close();
    update();
  });
});
if (new URLSearchParams(location.search).has('verify')) Object.assign(window, { aeromind: game });
update();
game.start();
const heartbeat = () => fetch('./ping', { cache: 'no-store' }).catch(() => {});
void heartbeat();
setInterval(heartbeat, 20000);
