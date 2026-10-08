import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * AI 봇 3D 얼굴 (외부 모델 없이 three.js 기본 도형으로): 머리·눈·눈썹·입·소품을 따로 만들어
 * three.js 'morph targets - face' 예제처럼 표정을 움직인다 — 깜빡임, 마우스 쪽으로 눈동자, 비웃을 때
 * 눈썹이 내려오고 눈을 가늘게 뜨며 입을 벌리고 크크크 들썩인다.
 *
 * 쓰는 곳 두 군데:
 *  - Blocks.ts: AI 고르기 버튼 블록 위 (이펙트 레이어 장면에 직접) — makeFace
 *  - 그 밖의 DOM: <canvas data-face="king"> 를 넣으면 여기 렌더러가 매 프레임 그려 준다 — faceHtml
 */

type Look = {
  skin: number;
  /** 둥근 머리(false) / 각진 머리(true) */
  boxy?: boolean;
  sclera: number;
  iris: number;
  /** 눈이 스스로 빛나는지 (지옥·대왕) */
  glow?: boolean;
  /** 세로로 찢어진 동공 */
  slit?: boolean;
  /** 눈썹 색 (없으면 눈썹 없음 — 순한 봇) */
  brow?: number;
  /** 평소 찡그림 0..1 */
  anger: number;
  /** 평소 입 벌림 0..1, 음수면 꾹 다문 일자 */
  smile: number;
  fangs?: boolean;
  extra?: (g: THREE.Group) => void;
};

const mat = (color: number, o: { emissive?: number; metal?: number; rough?: number } = {}) =>
  new THREE.MeshStandardMaterial({ color, emissive: o.emissive ?? 0, emissiveIntensity: o.emissive ? 1.2 : 0, metalness: o.metal ?? 0, roughness: o.rough ?? 0.55 });

