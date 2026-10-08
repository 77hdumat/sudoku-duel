import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * AI 봇 3D 얼굴: RobotExpressive (Tomás Laulhé, CC0 1.0 — three.js 예제 모델, public/assets/models)의 머리만 남겨
 * 난이도마다 색을 입히고 소품(안테나·안경·왕관·뿔·갓)을 머리 뼈에 붙인다.
 * 가만히 있으면 Idle, 마우스를 올리면 화난 얼굴(Angry 모프)로 Yes 동작을 빠르게 — 킬킬 비웃는 느낌.
 */

type Look = { main: number; grey: number; eye: number; angry: number; extra: (g: THREE.Group, head: Head) => void };

const std = (color: number, emissive = 0, metal = 0.2) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: emissive ? 1.4 : 0, roughness: 0.45, metalness: metal });

// 소품 좌표는 머리 크기 기준: 머리 너비 = 1, 가운데 = 원점, 정수리 y = top, 얼굴 앞면 z = front
type Head = { top: number; front: number };
const LOOKS: Record<string, Look> = {
  easy: {
    main: 0x7fd38a,
    grey: 0xe8f5e9,
    eye: 0,
    angry: 0,
    extra(g, { top }) {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.32), std(0x9e9e9e));
      stick.position.set(0, top + 0.16, 0);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), std(0xffc23d, 0xff9a00));
      ball.position.set(0, top + 0.36, 0);
      g.add(stick, ball);
    },
  },
  medium: {
    main: 0x5b8fd6,
    grey: 0xe3ecf8,
    eye: 0,
    angry: 0,
    extra(g, { front }) {
      const m = std(0x222831, 0, 0.6);
      for (const x of [-0.22, 0.22]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 8, 24), m);
        ring.position.set(x, 0.02, front + 0.04);
        g.add(ring);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.03), m);
      bridge.position.set(0, 0.05, front + 0.04);
      g.add(bridge);
    },
  },
  hard: {
    main: 0x3b3f4a,
    grey: 0x5a5f6b,
    eye: 0xff3048,
    angry: 0.5,
    extra(g, { top }) {
      const gold = std(0xf2c230, 0x5a3c00, 0.8);
      for (let k = -2; k <= 2; k++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.26, 4), gold);
        spike.position.set(k * 0.17, top + 0.2, 0);
        g.add(spike);
      }
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.48, 0.12, 24), gold);
      band.position.set(0, top + 0.04, 0);
      g.add(band);
    },
  },
  hell: {
    main: 0xa3161f,
    grey: 0x4a0b10,
    eye: 0xffd400,
    angry: 1,
    extra(g, { top }) {
      const horn = std(0xf3e6c8, 0, 0.1);
      for (const s of [-1, 1]) {
        const h = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.45, 12), horn);
        h.position.set(s * 0.36, top + 0.14, 0);
        h.rotation.z = -s * 0.5;
        g.add(h);
      }
    },
  },
  king: {
    main: 0x253228,
    grey: 0x121814,
    eye: 0xff2020,
    angry: 1,
    extra(g, { top }) {
      // 저승 시왕의 검은 갓 + 금빛 테
      const black = std(0x111111, 0, 0.3);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.04, 32), black);
      brim.position.set(0, top + 0.02, 0);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.42, 24), black);
      crown.position.set(0, top + 0.24, 0);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.08, 24), std(0xd4a017, 0x3a2800, 0.8));
      band.position.set(0, top + 0.08, 0);
      g.add(brim, crown, band);
    },
  },
};

let gltf: Promise<GLTF> | null = null;

/** 상반신만 남긴 봇. 처음 부를 때 모델을 내려받는다 (실패하면 null — 2D 얼굴 그대로) */
export async function makeBot(level: string): Promise<Bot | null> {
  const look = LOOKS[level];
  if (!look) return null;
  gltf ??= new GLTFLoader().loadAsync('assets/models/RobotExpressive.glb');
  try {
    return new Bot(await gltf, look);
  } catch {
    return null;
  }
}

