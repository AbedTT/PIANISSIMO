import type { Editor } from '../editor/editor';
import type { Measure, Score } from '../model/types';

/**
 * Live co-editing client. The realtime service (realtime/server.mjs) puts every edit into one
 * order. This client keeps:
 *   - `base`: the score as of the last edit the service confirmed, and
 *   - `pending`: our own edits, sent but not yet confirmed.
 * What the editor shows is always `base` with `pending` applied on top. A remote edit moves
 * `base` forward, and the pending edits are applied again on top of it, so every client ends
 * up with the score the service has. Edits replace whole bars (two people on different bars
 * never collide); adding or removing bars, or changing staves or parts, replaces the whole score.
 */
export type Op = { k: 'bars'; bars: Record<number, Measure>; n: number } | { k: 'doc'; doc: Score };

export interface Peer {
  id: number;
  name: string;
  color: string;
  user: number;
  cursor: { m: number; s: number; i: number; v?: number } | null;
}

/** Messages from the service (see realtime/server.mjs). */
type ServerMsg =
  | { t: 'welcome'; id: number; color: string; seq: number; doc: Score | null; leader: number; peers: Peer[] }
  | { t: 'op'; seq: number; from: number; op: Op }
  | { t: 'reject'; seq: number }
  | { t: 'resync'; seq: number; doc: Score }
  | { t: 'join'; peer: Peer }
  | { t: 'leave'; id: number }
  | { t: 'leader'; id: number }
  | { t: 'cursor'; id: number; c: Peer['cursor'] }
  | { t: 'saved'; from: number; revision: number }
  | { t: 'error'; message: string };

export interface Transport {
  send(msg: unknown): void;
  close(): void;
  onMessage: (msg: unknown) => void;
  onClose: () => void;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const headerOf = (s: Score) => JSON.stringify({ ...s, measures: undefined });

/** The edit that turns `from` into `to`, or null when they are the same. */
export function diffOp(from: Score, to: Score): Op | null {
  if (from.measures.length !== to.measures.length || headerOf(from) !== headerOf(to)) return { k: 'doc', doc: clone(to) };
  const bars: Record<number, Measure> = {};
  let any = false;
  to.measures.forEach((bar, m) => {
    if (JSON.stringify(bar) !== JSON.stringify(from.measures[m])) {
      bars[m] = clone(bar);
      any = true;
    }
  });
  return any ? { k: 'bars', bars, n: to.measures.length } : null;
}

/** Apply an edit (a new score; the input is not changed). A bar edit made for another number of bars does nothing. */
export function applyOp(score: Score, op: Op): Score {
  if (op.k === 'doc') return clone(op.doc);
  if (op.n !== score.measures.length) return score;
  const measures = score.measures.slice();
  for (const [m, bar] of Object.entries(op.bars)) measures[Number(m)] = clone(bar);
  return { ...score, measures };
}

export interface LiveEvents {
  /** The people in the room (not counting us) changed, or their cursors moved. */
  onPeers?: (peers: Peer[]) => void;
  /** We became (or stopped being) the one who saves to the library. */
  onLeader?: (leader: boolean) => void;
  /** The leader saved: our copy matches revision `revision` in the library. */
  onSaved?: (revision: number) => void;
  /** Connected, or the connection was lost. */
  onStatus?: (connected: boolean) => void;
  /** A collaborator changed the score's layout, so local undo history was reset. */
  onHistoryReset?: () => void;
}

export class LiveSession {
  id = 0;
  color = '';
  peers = new Map<number, Peer>();
  leader = false;
  connected = false;
  private base: Score | null = null;
  private pending: Op[] = [];
  private applyingRemote = false;
  private unsubscribe: () => void;
  private lastCursor = '';

  constructor(
    private editor: Editor,
    private transport: Transport,
    private events: LiveEvents = {},
  ) {
    transport.onMessage = (m) => this.receive(m as ServerMsg);
    transport.onClose = () => {
      this.connected = false;
      this.events.onStatus?.(false);
    };
    this.unsubscribe = editor.subscribe((kind) => {
      if (kind === 'score' && !this.applyingRemote) this.localChange();
      if (kind !== 'score' || !this.applyingRemote) this.sendCursor();
    });
  }

  close() {
    this.unsubscribe();
    this.transport.close();
    this.connected = false;
  }

  /** Our view of the score the service agreed on, plus our unconfirmed edits. */
  private expected(): Score {
    return this.pending.reduce(applyOp, this.base!);
  }

