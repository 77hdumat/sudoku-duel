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
}

const fewer = (a: Entry, b: Entry) => (a.mistakes ?? 0) - (b.mistakes ?? 0);

/** 레이스 계열: 실수 하나에 더해지는 시간 */
export const MISTAKE_PENALTY_MS = 10_000;
/** 지옥·변성대왕: 추론 없이 찍는 사람이 많아서 실수 하나에 7분 */
export const HELL_PENALTY_MS = 7 * 60_000;

export const penaltyFor = (level: string): number => (level === 'hell' || level === 'king' ? HELL_PENALTY_MS : MISTAKE_PENALTY_MS);
/** '10초' · '7분' */
export const penaltyText = (ms: number): string => (ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000}분` : `${Math.round(ms / 1000)}초`);

/** 최종 기록 = 완주 시간 + 실수 벌점 (못 끝냈으면 null) */
export const finalMs = (e: Entry): number | null => (e.ms == null ? null : e.ms + (e.mistakes ?? 0) * (e.penaltyMs ?? MISTAKE_PENALTY_MS));

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