const LOOKS: Record<string, Look> = {
  easy: {
    skin: 0x8fdc93,
    sclera: 0xffffff,
    iris: 0x2e7d32,
    anger: 0,
    smile: 0.45,
    extra(g) {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.45), mat(0x8d8d8d, { metal: 0.6 }));
      stick.position.y = 1.18;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), mat(0xffc23d, { emissive: 0xff9a00 }));
      ball.position.y = 1.45;
      g.add(stick, ball);
      for (const s of [-1, 1]) {
        const blush = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 10), mat(0xff8fa3));
        blush.scale.set(1, 0.55, 0.3);
        blush.position.set(s * 0.6, -0.22, 0.78);
        g.add(blush);
      }
    },
  },
  medium: {
    skin: 0x6f9fe0,
    boxy: true,
    sclera: 0xffffff,
    iris: 0x1f3c88,
    anger: 0.1,
    smile: -1,
    extra(g) {
      const frame = mat(0x20242c, { metal: 0.5, rough: 0.3 });
      for (const s of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.045, 10, 28), frame);
        ring.position.set(s * 0.38, 0.14, 0.95);
        g.add(ring);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), frame);
      bridge.position.set(0, 0.18, 0.95);
      g.add(bridge);
    },
  },
  hard: {
    skin: 0x4a505e,
    boxy: true,
    sclera: 0x2a0b0f,
    iris: 0xff3048,
    glow: true,
    brow: 0x15171c,
    anger: 0.55,
    smile: 0.18,
    extra(g) {
      const gold = mat(0xf2c230, { metal: 0.85, rough: 0.25, emissive: 0x3a2800 });
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.76, 0.2, 6), gold);
      band.position.y = 0.98;
      g.add(band);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.36, 4), gold);
        spike.position.set(Math.sin(a) * 0.66, 1.25, Math.cos(a) * 0.66);
        g.add(spike);
      }
    },
  },
  hell: {
    skin: 0xb3202a,
    sclera: 0xffd400,
    iris: 0x1a0000,
    glow: true,
    slit: true,
    brow: 0x2a0306,
    anger: 0.85,
    smile: 0.3,
    fangs: true,
    extra(g) {
      const horn = mat(0xf1e4c4, { rough: 0.4 });
      for (const s of [-1, 1]) {
        // 굽은 뿔: 원뿔 세 마디를 바깥으로 휘게
        let x = s * 0.5;
        let y = 0.82;
        let r = 0.21;
        for (let k = 0; k < 3; k++) {
          const seg = new THREE.Mesh(new THREE.ConeGeometry(r, 0.34, 14, 1, k < 2), horn);
          seg.position.set(x, y, 0);
          seg.rotation.z = -s * (0.35 + k * 0.3);
          g.add(seg);
          x += s * 0.1;
          y += 0.26;
          r *= 0.68;
        }
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 10), mat(0xb3202a));
        ear.position.set(s * 1.0, 0.15, -0.05);
        ear.rotation.z = -s * 1.25;
        g.add(ear);
      }
    },
  },
  king: {
    skin: 0x3e5241,
    sclera: 0x2a0000,
    iris: 0xff2020,
    glow: true,
    slit: true,
    brow: 0x0b0b0b,
    anger: 1,
    smile: 0.22,
    fangs: true,
    extra(g) {
      // 변성대왕: 검은 갓(넓은 챙 + 높은 대우) + 금빛 띠 + 王 패, 길게 늘어진 검은 수염과 팔자 콧수염
      // 갓은 말총으로 엮어 비쳐 보인다 — 반투명 검정
      const black = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.88 });
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.03, 48), black);
      brim.position.y = 0.92;
      brim.rotation.x = 0.1;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.72, 32), black);
      crown.position.y = 1.3;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), black);
      cap.scale.y = 0.3;
      cap.position.y = 1.66;
      g.add(cap);
      // 갓끈: 턱 아래로 늘어진 구슬 줄
      for (const s of [-1, 1])
        for (let k = 0; k < 6; k++) {
          const bead = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat(0x8a1c1c, { rough: 0.3 }));
          bead.position.set(s * (0.9 - k * 0.06), 0.75 - k * 0.3, 0.25 + k * 0.05);
          g.add(bead);
        }
      const gold = mat(0xd4a017, { metal: 0.85, rough: 0.25, emissive: 0x3a2800 });
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.665, 0.665, 0.12, 32), gold);
      band.position.y = 1.0;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.04), gold);
      plate.position.set(0, 1.38, 0.62);
      plate.rotation.x = -0.05;
      const glyph = new THREE.Group();
      const ink = mat(0x5a0000, { emissive: 0x500000 });
      for (const y of [-0.1, 0, 0.1]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(y === 0 ? 0.18 : 0.22, 0.03, 0.02), ink);
        bar.position.y = y;
        glyph.add(bar);
      }
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.02), ink);
      glyph.add(stem);
      glyph.position.set(0, 1.38, 0.645);
      g.add(brim, crown, band, plate, glyph);

      const hair = mat(0x101010, { rough: 0.9 });
      // 수염: 가운데 긴 갈래 + 양옆 짧은 갈래
      for (const [x, len, tilt] of [
        [0, 1.15, 0],
        [-0.3, 0.8, -0.25],
        [0.3, 0.8, 0.25],
      ]) {
        const beard = new THREE.Mesh(new THREE.ConeGeometry(0.26, len, 16), hair);
        beard.rotation.set(Math.PI - 0.15, 0, tilt);
        beard.position.set(x, -0.62 - len / 2, 0.5);
        g.add(beard);
      }
      // 퀭한 눈두덩
      for (const s of [-1, 1]) {
        const socket = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 12), mat(0x18221a, { rough: 0.9 }));
        socket.scale.set(1, 0.75, 0.35);
        socket.position.set(s * 0.38, 0.16, 0.74);
        g.add(socket);
      }
      for (const s of [-1, 1]) {
        const stache = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.42, 4, 8), hair);
        stache.position.set(s * 0.3, -0.3, 0.93);
        stache.rotation.z = s * 0.85;
        g.add(stache);
      }
    },
  },
};

const t0 = performance.now();

/** 3D 얼굴 한 개. root 를 장면에 넣고 매 프레임 update */
export class Face {
  readonly root = new THREE.Group();
  /** 보이는 높이(갓·뿔·수염 포함, 모델 단위) — 그림 칸 높이를 이 값으로 나눈 만큼 키운다 */
  readonly height = 2.75;
  /** 뒤로 튀어나온 깊이 — 버튼 윗면에 파묻히지 않게 이만큼 앞으로 띄운다 */
  readonly back = 1.1;
  private head = new THREE.Group();
  private eyes: THREE.Group[] = [];
  private irises: THREE.Object3D[] = [];
  private brows: THREE.Mesh[] = [];
  private mouth = new THREE.Group();
  private mood = 0;
  private blinkAt = 1 + Math.random() * 3;

