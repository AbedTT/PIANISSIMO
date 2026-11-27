// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../editor/editor';
import { lane, newScore } from '../model/score';
import type { Score } from '../model/types';
import { applyOp, diffOp, LiveSession, type Op, type Transport } from './live';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

/**
 * The service's rules (realtime/server.mjs) with hand-cranked delivery, so tests can decide
 * exactly when each message arrives and make edits race.
 */
class FakeService {
  doc: Score | null = null;
  seq = 0;
  clients: { id: number; transport: Transport; inbox: unknown[]; outbox: unknown[] }[] = [];
  leader = 0;

  connect(): Transport {
    const id = this.clients.length + 1;
    const client = { id, inbox: [] as unknown[], outbox: [] as unknown[], transport: null as unknown as Transport };
    client.transport = { send: (m) => client.outbox.push(m), close: () => {}, onMessage: () => {}, onClose: () => {} };
    this.clients.push(client);
    if (!this.leader) this.leader = id;
    const others = this.clients.filter((x) => x !== client);
    client.inbox.push({ t: 'welcome', id, color: '#000', seq: this.seq, doc: this.doc, leader: this.leader, peers: others.map((o) => ({ id: o.id, name: `P${o.id}`, color: '#111', user: o.id, cursor: null })) });
    for (const o of others) o.inbox.push({ t: 'join', peer: { id, name: `P${id}`, color: '#222', user: id, cursor: null } });
    return client.transport;
  }

  /** The service handles everything client `id` has sent so far. */
  process(id: number) {
    const c = this.clients.find((x) => x.id === id)!;
    for (const msg of c.outbox.splice(0) as { t: string; op?: Op; doc?: Score }[]) {
      if (msg.t === 'seed' && !this.doc) this.doc = msg.doc!;
      if (msg.t === 'cursor') for (const o of this.clients) if (o !== c) o.inbox.push({ t: 'cursor', id, c: (msg as unknown as { c: unknown }).c });
      if (msg.t !== 'op') continue;
      const op = msg.op!;
      if (!this.doc || (op.k === 'bars' && op.n !== this.doc.measures.length)) {
        c.inbox.push({ t: 'reject', seq: this.seq });
        continue;
      }
      this.doc = applyOp(this.doc, op);
      this.seq++;
      for (const other of this.clients) other.inbox.push({ t: 'op', seq: this.seq, from: id, op });
    }
  }

  /** Client `id` receives what the service sent it. */
  deliver(id: number) {
    const c = this.clients.find((x) => x.id === id)!;
    for (const m of c.inbox.splice(0)) c.transport.onMessage(m);
  }

  settle() {
    for (let k = 0; k < 6; k++) {
      for (const c of this.clients) this.deliver(c.id);
      for (const c of this.clients) this.process(c.id);
    }
  }
}

const steps = (ed: Editor, m: number) => lane(ed.score, m, 0).map((e) => e.pitches[0]?.step ?? '-').join('');

function pair() {
  const start = newScore({ measures: 4, staves: [{ clef: 'treble' }] });
  const svc = new FakeService();
  const a = new Editor(JSON.parse(JSON.stringify(start)));
  const b = new Editor(JSON.parse(JSON.stringify(start)));
  const sa = new LiveSession(a, svc.connect());
  svc.deliver(1);
  svc.process(1); // A seeds the room
  const sb = new LiveSession(b, svc.connect());
  svc.settle();
  return { svc, a, b, sa, sb };
}

describe('diff and apply', () => {
  it('describes typing as bar edits and layout changes as a whole score', () => {
    const ed = new Editor(newScore({ measures: 3, staves: [{ clef: 'treble' }] }));
    const before = JSON.parse(JSON.stringify(ed.score));
    ed.typeLetter('C');
    const op = diffOp(before, ed.score)!;
    expect(op.k).toBe('bars');
    expect(Object.keys((op as { bars: object }).bars)).toEqual(['0']);
    expect(applyOp(before, op)).toEqual(ed.score);
    ed.mutate((s) => s.measures.push(JSON.parse(JSON.stringify(s.measures[2]))));
    expect(diffOp(before, ed.score)!.k).toBe('doc');
    expect(diffOp(ed.score, ed.score)).toBeNull();
  });
});

describe('live co-editing', () => {
  it('the first person is the leader; the second joins the same score', () => {
    const { sa, sb, a, b } = pair();
    expect(sa.leader).toBe(true);
    expect(sb.leader).toBe(false);
    expect(JSON.stringify(b.score)).toBe(JSON.stringify(a.score));
  });

  it('edits to different bars made at the same time both survive', () => {
    const { svc, a, b } = pair();
    a.typeLetter('C'); // bar 1
    b.setCursor({ m: 2, s: 0, i: 0 });
    b.typeLetter('G'); // bar 3, before either hears of the other
    svc.settle();
    expect(steps(a, 0)[0]).toBe('C');
    expect(steps(a, 2)[0]).toBe('G');
    expect(JSON.stringify(a.score)).toBe(JSON.stringify(b.score));
  });

  it('two edits to the same bar: both end with the one the service took last', () => {
    const { svc, a, b } = pair();
    a.typeLetter('C');
    b.typeLetter('E');
    svc.process(1); // A's edit reaches the service first…
    svc.process(2); // …then B's, which wins
    svc.settle();
    expect(steps(a, 0)[0]).toBe('E');
    expect(JSON.stringify(a.score)).toBe(JSON.stringify(b.score));
  });

  it('a bar edit racing a new bar is refused, and everyone agrees afterwards', () => {
    const { svc, a, b } = pair();
    a.mutate((s) => s.measures.push(JSON.parse(JSON.stringify(s.measures[0])))); // 5 bars
    b.setCursor({ m: 1, s: 0, i: 0 });
    b.typeLetter('D'); // made against 4 bars
    svc.process(1);
    svc.process(2);
    svc.settle();
    expect(a.score.measures).toHaveLength(5);
    expect(JSON.stringify(a.score)).toBe(JSON.stringify(b.score));
  });

  it('undo takes back only your own edit', () => {
    const { svc, a, b } = pair();
    a.typeLetter('C');
    svc.settle();
    b.setCursor({ m: 1, s: 0, i: 0 });
    b.typeLetter('A');
    svc.settle();
    expect(steps(a, 1)[0]).toBe('A');
    a.undo(); // A's C goes; B's A stays
    svc.settle();
    expect(steps(a, 0)[0]).toBe('-');
    expect(steps(a, 1)[0]).toBe('A');
    expect(JSON.stringify(a.score)).toBe(JSON.stringify(b.score));
  });

  it('shares cursors and hands over saving when the leader leaves', () => {
    const { svc, sa, sb, b } = pair();
    b.setCursor({ m: 3, s: 0, i: 0 });
    svc.settle();
    expect([...sa.peers.values()][0]?.cursor).toMatchObject({ m: 3, s: 0 });
    const onLeader = vi.fn();
    (sb as unknown as { events: { onLeader: typeof onLeader } }).events.onLeader = onLeader;
    svc.clients[1].transport.onMessage({ t: 'leader', id: sb.id });
    expect(sb.leader).toBe(true);
    expect(onLeader).toHaveBeenCalledWith(true);
  });
});
