import { grade, type Tier } from './Grade';
import KING_BANK from './kingBank.json';
import KING_BANK6 from './kingBank6.json';

/** 1차원 격자 (9×9 = 81칸, 6×6 = 36칸). 0 = 빈칸 */
export type Grid = number[];
export type Level = 'easy' | 'medium' | 'hard' | 'hell' | 'king';

/**
 * 남길 힌트 수. 니코리 관례대로 초급일수록 힌트를 많이 준다.
 * 유일해·대칭을 지키며 지우다 보면 목표보다 몇 개 더 남을 수 있다 (16개 이하는 유일해가 불가능)
 * tier = 끝까지 푸는 데 꼭 필요한 기술 단계 (Grade.ts). 힌트 수만으로는 난이도가 갈리지 않아 판마다 채점한다
 */
export const LEVELS: Record<Level, { label: string; clues: number; tier: Tier }> = {
  easy: { label: '초급', clues: 46, tier: 0 },
  medium: { label: '중급', clues: 32, tier: 1 },
  hard: { label: '고급', clues: 26, tier: 2 },
  hell: { label: '지옥', clues: 22, tier: 3 },
  // 지옥·변성대왕 clues 는 사실상 '바닥까지' — 대칭을 지키며 깎으면 보통 25~30개에서 더 못 지운다
  // tier 4(AIC 한두 번이면 풀리는 판)는 어느 난이도에도 안 쓴다 — 변성대왕으로는 쉽고 지옥으로는 어렵다
  king: { label: '변성대왕', clues: 20, tier: 5 },
};

/** 한 판에 플레이어마다 쓸 수 있는 힌트 수 */
export const HINTS = 3;

/** 판 크기: 9×9 (3×3 박스) 또는 6×6 (가로 3 × 세로 2 박스) */
export type Size = 6 | 9;
export const SIZES: Size[] = [9, 6];

/** 고를 수 있는 난이도 — 6×6 도 지옥(1.6%)·변성대왕(판 은행)까지 다 된다 */
export const levelsFor = (_size: Size): Level[] => Object.keys(LEVELS) as Level[];

/** 자동 메모: 9×9 는 지옥부터, 6×6 은 고급에서 */
export const autoNotesFor = (level: Level, size: Size): boolean => LEVELS[level].tier >= 3 || (size === 6 && level === 'hard');

/**
 * 6×6 남길 힌트 수. 6×6 은 97% 가 드러난/숨겨진 하나만으로 풀려서 초급·중급은 힌트 수로 가르고,
 * 고급은 그보다 어려운 기술(교차로·부분집합·윙 …)이 꼭 필요한 판, 지옥은 중급 사슬이 꼭 필요한 판(tier 3)을 고른다.
 * 변성대왕은 판 은행(tier 4 이상 — AIC 가 필요하거나 그걸로도 막힘)에서 꺼낸다
 */
const CLUES6: Partial<Record<Level, number>> = { easy: 20, medium: 12, hard: 8, hell: 8 };

/** 판 크기별 칸 관계. grid 길이(36 / 81)로 찾는다 */
export interface Geo {
  n: number;
  cells: number;
  /** 숫자 1~n 전부의 비트마스크 */
  all: number;
  /** 행 n · 열 n · 박스 n */
  units: number[][];
  /** 칸마다 같은 행·열·박스에 있는 다른 칸 */
  peers: number[][];
  isPeer: boolean[][];
  boxOf: number[];
}

const GEOS = new Map<number, Geo>();

export function geo(cells: number): Geo {
  let G = GEOS.get(cells);
  if (G) return G;
  const n = Math.sqrt(cells);
  const bh = n === 6 ? 2 : 3;
  const bw = n / bh;
  const boxOf = Array.from({ length: cells }, (_, i) => Math.floor(Math.floor(i / n) / bh) * (n / bw) + Math.floor((i % n) / bw));
  const units = [
    ...Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => r * n + c)),
    ...Array.from({ length: n }, (_, c) => Array.from({ length: n }, (_, r) => r * n + c)),
    ...Array.from({ length: n }, (_, b) => [...Array(cells).keys()].filter((i) => boxOf[i] === b)),
  ];
  const peers = Array.from({ length: cells }, (_, i) => [...new Set(units.filter((u) => u.includes(i)).flat())].filter((p) => p !== i));
  const isPeer = peers.map((ps) => {
    const row = new Array(cells).fill(false);
    for (const p of ps) row[p] = true;
    return row;
  });
  G = { n, cells, all: (1 << n) - 1, units, peers, isPeer, boxOf };
  GEOS.set(cells, G);
  return G;
}

/** 칸 i 에 놓을 수 있는 숫자 비트마스크 (bit v-1) */
export function candidates(g: Grid, i: number): number {
  const G = geo(g.length);
  let used = 0;
  for (const p of G.peers[i]) if (g[p]) used |= 1 << (g[p] - 1);
  return ~used & G.all;
}

/**
 * 답이 될 수 없는 메모를 지운다: 맞게 채운 칸(주어진 칸 포함)은 메모 없음,
 * 빈칸·틀린 숫자 칸은 같은 행·열·박스에 맞게 놓인 숫자를 메모에서 뺀다.
 * 틀린 숫자는 기준으로 삼지 않는다.
 */
export function pruneNotes(grid: Grid, solution: Grid, notes: number[]): void {
  const known = grid.map((v, i) => (v === solution[i] ? v : 0));
  for (let i = 0; i < grid.length; i++) notes[i] = known[i] ? 0 : notes[i] & candidates(known, i);
}

export function bitCount(m: number): number {
  let n = 0;
  for (; m; m &= m - 1) n++;
  return n;
}

