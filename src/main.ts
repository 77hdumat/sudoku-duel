import './style.css';
import { AI_PROFILES, AiSolver } from './game/Ai';
import { fromStr, generate, LEVELS, solve, toStr, type Grid, type Level } from './game/Sudoku';
import { Net, type NetError } from './net/Net';
import { CHAT_MAX, cleanText, NAME_MAX, type Msg, type PlayerInfo } from './net/Protocol';
import { Board } from './ui/Board';

const app = document.getElementById('app')!;
const LEVEL_KEYS = Object.keys(LEVELS) as Level[];
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

let myName = store.get('name', '플레이어');
setTheme(store.get('theme', 'paper'));

function setTheme(id: string): void {
  document.documentElement.dataset.theme = id;
  store.set('theme', id);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => app.querySelector(sel) as T | null;
const AVATAR_COLORS = ['#e07a5f', '#3d85c6', '#81b29a', '#f2cc8f', '#9b5de5', '#f15bb5', '#00bbf9', '#8d6e63'];
const avatar = (p: PlayerInfo) =>
  `<span class="avatar" style="background:${AVATAR_COLORS[p.id % AVATAR_COLORS.length]}">${esc([...p.name][0] ?? '?')}</span>`;

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
  <div class="screen menu">
    <img class="logo" src="assets/logo.svg" alt="" />
    <h1>스도쿠 대결</h1>
    <p class="sub">AI 와 겨루거나, 친구와 같은 퍼즐을 누가 먼저 푸는지 겨뤄 보세요.</p>
    ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
    <label class="field">닉네임 <input id="name" maxlength="${NAME_MAX}" value="${esc(myName)}" /></label>
    <div class="menu-grid">
      <button class="big" id="single"><img src="assets/bot-medium.svg" alt="" /><b>싱글</b><span>AI 와 대결</span></button>
      <button class="big" id="host"><img src="assets/icon-multi.svg" alt="" /><b>방 만들기</b><span>최대 8명 멀티</span></button>
    </div>
    <form class="join" id="join">
      <input id="code" placeholder="방 코드 5자리" maxlength="5" autocomplete="off" />
      <button>참가</button>
    </form>
    <div class="themes">${THEMES.map((t) => `<button data-theme-id="${t.id}" class="swatch ${t.id}">${t.label}</button>`).join('')}</div>
  </div>`);
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
  side: string;
  chat: boolean;
  onProgress(filled: number, mistakes: number): void;
  onSolved(ms: number): void;
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
        <span class="chip">${LEVELS[o.level].label}</span>
        <span class="timer" id="timer">0:00</span>
        <span class="chip" id="miss">실수 0</span>
        <button class="ghost" id="quit">나가기</button>
      </div>
      <div class="board-wrap"><div class="board" id="board"></div><div class="countdown" id="cd">3</div></div>
      <div class="pad" id="pad"></div>
    </main>
    ${o.chat ? '<aside class="chat-slot" id="chat-slot"></aside>' : ''}
  </div>`);
  const board = new Board($('#board')!, $('#pad')!, puzzle, solution);
  const timer = $('#timer')!;
  let t0 = 0;
  let started = false;
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
  board.onChange = (f, m) => {
    $('#miss')!.textContent = `실수 ${m}`;
    o.onProgress(f, m);
  };
  board.onSolved = () => {
    const ms = h.elapsed();
    h.end();
    o.onSolved(ms);
  };
  $('#quit')!.onclick = () => o.onQuit();

  const cd = $('#cd')!;
  let n = 3;
  const cdT = setInterval(() => {
    n--;
    if (n > 0) return void (cd.textContent = String(n));
    clearInterval(cdT);
    cd.remove();
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

const bar = (pct: number) => `<div class="bar"><i style="width:${Math.round(pct * 100)}%"></i></div>`;

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
    chat: false,
    side: `
      <div class="op-card ai"><img src="${prof.avatar}" alt="" /><div><b>${prof.name}</b><small id="ai-stat">0 / ${total}</small></div></div>
      ${bar(0).replace('class="bar"', 'class="bar" id="ai-bar"')}
      <div class="mini" id="ai-mini">${puzzle.map((v) => `<i class="${v ? 'g' : ''}"></i>`).join('')}</div>
      <div class="op-card"><span>${avatar(me)}</span><div><b>${esc(myName)}</b><small id="me-stat">0 / ${total}</small></div></div>
      ${bar(0).replace('class="bar"', 'class="bar" id="me-bar"')}`,
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
      if (ai.done) {
        const ms = h.elapsed();
        h.end();
        result(false, ms);
      }
    },
    onQuit: () => menu(),
  });

  function result(won: boolean, ms: number): void {
    const d = h.overlay(`
      <img class="result-img" src="${won ? 'assets/trophy.svg' : prof.avatar}" alt="" />
      <h2>${won ? '승리!' : `${prof.name} 승리`}</h2>
      <p>${won ? `${fmt(ms)} 만에 풀었어요 · 실수 ${h.board.mistakes}` : `${prof.name} 가 ${fmt(ms)} 에 먼저 풀었어요 (나: ${h.board.filled} / ${total})`}</p>
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
  phase: 'lobby' | 'play';
  total: number;
  progress: Map<number, { filled: number; mistakes: number }>;
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
  return { host, myId: 0, players: [], level: 'medium', phase: 'lobby', total: 0, progress: new Map(), play: null, result: null, chat };
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
    who.style.color = AVATAR_COLORS[m.id % AVATAR_COLORS.length];
    line.append(who, document.createTextNode(' ' + m.text));
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
        if (r.phase !== 'play') return;
        const out: Msg = { t: 'progress', id: from, filled: Number(m.filled) | 0, mistakes: Number(m.mistakes) | 0 };
        n.broadcast(out);
        applyProgress(out);
        return;
      }
      case 'finish':
        if (r.phase === 'play' && !r.result) declareWinner(from, Number(m.ms) || 0);
        return;
    }
  };
  void n.host(7);
}

function broadcastLobby(): void {
  if (!room || !net) return;
  net.broadcast({ t: 'lobby', players: room.players, level: room.level });
  refreshPlayers();
}

function declareWinner(winner: number, ms: number): void {
  const m: Msg = { t: 'result', winner, ms };
  net?.broadcast(m);
  onResult(m);
}

function hostStart(): void {
  if (!room || !net) return;
  const { puzzle } = generate(room.level);
  const m: Msg = { t: 'start', puzzle: toStr(puzzle), level: room.level };
  net.broadcast(m);
  startMulti(m.puzzle, m.level);
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
        return menu(m.why === 'playing' ? '이미 게임이 진행 중인 방이에요.' : '방이 가득 찼어요.');
      case 'lobby': {
        const first = !r.players.length;
        r.players = m.players;
        r.level = m.level;
        if (first) {
          addChat(`${code} 방에 들어왔어요.`);
          lobby();
        } else refreshPlayers();
        return;
      }
      case 'start':
        return startMulti(m.puzzle, m.level);
      case 'progress':
        return applyProgress(m);
      case 'chat':
        return addChat(m);
      case 'result':
        return onResult(m);
      case 'back':
        r.phase = 'lobby';
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
  show(`
  <div class="screen lobby">
    <section class="lobby-main">
      <button class="ghost back" id="leave">← 나가기</button>
      <div class="code-box"><small>방 코드</small><b id="code">${esc(net.code)}</b><button class="ghost" id="copy">복사</button></div>
      <h3>참가자 <span id="count"></span></h3>
      <ul class="players" id="players"></ul>
      <h3>난이도</h3>
      <div class="levels" id="levels">${LEVEL_KEYS.map((l) => `<button data-level="${l}" ${r.host ? '' : 'disabled'}>${LEVELS[l].label}</button>`).join('')}</div>
      ${r.host ? '<button class="primary" id="start">시작하기</button><p class="hint" id="start-hint"></p>' : '<p class="hint">방장이 시작하면 같은 퍼즐이 동시에 열려요. 먼저 푸는 사람이 승리!</p>'}
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
    $('#start')!.onclick = hostStart;
  }
  refreshPlayers();
}

