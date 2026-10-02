import type { Level } from '../game/Sudoku';

export interface PlayerInfo {
  id: number;
  name: string;
}

/** claim = 점령형(한 판을 같이 채우고 맞힌 칸 수로 승부), race = 레이스형(각자 풀고 먼저 완성) */
export type Rule = 'claim' | 'race';

export const RULES: Record<Rule, { label: string; desc: string }> = {
  claim: { label: '점령형', desc: '한 판을 같이 채워요. 맞히면 +1, 틀리면 -1 에 2초 정지. 판이 다 차면 점수가 높은 사람이 승리!' },
  race: { label: '레이스형', desc: '같은 퍼즐을 각자 풀어요. 가장 먼저 완성한 사람이 승리!' },
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
  | { t: 'finish'; id: number; ms: number }
  | { t: 'place'; cell: number; v: number; hint: boolean }
  | { t: 'claim'; cell: number; id: number; hint: boolean }
  | { t: 'miss'; cell: number; id: number }
  /** winner -1 = 공동 1위 */
  | { t: 'result'; winner: number; ms: number }
  | { t: 'chat'; id: number; name: string; text: string }
  | { t: 'back' };

export const NAME_MAX = 12;
export const CHAT_MAX = 200;

export function cleanText(s: unknown, max: number): string {
  return String(s ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, max);
}
