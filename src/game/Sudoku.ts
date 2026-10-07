import { grade, type Tier } from './Grade';

/** 81칸 1차원 격자. 0 = 빈칸 */
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

/** 칸마다 같은 행·열·박스에 있는 다른 20칸 */
export const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => {
  const r = Math.floor(i / 9);
  const c = i % 9;
  const br = r - (r % 3);
  const bc = c - (c % 3);
  const s = new Set<number>();
  for (let k = 0; k < 9; k++) {
    s.add(r * 9 + k);
    s.add(k * 9 + c);
    s.add((br + Math.floor(k / 3)) * 9 + bc + (k % 3));
  }
  s.delete(i);
  return [...s];
});

/** 칸 i 에 놓을 수 있는 숫자 비트마스크 (bit v-1) */
export function candidates(g: Grid, i: number): number {
  let used = 0;
  for (const p of PEERS[i]) if (g[p]) used |= 1 << (g[p] - 1);
  return ~used & 0x1ff;
}

/**
 * 답이 될 수 없는 메모를 지운다: 맞게 채운 칸(주어진 칸 포함)은 메모 없음,
 * 빈칸·틀린 숫자 칸은 같은 행·열·박스에 맞게 놓인 숫자를 메모에서 뺀다.
 * 틀린 숫자는 기준으로 삼지 않는다.
 */
export function pruneNotes(grid: Grid, solution: Grid, notes: number[]): void {
  const known = grid.map((v, i) => (v === solution[i] ? v : 0));
  for (let i = 0; i < 81; i++) notes[i] = known[i] ? 0 : notes[i] & candidates(known, i);
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
    for (let i = 0; i < 81; i++) {
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
      if (out && found === 1) out.splice(0, 81, ...a);
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
export function generate(level: Level, rand: () => number = Math.random): { puzzle: Grid; solution: Grid } {
  for (;;) {
    const solution: Grid = [];
    search(new Array(81).fill(0), 1, solution, rand);
    const puzzle = solution.slice();
    let clues = 81;
    for (const i of shuffle([...Array(41).keys()], rand)) {
      if (clues <= LEVELS[level].clues) break;
      const pair = i === 40 ? [40] : [i, 80 - i];
      const saved = pair.map((k) => puzzle[k]);
      for (const k of pair) puzzle[k] = 0;
      if (countSolutions(puzzle) === 1) clues -= pair.length;
      else pair.forEach((k, n) => (puzzle[k] = saved[n]));
    }
    if (grade(puzzle) === LEVELS[level].tier) return { puzzle, solution };
  }
}

export const toStr = (g: Grid): string => g.join('');
export const fromStr = (s: string): Grid => [...s.slice(0, 81)].map((ch) => (/[1-9]/.test(ch) ? Number(ch) : 0));
