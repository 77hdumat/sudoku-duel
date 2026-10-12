import { explainNext } from './Grade';

/** 풀이 계산은 극악 판에서 몇 초씩 걸려서 화면이 멈추지 않게 따로 돈다 */
self.onmessage = (e: MessageEvent<{ known: number[]; ruledOut: number[] }>) => postMessage(explainNext(e.data.known, e.data.ruledOut));
