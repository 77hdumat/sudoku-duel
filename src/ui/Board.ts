import { bitCount, candidates, geo, HINTS, pruneNotes, type Geo, type Grid } from '../game/Sudoku';

/**
 * 플레이어 보드: 칸 선택·숫자/메모 입력·힌트·키보드·숫자패드.
 *
 * 개인판(싱글·레이스형): 정답 칸은 잠기고, 틀린 숫자는 빨갛게 남아 실수로 센다.
 * 공유판(점령형, shared): 입력은 onPlace 로 방장에게 보내기만 하고, 판정 결과를 claim()/miss() 로 받는다.
 * 메모는 어느 쪽이든 각자 자기 화면에만 남는다.
 */
export class Board {
  readonly grid: Grid;
  readonly given: boolean[];
  readonly notes: number[];
  /** 점령형: 칸을 가져간 플레이어 id (-1 = 없음) */
  readonly owner: number[];
  /** 판 크기 (9×9 / 6×6) */
  private readonly G: Geo;
  readonly hinted = new Set<number>();
  sel = -1;
  noteMode = false;
  mistakes = 0;
  locked = true;
  hintsLeft = HINTS;
  private frozenUntil = 0;

  onChange: ((filled: number, mistakes: number) => void) | null = null;
  onSolved: (() => void) | null = null;
  /** 개인판: 맞힌 순간 (units = 이번에 완성된 행·열·박스) */
  onCorrect: ((i: number, hint: boolean, units: number[][]) => void) | null = null;
  onWrong: ((i: number) => void) | null = null;
  /** 공유판: 방장에게 보낼 입력 */
  onPlace: ((i: number, v: number, hint: boolean) => void) | null = null;
  onInput: ((kind: 'select' | 'note' | 'blocked' | 'auto') => void) | null = null;
  /** 다시 그릴 때마다 (관전자에게 판·메모를 보내는 용도) */
  onRender: (() => void) | null = null;
  /** 풀이 버튼 (변성대왕 싱글) */
  onExplain: (() => void) | null = null;
  /** 채점 숨김: 판을 다 채워 채점했는데 틀린 칸이 있을 때 (틀린 칸 수) */
  onChecked: ((wrong: number) => void) | null = null;
  /** 채점 숨김에서 맞다고 드러난 칸 (채점·힌트·풀이로) — 더는 못 고친다 */
  private readonly confirmed = new Set<number>();
  /** 채점 숨김에서 채점 결과 틀린 칸 (고치기 전까지 빨갛게) */
  private readonly shownWrong = new Set<number>();

  private cells: HTMLElement[] = [];
  /** 고른 칸 네 모서리에 붙는 꺾쇠 커서 (칸 사이를 미끄러져 다닌다) */
  private cursor: HTMLElement;
  private digitBtns: HTMLButtonElement[] = [];
  private noteBtn!: HTMLButtonElement;
  private hintBtn!: HTMLButtonElement;
  private undoBtn!: HTMLButtonElement;
  /** 되돌리기: 바꾸기 전 숫자·메모. 맞힌 칸은 되돌리지 않는다 */
  private history: { grid: Grid; notes: number[] }[] = [];
  private ownerColor = new Map<number, string>();
  private pop = -1;
  private flash = -1;
  private readonly onKey = (e: KeyboardEvent) => this.key(e);

