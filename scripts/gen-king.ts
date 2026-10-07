/**
 * 변성대왕 판 은행 만들기 (오프라인). 막히는 지점(포싱이 필요한 단계)이 MIN_FORCING 번 이상인 판만 모은다.
 * 런타임에 만들기엔 너무 느려서(판 하나에 수 초) 미리 만들어 src/game/kingBank.json 에 넣는다.
 * 숫자 바꾸기·돌리기에 따라 기법을 찾는 순서가 달라져 횟수가 줄 수 있어, 은행엔 여러 변형에서도 2번 이상 막히는 판만 남겼다.
 *   npx vite-node scripts/gen-king.ts <개수> <시드> > out.txt
 */
import { explainNext } from '../src/game/Grade';
import { generate, mulberry32, toStr } from '../src/game/Sudoku';

const MIN_FORCING = 3;
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
  const { puzzle } = generate('king', rand);
  const f = forcingCount(puzzle);
  if (f >= MIN_FORCING) {
    console.log(`${toStr(puzzle)} ${f}`);
    got++;
  }
}
