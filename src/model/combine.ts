import { midiOf } from './pitch';
import { dropLane, eventTicks, laneOf, setLane, tidyRests } from './score';
import { isRest, type Measure, type NoteEvent } from './types';

const sameTuplet = (a: NoteEvent, b: NoteEvent) =>
  (a.tuplet?.actual ?? 0) === (b.tuplet?.actual ?? 0) && (a.tuplet?.normal ?? 0) === (b.tuplet?.normal ?? 0);

/**
 * Combine voice 2 into voice 1 of staff `s` as chords, the way hymns and choral scores share
 * one stem between soprano and alto (or tenor and bass): wherever a voice 2 note starts with a
 * voice 1 note and has the same length, tuplet and tie, its pitches join voice 1's chord.
 * Notes with a different rhythm stay in voice 2 (stems down); a voice 2 left with only rests
 * is removed. Returns how many notes were combined.
 */
export function combineVoices(measure: Measure, s: number): number {
  const upper = laneOf(measure, s, 0);
  const lower = laneOf(measure, s, 1);
  if (!upper || !lower) return 0;
  const byStart = new Map<number, NoteEvent>();
  let t = 0;
  for (const e of upper) {
    byStart.set(t, e);
    t += eventTicks(e);
  }
  let combined = 0;
  t = 0;
  const left = lower.map((e) => {
    const at = t;
    t += eventTicks(e);
    const a = byStart.get(at);
    if (!a || isRest(a) || isRest(e) || a.type !== e.type || a.dots !== e.dots || !sameTuplet(a, e) || !!a.tie !== !!e.tie) return e;
    for (const p of e.pitches) if (!a.pitches.some((q) => midiOf(q) === midiOf(p))) a.pitches.push({ ...p });
    a.pitches.sort((x, y) => midiOf(x) - midiOf(y));
    // keep what only the lower note had (its syllable, a chord symbol, accents)
    if (!a.lyric && e.lyric) a.lyric = e.lyric;
    if (!a.harmony && e.harmony) a.harmony = e.harmony;
    if (e.articulations?.length) a.articulations = [...new Set([...(a.articulations ?? []), ...e.articulations])];
    combined++;
    const rest: NoteEvent = { id: e.id, pitches: [], type: e.type, dots: e.dots };
    if (e.tuplet) rest.tuplet = { ...e.tuplet };
    return rest;
  });
  if (!combined) return 0;
  if (left.every(isRest)) dropLane(measure, s, 1);
  else setLane(measure, s, 1, tidyRests(left));
  return combined;
}
