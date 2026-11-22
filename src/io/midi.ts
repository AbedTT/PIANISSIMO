import { fullTimeline } from '../audio/player';
import { TPQ } from '../model/duration';
import type { Score } from '../model/types';
import { soundById } from '../audio/sounds';

function vlq(n: number): number[] {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];

/** Standard MIDI File, format 0. Each staff gets its own channel and its sound's GM program. */
export function toMidi(score: Score): Uint8Array<ArrayBuffer> {
  const secPerTick = 60 / (score.tempo * TPQ);
  const { notes } = fullTimeline(score); // includes the chord accompaniment, if on
  // channel 10 (index 9) is reserved for drums in General MIDI
  const channel = (s: number) => (s >= 9 ? s + 1 : s) & 0x0f;
  const evs: { tick: number; data: number[]; order: number }[] = [];
  for (const n of notes) {
    const ch = channel(n.s);
    const on = Math.round(n.time / secPerTick);
    const off = Math.max(on + 1, Math.round((n.time + n.duration) / secPerTick));
    const vel = Math.max(1, Math.round(n.velocity * 127));
    evs.push({ tick: on, data: [0x90 | ch, n.midi, vel], order: 1 });
    evs.push({ tick: off, data: [0x80 | ch, n.midi, 0], order: 0 });
  }
  evs.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const usPerQuarter = Math.round(60_000_000 / score.tempo);
  const nameBytes = Array.from(new TextEncoder().encode(score.title));
  const track: number[] = [
    0, 0xff, 0x03, ...vlq(nameBytes.length), ...nameBytes,
    0, 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255,
    0, 0xff, 0x58, 0x04, score.timeBeats, Math.log2(score.timeBeatType), 24, 8,
    ...score.staves.flatMap((st, s) => [0, 0xc0 | channel(s), soundById(st.sound).program]),
    ...(score.accompaniment?.enabled
      ? [0, 0xc0 | channel(score.staves.length), soundById(score.accompaniment.sound).program]
      : []),
  ];
  let last = 0;
  for (const e of evs) {
    track.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  track.push(0, 0xff, 0x2f, 0x00);

  return new Uint8Array([
    ...[0x4d, 0x54, 0x68, 0x64], ...u32(6), ...u16(0), ...u16(1), ...u16(TPQ),
    ...[0x4d, 0x54, 0x72, 0x6b], ...u32(track.length), ...track,
  ]);
}
