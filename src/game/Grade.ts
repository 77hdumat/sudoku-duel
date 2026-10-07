import { candidates, countSolutions, geo, type Geo, type Grid } from './Sudoku';
import type { TechId } from './Techniques';

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
 *
 * 풀이(explainNext)를 켜면 기술이 발동할 때마다 사람이 생각하는 순서대로 쪼갠 서술(phase)과 그릴 재료를 남긴다.
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

/* ───────── 풀이 기록 ───────── */

export type Tone = 'key' | 'on' | 'off';
/** 후보 [칸, 숫자] */
export type Cand = [number, number];
export interface Link {
  a: Cand;
  b: Cand;
  /** 강한 연결(실선): 한쪽이 거짓이면 다른 쪽은 참 / 약한 연결(점선): 둘 다 참일 수는 없음 */
  strong: boolean;
}

/** 한 서술에 덧그릴 것들 (숫자는 1~9, 칸은 0~80) */
export interface Draw {
  /** 근거 유닛 (옅게) */
  area?: number[];
  /** 패턴 칸 (테두리) */
  cells?: number[];
  /** 후보 동그라미 — key 패턴, on 참, off 거짓 */
  marks?: { i: number; d: number; tone: Tone }[];
  links?: Link[];
  /** 경우 나누기에서 '이렇게 되면' 하고 칸에 띄우는 숫자 */
  ghosts?: { i: number; v: number; tone: 'on' | 'off' }[];
  /** 숨겨진 하나: 막혀서 못 오는 칸 */
  blocked?: number[];
  elim?: { i: number; d: number }[];
  place?: { i: number; v: number };
  /** 포싱: 가정 → 줄줄이 정해지는 칸 → 모순 */
  assume?: { i: number; v: number };
  trail?: { i: number; v: number }[];
  bad?: number[];
}

/** 생각 한 걸음: 글 + 이번에 새로 그릴 것 (draw 는 다음 서술에도 남고, temp 는 이 서술에서만 — 경우 나누기용) */
export interface Phase {
  text: string;
  draw?: Draw;
  temp?: Draw;
}

/** 풀이 한 단계 = 기술 한 번 */
export interface Step {
  id: TechId;
  phases: Phase[];
  /** 이 기술을 쓰기 직전의 후보 (칸별 비트) — 화면에 옅게 깔아 사슬을 따라가게 한다 */
  cands: number[];
  elim: { i: number; d: number }[];
  place?: { i: number; v: number };
}
type Info = { id: TechId; phases: Phase[] };

/** explainNext 가 켜 두면 기술이 발동할 때마다 단계를 남긴다 (채점 중엔 null) */
let say: ((st: Step) => void) | null = null;

const digitOf = (bit: number) => 32 - Math.clz32(bit);

/** 받침에 맞는 조사: J(7, '이', '가') → '7이', J('3행', '은', '는') → '3행은' */
export function J(word: string | number, withFinal: string, without: string): string {
  const s = String(word);
  const ch = s[s.length - 1];
  let has: boolean;
  if (/[0-9]/.test(ch)) has = '013678'.includes(ch);
  else {
    const code = ch.charCodeAt(0) - 0xac00;
    has = code >= 0 && code < 11172 ? code % 28 !== 0 : false;
  }
  return s + (has ? withFinal : without);
}

