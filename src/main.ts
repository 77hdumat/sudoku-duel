import './style.css';
import { AI_PROFILES, AiSolver } from './game/Ai';
import { ClaimJudge, type ClaimEvent } from './game/Claim';
import { ATTACK_COMBO, ComboMeter, SPIT_MS, SPIT_REACTIONS, spitTargets, spitUntil } from './game/Combo';
import { finalMs, MISTAKE_PENALTY_MS, penaltyFor, penaltyText, places, rankRace, rankScore, type Entry } from './game/Ranking';
import { explainNext } from './game/Grade';
import { autoNotesFor, candidates, fromStr, generate, geo, HINTS, LEVELS, levelsFor, SIZES, solve, toStr, type Grid, type Level, type Size } from './game/Sudoku';
import { faceHtml } from './fx/Faces';
import { Fx } from './fx/Fx';
import { goo, type Goo } from './fx/Goo';
import { sfx } from './fx/Sfx';
import { Net, type NetError } from './net/Net';
import { CHAT_MAX, cleanText, FREEZE_MS, HINT_OPTIONS, isRace, MAX_PLAYERS, MAX_WATCHERS, NAME_MAX, RULES, type Msg, type PlayerInfo, type ResultRow, type Rule } from './net/Protocol';
import { Board } from './ui/Board';
import { showExplain } from './ui/Explain';

const app = document.getElementById('app')!;
const LEVEL_KEYS = Object.keys(LEVELS) as Level[];
const RULE_KEYS = Object.keys(RULES) as Rule[];
const THEMES = [
  { id: 'paper', label: '종이' },
  { id: 'night', label: '한밤' },
  { id: 'matcha', label: '말차' },
];

const store = {
  get(k: string, d: string): string {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* 저장 못 해도 동작에는 지장 없음 */
    }
  },
};

const fx = new Fx();
// 개발 중 콘솔·자동 테스트에서 이펙트 상태를 들여다보기 위한 것 (배포 빌드에는 빠진다)
if (import.meta.env.DEV) Object.assign(window, { __fx: fx, __spit: () => spitOn($('.board-wrap'), true, '으악!') });
let myName = store.get('name', '플레이어');
setTheme(store.get('theme', 'paper'));

function setTheme(id: string): void {
  document.documentElement.dataset.theme = id;
  fx.setTheme(id);
  store.set('theme', id);
}

// 모바일 브라우저 기본 동작 막기 — 게임 중 길게 누르면 뜨는 메뉴, 핀치 확대(iOS 사파리는 viewport 설정을 무시한다), 글자 선택
const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
document.addEventListener('contextmenu', (e) => !editable(e.target) && e.preventDefault());
document.addEventListener('selectstart', (e) => !editable(e.target) && e.preventDefault());
document.addEventListener('dragstart', (e) => e.preventDefault());
for (const g of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(g, (e) => e.preventDefault(), { passive: false });
// 두 손가락 이상이면 확대로 이어지므로 막고, 한 손가락 스크롤(채팅·순위 띠)은 그대로
document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });

// 첫 입력에 오디오를 깨우고, 일반 버튼에 클릭음
addEventListener('pointerdown', () => sfx.unlock(), { once: true });
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (b && !b.classList.contains('digit') && !b.classList.contains('tool')) sfx.click();
});

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => app.querySelector(sel) as T | null;
const PLAYER_COLORS = ['#ef6f5e', '#3d8bd9', '#2fae6b', '#f2a93b', '#9b5de5', '#f15bb5'];
const colorOf = (id: number) => PLAYER_COLORS[id % PLAYER_COLORS.length];
const avatar = (p: PlayerInfo) => `<span class="avatar" style="background:${colorOf(p.id)}">${esc([...p.name][0] ?? '?')}</span>`;

let cleanup: (() => void) | null = null;
function show(html: string): void {
  cleanup?.();
  cleanup = null;
  app.innerHTML = html;
  const hell = !!app.querySelector('.play.king');
  fx.setHell(hell);
  sfx.setDread(hell);
}

// ───────────────────────── 메뉴 ─────────────────────────

function menu(notice = ''): void {
  leaveRoom();
  show(`
  <div class="screen menu"><div class="menu-card">
    <img class="logo bob" src="assets/logo.svg" alt="" />
    <h1>스도쿠 대결</h1>
    <p class="sub">AI 와 겨루거나, 친구와 같은 퍼즐로 대결해 보세요.</p>
    ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
    <label class="field">닉네임 <input id="name" maxlength="${NAME_MAX}" value="${esc(myName)}" /></label>
    <div class="menu-grid">
      <button class="big" id="single"><img src="assets/bot-medium.svg" alt="" /><b>싱글</b><span>AI 와 대결</span></button>
      <button class="big" id="host"><img src="assets/icon-multi.svg" alt="" /><b>방 만들기</b><span>최대 ${MAX_PLAYERS}명 · 점령형/레이스형</span></button>
    </div>
    <form class="join" id="join">
      <input id="code" placeholder="방 코드 5자리" maxlength="5" autocomplete="off" />
      <button>참가</button>
      <button type="button" class="ghost" id="watch">관전</button>
    </form>
    <div class="themes">${THEMES.map((t) => `<button data-theme-id="${t.id}" class="swatch ${t.id}">${t.label}</button>`).join('')}</div>
  </div></div>`);
  const nameEl = $<HTMLInputElement>('#name')!;
  const saveName = () => {
    myName = cleanText(nameEl.value, NAME_MAX) || '플레이어';
    store.set('name', myName);
  };
  $('#single')!.onclick = () => (saveName(), singleSetup());
  $('#host')!.onclick = () => (saveName(), createRoom());
  const join = (watch: boolean) => {
    const code = $<HTMLInputElement>('#code')!.value.trim().toUpperCase();
    if (code.length !== 5) return;
    saveName();
    joinRoom(code, watch);
  };
  $('#join')!.onsubmit = (e) => {
    e.preventDefault();
    join(false);
  };
  $('#watch')!.onclick = () => join(true);
  app.querySelectorAll<HTMLButtonElement>('[data-theme-id]').forEach((b) => (b.onclick = () => setTheme(b.dataset.themeId!)));
  const r = new URLSearchParams(location.search).get('r');
  if (r) $<HTMLInputElement>('#code')!.value = r.toUpperCase();
}

// ───────────────────────── 이펙트 ─────────────────────────

let combo = 0;

/** 맞힌 칸: 별·하트 팡 + 고리 + 글자, 완성된 행·열·박스는 무지개 물결 */
function cellFx(board: Board, i: number, color: string, mine: boolean, units: number[][], label?: string): void {
  const { x, y } = board.cellCenter(i);
  fx.burst(x, y, [color, fx.randomColor(), '#ffffff'], mine ? { count: 22, power: 300, size: 9 } : { count: 9, power: 170, size: 6 });
  fx.ring(x, y, color, mine ? 52 : 34);
  if (label) fx.text(x, y - 24, label, color);
  units.forEach((u, n) =>
    u.forEach((k, j) =>
      setTimeout(() => {
        const c = board.cellCenter(k);
        fx.burst(c.x, c.y, fx.randomColor(), { count: 5, power: 140, size: 6 });
      }, n * 120 + j * 35),
    ),
  );
  if (units.length) setTimeout(() => sfx.line(), 120);
}

/** 변성대왕: 칸에서 불꽃이 확 솟고 불티가 흩날린다 */
function hellFire(board: Board, i: number, big = false): void {
  const { x, y } = board.cellCenter(i);
  const cell = $('#board .cell')?.getBoundingClientRect().width ?? 50;
  fx.fire(x, y + cell * 0.45, cell * (big ? 2 : 1.5), cell * (big ? 4.2 : 3.1), big ? 1.8 : 1.4);
  fx.embers(x, y, big ? 22 : 12);
  if (!big) sfx.fire();
}

/** 변성대왕 완주: 판 전체가 아래 줄부터 차례로 타오른다 */
/** 변성대왕 채점: 틀린 개수가 많을수록 더 크게 비웃는다 */
const KING_LINES: [number, string[]][] = [
  [1, ['딱 한 칸… 아깝구나. 다시 보거라.', '한 칸이라도 틀리면 통과는 없다.']],
  [3, ['찍었구나? 내 눈은 못 속인다.', '추론은 어디 두고 왔느냐?']],
  [7, ['이 정도로 내 판을 넘보다니, 가소롭다!', '지옥 문턱에서 길을 잃었구나.']],
  [Infinity, ['크하하하! 이건 스도쿠가 아니라 복권이다!', '전부 다시 생각해라. 지옥은 아직 멀었다!']],
];

