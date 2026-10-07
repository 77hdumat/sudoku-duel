import { describe, expect, it } from 'vitest';
import { AI_PROFILES, AiSolver } from './Ai';
import { candidates, countSolutions, fromStr, generate, geo, LEVELS, levelsFor, mulberry32, pruneNotes, solve, toStr, type Level } from './Sudoku';

const PEERS = geo(81).peers;

function valid(g: number[]): boolean {
  const G = geo(g.length);
  return g.every((v, i) => v >= 1 && v <= G.n && G.peers[i].every((p) => g[p] !== v));
}

describe('Sudoku', () => {
  it('PEERS 는 칸마다 20개 (6×6 은 12개)', () => {
    expect(PEERS.every((p) => p.length === 20)).toBe(true);
    expect(geo(36).peers.every((p) => p.length === 12)).toBe(true);
  });

  it('6×6 박스는 가로 3 × 세로 2', () => {
    expect(geo(36).units[12]).toEqual([0, 1, 2, 6, 7, 8]);
    expect(geo(36).units[13]).toEqual([3, 4, 5, 9, 10, 11]);
  });

  for (const level of levelsFor(6))
    it(`6×6 ${level}: 유일해이고 정답과 일치하며 대칭이다`, () => {
      const { puzzle, solution } = generate(level, mulberry32(42), 6);
      expect(puzzle.length).toBe(36);
      expect(valid(solution)).toBe(true);
      expect(puzzle.every((v, i) => !v || v === solution[i])).toBe(true);
      expect(countSolutions(puzzle)).toBe(1);
      expect(puzzle.every((v, i) => !v === !puzzle[35 - i])).toBe(true);
      expect(fromStr(toStr(puzzle))).toEqual(puzzle);
    });

  it('빈 판은 해가 여러 개', () => {
    expect(countSolutions(new Array(81).fill(0))).toBe(2);
  });

  it('candidates 는 같은 행·열·박스 숫자를 뺀다', () => {
    const g = new Array(81).fill(0);
    g[1] = 5; // 같은 행
    g[9] = 7; // 같은 열
    g[10] = 3; // 같은 박스
    expect(candidates(g, 0)).toBe(0x1ff & ~(1 << 4) & ~(1 << 6) & ~(1 << 2));
  });

  for (const level of Object.keys(LEVELS) as Level[]) {
    it(`${level}: 유일해이고 정답과 일치한다`, () => {
      const { puzzle, solution } = generate(level, mulberry32(42));
      expect(valid(solution)).toBe(true);
      expect(puzzle.every((v, i) => !v || v === solution[i])).toBe(true);
      expect(countSolutions(puzzle)).toBe(1);
      expect(solve(puzzle)).toEqual(solution);
      const clues = puzzle.filter(Boolean).length;
      expect(clues).toBeGreaterThanOrEqual(LEVELS[level].clues - 1);
      expect(clues).toBeLessThanOrEqual(LEVELS[level].clues + 8);
      expect(puzzle.every((v, i) => !v === !puzzle[80 - i])).toBe(true);
    });
  }

  it('문자열 왕복', () => {
    const { puzzle } = generate('easy', mulberry32(1));
    expect(fromStr(toStr(puzzle))).toEqual(puzzle);
  });
});

describe('AiSolver', () => {
  const { puzzle, solution } = generate('medium', mulberry32(7));

  function finishTime(level: Level, seed: number, p = puzzle, sol = solution): number {
    const ai = new AiSolver(p, sol, AI_PROFILES[level], mulberry32(seed));
    let t = 0;
    while (!ai.done) {
      ai.update(0.5);
      t += 0.5;
    }
    expect(ai.grid).toEqual(sol);
    expect(ai.wrongCell).toBe(-1);
    return t;
  }

  it('끝까지 풀면 정답과 같다', () => {
    finishTime('easy', 3);
  });

  it('높은 난이도일수록 몰아칠 때 손은 빠르다', () => {
    expect(AI_PROFILES.easy.sec).toBeGreaterThan(AI_PROFILES.medium.sec);
    expect(AI_PROFILES.medium.sec).toBeGreaterThan(AI_PROFILES.hard.sec);
  });

  it('자기 난이도 판에서는 높은 난이도일수록 완주가 오래 걸린다', () => {
    const avg = (l: Level) =>
      [1, 2, 3, 4, 5].reduce((s, k) => {
        const g = generate(l, mulberry32(k));
        return s + finishTime(l, k, g.puzzle, g.solution);
      }, 0) / 5;
    const [e, m, h] = [avg('easy'), avg('medium'), avg('hard')];
    expect(m).toBeGreaterThan(e);
    expect(h).toBeGreaterThan(m);
    // 고급도 사람이 붙어 볼 만한 시간 (예전엔 2분대에 끝나 의욕이 꺾였다)
    expect(h).toBeGreaterThan(10 * 60);
  });
});

describe('pruneNotes', () => {
  const { puzzle, solution } = generate('easy', mulberry32(7));
  const empty = puzzle.findIndex((v) => !v);
  const peer = PEERS[empty].find((p) => !puzzle[p] && solution[p] !== solution[empty])!;
  const all = 0x1ff;

  it('맞게 놓인 숫자(주어진 칸 포함)는 같은 행·열·박스 메모에서 빠진다', () => {
    const grid = puzzle.slice();
    grid[peer] = solution[peer];
    const notes = new Array(81).fill(0);
    notes[empty] = all;
    pruneNotes(grid, solution, notes);
    expect(notes[empty] & (1 << (solution[peer] - 1))).toBe(0);
    expect(notes[empty]).toBe(candidates(grid, empty));
    expect(notes[peer]).toBe(0);
  });

  it('틀린 숫자는 기준이 아니다 — 메모를 지우지 않는다', () => {
    const grid = puzzle.slice();
    const wrong = (solution[peer] % 9) + 1;
    grid[peer] = wrong;
    const notes = new Array(81).fill(0);
    notes[empty] = all;
    notes[peer] = all;
    pruneNotes(grid, solution, notes);
    expect(notes[empty]).toBe(candidates(puzzle, empty));
    expect(notes[peer]).toBe(candidates(puzzle, peer));
  });
});
