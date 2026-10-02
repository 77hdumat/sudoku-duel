import type { Level } from '../game/Sudoku';

export interface PlayerInfo {
  id: number;
  name: string;
}

/**
 * 호스트 중계 스타형. id 0 = 호스트, 게스트는 접속 순서대로 1..
 * 게스트가 보낸 id·name 은 믿지 않고 호스트가 연결 슬롯 기준으로 덮어쓴다.
 */
export type Msg =
  | { t: 'hb'; t0: number }
  | { t: 'welcome'; id: number }
  | { t: 'full'; why: 'slots' | 'playing' }
  | { t: 'hello'; name: string }
  | { t: 'lobby'; players: PlayerInfo[]; level: Level }
  | { t: 'start'; puzzle: string; level: Level }
  | { t: 'progress'; id: number; filled: number; mistakes: number }
  | { t: 'finish'; id: number; ms: number }
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