/**
 * 백트래킹(후보가 가장 적은 칸부터). limit 개 해를 찾으면 멈춘다.
 * out 을 주면 첫 해를 채워 준다. rand 를 주면 숫자 시도 순서를 섞는다(랜덤 완성판용).
 */
function search(g: Grid, limit: number, out?: Grid, rand?: () => number): number {
  const a = g.slice();
  let found = 0;
  const rec = (): boolean => {
    let best = -1;
    let bestMask = 0;
    let bestCnt = 10;
    for (let i = 0; i < a.length; i++) {
      if (a[i]) continue;
      const m = candidates(a, i);
      const n = bitCount(m);
      if (n === 0) return false;
      if (n < bestCnt) {
        best = i;
        bestMask = m;
        bestCnt = n;
        if (n === 1) break;
      }
    }
    if (best === -1) {
      found++;
      if (out && found === 1) out.splice(0, a.length, ...a);
      return found >= limit;
    }
    const vals: number[] = [];
    for (let v = 1; v <= 9; v++) if (bestMask & (1 << (v - 1))) vals.push(v);
    if (rand) shuffle(vals, rand);
    for (const v of vals) {
      a[best] = v;
      if (rec()) return true;
    }
    a[best] = 0;
    return false;
  };
  rec();
  return found;
}

export function countSolutions(g: Grid, limit = 2): number {
  return search(g, limit);
}

/** 유일해 퍼즐의 정답. 해가 없으면 null */
export function solve(g: Grid): Grid | null {
  const out: Grid = [];
  return search(g, 1, out) ? out : null;
}

export function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 테스트·재현용 시드 RNG */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 랜덤 완성판 → 유일해가 깨지지 않는 칸만 무작위로 지워 목표 힌트 수까지.
 * 니코리 관례대로 힌트 배치가 180° 회전 대칭이 되도록 i 와 80-i 를 함께 지운다.
 * 끝까지 푸는 데 꼭 필요한 기술 단계(Grade.ts)가 난이도의 tier 와 다르면 다시 만든다.
 */
export function generate(level: Level, rand: () => number = Math.random, size: Size = 9, bank = true): { puzzle: Grid; solution: Grid } {
  if (bank && level === 'king' && size === 9 && KING_BANK.length) return fromBank(rand);
  if (bank && level === 'king' && size === 6 && KING_BANK6.length) return fromBank6(rand);
  const N = size * size;
  const target = size === 9 ? LEVELS[level].clues : (CLUES6[level] ?? 10);
  for (;;) {
    const solution: Grid = [];
    search(new Array(N).fill(0), 1, solution, rand);
    const puzzle = solution.slice();
    let clues = N;
    for (const i of shuffle([...Array(Math.ceil(N / 2)).keys()], rand)) {
      if (clues <= target) break;
      const pair = i === N - 1 - i ? [i] : [i, N - 1 - i];
      const saved = pair.map((k) => puzzle[k]);
      for (const k of pair) puzzle[k] = 0;
      if (countSolutions(puzzle) === 1) clues -= pair.length;
      else pair.forEach((k, n) => (puzzle[k] = saved[n]));
    }
    const t = grade(puzzle);
    const ok6 = level === 'hell' ? t === 3 : level === 'king' ? t >= 4 : level === 'hard' ? t >= 1 && t <= 2 : t === 0;
    if (size === 9 ? t === LEVELS[level].tier : ok6) return { puzzle, solution };
  }
}

/**
 * 변성대왕: 미리 골라 둔 판(scripts/gen-king.ts — AIC 로도 막혀 포싱 체인이 10번 이상 필요한 판)을 꺼내
 * 숫자 바꾸기(9!) × 돌리기·뒤집기(8) 로 변형한다. 변형해도 유일해·대칭·필요한 기술은 그대로라 난이도가 같다.
 * (그런 판은 수백 개 중 하나꼴이라 그 자리에서 만들면 몇 초씩 걸린다)
 */
function fromBank(rand: () => number): { puzzle: Grid; solution: Grid } {
  const src = fromStr(KING_BANK[Math.floor(rand() * KING_BANK.length)]);
  const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rand);
  const turn = Math.floor(rand() * 4);
  const flip = rand() < 0.5;
  const puzzle: Grid = new Array(81).fill(0);
  src.forEach((v, i) => {
    let r = Math.floor(i / 9);
    let c = i % 9;
    for (let k = 0; k < turn; k++) [r, c] = [c, 8 - r];
    if (flip) c = 8 - c;
    puzzle[r * 9 + c] = v ? digits[v - 1] : 0;
  });
  return { puzzle, solution: solve(puzzle)! };
}

/**
 * 6×6 변성대왕 판 은행(scripts/gen-king6.ts) — 박스가 가로로 길어서 90° 돌리기는 안 되고,
 * 숫자 바꾸기(6!) × 좌우·상하 뒤집기(4) 로만 변형한다
 */
function fromBank6(rand: () => number): { puzzle: Grid; solution: Grid } {
  const src = fromStr(KING_BANK6[Math.floor(rand() * KING_BANK6.length)]);
  const digits = shuffle([1, 2, 3, 4, 5, 6], rand);
  const flipC = rand() < 0.5;
  const flipR = rand() < 0.5;
  const puzzle: Grid = new Array(36).fill(0);
  src.forEach((v, i) => {
    const r = flipR ? 5 - Math.floor(i / 6) : Math.floor(i / 6);
    const c = flipC ? 5 - (i % 6) : i % 6;
    puzzle[r * 6 + c] = v ? digits[v - 1] : 0;
  });
  return { puzzle, solution: solve(puzzle)! };
}

export const toStr = (g: Grid): string => g.join('');
export const fromStr = (s: string): Grid => [...s].map((ch) => (/[1-9]/.test(ch) ? Number(ch) : 0));
