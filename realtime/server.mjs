// Pianissimo live co-editing service: a small WebSocket relay with no dependencies.
//
//   PIANISSIMO_REALTIME_SECRET=<same secret as the PHP config> node realtime/server.mjs
//
// The PHP API hands signed tickets to signed-in owners and editors of a score
// (POST /scores/{id}/realtime); this service checks the signature, then keeps one room per
// score. Every edit goes through the room in a single order, so all clients end up with the
// same score:
//   - a "bars" edit replaces whole bars by index (most typing, so two people working on
//     different bars never get in each other's way);
//   - a "doc" edit replaces the score (bars added or removed, parts or staves changed).
// The first person in a room is its leader and the only one who saves to the library.
//
// Environment: PORT (default 8090), PIANISSIMO_REALTIME_SECRET (16+ characters),
// ALLOWED_ORIGINS (optional, comma-separated, e.g. https://music.example.com).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8090);
const SECRET = process.env.PIANISSIMO_REALTIME_SECRET ?? '';
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_MESSAGE = 4 * 1024 * 1024;
const MAX_PEERS = 20;
const COLORS = ['#e8590c', '#2f9e44', '#ae3ec9', '#1971c2', '#f08c00', '#c2255c', '#0c8599', '#5c940d'];
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

if (SECRET.length < 16) {
  console.error('Set PIANISSIMO_REALTIME_SECRET (16+ characters), the same value as realtime_secret in the PHP config.');
  process.exit(1);
}

// ------------------------------------------------------------------ tickets
const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** The ticket's claims ({ u, n, s, r, e }) when the signature is good and it has not expired. */
export function verifyTicket(token, secret = SECRET, now = Date.now() / 1000) {
  const [payload, sig] = String(token ?? '').split('.');
  if (!payload || !sig) return null;
  const want = createHmac('sha256', secret).update(payload).digest();
  const got = b64(sig);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const claims = JSON.parse(b64(payload).toString('utf8'));
    if (typeof claims.u !== 'number' || typeof claims.s !== 'number' || !(claims.e > now)) return null;
    return claims;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ WebSocket framing (RFC 6455)
class Connection {
  constructor(socket, onMessage, onClose) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.alive = true;
    this.closed = false;
    this.onMessage = onMessage;
    this.onClose = onClose;
    socket.on('data', (chunk) => this.receive(chunk));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 2) return;
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) return this.close(1009, 'Message too big');
        len = Number(big);
        offset = 10;
      }
      if (!masked) return this.close(1002, 'Client frames must be masked');
      if (len > MAX_MESSAGE) return this.close(1009, 'Message too big');
      if (this.buffer.length < offset + 4 + len) return;
      const mask = this.buffer.subarray(offset, offset + 4);
      const data = Buffer.from(this.buffer.subarray(offset + 4, offset + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buffer = this.buffer.subarray(offset + 4 + len);

      if (opcode === 0x8) return this.close(1000, '');
      if (opcode === 0x9) this.frame(0xa, data); // ping → pong
      else if (opcode === 0xa) this.alive = true;
      else if (opcode === 0x1 || opcode === 0x0 || opcode === 0x2) {
        this.fragments.push(data);
        const total = this.fragments.reduce((a, f) => a + f.length, 0);
        if (total > MAX_MESSAGE) return this.close(1009, 'Message too big');
        if (fin) {
          const text = Buffer.concat(this.fragments).toString('utf8');
          this.fragments = [];
          let msg;
          try {
            msg = JSON.parse(text);
          } catch {
            continue;
          }
          this.onMessage(msg);
        }
      }
    }
  }

  frame(opcode, payload) {
    if (this.closed) return;
    const len = payload.length;
    const head = len < 126 ? Buffer.from([0x80 | opcode, len]) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    if (len >= 126) {
      head[0] = 0x80 | opcode;
      if (len < 65536) {
        head[1] = 126;
        head.writeUInt16BE(len, 2);
      } else {
        head[1] = 127;
        head.writeBigUInt64BE(BigInt(len), 2);
      }
    }
    this.socket.write(Buffer.concat([head, payload]));
  }

  send(msg) {
    this.frame(0x1, Buffer.from(JSON.stringify(msg)));
  }

  close(code, reason) {
    if (this.closed) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this.frame(0x8, body);
    this.socket.end();
    this.finish();
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    this.onClose();
  }
}

// ------------------------------------------------------------------ rooms
/** score id -> { doc, seq, peers: Map<id, peer>, leader } */
const rooms = new Map();
let nextPeer = 1;

function applyOp(doc, op) {
  if (op.k === 'doc') return op.doc;
  const measures = doc.measures.slice();
  for (const [m, bar] of Object.entries(op.bars)) measures[Number(m)] = bar;
  return { ...doc, measures };
}

