import { candidates, countSolutions, geo, type Geo, type Grid } from './Sudoku';

/**
 * 사람이 쓰는 기술로 판을 풀어 보고, 끝내려면 꼭 필요했던 가장 어려운 단계를 매긴다 (나무위키 스도쿠/공략법 분류).
 * 0 기초: 드러난 하나 · 숨겨진 하나
 * 1 초급: 교차로 · 드러난/숨겨진 부분집합 (2~4)
 * 2 초급 물고기 + 중급 윙: X-윙 · 황새치 · 해파리 · XY-윙 · XYZ-윙
 * 3 중급 사슬: W-윙 · 핀드/사시미 X-윙 · X-사슬(스카이스크레이퍼·2-String Kite·심플 컬러링 포함) · XY-사슬
 *   + 유일성 논법 (UR 1형 · BUG+1) — Sudoku.com 극악(Extreme)이 요구하는 패턴이 여기까지
 * 4 고급: 교대 추론 사슬(AIC)이 필요하다. 보통 한두 번 쓰고 나면 다시 쉬워진다
 * 5 그 이상: AIC 로도 막힘 — ALS · 포싱 체인 같은 초고급 기술이 있어야 풀린다
 * 쉬운 단계로 진전이 있으면 늘 그쪽을 먼저 쓴다 (사람도 쉬운 것부터 찾으니까).
 */
export type Tier = 0 | 1 | 2 | 3 | 4 | 5;

// 지금 채점 중인 판의 크기별 칸 관계. logicSolve 가 시작할 때 맞춰 둔다 (채점은 동기라 한 번에 한 판)
let UNITS: number[][] = [];
let PEERS: number[][] = [];
let IS_PEER: boolean[][] = [];
let BOX: number[] = [];
let ALL = 0;
let N = 0;
let CELLS = 0;
function use(G: Geo): void {
  ({ units: UNITS, peers: PEERS, isPeer: IS_PEER, boxOf: BOX, all: ALL, n: N, cells: CELLS } = G);
}

const bits = (m: number): number[] => [...Array(9).keys()].filter((b) => m & (1 << b)).map((b) => 1 << b);
const count = (m: number): number => bits(m).length;

function* combos<T>(arr: T[], n: number, from = 0): Generator<T[]> {
  if (n === 0) return yield [];
  for (let i = from; i <= arr.length - n; i++) for (const rest of combos(arr, n - 1, i + 1)) yield [arr[i], ...rest];
}

/** 풀이 한 단계 — 화면에 그릴 재료 (숫자는 1~9, 칸은 0~80) */
export interface Step {
  name: string;
  text: string;
  /** 패턴을 이루는 칸 (진하게) */
  cells: number[];
  /** 근거가 되는 행·열·박스 (옅게) */
  area: number[];
  /** 후보 강조: key = 패턴, on = 참이 되는 후보, off = 거짓이 되는 후보 */
  marks: { i: number; d: number; tone: 'key' | 'on' | 'off' }[];
  /** 사슬 링크: 강한 링크(실선) = 한쪽이 거짓이면 다른 쪽이 참, 약한 링크(점선) = 둘 다 참일 수는 없음 */
  links: { a: [number, number]; b: [number, number]; strong: boolean }[];
  /** 지우는 후보 */
  elim: { i: number; d: number }[];
  /** 확정되는 칸 */
  place?: { i: number; v: number };
  /** 포싱: 가정한 숫자 → 그 뒤로 정해지는 칸들(순서대로) → 모순이 난 칸 */
  assume?: { i: number; v: number };
  trail?: { i: number; v: number }[];
  bad?: number[];
}
type Info = Omit<Step, 'elim' | 'place'>;

/** explainNext 가 켜 두면 기술이 발동할 때마다 단계를 남긴다 (채점 중엔 null) */
let say: ((st: Step) => void) | null = null;

const digitOf = (bit: number) => 32 - Math.clz32(bit);
const rc = (i: number) => `${Math.floor(i / N) + 1}행 ${(i % N) + 1}열`;
function unitName(u: number[]): string {
  const k = UNITS.indexOf(u);
  return k < N ? `${k + 1}행` : k < 2 * N ? `${k - N + 1}열` : `${k - 2 * N + 1}번 박스`;
}
const list = (m: number) => bits(m).map(digitOf).join('·');
const keyMarks = (cells: number[], mask: number, s: State) =>
  cells.flatMap((i) => bits(s.c[i] & mask).map((b) => ({ i, d: digitOf(b), tone: 'key' as const })));