/** 판 위로 변성대왕 얼굴이 떠올라 대사를 치고 사라진다 (클릭은 그대로 통과 — 재시작·버튼 사용 가능) */
function kingSpeak(line: string, cls = '', mood = ''): void {
  const wrap = $('.board-wrap');
  if (!wrap) return;
  wrap.querySelector('.king-says')?.remove();
  const el = document.createElement('div');
  el.className = `king-says ${cls}`;
  el.innerHTML = `${faceHtml('king', 'king-face', mood)}<p>${line}</p>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function kingSays(wrong: number): void {
  const lines = KING_LINES.find(([max]) => wrong <= max)![1];
  kingSpeak(lines[Math.floor(Math.random() * lines.length)], '', 'laugh');
  sfx.laugh();
  fx.cackle(3200);
}

/** 변성대왕: RAGE_MS 안에 RAGE_PUTS 칸 넘게 넣으면 사람 손이 아니다 (키보드로 몰아쳐도 칸당 250ms 는 걸린다) */
const RAGE_PUTS = 8;
const RAGE_MS = 2000;

/** 몰아 넣은 칸을 불태워 지우고, 대사가 끝날 때까지 판을 잠근다 */
function kingRage(board: Board, cells: number[], isOver: () => boolean): void {
  board.wipe(cells);
  board.locked = true;
  for (const i of cells) hellFire(board, i, true);
  kingSpeak('감히 내 앞에서 요술을 부리느냐! 네 힘으로 풀도록 하거라!', 'rage');
  sfx.wrong();
  sfx.inferno();
  setTimeout(() => !isOver() && (board.locked = false), 4200);
}

function inferno(board: Board): void {
  const n = Math.sqrt(board.grid.length);
  sfx.inferno();
  for (let c = 0; c < n; c++)
    for (const r of [n - 1, Math.floor(n / 2)]) setTimeout(() => hellFire(board, r * n + c, true), c * 90 + (r === n - 1 ? 0 : 450));
}

function wrongFx(board: Board, i: number): void {
  const { x, y } = board.cellCenter(i);
  fx.burst(x, y, ['#ff5d5d', '#9aa0aa'], { count: 8, power: 120, size: 6, shapes: [2, 3] });
  const wrap = $('.board-wrap');
  wrap?.classList.remove('shake');
  void wrap?.offsetWidth;
  wrap?.classList.add('shake');
  sfx.wrong();
  combo = 0;
}

function wireInputSounds(board: Board): void {
  board.onInput = (k) => (k === 'select' ? sfx.select() : k === 'note' ? sfx.note() : k === 'auto' ? sfx.hint() : sfx.wrong());
}

/**
 * 개인판(싱글·레이스형·아이템전) 보드에 정답·오답·힌트 이펙트를 연결.
 * meter 가 있으면(아이템전) 빠른 연속 정답을 세다가 차면 onAttack.
 */
function wirePersonalFx(board: Board, color: string, meter?: ComboMeter, onAttack?: () => void): void {
  board.onCorrect = (i, hint, units) => {
    // 변성대왕(채점 숨김)은 힌트·풀이로 정답이 드러날 때만 여기 온다 — 불꽃으로
    if (document.querySelector('.play.king')) return hellFire(board, i);
    combo = hint ? combo : combo + 1;
    if (hint) sfx.hint();
    else sfx.correct(combo - 1);
    cellFx(board, i, hint ? '#f2c94c' : color, true, units, hint ? '💡' : combo >= 3 ? `${combo} 콤보!` : undefined);
    if (!meter || hint) return;
    if (meter.hit(performance.now())) onAttack?.();
    else setTimeout(() => sfx.comboUp(meter.chain), 140);
  };
  board.onWrong = (i) => {
    wrongFx(board, i);
    meter?.miss();
  };
  wireInputSounds(board);
}

// ───────────────────────── 아이템: 침 퉤 ─────────────────────────

const SPIT_COLOR = '#bfe6ff';

/** 매번 모양이 다른 침 자국 SVG — 판 전체를 덮을 만큼 크다 */
function splatSvg(): string {
  const R = Math.random;
  const blob = (cx: number, cy: number, r: number, n = 16) => {
    const pts = Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2;
      const rr = r * (0.78 + R() * 0.4);
      return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
    });
    // 이웃 점의 중점을 잇는 2차 곡선으로 말랑한 윤곽
    let d = '';
    pts.forEach((p, k) => {
      const q = pts[(k + 1) % n];
      const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      d += k ? ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}` : `M${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
    });
    return `<path d="${d} Z"/>`;
  };
  let drops = '';
  for (let k = 0; k < 9; k++) drops += blob(R() * 100, R() * 100, 4 + R() * 7, 9);
  let drips = '';
  for (let k = 0; k < 6; k++) {
    const x = 12 + R() * 76;
    drips += `<rect class="drip" x="${x.toFixed(1)}" y="${(70 + R() * 15).toFixed(1)}" width="${(3 + R() * 3).toFixed(1)}" height="${(14 + R() * 18).toFixed(1)}" rx="2" style="animation-delay:${(R() * 0.3).toFixed(2)}s"/>`;
  }
  let bubbles = '';
  for (let k = 0; k < 7; k++) bubbles += `<circle cx="${(15 + R() * 70).toFixed(1)}" cy="${(15 + R() * 60).toFixed(1)}" r="${(1.5 + R() * 3).toFixed(1)}"/>`;
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none">
    <g class="goo">${blob(50, 48, 64, 22)}${drops}${drips}</g>
    <g class="shine"><ellipse cx="34" cy="28" rx="13" ry="6" transform="rotate(-25 34 28)"/><ellipse cx="66" cy="62" rx="6" ry="3"/></g>
    <g class="bubbles">${bubbles}</g>
  </svg>`;
}

/** 요소별 지금 덮여 있는 침과 걷힐 시각 */
const splats = new WeakMap<Element, { d: HTMLElement; until: number; timer: ReturnType<typeof setTimeout>; g: Goo | null }>();

/**
 * el(보드·미리보기) 위에 침을 덮는다. 이미 덮여 있으면 새로 겹치지 않고 걷히는 시각만 뒤로 민다.
 * until 을 주면 그 시각까지(미리보기를 다시 그릴 때 남은 시간 이어 붙이기용).
 */
function spitOn(el: Element | null, big: boolean, say = '', until?: number): void {
  if (!el) return;
  const now = performance.now();
  const cur = splats.get(el);
  const live = cur && cur.d.isConnected && !cur.d.classList.contains('off');
  const end = until ?? spitUntil(now, live ? cur!.until : 0);
  let d: HTMLElement;
  let g: Goo | null = null;
  if (live) {
    d = cur!.d;
    g = cur!.g;
    g?.again();
    clearTimeout(cur!.timer);
    // 또 맞았다 — 자국을 한 번 더 출렁이게
    d.classList.remove('again');
    void d.offsetWidth;
    d.classList.add('again');
  } else {
    d = document.createElement('div');
    d.className = `splat${big ? ' big' : ''}`;
    d.innerHTML = splatSvg() + (big ? '<b>퉤!</b><em></em>' : '');
    el.appendChild(d);
    // 판만 한 침은 3D 로 (순위표 미리보기처럼 작은 건 SVG 만)
    if (el.getBoundingClientRect().width >= 120) g = goo(d);
  }
  const em = d.querySelector('em');
  if (em && say) em.textContent = say;
  const timer = setTimeout(() => {
    d.classList.add('off');
    g?.off();
    setTimeout(() => d.remove(), 400);
  }, end - now);
  splats.set(el, { d, until: end, timer, g });
}

/** 화면 고정 말풍선 (맞은 상대의 리액션) */
function bubble(anchor: Element | null, text: string, color: string): void {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const b = document.createElement('div');
  b.className = 'say';
  b.textContent = text;
  b.style.setProperty('--own', color);
  b.style.left = `${r.left + r.width / 2}px`;
  b.style.top = `${r.top}px`;
  document.body.appendChild(b);
  setTimeout(() => b.classList.add('off'), SPIT_MS + 300);
  setTimeout(() => b.remove(), SPIT_MS + 700);
}

const randomReaction = () => Math.floor(Math.random() * SPIT_REACTIONS.length);

const centerOf = (el: Element | null) => {
  const r = el?.getBoundingClientRect();
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 };
};

// ───────────────────────── 공통 게임 화면 ─────────────────────────

function overlay(html: string): HTMLElement {
  $('.overlay')?.remove();
  const d = document.createElement('div');
  d.className = 'overlay';
  d.innerHTML = `<div class="dialog">${html}</div>`;
  $('.play')!.appendChild(d);
  return d;
}

interface Play {
  board: Board;
  ended: boolean;
  elapsed(): number;
  end(): void;
  overlay(html: string): HTMLElement;
  /** 보드 위 안내 띠 (빈 문자열이면 숨김) */
  banner(html: string): void;
}

interface PlayOpts {
  level: Level;
  /** 내 플레이어 색 — 선택 커서·내가 맞힌 칸 */
  color: string;
  tag?: string;
  side: string;
  chat: boolean;
  shared?: boolean;
  onProgress?(filled: number, mistakes: number): void;
  onSolved?(ms: number): void;
  /** 카운트다운이 끝나고 게임이 진행 중일 때만 매 프레임 */
  tick?(dt: number): void;
  /** 있으면 HUD 에 '포기' 버튼 */
  onGiveUp?(): void;
  /** 아이템전: HUD 에 콤보 게이지 */
  meter?: ComboMeter;
  hints?: number;
  /** 풀이 버튼 (변성대왕 싱글, 무제한) */
  explain?: boolean;
  onQuit(): void;
}