function validOp(op) {
  if (!op || typeof op !== 'object') return false;
  if (op.k === 'doc') return !!op.doc && op.doc.version === 1 && Array.isArray(op.doc.measures) && Array.isArray(op.doc.staves);
  return op.k === 'bars' && Number.isInteger(op.n) && !!op.bars && typeof op.bars === 'object' && !Array.isArray(op.bars);
}

function broadcast(room, msg, except) {
  for (const p of room.peers.values()) if (p.id !== except) p.conn.send(msg);
}

function join(ticket, conn) {
  let room = rooms.get(ticket.s);
  if (!room) {
    room = { doc: null, seq: 0, peers: new Map(), leader: 0 };
    rooms.set(ticket.s, room);
  }
  if (room.peers.size >= MAX_PEERS) {
    conn.send({ t: 'error', message: 'Too many people are editing this score right now.' });
    return conn.close(1013, 'Room full');
  }
  const used = new Set([...room.peers.values()].map((p) => p.color));
  const peer = {
    id: nextPeer++,
    user: ticket.u,
    name: String(ticket.n ?? '').slice(0, 60),
    color: COLORS.find((c) => !used.has(c)) ?? COLORS[room.peers.size % COLORS.length],
    cursor: null,
    conn,
  };
  room.peers.set(peer.id, peer);
  if (!room.leader) room.leader = peer.id;
  const info = (p) => ({ id: p.id, name: p.name, color: p.color, cursor: p.cursor, user: p.user });
  conn.send({ t: 'welcome', id: peer.id, color: peer.color, seq: room.seq, doc: room.doc, leader: room.leader, peers: [...room.peers.values()].filter((p) => p !== peer).map(info) });
  broadcast(room, { t: 'join', peer: info(peer) }, peer.id);

  conn.onMessage = (msg) => {
    if (msg.t === 'seed') {
      // the first person brings the score as saved in the library
      if (!room.doc && validOp({ k: 'doc', doc: msg.doc })) room.doc = msg.doc;
      else if (room.doc) conn.send({ t: 'resync', seq: room.seq, doc: room.doc });
    } else if (msg.t === 'op') {
      const op = msg.op;
      if (!room.doc || !validOp(op) || (op.k === 'bars' && op.n !== room.doc.measures.length)) {
        // made against a different layout of bars (someone added or removed bars first): refused
        conn.send({ t: 'reject', seq: room.seq });
        return;
      }
      room.doc = applyOp(room.doc, op);
      room.seq++;
      // to everyone, the sender included: for the sender it confirms the order
      broadcast(room, { t: 'op', seq: room.seq, from: peer.id, op });
    } else if (msg.t === 'cursor') {
      const c = msg.c;
      peer.cursor = c && Number.isInteger(c.m) && Number.isInteger(c.s) && Number.isInteger(c.i) ? { m: c.m, s: c.s, i: c.i, v: c.v ? 1 : 0 } : null;
      broadcast(room, { t: 'cursor', id: peer.id, c: peer.cursor }, peer.id);
    } else if (msg.t === 'saved' && peer.id === room.leader && Number.isInteger(msg.revision)) {
      broadcast(room, { t: 'saved', from: peer.id, revision: msg.revision }, peer.id);
    }
  };
  conn.onClose = () => {
    room.peers.delete(peer.id);
    if (!room.peers.size) {
      rooms.delete(ticket.s);
      return;
    }
    broadcast(room, { t: 'leave', id: peer.id });
    if (room.leader === peer.id) {
      room.leader = room.peers.keys().next().value;
      broadcast(room, { t: 'leader', id: room.leader });
    }
  };
}

// ------------------------------------------------------------------ HTTP + upgrade
const server = createServer((req, res) => {
  res.writeHead(req.url === '/health' ? 200 : 426, { 'Content-Type': 'text/plain' });
  res.end(req.url === '/health' ? 'ok\n' : 'Pianissimo realtime: connect with a WebSocket\n');
});

server.on('upgrade', (req, socket) => {
  const reject = (status) => {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  };
  if ((req.headers.upgrade ?? '').toLowerCase() !== 'websocket' || !req.headers['sec-websocket-key']) return reject('400 Bad Request');
  if (ORIGINS.length && !ORIGINS.includes(req.headers.origin ?? '')) return reject('403 Forbidden');
  const ticket = verifyTicket(new URL(req.url ?? '/', 'http://local').searchParams.get('token'));
  if (!ticket) return reject('401 Unauthorized');
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + WS_GUID).digest('base64');
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  const conn = new Connection(socket, () => {}, () => {});
  join(ticket, conn);
});

// drop connections that stopped answering pings
setInterval(() => {
  for (const room of rooms.values()) {
    for (const p of room.peers.values()) {
      if (!p.conn.alive) p.conn.close(1001, 'No answer');
      else {
        p.conn.alive = false;
        p.conn.frame(0x9, Buffer.alloc(0));
      }
    }
  }
}, 30_000).unref();

server.listen(PORT, () => console.log(`Pianissimo realtime on ws://localhost:${PORT}`));
