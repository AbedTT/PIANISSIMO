import { contexts } from './context';
import { TPQ } from './duration';
import { chordVoicing } from './harmony';
import { midiOf, spellMidi } from './pitch';
import { barTicks, eventTicks, lane, lanesOf, writeStream, type StreamItem } from './score';
import { isRest, type AccompanimentStyle, type Score } from './types';

const NAMES = (pc: number, fifths: number) => {
  const p = spellMidi(60 + pc, fifths);
  return `${p.step}${p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter)}`;
};

/** The chords of a major key (scale degree, root offset from the tonic, intervals, suffix, how common). */
const DIATONIC: { degree: string; root: number; tones: number[]; suffix: string; prior: number }[] = [
  { degree: 'I', root: 0, tones: [0, 4, 7], suffix: '', prior: 0.3 },
  { degree: 'IV', root: 5, tones: [0, 4, 7], suffix: '', prior: 0.2 },
  { degree: 'V', root: 7, tones: [0, 4, 7], suffix: '', prior: 0.2 },
  { degree: 'vi', root: 9, tones: [0, 3, 7], suffix: 'm', prior: 0.1 },
  { degree: 'ii', root: 2, tones: [0, 3, 7], suffix: 'm', prior: 0.05 },
  { degree: 'iii', root: 4, tones: [0, 3, 7], suffix: 'm', prior: 0 },
  { degree: 'V7', root: 7, tones: [0, 4, 7, 10], suffix: '7', prior: 0.12 },
];

export interface ChordSuggestion {
  symbol: string;
  degree: string;
  /** 0–1: how much of the bar's melody the chord contains */
  fit: number;
}

/**
 * Chords that fit the melody of bar `m` on staff `s`, best first. Each note counts by its
 * length, more on strong beats; notes outside the chord count against it; common chords
 * (I, IV, V) win ties. Built for major keys, as the key signature does not say major or minor.
 */
export function suggestChords(score: Score, m: number, s: number, count = 3): ChordSuggestion[] {
  const ctx = contexts(score)[m];
  const beat = (4 * TPQ) / ctx.beatType;
  const tonic = (((ctx.key * 7) % 12) + 12) % 12;
  const notes: { pc: number; w: number }[] = [];
  let off = 0;
  for (const e of lane(score, m, s)) {
    const len = eventTicks(e);
    if (!isRest(e)) {
      const accent = off === 0 ? 2 : off % beat === 0 ? 1.4 : 1;
      for (const p of e.pitches) notes.push({ pc: ((midiOf(p) % 12) + 12) % 12, w: (len / beat) * accent });
    }
    off += len;
  }
  const total = notes.reduce((a, n) => a + n.w, 0);
  if (!total) return [];
  return DIATONIC.map((c) => {
    const pcs = c.tones.map((t) => (tonic + c.root + t) % 12);
    const inside = notes.reduce((a, n) => a + (pcs.includes(n.pc) ? n.w : 0), 0);
    const fit = inside / total;
    // a seventh chord only when the melody has its seventh
    const seventh = c.tones.length > 3 && !notes.some((n) => n.pc === pcs[3]) ? -0.3 : 0;
    return { symbol: NAMES((tonic + c.root) % 12, ctx.key) + c.suffix, degree: c.degree, fit, rank: fit - (1 - fit) * 0.3 + c.prior * 0.25 + seventh };
  })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, count)
    .map(({ symbol, degree, fit }) => ({ symbol, degree, fit: Math.round(fit * 100) / 100 }));
}

/** Chord symbols in force across the score: per bar, the changes with their tick in the bar. */
function chordMap(score: Score): { tick: number; symbol: string }[][] {
  let current: string | null = null;
  return score.measures.map((bar, m) => {
    const changes = new Map<number, string>();
    bar.staves.forEach((_, s) => {
      let off = 0;
      for (const e of lane(score, m, s)) {
        if (e.harmony && !changes.has(off)) changes.set(off, e.harmony);
        off += eventTicks(e);
      }
    });
    const list = [...changes.entries()].sort((a, b) => a[0] - b[0]).map(([tick, symbol]) => ({ tick, symbol }));
    if (current && (!list.length || list[0].tick > 0)) list.unshift({ tick: 0, symbol: current });
    if (list.length) current = list[list.length - 1].symbol;
    return list;
  });
}

/**
 * Write a left-hand piano part from the chord symbols into staff `s`, as ordinary notes you
 * can edit: only bars that are empty on that staff are filled. Patterns follow the
 * accompaniment styles: block chords, bass + chords (pop, waltz, strum) or broken chords.
 * Returns the number of bars written.
 */
export function fillLeftHand(score: Score, s: number, style: AccompanimentStyle = 'pop'): number {
  const chords = chordMap(score);
  const ctxs = contexts(score);
  let written = 0;
  score.measures.forEach((bar, m) => {
    const segs = chords[m];
    if (!segs.length) return;
    const lanes = lanesOf(bar, s).map((l) => l.events);
    if (!lanes.every((l) => l.every(isRest))) return; // keep what is already written
    const full = barTicks(score, m);
    const beat = (4 * TPQ) / ctxs[m].beatType;
    const key = ctxs[m].key;
    const items: StreamItem[] = [];
    segs.forEach((seg, k) => {
      const end = segs[k + 1]?.tick ?? full;
      const len = end - seg.tick;
      const v = chordVoicing(seg.symbol);
      if (!v || len <= 0) {
        items.push({ pitches: [], ticks: Math.max(0, len) });
        return;
      }
      // bass from E2 up; the chord in close position from C3 up (a comfortable left hand)
      const bass = v.bass < 40 ? v.bass + 12 : v.bass;
      const pcs = [...new Set(v.tones.map((t) => t % 12))].slice(0, 4);
      const triad = pcs.map((pc) => 48 + ((pc - 48 + 120) % 12)).sort((a, b) => a - b);
      const P = (midis: number[]) => midis.map((x) => spellMidi(x, key));
      const pulse = (n: number, make: (i: number) => number[]) => {
        let left = len;
        for (let i = 0; left > 0; i++) {
          const t = Math.min(n, left);
          items.push({ pitches: P(make(i)), ticks: t });
          left -= t;
        }
      };
      if (style === 'block') items.push({ pitches: P([bass, ...triad]), ticks: len });
      else if (style === 'arpeggio') {
        const notes = [bass, ...triad, ...triad.slice(1, -1).reverse()];
        pulse(beat / 2, (i) => [notes[i % notes.length]]);
      } else if (style === 'strum') pulse(beat, (i) => (i === 0 ? [bass, ...triad] : triad));
      else pulse(beat, (i) => (i === 0 || (style === 'pop' && i === 2 && len >= 4 * beat) ? [bass] : triad));
    });
    writeStream(score, s, items, m);
    written++;
  });
  return written;
}
