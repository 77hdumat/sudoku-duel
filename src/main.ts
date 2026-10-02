import './style.css';
import { AI_PROFILES, AiSolver } from './game/Ai';
import { ClaimJudge, type ClaimEvent } from './game/Claim';
import { fromStr, generate, HINTS, LEVELS, solve, toStr, type Grid, type Level } from './game/Sudoku';
import { Fx } from './fx/Fx';
import { sfx } from './fx/Sfx';
import { Net, type NetError } from './net/Net';
import { CHAT_MAX, cleanText, FREEZE_MS, MAX_PLAYERS, NAME_MAX, RULES, type Msg, type PlayerInfo, type Rule } from './net/Protocol';
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

// 첫 입력에 오디오를 깨우고, 일반 버튼에 클릭음
addEventListener('pointerdown', () => sfx.unlock(), { once: true });
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (b && !b.classList.contains('digit') && !b.classList.contains('tool')) sfx.click();
});

const muteBtn = document.createElement('button');
muteBtn.id = 'mute';
muteBtn.title = '효과음 켜기/끄기';
const paintMute = () => (muteBtn.textContent = sfx.muted ? '🔇' : '🔊');
muteBtn.onclick = () => {
  sfx.setMuted(!sfx.muted);
  paintMute();
};
paintMute();
document.body.appendChild(muteBtn);

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
  board.onInput = (k) => (k === 'select' ? sfx.select() : k === 'note' ? sfx.note() : sfx.wrong());
}

/** 개인판(싱글·레이스형) 보드에 정답·오답·힌트 이펙트를 연결 */
function wirePersonalFx(board: Board, color: string): void {
  board.onCorrect = (i, hint, units) => {
    combo = hint ? combo : combo + 1;
    if (hint) sfx.hint();
    else sfx.correct(combo - 1);
    cellFx(board, i, hint ? '#f2c94c' : color, true, units, hint ? '💡' : combo >= 3 ? `${combo} 콤보!` : undefined);
  };
  board.onWrong = (i) => wrongFx(board, i);
  wireInputSounds(board);
}

// ───────────────────────── 공통 게임 화면 ─────────────────────────

interface Play {
  board: Board;
  ended: boolean;
  elapsed(): number;
  end(): void;
  overlay(html: string): HTMLElement;
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
        <button class="ghost" id="quit">나가기</button>
      </div>
      <div class="board-wrap"><div class="board" id="board"></div><div class="countdown" id="cd"><b>3</b></div></div>
      <div class="pad" id="pad"></div>
    </main>
    ${o.chat ? '<aside class="chat-slot" id="chat-slot"></aside>' : ''}
  </div>`);
  const board = new Board($('#board')!, $('#pad')!, puzzle, solution, o.shared);
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
    },
    overlay(html) {
      $('.overlay')?.remove();
      const d = document.createElement('div');
      d.className = 'overlay';
      d.innerHTML = `<div class="dialog">${html}</div>`;
      $('.play')!.appendChild(d);
      return d;
    },
  };
  board.onChange = (f, m) => o.onProgress?.(f, m);
  board.onSolved = () => {
    const ms = h.elapsed();
    h.end();
    o.onSolved?.(ms);
  };
  $('#quit')!.onclick = () => o.onQuit();

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
    if (!started || h.ended) return;
    timer.textContent = fmt(h.elapsed());
    $('#miss')!.textContent = `실수 ${board.mistakes}`;
    o.tick?.(dt);
  };
  raf = requestAnimationFrame(loop);
  cleanup = () => {
    clearInterval(cdT);
    cancelAnimationFrame(raf);
    board.dispose();
  };
  return h;
}

const bar = (pct: number, id = '') => `<div class="bar"${id ? ` id="${id}"` : ''}><i style="width:${Math.round(pct * 100)}%"></i></div>`;

function celebrate(won: boolean): void {
  if (won) {
    fx.confetti();
    sfx.win();
  } else sfx.lose();
}

// ───────────────────────── 싱글 (AI 대결) ─────────────────────────

function singleSetup(): void {
  show(`
  <div class="screen setup">
    <button class="ghost back" id="back">← 메뉴</button>
    <h2>상대할 AI 를 고르세요</h2>
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
  $('#back')!.onclick = () => menu();
  app.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) => (b.onclick = () => startSingle(b.dataset.level as Level)));
}

