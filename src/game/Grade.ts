import { candidates, type Grid } from './Sudoku';

/**
 * 사람이 쓰는 기술로 판을 풀어 보고, 끝내려면 꼭 필요했던 가장 어려운 단계를 매긴다 (나무위키 스도쿠/공략법 분류).
 * 0 기초: 드러난 하나 · 숨겨진 하나
 * 1 초급: 교차로 · 드러난/숨겨진 부분집합 (2~4)
 * 2 초급 물고기 + 중급 윙: X-윙 · 황새치 · 해파리 · XY-윙 · XYZ-윙
 * 3 중급 사슬: W-윙 · 핀드/사시미 X-윙 · X-사슬(스카이스크레이퍼·2-String Kite·심플 컬러링 포함) · XY-사슬
 *   — Sudoku.com 극악(Extreme)이 요구하는 패턴이 여기까지
 * 4 그 이상: 위 기술로는 막힘 — ALS · 3D 메두사 · 교대 추론 사슬 같은 고급/초고급 기술이 있어야 풀린다
 * 쉬운 단계로 진전이 있으면 늘 그쪽을 먼저 쓴다 (사람도 쉬운 것부터 찾으니까).
 */
export type Tier = 0 | 1 | 2 | 3 | 4;

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

/** W-윙: 후보가 똑같이 {x,y} 인 두 칸이 x 의 강한 링크(유닛에 x 자리가 둘뿐) 양끝을 하나씩 보면, 두 칸을 다 보는 칸에서 y 를 지운다 */
function wWing(s: State): boolean {
  const pairs = [...Array(81).keys()].filter((i) => count(s.c[i]) === 2);
  for (const [a, b] of combos(pairs, 2)) {
    if (s.c[a] !== s.c[b] || IS_PEER[a][b]) continue;
    for (const x of bits(s.c[a]))
      for (const u of UNITS) {
        const ends = u.filter((i) => s.c[i] & x);
        if (ends.length !== 2 || ends.includes(a) || ends.includes(b)) continue;
        const [p, q] = ends;
        if (!((IS_PEER[a][p] && IS_PEER[b][q]) || (IS_PEER[a][q] && IS_PEER[b][p]))) continue;
        if (s.drop(PEERS[a].filter((i) => IS_PEER[b][i]), s.c[a] & ~x)) return true;
      }
  }
  return false;
}

/**
 * 핀드/사시미 X-윙: 두 행의 v 자리가 두 열 + 한 박스 안의 '지느러미' 로만 이뤄지면,
 * 지느러미가 참이든(그 박스) X-윙이 서든(그 열) 꺼지는 칸 = 두 열 ∩ 지느러미 박스 (기준 행 제외) 에서 v 를 지운다 (행·열 바꿔서도)
 */
function finnedXWing(s: State): boolean {
  const boxOf = (i: number) => Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3);
  for (const bit of bits(0x1ff))
    for (const [base, cover] of [
      [UNITS.slice(0, 9), UNITS.slice(9, 18)],
      [UNITS.slice(9, 18), UNITS.slice(0, 9)],
    ])
      for (const [r1, r2] of combos([...Array(9).keys()], 2)) {
        // 이미 v 가 놓인 줄은 X-윙 다리가 못 된다
        if (!base[r1].some((i) => s.c[i] & bit) || !base[r2].some((i) => s.c[i] & bit)) continue;
        const lines = [...base[r1], ...base[r2]];
        const spots = lines.filter((i) => s.c[i] & bit);
        for (const [c1, c2] of combos([...Array(9).keys()], 2)) {
          const covered = [...cover[c1], ...cover[c2]];
          const fins = spots.filter((i) => !covered.includes(i));
          if (!fins.length || fins.some((i) => boxOf(i) !== boxOf(fins[0]))) continue;
          if (s.drop(covered.filter((i) => boxOf(i) === boxOf(fins[0]) && !lines.includes(i)), bit)) return true;
        }
      }
  return false;
}

/** 후보 노드 (칸, 숫자 비트) */
type Node = [number, number];

