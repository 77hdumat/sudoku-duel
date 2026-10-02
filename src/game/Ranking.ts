/** 한 사람의 기록. ms = 완주 시간(못 끝냈으면 null), score = 점령형 점수 */
export interface Entry {
  id: number;
  filled: number;
  ms: number | null;
  score?: number;
  gaveUp?: boolean;
}

/** 레이스: 완주한 사람은 시간순, 못 끝낸 사람은 그 뒤에 채운 칸 많은 순 */
export function rankRace<T extends Entry>(es: T[]): T[] {
  return [...es].sort((a, b) => {
    if (a.ms != null && b.ms != null) return a.ms - b.ms;
    if (a.ms != null) return -1;
    if (b.ms != null) return 1;
    return b.filled - a.filled;
  });
}

/** 점령형: 점수 높은 순, 같으면 가져간 칸 많은 순 */
export function rankScore<T extends Entry>(es: T[]): T[] {
  return [...es].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.filled - a.filled);
}

/** 정렬된 목록의 등수 (같은 기록이면 같은 등수: 1, 2, 2, 4) */
export function places(sorted: Entry[], claim: boolean): number[] {
  const same = (a: Entry, b: Entry) =>
    claim ? (a.score ?? 0) === (b.score ?? 0) && a.filled === b.filled : a.ms != null || b.ms != null ? a.ms === b.ms : a.filled === b.filled;
  return sorted.map((e, i) => {
    let k = i;
    while (k > 0 && same(sorted[k - 1], e)) k--;
    return k + 1;
  });
}