  constructor(
    private readonly boardEl: HTMLElement,
    padEl: HTMLElement,
    puzzle: Grid,
    private readonly solution: Grid,
    private readonly shared = false,
    /** 지옥 이상(6×6 은 고급): 빈칸마다 지금 가능한 후보를 메모로 한 번에 채우는 버튼 */
    private readonly autoNotes = false,
    hints = HINTS,
    /** 풀이 버튼 — 변성대왕 싱글에서만, 무제한 */
    explain = false,
    /**
     * 채점 숨김 (변성대왕): 넣은 숫자가 맞았는지 바로 알려 주지 않는다 — 두 후보 중 하나를 넣어 보고 빨개지면 바꾸는 '찍고 확인' 을 막는다.
     * 판을 다 채우면 채점해서 틀린 칸만큼 실수로 센다
     */
    private readonly blind = false,
  ) {
    this.hintsLeft = hints;
    this.grid = puzzle.slice();
    this.given = puzzle.map(Boolean);
    this.G = geo(puzzle.length);
    const n = this.G.n;
    this.notes = new Array(this.G.cells).fill(0);
    this.owner = new Array(this.G.cells).fill(-1);
    boardEl.classList.toggle('six', n === 6);
    padEl.classList.toggle('six', n === 6);

    for (let i = 0; i < this.G.cells; i++) {
      const d = document.createElement('div');
      d.className = 'cell';
      d.dataset.r = String(Math.floor(i / n));
      d.dataset.c = String(i % n);
      d.addEventListener('pointerdown', () => {
        this.select(i);
        this.onInput?.('select');
      });
      boardEl.appendChild(d);
      this.cells.push(d);
    }

    this.cursor = document.createElement('div');
    this.cursor.className = 'cursor';
    this.cursor.innerHTML = '<i></i><i></i><i></i><i></i><b></b>';
    boardEl.appendChild(this.cursor);

    for (let v = 1; v <= n; v++) {
      const b = document.createElement('button');
      b.className = 'digit';
      b.innerHTML = `<span>${v}</span><small></small>`;
      b.addEventListener('click', () => this.input(v));
      padEl.appendChild(b);
      this.digitBtns.push(b);
    }
    const tools = document.createElement('div');
    tools.className = 'tools';
    tools.innerHTML =
      `<button class="tool" data-k="note">✎ 메모 <kbd>N</kbd></button>` +
      `<button class="tool" data-k="undo">↶ 되돌리기 <kbd>Z</kbd></button>` +
      (shared ? '' : `<button class="tool" data-k="erase">⌫ 지우기</button>`) +
      `<button class="tool hint" data-k="hint">💡 힌트 <b></b> <kbd>H</kbd></button>` +
      (autoNotes ? `<button class="tool" data-k="auto">✨ 자동 메모 <kbd>A</kbd></button>` : '') +
      (explain ? `<button class="tool explain-btn" data-k="explain">🧠 풀이 <kbd>E</kbd></button>` : '');
    padEl.appendChild(tools);
    this.noteBtn = tools.querySelector('[data-k="note"]')!;
    this.noteBtn.addEventListener('click', () => this.toggleNotes());
    tools.querySelector('[data-k="erase"]')?.addEventListener('click', () => this.input(0));
    this.undoBtn = tools.querySelector('[data-k="undo"]')!;
    this.undoBtn.addEventListener('click', () => this.undo());
    this.hintBtn = tools.querySelector('[data-k="hint"]')!;
    this.hintBtn.addEventListener('click', () => this.useHint());
    tools.querySelector('[data-k="auto"]')?.addEventListener('click', () => this.fillNotes());
    tools.querySelector('[data-k="explain"]')?.addEventListener('click', () => !this.locked && this.onExplain?.());

    document.addEventListener('keydown', this.onKey);
    this.render();
  }

