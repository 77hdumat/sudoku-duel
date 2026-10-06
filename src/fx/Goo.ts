import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { light, reduceMotion } from './Fx';

/**
 * 3D 침: three.js MarchingCubes 메타볼로 출렁이는 액체 덩어리를 만들고,
 * three.js 예제의 물 노멀맵(waternormals.jpg)을 흘려 표면이 일렁이게 한다.
 *
 * 렌더러 하나를 화면 밖에 두고, 침마다 자기 2D 캔버스(.splat 안)로 옮겨 그린다.
 * 그래서 침이 DOM 순서를 따른다 — "퉤!"·리액션 글자와 결과 창은 침 위에 보인다.
 * 판을 가리는 일은 아래 깔린 SVG 침이 맡고(WebGL 이 없어도 가려진다), 이건 그 위의 입체감이다.
 */

const RES = light ? 28 : 40;
/** 판(사각형)을 덮도록 필드를 판보다 크게 — 필드 가장자리는 면이 잘리므로 공은 0.08~0.92 안에 */
const SPREAD = 1.45;
const DPR = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, light ? 1.5 : 2);

interface Ball {
  x: number;
  z: number;
  s: number;
  ph: number;
  /** 흘러내리는 방울: 아래로 내려갈 거리 */
  drip: number;
}

interface Blob {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  mc: MarchingCubes;
  balls: Ball[];
  t: number;
  /** 출렁임 세기 (맞으면 커졌다가 잦아든다) */
  wobble: number;
  /** 0 → 1 로 퍼지고, 걷힐 때 1 → 0 */
  grow: number;
  leaving: boolean;
}

let renderer: THREE.WebGLRenderer | null = null;
let failed = false;
let scene: THREE.Scene;
let cam: THREE.OrthographicCamera;
let mat: THREE.MeshPhysicalMaterial;
let normals: THREE.Texture;
const blobs = new Set<Blob>();
let raf = 0;
let last = 0;

function setup(): boolean {
  if (renderer) return true;
  if (failed) return false;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch {
    failed = true;
    return false;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(DPR);
  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
  cam.position.z = 1000;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x5a8fb8, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-0.6, 0.9, 1);
  scene.add(key);
  const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  normals = new THREE.TextureLoader().load('assets/waternormals.jpg');
  normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
  normals.repeat.set(1.6, 1.6);
  mat = new THREE.MeshPhysicalMaterial({
    color: 0x8ccbf0,
    roughness: 0.06,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    normalMap: normals,
    normalScale: new THREE.Vector2(0.3, 0.3),
    envMap: env,
    envMapIntensity: 0.9,
  });
  return true;
}

function makeBalls(): Ball[] {
  const R = Math.random;
  const balls: Ball[] = [];
  // 판 전체를 덮는 격자 + 흔들림
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) balls.push({ x: 0.28 + i * 0.22 + (R() - 0.5) * 0.04, z: 0.28 + j * 0.22 + (R() - 0.5) * 0.04, s: 0.9 + R() * 0.15, ph: R() * 6, drip: 0 });
  // 가운데 두툼한 덩어리
  for (let k = 0; k < 2; k++) balls.push({ x: 0.44 + R() * 0.12, z: 0.42 + R() * 0.12, s: 1.1 + R() * 0.2, ph: R() * 6, drip: 0 });
  // 가장자리로 튄 방울
  for (let k = 0; k < 5; k++) {
    const a = R() * Math.PI * 2;
    balls.push({ x: 0.5 + Math.cos(a) * 0.36, z: 0.5 + Math.sin(a) * 0.36, s: 0.08 + R() * 0.06, ph: R() * 6, drip: 0 });
  }
  // 아래로 흘러내리는 줄기
  for (let k = 0; k < 3; k++) balls.push({ x: 0.3 + R() * 0.4, z: 0.7, s: 0.12 + R() * 0.05, ph: R() * 6, drip: 0.1 + R() * 0.1 });
  return balls;
}

