/**
 * Web Audio 합성 효과음 — 파일·라이선스 없이 오프라인에서도 동작.
 * 브라우저 정책상 첫 사용자 입력 뒤에야 소리가 난다 (AudioContext 는 그때 만든다).
 */

type Wave = OscillatorType;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ac(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** 음 하나: 짧은 어택 + 지수 감쇠 */
function tone(freq: number, at: number, dur: number, wave: Wave = 'triangle', vol = 0.5, slideTo?: number): void {
  const a = ac();
  if (!a || !master) return;
  const t0 = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = wave;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;

/** 짧은 잡음 (침 뱉는 소리 '퉤') — 대역통과로 음색을 잡는다 */
function noise(at: number, dur: number, freq: number, q: number, vol: number): void {
  const a = ac();
  if (!a || !master) return;
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = a.currentTime + at;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(freq, t0);
  f.frequency.exponentialRampToValueAtTime(freq * 0.4, t0 + dur);
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

/** 반음 n 개 위 */
const st = (base: number, n: number) => base * 2 ** (n / 12);
const C5 = 523.25;

const calm = {
  /** 첫 클릭 때 오디오를 깨워 둔다 */
  unlock(): void {
    ac();
    // 변성대왕 녹음을 미리 받아 둔다 — 카운트다운 첫 소리부터 녹음으로 나오게
    SAMPLES.forEach(load);
  },

  click(): void {
    tone(st(C5, 12), 0, 0.05, 'sine', 0.18);
  },
  select(): void {
    tone(st(C5, 7), 0, 0.04, 'sine', 0.08);
  },
  note(): void {
    tone(st(C5, 19), 0, 0.06, 'sine', 0.12);
  },
  /** 정답: 연속으로 맞힐수록 한 음씩 올라간다 */
  correct(combo = 0): void {
    const b = st(C5, Math.min(combo, 12));
    tone(b, 0, 0.12, 'triangle', 0.4);
    tone(st(b, 4), 0.06, 0.12, 'triangle', 0.35);
    tone(st(b, 7), 0.12, 0.22, 'sine', 0.35);
  },
  /** 다른 사람이 칸을 가져감 (점령형) */
  claimOther(): void {
    tone(st(C5, -5), 0, 0.1, 'sine', 0.18);
  },
  /** 콤보 한 칸 오를 때 */
  comboUp(n: number): void {
    tone(st(C5, 12 + n * 4), 0, 0.08, 'square', 0.12);
  },
  /** 공격 발사 — 휘익 */
  whoosh(): void {
    noise(0, 0.35, 2400, 1.2, 0.35);
    tone(st(C5, 7), 0, 0.3, 'sine', 0.15, st(C5, 19));
  },
  /** 침 맞음 — 퉤! */
  spit(): void {
    noise(0, 0.12, 1800, 2.5, 0.9);
    noise(0.05, 0.25, 700, 1.5, 0.6);
    tone(180, 0.02, 0.18, 'sine', 0.35, 90);
  },
  wrong(): void {
    tone(220, 0, 0.18, 'square', 0.18, 140);
    tone(160, 0.08, 0.22, 'sawtooth', 0.12, 100);
  },
  /** 행·열·박스 완성 */
  line(): void {
    [0, 4, 7, 12, 16].forEach((n, i) => tone(st(C5, n + 5), i * 0.05, 0.25, 'triangle', 0.3));
  },
  hint(): void {
    [0, 7, 12, 19, 24].forEach((n, i) => tone(st(C5, n + 2), i * 0.04, 0.3, 'sine', 0.22));
  },
  countdown(last = false): void {
    tone(last ? st(C5, 12) : C5, 0, last ? 0.35 : 0.15, 'square', 0.14);
  },
  chat(): void {
    tone(st(C5, 9), 0, 0.06, 'sine', 0.15);
    tone(st(C5, 14), 0.06, 0.08, 'sine', 0.15);
  },
  join(): void {
    tone(st(C5, 0), 0, 0.1, 'triangle', 0.2);
    tone(st(C5, 7), 0.08, 0.14, 'triangle', 0.2);
  },
  win(): void {
    const seq = [0, 4, 7, 12, 7, 12, 16, 19];
    seq.forEach((n, i) => tone(st(C5, n), i * 0.1, i === seq.length - 1 ? 0.6 : 0.16, 'triangle', 0.35));
    seq.forEach((n, i) => tone(st(C5, n - 12), i * 0.1, 0.16, 'sine', 0.2));
  },
  /** 변성대왕이 비웃을 때 · 숫자 칸에서 불이 솟을 때 · 다 풀고 판이 타오를 때 (평소 화면엔 없음) */
  laugh(): void {},
  fire(): void {},
  inferno(): void {},
  lose(): void {
    [7, 4, 0, -5].forEach((n, i) => tone(st(C5, n), i * 0.16, i === 3 ? 0.5 : 0.18, 'triangle', 0.28));
  },
};

/**
 * 변성대왕 녹음 소리 (public/assets/sfx, Pixabay Content License — 앞부분만 잘라 모노로 줄였다):
 * gong = Asian Gong (freesound_community, 102397) · heartbeat = Heartbeat Single (universfield, 383748)
 * bone = Bone Crack 1 (freesound_community, 84755) · growl = Monster Growl (dragon-studio, 376892)
 * bell = Single Church Bell 2 (universfield, 352062)
 * laugh = Evil Laugh (dragon-studio, 431480) · cackle = Evil Laugh (freesound_community, 89423)
 * choir = Dark Choir Singing (freesound_community, 16805)
 * fire = Fire Ignite Whoosh (biww, 561960) · inferno = Big Fire Blast Whoosh (biww, 561961)
 */
const SAMPLES = ['gong', 'heartbeat', 'bone', 'growl', 'bell', 'laugh', 'cackle', 'choir', 'fire', 'inferno'];
const buffers = new Map<string, AudioBuffer | null>();

function load(name: string): void {
  const a = ac();
  if (!a || buffers.has(name)) return;
  buffers.set(name, null);
  fetch(`assets/sfx/${name}.mp3`)
    .then((r) => r.arrayBuffer())
    .then((b) => a.decodeAudioData(b))
    .then((buf) => buffers.set(name, buf))
    .catch(() => buffers.delete(name));
}

/** 받아 둔 녹음을 튼다. 아직 못 받았으면 false — 그땐 합성음으로 대신한다 */
function sample(name: string, vol = 1): boolean {
  const a = ac();
  const buf = buffers.get(name);
  if (!a || !master || !buf) {
    load(name);
    return false;
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(g).connect(master);
  src.start();
  return true;
}

/** 종소리: 사인 + 비정수배 배음 — 장례식 종처럼 길게 울린다 */
function bell(freq: number, at: number, dur: number, vol: number): void {
  tone(freq, at, dur, 'sine', vol);
  tone(freq * 2.76, at, dur * 0.6, 'sine', vol * 0.35);
  tone(freq * 5.4, at, dur * 0.3, 'sine', vol * 0.12);
}

/** 변성대왕 화면: 같은 자리에서 나는 소리를 낮고 불길하게 (단조·감화음·종·으르렁) */
const dreadful: Partial<typeof calm> = {
  click(): void {
    tone(120, 0, 0.09, 'sine', 0.3, 70);
    noise(0, 0.06, 400, 1, 0.25);
  },
  select(): void {
    tone(st(C5, -24), 0, 0.06, 'sine', 0.1);
  },
  note(): void {
    noise(0, 0.07, 3200, 5, 0.14);
  },
  correct(combo = 0): void {
    if (sample('bone', 0.9)) return;
    const b = st(C5, -19 + Math.min(combo, 12));
    bell(b, 0, 0.9, 0.32);
    tone(st(b, 6), 0.05, 0.5, 'triangle', 0.12);
  },
  wrong(): void {
    if (sample('growl', 1.1)) return;
    tone(95, 0, 0.6, 'sawtooth', 0.22, 42);
    tone(101, 0, 0.6, 'sawtooth', 0.16, 45);
    noise(0, 0.5, 180, 0.8, 0.5);
  },
  line(): void {
    if (sample('bell', 0.8)) return;
    [12, 9, 6, 3, 0].forEach((n, i) => tone(st(C5, n - 12), i * 0.09, 0.45, 'triangle', 0.26));
    bell(st(C5, -24), 0.45, 1.4, 0.3);
  },
  // 힌트·풀이·자동 메모는 따로 소리 없이 — 정답 칸에서 솟는 불 소리만
  hint(): void {},
  countdown(last = false): void {
    // 시작 신호는 징, 그 전엔 심장 소리
    if (sample(last ? 'gong' : 'heartbeat', last ? 1 : 1.2)) return;
    bell(last ? 98 : 73.4, 0, last ? 2 : 0.9, 0.42);
  },
  win(): void {
    if (sample('choir', 1)) return;
    // 단조 오르간 — 이겼어도 축하보다 '살아남았다'
    [0, 3, 7, 12, 15, 19].forEach((n, i) => tone(st(C5, n - 24), i * 0.18, i === 5 ? 1.6 : 0.5, 'sawtooth', 0.12));
    bell(st(C5, -24), 1.0, 2.2, 0.35);
  },
  laugh(): void {
    sample('cackle', 1);
  },
  fire(): void {
    if (!sample('fire', 0.7)) noise(0, 0.5, 600, 0.6, 0.35);
  },
  inferno(): void {
    if (!sample('inferno', 1)) noise(0, 1.5, 400, 0.5, 0.6);
  },
  lose(): void {
    if (sample('laugh', 1)) return;
    // 낮게 끌리는 크크크
    for (let i = 0; i < 5; i++) tone(st(C5, -14 - i * 2), i * 0.17, 0.15, 'sawtooth', 0.2, st(C5, -18 - i * 2));
    noise(0, 1.2, 140, 0.7, 0.45);
  },
};

let dread = false;

export const sfx = Object.fromEntries(
  Object.entries(calm).map(([k, f]) => [k, (...args: never[]) => ((dread && dreadful[k as keyof typeof calm]) || f)(...(args as [never]))]),
) as typeof calm & { setDread(on: boolean): void };
/** 변성대왕 게임 화면이면 무서운 소리로 */
sfx.setDread = (on: boolean) => {
  dread = on;
  if (on) SAMPLES.forEach(load);
};
