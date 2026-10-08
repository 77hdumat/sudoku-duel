import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { makeFace, type Face } from './Faces';

/**
 * 화면의 모든 버튼을 장난감 블록으로: DOM 버튼은 투명하게 남겨 클릭·키보드·포커스를 그대로 받고,
 * 그 자리에 같은 크기의 3D 블록을 그린 뒤 버튼 안 글자·아이콘·배지를 윗면 텍스처로 옮겨 그린다.
 * 이펙트 레이어(직교 카메라, 화면 픽셀 좌표) 위에 올라가므로 다른 요소에 가려진 버튼은 숨긴다.
 *
 * 선명함: 가만히 있을 때는 기울이지 않고 윗면을 화면 픽셀에 1:1 로 맞춘다(글자가 번지지 않게).
 * 블록 두께는 아래로 삐져나온 어두운 몸통(같은 색을 어둡게, 조명 없이)으로 보여 테두리가 뿌옇지 않다.
 */

const SELECTOR = '#app button:not(.no-guess-x), #mute';

interface Blk {
  el: HTMLButtonElement;
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial;
  faceMat: THREE.MeshBasicMaterial;
  body: THREE.Mesh;
  face: THREE.Mesh;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  w: number;
  h: number;
  depth: number;
  /** 아래로 보이는 몸통 두께(px) */
  edge: number;
  key: string;
  hover: number;
  press: number;
  pop: number;
  popV: number;
  over: boolean;
  down: boolean;
  /** 버튼 속 <img data-bot> 자리에 서는 3D 봇 얼굴 */
  bot?: Face | null;
}