export class Bot {
  readonly root = new THREE.Group();
  /** 보이는 부분(머리+소품)의 높이 — 그림 칸 높이를 이 값으로 나눈 만큼 키운다 */
  readonly height: number;
  /** 뒤로 튀어나온 깊이 — 버튼 윗면에 파묻히지 않게 이만큼 앞으로 띄운다 */
  readonly back: number;
  private mixer: THREE.AnimationMixer;
  private idle: THREE.AnimationAction;
  private laugh: THREE.AnimationAction;
  /** 머리 메시들 (재질마다 Head, Head_1 … 로 나뉘어 있다) */
  private heads: THREE.Mesh[] = [];
  private calm: number;
  private hover = 0;

  constructor(src: GLTF, look: Look) {
    const model = clone(src.scene);
    const mats = new Map<string, THREE.Material>();
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      // 얼굴만 (버튼 얼굴 자리에 크게 들어가게) — 몸통·팔다리는 숨긴다
      if (/^Head(_\d+)?$/.test(o.name)) this.heads.push(o);
      else o.visible = false;
      const name = (o.material as THREE.Material).name;
      if (!mats.has(name)) {
        const m = (o.material as THREE.MeshStandardMaterial).clone();
        if (name === 'Main') m.color.set(look.main);
        if (name === 'Grey') m.color.set(look.grey);
        if (name === 'Black' && look.eye) {
          m.emissive.set(look.eye);
          m.emissiveIntensity = 0.6;
        }
        mats.set(name, m);
      }
      o.material = mats.get(name)!;
      o.frustumCulled = false;
    });
    // 머리 크기를 재서 그 기준으로 소품을 만들고, 머리 뼈에 붙여 고개를 끄덕일 때 같이 움직이게
    model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const h of this.heads) box.expandByObject(h, true);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const w = size.x;
    const acc = new THREE.Group();
    look.extra(acc, { top: size.y / 2 / w, front: size.z / 2 / w });
    acc.scale.setScalar(w);
    acc.position.copy(center);
    model.add(acc);
    acc.updateMatrixWorld(true);
    let bone: THREE.Object3D | undefined;
    model.traverse((o) => (o as THREE.Bone).isBone && o.name === 'Head' && (bone = o));
    bone?.attach(acc);
    // 머리(+소품)가 버튼 얼굴 자리를 꽉 채우게: 머리 가운데를 원점보다 살짝 아래로
    model.position.set(-center.x, -center.y - size.y * 0.15, -center.z);
    this.height = size.y * 1.6;
    this.back = Math.max(size.x, size.z) * 0.8;
    this.root.add(model);

    this.calm = look.angry;
    this.mixer = new THREE.AnimationMixer(model);
    const clip = (n: string) => THREE.AnimationClip.findByName(src.animations, n);
    this.idle = this.mixer.clipAction(clip('Idle')).play();
    this.laugh = this.mixer.clipAction(clip('Yes'));
    this.laugh.timeScale = 2.2;
    this.laugh.setEffectiveWeight(0).play();
  }

  /** 매 프레임: over = 마우스가 올라가 있는지 */
  update(dt: number, over: boolean): void {
    this.hover += ((over ? 1 : 0) - this.hover) * Math.min(1, dt * 8);
    this.idle.setEffectiveWeight(1 - this.hover);
    this.laugh.setEffectiveWeight(this.hover);
    this.mixer.update(dt);
    const angry = this.calm + (1 - this.calm) * this.hover;
    for (const h of this.heads) if (h.morphTargetInfluences && h.morphTargetDictionary) h.morphTargetInfluences[h.morphTargetDictionary.Angry] = angry;
    // 비웃을 때 살짝 몸을 돌린다
    this.root.rotation.y = Math.sin(performance.now() / 900) * 0.25 * (1 - this.hover) + this.hover * 0.15;
  }
}