/** 칸 이름: '3행 5열 칸' — 칸이라는 걸 분명히 (그냥 '3행 5열' 이라 쓰면 줄 이름으로 읽힌다) */
const cell = (i: number) => `${Math.floor(i / N) + 1}행 ${(i % N) + 1}열 칸`;
const BOX9 = ['왼쪽 위', '가운데 위', '오른쪽 위', '왼쪽 가운데', '한가운데', '오른쪽 가운데', '왼쪽 아래', '가운데 아래', '오른쪽 아래'];
/** 유닛 이름: '3번째 가로줄' · '5번째 세로줄' · '왼쪽 위 박스' (행·열 용어를 몰라도 읽히게) */
function unitName(u: number[]): string {
  const k = UNITS.indexOf(u);
  if (k < N) return `${k + 1}번째 가로줄`;
  if (k < 2 * N) return `${k - N + 1}번째 세로줄`;
  return N === 9 ? `${BOX9[k - 2 * N]} 박스` : `${k - 2 * N + 1}번 박스`;
}
/** 같은 종류 줄 여러 개: '2·3·4번째 세로줄' */
function lineNames(us: number[][]): string {
  const ks = us.map((u) => UNITS.indexOf(u));
  if (ks.every((k) => k < N)) return `${ks.map((k) => k + 1).join('·')}번째 가로줄`;
  if (ks.every((k) => k >= N && k < 2 * N)) return `${ks.map((k) => k - N + 1).join('·')}번째 세로줄`;
  return us.map(unitName).join('·');
}
const list = (m: number) => bits(m).map(digitOf).join('·');
const nums = (vs: number[]) => [...new Set(vs)].sort().join('·');
const keyMarks = (cells: number[], mask: number, s: State) =>
  cells.flatMap((i) => bits(s.c[i] & mask).map((b) => ({ i, d: digitOf(b), tone: 'key' as Tone })));
const unitWith = (a: number, b: number) => UNITS.find((u) => u.includes(a) && u.includes(b))!;

/** cells 에서 mask 후보를 지우고, 지운 게 있으면 단계를 남긴다 (info 의 마지막 서술 뒤에 '지우기' 를 붙인다) */
function fire(s: State, cells: number[], mask: number, info: (elim: Step['elim']) => Info): boolean {
  const elim = say ? cells.flatMap((i) => bits(s.c[i] & mask).map((b) => ({ i, d: digitOf(b) }))) : [];
  const cands = say ? s.c.slice() : [];
  if (!s.drop(cells, mask)) return false;
  if (say) say({ ...info(elim), elim, cands });
  return true;
}

