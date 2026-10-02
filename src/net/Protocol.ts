import type { Level } from '../game/Sudoku';

export interface PlayerInfo {
  id: number;
  name: string;
}

/** claim = 점령형(한 판을 같이 채우고 점수로 승부), race = 레이스형(각자 풀고 완주 시간 순위) */
export type Rule = 'claim' | 'race';

export const RULES: Record<Rule, { label: string; desc: string }> = {
  claim: { label: '점령형', desc: '한 판을 같이 채워요. 맞히면 +1, 틀리면 -1 에 2초 정지. 판이 다 차면 점수가 높은 사람이 승리!' },
  race: { label: '레이스형', desc: '같은 퍼즐을 각자 풀어요. 완주한 순서대로 시간이 기록되고, 모두 끝나면 순위 발표!' },
};

export const MAX_PLAYERS = 3;
export const FREEZE_MS = 2000;

/**
 * 호스트 중계 스타형. id 0 = 호스트, 게스트는 접속 순서대로 1..
 * 게스트가 보낸 id·name 은 믿지 않고 호스트가 연결 슬롯 기준으로 덮어쓴다.
 * 점령형 판정(정답·오답·힌트 횟수·정지)은 전부 호스트가 하고 claim/miss 로 알린다.
 */
export type Msg =
  | { t: 'hb'; t0: number }
  | { t: 'welcome'; id: number }
  | { t: 'full'; why: 'slots' | 'playing' }
  | { t: 'hello'; name: string }
  | { t: 'lobby'; players: PlayerInfo[]; level: Level; rule: Rule }
  | { t: 'start'; puzzle: string; level: Level; rule: Rule }
  | { t: 'progress'; id: number; filled: number; mistakes: number }
  /** 레이스형: 게스트 → 방장 완주 보고 / 포기 */
  | { t: 'finish'; id: number; ms: number }
  | { t: 'giveup' }
  /** 레이스형: 방장 → 모두, 누가 완주·포기했는지 */
  | { t: 'finished'; id: number; ms: number }
  | { t: 'gaveup'; id: number }
  | { t: 'place'; cell: number; v: number; hint: boolean }
  | { t: 'claim'; cell: number; id: number; hint: boolean }
  | { t: 'miss'; cell: number; id: number }
  /** 최종 기록 — 순위는 받는 쪽이 규칙대로 정렬한다 (Ranking.ts) */
  | { t: 'result'; rows: ResultRow[] }
  | { t: 'chat'; id: number; name: string; text: string }
  | { t: 'back' };

export interface ResultRow {
  id: number;
  filled: number;
  ms: number | null;
  score?: number;
  gaveUp?: boolean;
}

export const NAME_MAX = 12;
export const CHAT_MAX = 200;

export function cleanText(s: unknown, max: number): string {
  return String(s ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, max);
}