  constructor(private readonly look: Look) {
    const L = look;
    this.root.add(this.head);
    const skin = mat(L.skin);
    const skull = L.boxy ? new THREE.Mesh(new RoundedBoxGeometry(1.9, 1.8, 1.7, 6, 0.55), skin) : new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), skin);
    if (!L.boxy) skull.scale.set(1, 1.02, 0.92);
    this.head.add(skull);
    const front = L.boxy ? 0.86 : 0.8;

    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(s * 0.38, 0.14, front);
      const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 16), mat(L.sclera, { emissive: L.glow ? L.sclera : 0, rough: 0.2 }));
      sclera.scale.z = 0.55;
      const iris = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 12), mat(L.iris, { emissive: L.glow ? L.iris : 0, rough: 0.2 }));
      ball.scale.z = 0.4;
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), mat(0x050505, { rough: 0.1 }));
      pupil.position.z = 0.04;
      if (L.slit) pupil.scale.set(0.35, 1.9, 0.5);
      iris.add(ball, pupil);
      iris.position.z = 0.11;
      eye.add(sclera, iris);
      this.head.add(eye);
      this.eyes.push(eye);
      this.irises.push(iris);

      if (L.brow === undefined) continue;
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.46, L.anger > 0.5 ? 0.13 : 0.08, 0.1), mat(L.brow));
      brow.position.set(s * 0.38, 0.47, front + 0.08);
      this.head.add(brow);
      this.brows.push(brow);
    }

    // 입: 아래쪽 반원(검붉은 속) + 윗니 줄 + 송곳니. scale.y 로 벌림
    const inside = new THREE.Mesh(new THREE.CircleGeometry(0.4, 32, Math.PI, Math.PI), mat(0x3a0508, { rough: 0.9 }));
    const tongue = new THREE.Mesh(new THREE.CircleGeometry(0.17, 20, Math.PI, Math.PI), mat(0xd9485a));
    tongue.position.set(0, -0.2, 0.005);
    tongue.scale.y = 0.6;
    const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.02), mat(0xfafafa, { rough: 0.3 }));
    teeth.position.set(0, -0.035, 0.012);
    this.mouth.add(inside, tongue, teeth);
    if (L.fangs)
      for (const s of [-1, 1]) {
        const fang = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 8), mat(0xfafafa, { rough: 0.3 }));
        fang.rotation.z = Math.PI;
        fang.position.set(s * 0.2, -0.11, 0.02);
        this.mouth.add(fang);
      }
    this.mouth.position.set(0, -0.42, front + 0.12);
    this.head.add(this.mouth);

    L.extra?.(this.head);
  }

  /**
   * 매 프레임: mood 0 = 평소, 1 = 비웃으며 크크크. gaze = 바라볼 방향(-1..1).
   */
  update(dt: number, mood: number, gaze = { x: 0, y: 0 }): void {
    const L = this.look;
    const t = (performance.now() - t0) / 1000;
    this.mood += (mood - this.mood) * Math.min(1, dt * 7);
    const m = this.mood;
    const cackle = Math.abs(Math.sin(t * 17));

    // 깜빡임 (비웃는 중엔 가늘게 뜬 채로)
    this.blinkAt -= dt;
    let open = 1;
    if (this.blinkAt < 0) {
      open = Math.min(1, Math.abs(this.blinkAt + 0.07) / 0.07);
      if (this.blinkAt < -0.14) this.blinkAt = 2 + Math.random() * 3;
    }
    const squint = 1 - 0.5 * Math.max(m, L.anger * 0.4);
    for (const e of this.eyes) e.scale.y = Math.max(0.08, open * squint);
    for (const iris of this.irises) iris.position.set(gaze.x * 0.06, gaze.y * 0.05, 0.11);

    // 눈썹: 안쪽 끝이 내려가면 화난 얼굴
    const anger = Math.min(1, L.anger + m * 0.7);
    this.brows.forEach((b, k) => {
      const s = k ? 1 : -1;
      b.rotation.z = s * anger * 0.5;
      b.position.y = 0.47 - anger * 0.08 + (1 - anger) * m * 0.05;
    });

    // 입: 평소 모양 → 비웃으면 크게 벌리고 들썩
    const rest = L.smile < 0 ? 0.08 : L.smile;
    this.mouth.scale.set(1 + m * 0.15, rest + m * (0.55 + 0.35 * cackle), 1);
    this.mouth.rotation.z = (1 - m) * (L.anger > 0.4 ? 0.12 : 0);

    // 머리: 평소엔 천천히 둘러보고, 웃을 땐 고개를 젖히며 들썩
    this.head.rotation.set(-m * (0.12 + 0.08 * cackle) + gaze.y * -0.1, Math.sin(t * 0.7) * 0.18 * (1 - m) + gaze.x * 0.25, m * Math.sin(t * 9) * 0.06);
    this.head.position.y = m * cackle * 0.06;
  }
}