/** CSS 색 문자열(color-mix·color() 포함)을 캔버스로 한 번 칠해 실제 RGB 로 */
const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
probe.canvas.width = probe.canvas.height = 1;
function cssColor(css: string): { hex: string; alpha: number } {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return { hex: `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`, alpha: a / 255 };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** 글자용 텍스처: 밉맵·축소 필터를 끄고 그대로 찍는다 (뿌옇지 않게) */
function crispTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

export class UiBlocks {
  private items = new Map<HTMLButtonElement, Blk>();
  private repaintAll = false;
  private mouse = { x: -1e4, y: -1e4 };

  constructor(private readonly scene: THREE.Scene) {
    document.fonts?.addEventListener('loadingdone', () => (this.repaintAll = true));
    addEventListener('pointermove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
  }

  update(dt: number): void {
    const seen = new Set<HTMLButtonElement>();
    document.querySelectorAll<HTMLButtonElement>(SELECTOR).forEach((el) => {
      seen.add(el);
      this.sync(this.items.get(el) ?? this.add(el), dt);
    });
    for (const [el, b] of this.items) if (!seen.has(el)) this.remove(b);
    this.repaintAll = false;
  }

  private add(el: HTMLButtonElement): Blk {
    const canvas = document.createElement('canvas');
    const tex = crispTexture(canvas);
    const mat = new THREE.MeshBasicMaterial();
    const faceMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), faceMat);
    group.add(body, face);
    this.scene.add(group);
    const b: Blk = { el, group, mat, faceMat, body, face, canvas, tex, w: 0, h: 0, depth: 0, edge: 0, key: '', hover: 0, press: 0, pop: -0.35, popV: 0, over: false, down: false };
    el.classList.add('blk');
    el.addEventListener('pointerenter', () => (b.over = true));
    el.addEventListener('pointerleave', () => (b.over = b.down = false));
    el.addEventListener('pointerdown', () => (b.down = true));
    el.addEventListener('pointerup', () => (b.down = false));
    el.addEventListener('pointercancel', () => (b.down = false));
    el.addEventListener('click', () => (b.popV += 2.2));
    this.items.set(el, b);
    return b;
  }

  private remove(b: Blk): void {
    this.scene.remove(b.group);
    b.body.geometry.dispose();
    b.face.geometry.dispose();
    b.mat.dispose();
    b.faceMat.dispose();
    b.tex.dispose();
    this.items.delete(b.el);
  }

  private sync(b: Blk, dt: number): void {
    const el = b.el;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // 숨었거나 다른 요소(결과 창 등)에 덮였으면 그리지 않는다
    const hit = r.width > 2 ? document.elementFromPoint(cx, cy) : null;
    b.group.visible = !!hit && (hit === el || el.contains(hit));
    if (!b.group.visible) return;

    if (Math.abs(r.width - b.w) > 1 || Math.abs(r.height - b.h) > 1) {
      b.w = r.width;
      b.h = r.height;
      b.depth = clamp(r.height * 0.42, 10, 28);
      b.edge = Math.round(clamp(r.height * 0.1, 4, 7));
      const radius = Math.min(16, r.height * 0.3, r.width * 0.3);
      b.body.geometry.dispose();
      b.body.geometry = new RoundedBoxGeometry(r.width, r.height, b.depth, 4, radius);
      b.face.position.z = b.depth / 2 + 0.6;
      b.key = '';
    }

    const theme = document.documentElement.dataset.theme ?? '';
    const focus = el.matches(':focus-visible');
    const key = `${theme}|${el.className}|${el.disabled}|${focus}|${el.textContent}|${el.querySelector('img')?.getBoundingClientRect().top ?? ''}|${el.querySelector('img')?.src ?? ''}`;
    if (key !== b.key || this.repaintAll) {
      b.key = key;
      this.paint(b, r);
    }

    // 떠오름·눌림·통통 튐
    const on = el.classList.contains('on');
    const k = Math.min(1, dt * 14);
    b.hover += ((b.over && !el.disabled ? 1 : 0) - b.hover) * k;
    b.press += ((b.down && !el.disabled ? 1 : 0) - b.press) * Math.min(1, dt * 24);
    b.popV += (-b.pop * 260 - b.popV * 13) * dt;
    b.pop += b.popV * dt;

    const mx = clamp((this.mouse.x - cx) / r.width, -0.6, 0.6);
    const my = clamp((this.mouse.y - cy) / r.height, -0.6, 0.6);
    // 윗면은 버튼 자리 그대로(기기 픽셀에 맞춰), 눌리면 몸통 쪽으로 내려간다
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const snap = (v: number) => Math.round(v * dpr) / dpr;
    const sink = Math.max(b.press, on ? 0.6 : 0) * b.edge;
    const lift = b.hover * 2;
    b.group.position.set(snap(r.left) + b.w / 2, -(snap(r.top) + b.h / 2) - sink + lift, b.hover * 40);
    b.body.position.y = -(b.edge - sink);
    b.face.scale.set(b.w, b.h, 1);
    // 기울기는 마우스를 올렸을 때만 살짝
    b.group.rotation.set(my * 0.18 * b.hover, mx * 0.22 * b.hover, 0);
    const s = 1 + b.hover * 0.03 + b.pop;
    b.group.scale.set(s, s, 1);
    this.syncBot(b, r, dt);

    // 다 쓴 숫자 버튼은 흐리게 하지 않고 숫자만 뺀 흰 블럭으로 (style.css .digit:disabled)
    const dim = el.disabled && !el.classList.contains('digit') ? 0.45 : 1;
    b.mat.transparent = b.faceMat.transparent = true;
    b.mat.opacity = dim;
    b.faceMat.opacity = dim;
  }

  private syncBot(b: Blk, r: DOMRect, dt: number): void {
    const img = b.el.querySelector<HTMLImageElement>('img[data-bot]');
    if (!img) return;
    if (b.bot === undefined) {
      b.bot = makeFace(img.dataset.bot!);
      if (b.bot) b.group.add(b.bot.root);
      b.key = ''; // 2D 얼굴을 지우고 다시 그린다
    }
    if (!b.bot) return;
    const q = img.getBoundingClientRect();
    const k = q.height / b.bot.height;
    b.bot.root.position.set(q.left + q.width / 2 - (r.left + r.width / 2), -(q.top + q.height / 2 - (r.top + r.height / 2)), b.depth / 2 + 2 + b.bot.back * k);
    b.bot.root.scale.setScalar(k);
    const gaze = { x: clamp((this.mouse.x - (q.left + q.width / 2)) / 300, -1, 1), y: clamp(-(this.mouse.y - (q.top + q.height / 2)) / 300, -1, 1) };
    b.bot.update(dt, b.over ? 1 : 0, gaze);
  }

  /** 버튼 속 이미지·배경 있는 요소·글자를 화면 배치 그대로 캔버스에 */
  private paint(b: Blk, r: DOMRect): void {
    const el = b.el;
    const cs = getComputedStyle(el);
    // 블록 색: CSS 변수 --block 이 있으면 그것, 아니면 버튼 배경색, 투명(ghost)이면 패널색
    const custom = cs.getPropertyValue('--block').trim();
    let bg = cssColor(custom || cs.backgroundColor);
    const ghost = bg.alpha < 0.1;
    if (ghost) bg = cssColor(getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#fff');
    // 몸통 = 같은 색을 어둡게 (밝은 패널색 버튼은 테두리색 쪽으로)
    const edge = new THREE.Color(bg.hex);
    const hsl = { h: 0, s: 0, l: 0 };
    edge.getHSL(hsl);
    // 아주 밝은(패널색) 버튼은 테마의 블록 모서리색(--edge)으로 — 흐리멍덩한 연노랑이 되지 않게
    if (hsl.l > 0.85) edge.set(cssColor(getComputedStyle(document.documentElement).getPropertyValue('--edge').trim() || '#ccc').hex);
    else edge.setHSL(hsl.h, Math.min(1, hsl.s * 1.05), Math.max(0, hsl.l * 0.72));
    b.mat.color.copy(edge);

    const dpr = Math.min(devicePixelRatio || 1, 2);
    const c = b.canvas;
    const cw = Math.max(1, Math.round(r.width * dpr));
    const ch = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== cw || c.height !== ch) {
      c.width = cw;
      c.height = ch;
      // GPU 쪽 텍스처는 처음 크기로 잡혀 있어서, 크기가 바뀌면 새 텍스처로 갈아 끼운다
      b.tex.dispose();
      b.tex = crispTexture(c);
      b.faceMat.map = b.tex;
      b.faceMat.needsUpdate = true;
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    // 윗면은 조명 없이 CSS 색 그대로 (옆면만 조명으로 음영) — 패널색이 회색으로 바래지 않게
    g.beginPath();
    g.roundRect(0, 0, r.width, r.height, Math.min(16, r.height * 0.3, r.width * 0.3));
    g.fillStyle = bg.hex;
    g.fill();
    // 윤곽선: 몸통색으로 얇게 — 밝은 버튼이 배경에 묻히지 않게
    g.lineWidth = 1.5;
    g.strokeStyle = `#${b.mat.color.getHexString()}`;
    g.beginPath();
    g.roundRect(0.75, 0.75, r.width - 1.5, r.height - 1.5, Math.min(16, r.height * 0.3, r.width * 0.3));
    g.stroke();
    // 키보드 포커스 링
    if (el.matches(':focus-visible')) {
      g.lineWidth = 3;
      g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d9643a';
      g.stroke();
    }

    // 배경·테두리가 있는 자식 (힌트 개수 배지, kbd 등)
    el.querySelectorAll<HTMLElement>('*').forEach((ch) => {
      const s = getComputedStyle(ch);
      if (s.display === 'none' || s.visibility === 'hidden') return;
      const q = ch.getBoundingClientRect();
      const fill = cssColor(s.backgroundColor);
      const bw = parseFloat(s.borderTopWidth) || 0;
      if (fill.alpha < 0.05 && !bw) return;
      g.save();
      g.globalAlpha = parseFloat(s.opacity) || 1;
      g.beginPath();
      g.roundRect(q.left - r.left, q.top - r.top, q.width, q.height, parseFloat(s.borderTopLeftRadius) || 0);
      if (fill.alpha >= 0.05) {
        g.fillStyle = s.backgroundColor;
        g.fill();
      }
      if (bw) {
        g.lineWidth = bw;
        g.strokeStyle = s.borderTopColor;
        g.stroke();
      }
      g.restore();
    });

    el.querySelectorAll('img').forEach((img) => {
      if (img.dataset.bot && b.bot) return;
      const q = img.getBoundingClientRect();
      if (img.complete && img.naturalWidth) g.drawImage(img, q.left - r.left, q.top - r.top, q.width, q.height);
      else img.addEventListener('load', () => (b.key = ''), { once: true });
    });

    // 글자: 텍스트 노드별 줄 위치(rect)마다 단어를 채워 넣는다 (줄바꿈된 설명도 그대로)
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.replace(/\s+/g, ' ').trim();
      const parent = n.parentElement;
      if (!text || !parent) continue;
      const s = getComputedStyle(parent);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const lines = [...range.getClientRects()].filter((q) => q.width > 0);
      if (!lines.length) continue;
      g.save();
      g.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      g.fillStyle = s.color;
      g.globalAlpha = parseFloat(s.opacity) || 1;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const words = text.split(' ');
      let wi = 0;
      lines.forEach((q, li) => {
        let line = '';
        while (wi < words.length) {
          const next = line ? `${line} ${words[wi]}` : words[wi];
          if (line && li < lines.length - 1 && g.measureText(next).width > q.width + 2) break;
          line = next;
          wi++;
        }
        g.fillText(line, q.left - r.left + q.width / 2, q.top - r.top + q.height / 2 + 1);
      });
      g.restore();
    }
    b.tex.needsUpdate = true;
  }
}
