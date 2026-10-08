import { describe, expect, it } from 'vitest';
import { explainNext, grade, J, logicSolve } from './Grade';
import { TECHS } from './Techniques';
import { countSolutions, generate, LEVELS, mulberry32, shuffle, type Grid, type Level } from './Sudoku';

/** 채점 필터 없이 힌트 수만 맞춘 판 (기술마다 골고루 걸리도록) */
function carve(target: number, rand: () => number): { puzzle: Grid; solution: Grid } {
  const solution = generate('easy', rand).solution;
  const puzzle = solution.slice();
  let clues = 81;
  for (const i of shuffle([...Array(41).keys()], rand)) {
    if (clues <= target) break;
    const pair = i === 40 ? [40] : [i, 80 - i];
    const saved = pair.map((k) => puzzle[k]);
    for (const k of pair) puzzle[k] = 0;
    if (countSolutions(puzzle) === 1) clues -= pair.length;
    else pair.forEach((k, n) => (puzzle[k] = saved[n]));
  }
  return { puzzle, solution };
}

describe('logicSolve', () => {
  it('기술은 정답 숫자를 놓치거나 지우지 않는다', () => {
    const seen = new Set<number>();
    for (let k = 0; k < 200; k++) {
      const { puzzle, solution } = carve(24, mulberry32(k));
      const r = logicSolve(puzzle);
      seen.add(r.tier);
      r.grid.forEach((v, i) => v && expect(v).toBe(solution[i]));
      r.cands.forEach((m, i) => r.grid[i] || expect(m & (1 << (solution[i] - 1))).toBeTruthy());
    }
    // 모든 단계가 실제로 한 번씩은 쓰였는지 (기술 하나가 통째로 안 돌아도 잡히게)
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('완성판은 0단계', () => {
    expect(grade(generate('easy', mulberry32(3)).solution)).toBe(0);
  });
});

describe('generate 난이도', () => {
  for (const level of Object.keys(LEVELS) as Level[])
    it(`${level}: 꼭 필요한 기술 단계가 ${LEVELS[level].tier}`, () => {
      for (const k of [1, 2, 3]) expect(grade(generate(level, mulberry32(k)).puzzle)).toBe(LEVELS[level].tier);
    });
});

describe('explainNext (풀이)', () => {
  it('변성대왕 판을 풀이만으로 끝까지 풀고, 매 단계가 정답과 어긋나지 않는다', () => {
    const { puzzle, solution } = generate('king', mulberry32(5));
    const grid = puzzle.slice();
    const ruledOut = new Array(81).fill(0);
    const names = new Set<string>();
    let guard = 0;
    while (grid.some((v) => !v) && guard++ < 81) {
      const steps = explainNext(grid, ruledOut);
      expect(steps.length).toBeGreaterThan(0);
      for (const st of steps) {
        names.add(st.id);
        expect(st.phases.length).toBeGreaterThan(1);
        for (const ph of st.phases) expect(ph.text.length).toBeGreaterThan(0);
        expect(TECHS[st.id]).toBeDefined();
        for (const { i, d } of st.elim) {
          expect(solution[i]).not.toBe(d);
          ruledOut[i] |= 1 << (d - 1);
        }
      }
      const last = steps[steps.length - 1];
      expect(last.place).toBeDefined();
      expect(last.place!.v).toBe(solution[last.place!.i]);
      grid[last.place!.i] = last.place!.v;
    }
    expect(grid).toEqual(solution);
    // 변성대왕이니 사람 기술로는 막히는 지점이 있어 가정(포싱)까지 쓰게 된다
    expect(names.has('forcing')).toBe(true);
  }, 60000);

  it('쉬운 판은 첫 풀이가 하나(single)로 바로 숫자를 정한다', () => {
    const { puzzle, solution } = generate('easy', mulberry32(2));
    const [st] = explainNext(puzzle);
    expect(st.id).toMatch(/single/);
    expect(st.place!.v).toBe(solution[st.place!.i]);
  });
});

describe('J (조사)', () => {
  it('받침 있으면 앞, 없으면 뒤', () => {
    expect(J(7, '이', '가')).toBe('7이');
    expect(J(2, '이', '가')).toBe('2가');
    expect(J('3행', '은', '는')).toBe('3행은');
    expect(J('2번 박스', '을', '를')).toBe('2번 박스를');
  });
});

describe('변성대왕 판 은행', () => {
  it('변형한 판도 막히는 지점(포싱)이 5번 이상이고, 끝까지 탐색하는 단계는 없다', () => {
    for (const k of [1, 2, 3, 4]) {
      const { puzzle, solution } = generate('king', mulberry32(k * 977));
      const grid = puzzle.slice();
      const ruledOut = new Array(81).fill(0);
      let forcing = 0;
      while (grid.some((v) => !v)) {
        const steps = explainNext(grid, ruledOut);
        for (const st of steps) {
          if (st.id === 'forcing') forcing++;
          // 끝까지 탐색(전수 대입)으로만 찾는 단계는 서술이 3단계다 — 추론으로 풀려야 하니 없어야 한다
          if (st.id === 'forcing') expect(st.phases.length).toBe(4);
          for (const e of st.elim) ruledOut[e.i] |= 1 << (e.d - 1);
        }
        const p = steps[steps.length - 1].place!;
        expect(p.v).toBe(solution[p.i]);
        grid[p.i] = p.v;
      }
      // 돌리거나 뒤집으면 기법을 찾는 순서가 달라져 횟수가 조금 바뀐다 (은행엔 10번 이상인 판만 넣었다)
      expect(forcing).toBeGreaterThanOrEqual(5);
    }
  }, 60000);
});

describe('6×6 지옥·변성대왕', () => {
  it('지옥은 중급 사슬(tier 3), 변성대왕은 AIC 이상(tier 4+)이 꼭 필요하다', () => {
    for (const k of [1, 2]) {
      expect(grade(generate('hell', mulberry32(k), 6).puzzle)).toBe(3);
      expect(grade(generate('king', mulberry32(k), 6).puzzle)).toBeGreaterThanOrEqual(4);
    }
  });
});
