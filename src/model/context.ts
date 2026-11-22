import { measureTicks } from './duration';
import type { Clef, Score } from './types';

/** What is in effect at a bar: the score's starting values plus every change up to that bar. */
export interface BarContext {
  key: number;
  beats: number;
  beatType: number;
  clefs: Clef[];
  tempo: number;
  /** ticks in one bar */
  ticks: number;
  /** absolute tick where the bar starts (score order, ignoring repeats) */
  start: number;
}

/** Contexts for every bar, computed in one pass. */
export function contexts(score: Score): BarContext[] {
  const out: BarContext[] = [];
  let key = score.keyFifths;
  let beats = score.timeBeats;
  let beatType = score.timeBeatType;
  let clefs = score.staves.map((s) => s.clef);
  let tempo = score.tempo;
  let start = 0;
  for (const bar of score.measures) {
    if (bar.key !== undefined) key = bar.key;
    if (bar.time) ({ beats, beatType } = bar.time);
    if (bar.clefs) clefs = clefs.map((c, s) => bar.clefs![s] ?? c);
    if (bar.tempo) tempo = bar.tempo.bpm;
    const ticks = measureTicks(beats, beatType);
    out.push({ key, beats, beatType, clefs: [...clefs], tempo, ticks, start });
    start += ticks;
  }
  return out;
}

/** Context at one bar (bars beyond the end use the last bar's context). */
export function contextAt(score: Score, m: number): BarContext {
  const all = contexts(score);
  if (!all.length) {
    return {
      key: score.keyFifths,
      beats: score.timeBeats,
      beatType: score.timeBeatType,
      clefs: score.staves.map((s) => s.clef),
      tempo: score.tempo,
      ticks: measureTicks(score.timeBeats, score.timeBeatType),
      start: 0,
    };
  }
  return all[Math.max(0, Math.min(m, all.length - 1))];
}

/** Bar containing an absolute tick (score order). */
export function measureAtTick(score: Score, tick: number): number {
  const all = contexts(score);
  for (let m = all.length - 1; m >= 0; m--) if (tick >= all[m].start) return m;
  return 0;
}
