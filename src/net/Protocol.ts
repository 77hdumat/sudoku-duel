import type { Level } from '../game/Sudoku';

export interface PlayerInfo {
  id: number;
  name: string;
}

/**
 * claim = 점령형(한 판을 같이 채우고 점수로 승부), race = 레이스형(각자 풀고 완주 시간 순위),
 * item = 아이템전(레이스형 + 빠른 3콤보로 나 빼고 전원에게 침 퉤)
 */
export type Rule = 'claim' | 'race' | 'item';

/** 각자 자기 판을 푸는 규칙 (레이스형·아이템전) */
export const isRace = (r: Rule) => r !== 'claim';

export const RULES: Record<Rule, { label: string; desc: string }> = {
  claim: { label: '점령형', desc: '한 판을 같이 채워요. 맞히면 +1, 틀리면 -1 에 2초 정지. 판이 다 차면 점수가 높은 사람이 승리!' },
  race: { label: '레이스형', desc: '같은 퍼즐을 각자 풀어요. 기록 = 완주 시간 + 실수당 10초. 모두 끝나면 순위 발표!' },
  item: { label: '아이템전', desc: '레이스형 + 5초 안에 3연속으로 맞히면 나 빼고 전원에게 침 퉤! 맞은 사람은 1.5초 동안 판이 안 보여요(또 맞으면 늘어나요). 실수당 +10초.' },
};

export const MAX_PLAYERS = 5;
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
  /** cells: 미리보기용 81 글자 (g 주어진 칸, 1 맞게 채운 칸, 0 빈칸) */
  | { t: 'progress'; id: number; filled: number; mistakes: number; cells?: string }
  /** 레이스형: 게스트 → 방장 완주 보고 / 포기 */
  | { t: 'finish'; id: number; ms: number }
  | { t: 'giveup' }
  /** 레이스형: 방장 → 모두, 누가 완주·포기했는지 */
  | { t: 'finished'; id: number; ms: number }
  | { t: 'gaveup'; id: number }
  /** 아이템전: 게스트 → 방장 콤보 공격, 방장 → 모두 누가 누구에게 */
  | { t: 'attack' }
  /** to = 맞은 사람들(본인 뺀 푸는 중인 전원), say = 각자의 리액션 번호 (SPIT_REACTIONS) */
  | { t: 'spit'; from: number; to: number[]; say: number[] }
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
  mistakes?: number;
}

export const NAME_MAX = 12;
export const CHAT_MAX = 200;

export function cleanText(s: unknown, max: number): string {
  return String(s ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, max);
}
