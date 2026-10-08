import { describe, expect, it } from 'vitest';
import { AUTO_MARK_MS, AUTO_SCAN_MS, AUTO_VERIFY, autoNotePenaltyMs, finalMs, GRADED_PENALTY_MS, gradedLater, HINT_PENALTY_MS, KING_PENALTY_MS, MISTAKE_PENALTY_MS, penaltyFor, places, rankRace, rankScore, type Entry } from './Ranking';

describe('Ranking', () => {
  it('레이스: 완주자는 시간순, 미완주는 뒤에서 진행 많은 순', () => {
    const es: Entry[] = [
      { id: 1, filled: 30, ms: null },
      { id: 2, filled: 41, ms: 200_000 },
      { id: 3, filled: 41, ms: 150_000 },
      { id: 4, filled: 35, ms: null, gaveUp: true },
    ];
    expect(rankRace(es).map((e) => e.id)).toEqual([3, 2, 4, 1]);
  });

  it('점령형: 점수순, 동점이면 칸 수', () => {
    const es: Entry[] = [
      { id: 1, filled: 10, ms: null, score: 8 },
      { id: 2, filled: 12, ms: null, score: 8 },
      { id: 3, filled: 15, ms: null, score: 12 },
    ];
    expect(rankScore(es).map((e) => e.id)).toEqual([3, 2, 1]);
  });

  it('같은 기록은 같은 등수', () => {
    const race = rankRace<Entry>([
      { id: 1, filled: 41, ms: 100 },
      { id: 2, filled: 20, ms: null },
      { id: 3, filled: 20, ms: null },
      { id: 4, filled: 5, ms: null },
    ]);
    expect(places(race, false)).toEqual([1, 2, 2, 4]);
    const claim = rankScore<Entry>([
      { id: 1, filled: 5, ms: null, score: 5 },
      { id: 2, filled: 5, ms: null, score: 5 },
      { id: 3, filled: 9, ms: null, score: 9 },
    ]);
    expect(places(claim, true)).toEqual([1, 2, 2]);
  });

  it('기록이 같으면 실수 적은 쪽이 앞선다', () => {
    const race = rankRace<Entry>([
      { id: 1, filled: 41, ms: 100, mistakes: 3 },
      { id: 2, filled: 41, ms: 100, mistakes: 1 },
      { id: 3, filled: 20, ms: null, mistakes: 2 },
      { id: 4, filled: 20, ms: null, mistakes: 0 },
    ]);
    expect(race.map((e) => e.id)).toEqual([2, 1, 4, 3]);
    expect(places(race, false)).toEqual([1, 2, 3, 4]);
    const claim = rankScore<Entry>([
      { id: 1, filled: 5, ms: null, score: 5, mistakes: 2 },
      { id: 2, filled: 5, ms: null, score: 5, mistakes: 0 },
    ]);
    expect(claim.map((e) => e.id)).toEqual([2, 1]);
  });

  it('실수 하나당 벌점 시간이 더해져 순위가 바뀐다', () => {
    const fast = { id: 1, filled: 41, ms: 100_000, mistakes: 2 };
    const clean = { id: 2, filled: 41, ms: 115_000, mistakes: 0 };
    expect(finalMs(fast)).toBe(100_000 + 2 * MISTAKE_PENALTY_MS);
    expect(rankRace<Entry>([fast, clean]).map((e) => e.id)).toEqual([2, 1]);
    expect(finalMs({ id: 3, filled: 9, ms: null, mistakes: 5 })).toBeNull();
  });

  it('완주자와 미완주자는 같은 등수가 되지 않는다', () => {
    const race = rankRace<Entry>([
      { id: 1, filled: 41, ms: 100 },
      { id: 2, filled: 41, ms: null },
    ]);
    expect(places(race, false)).toEqual([1, 2]);
  });

  it('자동 메모 벌점: 달라진 칸만, 칸 훑기 + 새로 적은 후보마다, 검증 시간 더해 초 단위', () => {
    // 칸0: 빈 메모 → 후보 3개, 칸1: 이미 {1,2} → {1,2,3} 로 하나 추가, 칸2: 그대로
    const before = [0, 0b011, 0b101];
    const after = [0b111, 0b111, 0b101];
    const raw = 2 * AUTO_SCAN_MS + 4 * AUTO_MARK_MS;
    expect(autoNotePenaltyMs(before, after)).toBe(Math.round((raw * AUTO_VERIFY) / 1000) * 1000);
    expect(autoNotePenaltyMs(after, after)).toBe(0);
  });

  it('자동 메모 벌점은 최종 기록에 더해진다', () => {
    expect(finalMs({ id: 1, filled: 0, ms: 100_000, mistakes: 1, autoMs: 60_000 })).toBe(100_000 + MISTAKE_PENALTY_MS + 60_000);
    const es: Entry[] = [
      { id: 1, filled: 0, ms: 100_000, autoMs: 30_000 },
      { id: 2, filled: 0, ms: 120_000 },
    ];
    expect(rankRace(es).map((e) => e.id)).toEqual([2, 1]);
  });

  it('고급·지옥 레이스는 다 채우고 채점, 점령형·아이템전은 바로 채점 (변성대왕은 아이템전도 숨김)', () => {
    expect(gradedLater('medium')).toBe(false);
    expect(gradedLater('hard')).toBe(true);
    expect(gradedLater('hell', 'item')).toBe(false);
    expect(gradedLater('hell', 'claim')).toBe(false);
    expect(gradedLater('king', 'item')).toBe(true);
    expect(gradedLater('king', 'claim')).toBe(false);
    expect(penaltyFor('easy')).toBe(MISTAKE_PENALTY_MS);
    expect(penaltyFor('hell')).toBe(GRADED_PENALTY_MS);
    expect(penaltyFor('hell', 'item')).toBe(MISTAKE_PENALTY_MS);
    expect(penaltyFor('king', 'item')).toBe(KING_PENALTY_MS);
  });

  it('힌트는 하나에 HINT_PENALTY_MS', () => {
    expect(finalMs({ id: 1, filled: 0, ms: 100_000, hints: 2 })).toBe(100_000 + 2 * HINT_PENALTY_MS);
  });
});
