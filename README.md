# 스도쿠 대결 (Sudoku Duel)

AI 와 겨루는 싱글, 같은 퍼즐을 누가 먼저 푸는지 겨루는 멀티(최대 8명, 채팅)를 지원하는 데스크톱 스도쿠.
Vite + TypeScript + Electron, 멀티는 PeerJS(WebRTC) P2P — 별도 서버 없음 (surreal-derby 와 같은 방식·TURN 워커 공유).

```bash
npm install
npm run app        # 빌드 후 데스크톱 앱 실행
npm run dist       # macOS .dmg 생성 (release/)
npm run dev        # 브라우저 개발 서버 http://localhost:5190
npm run app:dev    # (dev 서버를 띄운 상태에서) Electron 으로 핫리로드 개발
npm test           # 생성기·솔버·AI 테스트
```

## 규칙

- 9×9 판의 각 행·열·3×3 박스에 1~9 를 한 번씩. 모든 퍼즐은 해가 하나뿐이다.
- 힌트 배치는 니코리 관례대로 180° 회전 대칭. 힌트 수: 초급 ~46 · 중급 ~32 · 고급 ~26.
- 정답을 넣은 칸은 잠긴다. 틀린 숫자는 빨갛게 남고 실수로 센다 (지우거나 덮어쓸 수 있음).
- 메모(N): 칸에 후보 숫자를 작게 적는다. 정답을 넣으면 같은 행·열·박스의 해당 메모가 지워진다.

## 모드

**싱글** — 꼬마봇(초급) / 스도봇(중급) / 마스터봇(고급) 중 하나와 같은 퍼즐로 경주. AI 는 후보가 가장 적은 칸부터 채우고,
후보가 많을수록 오래 고민하며, 난이도별 확률로 틀렸다가 고친다. 조정값은 `src/game/Ai.ts` 의 `AI_PROFILES` (`sec`, `mistake`).

**멀티** — 방 만들기 → 5자리 코드 전달 → 참가 → 방장이 난이도 고르고 시작. 모두에게 같은 퍼즐이 열리고,
가장 먼저 완성한 사람이 승리(판정은 방장이 먼저 받은 완료 순). 진행률은 실시간으로 공유되고 로비·게임 중 채팅이 된다.

## 조작

| 입력 | 동작 |
|---|---|
| 클릭 / 방향키 | 칸 선택 |
| 1~9 / 숫자패드 | 입력 |
| Backspace · Delete · 0 | 지우기 |
| N | 메모 모드 전환 |

## 구조

```
electron/main.cjs   데스크톱 창
src/main.ts         화면 흐름: 메뉴 · AI 선택 · 게임 · 로비 · 결과 · 채팅
src/game/Sudoku.ts  솔버(MRV 백트래킹) · 대칭 유일해 생성기
src/game/Ai.ts      AI 상대
src/ui/Board.ts     보드·숫자패드·키보드 입력
src/net/Net.ts      PeerJS 방코드·하트비트·TURN
src/net/Protocol.ts 메시지 정의
public/assets/      로고·AI 봇·트로피·배경 (직접 그린 SVG, 교체 시 같은 파일명으로 덮어쓰기)
```

테마: 종이 / 한밤 / 말차 (메뉴 하단). CSS 변수는 `src/style.css` 상단.
