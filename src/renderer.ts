import * as T from 'three';
import {
  City,
  COLS,
  ROWS,
  UNIT,
  COLORS,
  FOV,
  HEIGHT,
  WIDTH,
  STATIONS,
  active,
  center,
  ground,
  random,
  toCell,
} from './city';
import type { Cell, Point, Weather } from './city';
import type { Simulation } from './simulation';

const cube = new T.BoxGeometry(1, 1, 1),
  round = new T.CylinderGeometry(0.5, 0.5, 1, 12),
  leaf = new T.IcosahedronGeometry(0.5, 0),
  sphere = new T.SphereGeometry(0.5, 12, 8),
  disc = new T.CylinderGeometry(0.5, 0.5, 1, 28);
const transform = new T.Object3D();
const matte = new T.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
type Shape = { matrix: T.Matrix4; color: T.Color };
class Pieces {
  batches = new Map<T.BufferGeometry, Shape[]>();
  add(
    g: T.BufferGeometry,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: string,
    ry = 0,
    rx = 0,
    rz = 0
  ) {
    transform.position.set(x, y, z);
    transform.scale.set(w, h, d);
    transform.rotation.set(rx, ry, rz);
    transform.updateMatrix();
    if (!this.batches.has(g)) this.batches.set(g, []);
    this.batches.get(g)!.push({ matrix: transform.matrix.clone(), color: new T.Color(color) });
  }
  finish(root: T.Object3D, material: T.Material = matte) {
    for (const [g, items] of this.batches) {
      const mesh = new T.InstancedMesh(g, material, items.length);
      items.forEach((s, i) => {
        mesh.setMatrixAt(i, s.matrix);
        mesh.setColorAt(i, s.color);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      root.add(mesh);
    }
  }
}
function part(
  root: T.Object3D,
  g: T.BufferGeometry,
  w: number,
  h: number,
  d: number,
  color: string,
  x = 0,
  y = 0,
  z = 0
) {
  const m = new T.Mesh(g, new T.MeshLambertMaterial({ color, flatShading: true }));
  m.position.set(x, y, z);
  m.scale.set(w, h, d);
  root.add(m);
  return m;
}
function aircraft(id: number) {
  const root = new T.Group(),
    rotors: T.Object3D[] = [],
    accent = COLORS[id];
  part(root, sphere, 1.25, 0.45, 1.7, '#25383f');
  part(root, sphere, 1.02, 0.42, 1.34, accent, 0, 0.17, -0.03);
  part(root, cube, 0.48, 0.08, 0.84, '#e7eee2', 0, 0.39, 0.02);
  part(root, cube, 0.62, 0.34, 0.57, '#dca667', 0, -0.28, 0);
  part(root, cube, 0.57, 0.1, 0.14, '#36464b', 0, -0.3, 0.3);
  for (const a of [-1, 1])
    for (const b of [-1, 1]) {
      const arm = part(root, cube, 1.18, 0.12, 0.13, '#384c50', a * 0.56, 0.08, b * 0.49);
      arm.rotation.y = -a * b * 0.66;
      part(root, round, 0.22, 0.24, 0.22, '#e0ebe4', a * 0.98, 0.16, b * 0.83);
      const ring = new T.Mesh(
        new T.TorusGeometry(0.45, 0.03, 5, 22),
        new T.MeshLambertMaterial({ color: '#627a79' })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(a * 0.98, 0.24, b * 0.83);
      root.add(ring);
      const rotor = part(root, cube, 0.81, 0.035, 0.095, '#1f333b', a * 0.98, 0.31, b * 0.83);
      rotors.push(rotor);
      part(root, sphere, 0.1, 0.09, 0.1, b > 0 ? '#fbaf5e' : '#71edc8', a * 1.06, 0.22, b * 0.9);
    }
  for (const a of [-1, 1]) part(root, cube, 0.09, 0.13, 0.83, '#33474d', a * 0.4, -0.3, 0.03);
  return { root, rotors };
}
function buildTown(city: City, root: T.Group) {
  const s = new Pieces(),
    rng = random(city.seed + 11);
  const b = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, ry = 0) =>
    s.add(cube, x, y, z, w, h, d, c, ry);
  const cyl = (x: number, y: number, z: number, w: number, h: number, c: string) =>
    s.add(round, x, y, z, w, h, w, c);
  b(0, -1.6, 0, 75, 2.3, 61, '#758d87');
  b(0, -0.52, 0, 75.3, 0.34, 61.3, '#c8ccac');
  b(0, -0.21, 0, 74.4, 0.53, 60.4, '#a8ba91');
  for (let i = 0; i < COLS; i += 2) {
    const x = ground(i, 0).x;
    b(x, 0.064, 0, 4.26, 0.07, 57, '#bec5af');
    b(x, 0.11, 0, 3.47, 0.05, 57, '#505f62');
    for (let z = -27; z < 28; z += 2.35)
      if (Math.abs(z / 12 - Math.round(z / 12)) > 0.16) b(x, 0.145, z, 0.08, 0.02, 0.88, '#ded4a3');
  }
  for (let j = 0; j < ROWS; j += 2) {
    const z = ground(0, j).z;
    b(0, 0.075, z, 70, 0.07, 4.26, '#bec5af');
    b(0, 0.12, z, 70, 0.05, 3.47, '#505f62');
    for (let x = -33; x < 34; x += 2.4)
      if (Math.abs((x + 6) / 12 - Math.round((x + 6) / 12)) > 0.16)
        b(x, 0.154, z, 0.88, 0.02, 0.075, '#ded4a3');
  }
  for (let i = 0; i < COLS; i += 2)
    for (let j = 0; j < ROWS; j += 2) {
      const p = ground(i, j);
      for (const sign of [-1, 1])
        for (let k = -2; k < 3; k++) {
          b(p.x + k * 0.45, 0.166, p.z + 2.12 * sign, 0.23, 0.02, 0.68, '#e4dfc5');
          b(p.x + sign * 2.12, 0.165, p.z + k * 0.45, 0.68, 0.02, 0.22, '#e4dfc5');
        }
      if ((i + j) % 4 === 0) {
        cyl(p.x + 2.12, 1.05, p.z + 2.26, 0.09, 1.9, '#526b66');
        b(p.x + 2.02, 2.01, p.z + 2.26, 0.43, 0.12, 0.23, '#fbe9c4');
      }
    }
  const facades = ['#d3c7a7', '#94b8ae', '#d6a37e', '#bdc9bc', '#a1b3bd'],
    frames = ['#5e7778', '#577979', '#805f50', '#717e71', '#5b717e'];
  for (const v of city.lots) {
    const { x, z, w, d, h, y, kind, tone } = v,
      station = kind >= 4 && kind <= 8;
    if (kind === 9) {
      b(x, y + h / 2, z, w, h, d, '#9caaa2');
      continue;
    }
    if (kind === 11 || kind === 12) {
      b(x, y + h / 2, z, w, h, d, kind === 11 ? '#7f9da2' : '#c79e7b');
      for (let band = 0.54; band < h; band += 0.75) {
        b(x, y + band, z + d / 2 + 0.025, w * 0.86, 0.25, 0.055, '#506f78');
        b(x + w / 2 + 0.025, y + band, z, 0.055, 0.25, d * 0.82, '#78999d');
      }
      b(x, y + h + 0.06, z, w + 0.16, 0.13, d + 0.15, '#d9d3b9');
      if (kind === 11) {
        b(x, y + h + 0.32, z, w * 0.53, 0.44, d * 0.52, '#8a9b94');
        cyl(x + 0.26, y + h + 1.24, z, 0.065, 1.52, '#657e77');
      }
      continue;
    }
    b(x, 0.13, z, 8.4, 0.22, 8.4, '#c8c8ac');
    b(x + 0.38, 0.256, z + 0.55, w + 0.7, 0.045, d + 0.7, '#9ba895');
    if (kind === 10) {
      b(x, 0.36, z, 7.6, 0.16, 6.75, '#557f70');
      b(x, 0.46, z, 6.53, 0.036, 4.9, '#bf8468');
      for (const a of [-1, 1]) {
        b(x + a * 3.16, 0.49, z, 0.05, 0.022, 4.65, '#e0ddbf');
        b(x, 0.49, z + a * 2.32, 6.35, 0.022, 0.05, '#e0ddbf');
        b(x + a * 2.36, 0.49, z, 1.56, 0.022, 0.05, '#e0ddbf');
        cyl(x + a * 3.3, 1.05, z, 0.09, 1.3, '#647e73');
        b(x + a * 3.12, 1.72, z, 0.09, 0.55, 0.98, '#c5d3c2');
      }
      b(x, 0.49, z, 0.055, 0.022, 4.68, '#e0ddbf');
      cyl(x, 0.48, z, 1.02, 0.025, '#ddc6a4');
      cyl(x, 0.505, z, 0.88, 0.023, '#bf8468');
      for (let k = 0; k < 4; k++) b(x - 2.6 + k * 1.5, 0.55, z + 3.16, 1.18, 0.32, 0.42, '#698d88');
    } else if (kind === 3) {
      b(x, 0.33, z, 6.9, 0.14, 6.9, '#91ad75');
      b(x, 0.4, z, 5.8, 0.09, 2.6, '#d4be93');
      cyl(x, 0.64, z, 2.25, 0.45, '#c9cbb6');
      cyl(x, 0.89, z, 1.85, 0.06, '#75b5ae');
    } else {
      const wall = station
        ? ['#8ba4a0', '#cebc9d', '#d8cbb0', '#cd9876', '#aac1b2'][kind - 4]
        : facades[tone];
      b(x, y + h / 2 + 0.14, z, w, h - 0.14, d, wall);
      b(x, y + h + 0.04, z, w + 0.15, 0.16, d + 0.15, '#e2d8bb');
      b(x, y + h + 0.16, z, w - 0.28, 0.1, d - 0.28, station ? '#657d77' : frames[tone % 5]);
      if (!station) {
        const floors = Math.max(1, Math.floor(h / 1.45));
        for (let f = 0; f < floors; f++) {
          const fy = 0.8 + (f * (h - 0.7)) / floors;
          for (const side of [-1, 1])
            for (let k = 0; k < 4; k++) {
              const win = rng() > 0.73 ? '#f0ce86' : rng() > 0.44 ? '#82aaaa' : '#556e75';
              b(x + (k - 1.5) * w * 0.22, fy, z + side * (d * 0.5 + 0.017), w * 0.15, 0.5, 0.055, win);
              b(x + side * (w * 0.5 + 0.017), fy, z + (k - 1.5) * d * 0.22, 0.055, 0.5, d * 0.145, win);
            }
          if (f % 2 === 1) b(x, fy - 0.43, z, w + 0.07, 0.09, d + 0.07, frames[tone % 5]);
        }
        b(x - 0.7, h + 0.45, z - 0.3, 1.03, 0.55, 1.1, '#c3ccc1');
        cyl(x - 0.7, h + 0.75, z - 0.3, 0.67, 0.12, '#6f8180');
        b(x + 0.67, h + 0.29, z + 0.57, 1.25, 0.09, 0.82, '#496c7a');
        for (let k = -1; k <= 1; k++)
          b(x + 0.67 + k * 0.39, h + 0.355, z + 0.57, 0.025, 0.02, 0.82, '#acc0bd');
      } else {
        for (let k = -2; k <= 2; k++) b(x + k * 0.92, 0.68, z + d / 2 + 0.03, 0.66, 0.54, 0.08, '#536f72');
        for (const side of [-1, 1]) b(x + side * 2.35, h + 0.23, z, 0.09, 0.08, 4.55, '#f2bd72');
        const dock = city.fixtures[kind - 4];
        b(x, h + 0.215, z, 4.22, 0.065, 4.22, '#334d50');
        for (const side of [-1, 1])
          for (const end of [-1, 1]) {
            b(x + side * 2.03, h + 0.27, z + end * 1.78, 0.08, 0.06, 0.53, '#f2cf93');
            b(x + side * 1.8, h + 0.27, z + end * 2.02, 0.52, 0.06, 0.08, '#f2cf93');
          }
        const texture = new T.TextureLoader().load('./signs/' + STATIONS[kind - 4].key + '.png');
        texture.colorSpace = T.SRGBColorSpace;
        texture.anisotropy = 2;
        const sign = new T.Mesh(
          new T.PlaneGeometry(3.24, 3.24),
          new T.MeshBasicMaterial({ map: texture, toneMapped: false })
        );
        sign.rotation.x = -Math.PI / 2;
        sign.position.set(dock.x, h + 0.29, dock.z);
        root.add(sign);
        for (let k = 0; k < 3; k++) b(x - 2.42, 0.62, z - 1.7 + k * 0.54, 0.53, 0.9, 0.45, '#da9a62');
        if (kind === 5) {
          for (let k = -2; k <= 2; k++) cyl(x + k * 0.85, 0.88, z + 3.12, 0.23, 1.3, '#e2d4b3');
          b(x, 1.61, z + 3.1, 4.35, 0.24, 1.02, '#ab8869');
          for (let k = 0; k < 3; k++) b(x, 0.2 + k * 0.09, z + 3.65 - k * 0.16, 3.35, 0.09, 0.43, '#c9bd9e');
        }
        if (kind === 6) {
          b(x + w / 2 + 0.035, 1.02, z, 0.06, 0.82, 0.26, '#c26350');
          b(x + w / 2 + 0.045, 1.02, z, 0.065, 0.25, 0.9, '#c26350');
          b(x, 0.99, z + d / 2 + 0.12, 0.24, 0.86, 0.09, '#b95344');
          b(x, 0.99, z + d / 2 + 0.13, 0.85, 0.25, 0.1, '#b95344');
          b(x + 2.6, 0.98, z + 3.27, 1.35, 1.15, 1.05, '#86a8a3');
          b(x + 2.6, 1.59, z + 3.27, 1.55, 0.11, 1.22, '#e2d8c0');
        }
        if (kind === 7) {
          const cx = x - 3.47,
            cz = z - 2.64;
          for (const u of [-0.22, 0.22])
            for (const v of [-0.22, 0.22]) b(cx + u, 2.4, cz + v, 0.105, 4.55, 0.105, '#cb8c49');
          for (let n = 0; n < 8; n++) b(cx, 0.45 + n * 0.55, cz, 0.61, 0.1, 0.61, '#d39b52');
          b(cx + 1.72, 4.72, cz, 4.55, 0.12, 0.42, '#b67e45');
          b(cx + 1.67, 5.04, cz, 4.55, 0.09, 0.22, '#e7b863');
          for (let n = 0; n < 9; n++)
            s.add(cube, cx - 0.32 + n * 0.48, 4.88, cz, 0.055, 0.48, 0.07, '#cf944c', 0, 0, -0.72);
          b(cx + 3.25, 4.13, cz, 0.045, 1.03, 0.045, '#5a6d64');
          b(cx + 3.25, 3.6, cz, 0.35, 0.17, 0.23, '#d99c60');
        }
        if (kind === 4 || kind === 8) {
          for (let k = 0; k < 4; k++)
            b(x - 2.72 + k * 0.12, h + 0.44, z - 1.45, 0.075, 0.19, 1.65, '#becdc0');
          if (kind === 4)
            for (let k = 0; k < 3; k++) {
              b(x - 1.5 + k * 1.1, 0.62, z + 3.2, 0.72, 0.75, 0.95, '#d0985e');
              b(x - 1.5 + k * 1.1, 0.98, z + 3.18, 0.76, 0.1, 0.99, '#ecbe80');
            }
        }
      }
    }
    for (let k = 0; k < (kind === 3 ? 7 : 3); k++) {
      const angle = (k / 7 + rng() * 0.07) * Math.PI * 2,
        r = 3.45 + rng() * 0.28,
        tx = x + Math.cos(angle) * r,
        tz = z + Math.sin(angle) * r;
      cyl(tx, 0.66, tz, 0.15, 0.93, '#826f53');
      const th = 1.2 + rng() * 0.8;
      s.add(
        leaf,
        tx,
        1.23 + th * 0.2,
        tz,
        1.12,
        th,
        1.12,
        ['#618a64', '#78a274', '#8ba96d'][k % 3],
        rng() * 5
      );
      s.add(disc, tx + 0.19, 0.26, tz + 0.2, 1.18, 0.03, 0.89, '#9aab84');
    }
    b(x - 3.45, 0.45, z + 0.75, 0.42, 0.28, 0.98, '#987958');
    b(x - 3.45, 0.58, z + 0.75, 0.46, 0.1, 1.1, '#c2a279');
  }
  // Working harbour, seawall, marina and a small container yard frame the city.
  for (let x = -36; x <= 36; x += 2.6) {
    b(x, 0.14, 29.55, 1.9, 0.18, 0.22, '#d4d0b4');
    cyl(x, 0.24, 30.03, 0.23, 0.6, '#526967');
  }
  for (let x = -31; x < -8; x += 6) {
    b(x, -0.38, 32.6, 1.1, 0.36, 5.4, '#ac9270');
    b(x + 1.25, -0.51, 33.5, 1.09, 0.55, 3.6, '#d5c8a5');
    b(x + 1.25, -0.13, 33.6, 0.64, 0.32, 1.48, '#709493');
  }
  for (let n = 0; n < 11; n++) {
    const x = 6 + (n % 6) * 3.55,
      z = 27.22 + Math.floor(n / 6) * 1.28;
    b(x, 0.66, z, 3.03, 0.99, 1.05, ['#ca835d', '#839e97', '#b5a370', '#6f8a99'][n % 4]);
    for (let k = 0; k < 6; k++) b(x - 1.22 + k * 0.48, 0.68, z + 0.535, 0.07, 0.72, 0.04, '#a5a48a');
  }
  for (let n = 0; n < 85; n++) {
    const x = (rng() - 0.5) * 134,
      z = (rng() - 0.5) * 108;
    if (Math.abs(x) < 38 && Math.abs(z) < 31) continue;
    b(x, -0.85, z, 1 + rng() * 3, 0.018, 0.065, '#a6cdc1');
  }
  for (const [x, z, scale] of [
    [19, 34.4, 1],
    [-34, -34, 0.72],
  ]) {
    b(x, -0.53, z, 8 * scale, 0.62, 2.35 * scale, '#3b6868');
    b(x, -0.14, z, 7.45 * scale, 0.22, 2.13 * scale, '#ccbd98');
    b(x + 2.2 * scale, 0.34, z, 1.5 * scale, 0.84, 1.65 * scale, '#e2d3b3');
    b(x + 2.2 * scale, 0.68, z + 0.04, 1.35 * scale, 0.19, 1.69 * scale, '#668986');
    for (let k = 0; k < 3; k++)
      b(
        x - 2.75 * scale + k * 1.44 * scale,
        0.25,
        z,
        1.22 * scale,
        0.62,
        1.46 * scale,
        ['#b87855', '#7c9992', '#b29a68'][k]
      );
  }
  s.finish(root);
}
export class CityView {
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly cityRoot = new T.Group();
  host = new T.Group();
  moving = new T.Group();
  routes = new T.Group();
  drones = [aircraft(0), aircraft(1), aircraft(2)];
  camera = new T.OrthographicCamera(-40, 40, 30, -30, 0.1, 320);
  eye = new T.PerspectiveCamera(FOV, WIDTH / HEIGHT, 0.045, 95);
  target = new T.WebGLRenderTarget(WIDTH, HEIGHT, { depthBuffer: true, colorSpace: T.SRGBColorSpace });
  sun = new T.DirectionalLight(0xffe1b2, 2.0);
  fill = new T.HemisphereLight(0xf0f9ed, 0xb0a78d, 2.05);
  angle = 0.56;
  zoom = 0.91;
  top = false;
  follow = false;
  firstPerson = false;
  center = new T.Vector3(0, 1.3, 0);
  smoothAngle = 0.56;
  smoothZoom = 0.91;
  lastRoute = -10;
  lastTraffic = -10;
  lastWeather = '';
  selected = 0;
  eventKey = '';
  traffic: T.InstancedMesh;
  ghost: Point[] = [];
  vehicleColors = ['#d78757', '#ecdfac', '#709b9f', '#b7c2a8', '#8c97a7'];
  poseScreen = new T.Vector3();
  ray = new T.Raycaster();
  sea: T.Mesh;
  constructor(
    readonly element: HTMLElement,
    public sim: Simulation
  ) {
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1536, 1536);
    Object.assign(this.sun.shadow.camera, { left: -48, right: 48, top: 49, bottom: -49, near: 1, far: 145 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.00028;
    this.sun.shadow.normalBias = 0.055;
    element.prepend(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '可旋转的三维配送城市');
    this.scene.add(this.cityRoot, this.host, this.moving, this.sun, this.fill);
    this.sun.position.set(-30, 60, 24);
    this.sea = new T.Mesh(new T.PlaneGeometry(650, 650), new T.MeshBasicMaterial({ color: '#83ada9' }));
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = -0.9;
    this.scene.add(this.sea);
    this.host.add(this.routes);
    this.drones.forEach((d) => this.scene.add(d.root));
    this.traffic = new T.InstancedMesh(cube, matte, 113);
    this.traffic.frustumCulled = false;
    this.scene.add(this.traffic);
    this.setCity();
    new ResizeObserver(() => this.resize()).observe(element);
    this.resize();
  }
  setCity() {
    this.cityRoot.traverse((o) => {
      if (o instanceof T.InstancedMesh) o.dispose();
      else if (o instanceof T.Mesh && o.material.map) {
        o.geometry.dispose();
        o.material.map.dispose();
        o.material.dispose();
      }
    });
    this.cityRoot.clear();
    buildTown(this.sim.city, this.cityRoot);
    this.lastRoute = -10;
    this.lastTraffic = -10;
    this.lastWeather = '';
    this.renderer.shadowMap.needsUpdate = true;
    this.eventKey = '';
  }
  resize() {
    const w = Math.max(100, this.element.clientWidth),
      h = Math.max(100, this.element.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.updateProjectionMatrix();
  }
  sky(weather: Weather) {
    if (this.lastWeather === weather) return;
    this.lastWeather = weather;
    const night = weather === '夜航',
      fog = weather === '薄雾',
      rain = weather === '小雨';
    const bg = night ? '#344d61' : fog ? '#c1d2c6' : rain ? '#9bb2ad' : '#a6c9bd';
    this.scene.background = new T.Color(bg);
    this.scene.fog = new T.Fog(bg, fog ? 28 : night ? 85 : 115, fog ? 165 : 245);
    this.sun.intensity = night ? 0.42 : rain ? 0.93 : 2.05;
    this.fill.intensity = night ? 1.08 : rain ? 1.55 : 1.6;
    (this.sea.material as T.MeshBasicMaterial).color.set(night ? '#43676d' : rain ? '#79999a' : '#83ada9');
    this.sun.color.set(night ? '#97bada' : '#ffe1b5');
  }
  animate() {
    const { s } = this.sim,
      t = s.time;
    for (const [id, m] of this.drones.entries()) {
      const d = s.drones[id];
      m.root.visible = !!d;
      if (!d) continue;
      m.root.position.set(d.p.x, d.p.y + 0.05, d.p.z);
      m.root.rotation.set(d.v.z * 0.013, d.yaw, -d.v.x * 0.014);
      m.rotors.forEach((r, k) => (r.rotation.y = t * (d.phase === 'idle' ? 3 : 43) * (k % 2 ? 1 : -1)));
    }
    if (t - this.lastTraffic < 0.075 && t >= this.lastTraffic) return;
    this.lastTraffic = t;
    let index = 0;
    const put = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, ry = 0) => {
      transform.position.set(x, y, z);
      transform.rotation.set(0, ry, 0);
      transform.scale.set(w, h, d);
      transform.updateMatrix();
      this.traffic.setMatrixAt(index, transform.matrix);
      this.traffic.setColorAt(index++, new T.Color(c));
    };
    for (let n = 0; n < 16; n++) {
      const horiz = n % 2 === 0,
        positive = n % 4 < 2 ? 1 : -1,
        extent = horiz ? 66 : 54;
      const coord = (((t * (0.85 + (n % 3) * 0.31) + n * 7.91) % extent) - extent / 2) * positive;
      const axis = horiz ? ground(0, 2 * (n % 5)).z : ground(2 * (n % 6), 0).x;
      const x = horiz ? coord : axis + 0.78 * positive,
        z = horiz ? axis + 0.78 * positive : coord,
        ry = horiz ? Math.PI / 2 : 0;
      put(x, 0.45, z, 0.68, 0.39, 1.35, this.vehicleColors[n % 5], ry);
      put(x, 0.68, z, 0.55, 0.24, 0.74, '#b9cfbf', ry);
      put(x, 0.705, z, 0.51, 0.09, 0.37, '#647c7e', ry);
    }
    for (let n = 0; n < 15; n++) {
      const x = ground((n % 6) * 2, 0).x + 2.12 * (n % 2 ? 1 : -1),
        z = ((n * 5.31 + t * (0.28 + (n % 3) * 0.08)) % 53) - 26.5;
      put(x, 0.42, z, 0.19, 0.46, 0.21, this.vehicleColors[(n + 2) % 5]);
      put(x, 0.72, z, 0.17, 0.16, 0.18, '#bc9577');
    }
    if (s.config.weather === '小雨')
      for (let k = 0; k < 32; k++) {
        const x = ((k * 13.7) % 68) - 34,
          z = ((k * 8.7) % 55) - 27,
          y = 11 - ((t * 8 + k * 3.14) % 10);
        put(x, y, z, 0.032, 0.48, 0.032, '#c1d7d4');
      }
    this.traffic.count = index;
    this.traffic.instanceMatrix.needsUpdate = true;
    if (this.traffic.instanceColor) this.traffic.instanceColor.needsUpdate = true;
  }
  clearLines(group: T.Group) {
    for (const o of group.children) {
      if (o instanceof T.Line || o instanceof T.Mesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    }
    group.clear();
  }
  line(points: Point[], color: string, group: T.Group, dashed = false) {
    if (points.length < 2) return;
    const geometry = new T.BufferGeometry().setFromPoints(points.map((p) => new T.Vector3(p.x, p.y, p.z)));
    const mat = dashed
      ? new T.LineDashedMaterial({ color, dashSize: 0.8, gapSize: 0.42, depthTest: false })
      : new T.LineBasicMaterial({ color, depthTest: false });
    const line = new T.Line(geometry, mat);
    line.renderOrder = 8;
    if (dashed) line.computeLineDistances();
    group.add(line);
  }
  updatePaths() {
    const t = this.sim.s.time;
    if (t - this.lastRoute < 0.35 && t >= this.lastRoute) return;
    this.lastRoute = t;
    this.clearLines(this.routes);
    for (const d of this.sim.s.drones) {
      this.line(d.trace.slice(-120), COLORS[d.id], this.routes);
      if (d.route.length) this.line([d.pose, ...d.route.map(center)], '#f0ce83', this.routes, true);
      const p = d.p;
      this.line([p, { ...p, y: 0.34 }], COLORS[d.id], this.routes, true);
      const ring: Point[] = [];
      for (let k = 0; k <= 32; k++) {
        const a = (k * Math.PI) / 16;
        ring.push({ x: p.x + Math.cos(a) * 1.68, y: p.y - 0.3, z: p.z + Math.sin(a) * 1.68 });
      }
      this.line(ring, COLORS[d.id], this.routes);
    }
    this.line(this.ghost, '#7f5ba8', this.routes, true);
    for (const e of this.sim.s.events.filter((e) => active(e, t) && ['closed', 'ceiling'].includes(e.kind))) {
      const p = ground(e.i, e.j),
        h = e.maxLayer === undefined ? 13.9 : [6.9, 10.5, 13.9][e.maxLayer],
        bottom = e.minLayer !== undefined ? [0.4, 7.2, 10.9][e.minLayer] : e.kind === 'ceiling' ? 7.2 : 0.4;
      this.line(
        [
          [-3, -3],
          [3, -3],
          [3, 3],
          [-3, 3],
          [-3, -3],
        ].map(([x, z]) => ({ x: p.x + x, y: h, z: p.z + z })),
        '#dd6049',
        this.routes,
        true
      );
      for (const x of [-3, 3])
        for (const z of [-3, 3])
          this.line(
            [
              { x: p.x + x, y: bottom, z: p.z + z },
              { x: p.x + x, y: h, z: p.z + z },
            ],
            '#dd6049',
            this.routes,
            true
          );
    }
  }
  updateEvents() {
    const boxes = this.sim.extra;
    const key = this.sim.s.events
      .filter((e) => active(e, this.sim.s.time) && ['occupied', 'crane', 'traffic'].includes(e.kind))
      .map((e) => e.id)
      .join(',');
    if (key !== this.eventKey) {
      this.eventKey = key;
      for (const o of this.moving.children) {
        if (o instanceof T.Mesh) o.material.dispose();
      }
      this.moving.clear();
      boxes.forEach(() => part(this.moving, cube, 1, 1, 1, '#db9859'));
    }
    boxes.forEach((b, i) => {
      const o = this.moving.children[i];
      if (o) {
        o.position.set(b.x, b.y + b.h / 2, b.z);
        o.scale.set(b.w, b.h, b.d);
      }
    });
  }
  render() {
    this.sky(this.sim.s.config.weather);
    this.animate();
    this.updateEvents();
    this.updatePaths();
    const w = this.element.clientWidth,
      h = Math.max(1, this.element.clientHeight),
      ar = w / h;
    this.smoothAngle += (this.angle - this.smoothAngle) * 0.2;
    this.smoothZoom += ((this.follow ? this.zoom * 1.55 : this.zoom) - this.smoothZoom) * 0.18;
    const view = Math.max(this.top ? 65 : 63, 87 / Math.max(0.5, ar)) / this.smoothZoom;
    this.camera.left = (-view * ar) / 2;
    this.camera.right = (view * ar) / 2;
    this.camera.top = view / 2;
    this.camera.bottom = -view / 2;
    const d = this.sim.s.drones[this.selected] ?? this.sim.s.drones[0];
    const c = this.follow ? new T.Vector3(d.p.x, 2, d.p.z) : new T.Vector3(0, 1.3, 0);
    this.center.lerp(c, 0.15);
    const pitch = this.top ? 1.568 : 0.78,
      dist = 96;
    this.camera.position.set(
      this.center.x + Math.sin(this.smoothAngle) * Math.cos(pitch) * dist,
      this.center.y + Math.sin(pitch) * dist,
      this.center.z + Math.cos(this.smoothAngle) * Math.cos(pitch) * dist
    );
    this.camera.lookAt(this.center);
    this.camera.updateProjectionMatrix();
    this.renderer.setRenderTarget(null);
    if (this.firstPerson) {
      this.aim(d.id, true, ar);
      this.host.visible = false;
      this.drones[d.id].root.visible = false;
      try {
        this.renderer.render(this.scene, this.eye);
      } finally {
        this.host.visible = true;
        this.drones[d.id].root.visible = true;
      }
    } else this.renderer.render(this.scene, this.camera);
  }
  aim(id: number, forward: boolean, aspect: number) {
    const d = this.sim.s.drones[id],
      p = d.p;
    this.eye.aspect = aspect;
    this.eye.updateProjectionMatrix();
    this.eye.position.set(p.x, p.y + 0.12, p.z);
    if (forward) {
      this.eye.up.set(0, 1, 0);
      this.eye.lookAt(
        p.x + Math.sin(d.yaw) * 7,
        p.y - (d.phase === 'idle' ? 0.1 : 1.7),
        p.z + Math.cos(d.yaw) * 7
      );
    } else {
      this.eye.up.set(0, 0, -1);
      this.eye.lookAt(p.x, p.y - 1, p.z);
    }
  }
  capture(id: number, forward = false) {
    const g = this.drones[id].root;
    this.aim(id, forward, WIDTH / HEIGHT);
    this.host.visible = false;
    g.visible = false;
    const raw = new Uint8Array(WIDTH * HEIGHT * 4),
      flipped = new Uint8Array(raw.length);
    try {
      this.renderer.setRenderTarget(this.target);
      this.renderer.render(this.scene, this.eye);
      this.renderer.readRenderTargetPixels(this.target, 0, 0, WIDTH, HEIGHT, raw);
    } finally {
      this.renderer.setRenderTarget(null);
      this.host.visible = true;
      g.visible = true;
    }
    const row = WIDTH * 4;
    for (let y = 0; y < HEIGHT; y++)
      flipped.set(raw.subarray((HEIGHT - 1 - y) * row, (HEIGHT - y) * row), y * row);
    const weather = this.sim.s.config.weather;
    if (weather === '薄雾' || weather === '小雨' || weather === '夜航') {
      const gain = weather === '夜航' ? 0.65 : weather === '薄雾' ? 0.72 : 0.89,
        lift = weather === '薄雾' ? 39 : 3;
      for (let i = 0; i < flipped.length; i += 4)
        for (let c = 0; c < 3; c++) flipped[i + c] = flipped[i + c] * gain + lift;
    }
    return flipped;
  }
  pick(x: number, y: number): Cell | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(
      new T.Vector2(((x - rect.left) / rect.width) * 2 - 1, (-(y - rect.top) / rect.height) * 2 + 1),
      this.camera
    );
    const v = this.ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), new T.Vector3());
    if (!v || Math.abs(v.x) > (COLS * UNIT) / 2 || Math.abs(v.z) > (ROWS * UNIT) / 2) return null;
    return toCell(v);
  }
  project(p: Point) {
    this.poseScreen.set(p.x, p.y, p.z).project(this.camera);
    return {
      x: ((this.poseScreen.x + 1) / 2) * this.element.clientWidth,
      y: ((1 - this.poseScreen.y) / 2) * this.element.clientHeight,
    };
  }
}