function startSingle(level: Level): void {
  const { puzzle, solution } = generate(level);
  const prof = AI_PROFILES[level];
  const ai = new AiSolver(puzzle, solution, prof);
  const total = ai.total;
  const me: PlayerInfo = { id: 0, name: myName };
  const h = play(puzzle, solution, {
    level,
    color: colorOf(0),
    chat: false,
    side: `
      <div class="op-card ai"><img class="bob" src="${prof.avatar}" alt="" /><div><b>${prof.name}</b><small id="ai-stat">0 / ${total}</small></div></div>
      ${bar(0, 'ai-bar')}
      <div class="mini" id="ai-mini">${puzzle.map((v) => `<i class="${v ? 'g' : ''}"></i>`).join('')}</div>
      <div class="op-card"><span>${avatar(me)}</span><div><b>${esc(myName)}</b><small id="me-stat">0 / ${total}</small></div></div>
      ${bar(0, 'me-bar')}`,
    onProgress(f) {
      $('#me-stat')!.textContent = `${f} / ${total}`;
      $<HTMLElement>('#me-bar i')!.style.width = `${(f / total) * 100}%`;
    },
    onSolved(ms) {
      result(true, ms);
    },
    tick(dt) {
      const before = ai.filled + ai.mistakes;
      ai.update(dt);
      if (ai.filled + ai.mistakes === before) return;
      $('#ai-stat')!.textContent = `${ai.filled} / ${total}${ai.mistakes ? ` · 실수 ${ai.mistakes}` : ''}`;
      $<HTMLElement>('#ai-bar i')!.style.width = `${(ai.filled / total) * 100}%`;
      const mini = $('#ai-mini')!.children;
      ai.grid.forEach((v, i) => {
        if (!puzzle[i]) mini[i].className = i === ai.wrongCell ? 'x' : v ? 'f' : '';
      });
      if (ai.lastCell >= 0) mini[ai.lastCell].classList.add('pop');
      if (ai.done) {
        const ms = h.elapsed();
        h.end();
        result(false, ms);
      }
    },
    onQuit: () => menu(),
  });
  wirePersonalFx(h.board, colorOf(0));

  function result(won: boolean, ms: number): void {
    celebrate(won);
    const d = h.overlay(`
      <img class="result-img" src="${won ? 'assets/trophy.svg' : prof.avatar}" alt="" />
      <h2>${won ? '승리!' : `${prof.name} 승리`}</h2>
      <p>${won ? `${fmt(ms)} 만에 풀었어요 · 실수 ${h.board.mistakes} · 힌트 ${HINTS - h.board.hintsLeft}` : `${prof.name} 가 ${fmt(ms)} 에 먼저 풀었어요 (나: ${h.board.filled} / ${total})`}</p>
      <div class="row"><button id="again">한 판 더</button><button class="ghost" id="other">다른 AI</button><button class="ghost" id="home">메뉴</button></div>`);
    d.querySelector<HTMLButtonElement>('#again')!.onclick = () => startSingle(level);
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
  /** 레이스형 진행률 */
  progress: Map<number, { filled: number; mistakes: number }>;
  /** 점령형 점수·가져간 칸 수 (claim/miss 메시지로 모두가 같은 값을 센다) */
  scores: Map<number, number>;
  cells: Map<number, number>;
  /** 점령형 심판 — 방장만 */
  judge: ClaimJudge | null;
  play: Play | null;
  result: { winner: number; ms: number } | null;
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
    // 혼자 남으면 대결이 성립하지 않으니 거기서 끝낸다
    if (r.phase === 'play' && !r.result && r.players.length < 2) declareWinner(0, r.play?.elapsed() ?? 0);
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
        if (r.phase !== 'play' || r.rule !== 'race') return;
        const out: Msg = { t: 'progress', id: from, filled: Number(m.filled) | 0, mistakes: Number(m.mistakes) | 0 };
        n.broadcast(out);
        applyProgress(out);
        return;
      }
      case 'finish':
        if (r.phase === 'play' && r.rule === 'race' && !r.result) declareWinner(from, Number(m.ms) || 0);
        return;
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

function declareWinner(winner: number, ms: number): void {
  const m: Msg = { t: 'result', winner, ms };
  net?.broadcast(m);
  onResult(m);
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
  if (r.judge.full) declareWinner(r.judge.winner(r.players.map((p) => p.id)), r.play?.elapsed() ?? 0);
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
      case 'claim':
      case 'miss':
        return applyClaimEvent(m);
      case 'chat':
        return addChat(m);
      case 'result':
        return onResult(m);
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

/** 로비면 참가자·규칙·난이도, 게임 중이면 점수판·진행 막대를 다시 그린다 */
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
  const racers = $('#racers');
  if (!racers) return;
  if (r.rule === 'claim') {
    racers.innerHTML = [...r.players]
      .sort((a, b) => (r.scores.get(b.id) ?? 0) - (r.scores.get(a.id) ?? 0))
      .map(
        (p) => `<div class="racer score ${p.id === r.myId ? 'me' : ''}" style="--own:${colorOf(p.id)}">
          ${avatar(p)}<div><b>${esc(p.name)}</b><small>${r.cells.get(p.id) ?? 0}칸</small></div><strong>${r.scores.get(p.id) ?? 0}</strong>
        </div>`,
      )
      .join('');
    const left = r.play ? r.play.board.grid.filter((v) => !v).length : 0;
    $('#left')!.textContent = `남은 칸 ${left}`;
  } else {
    racers.innerHTML = [...r.players]
      .sort((a, b) => (r.progress.get(b.id)?.filled ?? 0) - (r.progress.get(a.id)?.filled ?? 0))
      .map((p) => {
        const g = r.progress.get(p.id) ?? { filled: 0, mistakes: 0 };
        return `<div class="racer ${p.id === r.myId ? 'me' : ''}">
          <div class="op-card">${avatar(p)}<div><b>${esc(p.name)}</b><small>${g.filled} / ${r.total}${g.mistakes ? ` · 실수 ${g.mistakes}` : ''}</small></div></div>
          ${bar(r.total ? g.filled / r.total : 0)}
        </div>`;
      })
      .join('');
  }
}

function applyProgress(m: { id: number; filled: number; mistakes: number }): void {
  if (!room || room.phase !== 'play') return;
  room.progress.set(m.id, { filled: m.filled, mistakes: m.mistakes });
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
  r.progress = new Map(r.players.map((p) => [p.id, { filled: 0, mistakes: 0 }]));
  r.scores = new Map(r.players.map((p) => [p.id, 0]));
  r.cells = new Map(r.players.map((p) => [p.id, 0]));
  const claim = rule === 'claim';
  r.play = play(puzzle, solution, {
    level,
    color: colorOf(r.myId),
    tag: RULES[rule].label,
    chat: true,
    shared: claim,
    side: claim
      ? `<h3>점수판</h3><div id="racers"></div><p class="hint"><span id="left"></span> · 맞히면 +1, 틀리면 -1 · 2초 정지</p>`
      : `<h3>진행 상황</h3><div id="racers"></div><p class="hint">같은 퍼즐을 가장 먼저 푸는 사람이 승리!</p>`,
    onProgress(filled, mistakes) {
      if (claim) return;
      const m: Msg = { t: 'progress', id: r.myId, filled, mistakes };
      if (r.host) net?.broadcast(m);
      else net?.send(m);
      applyProgress(m);
    },
    onSolved(ms) {
      if (claim) return;
      if (r.host) {
        if (!r.result) declareWinner(0, ms);
      } else net?.send({ t: 'finish', id: r.myId, ms });
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
  } else wirePersonalFx(board, colorOf(r.myId));
  $('#chat-slot')!.appendChild(r.chat);
  addChat(`${LEVELS[level].label} · ${RULES[rule].label} 시작!`);
  refreshPlayers();
}

function onResult(m: { winner: number; ms: number }): void {
  if (!room?.play || room.result) return;
  const r = room;
  const pl = room.play;
  r.result = m;
  pl.end();
  const w = r.players.find((p) => p.id === m.winner);
  const won = m.winner === r.myId;
  const claim = r.rule === 'claim';
  const title = m.winner === -1 ? '무승부!' : won ? '승리!' : `${esc(w?.name ?? '???')} 승리`;
  addChat(m.winner === -1 ? '🤝 공동 1위!' : `🏆 ${w?.name ?? '???'} 님 승리! (${fmt(m.ms)})`);
  celebrate(won || m.winner === -1);
  const ranking = claim
    ? `<ol class="ranking">${[...r.players]
        .sort((a, b) => (r.scores.get(b.id) ?? 0) - (r.scores.get(a.id) ?? 0))
        .map((p) => `<li style="--own:${colorOf(p.id)}">${avatar(p)}<span>${esc(p.name)}</span><b>${r.scores.get(p.id) ?? 0}점</b></li>`)
        .join('')}</ol>`
    : `<p>${fmt(m.ms)} 만에 완성 · 내 진행 ${pl.board.filled} / ${r.total}</p>`;
  const d = pl.overlay(`
    <img class="result-img" src="assets/trophy.svg" alt="" />
    <h2>${title}</h2>
    ${ranking}
    <div class="row">${r.host ? '<button id="again">로비로</button>' : '<span class="hint">방장이 다음 판을 준비 중…</span>'}<button class="ghost" id="home">나가기</button></div>`);
  d.querySelector<HTMLButtonElement>('#home')!.onclick = () => menu();
  const again = d.querySelector<HTMLButtonElement>('#again');
  if (again)
    again.onclick = () => {
      net?.broadcast({ t: 'back' });
      lobby();
    };
}

menu();