function play(puzzle: Grid, solution: Grid, o: PlayOpts): Play {
  show(`
  <div class="screen play${o.level === 'king' ? ' king' : ''}">
    <aside class="side">${o.side}</aside>
    <main class="center">
      <div class="hud">
        <span class="chip">${puzzle.length === 36 ? '6×6 · ' : ''}${LEVELS[o.level].label}</span>${o.tag ? `<span class="chip accent">${o.tag}</span>` : ''}
        <span class="timer" id="timer">0:00</span>
        <span class="chip" id="miss">실수 0</span>
        ${o.meter ? `<span class="chip combo" id="combo">⚡ <b>0</b>/${ATTACK_COMBO}<i></i></span>` : ''}
        ${o.onGiveUp ? '<button class="ghost" id="giveup">포기</button>' : ''}
        <button class="ghost" id="quit">나가기</button>
      </div>
      ${o.level === 'hell' && !o.shared && store.get('noGuess.hell', '') !== 'off' ? '<p class="no-guess" role="alert">⚠️ 지옥: 찍지 말고 추론으로 풀어 주세요.<br />실수 하나에 +30초!<button class="no-guess-x" aria-label="경고 끄기">✕</button></p>' : ''}
      ${o.level === 'king' && store.get('noGuess.king', '') !== 'off' ? '<p class="no-guess" role="alert">⚠️ 추측하지 마세요. 틀려도 바로 알려 주지 않아요.<br />다 채우면 채점하고, 틀린 칸 하나에 +7분이에요.<button class="no-guess-x" aria-label="경고 끄기">✕</button></p>' : ''}
      <div class="board-wrap"><div class="board" id="board"></div><div class="countdown${o.level === 'king' ? ' king' : ''}" id="cd"><b>3</b></div><div class="banner" id="banner"></div></div>
      <div class="pad" id="pad"></div>
    </main>
    ${o.chat ? '<aside class="chat-slot" id="chat-slot"></aside>' : ''}
  </div>`);
  const board = new Board($('#board')!, $('#pad')!, puzzle, solution, o.shared, autoNotesFor(o.level, puzzle.length === 36 ? 6 : 9), o.hints, o.explain, o.level === 'king' && !o.shared);
  board.setColor(o.color);
  const timer = $('#timer')!;
  let t0 = 0;
  let started = false;
  combo = 0;
  const h: Play = {
    board,
    ended: false,
    elapsed: () => (started ? performance.now() - t0 : 0),
    end() {
      if (h.ended) return;
      h.ended = true;
      board.locked = true;
      timer.textContent = fmt(h.elapsed());
      $('#giveup')?.remove();
    },
    overlay,
    banner(html) {
      const b = $('#banner');
      if (!b) return;
      b.innerHTML = html;
      b.classList.toggle('on', !!html);
    },
  };
  board.onChange = (f, m) => o.onProgress?.(f, m);
  if (o.level === 'king') {
    const puts: { t: number; i: number }[] = [];
    board.onPut = (i) => {
      const t = performance.now();
      puts.push({ t, i });
      while (t - puts[0].t > RAGE_MS) puts.shift();
      if (puts.length < RAGE_PUTS) return hellFire(board, i);
      kingRage(board, puts.splice(0).map((p) => p.i), () => h.ended);
    };
  }
  board.onChecked = (n) => {
    h.banner(`틀린 칸 ${n}개! 빨간 칸을 고쳐 보세요 (실수 +${n})`);
    setTimeout(() => !h.ended && h.banner(''), 2600);
    if (o.level === 'king') kingSays(n);
  };
  if (o.explain) {
    // 풀이로 지운 후보는 이어서 쓴다 (다음 풀이가 같은 단계를 되풀이하지 않게)
    const ruledOut = new Array(puzzle.length).fill(0);
    let open = false;
    board.onExplain = () => {
      if (open) return;
      open = true;
      board.locked = true;
      sfx.hint();
      const known = board.known();
      const steps = explainNext(known, ruledOut);
      // 판에 틀린 숫자가 있으면 풀이가 기준으로 삼는 판(맞는 숫자만)과 화면이 어긋난다 → 먼저 보여 주고 비운다
      const wrong = board.wrongCells();
      if (wrong.length)
        steps.unshift({
          id: 'fix',
          phases: [
            {
              text: `판에 틀린 숫자가 ${wrong.length}개 있어요 (빨간 칸). 틀린 숫자가 있으면 그다음 추리가 전부 꼬여서 끝까지 풀 수 없어요.`,
              draw: { bad: wrong },
            },
            { text: `먼저 이 칸들을 비우고 시작할게요.${board.unseenWrong ? ` (틀린 칸을 알려 준 셈이라 실수 +${board.unseenWrong})` : ''}` },
          ],
          elim: [],
          cands: known.map((v, i) => (v ? 0 : candidates(known, i) & ~ruledOut[i])),
          grid: known,
        });
      showExplain(
        $('.board-wrap')!,
        steps,
        Math.sqrt(puzzle.length),
        (st) => {
          if (st.id === 'fix') return board.clearWrong();
          for (const e of st.elim) ruledOut[e.i] |= 1 << (e.d - 1);
          board.applyExplain(st.elim, st.place);
        },
        () => {
          open = false;
          // 풀이를 연 채로 포기·종료됐으면 잠근 채로 둔다
          if (!board.solved && !h.ended) board.locked = false;
        },
      );
    };
  }
  board.onSolved = () => {
    const ms = h.elapsed();
    if (o.level === 'king') inferno(board);
    h.end();
    o.onSolved?.(ms);
  };
  $('#quit')!.onclick = () => o.onQuit();
  const noGuessX = document.querySelector<HTMLButtonElement>('.no-guess-x');
  if (noGuessX)
    noGuessX.onclick = () => {
      store.set(`noGuess.${o.level}`, 'off');
      noGuessX.parentElement!.remove();
    };
  const giveBtn = $('#giveup');
  if (giveBtn && o.onGiveUp) giveBtn.onclick = () => started && !h.ended && o.onGiveUp!();

  const cd = $('#cd')!;
  const cdNum = (txt: string) => (cd.querySelector('b')!.outerHTML = `<b>${txt}</b>`);
  let n = 3;
  sfx.countdown();
  // 변성대왕: 카운트다운 내내 뒤의 해골들이 킬킬댄다
  if (o.level === 'king') fx.cackle(3000);
  const cdT = setInterval(() => {
    n--;
    if (n > 0) {
      sfx.countdown();
      cdNum(String(n));
      return;
    }
    clearInterval(cdT);
    sfx.countdown(true);
    cdNum('시작!');
    cd.classList.add('go');
    setTimeout(() => cd.remove(), 450);
    const r = $('#board')!.getBoundingClientRect();
    fx.burst(r.left + r.width / 2, r.top + r.height / 2, [fx.randomColor(), fx.randomColor(), '#ffffff'], { count: 40, power: 520, size: 10 });
    started = true;
    t0 = performance.now();
    board.locked = false;
    board.select(board.given.indexOf(false));
  }, 1000);

  let raf = 0;
  let last = performance.now();
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!started) return;
    // 내가 끝난 뒤에도 남은 사람(AI)은 계속 돈다
    o.tick?.(dt);
    if (h.ended) return;
    timer.textContent = fmt(h.elapsed());
    $('#miss')!.textContent = `실수 ${board.mistakes}`;
    if (o.meter) {
      const c = $('#combo');
      c!.querySelector('b')!.textContent = String(o.meter.chain);
      c!.querySelector('i')!.style.width = `${o.meter.left(performance.now()) * 100}%`;
      c!.classList.toggle('hot', o.meter.chain >= ATTACK_COMBO - 1);
    }
  };
  raf = requestAnimationFrame(loop);
  cleanup = () => {
    clearInterval(cdT);
    cancelAnimationFrame(raf);
    board.dispose();
  };
  return h;
}

// ───────────────────────── 실시간 순위표 ─────────────────────────

interface Racer extends Entry {
  name: string;
  color: string;
  avatar: string;
  me: boolean;
  /** 상대 판 미리보기 (g 주어진 칸, 1 채운 칸, 0 빈칸) */
  cells?: string;
  /** AI 가 끝까지 풀었다고 치고 계산한 시간 */
  projected?: boolean;
}

const MEDALS = ['🥇', '🥈', '🥉'];

const LEVEL_DESC: Record<Level, string> = {
  easy: `채워진 숫자 ${LEVELS.easy.clues}개 안팎 · 드러난/숨겨진 하나만으로 풀려요.`,
  medium: `채워진 숫자 ${LEVELS.medium.clues}개 안팎 · 교차로나 부분집합(쌍·삼총사)이 꼭 한 번은 필요해요.`,
  hard: `채워진 숫자 ${LEVELS.hard.clues}개 안팎 · X-윙·황새치·XY-윙 같은 패턴 없이는 막혀요.`,
  hell: `더 지우면 답이 여러 개가 될 때까지 숫자를 깎은 판 · 윙으로도 막혀서 W-윙·핀드 X-윙·X/XY-사슬이 필요해요. 실수 하나에 +30초! ✨ 자동 메모 가능`,
  king: `더 지우면 답이 여러 개가 될 때까지 숫자를 깎은 판 · 교대 추론 사슬(AIC)까지 다 써도 막히는 곳이 5군데 이상 — 포싱 체인 같은 초고급 기술을 계속 써야 풀려요. 대회 극악 판 AI Escargot 급이에요. 🏆 대회 룰: 틀려도 바로 안 알려 주고, 다 채우면 한 번에 채점해요. ✨ 자동 메모 가능`,
};

const LEVEL_DESC6: Partial<Record<Level, string>> = {
  easy: '6×6 · 숫자 1~6, 2×3 박스 · 채워진 숫자 20개.',
  medium: '6×6 · 채워진 숫자 12개 안팎 · 드러난/숨겨진 하나만으로 풀려요.',
  hard: '6×6 · 채워진 숫자 10개 안팎 · 교차로·부분집합 같은 기술이 꼭 필요해요. ✨ 자동 메모 가능',
  hell: '6×6 · W-윙·X-사슬 같은 중급 사슬이 꼭 필요해요. 실수 하나에 +30초! ✨ 자동 메모 가능',
  king: '6×6 · 교대 추론 사슬(AIC)까지 필요하거나 그걸로도 막혀요. 🏆 대회 룰: 틀려도 바로 안 알려 주고, 다 채우면 한 번에 채점해요. ✨ 자동 메모 가능',
};

/** 완주 기록 옆 벌점 설명: " · 3:12 + 실수 2 (+20초)" */
const penaltyNote = (e: Entry) =>
  e.ms != null && e.mistakes ? ` · ${fmt(e.ms)} + 실수 ${e.mistakes} (+${penaltyText(e.mistakes * (e.penaltyMs ?? MISTAKE_PENALTY_MS))})` : '';

/** 규칙대로 정렬해 그린다. 순위가 바뀐 줄은 이전 자리에서 미끄러져 온다 */
function renderStandings(el: HTMLElement | null, racers: Racer[], claim: boolean, total: number): Racer[] {
  const sorted = claim ? rankScore(racers) : rankRace(racers);
  if (!el) return sorted;
  const pl = places(sorted, claim);
  const before = new Map([...el.children].map((c) => [(c as HTMLElement).dataset.key, c.getBoundingClientRect().top]));
  el.innerHTML = sorted
    .map((e, i) => {
      const value = claim ? `${e.score ?? 0}` : e.ms != null ? fmt(finalMs(e)!) : `${e.filled}/${total}`;
      // 진행률은 막대가 보여 주니 글자로는 실수·완주·포기만
      const sub = claim
        ? `${e.filled}칸`
        : e.ms != null
          ? `${e.projected ? '끝까지 풀면 (예상)' : '🏁 완주'}${penaltyNote(e)}`
          : e.gaveUp
            ? '포기'
            : '';
      const miss = e.mistakes && e.ms == null ? `${sub ? ' · ' : ''}실수 ${e.mistakes}` : '';
      // 판 미리보기가 있으면 아바타 자리에 (테두리가 플레이어 색)
      const pv = e.cells ? `<div class="pv${e.cells.length === 36 ? ' six' : ''}" data-pv="${e.id}">${[...e.cells].map((c) => `<i class="${c === 'g' ? 'g' : c === '1' ? 'f' : ''}"></i>`).join('')}</div>` : '';
      const pct = claim ? 0 : e.ms != null ? 100 : (e.filled / total) * 100;
      return `<div class="stand${e.me ? ' me' : ''}${e.ms != null ? ' done' : ''}${e.gaveUp ? ' out' : ''}" data-key="${e.id}" style="--own:${e.color}">
        <span class="place">${MEDALS[pl[i] - 1] ?? pl[i]}</span>${pv || e.avatar}
        <div class="who"><div class="top"><b>${esc(e.name)}</b><strong>${value}</strong></div><small>${sub}${miss}</small>${claim ? '' : `<div class="bar"><i style="width:${pct}%"></i></div>`}</div>
      </div>`;
    })
    .join('');
  for (const c of el.children) {
    const old = before.get((c as HTMLElement).dataset.key);
    const dy = old == null ? 0 : old - c.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) c.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.3,1.3,.5,1)' });
  }
  return sorted;
}

