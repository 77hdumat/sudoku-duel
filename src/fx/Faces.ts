import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * AI 봇 3D 얼굴 (외부 모델 없이 three.js 기본 도형으로): 머리·눈·눈썹·입·소품을 따로 만들어
 * three.js 'morph targets - face' 예제처럼 표정을 움직인다 — 깜빡임, 봇마다 다른 시선, 마우스를 올리면
 * 꼬마봇은 부끄러워하고 스도봇은 당황하고 마스터봇은 씩 웃고 지옥봇은 불을 뿜고 변성대왕은 눈이 시뻘게져 피눈물을 흘리며 등 뒤로 불길이 솟는다.
 * 비웃을 때(변성대왕 도발)는 눈썹이 내려오고 눈을 가늘게 뜨며 입을 벌리고 크크크 들썩인다.
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
        blush.name = 'blush';
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
        // 굽은 뿔: 이마 위에서 바깥으로 뻗다가 끝이 위·안쪽으로 휜다. 마디는 앞 마디 끝에 이어 붙인다
        let x = s * 0.42;
        let y = 0.78;
        let r = 0.2;
        for (const [a, len] of [
          [0.75, 0.3],
          [0.3, 0.3],
          [-0.2, 0.28],
        ]) {
          const dx = s * Math.sin(a);
          const dy = Math.cos(a);
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, len, 14, 1, true), horn);
          seg.position.set(x + (dx * len) / 2, y + (dy * len) / 2, 0.2);
          seg.rotation.z = -s * a;
          g.add(seg);
          x += dx * len * 0.92;
          y += dy * len * 0.92;
          r *= 0.7;
        }
        const tip = new THREE.Mesh(new THREE.ConeGeometry(r, 0.2, 14), horn);
        tip.position.set(x + s * Math.sin(-0.35) * 0.1, y + Math.cos(-0.35) * 0.1, 0.2);
        tip.rotation.z = s * 0.35;
        g.add(tip);
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
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.04, 48), black);
      brim.position.y = 0.64;
      brim.rotation.x = 0.1;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.74, 0.9, 32), black);
      crown.position.y = 1.11;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), black);
      cap.scale.y = 0.3;
      cap.position.y = 1.56;
      g.add(cap);
      // 갓끈: 턱 아래로 늘어진 구슬 줄
      for (const s of [-1, 1])
        for (let k = 0; k < 6; k++) {
          const bead = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat(0x8a1c1c, { rough: 0.3 }));
          bead.position.set(s * (0.95 - k * 0.06), 0.5 - k * 0.27, 0.25 + k * 0.05);
          g.add(bead);
        }
      const gold = mat(0xd4a017, { metal: 0.85, rough: 0.25, emissive: 0x3a2800 });
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.745, 0.75, 0.14, 32), gold);
      band.position.y = 0.72;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.04), gold);
      plate.position.set(0, 1.14, 0.69);
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
      glyph.scale.setScalar(1.15);
      glyph.position.set(0, 1.14, 0.715);
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
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const RED_EYE = new THREE.Color(0xff1010);

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
  private scleras: THREE.MeshStandardMaterial[] = [];
  private brows: THREE.Mesh[] = [];
  private mouth = new THREE.Group();
  private blush: THREE.Object3D[] = [];
  private sweat?: THREE.Group;
  private fire: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];
  /** 변성대왕이 노려보면 눈에서 흐르는 피눈물: 볼을 따라 길어지는 줄기 + 떨어지는 방울 */
  private tears: THREE.Mesh[] = [];
  private drops: THREE.Mesh[] = [];
  private mood = 0;
  private hov = 0;
  private blinkAt = 1 + Math.random() * 3;

  constructor(
    private readonly look: Look,
    private readonly kind: string,
  ) {
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
      const scleraMat = mat(L.sclera, { emissive: L.glow ? L.sclera : 0, rough: 0.2 });
      const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 16), scleraMat);
      sclera.scale.z = 0.55;
      this.scleras.push(scleraMat);
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
    this.blush = this.head.children.filter((o) => o.name === 'blush');

    // 스도봇이 당황하면 관자놀이에 흐르는 땀방울
    if (kind === 'medium') {
      const water = mat(0x7fd3ff, { emissive: 0x1a5f8a, rough: 0.1 });
      const drop = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), water);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.2, 16), water);
      tip.position.y = 0.13;
      this.sweat = new THREE.Group();
      this.sweat.add(drop, tip);
      this.sweat.visible = false;
      this.head.add(this.sweat);
    }
    // 지옥봇이 뿜는 불: 입에서 앞으로 퍼지며 노랑 → 빨강으로 식는 알갱이
    if (kind === 'hell') {
      const ball = new THREE.SphereGeometry(1, 10, 8);
      for (let k = 0; k < 26; k++) {
        const p = new THREE.Mesh(ball, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        p.userData = { dx: (Math.random() - 0.5) * 1.2, dy: (Math.random() - 0.5) * 0.7, k: k / 26 };
        p.visible = false;
        this.mouth.add(p);
        this.fire.push(p);
      }
    }
    // 변성대왕: 머리 뒤로 솟는 검붉은 불길 + 피눈물
    if (kind === 'king') {
      const ball = new THREE.SphereGeometry(1, 10, 8);
      for (let k = 0; k < 70; k++) {
        const p = new THREE.Mesh(ball, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        p.userData = { x: (Math.random() - 0.5) * 3.4, z: -0.1 - Math.random() * 0.5, k: Math.random() };
        p.visible = false;
        this.head.add(p);
        this.fire.push(p);
      }
      const blood = mat(0xb0000c, { emissive: 0x500000, rough: 0.15 });
      for (const s of [-1, 1]) {
        const tear = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 1, 4, 8), blood);
        tear.position.set(s * 0.38, 0, 0.86);
        tear.visible = false;
        this.head.add(tear);
        this.tears.push(tear);
        for (let k = 0; k < 4; k++) {
          const d = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), blood);
          d.scale.y = 1.6;
          d.userData = { s, k: k / 4 };
          d.visible = false;
          this.head.add(d);
          this.drops.push(d);
        }
      }
    }
  }

  /**
   * 매 프레임: hover 0..1 = 마우스를 올렸을 때 봇마다 다른 반응, laugh 0..1 = 비웃으며 크크크 (변성대왕 도발).
   * gaze = 마우스 방향(-1..1). 평소에도 봇마다 바라보는 곳이 다르다.
   */
  update(dt: number, hover: number, gaze = { x: 0, y: 0 }, laugh = 0): void {
    const L = this.look;
    const t = (performance.now() - t0) / 1000;
    const ease = Math.min(1, dt * 7);
    this.mood += (laugh - this.mood) * ease;
    this.hov += (hover - this.hov) * Math.min(1, dt * 4);
    const m = this.mood;
    const h = this.hov * (1 - m);
    const cackle = Math.abs(Math.sin(t * 17));
    const away = gaze.x > 0 ? -1 : 1;

    // 평소: 눈동자(ex, ey)와 고개(rx 끄덕, ry 도리, rz 갸웃), 통통(bob)
    let ex = gaze.x;
    let ey = gaze.y;
    let rx = 0;
    let ry = Math.sin(t * 0.7) * 0.18;
    let rz = 0;
    let bob = 0;
    let open = 1;
    let mouthY = L.smile < 0 ? 0.08 : L.smile;
    let mouthX = 1;
    let mouthTilt = L.anger > 0.4 ? 0.12 : 0;
    let blink = true;
    switch (this.kind) {
      case 'easy': {
        // 꼬마봇: 두리번두리번 + 통통, 고개를 갸웃 → 부끄러워 고개를 돌리고 숙이며 눈을 질끈, 볼이 빨개진다
        ex = mix(mix(Math.sin(t * 0.9) * 0.8, gaze.x, 0.5), away * 0.9, h);
        ey = mix(mix(Math.cos(t * 0.6) * 0.4, gaze.y, 0.5), -0.8, h);
        ry = mix(ex * 0.3, away * 0.55, h);
        rx = mix(0, 0.28, h);
        rz = mix(Math.sin(t * 1.5) * 0.06, away * 0.15, h);
        bob = Math.abs(Math.sin(t * 3)) * 0.04 * (1 - h);
        open = mix(1, 0.3, h);
        mouthY = mix(mouthY, 0.12, h);
        mouthX = mix(1, 0.5, h);
        for (const b of this.blush) b.scale.set(1 + h * 0.5, 0.55 + h * 0.45, 0.3);
        break;
      }
      case 'medium': {
        // 스도봇: 안경 너머 아래쪽 책을 읽다 가끔 올려다봄 → 당황해 눈이 커지고 움찔 물러나며 입은 '어?', 땀 삐질
        ex = mix(mix(-0.5, gaze.x, 0.35), gaze.x * 0.4, h);
        ey = mix(mix(-0.7, gaze.y, 0.35), 0.1, h);
        rx = mix(0.12, -0.1, h);
        ry = ex * 0.15;
        rz = -0.08 * h;
        open = 1 + 0.35 * h;
        mouthY = mix(mouthY, 0.35, h);
        mouthX = mix(1, 0.45, h);
        mouthTilt = 0;
        if (this.sweat) {
          this.sweat.visible = h > 0.05;
          this.sweat.scale.setScalar(h);
          this.sweat.position.set(0.8, 0.55 - ((t * 0.7) % 1) * 0.45, 0.62);
        }
        break;
      }
      case 'hard': {
        // 마스터봇: 턱을 살짝 들고 정면을 내려다봄 → 당차게 턱을 치켜들고 한쪽 입꼬리를 올려 씩
        ex = gaze.x * 0.6;
        ey = mix(0.25 + gaze.y * 0.3, gaze.y * 0.5, h);
        rx = mix(-0.06, -0.24, h);
        ry = mix(Math.sin(t * 0.5) * 0.1 + ex * 0.2, gaze.x * 0.3, h);
        rz = mix(0, 0.1, h);
        open = mix(1, 0.75, h);
        mouthY = mix(mouthY, 0.3, h);
        mouthX = mix(1, 0.85, h);
        mouthTilt = mix(mouthTilt, 0.35, h);
        break;
      }
      case 'hell': {
        // 지옥봇: 눈을 이리저리 굴리며 흘끔 → 고개를 젖히고 입을 쩍 벌려 불을 뿜는다
        const dart = Math.tanh(Math.sin(t * 1.3) * 4) * 0.8;
        ex = mix(mix(dart, gaze.x, 0.3), gaze.x, h);
        ey = mix(-0.15, gaze.y, h);
        ry = mix(ex * 0.15 + Math.sin(t * 0.6) * 0.1, gaze.x * 0.2, h);
        rx = mix(0, -0.18, h);
        open = 1 + 0.2 * h;
        mouthY = mix(mouthY, 1.15, h);
        mouthX = 1 + 0.2 * h;
        mouthTilt = mix(mouthTilt, 0, h);
        for (const p of this.fire) {
          const { dx, dy, k } = p.userData as { dx: number; dy: number; k: number };
          const life = (t * 1.8 + k) % 1;
          p.visible = h > 0.03;
          p.position.set(dx * life * 1.3, -0.12 + dy * life * 0.8 + life * 0.25, 0.1 + life * 3.2);
          p.scale.setScalar((0.1 + life * 0.5) * h);
          p.material.color.setHSL(0.14 - life * 0.14, 1, 0.62 - life * 0.17);
          p.material.opacity = (1 - life) * h;
        }
        break;
      }
      case 'king': {
        // 변성대왕: 꼼짝 않고 늘 너를 본다 → 눈이 시뻘겋게 타오르고, 표정 없이 입을 꾹 다문 채 정면으로 노려본다
        ex = gaze.x;
        ey = gaze.y;
        ry = mix(gaze.x * 0.08, gaze.x * 0.3, h);
        rx = mix(0, 0.1 - gaze.y * 0.15, h);
        open = mix(1, 0.85, h);
        mouthY = mix(mouthY, 0.025, h);
        mouthTilt = mix(mouthTilt, 0, h);
        blink = h < 0.5;
        for (const sm of this.scleras) {
          sm.color.setHex(L.sclera).lerp(RED_EYE, h);
          sm.emissive.setHex(L.sclera).lerp(RED_EYE, h);
          sm.emissiveIntensity = 1.2 + h * 2.5;
        }
        for (const iris of this.irises) iris.scale.setScalar(1 - h * 0.35);
        // 뒤에서 불길이 치솟는다: 아래에서 위로 오르며 주황 → 검붉게 식고 가늘어진다
        for (const p of this.fire) {
          const { x, z, k } = p.userData as { x: number; z: number; k: number };
          const life = (t * 0.9 + k) % 1;
          p.visible = h > 0.03;
          p.position.set(x * (1 - life * 0.5) + Math.sin(t * 6 + k * 20) * 0.1, -1.2 + life * 3.6, z);
          p.scale.set((0.5 - life * 0.35) * h, (0.7 - life * 0.4) * h, 0.4 * h);
          p.material.color.setHSL(0.05 - life * 0.05, 1, 0.42 - life * 0.25);
          p.material.opacity = Math.sin(life * Math.PI) * h * 0.5;
        }
        // 피눈물: 눈 밑에서 줄기가 볼을 타고 내려가고, 끝에서 방울이 떨어진다
        const len = h * 0.75;
        for (const tear of this.tears) {
          tear.visible = h > 0.03;
          tear.scale.y = Math.max(0.01, len);
          tear.position.y = 0.0 - (len * 1.07) / 2;
          tear.position.z = 0.86 - len * 0.18;
        }
        for (const d of this.drops) {
          const { s, k } = d.userData as { s: number; k: number };
          const life = (t * 0.8 + k) % 1;
          d.visible = h > 0.5;
          d.position.set(s * 0.38, -len * 1.07 - life * 1.1, 0.86 - len * 0.36 - life * 0.1);
          d.scale.set(h, 1.6 * h, h);
        }
        break;
      }
    }

    // 깜빡임 (비웃는 중엔 가늘게 뜬 채로)
    this.blinkAt -= dt;
    let lid = 1;
    if (this.blinkAt < 0 && blink) {
      lid = Math.min(1, Math.abs(this.blinkAt + 0.07) / 0.07);
      if (this.blinkAt < -0.14) this.blinkAt = 2 + Math.random() * 3;
    }
    const squint = 1 - 0.5 * Math.max(m, L.anger * 0.4);
    for (const e of this.eyes) e.scale.y = Math.max(0.08, lid * squint * open);
    for (const iris of this.irises) iris.position.set(ex * 0.06, ey * 0.05, 0.11);

    // 눈썹: 안쪽 끝이 내려가면 화난 얼굴. 마스터봇은 씩 웃을 때 한쪽 눈썹을 치켜든다
    const anger = Math.min(1, L.anger + m * 0.7 + (this.kind === 'king' ? h * 0.3 : 0));
    this.brows.forEach((b, k) => {
      const s = k ? 1 : -1;
      const cocky = this.kind === 'hard' && k === 0 ? h : 0;
      b.rotation.z = s * anger * 0.5 * (1 - cocky * 1.4);
      b.position.y = 0.47 - anger * 0.08 + (1 - anger) * m * 0.05 + cocky * 0.14;
    });

    // 입: 봇마다 평소 모양 → 비웃으면 크게 벌리고 들썩
    this.mouth.scale.set(mouthX + m * 0.15, mix(mouthY, 0.55 + 0.35 * cackle, m), 1);
    this.mouth.rotation.z = (1 - m) * mouthTilt;

    // 머리: 웃을 땐 고개를 젖히며 들썩
    this.head.rotation.set(mix(rx + ey * -0.1, -(0.12 + 0.08 * cackle), m), mix(ry + ex * 0.1, Math.sin(t * 9) * 0.06, m), mix(rz, Math.sin(t * 9) * 0.06, m));
    this.head.position.y = bob + m * cackle * 0.06;
  }
}

export function makeFace(level: string): Face | null {
  const look = LOOKS[level];
  return look ? new Face(look, level) : null;
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
    // 비웃음: data-mood="laugh". 마우스를 올린 순위 줄이면 봇마다 다른 호버 반응
    const laugh = c.dataset.mood === 'laugh';
    const hover = !!c.closest('.stand:hover');
    const gx = Math.max(-1, Math.min(1, (mouse.x - (q.left + q.width / 2)) / 300));
    const gy = Math.max(-1, Math.min(1, -(mouse.y - (q.top + q.height / 2)) / 300));
    face.update(dt, hover ? 1 : 0, { x: gx, y: gy }, laugh ? 1 : 0);
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
