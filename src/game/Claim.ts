import { bitCount, candidates, HINTS, type Grid } from './Sudoku';

export type ClaimEvent = { t: 'claim'; cell: number; id: number; hint: boolean } | { t: 'miss'; cell: number; id: number };

/**
 * 점령형 심판 (방장 쪽에서만 돈다).
 * 먼저 도착한 정답이 칸을 가져가고, 이미 찬 칸에 늦게 온 입력은 벌점 없이 무시한다.
 */
export class ClaimJudge {
  readonly grid: Grid;
  readonly scores = new Map<number, number>();
  private hintsUsed = new Map<number, number>();
  private frozenUntil = new Map<number, number>();

  constructor(
    puzzle: Grid,
    private readonly solution: Grid,
    private readonly freezeMs: number,
    private readonly hints = HINTS,
  ) {
    this.grid = puzzle.slice();
  }

  get full(): boolean {
    return this.grid.every(Boolean);
  }

  place(id: number, cell: number, v: number, hint: boolean, now: number): ClaimEvent | null {
    if (!Number.isInteger(cell) || cell < 0 || cell > 80) return null;
    if (hint) {
      const used = this.hintsUsed.get(id) ?? 0;
      if (used >= this.hints) return null;
      // 힌트를 누르는 사이 다른 사람이 가져갔으면 가장 쉬운 빈칸으로 대신 연다
      if (this.grid[cell]) cell = this.easiest();
      if (cell < 0) return null;
      this.hintsUsed.set(id, used + 1);
      v = this.solution[cell];
    } else if (this.grid[cell] || (this.frozenUntil.get(id) ?? 0) > now) return null;

    if (v === this.solution[cell]) {
      this.grid[cell] = v;
      this.scores.set(id, (this.scores.get(id) ?? 0) + 1);
      return { t: 'claim', cell, id, hint };
    }
    this.frozenUntil.set(id, now + this.freezeMs);
    this.scores.set(id, (this.scores.get(id) ?? 0) - 1);
    return { t: 'miss', cell, id };
  }

  private easiest(): number {
    let best = -1;
    let bestN = 10;
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i]) continue;
      const n = bitCount(candidates(this.grid, i));
      if (n < bestN) {
        bestN = n;
        best = i;
      }
    }
    return best;
  }

  /** 최고 점수 id, 공동 1위면 -1 */
  winner(ids: number[]): number {
    let best = -Infinity;
    let who = -1;
    for (const id of ids) {
      const s = this.scores.get(id) ?? 0;
      if (s > best) {
        best = s;
        who = id;
      } else if (s === best) who = -1;
    }
    return who;
  }
}