/**
 * start 가 거짓이라고 두고 강한 링크(거짓→참)·약한 링크(참→거짓)를 번갈아 따라간다.
 * 참이 되는 노드에 start 와 같은 숫자가 있으면 둘 중 하나는 참이니, 두 칸을 다 보는 칸에서 그 숫자를 지운다.
 * 같은 노드가 참·거짓 둘 다 되거나 start 자신이 참이 되면 모순 → start 가 답.
 */
function chainFrom(s: State, [c0, b0]: Node, strong: (n: Node) => Node[], weak: (n: Node) => Node[]): boolean {
  const key = ([i, b]: Node) => i * 512 + b;
  const on = new Set<number>();
  const off = new Set<number>([key([c0, b0])]);
  const queue: [Node, boolean][] = [[[c0, b0], false]];
  const hits: Node[] = [];
  while (queue.length) {
    const [n, isOn] = queue.shift()!;
    for (const m of isOn ? weak(n) : strong(n)) {
      const set = isOn ? off : on;
      if (set.has(key(m))) continue;
      set.add(key(m));
      queue.push([m, !isOn]);
      if (!isOn) hits.push(m);
    }
  }
  if ([...on].some((k) => off.has(k))) {
    s.place(c0, 32 - Math.clz32(b0));
    return true;
  }
  for (const [t, b] of hits) if (b === b0 && t !== c0 && s.drop(PEERS[c0].filter((i) => IS_PEER[t][i]), b0)) return true;
  return false;
}

/** X-사슬: 한 숫자만으로, 강한 링크 = 유닛에 그 숫자 자리가 둘뿐, 약한 링크 = 서로 보는 칸 */
function xChains(s: State): boolean {
  for (const bit of bits(0x1ff)) {
    const partner = new Map<number, number[]>();
    for (const u of UNITS) {
      const ends = u.filter((i) => s.c[i] & bit);
      if (ends.length === 2) ends.forEach((i, k) => partner.set(i, [...(partner.get(i) ?? []), ends[1 - k]]));
    }
    const strong = ([i]: Node): Node[] => (partner.get(i) ?? []).map((j) => [j, bit]);
    const weak = ([i]: Node): Node[] => PEERS[i].filter((j) => s.c[j] & bit).map((j) => [j, bit]);
    for (const i of partner.keys()) if (chainFrom(s, [i, bit], strong, weak)) return true;
  }
  return false;
}

/** XY-사슬: 후보 2개짜리 칸만으로, 강한 링크 = 칸 안의 다른 후보, 약한 링크 = 같은 숫자를 가진 서로 보는 칸 */
function xyChains(s: State): boolean {
  const bivalue = (i: number) => count(s.c[i]) === 2;
  const strong = ([i, b]: Node): Node[] => [[i, s.c[i] & ~b]];
  const weak = ([i, b]: Node): Node[] => PEERS[i].filter((j) => bivalue(j) && s.c[j] & b).map((j) => [j, b]);
  for (let i = 0; i < 81; i++) if (bivalue(i)) for (const b of bits(s.c[i])) if (chainFrom(s, [i, b], strong, weak)) return true;
  return false;
}

/** 기술로 풀 수 있는 데까지 푼 판·남은 후보와 필요했던 단계 (4면 grid 에 빈칸이 남는다) */
export function logicSolve(p: Grid): { tier: Tier; grid: Grid; cands: number[] } {
  const s = new State(p);
  let tier: Tier = 0;
  while (s.g.some((v) => !v)) {
    if (singles(s)) continue;
    if (intersections(s) || subsets(s)) tier = Math.max(tier, 1) as Tier;
    else if (fish(s) || wings(s)) tier = Math.max(tier, 2) as Tier;
    else if (wWing(s) || finnedXWing(s) || xChains(s) || xyChains(s)) tier = 3;
    else return { tier: 4, grid: s.g, cands: s.c };
  }
  return { tier, grid: s.g, cands: s.c };
}

export const grade = (p: Grid): Tier => logicSolve(p).tier;