/** 결과 창: 내 등수 제목 + 최종 순위표 */
function resultDialog(h: Pick<Play, 'overlay'>, racers: Racer[], claim: boolean, total: number, buttons: string): HTMLElement {
  const sorted = claim ? rankScore(racers) : rankRace(racers);
  const pl = places(sorted, claim);
  const me = sorted.findIndex((e) => e.me);
  const myPlace = pl[me] ?? 0;
  const top = sorted.filter((_, i) => pl[i] === 1);
  // 관전자는 내 등수가 없다
  const title = me < 0 ? '최종 순위' : myPlace === 1 ? (top.length > 1 ? '공동 1위!' : '1위!') : `${myPlace}위`;
  if (me < 0) fx.confetti(70);
  else celebrate(myPlace === 1);
  const d = h.overlay(`
    <img class="result-img${myPlace === 1 || me < 0 ? '' : ' dim'}" src="assets/trophy.svg" alt="" />
    <h2>${title}</h2>
    <p class="hint">${claim ? '점수 순위 (맞힌 칸 − 실수)' : `기록 순위 (완주 시간 + 실수당 ${penaltyText(racers[0]?.penaltyMs ?? MISTAKE_PENALTY_MS)})`}</p>
    <div class="standings final" id="final"></div>
    <div class="row">${buttons}</div>`);
  renderStandings(d.querySelector('#final'), racers, claim, total);
  return d;
}

function celebrate(won: boolean): void {
  if (won) {
    fx.confetti();
    sfx.win();
  } else sfx.lose();
}

// ───────────────────────── 싱글 (AI 대결) ─────────────────────────

function singleSetup(): void {
  let items = store.get('singleItems', '0') === '1';
  let size: Size = store.get('singleSize', '9') === '6' ? 6 : 9;
  show(`
  <div class="screen setup">
    <button class="ghost back" id="back">← 메뉴</button>
    <h2>상대할 AI 를 고르세요</h2>
    <div class="levels mode" id="mode">
      <button data-mode="0">일반</button><button data-mode="1">아이템전 💦</button>
    </div>
    <p class="hint" id="mode-desc"></p>
    <div class="levels mode" id="size">${SIZES.map((n) => `<button data-size="${n}">${n}×${n}</button>`).join('')}</div>
    <div class="bots">
      ${LEVEL_KEYS.map((l) => {
        const p = AI_PROFILES[l];
        const pen = penaltyText(penaltyFor(l));
        const rules = l === 'king' ? ['🏆 대회 룰', '틀려도 알려 주지 않아요', `틀리면 소요 시간 +${pen}`] : [`실수 하나에 +${pen}`];
        return `<button class="bot ${l}" data-level="${l}">
          <img src="${p.avatar}" alt="" data-bot="${l}" />
          <span class="chip">${LEVELS[l].label}</span>
          <b>${p.name}</b><small>${p.blurb}</small>
          <ul class="bot-rules">${rules.map((r) => `<li>${r}</li>`).join('')}</ul>
        </button>`;
      }).join('')}
    </div>
  </div>`);
  const paint = () => {
    app.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', (b.dataset.mode === '1') === items));
    app.querySelectorAll<HTMLButtonElement>('[data-size]').forEach((b) => b.classList.toggle('on', Number(b.dataset.size) === size));
    app.querySelectorAll<HTMLButtonElement>('.bot[data-level]').forEach((b) => b.classList.toggle('hidden', !levelsFor(size).includes(b.dataset.level as Level)));
    $('#mode-desc')!.textContent = items ? RULES.item.desc.replace('나 빼고 전원에게', 'AI 에게') + ' AI 도 콤보가 차면 뱉어요!' : '';
    $('#mode-desc')!.hidden = !items;
  };
  app.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(
    (b) =>
      (b.onclick = () => {
        items = b.dataset.mode === '1';
        store.set('singleItems', items ? '1' : '0');
        paint();
      }),
  );
  app.querySelectorAll<HTMLButtonElement>('[data-size]').forEach(
    (b) =>
      (b.onclick = () => {
        size = Number(b.dataset.size) as Size;
        store.set('singleSize', String(size));
        paint();
      }),
  );
  paint();
  $('#back')!.onclick = () => menu();
  app.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) => (b.onclick = () => startSingle(b.dataset.level as Level, items, size)));
  // 호버하면 비웃는 얼굴 (-laugh.svg) 로 킬킬
  app.querySelectorAll<HTMLButtonElement>('.bot[data-level]').forEach((b) => {
    const img = b.querySelector('img')!;
    const calm = img.src;
    const laugh = calm.replace(/\.svg$/, '-laugh.svg');
    new Image().src = laugh;
    b.addEventListener('pointerenter', () => {
      img.src = laugh;
      img.classList.add('cackle');
    });
    b.addEventListener('pointerleave', () => {
      img.src = calm;
      img.classList.remove('cackle');
    });
  });
}

function startSingle(level: Level, items: boolean, size: Size): void {
  const { puzzle, solution } = generate(level, Math.random, size);
  const prof = AI_PROFILES[level];
  const ai = new AiSolver(puzzle, solution, prof);
  const total = ai.total;
  const me: PlayerInfo = { id: 0, name: myName };
  const penaltyMs = penaltyFor(level);
  const meR: Racer = { id: 0, name: myName, color: colorOf(0), avatar: avatar(me), me: true, filled: 0, ms: null, mistakes: 0, penaltyMs };
  const aiR: Racer = { id: 1, name: prof.name, color: '#8a93a6', avatar: faceHtml(level, 'avatar pic'), me: false, filled: 0, ms: null, mistakes: 0, penaltyMs };
  const meter = items ? new ComboMeter() : undefined;
  const aiMeter = new ComboMeter();
  let done = false;

  const h = play(puzzle, solution, {
    level,
    explain: level === 'king',
    color: colorOf(0),
    tag: items ? RULES.item.label : undefined,
    chat: false,
    meter,
    side: `
      <h3>실시간 순위</h3>
      <div class="standings" id="stand"></div>
      <p class="hint mini-title">${prof.name} 의 판</p>
      <div class="mini${size === 6 ? ' six' : ''}" id="ai-mini">${puzzle.map((v) => `<i class="${v ? 'g' : ''}"></i>`).join('')}</div>`,
    onProgress(f, m) {
      meR.filled = f;
      meR.mistakes = m;
      refresh();
    },
    onSolved(ms) {
      meR.ms = ms;
      finish();
    },
    tick(dt) {
      if (aiR.ms != null || done) return;
      const filled = ai.filled;
      const mistakes = ai.mistakes;
      ai.update(dt);
      if (ai.filled === filled && ai.mistakes === mistakes) return;
      aiR.filled = ai.filled;
      aiR.mistakes = ai.mistakes;
      const mini = $('#ai-mini')!.children;
      ai.grid.forEach((v, i) => {
        if (!puzzle[i]) mini[i].className = i === ai.wrongCell ? 'x' : v ? 'f' : '';
      });
      if (ai.lastCell >= 0) mini[ai.lastCell].classList.add('pop');
      // 아이템전: AI 도 빠른 연속 정답이면 나에게 퉤 (내가 아직 푸는 중일 때만)
      if (items) {
        if (ai.mistakes > mistakes) aiMeter.miss();
        for (let k = filled; k < ai.filled; k++) if (aiMeter.hit(h.elapsed()) && meR.ms == null && !meR.gaveUp) aiAttack();
      }
      if (ai.done) {
        aiR.ms = h.elapsed();
        sfx.claimOther();
        if (meR.ms == null) {
          h.banner(`🏁 ${prof.name} 먼저 완주! 기록 ${fmt(finalMs(aiR)!)} — 끝까지 풀어 기록을 남겨요`);
          // 판 윗줄(메모)을 가리지 않게 잠깐만 띄운다 — 완주 표시는 순위 띠에 남는다
          setTimeout(() => h.banner(''), 4000);
        }
      }
      refresh();
    },
    onGiveUp() {
      meR.gaveUp = true;
      h.end();
      finish();
    },
    onQuit: () => menu(),
  });
  wirePersonalFx(h.board, colorOf(0), meter, () => {
    if (aiR.ms != null || done) return;
    sfx.whoosh();
    fx.projectile(centerOf($('#board')), centerOf($('#ai-mini')), SPIT_COLOR, () => {
      sfx.spit();
      spitOn($('#ai-mini'), false);
      bubble($('#ai-mini'), SPIT_REACTIONS[randomReaction()], '#8a93a6');
      ai.stun(SPIT_MS / 1000);
    });
  });
  refresh();

  function aiAttack(): void {
    sfx.whoosh();
    fx.projectile(centerOf($('#ai-mini')), centerOf($('#board')), SPIT_COLOR, () => {
      if (done) return;
      sfx.spit();
      spitOn($('.board-wrap'), true, SPIT_REACTIONS[randomReaction()]);
    });
  }

  function refresh(): void {
    renderStandings($('#stand'), [meR, aiR], false, total);
  }

  function finish(): void {
    if (done) return;
    done = true;
    // 내가 먼저 끝났거나 포기했으면, AI 가 지금 페이스로 끝까지 풀었을 때의 시간으로 순위를 매긴다
    if (aiR.ms == null) {
      let t = h.elapsed() / 1000;
      while (!ai.done) {
        ai.update(0.25);
        t += 0.25;
      }
      aiR.ms = t * 1000;
      aiR.filled = ai.filled;
      aiR.mistakes = ai.mistakes;
      aiR.projected = true;
    }
    h.banner('');
    refresh();
    const d = resultDialog(
      h,
      [meR, aiR],
      false,
      total,
      '<button id="again">한 판 더</button><button class="ghost" id="other">다른 AI</button><button class="ghost" id="home">메뉴</button>',
    );
    d.querySelector<HTMLButtonElement>('#again')!.onclick = () => startSingle(level, items, size);
    d.querySelector<HTMLButtonElement>('#other')!.onclick = () => singleSetup();
    d.querySelector<HTMLButtonElement>('#home')!.onclick = () => menu();
  }
}

