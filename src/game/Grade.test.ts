import { describe, expect, it } from 'vitest';
import { grade, logicSolve } from './Grade';
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
    for (let k = 0; k < 120; k++) {
      const { puzzle, solution } = carve(24, mulberry32(k));
      const r = logicSolve(puzzle);
      seen.add(r.tier);
      r.grid.forEach((v, i) => v && expect(v).toBe(solution[i]));
      r.cands.forEach((m, i) => r.grid[i] || expect(m & (1 << (solution[i] - 1))).toBeTruthy());
    }
    // 모든 단계가 실제로 한 번씩은 쓰였는지 (기술 하나가 통째로 안 돌아도 잡히게)
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
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
