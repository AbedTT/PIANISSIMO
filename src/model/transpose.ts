import { transposeChord } from './harmony';
import { midiOf, spellMidi } from './pitch';
import { allEvents, lanesOf } from './score';
import type { NoteEvent, Score } from './types';

/** Key signature after transposing by `semitones` (each semitone = 7 fifths), kept within ±6 when possible. */
export function transposeKey(fifths: number, semitones: number): number {
  let f = (((fifths + 7 * semitones) % 12) + 12) % 12; // 0..11
  if (f > 6) f -= 12; // prefer -5..6
  // F# (6) vs Gb (-6): follow the direction the original key leaned
  if (f === 6 && fifths < 0) f = -6;
  return f;
}

/** Transpose events in place, spelling in `fifths`; chord symbols follow along. */
export function transposeEvents(events: NoteEvent[], semitones: number, fifths: number) {
  for (const e of events) {
    e.pitches = e.pitches.map((p) => spellMidi(midiOf(p) + semitones, fifths));
    if (e.harmony) e.harmony = transposeChord(e.harmony, semitones, fifths < 0);
  }
}

/** Transpose the whole score to a new key (drum staves stay as they are: their lines are drums, not pitches). */
export function transposeScore(score: Score, semitones: number) {
  if (!semitones) return;
  score.keyFifths = transposeKey(score.keyFifths, semitones);
  const drums = new Set(score.staves.flatMap((st, s) => (st.clef === 'percussion' ? [s] : [])));
  if (!drums.size) return transposeEvents(allEvents(score), semitones, score.keyFifths);
  for (const bar of score.measures) {
    bar.staves.forEach((_, s) => {
      if (drums.has(s)) return;
      for (const { events } of lanesOf(bar, s)) transposeEvents(events, semitones, score.keyFifths);
    });
  }
}

/** Interval names for the transpose dialog. */
export const INTERVALS: { semitones: number; name: string }[] = [
  { semitones: 1, name: 'minor 2nd' },
  { semitones: 2, name: 'major 2nd' },
  { semitones: 3, name: 'minor 3rd' },
  { semitones: 4, name: 'major 3rd' },
  { semitones: 5, name: 'perfect 4th' },
  { semitones: 6, name: 'tritone' },
  { semitones: 7, name: 'perfect 5th' },
  { semitones: 8, name: 'minor 6th' },
  { semitones: 9, name: 'major 6th' },
  { semitones: 10, name: 'minor 7th' },
  { semitones: 11, name: 'major 7th' },
  { semitones: 12, name: 'octave' },
];