/** cells 에서 mask 후보를 지우고, 지운 게 있으면 단계를 남긴다 */
function fire(s: State, cells: number[], mask: number, info: () => Info): boolean {
  const elim = say ? cells.flatMap((i) => bits(s.c[i] & mask).map((b) => ({ i, d: digitOf(b) }))) : [];
  if (!s.drop(cells, mask)) return false;
  say?.({ ...info(), elim });
  return true;
}

/** 칸을 확정하고 단계를 남긴다 */
function put(s: State, i: number, v: number, info: () => Info): true {
  s.place(i, v);
  say?.({ ...info(), elim: [], place: { i, v } });
  return true;
}

class State {
  readonly g: Grid;
  readonly c: number[];
  readonly G: Geo;
  /** 있으면 확정되는 칸을 순서대로 남긴다 (포싱 시각화) */
  log: number[] | null = null;
  constructor(p: Grid) {
    this.G = geo(p.length);
    this.g = p.slice();
    this.c = this.g.map((v, i) => (v ? 0 : candidates(this.g, i)));
  }
  place(i: number, v: number): void {
    this.log?.push(i);
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
  for (let i = 0; i < CELLS; i++)
    if (s.c[i] && count(s.c[i]) === 1) {
      const v = digitOf(s.c[i]);
      return put(s, i, v, () => ({
        name: '드러난 하나 (Naked Single)',
        text: `${rc(i)} 의 행·열·박스에 다른 숫자가 다 있어서, 남는 후보는 ${v} 하나뿐이에요.`,
        cells: [i],
        area: PEERS[i],
        marks: [{ i, d: v, tone: 'on' }],
        links: [],
      }));
    }
  for (const u of UNITS)
    for (let v = 1; v <= N; v++) {
      const spots = u.filter((i) => s.c[i] & (1 << (v - 1)));
      if (spots.length === 1)
        return put(s, spots[0], v, () => ({
          name: '숨겨진 하나 (Hidden Single)',
          text: `${unitName(u)} 에서 ${v} 가 들어갈 수 있는 칸은 ${rc(spots[0])} 하나뿐이에요. 다른 칸은 같은 줄·박스에 ${v} 가 이미 있어요.`,
          // 같은 유닛의 다른 빈칸을 막고 있는 v 들도 같이 보여 준다
          cells: [spots[0], ...new Set(u.filter((i) => !s.g[i] && i !== spots[0]).flatMap((i) => PEERS[i].filter((p) => s.g[p] === v && !u.includes(p))))],
          area: u,
          marks: [{ i: spots[0], d: v, tone: 'on' }],
          links: [],
        }));
    }
  return false;
}

/** 교차로: 한 유닛 안의 숫자 v 자리가 전부 다른 유닛과 겹치면, 그 다른 유닛의 나머지 칸에서 v 를 지운다 */
function intersections(s: State): boolean {
  for (const box of UNITS.slice(2 * N))
    for (const line of UNITS.slice(0, 2 * N)) {
      const shared = box.filter((i) => line.includes(i));
      if (!shared.length) continue;
      for (const bit of bits(ALL))
        for (const [a, b] of [
          [box, line],
          [line, box],
        ]) {
          const inA = a.filter((i) => s.c[i] & bit);
          if (
            inA.length &&
            inA.every((i) => shared.includes(i)) &&
            fire(s, b.filter((i) => !shared.includes(i)), bit, () => ({
              name: '교차로 (Pointing / Claiming)',
              text: `${unitName(a)} 의 ${digitOf(bit)} 는 ${unitName(b)} 와 겹치는 칸에만 올 수 있어요. 그러니 ${unitName(b)} 의 나머지 칸에는 ${digitOf(bit)} 가 못 와요.`,
              cells: inA,
              area: [...a, ...b],
              marks: keyMarks(inA, bit, s),
              links: [],
            }))
          )
            return true;
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
        if (
          count(m) === n &&
          fire(s, empty.filter((i) => !cells.includes(i)), m, () => ({
            name: `드러난 부분집합 (Naked ${['', '', 'Pair', 'Triple', 'Quad'][n]})`,
            text: `${unitName(u)} 의 ${n}칸에 들어갈 수 있는 숫자가 ${list(m)} ${n}개뿐이에요. 이 숫자들은 이 ${n}칸이 나눠 가지니, 같은 ${unitName(u)} 의 다른 칸에서는 지워요.`,
            cells,
            area: u,
            marks: keyMarks(cells, m, s),
            links: [],
          }))
        )
          return true;
      }
      // 숨겨진: n개 숫자가 n칸에만 → 그 칸들의 다른 후보를 지운다
      for (const ds of combos(digits, n)) {
        const m = ds.reduce((a, b) => a | b, 0);
        const cells = empty.filter((i) => s.c[i] & m);
        if (
          cells.length === n &&
          fire(s, cells, ~m & ALL, () => ({
            name: `숨겨진 부분집합 (Hidden ${['', '', 'Pair', 'Triple', 'Quad'][n]})`,
            text: `${unitName(u)} 에서 ${list(m)} 는 이 ${n}칸에만 올 수 있어요. ${n}칸이 이 숫자들로 꽉 차니, 이 칸들의 다른 후보는 지워요.`,
            cells,
            area: u,
            marks: keyMarks(cells, m, s),
            links: [],
          }))
        )
          return true;
      }
    }
  }
  return false;
}

