import { bitCount, candidates, type Grid, type Level } from './Sudoku';

export interface AiProfile {
  name: string;
  avatar: string;
  blurb: string;
  /** 칸당 기본 고민 시간(초). 후보가 많은 칸일수록 길어진다 */
  sec: number;
  /** 칸마다 틀린 숫자를 넣을 확률. 틀리면 잠시 뒤 알아채고 고친다 */
  mistake: number;
  /**
   * 막힘: 칸마다 STALL_P 확률로 평균 이만큼(초) 더 멈춘다.
   * 사람처럼 술술 풀다 막히다를 반복 — 몰아칠 땐 콤보가 나오고, 전체 완주 시간은 판 난이도만큼 길어진다
   */
  stall: number;
}

const STALL_P = 0.3;

export const AI_PROFILES: Record<Level, AiProfile> = {
  easy: { name: '꼬마봇', avatar: 'assets/bot-easy.svg', blurb: '느긋하게 풀고 가끔 실수해요', sec: 9, mistake: 0.08, stall: 12 },
  medium: { name: '스도봇', avatar: 'assets/bot-medium.svg', blurb: '꾸준한 속도의 모범생', sec: 6, mistake: 0.04, stall: 26 },
  hard: { name: '마스터봇', avatar: 'assets/bot-hard.svg', blurb: '몰아칠 땐 빠르고 거의 틀리지 않아요', sec: 4, mistake: 0.015, stall: 50 },
  hell: { name: '지옥봇', avatar: 'assets/bot-hard.svg', blurb: '자동 메모를 써도 쉽지 않을걸요', sec: 3, mistake: 0.01, stall: 80 },
  king: { name: '변성대왕', avatar: 'assets/bot-hard.svg', blurb: '사슬로도 안 풀리는 판만 골라 와요', sec: 2.5, mistake: 0.005, stall: 120 },
};

/**
 * 사람처럼 푸는 척하는 AI: 후보가 가장 적은(쉬운) 칸부터 채우고,
 * 칸마다 후보 수에 비례해 고민하며, 확률적으로 틀렸다가 고친다.
 */
export class AiSolver {
  readonly grid: Grid;
  readonly total: number;
  filled = 0;
  mistakes = 0;
  /** 지금 틀린 숫자가 들어가 있는 칸 (-1 = 없음) */
  wrongCell = -1;
  /** 방금 손댄 칸 (미니보드 표시용) */
  lastCell = -1;
  private wait: number;

  constructor(
    puzzle: Grid,
    private readonly solution: Grid,
    private readonly profile: AiProfile,
    private readonly rand: () => number = Math.random,
  ) {
    this.grid = puzzle.slice();
    this.total = puzzle.filter((v) => !v).length;
    this.wait = profile.sec * (1 + rand());
  }

  /** 침에 맞음: 그동안 손을 못 댄다 */
  stun(sec: number): void {
    this.wait += sec;
  }

  get done(): boolean {
    return this.filled >= this.total;
  }

  update(dt: number): void {
    this.wait -= dt;
    while (this.wait <= 0 && !this.done) this.act();
  }

  private act(): void {
    const { profile: p, rand } = this;
    if (this.wrongCell >= 0) {
      const i = this.wrongCell;
      this.grid[i] = this.solution[i];
      this.filled++;
      this.wrongCell = -1;
      this.lastCell = i;
      this.wait += p.sec * (0.4 + 0.4 * rand());
      return;
    }
    let best = -1;
    let bestCnt = 10;
    for (let i = 0; i < 81; i++) {
      if (this.grid[i]) continue;
      const n = bitCount(candidates(this.grid, i));
      if (n < bestCnt) {
        best = i;
        bestCnt = n;
      }
    }
    this.lastCell = best;
    const think = p.sec * (0.55 + 0.15 * bestCnt) * (0.75 + 0.5 * rand());
    const stuck = rand() < STALL_P ? p.stall * (0.5 + rand()) : 0;
    if (rand() < p.mistake) {
      const sol = this.solution[best];
      this.grid[best] = ((sol + Math.floor(rand() * 8)) % 9) + 1;
      this.mistakes++;
      this.wrongCell = best;
      this.wait += think * 0.6;
      return;
    }
    this.grid[best] = this.solution[best];
    this.filled++;
    this.wait += think + stuck;
  }
}
