import './style.css';
import { AI_PROFILES, AiSolver } from './game/Ai';
import { ClaimJudge, type ClaimEvent } from './game/Claim';
import { ATTACK_COMBO, ComboMeter, SPIT_MS, SPIT_REACTIONS, spitTargets, spitUntil } from './game/Combo';
import { finalMs, MISTAKE_PENALTY_MS, places, rankRace, rankScore, type Entry } from './game/Ranking';
import { fromStr, generate, HINTS, LEVELS, solve, toStr, type Grid, type Level } from './game/Sudoku';
import { Fx } from './fx/Fx';
import { sfx } from './fx/Sfx';
import { Net, type NetError } from './net/Net';
import { CHAT_MAX, cleanText, FREEZE_MS, isRace, MAX_PLAYERS, NAME_MAX, RULES, type Msg, type PlayerInfo, type ResultRow, type Rule } from './net/Protocol';
import { Board } from './ui/Board';

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
if (import.meta.env.DEV) Object.assign(window, { __fx: fx });
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
  $('#join')!.onsubmit = (e) => {
    e.preventDefault();
    const code = $<HTMLInputElement>('#code')!.value.trim().toUpperCase();
    if (code.length !== 5) return;
    saveName();
    joinRoom(code);
  };
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
const splats = new WeakMap<Element, { d: HTMLElement; until: number; timer: ReturnType<typeof setTimeout> }>();

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
  if (live) {
    d = cur!.d;
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
  }
  const em = d.querySelector('em');
  if (em && say) em.textContent = say;
  const timer = setTimeout(() => {
    d.classList.add('off');
    setTimeout(() => d.remove(), 400);
  }, end - now);
  splats.set(el, { d, until: end, timer });
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
  onQuit(): void;
}

