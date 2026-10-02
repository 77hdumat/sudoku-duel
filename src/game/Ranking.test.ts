import { describe, expect, it } from 'vitest';
import { places, rankRace, rankScore, type Entry } from './Ranking';

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

  it('완주자와 미완주자는 같은 등수가 되지 않는다', () => {
    const race = rankRace<Entry>([
      { id: 1, filled: 41, ms: 100 },
      { id: 2, filled: 41, ms: null },
    ]);
    expect(places(race, false)).toEqual([1, 2]);
  });
});
