/**
 * Web Audio 합성 효과음 — 파일·라이선스 없이 오프라인에서도 동작.
 * 브라우저 정책상 첫 사용자 입력 뒤에야 소리가 난다 (AudioContext 는 그때 만든다).
 */

type Wave = OscillatorType;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try {
  muted = localStorage.getItem('muted') === '1';
} catch {
  /* 기본값 유지 */
}

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
  if (!a || !master || muted) return;
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
  if (!a || !master || muted) return;
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

export const sfx = {
  get muted(): boolean {
    return muted;
  },
  setMuted(m: boolean): void {
    muted = m;
    try {
      localStorage.setItem('muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
  },
  /** 첫 클릭 때 오디오를 깨워 둔다 */
  unlock(): void {
    ac();
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
  lose(): void {
    [7, 4, 0, -5].forEach((n, i) => tone(st(C5, n), i * 0.16, i === 3 ? 0.5 : 0.18, 'triangle', 0.28));
  },
};
