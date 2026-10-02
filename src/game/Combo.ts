import { rankRace, type Entry } from './Ranking';

/** 이만큼 연속으로 맞히면 공격 */
export const ATTACK_COMBO = 3;
/** 다음 정답까지 이 시간 안이어야 콤보가 이어진다 */
export const COMBO_WINDOW_MS = 5000;
/** 침에 맞으면 판이 이만큼 안 보인다 */
export const SPIT_MS = 1000;

/** 빠른 연속 정답 세기. 오답이나 시간 초과면 처음부터, 공격이 나가면 0 으로 */
export class ComboMeter {
  chain = 0;
  private last = -Infinity;

  /** 정답 하나. 공격이 나가면 true */
  hit(now: number): boolean {
    this.chain = now - this.last <= COMBO_WINDOW_MS ? this.chain + 1 : 1;
    this.last = now;
    if (this.chain < ATTACK_COMBO) return false;
    this.chain = 0;
    return true;
  }

  miss(): void {
    this.chain = 0;
  }

  /** 콤보가 끊기기까지 남은 시간 비율 (0~1, 콤보 없으면 0) */
  left(now: number): number {
    return this.chain ? Math.max(0, 1 - (now - this.last) / COMBO_WINDOW_MS) : 0;
  }
}

/** 공격 대상: 아직 푸는 중인 다른 사람 가운데 지금 순위가 가장 높은 사람 (없으면 null) */
export function pickTarget(attacker: number, es: Entry[]): number | null {
  const alive = es.filter((e) => e.id !== attacker && e.ms == null && !e.gaveUp);
  return alive.length ? rankRace(alive)[0].id : null;
}
