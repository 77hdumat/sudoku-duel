/**
 * 6×6 변성대왕 판 은행 만들기 (오프라인). 교대 추론 사슬(AIC)까지 필요하거나 그걸로도 막히는 판(tier 4 이상)만 모은다.
 * 무작위 6×6 판 1500개 중 하나꼴이라 미리 만들어 src/game/kingBank6.json 에 넣는다.
 *   npx vite-node scripts/gen-king6.ts <개수> <시드> > out.txt
 */
import { grade } from '../src/game/Grade';
import { countSolutions, generate, mulberry32, shuffle, toStr } from '../src/game/Sudoku';

const want = Number(process.argv[2] ?? 50);
const rand = mulberry32(Number(process.argv[3] ?? 1));
let got = 0;
while (got < want) {
  // 대칭을 지키며 바닥까지 깎는다 (generate 와 같은 방식)
  const solution = generate('easy', rand, 6).solution;
  const p = solution.slice();
  let clues = 36;
  for (const i of shuffle([...Array(18).keys()], rand)) {
    if (clues <= 8) break;
    const pair = [i, 35 - i];
    const saved = pair.map((k) => p[k]);
    for (const k of pair) p[k] = 0;
    if (countSolutions(p) === 1) clues -= 2;
    else pair.forEach((k, n) => (p[k] = saved[n]));
  }
  const t = grade(p);
  if (t >= 4) {
    console.log(`${toStr(p)} ${t}`);
    got++;
  }
}