/** X-윙(2) · 황새치(3) · 해파리(4): n개 행에서 v 자리가 n개 열 안에만 → 그 열의 다른 행에서 v 를 지운다 (행·열 바꿔서도) */
function fish(s: State): boolean {
  for (const bit of bits(ALL))
    for (const [base, cover] of [
      [UNITS.slice(0, N), UNITS.slice(N, 2 * N)],
      [UNITS.slice(N, 2 * N), UNITS.slice(0, N)],
    ]) {
      const pos = base.map((u) => u.reduce((m, i, k) => (s.c[i] & bit ? m | (1 << k) : m), 0));
      for (let n = 2; n <= 4; n++) {
        const rows = [...Array(N).keys()].filter((r) => pos[r] && count(pos[r]) <= n);
        for (const pick of combos(rows, n)) {
          const cols = pick.reduce((m, r) => m | pos[r], 0);
          if (count(cols) !== n) continue;
          const victims = bits(cols).flatMap((cb) => cover[31 - Math.clz32(cb)].filter((i) => !pick.some((r) => base[r].includes(i))));
          const corners = pick.flatMap((r) => base[r].filter((i) => s.c[i] & bit));
          const lines = (us: number[][]) => us.map(unitName).join('·');
          if (
            fire(s, victims, bit, () => ({
              name: ['', '', 'X-윙 (X-Wing)', '황새치 (Swordfish)', '해파리 (Jellyfish)'][n],
              text: `${lines(pick.map((r) => base[r]))} 의 ${digitOf(bit)} 자리가 모두 ${lines(bits(cols).map((cb) => cover[31 - Math.clz32(cb)]))} 안에만 있어요. ${n}줄이 각각 ${digitOf(bit)} 를 하나씩 가져가면 그 ${n}줄을 다 채우니, 그 줄들의 다른 칸에는 ${digitOf(bit)} 가 못 와요.`,
              cells: corners,
              area: [...pick.flatMap((r) => base[r]), ...bits(cols).flatMap((cb) => cover[31 - Math.clz32(cb)])],
              marks: keyMarks(corners, bit, s),
              links: [],
            }))
          )
            return true;
        }
      }
    }
  return false;
}

