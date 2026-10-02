import type { Entry } from './Ranking';

/** 이만큼 연속으로 맞히면 공격 */
export const ATTACK_COMBO = 3;
/** 다음 정답까지 이 시간 안이어야 콤보가 이어진다 */
export const COMBO_WINDOW_MS = 5000;
/** 침에 맞으면 판이 이만큼 안 보인다. 가려진 채로 또 맞으면 남은 시간에 이만큼 더 붙는다 */
export const SPIT_MS = 1500;

/** 침 맞은 사람의 리액션 (방장이 번호를 골라 모두 같은 문구를 본다) */
export const SPIT_REACTIONS = [
  '으악 더러워!!',
  '퉤라니… 실화야?',
  '앞이 안 보여!!',
  '내 판 돌려내~',
  '아 진짜 침 좀 그만!',
  '으엑 축축해…',
  '눈에 들어갔어!!',
  '복수하겠다…',
  '이거 반칙 아니야?!',
  '휴지 어딨어 휴지!!',
];

/** 가려진 채로 또 맞으면 겹치지 않고 남은 시간에 SPIT_MS 를 더한다 */
export const spitUntil = (now: number, until: number) => Math.max(now, until) + SPIT_MS;

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

/** 공격 대상: 본인을 뺀, 아직 푸는 중인 모든 사람 (완주·포기한 사람은 빼고) */
export function spitTargets(attacker: number, es: Entry[]): number[] {
  return es.filter((e) => e.id !== attacker && e.ms == null && !e.gaveUp).map((e) => e.id);
}
