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