/** XY-윙 · XYZ-윙: 축 칸과 두 집게 칸 (집게는 후보 2개씩, 공통 숫자 z) → 셋 모두를 보는 칸에서 z 를 지운다 */
function wings(s: State): boolean {
  for (let p = 0; p < CELLS; p++) {
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
      if (
        fire(s, victims, z, () => ({
          name: xy ? 'XY-윙 (XY-Wing)' : 'XYZ-윙 (XYZ-Wing)',
          text: xy
            ? `축 ${rc(p)} {${list(s.c[p])}} 가 무엇이 되든 집게 ${rc(a)}·${rc(b)} 중 하나는 반드시 ${digitOf(z)} 예요. 그러니 두 집게를 모두 보는 칸에는 ${digitOf(z)} 가 못 와요.`
            : `축 ${rc(p)} {${list(s.c[p])}} 와 집게 ${rc(a)}·${rc(b)} 셋 중 하나는 반드시 ${digitOf(z)} 예요. 셋을 모두 보는 칸에는 ${digitOf(z)} 가 못 와요.`,
          cells: [p, a, b],
          area: [],
          marks: [...keyMarks([p, a, b], ALL, s)].map((m) => (m.d === digitOf(z) ? { ...m, tone: 'on' as const } : m)),
          links: [
            { a: [p, digitOf(s.c[a] & s.c[p] & ~z) || digitOf(z)], b: [a, digitOf(s.c[a] & s.c[p] & ~z) || digitOf(z)], strong: false },
            { a: [p, digitOf(s.c[b] & s.c[p] & ~z) || digitOf(z)], b: [b, digitOf(s.c[b] & s.c[p] & ~z) || digitOf(z)], strong: false },
          ],
        }))
      )
        return true;
    }
  }
  return false;
}

/** W-윙: 후보가 똑같이 {x,y} 인 두 칸이 x 의 강한 링크(유닛에 x 자리가 둘뿐) 양끝을 하나씩 보면, 두 칸을 다 보는 칸에서 y 를 지운다 */
function wWing(s: State): boolean {
  const pairs = [...Array(CELLS).keys()].filter((i) => count(s.c[i]) === 2);
  for (const [a, b] of combos(pairs, 2)) {
    if (s.c[a] !== s.c[b] || IS_PEER[a][b]) continue;
    for (const x of bits(s.c[a]))
      for (const u of UNITS) {
        const ends = u.filter((i) => s.c[i] & x);
        if (ends.length !== 2 || ends.includes(a) || ends.includes(b)) continue;
        const [p, q] = ends;
        if (!((IS_PEER[a][p] && IS_PEER[b][q]) || (IS_PEER[a][q] && IS_PEER[b][p]))) continue;
        const y = s.c[a] & ~x;
        const [pa, qb] = IS_PEER[a][p] && IS_PEER[b][q] ? [p, q] : [q, p];
        if (
          fire(s, PEERS[a].filter((i) => IS_PEER[b][i]), y, () => ({
            name: 'W-윙 (W-Wing)',
            text: `${rc(a)}·${rc(b)} 는 둘 다 {${list(s.c[a])}} 예요. ${unitName(u)} 에서 ${digitOf(x)} 는 두 자리 중 하나라, 두 칸이 동시에 ${digitOf(x)} 일 수는 없어요. 그러니 둘 중 하나는 ${digitOf(y)} — 두 칸을 다 보는 칸에서 ${digitOf(y)} 를 지워요.`,
            cells: [a, b, p, q],
            area: u,
            marks: [...keyMarks([a, b], ALL, s), ...keyMarks([p, q], x, s)],
            links: [
              { a: [a, digitOf(x)], b: [pa, digitOf(x)], strong: false },
              { a: [pa, digitOf(x)], b: [qb, digitOf(x)], strong: true },
              { a: [qb, digitOf(x)], b: [b, digitOf(x)], strong: false },
            ],
          }))
        )
          return true;
      }
  }
  return false;
}

/**
 * 핀드/사시미 X-윙: 두 행의 v 자리가 두 열 + 한 박스 안의 '지느러미' 로만 이뤄지면,
 * 지느러미가 참이든(그 박스) X-윙이 서든(그 열) 꺼지는 칸 = 두 열 ∩ 지느러미 박스 (기준 행 제외) 에서 v 를 지운다 (행·열 바꿔서도)
 */