  /** 커서 색 (내 플레이어 색) */
  setColor(color: string): void {
    this.boardEl.style.setProperty('--me', color);
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKey);
  }

  get filled(): number {
    let n = 0;
    for (let i = 0; i < this.G.cells; i++) if (!this.given[i] && (this.blind ? this.grid[i] : this.done(i))) n++;
    return n;
  }

  get solved(): boolean {
    return this.grid.every((v, i) => v === this.solution[i]);
  }

  get frozen(): boolean {
    return performance.now() < this.frozenUntil;
  }

  done(i: number): boolean {
    return this.grid[i] === this.solution[i];
  }

  /** 더는 못 고치는 칸: 주어진 칸, 그리고 맞힌 칸 (채점 숨김에선 맞다고 드러난 칸만) */
  private fixed(i: number): boolean {
    return this.given[i] || (this.blind ? this.confirmed.has(i) : this.done(i));
  }

  /** 화면상 칸 중심 (이펙트 위치) */
  cellCenter(i: number): { x: number; y: number } {
    const r = this.cells[i].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  select(i: number): void {
    this.sel = i;
    this.render();
  }

  toggleNotes(): void {
    this.noteMode = !this.noteMode;
    this.onInput?.('note');
    this.render();
  }

  input(v: number): void {
    const i = this.sel;
    if (this.locked || i < 0 || this.fixed(i)) return;
    if (this.frozen) return void this.onInput?.('blocked');
    if (this.noteMode && v) {
      if (!this.grid[i]) {
        this.save();
        this.notes[i] ^= 1 << (v - 1);
      }
      this.onInput?.('note');
      this.render();
      return;
    }
    if (this.shared) {
      if (v) this.onPlace?.(i, v, false);
      return;
    }
    if (this.blind) return this.place(i, v);
    if (v && v === this.solution[i]) return this.commit(i, false);
    if (this.grid[i] === v) return;
    this.save();
    // 메모는 지우지 않는다 — 틀린 숫자를 지우면 원래 메모가 다시 보인다
    this.grid[i] = v;
    if (v) {
      this.mistakes++;
      this.onWrong?.(i);
    }
    this.render();
    this.onChange?.(this.filled, this.mistakes);
  }

  /** 채점 숨김: 숫자를 넣기만 한다 (맞았는지 모름). 다 채우면 채점 */
  private place(i: number, v: number): void {
    if (this.grid[i] === v) return;
    this.save();
    this.grid[i] = v;
    this.shownWrong.delete(i);
    // 넣은 숫자는 같은 줄·박스 메모에서 뺀다 (정답과 상관없이 — 정답을 흘리지 않게)
    if (v) for (const p of this.G.peers[i]) if (!this.grid[p]) this.notes[p] &= ~(1 << (v - 1));
    this.onInput?.('select');
    this.render();
    this.onChange?.(this.filled, this.mistakes);
    if (this.grid.every(Boolean)) this.check();
  }

  /** 채점 숨김: 다 채웠을 때 채점. 맞으면 끝, 틀린 칸은 빨갛게 드러내고 그만큼 실수 */
  private check(): void {
    const wrong = this.grid.flatMap((v, i) => (v !== this.solution[i] ? [i] : []));
    this.grid.forEach((_, i) => !wrong.includes(i) && this.confirmed.add(i));
    if (!wrong.length) {
      this.locked = true;
      this.render();
      this.onSolved?.();
      return;
    }
    // 이미 빨갛게 드러난 칸은 다시 세지 않는다 (한 칸씩 고치며 다시 채점될 때 같은 칸에 실수가 또 붙지 않게)
    const fresh = wrong.filter((i) => !this.shownWrong.has(i));
    this.mistakes += fresh.length;
    for (const i of wrong) this.shownWrong.add(i);
    if (!fresh.length) return void this.render();
    this.render();
    this.onChecked?.(fresh.length);
    this.onWrong?.(wrong[0]);
    this.onChange?.(this.filled, this.mistakes);
  }

  /** 관전자용 판 상태: grid 칸 수만큼 글자(0 = 빈칸), notes 칸마다 36진수 2 글자 */
  snapshot(): { grid: string; notes: string } {
    return { grid: this.grid.join(''), notes: this.notes.map((n) => n.toString(36).padStart(2, '0')).join('') };
  }

  /** 고른 칸(없거나 이미 맞은 칸이면 가장 쉬운 빈칸)의 정답을 연다 */
  useHint(): void {
    if (this.locked || this.hintsLeft <= 0) return void this.onInput?.('blocked');
    let i = this.sel;
    if (i < 0 || this.fixed(i)) {
      const known = this.grid.map((v, k) => (this.done(k) ? v : 0));
      let best = 10;
      i = -1;
      for (let k = 0; k < this.G.cells; k++) {
        if (known[k]) continue;
        const n = bitCount(candidates(known, k));
        if (n < best) {
          best = n;
          i = k;
        }
      }
    }
    if (i < 0) return;
    this.hintsLeft--;
    // 채점 숨김: 틀린 숫자 위에 힌트가 정답을 쓰면 틀렸다는 걸 알려 준 셈 — 조용히 바뀌지 않게 실수로 센다
    if (this.blind && this.grid[i] && this.grid[i] !== this.solution[i] && !this.shownWrong.has(i)) {
      this.mistakes++;
      this.onWrong?.(i);
    }
    this.sel = i;
    if (this.shared) {
      this.render();
      this.onPlace?.(i, this.solution[i], true);
    } else this.commit(i, true);
  }

  /**
   * 빈칸마다 지금 놓을 수 있는 후보를 전부 메모로 (기존 메모는 덮어쓴다).
   * 후보는 맞게 채워진 숫자만 보고 계산해서, 틀린 숫자가 남아 있어도 후보가 틀어지지 않는다.
   */
  fillNotes(): void {
    if (this.locked || !this.autoNotes) return;
    // 채점 숨김에선 넣은 숫자를 다 기준으로 (맞은 것만 고르면 정답을 흘린다)
    const known = this.blind ? this.grid.slice() : this.grid.map((v, k) => (this.done(k) ? v : 0));
    this.save();
    for (let i = 0; i < this.G.cells; i++) if (!this.grid[i]) this.notes[i] = candidates(known, i);
    this.onInput?.('auto');
    this.render();
  }

  private save(): void {
    this.history.push({ grid: this.grid.slice(), notes: this.notes.slice() });
    if (this.history.length > 200) this.history.shift();
  }

  /** 마지막 메모·숫자 입력을 되돌린다 (그 사이 맞힌 칸은 그대로, 실수 수도 그대로) */
  undo(): void {
    if (this.locked || this.frozen) return void this.onInput?.('blocked');
    const before = this.grid.join() + this.notes.join();
    // 그 사이 맞힌 칸 때문에 되돌려도 달라질 게 없는 단계는 건너뛴다
    while (this.history.length && this.grid.join() + this.notes.join() === before) {
      const h = this.history.pop()!;
      for (let i = 0; i < this.G.cells; i++) {
        if (this.fixed(i)) continue;
        this.grid[i] = h.grid[i];
        this.notes[i] = h.notes[i];
      }
      // 옛 메모라도 지금 놓인 숫자와 겹치는 건 되살리지 않는다 (채점 숨김에선 정답을 흘리니 하지 않는다)
      if (!this.blind) pruneNotes(this.grid, this.solution, this.notes);
    }
    if (this.grid.join() + this.notes.join() === before) return void this.onInput?.('blocked');
    this.onInput?.('note');
    this.render();
    this.onChange?.(this.filled, this.mistakes);
  }

  /** 정답과 다른 숫자가 들어 있는 칸 (풀이 전 정리용) */
  wrongCells(): number[] {
    return this.grid.flatMap((v, i) => (v && !this.given[i] && v !== this.solution[i] ? [i] : []));
  }

  /** 정리하면 새로 실수로 셀 칸 수 — 채점 숨김에서 아직 빨갛게 드러나지 않은 틀린 칸 (그 밖엔 이미 셌다) */
  get unseenWrong(): number {
    return this.blind ? this.wrongCells().filter((i) => !this.shownWrong.has(i)).length : 0;
  }

  /**
   * 풀이 전 정리: 틀린 칸을 비운다 (되돌리기 가능). 채점 숨김에선 틀렸다는 걸 알려 준 셈이라 그만큼 실수로 센다
   * (채점 숨김이 아니면 넣을 때 이미 실수로 셌다)
   */
  clearWrong(): void {
    const wrong = this.wrongCells();
    if (!wrong.length) return;
    this.mistakes += this.unseenWrong;
    this.save();
    for (const i of wrong) {
      this.grid[i] = 0;
      this.shownWrong.delete(i);
    }
    this.render();
    this.onChange?.(this.filled, this.mistakes);
  }

  /** 맞게 채운 숫자만 남긴 판 (풀이·힌트 계산용) */
  known(): Grid {
    return this.grid.map((v, k) => (this.done(k) ? v : 0));
  }

  /** 풀이 한 단계 반영: 지운 후보는 메모에서 빼고, 확정 칸은 힌트처럼 채운다 */
  applyExplain(elim: { i: number; d: number }[], place?: { i: number; v: number }): void {
    // 되돌리기로 풀이가 지운 후보·넣은 숫자의 메모가 되살아나지 않게 이 시점을 남긴다
    this.save();
    for (const { i, d } of elim) if (!this.grid[i]) this.notes[i] &= ~(1 << (d - 1));
    if (place && !this.fixed(place.i)) {
      this.sel = place.i;
      this.commit(place.i, true);
    } else this.render();
  }

  /** 개인판에서 정답 확정 */
  private commit(i: number, hint: boolean): void {
    const v = this.solution[i];
    this.grid[i] = v;
    if (hint) this.hinted.add(i);
    this.confirmed.add(i);
    this.shownWrong.delete(i);
    if (this.blind) {
      for (const p of this.G.peers[i]) if (!this.grid[p]) this.notes[p] &= ~(1 << (v - 1));
    } else pruneNotes(this.grid, this.solution, this.notes);
    this.pop = i;
    // 채점 숨김에선 줄이 다 맞았다는 연출도 정답을 흘린다
    const units = this.blind ? [] : this.unitsOf(i).filter((u) => u.every((k) => this.done(k)));
    this.render();
    this.onCorrect?.(i, hint, units);
    this.onChange?.(this.filled, this.mistakes);
    if (this.solved) {
      this.locked = true;
      this.onSolved?.();
    } else if (this.blind && this.grid.every(Boolean)) this.check();
  }

  /** 공유판: 방장이 확정한 칸. 이번에 완성된 행·열·박스를 돌려준다 */
  claim(i: number, owner: number, color: string, hint: boolean): number[][] {
    const v = this.solution[i];
    this.grid[i] = v;
    this.owner[i] = owner;
    this.ownerColor.set(owner, color);
    if (hint) this.hinted.add(i);
    pruneNotes(this.grid, this.solution, this.notes);
    this.pop = i;
    this.render();
    return this.unitsOf(i).filter((u) => u.every((k) => this.done(k)));
  }

  /** 칸 i 가 속한 행·열·박스의 칸 목록 */
  private unitsOf(i: number): number[][] {
    return this.G.units.filter((u) => u.includes(i));
  }

  /** 공유판: 내 오답 — 정지가 풀릴 때까지 칸에 ✕ 를 띄우고 입력을 막는다 */
  miss(i: number, freezeMs: number): void {
    this.mistakes++;
    this.flash = i;
    this.frozenUntil = performance.now() + freezeMs;
    this.boardEl.classList.add('frozen');
    setTimeout(() => {
      this.flash = -1;
      this.boardEl.classList.remove('frozen');
      this.render();
    }, freezeMs);
    this.render();
  }

  private placeCursor(): void {
    const c = this.cursor;
    if (this.sel < 0) return void c.classList.remove('on');
    // 칸 크기 단위 이동이라 창 크기가 바뀌어도 맞는다
    c.style.transform = `translate(${(this.sel % this.G.n) * 100}%, ${Math.floor(this.sel / this.G.n) * 100}%)`;
    c.classList.add('on');
    c.classList.toggle('note', this.noteMode);
    c.classList.toggle('lock', this.fixed(this.sel));
    c.querySelector('b')!.textContent = this.frozen ? '❄' : this.noteMode ? '✎' : '';
  }

  private key(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.key;
    if (/^[1-9]$/.test(k) && Number(k) <= this.G.n) this.input(Number(k));
    else if (k === 'Backspace' || k === 'Delete' || k === '0') this.input(0);
    else if (k === 'n' || k === 'N' || k === 'ㅜ') this.toggleNotes();
    else if (k === 'h' || k === 'H' || k === 'ㅗ') this.useHint();
    else if (k === 'z' || k === 'Z' || k === 'ㅋ') this.undo();
    else if ((k === 'a' || k === 'A' || k === 'ㅁ') && this.autoNotes) this.fillNotes();
    else if ((k === 'e' || k === 'E' || k === 'ㄷ') && this.onExplain) !this.locked && this.onExplain();
    else if (k.startsWith('Arrow')) {
      const n = this.G.n;
      const i = this.sel < 0 ? Math.floor(this.G.cells / 2) : this.sel;
      const r = Math.floor(i / n);
      const c = i % n;
      const [dr, dc] = k === 'ArrowUp' ? [-1, 0] : k === 'ArrowDown' ? [1, 0] : k === 'ArrowLeft' ? [0, -1] : [0, 1];
      this.select(((r + dr + n) % n) * n + ((c + dc + n) % n));
      this.onInput?.('select');
    } else return;
    e.preventDefault();
  }

  render(): void {
    const s = this.sel;
    const sv = s >= 0 && (this.blind || this.done(s)) ? this.grid[s] : 0;
    const peers = s >= 0 ? new Set(this.G.peers[s]) : null;
    for (let i = 0; i < this.G.cells; i++) {
      const v = this.grid[i];
      const el = this.cells[i];
      const wrong = v ? (this.blind ? this.shownWrong.has(i) : v !== this.solution[i]) : i === this.flash;
      const own = this.owner[i];
      el.className =
        'cell' +
        (this.given[i] ? ' given' : v ? ' user' : '') +
        (own >= 0 ? ' owned' : '') +
        (this.hinted.has(i) ? ' hinted' : '') +
        (wrong ? ' wrong' : '') +
        (i === s ? ' sel' : peers?.has(i) ? ' peer' : '') +
        (sv && v === sv && i !== s ? ' same' : '');
      if (own >= 0) el.style.setProperty('--own', this.ownerColor.get(own) ?? '');
      if (v) el.innerHTML = `<span class="v${i === this.pop ? ' pop' : ''}">${v}</span>`;
      else if (this.notes[i]) {
        let h = '<div class="notes">';
        for (let n = 1; n <= this.G.n; n++) {
          const on = this.notes[i] & (1 << (n - 1));
          // 고른 칸의 숫자와 같은 메모 숫자도 같이 강조
          h += `<i${on && n === sv ? ' class="same"' : ''}>${on ? n : ''}</i>`;
        }
        el.innerHTML = h + '</div>';
      } else el.innerHTML = i === this.flash ? '<span class="v x">✕</span>' : '';
    }
    this.pop = -1;

    const placed = new Array(10).fill(0);
    this.grid.forEach((v, i) => (this.blind ? v : v === this.solution[i]) && placed[v]++);
    this.digitBtns.forEach((b, k) => {
      const left = Math.max(0, this.G.n - placed[k + 1]);
      b.disabled = left === 0;
      b.querySelector('small')!.textContent = left ? String(left) : '';
    });
    this.noteBtn.classList.toggle('on', this.noteMode);
    this.placeCursor();
    this.hintBtn.querySelector('b')!.textContent = String(this.hintsLeft);
    this.hintBtn.disabled = this.hintsLeft <= 0;
    this.undoBtn.disabled = !this.history.length;
    this.onRender?.();
  }
}
