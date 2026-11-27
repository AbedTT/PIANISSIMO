import { contexts } from './context';
import { TPQ } from './duration';
import { partsOf, rangeOfStaff } from './parts';
import { midiOf, pitchName } from './pitch';
import { barTicks, eventTicks, lanesOf, laneOf } from './score';
import { isRest, type NoteEvent, type Score } from './types';

/** Something worth a look before printing or sharing. */
export interface Issue {
  kind: 'range' | 'length' | 'tie' | 'slur' | 'line' | 'empty';
  m: number;
  s: number;
  v?: number;
  i?: number;
  message: string;
}

const midiName = (midi: number) => {
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
};

/** The note is outside what the instrument on staff `s` can play (sounding pitch). */
export function outOfRange(score: Score, s: number, e: NoteEvent): string | null {
  const r = rangeOfStaff(score, s);
  if (!r || isRest(e)) return null;
  for (const p of e.pitches) {
    const midi = midiOf(p);
    if (midi < r.lo) return `${pitchName(p)} is too low for ${r.name} (lowest ${midiName(r.lo)})`;
    if (midi > r.hi) return `${pitchName(p)} is too high for ${r.name} (highest ${midiName(r.hi)})`;
  }
  return null;
}

/**
 * Checks a score: notes out of the instrument's range, bars whose notes do not add up to the
 * time signature, ties that lead nowhere, slurs and lines whose end note is gone, and parts
 * without a single note.
 */
export function checkScore(score: Score): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set<string>();
  score.measures.forEach((bar) => bar.staves.forEach((_, s) => lanesOf(bar, s).forEach(({ events }) => events.forEach((e) => ids.add(e.id)))));
  const ctxs = contexts(score);
  /** "1 beat", "1.5 beats" in the bar's own beat (a quarter in 4/4, an eighth in 6/8). */
  const beats = (ticks: number, m: number) => {
    const n = Math.round((ticks / ((4 * TPQ) / ctxs[m].beatType)) * 100) / 100;
    return `${n} ${n === 1 ? 'beat' : 'beats'}`;
  };
  score.measures.forEach((bar, m) => {
    const full = barTicks(score, m);
    bar.staves.forEach((_, s) => {
      for (const { v, events } of lanesOf(bar, s)) {
        const total = events.reduce((a, e) => a + eventTicks(e), 0);
        if (total !== full) {
          issues.push({
            kind: 'length',
            m,
            s,
            v,
            message: `Bar ${m + 1}: the notes add up to ${beats(total, m)}, the bar holds ${beats(full, m)}`,
          });
        }
        events.forEach((e, i) => {
          const range = outOfRange(score, s, e);
          if (range) issues.push({ kind: 'range', m, s, v, i, message: `Bar ${m + 1}: ${range}` });
          if (e.tie && !isRest(e)) {
            const next = events[i + 1] ?? (score.measures[m + 1] && laneOf(score.measures[m + 1], s, v)?.[0]);
            const shared = next && !isRest(next) && e.pitches.some((p) => next.pitches.some((q) => midiOf(q) === midiOf(p)));
            if (!shared) issues.push({ kind: 'tie', m, s, v, i, message: `Bar ${m + 1}: a tie leads to no note of the same pitch` });
          }
          if (e.slurEnd && !ids.has(e.slurEnd)) issues.push({ kind: 'slur', m, s, v, i, message: `Bar ${m + 1}: a slur has lost its last note` });
          for (const sp of e.spans ?? []) {
            if (!ids.has(sp.end)) issues.push({ kind: 'line', m, s, v, i, message: `Bar ${m + 1}: a ${sp.kind === 'cresc' || sp.kind === 'dim' ? 'hairpin' : sp.kind} line has lost its last note` });
          }
        });
      }
    });
  });
  if (score.measures.length) {
    for (const { part, start } of partsOf(score)) {
      if (!score.parts?.length) break; // a score without named parts: nothing to compare
      const staves = Array.from({ length: part.staves }, (_, k) => start + k);
      const any = score.measures.some((bar) => staves.some((s) => lanesOf(bar, s).some(({ events }) => events.some((e) => !isRest(e)))));
      if (!any) issues.push({ kind: 'empty', m: 0, s: start, message: `${part.name || 'A part'} has no notes yet` });
    }
  }
  return issues;
}