/** 칸을 확정하고 단계를 남긴다 */
function put(s: State, i: number, v: number, info: () => Info): true {
  const cands = say ? s.c.slice() : [];
  s.place(i, v);
  if (say) say({ ...info(), elim: [], place: { i, v }, cands });
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

/* ───────── 기술 ───────── */

function singles(s: State): boolean {
  for (let i = 0; i < CELLS; i++)
    if (s.c[i] && count(s.c[i]) === 1) {
      const v = digitOf(s.c[i]);
      return put(s, i, v, () => {
        const [row, col, box] = UNITS.filter((u) => u.includes(i));
        const seen = (u: number[]) => u.filter((k) => s.g[k] && k !== i);
        const has = [row, col, box].filter((u) => seen(u).length).map((u) => `${unitName(u)}에는 ${nums(seen(u).map((k) => s.g[k]))}`);
        return {
          id: 'naked-single',
          phases: [
            {
              text: `${cell(i)}(테두리)에 들어갈 숫자를 찾아요. 같은 가로줄·세로줄·박스(색칠한 곳)에 이미 있는 숫자는 여기 못 와요.`,
              draw: { cells: [i], area: PEERS[i] },
            },
            { text: `${J(has.join(', '), '이', '가')} 이미 있어요.`, draw: { cells: [...seen(row), ...seen(col), ...seen(box)] } },
            { text: `1부터 ${N}까지 중에 아직 안 나온 숫자는 ${v} 하나뿐이에요. 그래서 이 칸은 ${v}!`, draw: { place: { i, v } } },
          ],
        };
      });
    }
  for (const u of UNITS)
    for (let v = 1; v <= N; v++) {
      const spots = u.filter((i) => s.c[i] & (1 << (v - 1)));
      if (spots.length !== 1) continue;
      const i = spots[0];
      return put(s, i, v, () => {
        const others = u.filter((k) => !s.g[k] && k !== i);
        const blockers = [...new Set(others.flatMap((k) => PEERS[k].filter((p) => s.g[p] === v && !u.includes(p))))];
        return {
          id: 'hidden-single',
          phases: [
            { text: `${unitName(u)}(색칠한 곳)에도 ${J(v, '이', '가')} 꼭 한 번 들어가요. 어느 칸에 갈 수 있을까요?`, draw: { area: u } },
            {
              text: `테두리 칸에 이미 ${J(v, '이', '가')} 있어요. 그 줄과 박스에는 ${J(v, '을', '를')} 또 못 쓰니까 ✕ 칸은 탈락!`,
              draw: { cells: blockers, blocked: others },
            },
            { text: `${J(v, '이', '가')} 들어갈 수 있는 곳은 ${cell(i)} 하나만 남았어요. 그래서 여기가 ${v}!`, draw: { place: { i, v } } },
          ],
        };
      });
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
          const v = digitOf(bit);
          if (
            inA.length &&
            inA.every((i) => shared.includes(i)) &&
            fire(s, b.filter((i) => !shared.includes(i)), bit, (elim) => ({
              id: 'intersection',
              phases: [
                { text: `${unitName(a)}에서 ${J(v, '이', '가')} 들어갈 수 있는 자리(파란 동그라미)를 찾아봐요.`, draw: { area: a, marks: inA.map((i) => ({ i, d: v, tone: 'key' })) } },
                {
                  text: `그 자리가 전부 ${J(unitName(b), '과', '와')} 겹치는 칸에 몰려 있어요. 그러니 ${unitName(a)}의 ${J(v, '은', '는')} 어디에 들어가든 ${unitName(b)} 위에 놓여요.`,
                  draw: { area: b, cells: inA },
                },
                { text: `${unitName(b)}에는 ${J(v, '이', '가')} 한 번만 들어가는데, 그 자리를 방금 본 칸들이 맡았어요. 그래서 ${unitName(b)}의 나머지 칸에서는 ${v} 후보를 지워요.`, draw: { elim } },
              ],
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
          fire(s, empty.filter((i) => !cells.includes(i)), m, (elim) => ({
            id: 'naked-subset',
            phases: [
              {
                text: `${unitName(u)}의 칸 ${n}개(테두리)를 봐요. 이 칸들에 들어갈 수 있는 숫자를 다 모아도 ${list(m)}, 딱 ${n}개뿐이에요.`,
                draw: { area: u, cells, marks: keyMarks(cells, m, s) },
              },
              { text: `칸 ${n}개에 숫자 ${n}개 — 어느 칸이 어느 숫자를 갖든, ${J(list(m), '은', '는')} 결국 이 칸들이 하나씩 나눠 가져요.` },
              { text: `그러니 ${unitName(u)}의 다른 칸에는 ${J(list(m), '이', '가')} 들어갈 수 없어요. 후보에서 지워요.`, draw: { elim } },
            ],
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
          fire(s, cells, ~m & ALL, (elim) => ({
            id: 'hidden-subset',
            phases: [
              {
                text: `${unitName(u)}에서 숫자 ${J(list(m), '이', '가')} 들어갈 수 있는 칸을 찾아보면, 테두리 친 ${n}칸뿐이에요.`,
                draw: { area: u, cells, marks: keyMarks(cells, m, s) },
              },
              { text: `숫자 ${n}개가 이 ${n}칸에 다 들어가야 하니 자리가 꽉 차요. 이 칸들에 있던 다른 후보는 들어갈 틈이 없어서 지워요.`, draw: { elim } },
            ],
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
          const coverLines = bits(cols).map((cb) => cover[31 - Math.clz32(cb)]);
          const baseLines = pick.map((r) => base[r]);
          const victims = coverLines.flatMap((c) => c.filter((i) => !baseLines.some((b) => b.includes(i))));
          const v = digitOf(bit);
          const corners = baseLines.map((b) => b.filter((i) => s.c[i] & bit));
          if (
            fire(s, victims, bit, (elim) => {
              const bn = lineNames(baseLines);
              const cn = lineNames(coverLines);
              const flat = corners.flat();
              const phases: Phase[] = [
                {
                  text: `숫자 ${v}만 생각해요. ${bn}에서 ${J(v, '이', '가')} 들어갈 수 있는 자리(파란 동그라미)는 줄마다 ${n === 2 ? '딱 두 곳이에요' : `${n}곳 이하예요`}.`,
                  draw: { area: baseLines.flat(), marks: flat.map((i) => ({ i, d: v, tone: 'key' })) },
                },
                {
                  text: `그런데 그 자리들이 전부 ${cn} 위에만 있어요.`,
                  draw: { area: coverLines.flat(), links: corners.filter((c) => c.length === 2).map((c) => ({ a: [c[0], v], b: [c[1], v], strong: true })) },
                },
              ];
              if (n === 2 && corners.every((c) => c.length === 2)) {
                const [[p1, p2], [q1, q2]] = corners;
                // 같은 열끼리 짝 맞추기
                const [d1, d2] = unitWith(p1, q1) ? [q2, q1] : [q1, q2];
                phases.push(
                  { text: `경우 ①: ${cell(p1)}에 ${J(v, '이', '가')} 들어가면 → 다른 줄의 ${J(v, '은', '는')} 같은 ${UNITS.indexOf(base[0]) < N ? '세로줄' : '가로줄'}을 피해 ${cell(d1)}로 가야 해요.`, temp: { ghosts: [p1, d1].map((i) => ({ i, v, tone: 'on' })) } },
                  { text: `경우 ②: ${cell(p2)}에 ${J(v, '이', '가')} 들어가면 → 다른 줄의 ${J(v, '은', '는')} ${cell(d2)}로 가요.`, temp: { ghosts: [p2, d2].map((i) => ({ i, v, tone: 'on' })) } },
                  { text: `어느 경우든 ${cn}에 들어갈 ${J(v, '은', '는')} 이 네 칸 중에서 나와요.` },
                );
              } else
                phases.push({
                  text: `${n}개 줄이 각각 ${J(v, '을', '를')} 하나씩 가져가는데, 그 자리가 ${cn} 안에만 있어요. 그래서 ${cn}에 들어갈 ${J(v, '은', '는')} 모두 동그라미 자리에서 나와요.`,
                });
              phases.push({ text: `그러니 ${cn}의 나머지 칸에는 ${J(v, '이', '가')} 들어갈 수 없어요. 지워요.`, draw: { elim } });
              return { id: n === 2 ? 'x-wing' : n === 3 ? 'swordfish' : 'jellyfish', phases };
            })
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
      const Z = digitOf(z);
      const X = digitOf(s.c[a] & ~z);
      const Y = digitOf(s.c[b] & ~z);
      const pc = list(s.c[p]);
      const ac = list(s.c[a]);
      const bc = list(s.c[b]);
      if (
        fire(s, victims, z, (elim) => ({
          id: xy ? 'xy-wing' : 'xyz-wing',
          phases: [
            {
              text: `후보가 ${xy ? '2개' : '2~3개'}인 칸 세 개를 봐요. '축' ${J(cell(p), '은', '는')} ${pc}, 축을 보는 '집게' ${J(cell(a), '은', '는')} ${ac}, ${J(cell(b), '은', '는')} ${J(bc, '이에요', '예요')}.`,
              draw: { cells: [p, a, b], marks: [p, a, b].flatMap((i) => bits(s.c[i]).map((bb) => ({ i, d: digitOf(bb), tone: 'key' as Tone }))) },
            },
            {
              text: `경우 ①: 축이 ${J(X, '이', '가')} 되면 → 축을 보고 있는 ${J(cell(a), '은', '는')} ${J(X, '이', '가')} 될 수 없으니 ${J(Z, '이', '가')} 돼요.`,
              temp: { ghosts: [{ i: p, v: X, tone: 'on' }, { i: a, v: Z, tone: 'on' }], links: [{ a: [p, X], b: [a, X], strong: false }] },
            },
            {
              text: `경우 ②: 축이 ${J(Y, '이', '가')} 되면 → ${J(cell(b), '은', '는')} ${J(Y, '이', '가')} 될 수 없으니 ${J(Z, '이', '가')} 돼요.`,
              temp: { ghosts: [{ i: p, v: Y, tone: 'on' }, { i: b, v: Z, tone: 'on' }], links: [{ a: [p, Y], b: [b, Y], strong: false }] },
            },
            ...(xyz ? [{ text: `경우 ③: 축이 ${J(Z, '이', '가')} 되면 → 축 자신이 ${J(Z, '이에요', '예요')}.`, temp: { ghosts: [{ i: p, v: Z, tone: 'on' as const }] } }] : []),
            {
              text: `어떤 경우든 ${xyz ? '세 칸' : '두 집게'} 중 한 곳은 꼭 ${J(Z, '이', '가')} 돼요. 그러니 ${xyz ? '세 칸을' : '두 집게를'} 동시에 보는 칸(색칠한 곳)에는 ${J(Z, '이', '가')} 들어갈 수 없어요.`,
              draw: { area: victims, elim },
            },
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
        const X = digitOf(x);
        const Y = digitOf(y);
        const victims = PEERS[a].filter((i) => IS_PEER[b][i]);
        if (
          fire(s, victims, y, (elim) => ({
            id: 'w-wing',
            phases: [
              { text: `${J(cell(a), '과', '와')} ${J(cell(b), '은', '는')} 들어갈 수 있는 숫자가 똑같이 ${X}·${Y} 두 개예요.`, draw: { cells: [a, b], marks: [a, b].flatMap((i) => [X, Y].map((d) => ({ i, d, tone: 'key' as Tone }))) } },
              {
                text: `${unitName(u)}에서 ${J(X, '이', '가')} 들어갈 수 있는 곳은 ${J(cell(pa), '과', '와')} ${cell(qb)} 두 곳뿐이에요. 그러니 둘 중 하나는 꼭 ${J(X, '이에요', '예요')} (실선).`,
                draw: { area: u, cells: [pa, qb], marks: [pa, qb].map((i) => ({ i, d: X, tone: 'key' as Tone })), links: [{ a: [pa, X], b: [qb, X], strong: true }] },
              },
              {
                text: `만약 ${J(cell(a), '이', '가')} ${J(Y, '이', '가')} 아니라 ${J(X, '이', '가')} 된다면 → 그 칸을 보고 있는 ${J(cell(pa), '은', '는')} ${J(X, '이', '가')} 못 되고 → ${J(cell(qb), '이', '가')} ${J(X, '이', '가')} 돼요 → 그러면 ${J(cell(b), '은', '는')} ${J(X, '이', '가')} 못 되니 ${J(Y, '이', '가')} 돼요.`,
                temp: {
                  ghosts: [
                    { i: a, v: X, tone: 'on' },
                    { i: qb, v: X, tone: 'on' },
                    { i: b, v: Y, tone: 'on' },
                  ],
                  links: [
                    { a: [a, X], b: [pa, X], strong: false },
                    { a: [qb, X], b: [b, X], strong: false },
                  ],
                },
              },
              { text: `결국 두 칸 중 하나는 꼭 ${J(Y, '이에요', '예요')}. 두 칸을 동시에 보는 칸(색칠한 곳)에서 ${Y} 후보를 지워요.`, draw: { area: victims, elim } },
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
          const box = UNITS[2 * N + BOX[fins[0]]];
          const body = spots.filter((i) => covered.includes(i));
          const v = digitOf(bit);
          if (
            fire(s, covered.filter((i) => BOX[i] === BOX[fins[0]] && !lines.includes(i)), bit, (elim) => ({
              id: 'finned-x-wing',
              phases: [
                {
                  text: `숫자 ${v}만 생각해요. ${lineNames([base[r1], base[r2]])}의 ${v} 자리가 직사각형(X-윙) 모양이 될 뻔했는데, ${unitName(box)}에 초록색 '지느러미' 자리가 더 붙어 있어요.`,
                  draw: { area: lines, marks: [...body.map((i) => ({ i, d: v, tone: 'key' as Tone })), ...fins.map((i) => ({ i, d: v, tone: 'on' as Tone }))] },
                },
                {
                  text: `경우 ①: 지느러미 자리가 ${J(v, '이', '가')} 된다면 → 같은 ${unitName(box)}의 다른 칸에는 ${J(v, '이', '가')} 못 와요.`,
                  temp: { area: box, ghosts: [{ i: fins[0], v, tone: 'on' }] },
                },
                {
                  text: `경우 ②: 지느러미가 ${J(v, '이', '가')} 아니라면 → 남은 자리끼리 진짜 X-윙이 돼서, ${lineNames([cover[c1], cover[c2]])}의 다른 칸에는 ${J(v, '이', '가')} 못 와요.`,
                  temp: { area: covered, cells: body },
                },
                { text: `둘 중 어느 경우든, ${unitName(box)} 안이면서 그 두 줄 위에 있는 칸에는 ${J(v, '이', '가')} 못 와요. 그 칸에서 지워요.`, draw: { elim } },
              ],
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
 * 사슬 링크 하나를 말로 (왜 그런지까지). 처음이 아니면 앞 문장의 결과에서 이어지니 '→ 그러면 …' 으로 시작한다.
 * 같은 칸 안 링크는 '이 칸은' 으로 받는다.
 */
function linkText(l: Link, first: boolean, fresh: boolean): string {
  const [ai, ad] = l.a;
  const [bi, bd] = l.b;
  const same = ai === bi;
  // 서술이 새로 시작될 땐 '이 칸' 이 무엇인지 모르니 칸 이름으로
  const who = same && !fresh ? '이 칸은' : J(cell(bi), '은', '는');
  if (l.strong) {
    const why = same ? `이 칸엔 ${J(ad, '과', '와')} ${bd}만 들어갈 수 있으니까` : `${unitName(unitWith(ai, bi))}에서 ${J(ad, '이', '가')} 들어갈 곳은 이 두 칸뿐이니까`;
    const head = first ? `${J(cell(ai), '이', '가')} ${J(ad, '이', '가')} 아니면 →` : '그러면';
    return `${head} ${who} ${J(bd, '이에요', '예요')} (${why})`;
  }
  const why = same ? '한 칸엔 숫자 하나만 들어가니까' : '같은 줄이나 박스라서';
  const head = first ? `${J(cell(ai), '이', '가')} ${J(ad, '이', '가')} 된다면 →` : '그러면';
  return `${head} ${who} ${J(bd, '이', '가')} 될 수 없어요 (${why})`;
}

/** 사슬을 두 링크씩 끊어 서술로 — 이어지는 이야기처럼 */
function walk(links: Link[]): Phase[] {
  const out: Phase[] = [];
  for (let k = 0; k < links.length; k += 2) {
    const part = links.slice(k, k + 2);
    out.push({
      text: part.map((l, j) => linkText(l, k + j === 0, j === 0)).join('. ') + '.',
      draw: { links: part, marks: part.map((l) => ({ i: l.b[0], d: l.b[1], tone: l.strong ? ('on' as Tone) : ('off' as Tone) })) },
    });
  }
  return out;
}

/**
 * start 가 거짓이라고 두고 강한 링크(거짓→참)·약한 링크(참→거짓)를 번갈아 따라간다.
 * 참이 되는 노드에 start 와 같은 숫자가 있으면 둘 중 하나는 참이니, 두 칸을 다 보는 칸에서 그 숫자를 지운다.
 * 같은 노드가 참·거짓 둘 다 되거나 start 자신이 참이 되면 모순 → start 가 답.
 */
function chainFrom(s: State, [c0, b0]: Node, strong: (n: Node) => Node[], weak: (n: Node) => Node[], id: TechId): boolean {
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
  // 거짓(start)에서 출발해 node 가 참/거짓이 되기까지의 링크
  const path = (node: Node, isOn: boolean): Link[] => {
    const out: Link[] = [];
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
  const d0 = digitOf(b0);
  const start: Phase = {
    text: `${J(cell(c0), '이', '가')} ${J(d0, '이', '가')} 아니라고 해 볼게요. 그러면 어떻게 되는지 차례로 따라가요.`, draw: { marks: [{ i: c0, d: d0, tone: 'off' }] } };
  const clash = [...on.keys()].find((k) => off.has(k));
  if (clash != null) {
    const node: Node = [Math.floor(clash / 512), clash % 512];
    return put(s, c0, d0, () => {
      const nd = digitOf(node[1]);
      return {
        id,
        phases: [
          start,
          ...walk(path(node, true)).map((p, k) => (k ? p : { ...p, text: `첫 번째 길: ${p.text}` })),
          ...walk(path(node, false)).map((p, k) => (k ? p : { ...p, text: `두 번째 길: ${p.text}` })),
          {
            text: `두 길을 따라가 보니 ${cell(node[0])}에 대해 '${J(nd, '이에요', '예요')}'와 '${J(nd, '이', '가')} 아니에요'가 동시에 나왔어요. 말이 안 되죠! 처음 가정이 틀렸으니 ${J(cell(c0), '은', '는')} ${J(d0, '이에요', '예요')}.`,
            draw: { bad: [node[0]], place: { i: c0, v: d0 } },
          },
        ],
      };
    });
  }
  for (const [t, b] of hits) {
    if (b !== b0 || t === c0) continue;
    const victims = PEERS[c0].filter((i) => IS_PEER[t][i]);
    if (
      fire(s, victims, b0, (elim) => ({
        id,
        phases: [
          start,
          ...walk(path([t, b], true)),
          {
            text: `정리하면: ${J(cell(c0), '이', '가')} ${J(d0, '이', '가')} 아니면 ${J(cell(t), '이', '가')} ${J(d0, '이에요', '예요')}. 즉 두 칸 중 하나는 꼭 ${J(d0, '이에요', '예요')}. 그러니 두 칸을 동시에 보는 칸(색칠한 곳)에는 ${J(d0, '이', '가')} 들어갈 수 없어요.`,
            draw: { area: victims, elim },
          },
        ],
      }))
    )
      return true;
  }
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
    for (const i of partner.keys()) if (chainFrom(s, [i, bit], strong, weak, 'x-chain')) return true;
  }
  return false;
}

/** XY-사슬: 후보 2개짜리 칸만으로, 강한 링크 = 칸 안의 다른 후보, 약한 링크 = 같은 숫자를 가진 서로 보는 칸 */
function xyChains(s: State): boolean {
  const bivalue = (i: number) => count(s.c[i]) === 2;
  const strong = ([i, b]: Node): Node[] => [[i, s.c[i] & ~b]];
  const weak = ([i, b]: Node): Node[] => PEERS[i].filter((j) => bivalue(j) && s.c[j] & b).map((j) => [j, b]);
  for (let i = 0; i < CELLS; i++) if (bivalue(i)) for (const b of bits(s.c[i])) if (chainFrom(s, [i, b], strong, weak, 'xy-chain')) return true;
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
      const [A, B] = bits(m).map(digitOf);
      // 대각선 짝: 같은 행·열이 아닌 칸끼리 같은 숫자
      const diag = (i: number) => cells.find((k) => k !== i && Math.floor(k / N) !== Math.floor(i / N) && k % N !== i % N)!;
      const ghost = (a: number, b: number) =>
        cells.map((i) => ({ i, v: i === cells[0] || i === diag(cells[0]) ? a : b, tone: 'on' as const }));
      if (
        (s.c[odd] & m) === m &&
        fire(s, [odd], m, (elim) => ({
          id: 'unique-rectangle',
          phases: [
            {
              text: `테두리 친 네 칸이 직사각형을 이루고, 박스 두 개에 나뉘어 있어요. 그중 세 칸은 들어갈 수 있는 숫자가 ${A}·${B} 두 개뿐이에요.`,
              draw: { cells, marks: keyMarks(cells, m, s) },
            },
            { text: `만약 남은 ${cell(odd)}까지 ${A}나 ${J(B, '이', '가')} 된다면, 숫자가 이렇게 놓일 수 있는데…`, temp: { ghosts: ghost(A, B) } },
            { text: `${J(A, '과', '와')} ${J(B, '을', '를')} 서로 맞바꿔도 똑같이 말이 돼요. 그러면 답이 두 개가 되는데, 스도쿠 답은 딱 하나라서 이런 모양은 나올 수 없어요.`, temp: { ghosts: ghost(B, A) } },
            { text: `그러니 ${J(cell(odd), '은', '는')} ${A}도 ${B}도 아니에요. 두 후보를 지워요.`, draw: { elim } },
          ],
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
    if (b) {
      const v = digitOf(b);
      const tc = list(s.c[t]);
      return put(s, t, v, () => ({
        id: 'bug',
        phases: [
          { text: `빈칸들의 후보가 전부 2개씩인데, ${cell(t)}만 ${tc} 세 개예요.`, draw: { cells: [t], area: open } },
          { text: `모든 칸이 후보 2개면 답이 여러 개가 되는 모양이라 그럴 수 없어요. ${unitName(row)}에서 세 번 나오는 ${J(v, '이', '가')} 이 칸의 '남는' 숫자예요.`, draw: { area: row } },
          { text: `그래서 ${J(cell(t), '은', '는')} ${J(v, '이에요', '예요')}.`, draw: { place: { i: t, v } } },
        ],
      }));
    }
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
  for (let i = 0; i < CELLS; i++) for (const b of bits(s.c[i])) if (chainFrom(s, [i, b], strong, weak, 'aic')) return true;
  return false;
}

/** 빈칸인데 후보가 없거나, 유닛에 아직 없는 숫자가 들어갈 자리가 없으면 모순 (그 칸·유닛과 이유) */
function broken(s: State): { cells: number[]; why: string } | null {
  for (let i = 0; i < CELLS; i++) if (!s.g[i] && !s.c[i]) return { cells: [i], why: `${cell(i)}에 넣을 수 있는 숫자가 하나도 없어요` };
  for (const u of UNITS)
    for (let v = 1; v <= N; v++)
      if (!u.some((i) => s.g[i] === v) && !u.some((i) => s.c[i] & (1 << (v - 1)))) return { cells: u, why: `${unitName(u)}에 ${J(v, '이', '가')} 들어갈 자리가 없어요` };
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
      const { why, cells: badCells } = bad;
      const how = depth === 0 ? '쉬운 방법' : '사슬까지 쓰는 방법';
      return fire(s, [i], b, (elim) => ({
        id: 'forcing',
        phases: [
          { text: `여기서부터는 그냥은 더 못 풀어요. 그래서 ${cell(i)}에 ${J(v, '이', '가')} 들어간다고 일단 가정해 볼게요 (주황).`, draw: { assume: { i, v } } },
          ...(depth < 2
            ? [
                { text: `그렇다고 치고 ${how}로 계속 풀어 나가면, 초록 숫자 ${trail.length}개가 차례로 채워져요.`, draw: { trail } },
                { text: `그런데 ${why}! (빨간 곳) 말이 안 되는 상황이에요.`, draw: { bad: badCells } },
              ]
            : [{ text: `${why}. (사람이 찾기엔 아주 어려운 단계예요)`, draw: { bad: badCells } }]),
          { text: `처음 가정이 틀렸다는 뜻이에요. 그러니 ${J(cell(i), '은', '는')} ${J(v, '이', '가')} 아니에요. 찍은 게 아니라 '안 된다'는 걸 확인한 거예요.`, draw: { elim } },
        ],
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