// ───────────────────────── 멀티 ─────────────────────────

type View = { grid: string; notes: string; sel?: number };

interface Room {
  host: boolean;
  myId: number;
  /** 내가 관전자로 들어왔는지 */
  watching: boolean;
  players: PlayerInfo[];
  watchers: PlayerInfo[];
  level: Level;
  /** 판 크기 (방장이 고른다) */
  size: Size;
  rule: Rule;
  /** 판당 힌트 수 (방장이 고른다) */
  hints: number;
  /** 지금 판 (게임 중에 들어온 관전자에게 보낼 용도) */
  puzzle: string;
  /** 플레이어별 최신 판 상태 — 방장(중계·스냅샷용)·관전자·끝낸 플레이어가 쓴다 */
  views: Map<number, View>;
  phase: 'lobby' | 'play';
  total: number;
  /** 레이스형 진행률·완주 시간·포기 */
  progress: Map<number, { filled: number; mistakes: number; cells?: string }>;
  finishes: Map<number, number>;
  gaveUp: Set<number>;
  /** 점령형 오답 수 */
  misses: Map<number, number>;
  /** 아이템전: 방장이 공격을 너무 자주 받지 않게 막는 마지막 공격 시각 */
  lastAttack: Map<number, number>;
  /** 점령형 점수·가져간 칸 수 (claim/miss 메시지로 모두가 같은 값을 센다) */
  scores: Map<number, number>;
  cells: Map<number, number>;
  /** 점령형 심판 — 방장만 */
  judge: ClaimJudge | null;
  play: Play | null;
  /** 관전 화면 */
  watch: Watch | null;
  result: ResultRow[] | null;
  chat: HTMLElement;
}

let net: Net | null = null;
let room: Room | null = null;

function leaveRoom(): void {
  net?.close();
  net = null;
  room = null;
}

function newRoom(host: boolean, watching = false): Room {
  const chat = document.createElement('div');
  chat.className = 'chat';
  chat.innerHTML = `<div class="chat-head">채팅</div><div class="chat-log"></div>
    <form class="chat-form"><input maxlength="${CHAT_MAX}" placeholder="메시지 입력 후 Enter" autocomplete="off" /><button>전송</button></form>`;
  const input = chat.querySelector('input')!;
  chat.querySelector('form')!.onsubmit = (e) => {
    e.preventDefault();
    const text = cleanText(input.value, CHAT_MAX);
    input.value = '';
    if (!text || !room || !net) return;
    if (room.host) {
      const m: Msg = { t: 'chat', id: 0, name: myName, text };
      net.broadcast(m);
      addChat(m);
    } else net.send({ t: 'chat', id: room.myId, name: myName, text });
  };
  return {
    host,
    myId: 0,
    watching,
    players: [],
    watchers: [],
    level: 'medium',
    size: 9,
    rule: 'claim',
    hints: HINTS,
    puzzle: '',
    views: new Map(),
    phase: 'lobby',
    total: 0,
    progress: new Map(),
    finishes: new Map(),
    gaveUp: new Set(),
    misses: new Map(),
    lastAttack: new Map(),
    scores: new Map(),
    cells: new Map(),
    judge: null,
    play: null,
    watch: null,
    result: null,
    chat,
  };
}

