import Peer, { type DataConnection } from 'peerjs';
import type { Msg } from './Protocol';

/**
 * PeerJS 방코드 매칭, 호스트 중계 스타형. surreal-derby 의 Net.ts 에서 빠른 채널·적응 전송을 뺀 축소판
 * (스도쿠는 초당 몇 개 안 되는 이벤트뿐이라 신뢰 채널 하나면 된다).
 */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREFIX = 'sudoku-duel-';

/** 단기 TURN 자격증명 발급 엔드포인트 (Cloudflare Worker). 실패하면 STUN 만 */
const TURN_ENDPOINT = 'https://the-fighting-turn.77hdumat.workers.dev/turn';

export function makeCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export type NetError = { type: string; detail?: unknown };

interface Guest {
  c: DataConnection;
  lastRx: number;
}

export class Net {
  role: 'none' | 'host' | 'client' = 'none';
  code = '';
  private peer: Peer | null = null;
  private guests = new Map<number, Guest>();
  private nextId = 1;
  private conn: DataConnection | null = null;
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  onMessage: ((m: Msg, from: number) => void) | null = null;
  onJoin: ((id: number) => void) | null = null;
  onLeave: ((id: number) => void) | null = null;
  onOpen: ((code: string) => void) | null = null;
  onError: ((e: NetError) => void) | null = null;

  static HB_INTERVAL = 1000;
  static HB_TIMEOUT = 8000;
  static JOIN_TIMEOUT = 12000;

  private static turn: Promise<RTCIceServer[]> | null = null;

  private static iceServers(): Promise<RTCIceServer[]> {
    const stun: RTCIceServer = { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] };
    Net.turn ??= fetch(TURN_ENDPOINT, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { iceServers?: RTCIceServer[] }) => (j?.iceServers ?? []).filter((s) => s && s.urls))
      .catch(() => []);
    return Net.turn.then((t) => [stun, ...t]);
  }

  private async mkPeer(id?: string): Promise<Peer> {
    const iceServers = await Net.iceServers();
    const peer = new Peer(id as string, { debug: 1, config: { iceServers } });
    // 시그널링 서버만 끊긴 경우(잠자기·망 전환) 이미 맺은 P2P 는 살아 있으니 재접속만
    peer.on('disconnected', () => {
      setTimeout(() => {
        if (!peer.destroyed && peer.disconnected && !this.closed) {
          try {
            peer.reconnect();
          } catch {
            /* ignore */
          }
        }
      }, 1200);
    });
    return peer;
  }

  async host(maxGuests = 7): Promise<void> {
    this.role = 'host';
    this.code = makeCode();
    const peer = await this.mkPeer(PREFIX + this.code);
    if (this.closed) return peer.destroy();
    this.peer = peer;
    let opened = false;
    peer.on('open', () => {
      if (opened) return;
      opened = true;
      this.onOpen?.(this.code);
    });
    peer.on('error', (e) => {
      const type = (e as { type?: string }).type ?? 'error';
      if (type === 'unavailable-id' && !opened) {
        peer.destroy();
        void this.host(maxGuests);
        return;
      }
      this.onError?.({ type, detail: e });
    });
    peer.on('connection', (c) => {
      if (this.guests.size >= maxGuests) {
        c.on('open', () => {
          c.send({ t: 'full', why: 'slots' } satisfies Msg);
          setTimeout(() => c.close(), 300);
        });
        return;
      }
      const id = this.nextId++;
      const g: Guest = { c, lastRx: performance.now() };
      c.on('open', () => {
        this.guests.set(id, g);
        c.send({ t: 'welcome', id } satisfies Msg);
        this.onJoin?.(id);
      });
      c.on('data', (raw) => {
        const m = raw as Msg;
        g.lastRx = performance.now();
        if (!m || typeof m !== 'object') return;
        if (m.t === 'hb') {
          try {
            c.send(m);
          } catch {
            /* ignore */
          }
          return;
        }
        this.onMessage?.(m, id);
      });
      const gone = () => {
        if (this.guests.get(id) !== g) return;
        this.guests.delete(id);
        this.onLeave?.(id);
      };
      c.on('close', gone);
      c.on('error', gone);
    });
    // 창을 그냥 닫으면 WebRTC 가 늦게 알아채므로 하트비트로 정리
    this.hbTimer = setInterval(() => {
      const now = performance.now();
      for (const [id, g] of this.guests) {
        if (now - g.lastRx > Net.HB_TIMEOUT) {
          this.kick(id);
          this.guests.delete(id);
          this.onLeave?.(id);
        }
      }
    }, 2000);
  }

  async join(code: string): Promise<void> {
    this.role = 'client';
    this.code = code.toUpperCase().trim();
    const peer = await this.mkPeer();
    if (this.closed) return peer.destroy();
    this.peer = peer;
    let opened = false;
    const joinT = setTimeout(() => {
      if (!opened) this.onError?.({ type: 'timeout' });
    }, Net.JOIN_TIMEOUT);
    peer.on('error', (e) => this.onError?.({ type: (e as { type?: string }).type ?? 'error', detail: e }));
    peer.on('open', () => {
      const c = peer.connect(PREFIX + this.code, { serialization: 'json', reliable: true });
      this.conn = c;
      let lastRx = performance.now();
      c.on('open', () => {
        opened = true;
        clearTimeout(joinT);
        lastRx = performance.now();
        this.hbTimer = setInterval(() => {
          if (!c.open) return;
          try {
            c.send({ t: 'hb', t0: performance.now() } satisfies Msg);
          } catch {
            /* ignore */
          }
          if (performance.now() - lastRx > Net.HB_TIMEOUT) c.close();
        }, Net.HB_INTERVAL);
        this.onOpen?.(this.code);
      });
      c.on('data', (raw) => {
        const m = raw as Msg;
        lastRx = performance.now();
        if (!m || typeof m !== 'object' || m.t === 'hb') return;
        this.onMessage?.(m, 0);
      });
      c.on('close', () => {
        if (!this.closed) this.onError?.({ type: 'closed' });
      });
    });
  }

  /** client → host */
  send(msg: Msg): void {
    if (this.conn?.open) {
      try {
        this.conn.send(msg);
      } catch {
        /* ignore */
      }
    }
  }

  /** host → 게스트 전원 */
  broadcast(msg: Msg): void {
    for (const id of this.guests.keys()) this.sendTo(id, msg);
  }

  /** host → 특정 게스트 */
  sendTo(id: number, msg: Msg): void {
    const g = this.guests.get(id);
    if (!g?.c.open) return;
    try {
      g.c.send(msg);
    } catch {
      /* ignore */
    }
  }

  kick(id: number): void {
    const g = this.guests.get(id);
    if (g) setTimeout(() => g.c.close(), 300);
  }

  close(): void {
    this.closed = true;
    if (this.hbTimer) clearInterval(this.hbTimer);
    this.conn?.close();
    for (const g of this.guests.values()) g.c.close();
    this.guests.clear();
    this.peer?.destroy();
    this.peer = null;
  }
}