/** 로비면 참가자 목록·난이도, 게임 중이면 진행 막대를 다시 그린다 */
function refreshPlayers(): void {
  if (!room) return;
  const r = room;
  const list = $('#players');
  if (list) {
    list.innerHTML = r.players
      .map((p) => `<li>${avatar(p)}<span>${esc(p.name)}</span>${p.id === 0 ? '<em>방장</em>' : ''}${p.id === r.myId ? '<em class="me">나</em>' : ''}</li>`)
      .join('');
    $('#count')!.textContent = `${r.players.length} / 8`;
    app.querySelectorAll<HTMLButtonElement>('#levels [data-level]').forEach((b) => b.classList.toggle('on', b.dataset.level === r.level));
    const start = $<HTMLButtonElement>('#start');
    if (start) {
      start.disabled = r.players.length < 2;
      $('#start-hint')!.textContent = r.players.length < 2 ? '한 명 이상 들어와야 시작할 수 있어요.' : '';
    }
  }
  const racers = $('#racers');
  if (racers) {
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

function startMulti(puzzleStr: string, level: Level): void {
  if (!room || !net) return;
  const r = room;
  const puzzle = fromStr(puzzleStr);
  const solution = solve(puzzle);
  if (!solution) return menu('받은 퍼즐이 올바르지 않아요.');
  r.phase = 'play';
  r.level = level;
  r.result = null;
  r.total = puzzle.filter((v) => !v).length;
  r.progress = new Map(r.players.map((p) => [p.id, { filled: 0, mistakes: 0 }]));
  r.play = play(puzzle, solution, {
    level,
    chat: true,
    side: `<h3>진행 상황</h3><div id="racers"></div><p class="hint">같은 퍼즐을 가장 먼저 푸는 사람이 승리!</p>`,
    onProgress(filled, mistakes) {
      const m: Msg = { t: 'progress', id: r.myId, filled, mistakes };
      if (r.host) net?.broadcast(m);
      else net?.send(m);
      applyProgress(m);
    },
    onSolved(ms) {
      if (r.host) {
        if (!r.result) declareWinner(0, ms);
      } else net?.send({ t: 'finish', id: r.myId, ms });
    },
    onQuit: () => menu(),
  });
  $('#chat-slot')!.appendChild(r.chat);
  addChat(`${LEVELS[level].label} 퍼즐 시작!`);
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
  addChat(`🏆 ${w?.name ?? '???'} 님이 ${fmt(m.ms)} 만에 먼저 풀었어요!`);
  const d = pl.overlay(`
    <img class="result-img" src="assets/trophy.svg" alt="" />
    <h2>${won ? '승리!' : `${esc(w?.name ?? '???')} 승리`}</h2>
    <p>${fmt(m.ms)} 만에 완성 · 내 진행 ${pl.board.filled} / ${r.total}</p>
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