function draw(b: Blob, dt: number): void {
  const el = b.canvas;
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (!w || !h) return;
  b.t += dt;
  b.wobble += (0.15 - b.wobble) * Math.min(1, dt * 2.5);
  const target = b.leaving ? 0 : 1;
  b.grow += (target - b.grow) * Math.min(1, dt * (b.leaving ? 9 : 14));

  const mc = b.mc;
  mc.reset();
  const amp = reduceMotion ? 0.004 : 0.02 * b.wobble;
  for (const p of b.balls) {
    const flow = p.drip ? Math.min(1, b.t / 1.4) ** 0.7 * p.drip : 0;
    const x = p.x + Math.sin(b.t * 5 + p.ph) * amp;
    const z = Math.min(0.9, p.z + flow + Math.cos(b.t * 4.3 + p.ph) * amp);
    // field 의 y 축이 화면 깊이 — 가운데 두고 납작하게 (mesh.scale)
    mc.addBall(x, 0.5, z, p.s * b.grow * (1 + Math.sin(b.t * 7 + p.ph) * amp * 3), 12);
  }
  mc.update();

  const dpr = DPR;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (el.width !== pw || el.height !== ph) {
    el.width = pw;
    el.height = ph;
  }
  const r = renderer!;
  const size = r.getSize(new THREE.Vector2());
  // 가장 큰 침에 맞춰 늘리기만 (매 프레임 크기를 바꾸면 버퍼를 다시 잡는다)
  if (size.x < w || size.y < h) r.setSize(Math.max(size.x, w), Math.max(size.y, h), false);
  const full = r.getSize(new THREE.Vector2());
  cam.left = -w / 2;
  cam.right = w / 2;
  cam.top = h / 2;
  cam.bottom = -h / 2;
  cam.updateProjectionMatrix();
  const s = (Math.min(w, h) / 2) * SPREAD;
  mc.scale.set(s, s * 0.6, s);
  scene.add(mc);
  // 아래쪽 왼편부터 w×h 만 그리고 그 부분을 옮긴다
  r.setViewport(0, 0, w, h);
  r.setScissor(0, 0, w, h);
  r.setScissorTest(true);
  r.clear();
  r.render(scene, cam);
  scene.remove(mc);
  const ctx = b.ctx;
  ctx.clearRect(0, 0, pw, ph);
  ctx.save();
  ctx.shadowColor = 'rgba(40, 90, 130, 0.35)';
  ctx.shadowBlur = 10 * dpr;
  ctx.shadowOffsetY = 4 * dpr;
  ctx.drawImage(r.domElement, 0, (full.y - h) * dpr, pw, ph, 0, 0, pw, ph);
  ctx.restore();
}

function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  normals.offset.x += dt * 0.05;
  normals.offset.y -= dt * 0.03;
  for (const b of blobs) {
    if (!b.canvas.isConnected) {
      blobs.delete(b);
      b.mc.geometry.dispose();
      continue;
    }
    draw(b, dt);
  }
  raf = blobs.size ? requestAnimationFrame(loop) : 0;
}

export interface Goo {
  /** 또 맞았다 — 한 번 더 크게 출렁 */
  again(): void;
  /** 걷히기 시작 */
  off(): void;
}

/** host(.splat) 안에 3D 침을 깐다. WebGL 이 안 되면 null (SVG 침만 남는다) */
export function goo(host: HTMLElement): Goo | null {
  if (!setup()) return null;
  const canvas = document.createElement('canvas');
  canvas.className = 'goo3d';
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  host.appendChild(canvas);
  host.classList.add('gl');
  const mc = new MarchingCubes(RES, mat, true, false, 40000);
  // field 의 y(깊이)를 카메라 쪽으로, z 를 화면 아래쪽으로
  mc.rotation.x = Math.PI / 2;
  const b: Blob = { canvas, ctx, mc, balls: makeBalls(), t: 0, wobble: 1, grow: 0, leaving: false };
  blobs.add(b);
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  return {
    again() {
      b.wobble = 1.4;
      b.t = Math.min(b.t, 0.6);
    },
    off() {
      b.leaving = true;
    },
  };
}
