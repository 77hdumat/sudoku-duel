import { candidates, type Grid } from './Sudoku';

/**
 * 사람이 쓰는 기술로 판을 풀어 보고, 끝내려면 꼭 필요했던 가장 어려운 단계를 매긴다 (나무위키 스도쿠/공략법 분류).
 * 0 기초: 드러난 하나 · 숨겨진 하나
 * 1 초급: 교차로 · 드러난/숨겨진 부분집합 (2~4)
 * 2 초급 물고기 + 중급 윙: X-윙 · 황새치 · 해파리 · XY-윙 · XYZ-윙
 * 3 그 이상: 위 기술로는 막힘 — 사슬·컬러링·ALS 같은 중급 사슬/고급 기술이 있어야 풀린다
 * 쉬운 단계로 진전이 있으면 늘 그쪽을 먼저 쓴다 (사람도 쉬운 것부터 찾으니까).
 */
export type Tier = 0 | 1 | 2 | 3;

/** 행 9 (0~8) · 열 9 (9~17) · 박스 9 (18~26) */
const UNITS: number[][] = Array.from({ length: 27 }, (_, u) => {
  const k = u % 9;
  return Array.from({ length: 9 }, (_, j) =>
    u < 9 ? k * 9 + j : u < 18 ? j * 9 + k : (Math.floor(k / 3) * 3 + Math.floor(j / 3)) * 9 + (k % 3) * 3 + (j % 3),
  );
});
// Sudoku.ts 와 서로 import 하므로 PEERS 를 가져다 쓰지 않고 여기서 만든다 (모듈 초기화 순서)
const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => [...new Set(UNITS.filter((u) => u.includes(i)).flat())].filter((p) => p !== i));
const IS_PEER: boolean[][] = PEERS.map((ps) => {
  const row = new Array(81).fill(false);
  for (const p of ps) row[p] = true;
  return row;
});

const bits = (m: number): number[] => [...Array(9).keys()].filter((b) => m & (1 << b)).map((b) => 1 << b);
const count = (m: number): number => bits(m).length;

function* combos<T>(arr: T[], n: number, from = 0): Generator<T[]> {
  if (n === 0) return yield [];
  for (let i = from; i <= arr.length - n; i++) for (const rest of combos(arr, n - 1, i + 1)) yield [arr[i], ...rest];
}

class State {
  readonly g: Grid;
  readonly c: number[];
  constructor(p: Grid) {
    this.g = p.slice();
    this.c = this.g.map((v, i) => (v ? 0 : candidates(this.g, i)));
  }
  place(i: number, v: number): void {
    this.g[i] = v;
    this.c[i] = 0;
    for (const p of PEERS[i]) this.c[p] &= ~(1 << (v - 1));
  }
  /** cells 에서 mask 후보를 지운다. 하나라도 지웠으면 true */
  drop(cells: Iterable<number>, mask: number): boolean {
    let hit = false;
    for (const i of cells)
      if (this.c[i] & mask) {
        this.c[i] &= ~mask;
        hit = true;
      }
    return hit;
  }
}

function singles(s: State): boolean {
  for (let i = 0; i < 81; i++)
    if (s.c[i] && count(s.c[i]) === 1) {
      s.place(i, 32 - Math.clz32(s.c[i]));
      return true;
    }
  for (const u of UNITS)
    for (let v = 1; v <= 9; v++) {
      const spots = u.filter((i) => s.c[i] & (1 << (v - 1)));
      if (spots.length === 1) {
        s.place(spots[0], v);
        return true;
      }
    }
  return false;
}

/** 교차로: 한 유닛 안의 숫자 v 자리가 전부 다른 유닛과 겹치면, 그 다른 유닛의 나머지 칸에서 v 를 지운다 */
function intersections(s: State): boolean {
  for (const box of UNITS.slice(18))
    for (const line of UNITS.slice(0, 18)) {
      const shared = box.filter((i) => line.includes(i));
      if (!shared.length) continue;
      for (const bit of bits(0x1ff))
        for (const [a, b] of [
          [box, line],
          [line, box],
        ]) {
          const inA = a.filter((i) => s.c[i] & bit);
          if (inA.length && inA.every((i) => shared.includes(i)) && s.drop(b.filter((i) => !shared.includes(i)), bit)) return true;
        }
    }
  return false;
}