function play(puzzle: Grid, solution: Grid, o: PlayOpts): Play {
  show(`
  <div class="screen play">
    <aside class="side">${o.side}</aside>
    <main class="center">
      <div class="hud">
        <span class="chip">${LEVELS[o.level].label}</span>${o.tag ? `<span class="chip accent">${o.tag}</span>` : ''}
        <span class="timer" id="timer">0:00</span>
        <span class="chip" id="miss">실수 0</span>
        ${o.meter ? `<span class="chip combo" id="combo">⚡ <b>0</b>/${ATTACK_COMBO}<i></i></span>` : ''}
        ${o.onGiveUp ? '<button class="ghost" id="giveup">포기</button>' : ''}
        <button class="ghost" id="quit">나가기</button>
      </div>
      <div class="board-wrap"><div class="board" id="board"></div><div class="countdown" id="cd"><b>3</b></div><div class="banner" id="banner"></div></div>
      <div class="pad" id="pad"></div>
    </main>
    ${o.chat ? '<aside class="chat-slot" id="chat-slot"></aside>' : ''}
  </div>`);
  const board = new Board($('#board')!, $('#pad')!, puzzle, solution, o.shared, o.level === 'hard');
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
    overlay(html) {
      $('.overlay')?.remove();
      const d = document.createElement('div');
      d.className = 'overlay';
      d.innerHTML = `<div class="dialog">${html}</div>`;
      $('.play')!.appendChild(d);
      return d;
    },
    banner(html) {
      const b = $('#banner');
      if (!b) return;
      b.innerHTML = html;
      b.classList.toggle('on', !!html);
    },
  };
  board.onChange = (f, m) => o.onProgress?.(f, m);
  board.onSolved = () => {
    const ms = h.elapsed();
    h.end();
    o.onSolved?.(ms);
  };
  $('#quit')!.onclick = () => o.onQuit();
  const giveBtn = $('#giveup');
  if (giveBtn && o.onGiveUp) giveBtn.onclick = () => started && !h.ended && o.onGiveUp!();

  const cd = $('#cd')!;
  let n = 3;
  sfx.countdown();
  const cdT = setInterval(() => {
    n--;
    if (n > 0) {
      sfx.countdown();
      cd.innerHTML = `<b>${n}</b>`;
      return;
    }
    clearInterval(cdT);
    sfx.countdown(true);
    cd.innerHTML = '<b>시작!</b>';
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

/** 완주 기록 옆 벌점 설명: " · 3:12 + 실수 2 (+20초)" */
const penaltyNote = (e: Entry) => (e.ms != null && e.mistakes ? ` · ${fmt(e.ms)} + 실수 ${e.mistakes} (+${(e.mistakes * MISTAKE_PENALTY_MS) / 1000}초)` : '');

/** 규칙대로 정렬해 그린다. 순위가 바뀐 줄은 이전 자리에서 미끄러져 온다 */
function renderStandings(el: HTMLElement | null, racers: Racer[], claim: boolean, total: number): Racer[] {
  const sorted = claim ? rankScore(racers) : rankRace(racers);
  if (!el) return sorted;
  const pl = places(sorted, claim);
  const before = new Map([...el.children].map((c) => [(c as HTMLElement).dataset.key, c.getBoundingClientRect().top]));
  el.innerHTML = sorted
    .map((e, i) => {
      const value = claim ? `${e.score ?? 0}` : e.ms != null ? fmt(finalMs(e)!) : `${e.filled}/${total}`;
      const sub = claim
        ? `${e.filled}칸`
        : e.ms != null
          ? `${e.projected ? '끝까지 풀면 (예상)' : '🏁 완주'}${penaltyNote(e)}`
          : e.gaveUp
            ? '포기'
            : `${Math.round((e.filled / total) * 100)}%`;
      const miss = e.mistakes && e.ms == null ? ` · 실수 ${e.mistakes}` : '';
      const pv = e.cells && !e.me ? `<div class="pv" data-pv="${e.id}">${[...e.cells].map((c) => `<i class="${c === 'g' ? 'g' : c === '1' ? 'f' : ''}"></i>`).join('')}</div>` : '';
      const pct = claim ? 0 : e.ms != null ? 100 : (e.filled / total) * 100;
      return `<div class="stand${e.me ? ' me' : ''}${e.ms != null ? ' done' : ''}${e.gaveUp ? ' out' : ''}" data-key="${e.id}" style="--own:${e.color}">
        <span class="place">${MEDALS[pl[i] - 1] ?? pl[i]}</span>${e.avatar}
        <div class="who"><b>${esc(e.name)}</b><small>${sub}${miss}</small>${claim ? '' : `<div class="bar"><i style="width:${pct}%"></i></div>`}</div>
        ${pv}<strong>${value}</strong>
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
function resultDialog(h: Play, racers: Racer[], claim: boolean, total: number, buttons: string): HTMLElement {
  const sorted = claim ? rankScore(racers) : rankRace(racers);
  const pl = places(sorted, claim);
  const myPlace = pl[sorted.findIndex((e) => e.me)] ?? 0;
  const top = sorted.filter((_, i) => pl[i] === 1);
  const title = myPlace === 1 ? (top.length > 1 ? '공동 1위!' : '1위!') : `${myPlace}위`;
  celebrate(myPlace === 1);
  const d = h.overlay(`
    <img class="result-img${myPlace === 1 ? '' : ' dim'}" src="assets/trophy.svg" alt="" />
    <h2>${title}</h2>
    <p class="hint">${claim ? '점수 순위 (맞힌 칸 − 실수)' : `기록 순위 (완주 시간 + 실수당 ${MISTAKE_PENALTY_MS / 1000}초)`}</p>
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
  show(`
  <div class="screen setup">
    <button class="ghost back" id="back">← 메뉴</button>
    <h2>상대할 AI 를 고르세요</h2>
    <div class="levels mode" id="mode">
      <button data-mode="0">일반</button><button data-mode="1">아이템전 💦</button>
    </div>
    <p class="hint" id="mode-desc"></p>
    <div class="bots">
      ${LEVEL_KEYS.map((l) => {
        const p = AI_PROFILES[l];
        return `<button class="bot ${l}" data-level="${l}">
          <img src="${p.avatar}" alt="" />
          <span class="chip">${LEVELS[l].label}</span>
          <b>${p.name}</b><small>${p.blurb}</small>
        </button>`;
      }).join('')}
    </div>
  </div>`);
  const paint = () => {
    app.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', (b.dataset.mode === '1') === items));
    $('#mode-desc')!.textContent = items ? RULES.item.desc.replace('나 빼고 전원에게', 'AI 에게') + ' AI 도 콤보가 차면 뱉어요!' : `먼저 끝나도 계속! 기록 = 완주 시간 + 실수당 ${MISTAKE_PENALTY_MS / 1000}초.`;
  };
  app.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(
    (b) =>
      (b.onclick = () => {
        items = b.dataset.mode === '1';
        store.set('singleItems', items ? '1' : '0');
        paint();
      }),
  );
  paint();
  $('#back')!.onclick = () => menu();
  app.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) => (b.onclick = () => startSingle(b.dataset.level as Level, items)));
}

function startSingle(level: Level, items: boolean): void {
  const { puzzle, solution } = generate(level);
  const prof = AI_PROFILES[level];
  const ai = new AiSolver(puzzle, solution, prof);
  const total = ai.total;
  const me: PlayerInfo = { id: 0, name: myName };
  const meR: Racer = { id: 0, name: myName, color: colorOf(0), avatar: avatar(me), me: true, filled: 0, ms: null, mistakes: 0 };
  const aiR: Racer = { id: 1, name: prof.name, color: '#8a93a6', avatar: `<img class="avatar pic" src="${prof.avatar}" alt="" />`, me: false, filled: 0, ms: null, mistakes: 0 };
  const meter = items ? new ComboMeter() : undefined;
  const aiMeter = new ComboMeter();
  let done = false;

  const h = play(puzzle, solution, {
    level,
    color: colorOf(0),
    tag: items ? RULES.item.label : undefined,
    chat: false,
    meter,
    side: `
      <h3>실시간 순위</h3>
      <div class="standings" id="stand"></div>
      <p class="hint mini-title">${prof.name} 의 판</p>
      <div class="mini" id="ai-mini">${puzzle.map((v) => `<i class="${v ? 'g' : ''}"></i>`).join('')}</div>
      <p class="hint">먼저 끝나도 계속! 기록 = 완주 시간 + 실수당 ${MISTAKE_PENALTY_MS / 1000}초.</p>`,
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
    d.querySelector<HTMLButtonElement>('#again')!.onclick = () => startSingle(level, items);
    d.querySelector<HTMLButtonElement>('#other')!.onclick = () => singleSetup();
    d.querySelector<HTMLButtonElement>('#home')!.onclick = () => menu();
  }
}

// ───────────────────────── 멀티 ─────────────────────────

interface Room {
  host: boolean;
  myId: number;
  players: PlayerInfo[];
  level: Level;
  rule: Rule;
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

function newRoom(host: boolean): Room {
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
    players: [],
    level: 'medium',
    rule: 'claim',
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
    switch (m.t) {
      case 'hello': {
        if (r.phase !== 'lobby') {
          n.sendTo(from, { t: 'full', why: 'playing' });
          n.kick(from);
          return;
        }
        const p = { id: from, name: cleanText(m.name, NAME_MAX) || `손님${from}` };
        r.players.push(p);
        addChat(`${p.name} 님이 들어왔어요.`);
        sfx.join();
        broadcastLobby();
        return;
      }
      case 'chat': {
        const p = r.players.find((x) => x.id === from);
        const text = cleanText(m.text, CHAT_MAX);
        if (!p || !text) return;
        const out: Msg = { t: 'chat', id: from, name: p.name, text };
        n.broadcast(out);
        addChat(out);
        return;
      }
      case 'progress': {
        if (r.phase !== 'play' || !isRace(r.rule)) return;
        const cells = typeof m.cells === 'string' && /^[g01]{81}$/.test(m.cells) ? m.cells : undefined;
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
  // 방장 포함 최대 MAX_PLAYERS 명
  void n.host(MAX_PLAYERS - 1);
}

function broadcastLobby(): void {
  if (!room || !net) return;
  net.broadcast({ t: 'lobby', players: room.players, level: room.level, rule: room.rule });
  refreshPlayers();
}

function hostStart(): void {
  if (!room || !net) return;
  const { puzzle, solution } = generate(room.level);
  const m: Msg = { t: 'start', puzzle: toStr(puzzle), level: room.level, rule: room.rule };
  net.broadcast(m);
  startMulti(m.puzzle, m.level, m.rule);
  room.judge = room.rule === 'claim' ? new ClaimJudge(puzzle, solution, FREEZE_MS) : null;
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
  checkRaceEnd();
}

function hostGiveUp(id: number): void {
  if (!racing(id)) return;
  const m: Msg = { t: 'gaveup', id };
  net?.broadcast(m);
  applyGaveUp(m);
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

/** 지금 기록으로 최종 결과를 확정해 모두에게 */
function endGame(): void {
  const r = room;
  if (!r || r.result || r.phase !== 'play') return;
  const claim = r.rule === 'claim';
  const rows: ResultRow[] = r.players.map((p) => ({
    id: p.id,
    filled: claim ? (r.cells.get(p.id) ?? 0) : (r.progress.get(p.id)?.filled ?? 0),
    ms: claim ? null : (r.finishes.get(p.id) ?? null),
    score: claim ? (r.scores.get(p.id) ?? 0) : undefined,
    gaveUp: r.gaveUp.has(p.id) || undefined,
    mistakes: claim ? (r.misses.get(p.id) ?? 0) : (r.progress.get(p.id)?.mistakes ?? 0),
  }));
  const m: Msg = { t: 'result', rows };
  net?.broadcast(m);
  onResult(rows);
}

// ── 게스트

function joinRoom(code: string): void {
  leaveRoom();
  const r = (room = newRoom(false));
  const n = (net = new Net());
  waiting(`${code} 방에 접속하는 중…`);
  n.onError = (e) => net === n && menu(netErrorText(e));
  n.onMessage = (m) => {
    switch (m.t) {
      case 'welcome':
        r.myId = m.id;
        n.send({ t: 'hello', name: myName });
        return;
      case 'full':
        return menu(m.why === 'playing' ? '이미 게임이 진행 중인 방이에요.' : `방이 가득 찼어요 (최대 ${MAX_PLAYERS}명).`);
      case 'lobby': {
        const first = !r.players.length;
        if (!first && m.players.length > r.players.length) sfx.join();
        r.players = m.players;
        r.level = m.level;
        r.rule = m.rule;
        if (first) {
          addChat(`${code} 방에 들어왔어요.`);
          lobby();
        } else refreshPlayers();
        return;
      }
      case 'start':
        return startMulti(m.puzzle, m.level, m.rule);
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
  r.judge = null;
  show(`
  <div class="screen lobby">
    <section class="lobby-main">
      <button class="ghost back" id="leave">← 나가기</button>
      <div class="code-box"><small>방 코드</small><b id="code">${esc(net.code)}</b><button class="ghost" id="copy">복사</button></div>
      <h3>참가자 <span id="count"></span></h3>
      <ul class="players" id="players"></ul>
      <h3>규칙</h3>
      <div class="levels" id="rules">${RULE_KEYS.map((k) => `<button data-rule="${k}" ${r.host ? '' : 'disabled'}>${RULES[k].label}</button>`).join('')}</div>
      <p class="hint" id="rule-desc"></p>
      <h3>난이도</h3>
      <div class="levels" id="levels">${LEVEL_KEYS.map((l) => `<button data-level="${l}" ${r.host ? '' : 'disabled'}>${LEVELS[l].label}</button>`).join('')}</div>
      ${r.host ? '<button class="primary" id="start">시작하기</button><p class="hint" id="start-hint"></p>' : `<p class="hint">방장이 시작하면 같은 퍼즐이 동시에 열려요. 힌트는 각자 ${HINTS}번!</p>`}
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
    app.querySelectorAll<HTMLButtonElement>('#levels [data-level]').forEach((b) => b.classList.toggle('on', b.dataset.level === r.level));
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
    const left = r.play ? r.play.board.grid.filter((v) => !v).length : 0;
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
  if (!r?.play || r.phase !== 'play' || r.result || !Array.isArray(m.to)) return;
  const spot = (id: number) => centerOf(id === r.myId ? $('#board') : $(`[data-pv="${id}"]`) ?? $(`.stand[data-key="${id}"]`));
  const says = m.to.map((_, k) => SPIT_REACTIONS[m.say?.[k]] ?? SPIT_REACTIONS[0]);
  addChat(`💦 ${nameOf(m.from)}의 침 공격! ${m.to.map((id, k) => `${nameOf(id)} '${says[k]}'`).join(' · ')}`);
  sfx.whoosh();
  m.to.forEach((to, k) => {
    fx.projectile(spot(m.from), spot(to), SPIT_COLOR, () => {
      if (!room?.play || room.result) return;
      if (to === r.myId) {
        sfx.spit();
        spitOn($('.board-wrap'), true, says[k]);
      } else {
        if (k === 0 || !m.to.includes(r.myId)) sfx.claimOther();
        const until = spitUntil(performance.now(), spitted.get(to) ?? 0);
        spitted.set(to, until);
        spitOn($(`[data-pv="${to}"]`), false, '', until);
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
  const e: Entry = { id: m.id, filled: 0, ms: m.ms, mistakes: r.progress.get(m.id)?.mistakes ?? 0 };
  const rec = `${fmt(finalMs(e)!)}${e.mistakes ? ` (실수 +${(e.mistakes! * MISTAKE_PENALTY_MS) / 1000}초)` : ''}`;
  addChat(`🏁 ${nameOf(m.id)} 님 완주! 기록 ${rec}`);
  if (m.id === r.myId) {
    if (r.finishes.size === 1) fx.confetti(70);
    sfx.line();
    r.play?.banner(`🏁 완주! 기록 ${rec} — 다른 사람을 기다리는 중…`);
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
    r.play?.banner('포기했어요. 다른 사람을 기다리는 중…');
  }
  refreshPlayers();
}

function applyClaimEvent(ev: ClaimEvent): void {
  const r = room;
  const board = r?.play?.board;
  if (!r || !board || r.phase !== 'play') return;
  const mine = ev.id === r.myId;
  if (ev.t === 'claim') {
    r.scores.set(ev.id, (r.scores.get(ev.id) ?? 0) + 1);
    r.cells.set(ev.id, (r.cells.get(ev.id) ?? 0) + 1);
    const units = board.claim(ev.cell, ev.id, colorOf(ev.id), ev.hint);
    if (mine) {
      combo = ev.hint ? combo : combo + 1;
      if (ev.hint) sfx.hint();
      else sfx.correct(combo - 1);
    } else sfx.claimOther();
    cellFx(board, ev.cell, colorOf(ev.id), mine, units, mine ? (ev.hint ? '💡+1' : '+1') : undefined);
  } else {
    r.scores.set(ev.id, (r.scores.get(ev.id) ?? 0) - 1);
    r.misses.set(ev.id, (r.misses.get(ev.id) ?? 0) + 1);
    if (mine) {
      board.miss(ev.cell, FREEZE_MS);
      wrongFx(board, ev.cell);
      const { x, y } = board.cellCenter(ev.cell);
      fx.text(x, y - 24, '-1', '#e05252');
    }
  }
  refreshPlayers();
}

function startMulti(puzzleStr: string, level: Level, rule: Rule): void {
  if (!room || !net) return;
  const r = room;
  const puzzle = fromStr(puzzleStr);
  const solution = solve(puzzle);
  if (!solution) return menu('받은 퍼즐이 올바르지 않아요.');
  r.phase = 'play';
  r.level = level;
  r.rule = rule;
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
  const claim = rule === 'claim';
  const meter = rule === 'item' ? new ComboMeter() : undefined;
  r.play = play(puzzle, solution, {
    level,
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
  const endNow = $('#end-now');
  if (endNow) endNow.onclick = () => endGame();
  $('#chat-slot')!.appendChild(r.chat);
  addChat(`${LEVELS[level].label} · ${RULES[rule].label} 시작!`);
  refreshPlayers();
}

function onResult(rows: ResultRow[]): void {
  if (!room?.play || room.result) return;
  const r = room;
  const pl = room.play;
  r.result = rows;
  pl.end();
  pl.banner('');
  const claim = r.rule === 'claim';
  // 받은 최종 기록으로 순위표를 맞춘다 (중간에 놓친 메시지가 있어도 결과는 같게)
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