  private localChange() {
    if (!this.base || !this.connected) return;
    const op = diffOp(this.expected(), this.editor.score);
    if (!op) return;
    this.pending.push(op);
    this.transport.send({ t: 'op', op });
  }

  private sendCursor() {
    if (!this.connected) return;
    const c = this.editor.cursor;
    const key = `${c.m}:${c.s}:${c.i}:${this.editor.voice}`;
    if (key === this.lastCursor) return;
    this.lastCursor = key;
    this.transport.send({ t: 'cursor', c: { m: c.m, s: c.s, i: c.i, v: this.editor.voice } });
  }

  /** The leader tells the others which library revision now holds the shared score. */
  saved(revision: number) {
    if (this.connected && this.leader) this.transport.send({ t: 'saved', revision });
  }

  /** Show `next` in the editor without it counting as our own edit. */
  private show(next: Score, op: Op | null) {
    if (JSON.stringify(next) === JSON.stringify(this.editor.score)) return;
    this.applyingRemote = true;
    try {
      // the editor edits its score in place: it must never share an object with base
      const kept = this.editor.applyRemote(clone(next), op && op.k === 'bars' ? (s: Score) => applyOp(s, op) : null);
      if (!kept) this.events.onHistoryReset?.();
    } finally {
      this.applyingRemote = false;
    }
  }

  private receive(msg: ServerMsg) {
    switch (msg.t) {
      case 'welcome': {
        this.id = msg.id;
        this.color = msg.color;
        this.connected = true;
        this.peers = new Map(msg.peers.map((p) => [p.id, p]));
        this.setLeader(msg.leader === this.id);
        this.pending = [];
        if (msg.doc) {
          // join the session in progress: its score wins, our local edits since the last save
          // (if any) go on top as one edit
          this.base = msg.doc;
          const mine = diffOp(msg.doc, this.editor.score);
          this.show(msg.doc, null);
          if (mine && mine.k === 'bars') {
            this.show(applyOp(msg.doc, mine), null);
            this.pending.push(mine);
            this.transport.send({ t: 'op', op: mine });
          }
        } else {
          this.base = clone(this.editor.score);
          this.transport.send({ t: 'seed', doc: this.base });
        }
        this.events.onStatus?.(true);
        this.events.onPeers?.([...this.peers.values()]);
        this.lastCursor = '';
        this.sendCursor();
        break;
      }
      case 'resync':
        this.base = msg.doc;
        this.pending = [];
        this.show(msg.doc, null);
        break;
      case 'op':
        if (!this.base) return;
        this.base = applyOp(this.base, msg.op);
        if (msg.from === this.id) {
          this.pending.shift(); // confirmed: it is now part of base
        } else {
          this.show(this.expected(), msg.op);
        }
        break;
      case 'reject':
        // our oldest edit was made against bars that no longer exist: drop it
        this.pending.shift();
        if (this.base) this.show(this.expected(), null);
        break;
      case 'join':
        this.peers.set(msg.peer.id, msg.peer);
        this.events.onPeers?.([...this.peers.values()]);
        break;
      case 'leave':
        this.peers.delete(msg.id);
        this.events.onPeers?.([...this.peers.values()]);
        break;
      case 'leader':
        this.setLeader(msg.id === this.id);
        break;
      case 'cursor': {
        const p = this.peers.get(msg.id);
        if (p) {
          p.cursor = msg.c;
          this.events.onPeers?.([...this.peers.values()]);
        }
        break;
      }
      case 'saved':
        this.events.onSaved?.(msg.revision);
        break;
    }
  }

  private setLeader(leader: boolean) {
    if (leader === this.leader) return;
    this.leader = leader;
    this.events.onLeader?.(leader);
  }
}

/** A Transport over a browser WebSocket. */
export function webSocketTransport(url: string, token: string): Transport {
  const ws = new WebSocket(`${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`);
  const queue: string[] = [];
  const t: Transport = {
    send(msg) {
      const text = JSON.stringify(msg);
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
      else queue.push(text);
    },
    close() {
      ws.close();
    },
    onMessage: () => {},
    onClose: () => {},
  };
  ws.onopen = () => {
    for (const m of queue.splice(0)) ws.send(m);
  };
  ws.onmessage = (e) => {
    try {
      t.onMessage(JSON.parse(String(e.data)));
    } catch {
      /* ignore a malformed message */
    }
  };
  ws.onclose = () => t.onClose();
  return t;
}