function addChat(m: { id: number; name: string; text: string } | string): void {
  if (!room) return;
  const log = room.chat.querySelector('.chat-log')!;
  const line = document.createElement('div');
  if (typeof m === 'string') {
    line.className = 'sys';
    line.textContent = m;
  } else {
    line.className = m.id === room.myId ? 'line mine' : 'line';
    const who = document.createElement('b');
    who.textContent = m.name;
    who.style.color = colorOf(m.id);
    line.append(who, document.createTextNode(' ' + m.text));
    if (m.id !== room.myId) sfx.chat();
  }
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function waiting(text: string): void {
  show(`<div class="screen setup"><div class="spinner"></div><p>${esc(text)}</p><button class="ghost" id="cancel">취소</button></div>`);
  $('#cancel')!.onclick = () => menu();
}

function netErrorText(e: NetError): string {
  if (e.type === 'peer-unavailable') return '그 코드의 방을 찾을 수 없어요.';
  if (e.type === 'timeout') return '접속 시간이 초과됐어요. 코드와 네트워크를 확인해 주세요.';
  if (e.type === 'closed') return '방장과의 연결이 끊겼어요.';
  if (e.type === 'network' || e.type === 'server-error') return '시그널링 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.';
  return `연결 오류: ${e.type}`;
}

const nameOf = (id: number) => room?.players.find((p) => p.id === id)?.name ?? '???';
const isWatcher = (id: number) => !!room?.watchers.some((w) => w.id === id);

// ── 호스트

function createRoom(): void {
  leaveRoom();
  const r = (room = newRoom(true));
  const n = (net = new Net());
  waiting('방을 만드는 중…');
  n.onOpen = (code) => {
    r.players = [{ id: 0, name: myName }];
    addChat(`방 코드 ${code} — 친구에게 알려 주세요.`);
    lobby();
  };
  n.onError = (e) => net === n && menu(netErrorText(e));
  n.onLeave = (id) => {
    const w = r.watchers.find((x) => x.id === id);
    if (w) {
      r.watchers = r.watchers.filter((x) => x !== w);
      addChat(`👀 ${w.name} 님이 관전을 그만뒀어요.`);
      return broadcastLobby();
    }
    const p = r.players.find((x) => x.id === id);
    if (!p) return;
    r.players = r.players.filter((x) => x !== p);
    addChat(`${p.name} 님이 나갔어요.`);
    broadcastLobby();
    if (r.phase !== 'play' || r.result) return;
    // 혼자 남으면 대결이 성립하지 않으니 끝내고, 레이스는 남은 사람이 다 끝났는지 다시 본다
    if (r.players.length < 2) endGame();
    else if (isRace(r.rule)) checkRaceEnd();
  };
  n.onMessage = (m, from) => {
    // 관전자는 채팅만 할 수 있다
    if (isWatcher(from) && m.t !== 'chat') return;
    switch (m.t) {
      case 'hello': {
        if (r.players.some((x) => x.id === from)) return;
        const name = cleanText(m.name, NAME_MAX) || `손님${from}`;
        if (m.watch) {
          if (r.watchers.length >= MAX_WATCHERS) {
            n.sendTo(from, { t: 'full', why: 'watchers' });
            return n.kick(from);
          }
          r.watchers.push({ id: from, name });
          addChat(`👀 ${name} 님이 관전하러 왔어요.`);
          sfx.join();
          broadcastLobby();
          if (r.phase === 'play') sendWatch(from);
          return;
        }
        if (r.phase !== 'lobby' || r.players.length >= MAX_PLAYERS) {
          n.sendTo(from, { t: 'full', why: r.phase !== 'lobby' ? 'playing' : 'slots' });
          n.kick(from);
          return;
        }
        r.players.push({ id: from, name });
        addChat(`${name} 님이 들어왔어요.`);
        sfx.join();
        broadcastLobby();
        return;
      }
      case 'view': {
        if (r.phase !== 'play' || !r.players.some((x) => x.id === from)) return;
        if (!viewOk(m)) return;
        return relayView({ t: 'view', id: from, grid: m.grid, notes: m.notes, sel: selOf(m.sel) });
      }
      case 'chat': {
        const p = r.players.find((x) => x.id === from) ?? r.watchers.find((x) => x.id === from);
        const text = cleanText(m.text, CHAT_MAX);
        if (!p || !text) return;
        const out: Msg = { t: 'chat', id: from, name: p.name, text };
        n.broadcast(out);
        addChat(out);
        return;
      }
      case 'progress': {
        if (r.phase !== 'play' || !isRace(r.rule)) return;
        const cells = typeof m.cells === 'string' && m.cells.length === r.puzzle.length && /^[g01]+$/.test(m.cells) ? m.cells : undefined;
        const out: Msg = { t: 'progress', id: from, filled: Number(m.filled) | 0, mistakes: Number(m.mistakes) | 0, cells };
        n.broadcast(out);
        applyProgress(out);
        return;
      }
      case 'finish':
        return hostFinish(from, Number(m.ms) || 0);
      case 'giveup':
        return hostGiveUp(from);
      case 'attack':
        return hostAttack(from);
      case 'place':
        return hostPlace(from, Number(m.cell), Number(m.v), !!m.hint);
    }
  };
  // 방장 포함 플레이어 최대 MAX_PLAYERS 명 + 관전자 MAX_WATCHERS 명 (나눠 세는 건 hello 에서)
  void n.host(MAX_PLAYERS - 1 + MAX_WATCHERS);
}

function broadcastLobby(): void {
  if (!room || !net) return;
  net.broadcast({ t: 'lobby', players: room.players, watchers: room.watchers, level: room.level, size: room.size, rule: room.rule, hints: room.hints });
  refreshPlayers();
}

function hostStart(): void {
  if (!room || !net) return;
  const { puzzle, solution } = generate(room.level, Math.random, room.size);
  const m: Msg = { t: 'start', puzzle: toStr(puzzle), level: room.level, rule: room.rule, hints: room.hints };
  net.broadcast(m);
  startMulti(m.puzzle, m.level, m.rule, m.hints);
  room.judge = room.rule === 'claim' ? new ClaimJudge(puzzle, solution, FREEZE_MS, room.hints) : null;
}

/** 판 상태를 기억해 두고 관전자·끝낸 플레이어에게만 보낸다 (아직 푸는 사람끼리는 서로의 메모를 못 본다) */
function relayView(m: { t: 'view'; id: number } & View): void {
  const r = room;
  if (!r) return;
  r.views.set(m.id, { grid: m.grid, notes: m.notes, sel: m.sel });
  r.watch?.paint(m.id);
  for (const w of r.watchers) net?.sendTo(w.id, m);
  if (isRace(r.rule)) for (const p of r.players) if (p.id !== 0 && p.id !== m.id && !racing(p.id)) net?.sendTo(p.id, m);
}

/** 끝낸 플레이어에게 지금까지의 판 상태를 한 번에 (이후는 relayView 가 보낸다) */
function sendViews(id: number): void {
  if (!room || id === 0) return;
  for (const [pid, v] of room.views) if (pid !== id) net?.sendTo(id, { t: 'view', id: pid, ...v });
}

/** 게임 중에 들어온 관전자에게 지금 판·기록·각자의 판 상태를 */
function sendWatch(id: number): void {
  const r = room;
  if (!r || !net) return;
  net.sendTo(id, { t: 'watch', puzzle: r.puzzle, level: r.level, rule: r.rule, hints: r.hints, ms: (r.play ?? r.watch)?.elapsed() ?? 0, rows: currentRows() });
  for (const [pid, v] of r.views) net.sendTo(id, { t: 'view', id: pid, ...v });
  if (r.result) net.sendTo(id, { t: 'result', rows: r.result });
}

/** 점령형 판정 — 방장 자신의 입력도 여기로 */
function hostPlace(id: number, cell: number, v: number, hint: boolean): void {
  const r = room;
  if (!r?.judge || r.phase !== 'play' || r.result) return;
  const ev = r.judge.place(id, cell, v, hint, performance.now());
  if (!ev) return;
  net?.broadcast(ev);
  applyClaimEvent(ev);
  if (r.judge.full) endGame();
}

const racing = (id: number) => !!room && room.phase === 'play' && isRace(room.rule) && !room.result && !room.finishes.has(id) && !room.gaveUp.has(id);

function hostFinish(id: number, ms: number): void {
  if (!racing(id)) return;
  const m: Msg = { t: 'finished', id, ms };
  net?.broadcast(m);
  applyFinished(m);
  sendViews(id);
  checkRaceEnd();
}

function hostGiveUp(id: number): void {
  if (!racing(id)) return;
  const m: Msg = { t: 'gaveup', id };
  net?.broadcast(m);
  applyGaveUp(m);
  sendViews(id);
  checkRaceEnd();
}

/** 아이템전 콤보 공격: 방장이 대상(본인 뺀 푸는 중인 전원)과 각자의 리액션을 정해 모두에게 알린다 */
function hostAttack(from: number): void {
  const r = room;
  if (!r || r.rule !== 'item' || !racing(from)) return;
  const now = performance.now();
  // 빠른 3콤보는 아무리 빨라도 1초는 걸린다 — 그보다 잦은 공격은 무시
  if (now - (r.lastAttack.get(from) ?? -1e9) < 1000) return;
  const to = spitTargets(from, racers());
  if (!to.length) return;
  r.lastAttack.set(from, now);
  const m: Msg = { t: 'spit', from, to, say: to.map(() => randomReaction()) };
  net?.broadcast(m);
  applySpit(m);
}

function checkRaceEnd(): void {
  const r = room;
  if (r && r.players.every((p) => r.finishes.has(p.id) || r.gaveUp.has(p.id))) endGame();
}

/** 지금 기록 (최종 결과·관전자 스냅샷) */
function currentRows(): ResultRow[] {
  const r = room!;
  const claim = r.rule === 'claim';
  return r.players.map((p) => ({
    id: p.id,
    filled: claim ? (r.cells.get(p.id) ?? 0) : (r.progress.get(p.id)?.filled ?? 0),
    ms: claim ? null : (r.finishes.get(p.id) ?? null),
    score: claim ? (r.scores.get(p.id) ?? 0) : undefined,
    gaveUp: r.gaveUp.has(p.id) || undefined,
    mistakes: claim ? (r.misses.get(p.id) ?? 0) : (r.progress.get(p.id)?.mistakes ?? 0),
  }));
}

/** 지금 기록으로 최종 결과를 확정해 모두에게 */
function endGame(): void {
  const r = room;
  if (!r || r.result || r.phase !== 'play') return;
  const rows = currentRows();
  const m: Msg = { t: 'result', rows };
  net?.broadcast(m);
  onResult(rows);
}

// ── 게스트

function joinRoom(code: string, watch = false): void {
  leaveRoom();
  const r = (room = newRoom(false, watch));
  const n = (net = new Net());
  waiting(`${code} 방에 접속하는 중…`);
  n.onError = (e) => net === n && menu(netErrorText(e));
  n.onMessage = (m) => {
    switch (m.t) {
      case 'welcome':
        r.myId = m.id;
        n.send({ t: 'hello', name: myName, watch });
        return;
      case 'full':
        return menu(
          m.why === 'playing'
            ? '이미 게임이 진행 중인 방이에요. 관전으로는 들어갈 수 있어요.'
            : m.why === 'watchers'
              ? `관전석이 가득 찼어요 (최대 ${MAX_WATCHERS}명).`
              : `방이 가득 찼어요 (최대 ${MAX_PLAYERS}명).`,
        );
      case 'lobby': {
        const first = !r.players.length;
        if (!first && m.players.length + m.watchers.length > r.players.length + r.watchers.length) sfx.join();
        r.players = m.players;
        r.watchers = m.watchers ?? [];
        r.level = m.level;
        r.size = m.size === 6 ? 6 : 9;
        r.rule = m.rule;
        r.hints = m.hints ?? HINTS;
        if (first) {
          addChat(`${code} 방에 ${watch ? '관전하러 ' : ''}들어왔어요.`);
          lobby();
        } else refreshPlayers();
        return;
      }
      case 'start':
        return watch ? startWatch(m.puzzle, m.level, m.rule, m.hints, -3000) : startMulti(m.puzzle, m.level, m.rule, m.hints);
      case 'watch':
        return startWatch(m.puzzle, m.level, m.rule, m.hints, m.ms, m.rows);
      case 'view':
        return applyView(m);
      case 'progress':
        return applyProgress(m);
      case 'finished':
        return applyFinished(m);
      case 'gaveup':
        return applyGaveUp(m);
      case 'spit':
        return applySpit(m);
      case 'claim':
      case 'miss':
        return applyClaimEvent(m);
      case 'chat':
        return addChat(m);
      case 'result':
        return onResult(m.rows);
      case 'back':
        return lobby();
    }
  };
  void n.join(code);
}

// ── 로비·게임 공통

function lobby(): void {
  if (!room || !net) return;
  const r = room;
  r.phase = 'lobby';
  r.result = null;
  r.play = null;
  r.watch = null;
  r.judge = null;
  show(`
  <div class="screen lobby">
    <section class="lobby-main">
      <button class="ghost back" id="leave">← 나가기</button>
      <div class="code-box"><small>방 코드</small><b id="code">${esc(net.code)}</b><button class="ghost" id="copy">복사</button></div>
      <h3>참가자 <span id="count"></span></h3>
      <ul class="players" id="players"></ul>
      <div id="watchers"></div>
      <h3>규칙</h3>
      <div class="levels" id="rules">${RULE_KEYS.map((k) => `<button data-rule="${k}" ${r.host ? '' : 'disabled'}>${RULES[k].label}</button>`).join('')}</div>
      <p class="hint" id="rule-desc"></p>
      <h3>판 크기</h3>
      <div class="levels" id="sizes">${SIZES.map((n) => `<button data-size="${n}" ${r.host ? '' : 'disabled'}>${n}×${n}</button>`).join('')}</div>
      <h3>난이도</h3>
      <div class="levels" id="levels">${LEVEL_KEYS.map((l) => `<button data-level="${l}" ${r.host ? '' : 'disabled'}>${LEVELS[l].label}</button>`).join('')}</div>
      <p class="hint" id="level-desc"></p>
      <h3>힌트</h3>
      <div class="levels" id="hints">${HINT_OPTIONS.map((n) => `<button data-hints="${n}" ${r.host ? '' : 'disabled'}>${n ? `${n}번` : '없음'}</button>`).join('')}</div>
      ${r.host ? '<button class="primary" id="start">시작하기</button><p class="hint" id="start-hint"></p>' : `<p class="hint">${r.watching ? '관전 중이에요. 방장이 시작하면 모든 플레이어의 판과 메모를 볼 수 있어요.' : '방장이 시작하면 같은 퍼즐이 동시에 열려요.'}</p>`}
    </section>
    <aside class="chat-slot" id="chat-slot"></aside>
  </div>`);
  $('#chat-slot')!.appendChild(r.chat);
  $('#leave')!.onclick = () => menu();
  $('#copy')!.onclick = () => void navigator.clipboard?.writeText(net?.code ?? '');
  if (r.host) {
    app.querySelectorAll<HTMLButtonElement>('[data-level]').forEach(
      (b) =>
        (b.onclick = () => {
          r.level = b.dataset.level as Level;
          broadcastLobby();
        }),
    );
    app.querySelectorAll<HTMLButtonElement>('[data-rule]').forEach(
      (b) =>
        (b.onclick = () => {
          r.rule = b.dataset.rule as Rule;
          broadcastLobby();
        }),
    );
    app.querySelectorAll<HTMLButtonElement>('[data-size]').forEach(
      (b) =>
        (b.onclick = () => {
          r.size = Number(b.dataset.size) as Size;
          // 6×6 에 없는 난이도(지옥·변성대왕)였으면 고급으로
          if (!levelsFor(r.size).includes(r.level)) r.level = 'hard';
          broadcastLobby();
        }),
    );
    app.querySelectorAll<HTMLButtonElement>('[data-hints]').forEach(
      (b) =>
        (b.onclick = () => {
          r.hints = Number(b.dataset.hints);
          broadcastLobby();
        }),
    );
    $('#start')!.onclick = hostStart;
  }
  refreshPlayers();
}

/** 지금 방의 기록을 순위표용으로 */
function racers(): Racer[] {
  const r = room!;
  const claim = r.rule === 'claim';
  return r.players.map((p) => ({
    id: p.id,
    name: p.name,
    color: colorOf(p.id),
    avatar: avatar(p),
    me: p.id === r.myId,
    filled: claim ? (r.cells.get(p.id) ?? 0) : (r.progress.get(p.id)?.filled ?? 0),
    ms: claim ? null : (r.finishes.get(p.id) ?? null),
    score: claim ? (r.scores.get(p.id) ?? 0) : undefined,
    gaveUp: r.gaveUp.has(p.id),
    mistakes: claim ? (r.misses.get(p.id) ?? 0) : (r.progress.get(p.id)?.mistakes ?? 0),
    penaltyMs: penaltyFor(r.level),
    cells: claim ? undefined : r.progress.get(p.id)?.cells,
  }));
}

/** 로비면 참가자·규칙·난이도, 게임 중이면 실시간 순위표 */
function refreshPlayers(): void {
  if (!room) return;
  const r = room;
  const list = $('#players');
  if (list) {
    list.innerHTML = r.players
      .map((p) => `<li>${avatar(p)}<span>${esc(p.name)}</span>${p.id === 0 ? '<em>방장</em>' : ''}${p.id === r.myId ? '<em class="me">나</em>' : ''}</li>`)
      .join('');
    $('#count')!.textContent = `${r.players.length} / ${MAX_PLAYERS}`;
    $('#watchers')!.innerHTML = r.watchers.length
      ? `<h3>관전 <span>${r.watchers.length} / ${MAX_WATCHERS}</span></h3><ul class="players">${r.watchers
          .map((p) => `<li>${avatar(p)}<span>${esc(p.name)}</span>${p.id === r.myId ? '<em class="me">나</em>' : ''}</li>`)
          .join('')}</ul>`
      : '';
    app.querySelectorAll<HTMLButtonElement>('#hints [data-hints]').forEach((b) => b.classList.toggle('on', Number(b.dataset.hints) === r.hints));
    $('#level-desc')!.textContent = (r.size === 6 && LEVEL_DESC6[r.level]) || LEVEL_DESC[r.level];
    app.querySelectorAll<HTMLButtonElement>('#levels [data-level]').forEach((b) => {
      b.classList.toggle('on', b.dataset.level === r.level);
      b.classList.toggle('hidden', !levelsFor(r.size).includes(b.dataset.level as Level));
    });
    app.querySelectorAll<HTMLButtonElement>('#sizes [data-size]').forEach((b) => b.classList.toggle('on', Number(b.dataset.size) === r.size));
    app.querySelectorAll<HTMLButtonElement>('#rules [data-rule]').forEach((b) => b.classList.toggle('on', b.dataset.rule === r.rule));
    $('#rule-desc')!.textContent = RULES[r.rule].desc;
    const start = $<HTMLButtonElement>('#start');
    if (start) {
      start.disabled = r.players.length < 2;
      $('#start-hint')!.textContent = r.players.length < 2 ? '한 명 이상 들어와야 시작할 수 있어요.' : '';
    }
  }
  if (!$('#stand') || r.phase !== 'play') return;
  renderStandings($('#stand'), racers(), r.rule === 'claim', r.total);
  if (r.rule === 'claim') {
    let left = r.total;
    for (const n of r.cells.values()) left -= n;
    $('#left')!.textContent = `남은 칸 ${left}`;
  }
  // 레이스: 누군가 완주하면 방장은 남은 사람을 기다리지 않고 끝낼 수 있다
  $('#end-now')?.classList.toggle('hidden', !(r.host && isRace(r.rule) && r.finishes.size > 0 && !r.result));
  // 순위표를 새로 그리면 미리보기 위 침 자국이 사라지므로, 아직 맞고 있는 사람은 다시 덮는다
  for (const [id, until] of spitted) {
    if (performance.now() < until) spitOn($(`[data-pv="${id}"]`), false, '', until);
    else spitted.delete(id);
  }
}

function applyProgress(m: { id: number; filled: number; mistakes: number; cells?: string }): void {
  if (!room || room.phase !== 'play') return;
  room.progress.set(m.id, { filled: m.filled, mistakes: m.mistakes, cells: m.cells ?? room.progress.get(m.id)?.cells });
  refreshPlayers();
}

/** 침 맞는 중인 상대 (미리보기 다시 그릴 때 자국 유지용) */
const spitted = new Map<number, number>();

/**
 * 침 퉤: 쏜 사람 → 맞은 사람 전원에게 동시에 날아간다.
 * 내가 맞으면 내 판이 가려지고(연속이면 시간이 늘어남), 맞은 사람마다 리액션 말풍선.
 */
function applySpit(m: { from: number; to: number[]; say: number[] }): void {
  const r = room;
  if (!r || r.phase !== 'play' || r.result || !Array.isArray(m.to)) return;
  // 관전 화면이면 그 사람의 큰 판(data-w)으로
  const spot = (id: number) => centerOf(id === r.myId ? $('#board') : ($(`[data-w="${id}"]`) ?? $(`[data-pv="${id}"]`) ?? $(`.stand[data-key="${id}"]`)));
  const says = m.to.map((_, k) => SPIT_REACTIONS[m.say?.[k]] ?? SPIT_REACTIONS[0]);
  addChat(`💦 ${nameOf(m.from)}의 침 공격! ${m.to.map((id, k) => `${nameOf(id)} '${says[k]}'`).join(' · ')}`);
  sfx.whoosh();
  m.to.forEach((to, k) => {
    fx.projectile(spot(m.from), spot(to), SPIT_COLOR, () => {
      if (room?.phase !== 'play' || room.result) return;
      if (to === r.myId) {
        sfx.spit();
        spitOn($('.board-wrap'), true, says[k]);
      } else {
        if (k === 0 || !m.to.includes(r.myId)) sfx.claimOther();
        const until = spitUntil(performance.now(), spitted.get(to) ?? 0);
        spitted.set(to, until);
        spitOn($(`[data-pv="${to}"]`), false, '', until);
        spitOn($(`[data-w="${to}"]`), false, '', until);
        bubble($(`.stand[data-key="${to}"]`), says[k], colorOf(to));
      }
    });
  });
}

function applyFinished(m: { id: number; ms: number }): void {
  const r = room;
  if (!r || r.phase !== 'play') return;
  r.finishes.set(m.id, m.ms);
  // 실수 벌점이 붙어 완주 순서와 순위가 다를 수 있으니, 기록(시간+벌점)으로 말한다
  const e: Entry = { id: m.id, filled: 0, ms: m.ms, mistakes: r.progress.get(m.id)?.mistakes ?? 0, penaltyMs: penaltyFor(r.level) };
  const rec = `${fmt(finalMs(e)!)}${e.mistakes ? ` (실수 +${penaltyText(e.mistakes * e.penaltyMs!)})` : ''}`;
  addChat(`🏁 ${nameOf(m.id)} 님 완주! 기록 ${rec}`);
  if (m.id === r.myId) {
    if (r.finishes.size === 1) fx.confetti(70);
    sfx.line();
    r.play?.banner(`🏁 완주! 기록 ${rec} — 곧 다른 사람 판을 관전해요`);
    watchSoon('🏁 완주');
  } else sfx.claimOther();
  refreshPlayers();
}

function applyGaveUp(m: { id: number }): void {
  const r = room;
  if (!r || r.phase !== 'play') return;
  r.gaveUp.add(m.id);
  addChat(`🏳️ ${nameOf(m.id)} 님이 포기했어요.`);
  if (m.id === r.myId) {
    r.play?.end();
    r.play?.banner('포기했어요. 곧 다른 사람 판을 관전해요');
    watchSoon('🏳️ 포기');
  }
  refreshPlayers();
}

function applyClaimEvent(ev: ClaimEvent): void {
  const r = room;
  if (!r || r.phase !== 'play') return;
  if (ev.t === 'claim') {
    r.scores.set(ev.id, (r.scores.get(ev.id) ?? 0) + 1);
    r.cells.set(ev.id, (r.cells.get(ev.id) ?? 0) + 1);
  } else {
    r.scores.set(ev.id, (r.scores.get(ev.id) ?? 0) - 1);
    r.misses.set(ev.id, (r.misses.get(ev.id) ?? 0) + 1);
  }
  // 관전자는 보드가 없다 — 점수만 센다
  const board = r.play?.board;
  if (!board) return refreshPlayers();
  const mine = ev.id === r.myId;
  if (ev.t === 'claim') {
    const units = board.claim(ev.cell, ev.id, colorOf(ev.id), ev.hint);
    if (mine) {
      combo = ev.hint ? combo : combo + 1;
      if (ev.hint) sfx.hint();
      else sfx.correct(combo - 1);
    } else sfx.claimOther();
    cellFx(board, ev.cell, colorOf(ev.id), mine, units, mine ? (ev.hint ? '💡+1' : '+1') : undefined);
  } else if (mine) {
    board.miss(ev.cell, FREEZE_MS);
    wrongFx(board, ev.cell);
    const { x, y } = board.cellCenter(ev.cell);
    fx.text(x, y - 24, '-1', '#e05252');
  }
  refreshPlayers();
}

/** 새 판의 방 상태를 초기화. 받은 퍼즐이 잘못됐으면 null */
function beginRound(puzzleStr: string, level: Level, rule: Rule, hints: number): { puzzle: Grid; solution: Grid } | null {
  const r = room!;
  const puzzle = fromStr(puzzleStr);
  const solution = puzzle.length === 36 || puzzle.length === 81 ? solve(puzzle) : null;
  if (!solution) {
    menu('받은 퍼즐이 올바르지 않아요.');
    return null;
  }
  r.phase = 'play';
  r.level = level;
  r.rule = rule;
  r.hints = Number(hints) || 0;
  r.puzzle = puzzleStr;
  r.views = new Map();
  r.result = null;
  r.total = puzzle.filter((v) => !v).length;
  const blank = puzzle.map((v) => (v ? 'g' : '0')).join('');
  r.progress = new Map(r.players.map((p) => [p.id, { filled: 0, mistakes: 0, cells: blank }]));
  r.finishes = new Map();
  r.gaveUp = new Set();
  r.misses = new Map();
  r.lastAttack = new Map();
  spitted.clear();
  r.scores = new Map(r.players.map((p) => [p.id, 0]));
  r.cells = new Map(r.players.map((p) => [p.id, 0]));
  return { puzzle, solution };
}

function startMulti(puzzleStr: string, level: Level, rule: Rule, hints: number): void {
  if (!room || !net) return;
  const r = room;
  const round = beginRound(puzzleStr, level, rule, hints);
  if (!round) return;
  const { puzzle, solution } = round;
  const claim = rule === 'claim';
  const meter = rule === 'item' ? new ComboMeter() : undefined;
  r.play = play(puzzle, solution, {
    level,
    hints: r.hints,
    color: colorOf(r.myId),
    tag: RULES[rule].label,
    chat: true,
    shared: claim,
    side: claim
      ? `<h3>실시간 점수</h3><div class="standings" id="stand"></div><p class="hint"><span id="left"></span> · 맞히면 +1, 틀리면 -1 · 2초 정지</p>`
      : `<h3>실시간 순위</h3><div class="standings" id="stand"></div><p class="hint">${meter ? `⚡ 5초 안에 ${ATTACK_COMBO}연속 정답 → 나 빼고 전원에게 침 퉤!` : '완주한 순서대로 시간이 기록돼요. 모두 끝나면 순위 발표!'}</p>${r.host ? '<button class="ghost hidden" id="end-now">지금 종료하고 순위 발표</button>' : ''}`,
    meter,
    onProgress(filled, mistakes) {
      if (claim) return;
      const b = r.play!.board;
      const cells = b.grid.map((_, i) => (b.given[i] ? 'g' : b.done(i) ? '1' : '0')).join('');
      const m: Msg = { t: 'progress', id: r.myId, filled, mistakes, cells };
      if (r.host) net?.broadcast(m);
      else net?.send(m);
      applyProgress(m);
    },
    onSolved(ms) {
      if (claim) return;
      if (r.host) hostFinish(0, ms);
      else net?.send({ t: 'finish', id: r.myId, ms });
    },
    onGiveUp: claim
      ? undefined
      : () => {
          if (r.host) hostGiveUp(0);
          else net?.send({ t: 'giveup' });
        },
    onQuit: () => menu(),
  });
  const board = r.play.board;
  if (claim) {
    board.onPlace = (cell, v, hint) => {
      if (r.host) hostPlace(0, cell, v, hint);
      else net?.send({ t: 'place', cell, v, hint });
    };
    wireInputSounds(board);
  } else
    wirePersonalFx(board, colorOf(r.myId), meter, () => {
      if (r.host) hostAttack(0);
      else net?.send({ t: 'attack' });
    });
  // 판·메모·고른 칸이 바뀔 때마다 관전자에게 (방장이 중계)
  let sent = '';
  board.onRender = () => {
    const v = board.snapshot();
    if (v.grid + v.notes + v.sel === sent) return;
    sent = v.grid + v.notes + v.sel;
    const m: Msg = { t: 'view', id: r.myId, ...v };
    if (r.host) relayView(m);
    else net?.send(m);
  };
  board.onRender();
  const endNow = $('#end-now');
  if (endNow) endNow.onclick = () => endGame();
  $('#chat-slot')!.appendChild(r.chat);
  addChat(`${LEVELS[level].label} · ${RULES[rule].label} · ${r.hints ? `힌트 ${r.hints}번` : '힌트 없음'} 시작!`);
  refreshPlayers();
}

// ── 관전

interface Watch {
  end(): void;
  /** 시작 후 지난 시간 (늦게 들어온 관전자에게 보낼 용도) */
  elapsed(): number;
  overlay(html: string): HTMLElement;
  banner(html: string): void;
  /** 플레이어 한 명의 판을 다시 그린다 */
  paint(id: number): void;
}

/** 관전자로 들어왔을 때: 새 판 상태를 맞추고 관전 화면으로 (ms = 시작 후 지난 시간, 카운트다운 중이면 음수) */
function startWatch(puzzleStr: string, level: Level, rule: Rule, hints: number, ms: number, rows?: ResultRow[]): void {
  if (!room || !net) return;
  const round = beginRound(puzzleStr, level, rule, hints);
  if (!round) return;
  if (rows) applyRows(rows);
  watchScreen(round.puzzle, round.solution, ms);
  addChat(`👀 ${LEVELS[level].label} · ${RULES[rule].label} 관전 중`);
}

/** 레이스형: 내가 완주·포기하면 축하 배너를 잠깐 보여 준 뒤 남은 사람들의 판을 관전한다 */
function watchSoon(tag: string): void {
  const r = room;
  setTimeout(() => {
    const pl = r?.play;
    if (!pl || room !== r || r.phase !== 'play' || r.result) return;
    pl.end();
    r.play = null;
    const puzzle = fromStr(r.puzzle);
    watchScreen(puzzle, solve(puzzle)!, pl.elapsed(), tag);
  }, 1800);
}

/** 고른 칸 번호 검사 (없거나 이상하면 -1) */
function selOf(v: unknown): number {
  const i = Number(v);
  return Number.isInteger(i) && i >= 0 && i < (room?.puzzle.length ?? 0) ? i : -1;
}

/**
 * 관전 화면: 플레이어마다 판·메모·고른 칸을 그대로.
 * done = 끝낸 플레이어가 보는 중이면 그 표시(🏁 완주 등) — 내 판은 빼고 남의 판만 보여 준다.
 */
function watchScreen(puzzle: Grid, solution: Grid, ms: number, done?: string): void {
  if (!room || !net) return;
  const r = room;
  const { level, rule } = r;
  const claim = rule === 'claim';
  const n = Math.sqrt(puzzle.length);
  const G = geo(puzzle.length);
  const shown = done ? r.players.filter((p) => p.id !== r.myId) : r.players;
  const cells = Array.from({ length: puzzle.length }, (_, i) => `<div class="cell" data-r="${Math.floor(i / n)}" data-c="${i % n}"></div>`).join('');
  show(`
  <div class="screen play watching">
    <aside class="side"><h3>${claim ? '실시간 점수' : '실시간 순위'}</h3><div class="standings" id="stand"></div>${claim ? '<p class="hint"><span id="left"></span></p>' : ''}${r.host && !claim ? '<button class="ghost hidden" id="end-now">지금 종료하고 순위 발표</button>' : ''}</aside>
    <main class="center">
      <div class="hud">
        <span class="chip">${n === 6 ? '6×6 · ' : ''}${LEVELS[level].label}</span><span class="chip accent">${RULES[rule].label}</span>
        <span class="timer" id="timer">0:00</span>
        <span class="chip">${done ? `${done} · ` : ''}👀 관전</span>
        <button class="ghost" id="quit">나가기</button>
      </div>
      <div class="watch-grid">${shown
        .map((p) => `<div class="watch-card" style="--own:${colorOf(p.id)}"><div class="watch-name">${avatar(p)}<b>${esc(p.name)}</b></div><div class="board${n === 6 ? ' six' : ''}" data-w="${p.id}">${cells}</div></div>`)
        .join('')}</div>
    </main>
    <aside class="chat-slot" id="chat-slot"></aside>
  </div>`);
  $('#quit')!.onclick = () => menu();
  const endNow = $('#end-now');
  if (endNow) endNow.onclick = () => endGame();
  $('#chat-slot')!.appendChild(r.chat);

  const t0 = performance.now() - ms;
  let ended = false;
  const timer = $('#timer')!;
  const tick = setInterval(() => !ended && (timer.textContent = fmt(Math.max(0, performance.now() - t0))), 250);
  cleanup = () => clearInterval(tick);

  const w: Watch = {
    end: () => (ended = true),
    elapsed: () => performance.now() - t0,
    overlay,
    banner: () => {},
    paint(id) {
      const el = $(`[data-w="${id}"]`);
      if (!el) return;
      const v = r.views.get(id);
      const grid = v ? fromStr(v.grid) : puzzle;
      // 그 사람이 고른 칸과 같은 줄·박스를 실제 판처럼 강조
      const s = v?.sel ?? -1;
      const peers = s >= 0 ? new Set(G.peers[s]) : null;
      [...el.children].forEach((c, i) => {
        const notes = v ? parseInt(v.notes.slice(i * 2, i * 2 + 2), 36) : 0;
        const val = grid[i];
        c.className =
          'cell' +
          (puzzle[i] ? ' given' : val ? ' user' : '') +
          (val && val !== solution[i] ? ' wrong' : '') +
          (i === s ? ' sel' : peers?.has(i) ? ' peer' : '');
        if (val) c.innerHTML = `<span class="v">${val}</span>`;
        else if (notes) {
          let h = '<div class="notes">';
          for (let k = 1; k <= n; k++) h += `<i>${notes & (1 << (k - 1)) ? k : ''}</i>`;
          c.innerHTML = h + '</div>';
        } else c.innerHTML = '';
      });
    },
  };
  r.watch = w;
  for (const p of shown) w.paint(p.id);
  refreshPlayers();
}

/** 받은 판 상태가 지금 판 크기에 맞는지 (grid 칸당 1 글자, notes 칸당 2 글자) */
function viewOk(m: { grid: unknown; notes: unknown }): boolean {
  const n = room?.puzzle.length ?? 0;
  const grid = String(m.grid);
  const notes = String(m.notes);
  return grid.length === n && notes.length === n * 2 && /^[0-9]+$/.test(grid) && /^[0-9a-z]+$/.test(notes);
}

/** 관전 화면이 아직 없어도(완주 직후 배너 중) 기억해 두었다가 화면을 열 때 그린다 */
function applyView(m: { id: number; grid: string; notes: string; sel?: number }): void {
  const r = room;
  if (!r || r.phase !== 'play' || !viewOk(m)) return;
  r.views.set(m.id, { grid: m.grid, notes: m.notes, sel: selOf(m.sel) });
  r.watch?.paint(m.id);
}

/** 받은 기록으로 순위표를 맞춘다 */
function applyRows(rows: ResultRow[]): void {
  const r = room!;
  const claim = r.rule === 'claim';
  for (const row of rows) {
    if (claim) {
      r.scores.set(row.id, row.score ?? 0);
      r.cells.set(row.id, row.filled);
      r.misses.set(row.id, row.mistakes ?? 0);
    } else {
      r.progress.set(row.id, { filled: row.filled, mistakes: row.mistakes ?? 0, cells: r.progress.get(row.id)?.cells });
      if (row.ms != null) r.finishes.set(row.id, row.ms);
      if (row.gaveUp) r.gaveUp.add(row.id);
    }
  }
}

function onResult(rows: ResultRow[]): void {
  const pl = room?.play ?? room?.watch;
  if (!room || !pl || room.result) return;
  const r = room;
  r.result = rows;
  pl.end();
  pl.banner('');
  const claim = r.rule === 'claim';
  // 받은 최종 기록으로 순위표를 맞춘다 (중간에 놓친 메시지가 있어도 결과는 같게)
  applyRows(rows);
  refreshPlayers();
  const final = racers();
  const winners = (claim ? rankScore(final) : rankRace(final)).slice(0, 1);
  addChat(`🏆 1위 ${winners.map((w) => w.name).join(', ')}!`);
  const d = resultDialog(
    pl,
    final,
    claim,
    r.total,
    `${r.host ? '<button id="again">로비로</button>' : '<span class="hint">방장이 다음 판을 준비 중…</span>'}<button class="ghost" id="home">나가기</button>`,
  );
  d.querySelector<HTMLButtonElement>('#home')!.onclick = () => menu();
  const again = d.querySelector<HTMLButtonElement>('#again');
  if (again)
    again.onclick = () => {
      net?.broadcast({ t: 'back' });
      lobby();
    };
}

menu();
