import { PEERS, type Grid } from '../game/Sudoku';

/**
 * 플레이어 보드: 칸 선택·숫자/메모 입력·키보드·숫자패드.
 * 정답 칸은 잠기고, 틀린 숫자는 빨갛게 남아 실수로 센다(지우거나 덮어쓸 수 있음).
 */
export class Board {
  readonly grid: Grid;
  readonly given: boolean[];
  readonly notes: number[] = new Array(81).fill(0);
  sel = -1;
  noteMode = false;
  mistakes = 0;
  locked = true;
  onChange: ((filled: number, mistakes: number) => void) | null = null;
  onSolved: (() => void) | null = null;

  private cells: HTMLElement[] = [];
  private digitBtns: HTMLButtonElement[] = [];
  private noteBtn!: HTMLButtonElement;
  private readonly onKey = (e: KeyboardEvent) => this.key(e);

  constructor(
    boardEl: HTMLElement,
    padEl: HTMLElement,
    puzzle: Grid,
    private readonly solution: Grid,
  ) {
    this.grid = puzzle.slice();
    this.given = puzzle.map(Boolean);

    for (let i = 0; i < 81; i++) {
      const d = document.createElement('div');
      d.className = 'cell';
      d.dataset.r = String(Math.floor(i / 9));
      d.dataset.c = String(i % 9);
      d.addEventListener('pointerdown', () => this.select(i));
      boardEl.appendChild(d);
      this.cells.push(d);
    }

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
    tools.innerHTML = `<button class="tool" data-k="note">✎ 메모 <kbd>N</kbd></button><button class="tool" data-k="erase">⌫ 지우기</button>`;
    padEl.appendChild(tools);
    this.noteBtn = tools.querySelector('[data-k="note"]')!;
    this.noteBtn.addEventListener('click', () => this.toggleNotes());
    tools.querySelector('[data-k="erase"]')!.addEventListener('click', () => this.input(0));

    document.addEventListener('keydown', this.onKey);
    this.render();
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKey);
  }

  get filled(): number {
    let n = 0;
    for (let i = 0; i < 81; i++) if (!this.given[i] && this.grid[i] === this.solution[i]) n++;
    return n;
  }

  get solved(): boolean {
    return this.grid.every((v, i) => v === this.solution[i]);
  }

  select(i: number): void {
    this.sel = i;
    this.render();
  }

  toggleNotes(): void {
    this.noteMode = !this.noteMode;
    this.render();
  }

  input(v: number): void {
    const i = this.sel;
    if (this.locked || i < 0 || this.given[i] || this.grid[i] === this.solution[i]) return;
    if (this.noteMode && v) {
      if (!this.grid[i]) this.notes[i] ^= 1 << (v - 1);
      this.render();
      return;
    }
    this.grid[i] = v;
    this.notes[i] = 0;
    if (v && v !== this.solution[i]) this.mistakes++;
    if (v && v === this.solution[i]) for (const p of PEERS[i]) this.notes[p] &= ~(1 << (v - 1));
    this.render();
    this.onChange?.(this.filled, this.mistakes);
    if (this.solved) {
      this.locked = true;
      this.onSolved?.();
    }
  }

  private key(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.key;
    if (/^[1-9]$/.test(k)) this.input(Number(k));
    else if (k === 'Backspace' || k === 'Delete' || k === '0') this.input(0);
    else if (k === 'n' || k === 'N' || k === 'ㅜ') this.toggleNotes();
    else if (k.startsWith('Arrow')) {
      const i = this.sel < 0 ? 40 : this.sel;
      const r = Math.floor(i / 9);
      const c = i % 9;
      const [dr, dc] = k === 'ArrowUp' ? [-1, 0] : k === 'ArrowDown' ? [1, 0] : k === 'ArrowLeft' ? [0, -1] : [0, 1];
      this.select((((r + dr + 9) % 9) * 9 + ((c + dc + 9) % 9)));
    } else return;
    e.preventDefault();
  }

  render(): void {
    const s = this.sel;
    const sv = s >= 0 ? this.grid[s] : 0;
    const peers = s >= 0 ? new Set(PEERS[s]) : null;
    for (let i = 0; i < 81; i++) {
      const v = this.grid[i];
      const el = this.cells[i];
      const wrong = v !== 0 && v !== this.solution[i];
      el.className =
        'cell' +
        (this.given[i] ? ' given' : v ? ' user' : '') +
        (wrong ? ' wrong' : '') +
        (i === s ? ' sel' : peers?.has(i) ? ' peer' : '') +
        (sv && v === sv && i !== s ? ' same' : '');
      if (v) el.textContent = String(v);
      else if (this.notes[i]) {
        let h = '<div class="notes">';
        for (let n = 1; n <= 9; n++) h += `<i>${this.notes[i] & (1 << (n - 1)) ? n : ''}</i>`;
        el.innerHTML = h + '</div>';
      } else el.textContent = '';
    }
    const placed = new Array(10).fill(0);
    this.grid.forEach((v, i) => v === this.solution[i] && placed[v]++);
    this.digitBtns.forEach((b, k) => {
      const left = 9 - placed[k + 1];
      b.disabled = left === 0;
      b.querySelector('small')!.textContent = left ? String(left) : '';
    });
    this.noteBtn.classList.toggle('on', this.noteMode);
  }
}
