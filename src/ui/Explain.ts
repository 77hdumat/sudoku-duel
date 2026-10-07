import type { Draw, Step } from '../game/Grade';
import { TECHS, type Diagram } from '../game/Techniques';

const SVG = 'http://www.w3.org/2000/svg';
/** 칸 한 변 (viewBox 단위) */
const U = 100;
/** 링크·줄줄이 숫자 하나 그리는 간격(초) */
const LINK_S = 0.3;

/** 이번 세션에 처음 나온 기법은 기법 카드부터 보여 준다 */
const seenTech = new Set<string>();

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

/** 기법 카드의 패턴 도식 (9×9, 기호로) */
function diagramSvg(d: Diagram): string {
  const C = 30;
  const at = (r: number, c: number) => [c * C + C / 2, r * C + C / 2];
  let h = `<svg class="ex-dia" viewBox="0 0 ${9 * C} ${9 * C}" aria-hidden="true">`;
  for (const [r, c] of d.area ?? []) h += `<rect class="a" x="${c * C}" y="${r * C}" width="${C}" height="${C}"/>`;
  for (let k = 1; k < 9; k++) {
    const w = k % 3 ? 'thin' : 'thick';
    h += `<line class="${w}" x1="${k * C}" y1="0" x2="${k * C}" y2="${9 * C}"/><line class="${w}" x1="0" y1="${k * C}" x2="${9 * C}" y2="${k * C}"/>`;
  }
  for (const [r, c, t] of d.digits ?? []) {
    const [x, y] = at(r, c);
    h += `<text class="dg" x="${x}" y="${y}">${t}</text>`;
  }
  for (const [r, c] of d.cells ?? []) h += `<rect class="c" x="${c * C + 2}" y="${r * C + 2}" width="${C - 4}" height="${C - 4}" rx="5"/>`;
  for (const [[r1, c1], [r2, c2], strong] of d.lines ?? []) {
    const [x1, y1] = at(r1, c1);
    const [x2, y2] = at(r2, c2);
    h += `<line class="${strong ? 'ls' : 'lw'}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  // 한 칸에 동그라미가 여럿이면 옆으로 벌린다
  const per = new Map<string, number>();
  for (const [r, c] of d.dots ?? []) per.set(`${r},${c}`, (per.get(`${r},${c}`) ?? 0) + 1);
  const used = new Map<string, number>();
  for (const [r, c, t, tone] of d.dots ?? []) {
    const k = `${r},${c}`;
    const n = per.get(k)!;
    const j = used.get(k) ?? 0;
    used.set(k, j + 1);
    const [x0, y] = at(r, c);
    const x = x0 + (n > 1 ? (j - (n - 1) / 2) * 13 : 0);
    h += `<circle class="dt ${tone}" cx="${x}" cy="${y}" r="${t.length > 2 ? 12 : 10}"/><text class="dl" x="${x}" y="${y}">${t}</text>`;
  }
  for (const [r, c] of d.x ?? []) {
    const [x, y] = at(r, c);
    h += `<path class="xx" d="M${x - 8} ${y - 8}L${x + 8} ${y + 8}M${x + 8} ${y - 8}L${x - 8} ${y + 8}"/>`;
  }
  return h + '</svg>';
}

/**
 * 풀이 보기: 기법을 쓰는 생각을 한 걸음(phase)씩 보드 위 애니메이션과 글로 보여 주고, 숫자패드 자리에 설명 패널을 띄운다.
 * (버튼은 three.js 블록이 맨 위 레이어에 그려서, 패드 위에 패널을 겹치면 패드 블록이 패널을 덮는다 → 패드를 잠시 숨기고 그 자리에 넣는다)
 * apply 는 기법 하나를 다 보고 넘길 때마다 불린다 (후보 지우기·숫자 기입). 반환값은 중간에 닫는 함수.
 */
export function showExplain(wrap: HTMLElement, steps: Step[], n: number, apply: (st: Step) => void, done: () => void): () => void {
  const center = wrap.parentElement!;
  const svg = el('svg', { class: 'ex-svg', viewBox: `0 0 ${n * U} ${n * U}`, 'aria-hidden': 'true' }, wrap);
  /** 기법 카드의 패턴 도식 (보드 위에 덮는다) */
  const board = document.createElement('div');
  board.className = 'ex-cardboard';
  board.hidden = true;
  wrap.appendChild(board);
  const panel = document.createElement('section');
  panel.className = 'explain';
  panel.setAttribute('aria-live', 'polite');
  // 넓은 화면은 왼쪽 패널(순위표 자리)에, 좁은 화면은 숫자패드 자리에 — 판 크기·위치는 그대로 둔다
  // (판을 줄이면 풀이 그림과 실제 칸 크기가 달라 읽기 어렵고, 닫을 때 불꽃 같은 이펙트가 엉뚱한 곳에 남는다)
  const side = matchMedia('(min-width: 901px)').matches ? document.querySelector<HTMLElement>('.play .side') : null;
  if (side) {
    side.prepend(panel);
    side.classList.add('explaining');
  } else {
    wrap.after(panel);
    center.classList.add('explaining');
  }

  const rows = n === 6 ? 2 : 3;
  const xy = (i: number) => [(i % n) * U, Math.floor(i / n) * U];
  /** 칸 안 후보 자리 (메모 배치와 같다: 가로 3칸) */
  const cand = (i: number, d: number) => {
    const [x, y] = xy(i);
    return [x + (((d - 1) % 3) + 0.5) * (U / 3), y + (Math.floor((d - 1) / 3) + 0.5) * (U / rows)];
  };

  let k = 0;
  let ph = 0;
  let card = false;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    svg.remove();
    board.remove();
    panel.remove();
    center.classList.remove('explaining');
    side?.classList.remove('explaining');
  };
  // 기입은 패널을 닫아 화면 배치가 돌아온 뒤에 — 불꽃 같은 칸 이펙트가 제자리에 터지게
  const finish = () => {
    close();
    for (; k < steps.length; k++) apply(steps[k]);
    done();
  };

  /** 한 서술의 그림. still 이면 앞 서술에서 이미 본 것이라 애니메이션 없이 */
  const layer = (d: Draw, still: boolean) => {
    const g = el('g', { class: still ? 'still' : 'fresh' }, svg);
    for (const i of new Set(d.area ?? [])) {
      const [x, y] = xy(i);
      el('rect', { class: 'ex-area', x, y, width: U, height: U }, g);
    }
    (d.cells ?? []).forEach((i, j) => {
      const [x, y] = xy(i);
      el('rect', { class: 'ex-cell', x: x + 4, y: y + 4, width: U - 8, height: U - 8, rx: 12, style: `animation-delay:${0.1 + Math.min(j, 12) * 0.05}s` }, g);
    });
    for (const i of d.blocked ?? []) {
      const [x, y] = xy(i);
      el('path', { class: 'ex-block', d: `M${x + 22} ${y + 22}L${x + U - 22} ${y + U - 22}M${x + U - 22} ${y + 22}L${x + 22} ${y + U - 22}`, style: 'animation-delay:0.4s' }, g);
    }
    for (const m of d.marks ?? []) {
      const [x, y] = cand(m.i, m.d);
      const mg = el('g', { class: `ex-mark ${m.tone}`, style: 'animation-delay:0.25s' }, g);
      el('circle', { cx: x, cy: y, r: U / 7 }, mg);
      el('text', { x, y }, mg).textContent = String(m.d);
    }
    for (const gh of d.ghosts ?? []) {
      const [x, y] = xy(gh.i);
      el('text', { class: `ex-ghost ${gh.tone}`, x: x + U / 2, y: y + U / 2, style: 'animation-delay:0.2s' }, g).textContent = String(gh.v);
    }
    let t = 0.4;
    if (d.assume) {
      const [x, y] = xy(d.assume.i);
      const ag = el('g', { class: 'ex-assume', style: 'animation-delay:0.1s' }, g);
      el('rect', { x: x + 4, y: y + 4, width: U - 8, height: U - 8, rx: 12 }, ag);
      el('text', { x: x + U / 2, y: y + U / 2 }, ag).textContent = `${d.assume.v}?`;
    }
    if (d.trail?.length) {
      const gap = Math.min(0.18, 3 / d.trail.length);
      d.trail.forEach((p, j) => {
        const [x, y] = xy(p.i);
        el('text', { class: 'ex-trail', x: x + U / 2, y: y + U / 2, style: `animation-delay:${0.2 + j * gap}s` }, g).textContent = String(p.v);
      });
      t = 0.2 + d.trail.length * gap;
    }
    (d.links ?? []).forEach((l, j) => {
      const [x1, y1] = cand(l.a[0], l.a[1]);
      const [x2, y2] = cand(l.b[0], l.b[1]);
      // 살짝 휘게 (같은 칸 안 링크도 보이도록)
      const mx = (x1 + x2) / 2 + (y2 - y1) * 0.15 + (x1 === x2 && y1 === y2 ? 20 : 0);
      const my = (y1 + y2) / 2 - (x2 - x1) * 0.15;
      el('path', { class: `ex-link ${l.strong ? 'strong' : 'weak'}`, d: `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`, pathLength: 1, style: `animation-delay:${t + j * LINK_S}s` }, g);
    });
    t += (d.links?.length ?? 0) * LINK_S;
    for (const i of d.bad ?? []) {
      const [x, y] = xy(i);
      el('rect', { class: 'ex-bad', x: x + 3, y: y + 3, width: U - 6, height: U - 6, rx: 12, style: `animation-delay:${t}s, ${t + 0.35}s` }, g);
    }
    for (const e of d.elim ?? []) {
      const [x, y] = cand(e.i, e.d);
      const r = U / 7;
      const eg = el('g', { class: 'ex-elim', style: `animation-delay:${t}s` }, g);
      el('text', { x, y }, eg).textContent = String(e.d);
      el('path', { d: `M${x - r} ${y - r}L${x + r} ${y + r}M${x + r} ${y - r}L${x - r} ${y + r}` }, eg);
    }
    if (d.place) {
      const [x, y] = xy(d.place.i);
      const pg = el('g', { class: 'ex-place', style: `animation-delay:${t + 0.1}s` }, g);
      el('rect', { x: x + 4, y: y + 4, width: U - 8, height: U - 8, rx: 12 }, pg);
      el('text', { x: x + U / 2, y: y + U / 2 }, pg).textContent = String(d.place.v);
    }
  };

  const drawBoard = () => {
    const st = steps[k];
    svg.replaceChildren();
    el('rect', { class: 'ex-dim', x: 0, y: 0, width: n * U, height: n * U }, svg);
    // 칸 줄 (박스 경계는 굵게 — 6×6 박스는 가로 3 × 세로 2)
    const bh = n === 6 ? 2 : 3;
    for (let k = 1; k < n; k++) {
      el('line', { class: k % 3 ? 'ex-grid' : 'ex-grid thick', x1: k * U, y1: 0, x2: k * U, y2: n * U }, svg);
      el('line', { class: k % bh ? 'ex-grid' : 'ex-grid thick', x1: 0, y1: k * U, x2: n * U, y2: k * U }, svg);
    }
    // 풀이가 기준으로 삼는 판의 숫자 (화면의 내 메모·틀린 숫자는 아래에 가려진다)
    const gd = el('g', { class: 'ex-digits' }, svg);
    st.grid.forEach((v, i) => {
      if (!v) return;
      const [x, y] = xy(i);
      el('text', { x: x + U / 2, y: y + U / 2 }, gd).textContent = String(v);
    });
    // 그 시점의 후보를 옅게 (강조한 후보는 위에 다시 그려진다). 하나 찾기(기초)는 후보 없이도 보이니 깔지 않는다 — 초보에겐 복잡하기만 하다
    const pc = el('g', { class: 'ex-pencil' }, svg);
    if (TECHS[st.id].tier !== '기초')
      st.cands.forEach((m, i) => {
      for (let d = 1; d <= n; d++)
        if (m & (1 << (d - 1))) {
          const [x, y] = cand(i, d);
          el('text', { x, y }, pc).textContent = String(d);
        }
      });
    st.phases.slice(0, ph + 1).forEach((p, j) => p.draw && layer(p.draw, j < ph));
    const temp = st.phases[ph].temp;
    if (temp) layer(temp, false);
  };

  const legendOf = (st: Step) => {
    const ds = [...st.phases.slice(0, ph + 1).map((p) => p.draw), st.phases[ph].temp].filter(Boolean) as Draw[];
    const any = (f: (d: Draw) => unknown) => ds.some(f);
    return [
      any((d) => d.marks?.some((m) => m.tone === 'key')) && '<i class="key"></i>살펴볼 자리',
      any((d) => d.marks?.some((m) => m.tone === 'on') || d.ghosts?.length) && '<i class="on"></i>들어감',
      any((d) => d.marks?.some((m) => m.tone === 'off')) && '<i class="off"></i>안 들어감',
      any((d) => d.links?.some((l) => l.strong)) && '<i class="ln strong"></i>실선: 한쪽이 아니면 다른 쪽',
      any((d) => d.links?.some((l) => !l.strong)) && '<i class="ln weak"></i>점선: 둘 다는 불가',
      any((d) => d.assume) && '<i class="off"></i>가정',
      any((d) => d.bad?.length) && `<i class="bad"></i>${st.id === 'fix' ? '틀린 칸' : '모순'}`,
      any((d) => d.elim?.length || d.blocked?.length) && '<i class="x">✕</i>못 들어감',
    ].filter(Boolean);
  };

  const render = () => {
    const st = steps[k];
    const t = TECHS[st.id];
    const head = `<div class="ex-head"><span class="ex-tier t${['기초', '초급', '중급', '고급', '초고급'].indexOf(t.tier)}">${t.tier}</span><b>${t.name}</b></div>`;
    if (card) {
      // 패턴 도식은 보드 자리에 크게, 패널엔 글만
      svg.replaceChildren();
      board.innerHTML = `${diagramSvg(t.diagram)}<span>패턴 모양 (기호 예시)</span>`;
      board.hidden = false;
      panel.innerHTML = `${head}
        <div class="ex-scroll ex-card">
          <p class="ex-memo">💡 ${t.memo}</p>
          <h4>원리</h4><p>${t.idea}</p>
          <h4>찾는 법</h4><p>${t.spot}</p>
          <h4>결과</h4><p>${t.result}</p>
        </div>
        <div class="ex-nav"><button class="primary" data-x="back">이 판에서 보기 ▶</button></div>`;
      panel.querySelector<HTMLButtonElement>('[data-x="back"]')!.onclick = () => {
        card = false;
        render();
      };
      return;
    }
    board.hidden = true;
    drawBoard();
    const lastPh = ph === st.phases.length - 1;
    const lastStep = k === steps.length - 1;
    const legend = legendOf(st);
    const next = !lastPh ? '다음 ▶' : lastStep ? (st.place ? `✓ ${st.place.v} 기입` : '확인 ✓') : '다음 기법 ▶';
    panel.innerHTML = `${head}
      <div class="ex-progress">기법 ${k + 1}/${steps.length} · 생각 ${ph + 1}/${st.phases.length}</div>
      <p class="ex-scroll ex-text">${st.phases[ph].text}</p>
      ${legend.length ? `<div class="ex-legend">${legend.map((l) => `<span>${l}</span>`).join('')}</div>` : ''}
      <div class="ex-nav ex-five">
        <button class="ghost" data-x="close">닫기</button>
        <button class="ghost" data-x="card">📘 카드</button>
        <button class="ghost" data-x="skip" ${lastStep && lastPh ? 'disabled' : ''}>바로 기입</button>
        <button class="ghost" data-x="prev" ${ph ? '' : 'disabled'}>◀ 이전</button>
        <button class="primary" data-x="next">${next}</button>
      </div>`;
    const on = (x: string, f: () => void) => panel.querySelector<HTMLButtonElement>(`[data-x="${x}"]`)?.addEventListener('click', f);
    on('prev', () => {
      if (ph) ph--;
      render();
    });
    on('next', () => {
      if (!lastPh) ph++;
      else {
        k++;
        ph = 0;
        if (k >= steps.length) {
          close();
          apply(steps[k - 1]);
          done();
          return;
        }
        apply(steps[k - 1]);
        enter();
      }
      render();
    });
    on('card', () => {
      card = true;
      render();
    });
    on('skip', finish);
    // 이미 넘긴 기법까지 반영하고 닫는다. 지금 기법도 마지막 서술(결론)까지 봤으면 그것도 반영
    on('close', () => {
      close();
      if (lastPh) apply(steps[k++]);
      done();
    });
  };

  /** 새 기법에 들어설 때: 처음 보는 기법이면 카드부터 */
  const enter = () => {
    const id = steps[k].id;
    card = id !== 'fix' && !seenTech.has(id);
    seenTech.add(id);
  };

  if (!steps.length) {
    panel.innerHTML = `<p class="ex-text">더 풀 칸이 없어요.</p><div class="ex-nav"><button class="primary" data-x="ok">확인</button></div>`;
    panel.querySelector<HTMLButtonElement>('[data-x="ok"]')!.onclick = () => {
      close();
      done();
    };
  } else {
    enter();
    render();
  }
  return close;
}