export function makeFace(level: string): Face | null {
  const look = LOOKS[level];
  return look ? new Face(look) : null;
}

// ───────────── DOM 캔버스용: 렌더러 하나로 화면의 모든 <canvas data-face> 를 그린다

const SVG: Record<string, string> = {
  easy: 'assets/bot-easy.svg',
  medium: 'assets/bot-medium.svg',
  hard: 'assets/bot-hard.svg',
  hell: 'assets/bot-hell.svg',
  king: 'assets/bot-king.svg',
};

type Slot = { scene: THREE.Scene; face: Face };
let stage: { r: THREE.WebGLRenderer; cam: THREE.PerspectiveCamera; close: THREE.PerspectiveCamera; pool: Map<string, Slot[]> } | null | undefined;

function getStage() {
  if (stage !== undefined) return stage;
  try {
    const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(192, 192, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    cam.position.set(0, 0.1, 7.4);
    cam.lookAt(0, 0.1, 0);
    // 작은 프로필 원 안에서는 얼굴만 크게
    const close = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    close.position.set(0, 0.05, 5);
    close.lookAt(0, 0.05, 0);
    stage = { r, cam, close, pool: new Map() };
    let last = performance.now();
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      drawAll(dt);
    };
    requestAnimationFrame(loop);
  } catch {
    stage = null;
  }
  return stage;
}

const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('pointermove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

/**
 * 같은 난이도 얼굴이 화면에 k 번째로 나오면 k 번째 슬롯을 쓴다 — 순위표가 innerHTML 로 자주 다시
 * 그려져 캔버스가 바뀌어도 얼굴(도형·표정 상태)은 새로 만들지 않고 이어서 쓴다.
 */
function slotFor(level: string, k: number): Slot {
  const st = stage!;
  const list = st.pool.get(level) ?? [];
  st.pool.set(level, list);
  if (!list[k]) {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6a5a6a, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(2, 3, 5);
    scene.add(key);
    const face = makeFace(level)!;
    scene.add(face.root);
    list[k] = { scene, face };
  }
  return list[k];
}

function drawAll(dt: number): void {
  const st = stage;
  if (!st) return;
  const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas[data-face]');
  if (!canvases.length) return;
  const seen = new Map<string, number>();
  for (const c of canvases) {
    const level = c.dataset.face!;
    if (!LOOKS[level]) continue;
    const q = c.getBoundingClientRect();
    if (!q.width) continue;
    const k = seen.get(level) ?? 0;
    seen.set(level, k + 1);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(q.width * dpr);
    if (c.width !== w || c.height !== w) c.width = c.height = w;
    const { scene, face } = slotFor(level, k);
    // 비웃음: data-mood="laugh" 이거나 마우스를 올린 순위 줄
    const laugh = c.dataset.mood === 'laugh' || !!c.closest('.stand:hover');
    const gx = Math.max(-1, Math.min(1, (mouse.x - (q.left + q.width / 2)) / 300));
    const gy = Math.max(-1, Math.min(1, -(mouse.y - (q.top + q.height / 2)) / 300));
    face.update(dt, laugh ? 1 : 0, { x: gx, y: gy });
    st.r.render(scene, c.classList.contains('avatar') ? st.close : st.cam);
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, w);
    g.drawImage(st.r.domElement, 0, 0, w, w);
  }
}

/** 얼굴 마크업: WebGL 이 되면 3D 캔버스, 안 되면 원래 SVG */
export function faceHtml(level: string, cls = '', mood = ''): string {
  if (getStage() && LOOKS[level]) return `<canvas class="${cls}" data-face="${level}"${mood ? ` data-mood="${mood}"` : ''} aria-hidden="true"></canvas>`;
  return `<img class="${cls}" src="${SVG[level] ?? SVG.medium}" alt="" />`;
}
