import type { Score } from '../model/types';
import { timeline, type TimedEvent } from './player';

/** One chord to play in wait mode, with what the other parts sound at the same moment. */
export interface PracticeStep {
  /** The event the cursor shows (first of the practised staves at this moment). */
  event: TimedEvent;
  /** MIDI notes the player must play, sorted. */
  expected: number[];
  /** Notes of the other parts that start together with it (played as accompaniment). */
  others: { midi: number; s: number }[];
}

export type PracticeResult = 'right' | 'wrong' | 'done';

/**
 * Wait mode: playback steps through the chosen part one chord at a time and waits until the
 * right notes are played on a MIDI keyboard. Repeats, endings and jumps are followed in order,
 * tied notes are not asked for again, and rests are skipped.
 */
export class WaitPractice {
  readonly steps: PracticeStep[];
  index = 0;
  /** Wrong attempts so far (for the summary at the end). */
  misses = 0;

  constructor(score: Score, staves: number[]) {
    const { notes, events } = timeline(score);
    const mine = new Set(staves);
    const key = (t: number) => Math.round(t * 1000); // group by start time (ms)
    const byTime = new Map<number, { expected: Set<number>; others: { midi: number; s: number }[]; event?: TimedEvent }>();
    const at = (t: number) => {
      const k = key(t);
      if (!byTime.has(k)) byTime.set(k, { expected: new Set(), others: [] });
      return byTime.get(k)!;
    };
    for (const n of notes) {
      if (n.s >= score.staves.length) continue; // chord accompaniment
      if (mine.has(n.s)) at(n.time).expected.add(n.midi);
      else at(n.time).others.push({ midi: n.midi, s: n.s });
    }
    for (const e of events) {
      if (!mine.has(e.s)) continue;
      const slot = byTime.get(key(e.time));
      if (slot && !slot.event) slot.event = e;
    }
    this.steps = [...byTime.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, v]) => v.expected.size && v.event)
      .map(([, v]) => ({ event: v.event!, expected: [...v.expected].sort((a, b) => a - b), others: v.others }));
  }

  get current(): PracticeStep | undefined {
    return this.steps[this.index];
  }

  get done() {
    return this.index >= this.steps.length;
  }

  /**
   * Check a played chord against the current step; moves on when it is right.
   * `loose` is for one voice into a microphone: the top note of the chord, in any octave
   * (people sing where their voice is).
   */
  play(midis: number[], loose = false): PracticeResult {
    const step = this.current;
    if (!step) return 'done';
    const played = [...new Set(midis)].sort((a, b) => a - b);
    const pc = (m: number) => ((m % 12) + 12) % 12;
    const right = loose
      ? played.length === 1 && pc(played[0]) === pc(step.expected[step.expected.length - 1])
      : played.length === step.expected.length && played.every((m, k) => m === step.expected[k]);
    if (!right) {
      this.misses++;
      return 'wrong';
    }
    this.index++;
    return this.done ? 'done' : 'right';
  }
}
