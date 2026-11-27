import { fullTimeline } from '../audio/player';
import { TPQ } from '../model/duration';
import { contexts } from '../model/context';
import type { Score } from '../model/types';
import { soundById } from '../audio/sounds';

function vlq(n: number): number[] {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];

const tempoMeta = (bpm: number) => {
  const us = Math.round(60_000_000 / bpm);
  return [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255];
};

/**
 * Standard MIDI File, format 0. Each staff gets its own channel and its sound's GM program;
 * the chord accompaniment (when on) has the next channel. Tempo and time-signature
 * changes are written at the ticks where they happen along the playback.
 */
export function toMidi(score: Score): Uint8Array<ArrayBuffer> {
  const { notes, events, tempos } = fullTimeline(score);
  // channel 10 (index 9) is for drums in General MIDI: drum staves play there, the rest skip it
  const drumStaff = (s: number) => score.staves[s]?.clef === 'percussion';
  const channel = (s: number) => (drumStaff(s) ? 9 : (s >= 9 ? s + 1 : s) & 0x0f);
  const evs: { tick: number; data: number[]; order: number }[] = [];
  for (const t of tempos) evs.push({ tick: t.tick, data: tempoMeta(t.bpm), order: -2 });
  // time signature at the first bar and wherever it changes along the playback
  const ctx = contexts(score);
  let meter = '';
  for (const e of events.filter((ev) => ev.s === 0 && !ev.v && ev.i === 0)) {
    const c = ctx[e.m];
    const sig = `${c.beats}/${c.beatType}`;
    if (sig === meter) continue;
    meter = sig;
    evs.push({ tick: e.tick, data: [0xff, 0x58, 0x04, c.beats, Math.log2(c.beatType), 24, 8], order: -1 });
  }
  for (const n of notes) {
    const ch = channel(n.s);
    const vel = Math.max(1, Math.round(n.velocity * 127));
    evs.push({ tick: n.tick, data: [0x90 | ch, n.midi, vel], order: 1 });
    evs.push({ tick: n.tick + Math.max(1, n.ticks), data: [0x80 | ch, n.midi, 0], order: 0 });
  }
  evs.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const nameBytes = Array.from(new TextEncoder().encode(score.title));
  const track: number[] = [
    0, 0xff, 0x03, ...vlq(nameBytes.length), ...nameBytes,
    ...score.staves.flatMap((st, s) => (drumStaff(s) ? [] : [0, 0xc0 | channel(s), soundById(st.sound).program])),
    ...(score.accompaniment?.enabled
      ? [0, 0xc0 | channel(score.staves.length), soundById(score.accompaniment.sound).program]
      : []),
  ];
  let last = 0;
  for (const e of evs) {
    track.push(...vlq(Math.max(0, e.tick - last)), ...e.data);
    last = Math.max(last, e.tick);
  }
  track.push(0, 0xff, 0x2f, 0x00);

  return new Uint8Array([
    ...[0x4d, 0x54, 0x68, 0x64], ...u32(6), ...u16(0), ...u16(1), ...u16(TPQ),
    ...[0x4d, 0x54, 0x72, 0x6b], ...u32(track.length), ...track,
  ]);
}
