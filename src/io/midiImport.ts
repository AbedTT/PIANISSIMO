import { soundById, soundForProgram } from '../audio/sounds';
import { TPQ } from '../model/duration';
import { spellMidi } from '../model/pitch';
import { newScore, refitMeasures, writeStream, type StreamItem } from '../model/score';
import type { Clef, Part, Score } from '../model/types';

/** A played note in Pianissimo ticks (480 per quarter). */
export interface RawNote {
  start: number;
  end: number;
  midi: number;
  velocity: number;
}

interface Track {
  name: string;
  channel: number;
  program: number;
  notes: RawNote[];
}

interface MidiFile {
  tracks: Track[];
  bpm: number;
  beats: number;
  beatType: number;
  key: number;
}

// ------------------------------------------------------------------ reading the file

/** Parse a Standard MIDI File (format 0 or 1, metrical time). Notes come back in Pianissimo ticks. */
export function parseMidi(bytes: Uint8Array): MidiFile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (p: number, n: number) => String.fromCharCode(...bytes.subarray(p, p + n));
  if (str(0, 4) !== 'MThd') throw new Error('Not a MIDI file.');
  const headerLen = view.getUint32(4);
  const trackCount = view.getUint16(10);
  const division = view.getUint16(12);
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported.');
  const scale = TPQ / division;

  const out: MidiFile = { tracks: [], bpm: 120, beats: 4, beatType: 4, key: 0 };
  let tempoSet = false;
  let meterSet = false;
  let p = 8 + headerLen;
  for (let t = 0; t < trackCount && p < bytes.length; t++) {
    if (str(p, 4) !== 'MTrk') break;
    const len = view.getUint32(p + 4);
    const end = p + 8 + len;
    let q = p + 8;
    let tick = 0;
    let status = 0;
    let name = '';
    const programs = new Map<number, number>();
    const open = new Map<string, { start: number; velocity: number }[]>(); // `${ch}:${note}` -> stack
    const byChannel = new Map<number, RawNote[]>();
    const vlq = () => {
      let v = 0;
      let b: number;
      do {
        b = bytes[q++];
        v = (v << 7) | (b & 0x7f);
      } while (b & 0x80 && q < end);
      return v;
    };
    while (q < end) {
      tick += vlq();
      let b = bytes[q];
      if (b & 0x80) {
        status = b;
        q++;
      } else if (!status) break; // corrupt: running status without a status byte
      b = status;
      if (b === 0xff) {
        const type = bytes[q++];
        const n = vlq();
        const data = bytes.subarray(q, q + n);
        if (type === 0x03 && !name) name = new TextDecoder().decode(data).trim();
        if (type === 0x51 && !tempoSet && n === 3) {
          out.bpm = Math.round(60_000_000 / ((data[0] << 16) | (data[1] << 8) | data[2]));
          tempoSet = true;
        }
        if (type === 0x58 && !meterSet && n >= 2) {
          out.beats = data[0];
          out.beatType = 2 ** data[1];
          meterSet = true;
        }
        if (type === 0x59 && n >= 1) out.key = Math.max(-7, Math.min(7, (data[0] << 24) >> 24));
        q += n;
        status = 0; // meta events cancel running status
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        q += vlq();
        status = 0;
        continue;
      }
      const kind = b & 0xf0;
      const ch = b & 0x0f;
      const d1 = bytes[q++];
      const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[q++];
      const at = Math.round(tick * scale);
      if (kind === 0xc0) programs.set(ch, d1);
      else if (kind === 0x90 && d2 > 0) {
        const key = `${ch}:${d1}`;
        if (!open.has(key)) open.set(key, []);
        open.get(key)!.push({ start: at, velocity: d2 });
      } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
        const started = open.get(`${ch}:${d1}`)?.shift();
        if (started && at > started.start) {
          if (!byChannel.has(ch)) byChannel.set(ch, []);
          byChannel.get(ch)!.push({ start: started.start, end: at, midi: d1, velocity: started.velocity / 127 });
        }
      }
    }
    // one Pianissimo track per channel that has notes (format 0 files mix channels in one track)
    for (const [ch, notes] of byChannel) {
      if (ch === 9) continue; // General MIDI drums: no percussion staff yet
      out.tracks.push({ name, channel: ch, program: programs.get(ch) ?? 0, notes: notes.sort((a, b) => a.start - b.start) });
    }
    p = end;
  }
  return out;
}

// ------------------------------------------------------------------ quantising

