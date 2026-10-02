import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * three.js 두 겹:
 *  - 배경(UI 뒤): 둥둥 떠다니는 숫자 블록·비눗방울·별
 *  - 이펙트(UI 위, 클릭 통과): 화면 픽셀 좌표 그대로 쓰는 직교 카메라에 3D 별·하트·구슬 파티클, 링, "+1" 글자
 * WebGL 을 못 쓰는 환경에선 모든 메서드가 아무것도 하지 않는다.
 */

const PALETTES: Record<string, number[]> = {
  paper: [0xf6bd60, 0xf28482, 0x84a59d, 0xf5cac3, 0x90be6d, 0x8ecae6, 0xcdb4db],
  night: [0x7aa2ff, 0xc792ea, 0xff8fab, 0x8fd3ff, 0xffd166, 0x80ffdb, 0xb8c0ff],
  matcha: [0x90be6d, 0xb5e48c, 0xf9c74f, 0xf4a6a6, 0x76c893, 0xa3c4f3, 0xffe5b4],
};

const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  rx: number;
  ry: number;
  wx: number;
  wy: number;
  size: number;
  t: number;
  life: number;
  gravity: number;
  drag: number;
  flutter: number;
  color: THREE.Color;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** 같은 모양 파티클을 InstancedMesh 하나로 */
class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  items: Particle[] = [];

  constructor(
    geo: THREE.BufferGeometry,
    private readonly cap: number,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.05 }), cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  add(p: Particle): void {
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push(p);
  }

  update(dt: number): void {
    this.items = this.items.filter((p) => (p.t += dt) < p.life);
    this.items.forEach((p, i) => {
      p.vy -= p.gravity * dt;
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
      p.x += (p.vx + Math.sin(p.t * 6 + p.rx) * p.flutter) * dt;
      p.y += p.vy * dt;
      p.rx += p.wx * dt;
      p.ry += p.wy * dt;
      const k = p.t / p.life;
      // 톡 튀어나왔다가 끝에서 쪼그라든다
      const s = k < 0 ? 0 : p.size * Math.min(1, k * 8) * (k > 0.7 ? (1 - k) / 0.3 : 1);
      _m.compose(_p.set(p.x, p.y, p.z), _q.setFromEuler(_e.set(p.rx, p.ry, 0)), _s.set(s, s, s));
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, p.color);
    });
    this.mesh.count = this.items.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

function starShape(outer = 1, inner = 0.48): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return s;
}

function heartShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, -0.9);
  s.bezierCurveTo(-1.3, 0, -0.9, 1.05, 0, 0.45);
  s.bezierCurveTo(0.9, 1.05, 1.3, 0, 0, -0.9);
  return s;
}

const extrude = (shape: THREE.Shape) =>
  new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.12, bevelSegments: 2 }).center();

