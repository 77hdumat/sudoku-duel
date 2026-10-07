import type { Step } from '../game/Grade';

const SVG = 'http://www.w3.org/2000/svg';
/** 칸 한 변 (viewBox 단위) */
const U = 100;

/** 링크 하나 그리는 시간(초). 단계마다 영역 → 패턴 → 링크 → 지움 → 기입 순으로 나타난다 */
const LINK_S = 0.35;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

/**
 * 풀이 보기: 보드 위에 SVG 로 기술의 원리를 그리고, 숫자패드 자리에 설명 패널을 띄운다.
 * (버튼은 three.js 블록이 맨 위 레이어에 그려서, 패드 위에 패널을 겹치면 패드 블록이 패널을 덮는다 → 패드를 잠시 숨기고 그 자리에 넣는다)
 * apply 는 단계를 넘길 때마다 불린다 (후보 지우기·숫자 기입). 반환값은 중간에 닫는 함수.
 */
export function showExplain(wrap: HTMLElement, steps: Step[], n: number, apply: (st: Step) => void, done: () => void): () => void {
  const center = wrap.parentElement!;
  const svg = el('svg', { class: 'ex-svg', viewBox: `0 0 ${n * U} ${n * U}`, 'aria-hidden': 'true' }, wrap);
  const panel = document.createElement('section');
  panel.className = 'explain';
  panel.setAttribute('aria-live', 'polite');
  wrap.after(panel);
  center.classList.add('explaining');

  const rows = n === 6 ? 2 : 3;
  const xy = (i: number) => [(i % n) * U, Math.floor(i / n) * U];
  /** 칸 안 후보 자리 (메모 배치와 같다: 가로 3칸) */
  const cand = (i: number, d: number) => {
    const [x, y] = xy(i);
    return [x + (((d - 1) % 3) + 0.5) * (U / 3), y + (Math.floor((d - 1) / 3) + 0.5) * (U / rows)];
  };

  let k = 0;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    svg.remove();
    panel.remove();
    center.classList.remove('explaining');
  };
  const finish = () => {
    for (; k < steps.length; k++) apply(steps[k]);
    close();
    done();
  };

  const draw = (st: Step) => {
    svg.replaceChildren();
    el('rect', { class: 'ex-dim', x: 0, y: 0, width: n * U, height: n * U }, svg);
    for (const i of new Set(st.area)) {
      const [x, y] = xy(i);
      el('rect', { class: 'ex-area', x, y, width: U, height: U }, svg);
    }
    st.cells.forEach((i, j) => {
      const [x, y] = xy(i);
      el('rect', { class: 'ex-cell', x: x + 4, y: y + 4, width: U - 8, height: U - 8, rx: 12, style: `animation-delay:${0.15 + j * 0.06}s` }, svg);
    });
    for (const m of st.marks) {
      const [x, y] = cand(m.i, m.d);
      const g = el('g', { class: `ex-mark ${m.tone}`, style: 'animation-delay:0.35s' }, svg);
      el('circle', { cx: x, cy: y, r: U / 7 }, g);
      el('text', { x, y }, g).textContent = String(m.d);
    }
    // 포싱: 가정(주황) → 정해지는 숫자들(초록, 차례로) → 모순(빨강)
    let tf = 0;
    if (st.assume) {
      const [x, y] = xy(st.assume.i);
      const g = el('g', { class: 'ex-assume', style: 'animation-delay:0.2s' }, svg);
      el('rect', { x: x + 4, y: y + 4, width: U - 8, height: U - 8, rx: 12 }, g);
      el('text', { x: x + U / 2, y: y + U / 2 }, g).textContent = `${st.assume.v}?`;
      const shown = (st.trail ?? []).slice(0, 30);
      const gap = Math.min(0.18, 3 / Math.max(1, shown.length));
      shown.forEach((p, j) => {
        const [tx, ty] = xy(p.i);
        el('text', { class: 'ex-trail', x: tx + U / 2, y: ty + U / 2, style: `animation-delay:${0.6 + j * gap}s` }, svg).textContent = String(p.v);
      });
      tf = 0.6 + shown.length * gap + 0.2;
      for (const i of st.bad ?? []) {
        const [bx, by] = xy(i);
        el('rect', { class: 'ex-bad', x: bx + 3, y: by + 3, width: U - 6, height: U - 6, rx: 12, style: `animation-delay:${tf}s, ${tf + 0.35}s` }, svg);
      }
      tf += 0.5;
    }
    const t0 = Math.max(0.6, tf);
    st.links.forEach((l, j) => {
      const [x1, y1] = cand(l.a[0], l.a[1]);
      const [x2, y2] = cand(l.b[0], l.b[1]);
      // 같은 칸 안 링크(칸 안 후보 둘)는 살짝 휘게
      const mx = (x1 + x2) / 2 + (y2 - y1) * 0.15;
      const my = (y1 + y2) / 2 - (x2 - x1) * 0.15;
      el('path', { class: `ex-link ${l.strong ? 'strong' : 'weak'}`, d: `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`, pathLength: 1, style: `animation-delay:${t0 + j * LINK_S}s` }, svg);
    });
    const t1 = t0 + st.links.length * LINK_S + 0.2;
    for (const e of st.elim) {
      const [x, y] = cand(e.i, e.d);
      const r = U / 7;
      const g = el('g', { class: 'ex-elim', style: `animation-delay:${t1}s` }, svg);
      el('text', { x, y }, g).textContent = String(e.d);
      el('path', { d: `M${x - r} ${y - r}L${x + r} ${y + r}M${x + r} ${y - r}L${x - r} ${y + r}` }, g);
    }
    if (st.place) {
      const [x, y] = xy(st.place.i);
      const g = el('g', { class: 'ex-place', style: `animation-delay:${t1 + (st.elim.length ? 0.4 : 0)}s` }, svg);
      el('rect', { x: x + 4, y: y + 4, width: U - 8, height: U - 8, rx: 12 }, g);
      el('text', { x: x + U / 2, y: y + U / 2 }, g).textContent = String(st.place.v);
    }

    const last = k === steps.length - 1;
    const legend = [
      st.marks.some((m) => m.tone === 'key') && '<i class="key"></i>패턴',
      st.marks.some((m) => m.tone === 'on') && '<i class="on"></i>참',
      st.marks.some((m) => m.tone === 'off') && '<i class="off"></i>거짓',
      st.links.some((l) => l.strong) && '<i class="ln strong"></i>강한 링크',
      st.links.some((l) => !l.strong) && '<i class="ln weak"></i>약한 링크',
      st.assume && '<i class="off"></i>가정',
      st.trail?.length && '<i class="on"></i>따라 정해짐',
      st.bad?.length && '<i class="bad"></i>모순',
      st.elim.length && '<i class="x">✕</i>지움',
    ].filter(Boolean);
    panel.innerHTML = `
      <div class="ex-head"><b>${st.name}</b><span>${k + 1} / ${steps.length}</span></div>
      <p class="ex-text">${st.text}</p>
      ${legend.length ? `<div class="ex-legend">${legend.map((l) => `<span>${l}</span>`).join('')}</div>` : ''}
      <div class="ex-btns">
        <button class="ghost" data-x="close">닫기</button>
        ${last ? '' : '<button class="ghost" data-x="skip">바로 기입</button>'}
        <button class="primary" data-x="next">${last ? `${st.place ? `${st.place.v} 기입 ✓` : '확인 ✓'}` : '다음 ▶'}</button>
      </div>`;
    panel.querySelector<HTMLButtonElement>('[data-x="close"]')!.onclick = () => {
      // 이미 본 단계(지운 후보)까지는 반영하고 닫는다
      close();
      done();
    };
    panel.querySelector<HTMLButtonElement>('[data-x="skip"]')?.addEventListener('click', finish);
    panel.querySelector<HTMLButtonElement>('[data-x="next"]')!.onclick = () => {
      apply(steps[k]);
      k++;
      if (k >= steps.length) {
        close();
        done();
      } else draw(steps[k]);
    };
  };

  if (!steps.length) {
    panel.innerHTML = `<p class="ex-text">더 풀 칸이 없어요.</p><div class="ex-btns"><button class="primary" data-x="next">확인</button></div>`;
    panel.querySelector<HTMLButtonElement>('[data-x="next"]')!.onclick = () => {
      close();
      done();
    };
  } else draw(steps[0]);
  return close;
}