function finnedXWing(s: State): boolean {
  for (const bit of bits(ALL))
    for (const [base, cover] of [
      [UNITS.slice(0, N), UNITS.slice(N, 2 * N)],
      [UNITS.slice(N, 2 * N), UNITS.slice(0, N)],
    ])
      for (const [r1, r2] of combos([...Array(N).keys()], 2)) {
        // 이미 v 가 놓인 줄은 X-윙 다리가 못 된다
        if (!base[r1].some((i) => s.c[i] & bit) || !base[r2].some((i) => s.c[i] & bit)) continue;
        const lines = [...base[r1], ...base[r2]];
        const spots = lines.filter((i) => s.c[i] & bit);
        for (const [c1, c2] of combos([...Array(N).keys()], 2)) {
          const covered = [...cover[c1], ...cover[c2]];
          const fins = spots.filter((i) => !covered.includes(i));
          if (!fins.length || fins.some((i) => BOX[i] !== BOX[fins[0]])) continue;
          const body = spots.filter((i) => covered.includes(i));
          if (
            fire(s, covered.filter((i) => BOX[i] === BOX[fins[0]] && !lines.includes(i)), bit, () => ({
              name: '핀드 X-윙 (Finned / Sashimi X-Wing)',
              text: `${unitName(base[r1])}·${unitName(base[r2])} 의 ${digitOf(bit)} 는 거의 X-윙인데 지느러미(초록)가 붙어 있어요. 지느러미가 참이면 그 박스에서, 아니면 X-윙이 서서 그 열에서 — 어느 쪽이든 겹치는 칸에는 ${digitOf(bit)} 가 못 와요.`,
              cells: spots,
              area: [...base[r1], ...base[r2]],
              marks: [...keyMarks(body, bit, s), ...fins.map((i) => ({ i, d: digitOf(bit), tone: 'on' as const }))],
              links: [],
            }))
          )
            return true;
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
function chainFrom(s: State, [c0, b0]: Node, strong: (n: Node) => Node[], weak: (n: Node) => Node[], name = '사슬'): boolean {
  const key = ([i, b]: Node) => i * 512 + b;
  // 경로를 되짚기 위해 어디서 왔는지 남긴다
  const on = new Map<number, Node>();
  const off = new Map<number, Node | null>([[key([c0, b0]), null]]);
  const queue: [Node, boolean][] = [[[c0, b0], false]];
  const hits: Node[] = [];
  while (queue.length) {
    const [n, isOn] = queue.shift()!;
    for (const m of isOn ? weak(n) : strong(n)) {
      const set = isOn ? off : on;
      if (set.has(key(m))) continue;
      set.set(key(m), n);
      queue.push([m, !isOn]);
      if (!isOn) hits.push(m);
    }
  }
  // 거짓(start)에서 출발해 node 가 tone 이 되기까지의 링크
  const path = (node: Node, isOn: boolean): Step['links'] => {
    const out: Step['links'] = [];
    let cur: Node = node;
    let curOn = isOn;
    for (;;) {
      const prev = (curOn ? on : off).get(key(cur));
      if (!prev) break;
      out.unshift({ a: [prev[0], digitOf(prev[1])], b: [cur[0], digitOf(cur[1])], strong: curOn });
      cur = prev;
      curOn = !curOn;
    }
    return out;
  };
  const tones = (links: Step['links']): Step['marks'] => {
    const seen = new Map<string, Step['marks'][number]>();
    seen.set(`${c0}:${digitOf(b0)}`, { i: c0, d: digitOf(b0), tone: 'off' });
    for (const l of links) seen.set(`${l.b[0]}:${l.b[1]}`, { i: l.b[0], d: l.b[1], tone: l.strong ? 'on' : 'off' });
    return [...seen.values()];
  };
  const clash = [...on.keys()].find((k) => off.has(k));
  if (clash != null) {
    const node: Node = [Math.floor(clash / 512), clash % 512];
    return put(s, c0, digitOf(b0), () => {
      const links = [...path(node, true), ...path(node, false)];
      return {
        name: `${name} — 모순`,
        text: `${rc(c0)} 가 ${digitOf(b0)} 가 아니라고 가정해 사슬을 따라가면, ${rc(node[0])} 의 ${digitOf(node[1])} 가 참이면서 동시에 거짓이 돼요. 가정이 틀렸으니 ${rc(c0)} = ${digitOf(b0)}.`,
        cells: [...new Set(links.flatMap((l) => [l.a[0], l.b[0]]))],
        area: [],
        marks: tones(links),
        links,
      };
    });
  }
  for (const [t, b] of hits)
    if (
      b === b0 &&
      t !== c0 &&
      fire(s, PEERS[c0].filter((i) => IS_PEER[t][i]), b0, () => {
        const links = path([t, b], true);
        return {
          name,
          text: `${rc(c0)} 의 ${digitOf(b0)} 가 거짓이면 사슬을 따라 ${rc(t)} 의 ${digitOf(b0)} 가 참이 돼요 (실선 = 한쪽이 거짓이면 다른 쪽은 참, 점선 = 둘 다 참일 순 없음). 그러니 둘 중 하나는 반드시 ${digitOf(b0)} — 두 칸을 다 보는 칸에서 ${digitOf(b0)} 를 지워요.`,
          cells: [...new Set(links.flatMap((l) => [l.a[0], l.b[0]]))],
          area: [],
          marks: tones(links),
          links,
        };
      })
    )
      return true;
  return false;
}

/** X-사슬: 한 숫자만으로, 강한 링크 = 유닛에 그 숫자 자리가 둘뿐, 약한 링크 = 서로 보는 칸 */
function xChains(s: State): boolean {
  for (const bit of bits(ALL)) {
    const partner = new Map<number, number[]>();
    for (const u of UNITS) {
      const ends = u.filter((i) => s.c[i] & bit);
      if (ends.length === 2) ends.forEach((i, k) => partner.set(i, [...(partner.get(i) ?? []), ends[1 - k]]));
    }
    const strong = ([i]: Node): Node[] => (partner.get(i) ?? []).map((j) => [j, bit]);
    const weak = ([i]: Node): Node[] => PEERS[i].filter((j) => s.c[j] & bit).map((j) => [j, bit]);
    for (const i of partner.keys()) if (chainFrom(s, [i, bit], strong, weak, 'X-사슬 (X-Chain)')) return true;
  }
  return false;
}

/** XY-사슬: 후보 2개짜리 칸만으로, 강한 링크 = 칸 안의 다른 후보, 약한 링크 = 같은 숫자를 가진 서로 보는 칸 */
function xyChains(s: State): boolean {
  const bivalue = (i: number) => count(s.c[i]) === 2;
  const strong = ([i, b]: Node): Node[] => [[i, s.c[i] & ~b]];
  const weak = ([i, b]: Node): Node[] => PEERS[i].filter((j) => bivalue(j) && s.c[j] & b).map((j) => [j, b]);
  for (let i = 0; i < CELLS; i++) if (bivalue(i)) for (const b of bits(s.c[i])) if (chainFrom(s, [i, b], strong, weak, 'XY-사슬 (XY-Chain)')) return true;
  return false;
}

/**
 * 유일성 논법 (해가 하나뿐이라는 전제):
 * UR 1형 — 두 행·두 열·두 박스에 걸친 직사각형 네 칸 중 세 칸이 똑같이 {a,b} 뿐이면, 넷째 칸은 a·b 가 될 수 없다.
 * BUG+1 — 후보 3개인 칸 하나 빼고 전부 후보 2개면, 그 칸에서 행에 3번 나오는 숫자가 답이다.
 */
function uniqueness(s: State): boolean {
  for (const [r1, r2] of combos([...Array(N).keys()], 2))
    for (const [c1, c2] of combos([...Array(N).keys()], 2)) {
      const cells = [r1 * N + c1, r1 * N + c2, r2 * N + c1, r2 * N + c2];
      if (new Set(cells.map((i) => BOX[i])).size !== 2 || cells.some((i) => !s.c[i])) continue;
      const pairs = cells.filter((i) => count(s.c[i]) === 2);
      if (pairs.length !== 3 || pairs.some((i) => s.c[i] !== s.c[pairs[0]])) continue;
      const odd = cells.find((i) => !pairs.includes(i))!;
      const m = s.c[pairs[0]];
      if (
        (s.c[odd] & m) === m &&
        fire(s, [odd], m, () => ({
          name: '유일성 논법 (Unique Rectangle 1형)',
          text: `네 칸이 두 박스에 걸친 직사각형인데 세 칸이 {${list(m)}} 뿐이에요. 넷째 칸까지 ${list(m)} 중 하나면 두 숫자를 맞바꿔도 되는 '답이 두 개' 판이 돼요. 답은 하나뿐이니 넷째 칸에서 ${list(m)} 를 지워요.`,
          cells,
          area: [],
          marks: keyMarks(cells, m, s),
          links: [],
        }))
      )
        return true;
    }
  const open = [...Array(CELLS).keys()].filter((i) => s.c[i]);
  const triple = open.filter((i) => count(s.c[i]) !== 2);
  if (triple.length === 1 && count(s.c[triple[0]]) === 3) {
    const t = triple[0];
    const row = UNITS[Math.floor(t / N)];
    const b = bits(s.c[t]).find((bit) => row.filter((i) => s.c[i] & bit).length === 3);
    if (b)
      return put(s, t, digitOf(b), () => ({
        name: '유일성 논법 (BUG+1)',
        text: `빈칸이 전부 후보 2개인데 ${rc(t)} 만 3개예요. 이 칸을 빼면 '답이 여러 개' 가 되는 꼴이라, 행에서 3번 나오는 ${digitOf(b)} 가 이 칸의 답이에요.`,
        cells: [t],
        area: row,
        marks: [{ i: t, d: digitOf(b), tone: 'on' }],
        links: [],
      }));
  }
  return false;
}

/** 교대 추론 사슬(AIC): 강한 링크 = 유닛 켤레 + 칸 안 후보 2개, 약한 링크 = 같은 숫자 서로 보는 칸 + 같은 칸 다른 후보 */
function aic(s: State): boolean {
  const partner = new Map<number, number[]>();
  for (const bit of bits(ALL))
    for (const u of UNITS) {
      const ends = u.filter((i) => s.c[i] & bit);
      if (ends.length === 2) ends.forEach((i, k) => partner.set(i * 512 + bit, [...(partner.get(i * 512 + bit) ?? []), ends[1 - k]]));
    }
  const strong = ([i, b]: Node): Node[] => [
    ...(partner.get(i * 512 + b) ?? []).map((j): Node => [j, b]),
    ...(count(s.c[i]) === 2 ? [[i, s.c[i] & ~b] as Node] : []),
  ];
  const weak = ([i, b]: Node): Node[] => [
    ...PEERS[i].filter((j) => s.c[j] & b).map((j): Node => [j, b]),
    ...bits(s.c[i] & ~b).map((o): Node => [i, o]),
  ];
  for (let i = 0; i < CELLS; i++) for (const b of bits(s.c[i])) if (chainFrom(s, [i, b], strong, weak, '교대 추론 사슬 (AIC)')) return true;
  return false;
}

/** 빈칸인데 후보가 없거나, 유닛에 아직 없는 숫자가 들어갈 자리가 없으면 모순 (그 칸·유닛과 이유) */
function broken(s: State): { cells: number[]; why: string } | null {
  for (let i = 0; i < CELLS; i++) if (!s.g[i] && !s.c[i]) return { cells: [i], why: `${rc(i)} 에 넣을 수 있는 숫자가 하나도 없어요` };
  for (const u of UNITS)
    for (let v = 1; v <= N; v++)
      if (!u.some((i) => s.g[i] === v) && !u.some((i) => s.c[i] & (1 << (v - 1)))) return { cells: u, why: `${unitName(u)} 에 ${v} 가 들어갈 자리가 없어요` };
  return null;
}

/** 사람 기술로 막힐 때까지 (또는 모순이 날 때까지) 진행. deep 이면 중급 사슬까지 쓴다 */
function propagate(s: State, deep: boolean): void {
  while (s.g.some((v) => !v) && !broken(s))
    if (!(singles(s) || intersections(s) || subsets(s) || (deep && (fish(s) || wings(s) || wWing(s) || xChains(s) || xyChains(s))))) return;
}

/**
 * 포싱 체인 (가정 → 모순): 한 후보를 넣어 보고 기술로 따라가다 모순이 나면 그 후보를 지운다.
 * 사람 기술로 막힌 변성대왕 판을 계속 풀기 위한 마지막 수단. 얕게(기초 기술) → 깊게(사슬) → 끝까지 탐색 순으로 찾는다.
 */
function forcing(s: State): boolean {
  const tries = [...Array(CELLS).keys()]
    .filter((i) => s.c[i])
    .sort((a, b) => count(s.c[a]) - count(s.c[b]))
    .flatMap((i) => bits(s.c[i]).map((b): Node => [i, b]));
  const quiet = say;
  for (const depth of [0, 1, 2]) {
    for (const [i, b] of tries) {
      const t = new State(s.g);
      t.c.splice(0, CELLS, ...s.c);
      say = null;
      let bad: { cells: number[]; why: string } | null = null;
      try {
        t.place(i, digitOf(b));
        t.log = [];
        if (depth < 2) {
          propagate(t, depth === 1);
          bad = broken(t);
        } else if (countSolutions(t.g) === 0) bad = { cells: [i], why: '끝까지 따라가도 답이 나오지 않아요' };
      } finally {
        say = quiet;
      }
      if (!bad) continue;
      const v = digitOf(b);
      const trail = (t.log ?? []).map((k) => ({ i: k, v: t.g[k] }));
      const why = bad.why;
      const badCells = bad.cells;
      return fire(s, [i], b, () => ({
        name: depth === 0 ? '포싱 체인 (가정 → 모순)' : depth === 1 ? '포싱 체인 (깊은 가정 → 모순)' : '끝까지 가정해 보기 (Trial & Error)',
        text:
          depth < 2
            ? `${rc(i)} 에 ${v} 를 넣었다고 가정해요 (주황). ${depth === 0 ? '하나·교차로 같은 기초 기술' : '사슬 기술'}로 따라가면 초록 숫자 ${trail.length}개가 차례로 정해지다가, ${why} (빨강). 가정이 틀렸으니 ${rc(i)} 는 ${v} 가 아니에요.`
            : `${rc(i)} 에 ${v} 를 넣으면 ${why}. ${rc(i)} 는 ${v} 가 아니에요. (사람이 쓰는 기술로는 찾기 매우 어려운 단계예요)`,
        cells: [],
        area: [],
        marks: [],
        links: [],
        assume: { i, v },
        trail,
        bad: badCells,
      }));
    }
  }
  return false;
}

/**
 * 풀이: 지금 판(맞게 채운 숫자만)에서 다음 숫자 하나가 확정될 때까지의 단계들.
 * ruledOut 은 앞선 풀이에서 이미 지운 후보 (칸별 비트) — 같은 단계를 되풀이하지 않게 이어받는다.
 */
export function explainNext(known: Grid, ruledOut?: number[]): Step[] {
  const s = new State(known);
  use(s.G);
  if (ruledOut) s.c.forEach((m, i) => (s.c[i] = m & ~ruledOut[i]));
  const steps: Step[] = [];
  say = (st) => steps.push(st);
  try {
    while (s.g.some((v) => !v) && !steps.some((st) => st.place) && steps.length < 60) {
      const moved =
        singles(s) ||
        intersections(s) ||
        subsets(s) ||
        fish(s) ||
        wings(s) ||
        wWing(s) ||
        finnedXWing(s) ||
        xChains(s) ||
        xyChains(s) ||
        uniqueness(s) ||
        aic(s) ||
        forcing(s);
      if (!moved) break;
    }
  } finally {
    say = null;
  }
  return steps;
}

/** 기술로 풀 수 있는 데까지 푼 판·남은 후보와 필요했던 단계 (5면 grid 에 빈칸이 남는다) */
export function logicSolve(p: Grid): { tier: Tier; grid: Grid; cands: number[] } {
  const s = new State(p);
  use(s.G);
  let tier: Tier = 0;
  while (s.g.some((v) => !v)) {
    if (singles(s)) continue;
    if (intersections(s) || subsets(s)) tier = Math.max(tier, 1) as Tier;
    else if (fish(s) || wings(s)) tier = Math.max(tier, 2) as Tier;
    else if (wWing(s) || finnedXWing(s) || xChains(s) || xyChains(s) || uniqueness(s)) tier = Math.max(tier, 3) as Tier;
    else if (aic(s)) tier = 4;
    else return { tier: 5, grid: s.g, cands: s.c };
  }
  return { tier, grid: s.g, cands: s.c };
}

export const grade = (p: Grid): Tier => logicSolve(p).tier;