function subsets(s: State): boolean {
  for (const u of UNITS) {
    const empty = u.filter((i) => s.c[i]);
    const digits = bits(empty.reduce((m, i) => m | s.c[i], 0));
    for (let n = 2; n <= 4 && n < empty.length; n++) {
      // 드러난: n칸의 후보를 합쳐도 n개 → 그 숫자들은 유닛의 다른 칸에 못 온다
      for (const cells of combos(empty, n)) {
        const m = cells.reduce((acc, i) => acc | s.c[i], 0);
        if (count(m) === n && s.drop(empty.filter((i) => !cells.includes(i)), m)) return true;
      }
      // 숨겨진: n개 숫자가 n칸에만 → 그 칸들의 다른 후보를 지운다
      for (const ds of combos(digits, n)) {
        const m = ds.reduce((a, b) => a | b, 0);
        const cells = empty.filter((i) => s.c[i] & m);
        if (cells.length === n && s.drop(cells, ~m & 0x1ff)) return true;
      }
    }
  }
  return false;
}

/** X-윙(2) · 황새치(3) · 해파리(4): n개 행에서 v 자리가 n개 열 안에만 → 그 열의 다른 행에서 v 를 지운다 (행·열 바꿔서도) */
function fish(s: State): boolean {
  for (const bit of bits(0x1ff))
    for (const [base, cover] of [
      [UNITS.slice(0, 9), UNITS.slice(9, 18)],
      [UNITS.slice(9, 18), UNITS.slice(0, 9)],
    ]) {
      const pos = base.map((u) => u.reduce((m, i, k) => (s.c[i] & bit ? m | (1 << k) : m), 0));
      for (let n = 2; n <= 4; n++) {
        const rows = [...Array(9).keys()].filter((r) => pos[r] && count(pos[r]) <= n);
        for (const pick of combos(rows, n)) {
          const cols = pick.reduce((m, r) => m | pos[r], 0);
          if (count(cols) !== n) continue;
          const victims = bits(cols).flatMap((cb) => cover[31 - Math.clz32(cb)].filter((i) => !pick.some((r) => base[r].includes(i))));
          if (s.drop(victims, bit)) return true;
        }
      }
    }
  return false;
}

/** XY-윙 · XYZ-윙: 축 칸과 두 집게 칸 (집게는 후보 2개씩, 공통 숫자 z) → 셋 모두를 보는 칸에서 z 를 지운다 */
function wings(s: State): boolean {
  for (let p = 0; p < 81; p++) {
    const n = count(s.c[p]);
    if (n !== 2 && n !== 3) continue;
    const pincers = PEERS[p].filter((i) => count(s.c[i]) === 2);
    for (const [a, b] of combos(pincers, 2)) {
      const z = s.c[a] & s.c[b];
      if (s.c[a] === s.c[b] || count(z) !== 1) continue;
      const xy = n === 2 && s.c[p] === ((s.c[a] | s.c[b]) & ~z);
      const xyz = n === 3 && s.c[p] === (s.c[a] | s.c[b]);
      if (!xy && !xyz) continue;
      const victims = PEERS[a].filter((i) => IS_PEER[b][i] && i !== p && (xy || IS_PEER[p][i]));
      if (s.drop(victims, z)) return true;
    }
  }
  return false;
}

/** 기술로 풀 수 있는 데까지 푼 판·남은 후보와 필요했던 단계 (3이면 grid 에 빈칸이 남는다) */
export function logicSolve(p: Grid): { tier: Tier; grid: Grid; cands: number[] } {
  const s = new State(p);
  let tier: Tier = 0;
  while (s.g.some((v) => !v)) {
    if (singles(s)) continue;
    if (intersections(s) || subsets(s)) tier = Math.max(tier, 1) as Tier;
    else if (fish(s) || wings(s)) tier = 2;
    else return { tier: 3, grid: s.g, cands: s.c };
  }
  return { tier, grid: s.g, cands: s.c };
}

export const grade = (p: Grid): Tier => logicSolve(p).tier;
