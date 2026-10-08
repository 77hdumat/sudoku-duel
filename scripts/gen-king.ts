/**
 * 변성대왕 판 은행 만들기 (오프라인). AIC 까지 다 써도 막혀 포싱 체인이 필요한 단계가 MIN_FORCING 번 이상이고,
 * '끝까지 탐색'(사실상 전수 대입) 단계는 하나도 없는 판만 모은다 — 대회 극악 판처럼 추론만으로 풀려야 하니까.
 * 무작위 판 수백 개 중 하나꼴이라 미리 만들어 src/game/kingBank.json 에 넣는다.
 * 은행 첫 판은 AI Escargot (Arto Inkala, 2006) — 대회급 극악 판의 기준.
 *   npx vite-node scripts/gen-king.ts <개수> <시드> > out.txt
 */
import { explainNext } from '../src/game/Grade';
import { generate, mulberry32, toStr } from '../src/game/Sudoku';

const MIN_FORCING = 10;
const want = Number(process.argv[2] ?? 50);
const rand = mulberry32(Number(process.argv[3] ?? 1));

function forcingCount(puzzle: number[]): number {
  const g = puzzle.slice();
  const ruledOut = new Array(81).fill(0);
  let f = 0;
  while (g.some((v) => !v)) {
    const steps = explainNext(g, ruledOut);
    for (const st of steps) {
      if (st.id === 'forcing') f++;
      if (st.id === 'forcing' && st.phases.length === 3) return -1; // 끝까지 탐색으로만 찾은 단계
      for (const e of st.elim) ruledOut[e.i] |= 1 << (e.d - 1);
    }
    const p = steps[steps.length - 1]?.place;
    if (!p) return -1;
    g[p.i] = p.v;
  }
  return f;
}

let got = 0;
while (got < want) {
  const { puzzle } = generate('king', rand, 9, false);
  const f = forcingCount(puzzle);
  if (f >= MIN_FORCING) {
    console.log(`${toStr(puzzle)} ${f}`);
    got++;
  }
}