const STRAIGHT = TPQ / 4; // 16th notes
const TRIPLET = TPQ / 3; // triplet eighths

/** Snap a time to the 16th or triplet-8th grid, whichever suits that beat's notes better. */
function quantizer(onsets: number[]) {
  const choice = new Map<number, number>(); // beat -> grid
  const byBeat = new Map<number, number[]>();
  for (const t of onsets) {
    const beat = Math.floor(t / TPQ);
    if (!byBeat.has(beat)) byBeat.set(beat, []);
    byBeat.get(beat)!.push(t);
  }
  for (const [beat, ts] of byBeat) {
    const err = (grid: number) =>
      ts.reduce((a, t) => {
        const off = t - beat * TPQ;
        return a + Math.abs(off - Math.round(off / grid) * grid);
      }, 0);
    // prefer straight time unless triplets fit clearly better
    choice.set(beat, err(TRIPLET) < err(STRAIGHT) * 0.6 ? TRIPLET : STRAIGHT);
  }
  return (t: number) => {
    const beat = Math.floor(t / TPQ);
    const grid = choice.get(beat) ?? STRAIGHT;
    return beat * TPQ + Math.round((t - beat * TPQ) / grid) * grid;
  };
}

/** Turn played notes into a chord/rest stream for one staff, quantised. */
export function notesToStream(notes: RawNote[], key: number, origin = 0): StreamItem[] {
  if (!notes.length) return [];
  const q = quantizer(notes.map((n) => n.start - origin));
  const chords = new Map<number, { midis: Set<number>; end: number }>();
  for (const n of notes) {
    const start = Math.max(0, q(n.start - origin));
    const end = Math.max(start + STRAIGHT, q(n.end - origin));
    const c = chords.get(start) ?? { midis: new Set<number>(), end: 0 };
    c.midis.add(n.midi);
    c.end = Math.max(c.end, end);
    chords.set(start, c);
  }
  const starts = [...chords.keys()].sort((a, b) => a - b);
  const items: StreamItem[] = [];
  let pos = 0;
  starts.forEach((start, k) => {
    if (start > pos) items.push({ pitches: [], ticks: start - pos }); // rest before
    const c = chords.get(start)!;
    const next = starts[k + 1] ?? Infinity;
    const end = Math.min(c.end, next); // a note still sounding is cut at the next onset
    items.push({ pitches: [...c.midis].sort((a, b) => a - b).map((m) => spellMidi(m, key)), ticks: end - start });
    pos = end;
  });
  return items;
}

// ------------------------------------------------------------------ building the score

/** A whole MIDI file as a score: one part per track/channel, piano-range tracks on a grand staff. */
export function midiToScore(bytes: Uint8Array, title = 'Imported MIDI'): Score {
  const file = parseMidi(bytes);
  if (!file.tracks.length) throw new Error('This MIDI file has no notes (drum-only files are not supported yet).');

  interface Plan {
    part: Part;
    staves: { clef: Clef; notes: RawNote[] }[];
    sound: string;
  }
  const plans: Plan[] = file.tracks.map((t) => {
    const sound = soundForProgram(t.program);
    const lo = Math.min(...t.notes.map((n) => n.midi));
    const hi = Math.max(...t.notes.map((n) => n.midi));
    const name = t.name || soundById(sound).name;
    if (lo < 55 && hi > 64) {
      // wide range: grand staff split at middle C
      return {
        part: { name, short: '', staves: 2 },
        staves: [
          { clef: 'treble', notes: t.notes.filter((n) => n.midi >= 60) },
          { clef: 'bass', notes: t.notes.filter((n) => n.midi < 60) },
        ],
        sound,
      };
    }
    const sorted = t.notes.map((n) => n.midi).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return { part: { name, short: '', staves: 1 }, staves: [{ clef: median < 57 ? 'bass' : 'treble', notes: t.notes }], sound };
  });

  const score = newScore({
    title,
    tempo: Math.max(20, Math.min(300, file.bpm)),
    keyFifths: file.key,
    timeBeats: file.beats,
    timeBeatType: file.beatType,
    measures: 1,
    staves: plans.flatMap((p) => p.staves.map((st) => ({ clef: st.clef, sound: p.sound }))),
  });
  if (plans.length > 1) score.parts = plans.map((p) => p.part);
  let s = 0;
  for (const plan of plans) {
    for (const st of plan.staves) {
      writeStream(score, s, notesToStream(st.notes, file.key));
      s++;
    }
  }
  refitMeasures(score); // every staff of every bar adds up (pads any lane left short)
  return score;
}