function textTexture(text: string, color: string, size = 128, wide = 2, stroke = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size * wide;
  c.height = size;
  const g = c.getContext('2d')!;
  g.font = `800 ${size * 0.7}px Nunito, Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.12;
  g.strokeStyle = '#fff';
  if (stroke) g.strokeText(text, c.width / 2, size / 2);
  g.fillStyle = color;
  g.fillText(text, c.width / 2, size / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Floater {
  obj: THREE.Object3D;
  base: THREE.Vector3;
  speed: number;
  phase: number;
  spin: THREE.Vector3;
  rise: number;
}

interface Tween {
  t: number;
  life: number;
  step(k: number): void;
  done(): void;
}

export class Fx {
  private ok = false;
  private bgR!: THREE.WebGLRenderer;
  private fxR!: THREE.WebGLRenderer;
  private bgScene = new THREE.Scene();
  private fxScene = new THREE.Scene();
  private bgCam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  private fxCam = new THREE.OrthographicCamera(0, 1, 0, -1, -2000, 2000);
  private pools: ParticlePool[] = [];
  private floaters: Floater[] = [];
  private tinted: THREE.MeshStandardMaterial[] = [];
  private tweens: Tween[] = [];
  private palette = PALETTES.paper;
  private mouse = new THREE.Vector2();
  private last = performance.now();

  constructor() {
    try {
      this.bgR = this.mkRenderer('fx-bg', 1.5);
      this.fxR = this.mkRenderer('fx-top', 2);
    } catch {
      return;
    }
    this.ok = true;

    this.bgCam.position.z = 20;
    this.bgScene.add(new THREE.HemisphereLight(0xffffff, 0xd8e6ff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(6, 10, 8);
    this.bgScene.add(sun);
    this.fxScene.add(new THREE.HemisphereLight(0xffffff, 0xcfd8ff, 2));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(200, 400, 600);
    this.fxScene.add(key);

    for (const geo of [extrude(starShape()), extrude(heartShape()), new THREE.SphereGeometry(0.7, 16, 12), new RoundedBoxGeometry(1.2, 1.2, 1.2, 2, 0.3)]) {
      const pool = new ParticlePool(geo, reduceMotion ? 60 : 260);
      this.pools.push(pool);
      this.fxScene.add(pool.mesh);
    }

    this.buildBackground();
    this.resize();
    addEventListener('resize', () => this.resize());
    addEventListener('pointermove', (e) => this.mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1));
    requestAnimationFrame(this.loop);
  }

  private mkRenderer(id: string, maxRatio: number): THREE.WebGLRenderer {
    const r = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, maxRatio));
    r.setClearColor(0x000000, 0);
    r.domElement.id = id;
    document.body.appendChild(r.domElement);
    return r;
  }

  private buildBackground(): void {
    const box = new RoundedBoxGeometry(1.6, 1.6, 1.6, 4, 0.38);
    const face = new THREE.PlaneGeometry(1.25, 1.25);
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const edgeX = () => (Math.random() < 0.5 ? -1 : 1) * rand(10, 18);
    const n = reduceMotion ? 8 : 16;
    for (let k = 0; k < n; k++) {
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.5 });
      this.tinted.push(mat);
      const mesh = new THREE.Mesh(box, mat);
      const digit = new THREE.Mesh(face, new THREE.MeshBasicMaterial({ map: textTexture(String((k % 9) + 1), '#ffffff', 128, 1, false), transparent: true }));
      digit.position.z = 0.81;
      mesh.add(digit);
      // 가운데(UI 자리)는 비워 두고 양옆 가장자리에만
      this.addFloater(mesh, edgeX(), rand(-9, 9), rand(-16, -6), rand(0.6, 1.2), false);
    }
    const bubble = new THREE.SphereGeometry(0.5, 20, 14);
    for (let k = 0; k < (reduceMotion ? 6 : 16); k++) {
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.15, transparent: true, opacity: 0.45 });
      this.tinted.push(mat);
      this.addFloater(new THREE.Mesh(bubble, mat), rand(-16, 16), rand(-10, 10), rand(-12, -2), rand(0.4, 1.1), true);
    }
    const star = extrude(starShape());
    for (let k = 0; k < (reduceMotion ? 4 : 10); k++) {
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.3 });
      this.tinted.push(mat);
      this.addFloater(new THREE.Mesh(star, mat), edgeX(), rand(-10, 10), rand(-14, -4), rand(0.35, 0.6), false);
    }
    this.recolor();
  }

  private addFloater(obj: THREE.Object3D, x: number, y: number, z: number, s: number, rise: boolean): void {
    obj.position.set(x, y, z);
    obj.scale.setScalar(s);
    obj.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    this.bgScene.add(obj);
    this.floaters.push({
      obj,
      base: obj.position.clone(),
      speed: 0.3 + Math.random() * 0.5,
      phase: Math.random() * 10,
      spin: new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.6, 0),
      rise: rise ? 0.4 + Math.random() * 0.6 : 0,
    });
  }

  private recolor(): void {
    this.tinted.forEach((m, i) => m.color.setHex(this.palette[i % this.palette.length]));
  }

  setTheme(id: string): void {
    this.palette = PALETTES[id] ?? PALETTES.paper;
    if (this.ok) this.recolor();
  }

  randomColor(): string {
    return '#' + this.palette[Math.floor(Math.random() * this.palette.length)].toString(16).padStart(6, '0');
  }

  private resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    this.bgR.setSize(w, h);
    this.fxR.setSize(w, h);
    this.bgCam.aspect = w / h;
    this.bgCam.updateProjectionMatrix();
    Object.assign(this.fxCam, { left: 0, right: w, top: 0, bottom: -h });
    this.fxCam.updateProjectionMatrix();
  }

  private loop = (now: number) => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = now / 1000;

    if (!reduceMotion) {
      for (const f of this.floaters) {
        if (f.rise) {
          f.base.y += f.rise * dt;
          if (f.base.y > 12) f.base.y = -12;
        }
        f.obj.position.set(f.base.x + Math.sin(t * f.speed * 0.7 + f.phase) * 0.4, f.base.y + Math.sin(t * f.speed + f.phase) * 0.5, f.base.z);
        f.obj.rotation.x += f.spin.x * dt;
        f.obj.rotation.y += f.spin.y * dt;
      }
      this.bgCam.position.x += (this.mouse.x * 1.2 - this.bgCam.position.x) * 0.03;
      this.bgCam.position.y += (-this.mouse.y * 0.8 - this.bgCam.position.y) * 0.03;
      this.bgCam.lookAt(0, 0, -8);
    }
    this.bgR.render(this.bgScene, this.bgCam);

    for (const p of this.pools) p.update(dt);
    this.tweens = this.tweens.filter((tw) => {
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.life);
      tw.step(k);
      if (k >= 1) tw.done();
      return k < 1;
    });
    this.fxR.render(this.fxScene, this.fxCam);
  };

  // ───────────── 이펙트 API (화면 픽셀 좌표) ─────────────

  /** 별·하트·구슬이 사방으로 톡 */
  burst(x: number, y: number, colors: string | string[], o: { count?: number; power?: number; size?: number; shapes?: number[] } = {}): void {
    if (!this.ok) return;
    const list = Array.isArray(colors) ? colors : [colors];
    const count = Math.round((o.count ?? 18) * (reduceMotion ? 0.3 : 1));
    const shapes = o.shapes ?? [0, 0, 1, 2, 3];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (o.power ?? 260) * (0.4 + Math.random() * 0.8);
      this.pools[shapes[i % shapes.length]].add({
        x,
        y: -y,
        z: 100 + Math.random() * 50,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v + 120,
        rx: Math.random() * 6,
        ry: Math.random() * 6,
        wx: (Math.random() - 0.5) * 14,
        wy: (Math.random() - 0.5) * 14,
        size: (o.size ?? 8) * (0.6 + Math.random() * 0.8),
        t: 0,
        life: 0.7 + Math.random() * 0.5,
        gravity: 700,
        drag: 2.2,
        flutter: 0,
        color: new THREE.Color(list[i % list.length]),
      });
    }
  }

  /** 화면 위에서 색종이가 팔랑팔랑 */
  confetti(count = 160): void {
    if (!this.ok) return;
    const n = Math.round(count * (reduceMotion ? 0.25 : 1));
    for (let i = 0; i < n; i++) {
      this.pools[i % 4 === 0 ? 1 : i % 3 === 0 ? 3 : 0].add({
        x: Math.random() * innerWidth,
        y: 40 + Math.random() * 300,
        z: Math.random() * 200,
        vx: (Math.random() - 0.5) * 120,
        vy: -60 - Math.random() * 140,
        rx: Math.random() * 6,
        ry: Math.random() * 6,
        wx: (Math.random() - 0.5) * 8,
        wy: (Math.random() - 0.5) * 8,
        size: 7 + Math.random() * 7,
        t: -Math.random() * 0.8,
        life: 3 + Math.random() * 1.5,
        gravity: 60,
        drag: 0.6,
        flutter: 70,
        color: new THREE.Color(this.randomColor()),
      });
    }
  }

  /** 퍼져 나가는 고리 */
  ring(x: number, y: number, color: string, radius = 46): void {
    if (!this.ok) return;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), mat);
    mesh.position.set(x, -y, 50);
    this.fxScene.add(mesh);
    this.tweens.push({
      t: 0,
      life: 0.45,
      step: (k) => {
        const e = 1 - (1 - k) ** 3;
        mesh.scale.setScalar(8 + e * radius);
        mat.opacity = 1 - k;
      },
      done: () => {
        this.fxScene.remove(mesh);
        mesh.geometry.dispose();
        mat.dispose();
      },
    });
  }

  /** "+1" 같은 글자가 통통 떠오른다 */
  text(x: number, y: number, str: string, color: string, size = 56): void {
    if (!this.ok) return;
    const map = textTexture(str, color);
    const mat = new THREE.SpriteMaterial({ map, transparent: true, depthTest: false });
    const sp = new THREE.Sprite(mat);
    sp.position.set(x, -y, 300);
    this.fxScene.add(sp);
    this.tweens.push({
      t: 0,
      life: 0.9,
      step: (k) => {
        const pop = k < 0.2 ? 0.5 + (k / 0.2) * 0.7 : 1.2 - Math.min(0.2, (k - 0.2) * 0.6);
        sp.scale.set(size * 2 * pop, size * pop, 1);
        sp.position.y = -y + k * 50;
        mat.opacity = k > 0.6 ? (1 - k) / 0.4 : 1;
      },
      done: () => {
        this.fxScene.remove(sp);
        map.dispose();
        mat.dispose();
      },
    });
  }
}
