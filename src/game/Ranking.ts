import { bitCount } from './Sudoku';

/** 한 사람의 기록. ms = 완주 시간(못 끝냈으면 null), score = 점령형 점수 */
export interface Entry {
  id: number;
  filled: number;
  ms: number | null;
  score?: number;
  gaveUp?: boolean;
  /** 실수 횟수 — 기록이 같으면 적은 쪽이 앞선다 */
  mistakes?: number;
  /** 실수 하나에 더해지는 시간 (난이도마다 다르다, 없으면 MISTAKE_PENALTY_MS) */
  penaltyMs?: number;
  /** 자동 메모로 아낀 시간만큼 더해지는 벌점(ms) 합 */
  autoMs?: number;
  /** 쓴 힌트 수 — 하나에 HINT_PENALTY_MS */
  hints?: number;
}

const fewer = (a: Entry, b: Entry) => (a.mistakes ?? 0) - (b.mistakes ?? 0);

/** 개인판 규칙: 레이스형(싱글 포함) · 아이템전 · 점령형 */
export type Mode = 'race' | 'item' | 'claim';

/** 바로 채점하는 판(초급·중급, 아이템전): 실수 하나에 — 손이 미끄러진 것까지 무겁게 물지 않게 가볍게 */
export const MISTAKE_PENALTY_MS = 10_000;
/** 다 채우고 채점하는 판(고급·지옥): 채점에서 틀린 칸 하나에 */
export const GRADED_PENALTY_MS = 60_000;
/** 변성대왕: 추론 없이 찍는 사람이 많아서 틀린 칸 하나에 7분 */
export const KING_PENALTY_MS = 7 * 60_000;
/** 힌트 하나에 */
export const HINT_PENALTY_MS = 60_000;
/** 다 채우고 채점하는 판: 틀린 채로 이만큼 채점되면 탈락 (막 찍는 사람 거르기) */
export const GRADE_TRIES = 5;

/**
 * 맞았는지 바로 알려 주지 않고 다 채운 뒤 채점하는지. 바로 알려 주면 두 후보 중 하나를 넣어 보는 '찍고 확인' 이 되니
 * 고급부터는 숨긴다 — 대신 채점 전엔 몇 번을 고쳐도 벌점이 없다. 점령형(먼저 맞힌 사람이 가져감)·아이템전(연속 정답 콤보)은
 * 바로 채점해야 규칙이 돌아서 예외 (변성대왕은 아이템전에서도 숨긴다)
 */
export const gradedLater = (level: string, mode: Mode = 'race'): boolean =>
  level === 'king' ? mode !== 'claim' : (level === 'hard' || level === 'hell') && mode === 'race';

export const penaltyFor = (level: string, mode: Mode = 'race'): number =>
  level === 'king' ? KING_PENALTY_MS : gradedLater(level, mode) ? GRADED_PENALTY_MS : MISTAKE_PENALTY_MS;
/** '30초' · '7분' */
export const penaltyText = (ms: number): string => (ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000}분` : `${Math.round(ms / 1000)}초`);

/** 최종 기록 = 완주 시간 + 실수 벌점 + 힌트 벌점 + 자동 메모 벌점 (못 끝냈으면 null) */
export const finalMs = (e: Entry): number | null =>
  e.ms == null ? null : e.ms + (e.mistakes ?? 0) * (e.penaltyMs ?? MISTAKE_PENALTY_MS) + (e.hints ?? 0) * HINT_PENALTY_MS + (e.autoMs ?? 0);

/** 자동 메모 벌점: 사람이 손으로 채웠다면 걸렸을 시간 — 빈칸 하나 훑기 + 후보 하나 적기, 여기에 검증 시간 */
export const AUTO_SCAN_MS = 3000;
export const AUTO_MARK_MS = 800;
export const AUTO_VERIFY = 1.2;

/**
 * 자동 메모 전후 메모(칸마다 후보 비트)를 견줘 벌점을 매긴다. 메모가 달라진 칸만 센다 —
 * 연달아 눌러도 두 번 물지 않고, 손으로 이미 적어 둔 후보는 빼 준다. 초 단위로 반올림.
 */
export function autoNotePenaltyMs(before: number[], after: number[]): number {
  let ms = 0;
  for (let i = 0; i < after.length; i++) {
    if (before[i] === after[i]) continue;
    ms += AUTO_SCAN_MS + bitCount(after[i] & ~before[i]) * AUTO_MARK_MS;
  }
  return Math.round((ms * AUTO_VERIFY) / 1000) * 1000;
}

/** 레이스: 완주한 사람은 최종 기록(시간 + 실수 벌점)순, 못 끝낸 사람은 그 뒤에 채운 칸 많은 순. 같으면 실수 적은 순 */
export function rankRace<T extends Entry>(es: T[]): T[] {
  return [...es].sort((a, b) => {
    if (a.ms != null && b.ms != null) return finalMs(a)! - finalMs(b)! || fewer(a, b);
    if (a.ms != null) return -1;
    if (b.ms != null) return 1;
    return b.filled - a.filled || fewer(a, b);
  });
}

/** 점령형: 점수 높은 순, 같으면 가져간 칸 많은 순, 그다음 실수 적은 순 */
export function rankScore<T extends Entry>(es: T[]): T[] {
  return [...es].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.filled - a.filled || fewer(a, b));
}

/** 정렬된 목록의 등수 (같은 기록이면 같은 등수: 1, 2, 2, 4) */
export function places(sorted: Entry[], claim: boolean): number[] {
  const same = (a: Entry, b: Entry) =>
    (a.mistakes ?? 0) === (b.mistakes ?? 0) &&
    (claim ? (a.score ?? 0) === (b.score ?? 0) && a.filled === b.filled : a.ms != null || b.ms != null ? finalMs(a) === finalMs(b) : a.filled === b.filled);
  return sorted.map((e, i) => {
    let k = i;
    while (k > 0 && same(sorted[k - 1], e)) k--;
    return k + 1;
  });
}
