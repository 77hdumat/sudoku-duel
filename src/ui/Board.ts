import { bitCount, candidates, HINTS, PEERS, type Grid } from '../game/Sudoku';

/** 칸 i 가 속한 행·열·박스의 칸 목록 */
function unitsOf(i: number): number[][] {
  const r = Math.floor(i / 9);
  const c = i % 9;
  const br = r - (r % 3);
  const bc = c - (c % 3);
  return [
    Array.from({ length: 9 }, (_, k) => r * 9 + k),
    Array.from({ length: 9 }, (_, k) => k * 9 + c),
    Array.from({ length: 9 }, (_, k) => (br + Math.floor(k / 3)) * 9 + bc + (k % 3)),
  ];
}

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
  readonly notes: number[] = new Array(81).fill(0);
  /** 점령형: 칸을 가져간 플레이어 id (-1 = 없음) */
  readonly owner: number[] = new Array(81).fill(-1);
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

  private cells: HTMLElement[] = [];
  /** 고른 칸 네 모서리에 붙는 꺾쇠 커서 (칸 사이를 미끄러져 다닌다) */
  private cursor: HTMLElement;
  private digitBtns: HTMLButtonElement[] = [];
  private noteBtn!: HTMLButtonElement;
  private hintBtn!: HTMLButtonElement;
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
    /** 고급 전용: 빈칸마다 지금 가능한 후보를 메모로 한 번에 채우는 버튼 */
    private readonly autoNotes = false,
    hints = HINTS,
  ) {
    this.hintsLeft = hints;
    this.grid = puzzle.slice();
    this.given = puzzle.map(Boolean);

    for (let i = 0; i < 81; i++) {
      const d = document.createElement('div');
      d.className = 'cell';
      d.dataset.r = String(Math.floor(i / 9));
      d.dataset.c = String(i % 9);
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

    for (let v = 1; v <= 9; v++) {
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
      (shared ? '' : `<button class="tool" data-k="erase">⌫ 지우기</button>`) +
      `<button class="tool hint" data-k="hint">💡 힌트 <b></b> <kbd>H</kbd></button>` +
      (autoNotes ? `<button class="tool" data-k="auto">✨ 자동 메모 <kbd>A</kbd></button>` : '');
    padEl.appendChild(tools);
    this.noteBtn = tools.querySelector('[data-k="note"]')!;
    this.noteBtn.addEventListener('click', () => this.toggleNotes());
    tools.querySelector('[data-k="erase"]')?.addEventListener('click', () => this.input(0));
    this.hintBtn = tools.querySelector('[data-k="hint"]')!;
    this.hintBtn.addEventListener('click', () => this.useHint());
    tools.querySelector('[data-k="auto"]')?.addEventListener('click', () => this.fillNotes());

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
    for (let i = 0; i < 81; i++) if (!this.given[i] && this.done(i)) n++;
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
    if (this.locked || i < 0 || this.given[i] || this.done(i)) return;
    if (this.frozen) return void this.onInput?.('blocked');
    if (this.noteMode && v) {
      if (!this.grid[i]) this.notes[i] ^= 1 << (v - 1);
      this.onInput?.('note');
      this.render();
      return;
    }
    if (this.shared) {
      if (v) this.onPlace?.(i, v, false);
      return;
    }
    if (v && v === this.solution[i]) return this.commit(i, false);
    // 메모는 지우지 않는다 — 틀린 숫자를 지우면 원래 메모가 다시 보인다
    this.grid[i] = v;
    if (v) {
      this.mistakes++;
      this.onWrong?.(i);
    }
    this.render();
    this.onChange?.(this.filled, this.mistakes);
  }

  /** 관전자용 판 상태: grid 81 글자(0 = 빈칸), notes 칸마다 36진수 2 글자 */
  snapshot(): { grid: string; notes: string } {
    return { grid: this.grid.join(''), notes: this.notes.map((n) => n.toString(36).padStart(2, '0')).join('') };
  }

  /** 고른 칸(없거나 이미 맞은 칸이면 가장 쉬운 빈칸)의 정답을 연다 */
  useHint(): void {
    if (this.locked || this.hintsLeft <= 0) return void this.onInput?.('blocked');
    let i = this.sel;
    if (i < 0 || this.given[i] || this.done(i)) {
      const known = this.grid.map((v, k) => (this.done(k) ? v : 0));
      let best = 10;
      i = -1;
      for (let k = 0; k < 81; k++) {
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
    const known = this.grid.map((v, k) => (this.done(k) ? v : 0));
    for (let i = 0; i < 81; i++) if (!this.grid[i]) this.notes[i] = candidates(known, i);
    this.onInput?.('auto');
    this.render();
  }

  /** 개인판에서 정답 확정 */
  private commit(i: number, hint: boolean): void {
    const v = this.solution[i];
    this.grid[i] = v;
    this.notes[i] = 0;
    if (hint) this.hinted.add(i);
    for (const p of PEERS[i]) this.notes[p] &= ~(1 << (v - 1));
    this.pop = i;
    const units = unitsOf(i).filter((u) => u.every((k) => this.done(k)));
    this.render();
    this.onCorrect?.(i, hint, units);
    this.onChange?.(this.filled, this.mistakes);
    if (this.solved) {
      this.locked = true;
      this.onSolved?.();
    }
  }

  /** 공유판: 방장이 확정한 칸. 이번에 완성된 행·열·박스를 돌려준다 */
  claim(i: number, owner: number, color: string, hint: boolean): number[][] {
    const v = this.solution[i];
    this.grid[i] = v;
    this.owner[i] = owner;
    this.ownerColor.set(owner, color);
    this.notes[i] = 0;
    if (hint) this.hinted.add(i);
    for (const p of PEERS[i]) this.notes[p] &= ~(1 << (v - 1));
    this.pop = i;
    this.render();
    return unitsOf(i).filter((u) => u.every((k) => this.done(k)));
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
    c.style.transform = `translate(${(this.sel % 9) * 100}%, ${Math.floor(this.sel / 9) * 100}%)`;
    c.classList.add('on');
    c.classList.toggle('note', this.noteMode);
    c.classList.toggle('lock', this.given[this.sel] || this.done(this.sel));
    c.querySelector('b')!.textContent = this.frozen ? '❄' : this.noteMode ? '✎' : '';
  }

  private key(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.key;
    if (/^[1-9]$/.test(k)) this.input(Number(k));
    else if (k === 'Backspace' || k === 'Delete' || k === '0') this.input(0);
    else if (k === 'n' || k === 'N' || k === 'ㅜ') this.toggleNotes();
    else if (k === 'h' || k === 'H' || k === 'ㅗ') this.useHint();
    else if ((k === 'a' || k === 'A' || k === 'ㅁ') && this.autoNotes) this.fillNotes();
    else if (k.startsWith('Arrow')) {
      const i = this.sel < 0 ? 40 : this.sel;
      const r = Math.floor(i / 9);
      const c = i % 9;
      const [dr, dc] = k === 'ArrowUp' ? [-1, 0] : k === 'ArrowDown' ? [1, 0] : k === 'ArrowLeft' ? [0, -1] : [0, 1];
      this.select(((r + dr + 9) % 9) * 9 + ((c + dc + 9) % 9));
      this.onInput?.('select');
    } else return;
    e.preventDefault();
  }

  render(): void {
    const s = this.sel;
    const sv = s >= 0 && this.done(s) ? this.grid[s] : 0;
    const peers = s >= 0 ? new Set(PEERS[s]) : null;
    for (let i = 0; i < 81; i++) {
      const v = this.grid[i];
      const el = this.cells[i];
      const wrong = v ? v !== this.solution[i] : i === this.flash;
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
        for (let n = 1; n <= 9; n++) {
          const on = this.notes[i] & (1 << (n - 1));
          // 고른 칸의 숫자와 같은 메모 숫자도 같이 강조
          h += `<i${on && n === sv ? ' class="same"' : ''}>${on ? n : ''}</i>`;
        }
        el.innerHTML = h + '</div>';
      } else el.innerHTML = i === this.flash ? '<span class="v x">✕</span>' : '';
    }
    this.pop = -1;

    const placed = new Array(10).fill(0);
    this.grid.forEach((v, i) => v === this.solution[i] && placed[v]++);
    this.digitBtns.forEach((b, k) => {
      const left = 9 - placed[k + 1];
      b.disabled = left === 0;
      b.querySelector('small')!.textContent = left ? String(left) : '';
    });
    this.noteBtn.classList.toggle('on', this.noteMode);
    this.placeCursor();
    this.hintBtn.querySelector('b')!.textContent = String(this.hintsLeft);
    this.hintBtn.disabled = this.hintsLeft <= 0;
    this.onRender?.();
  }
}
