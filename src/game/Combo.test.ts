import { describe, expect, it } from 'vitest';
import { ATTACK_COMBO, COMBO_WINDOW_MS, ComboMeter, pickTarget } from './Combo';

describe('ComboMeter', () => {
  it(`빠르게 ${ATTACK_COMBO}연속이면 공격, 그 뒤 다시 처음부터`, () => {
    const m = new ComboMeter();
    expect(m.hit(0)).toBe(false);
    expect(m.hit(1000)).toBe(false);
    expect(m.hit(2000)).toBe(true);
    expect(m.chain).toBe(0);
    expect(m.hit(3000)).toBe(false);
    expect(m.chain).toBe(1);
  });

  it('간격이 창을 넘으면 콤보가 끊긴다', () => {
    const m = new ComboMeter();
    m.hit(0);
    m.hit(COMBO_WINDOW_MS);
    expect(m.hit(COMBO_WINDOW_MS * 2 + 1)).toBe(false);
    expect(m.chain).toBe(1);
  });

  it('오답이면 처음부터', () => {
    const m = new ComboMeter();
    m.hit(0);
    m.hit(100);
    m.miss();
    expect(m.hit(200)).toBe(false);
    expect(m.chain).toBe(1);
  });

  it('남은 시간 비율', () => {
    const m = new ComboMeter();
    expect(m.left(0)).toBe(0);
    m.hit(0);
    expect(m.left(COMBO_WINDOW_MS / 2)).toBeCloseTo(0.5);
    expect(m.left(COMBO_WINDOW_MS * 2)).toBe(0);
  });
});

describe('pickTarget', () => {
  it('푸는 중인 사람 가운데 1등을 노린다', () => {
    const es = [
      { id: 0, filled: 10, ms: null },
      { id: 1, filled: 30, ms: null },
      { id: 2, filled: 41, ms: 90_000 },
      { id: 3, filled: 35, ms: null, gaveUp: true },
      { id: 4, filled: 20, ms: null },
    ];
    expect(pickTarget(0, es)).toBe(1);
    expect(pickTarget(1, es)).toBe(4);
  });

  it('노릴 사람이 없으면 null', () => {
    expect(pickTarget(0, [{ id: 0, filled: 1, ms: null }, { id: 1, filled: 41, ms: 1 }])).toBeNull();
  });
});
