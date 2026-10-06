import { describe, expect, it } from 'vitest';
import { ClaimJudge } from './Claim';
import { generate, mulberry32 } from './Sudoku';

describe('ClaimJudge', () => {
  const { puzzle, solution } = generate('easy', mulberry32(5));
  const empties = puzzle.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  const [a, b] = empties;
  const wrong = (i: number) => (solution[i] % 9) + 1;

  it('먼저 온 정답이 칸을 가져가고, 늦은 입력은 무시', () => {
    const j = new ClaimJudge(puzzle, solution, 2000);
    expect(j.place(1, a, solution[a], false, 0)).toEqual({ t: 'claim', cell: a, id: 1, hint: false });
    expect(j.place(2, a, solution[a], false, 0)).toBeNull();
    expect(j.place(2, a, wrong(a), false, 0)).toBeNull();
    expect(j.scores.get(1)).toBe(1);
    expect(j.scores.get(2)).toBeUndefined();
  });

  it('오답은 -1 점에 정지, 정지 중 입력 무시', () => {
    const j = new ClaimJudge(puzzle, solution, 2000);
    expect(j.place(1, a, wrong(a), false, 0)).toEqual({ t: 'miss', cell: a, id: 1 });
    expect(j.scores.get(1)).toBe(-1);
    expect(j.place(1, b, solution[b], false, 1999)).toBeNull();
    expect(j.place(1, b, solution[b], false, 2000)?.t).toBe('claim');
  });

  it('힌트는 3번까지, 찬 칸에 쓰면 다른 빈칸을 연다', () => {
    const j = new ClaimJudge(puzzle, solution, 2000);
    j.place(2, a, solution[a], false, 0);
    const ev = j.place(1, a, 0, true, 0);
    expect(ev?.t).toBe('claim');
    expect(ev?.cell).not.toBe(a);
    expect(j.place(1, b, 0, true, 0)?.t).toBe('claim');
    expect(j.place(1, empties[5], 0, true, 0)?.t).toBe('claim');
    expect(j.place(1, empties[6], 0, true, 0)).toBeNull();
    expect(j.scores.get(1)).toBe(3);
  });

  it('방장이 고른 힌트 수만큼만 (0 이면 힌트 없음)', () => {
    const none = new ClaimJudge(puzzle, solution, 0, 0);
    expect(none.place(1, a, 0, true, 0)).toBeNull();
    const one = new ClaimJudge(puzzle, solution, 0, 1);
    expect(one.place(1, a, 0, true, 0)?.t).toBe('claim');
    expect(one.place(1, b, 0, true, 0)).toBeNull();
  });

  it('잘못된 칸 번호는 무시', () => {
    const j = new ClaimJudge(puzzle, solution, 2000);
    expect(j.place(1, 81, 1, false, 0)).toBeNull();
    expect(j.place(1, -1, 1, true, 0)).toBeNull();
    expect(j.place(1, 1.5, 1, false, 0)).toBeNull();
  });

  it('판이 다 차면 full, 최고점 승리·동점은 -1', () => {
    const j = new ClaimJudge(puzzle, solution, 0);
    empties.forEach((c, k) => j.place(k % 2 ? 1 : 2, c, solution[c], false, 0));
    expect(j.full).toBe(true);
    const s1 = j.scores.get(1)!;
    const s2 = j.scores.get(2)!;
    expect(j.winner([0, 1, 2])).toBe(s1 === s2 ? -1 : s1 > s2 ? 1 : 2);
    const t = new ClaimJudge(puzzle, solution, 0);
    t.place(1, a, solution[a], false, 0);
    t.place(2, b, solution[b], false, 0);
    expect(t.winner([1, 2])).toBe(-1);
  });
});
