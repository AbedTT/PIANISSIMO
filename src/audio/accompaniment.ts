import { chordVoicing } from '../model/harmony';
import { allEvents } from '../model/score';
import type { AccompanimentStyle, Score } from '../model/types';
import { TPQ } from '../model/duration';
import { contexts } from '../model/context';
import type { TempoChange, TimedEvent, TimedNote } from './player';

export const STYLES: { id: AccompanimentStyle; name: string }[] = [
  { id: 'block', name: 'Block chords (held)' },
  { id: 'pop', name: 'Pop (bass + chord on every beat)' },
  { id: 'arpeggio', name: 'Broken chords (arpeggio)' },
  { id: 'waltz', name: 'Waltz (oom-pah-pah)' },
  { id: 'strum', name: 'Guitar strum' },
];

const EPS = 1e-4;

/**
 * Backing notes generated from the chord symbols. Each chord lasts until the next
 * chord symbol (on any staff) and is re-struck according to the style on the beats
 * of every bar it covers. Times follow the playback timeline, so repeats and
 * endings are respected. Notes are tagged with `s = staves.length` (their own channel).
 */
export function accompanimentNotes(score: Score, events: TimedEvent[], length: number, tempos: TempoChange[] = []): TimedNote[] {
  const acc = score.accompaniment;
  if (!acc?.enabled) return [];
  const byId = new Map(allEvents(score).map((e) => [e.id, e]));

  // chord changes in playback order (one per time; first staff wins)
  const changes: { time: number; text: string }[] = [];
  for (const ev of events) {
    const text = byId.get(ev.id)?.harmony;
    if (!text || !chordVoicing(text)) continue;
    if (changes.length && Math.abs(changes[changes.length - 1].time - ev.time) < EPS) continue;
    changes.push({ time: ev.time, text });
  }
  if (!changes.length) return [];

  // bar starts along the playback; each bar knows its meter (beats can change from bar to bar)
  const ctx = contexts(score);
  const barEvents = events.filter((e) => e.s === 0 && !e.v && e.i === 0).sort((a, b) => a.time - b.time);
  const barStarts = barEvents.map((e) => e.time);
  const beatsOf = (time: number) => {
    const k = Math.max(0, barStarts.findIndex((t, j) => time >= t - EPS && time < (barStarts[j + 1] ?? Infinity) - EPS));
    return ctx[barEvents[k]?.m ?? 0]?.beats ?? score.timeBeats;
  };
  // seconds -> ticks through the tempo map (for MIDI export)
  const toTick = (time: number) => {
    const tc = [...tempos].reverse().find((x) => x.time <= time + EPS) ?? { tick: 0, time: 0, bpm: score.tempo };
    return Math.round(tc.tick + ((time - tc.time) * tc.bpm * TPQ) / 60);
  };
  const s = score.staves.length;
  const out: TimedNote[] = [];
  const add = (time: number, duration: number, midi: number, velocity: number) => {
    if (duration > 0.02) {
      const tick = toTick(time);
      out.push({ time, duration, tick, ticks: Math.max(1, toTick(time + duration) - tick), midi, velocity, s });
    }
  };

  changes.forEach((ch, k) => {
    const t0 = ch.time;
    const t1 = k + 1 < changes.length ? changes[k + 1].time : length;
    const v = chordVoicing(ch.text)!;
    // bars overlapping this chord
    const bars = barStarts
      .map((b, j) => ({ start: b, end: barStarts[j + 1] ?? length }))
      .filter((b) => b.end > t0 + EPS && b.start < t1 - EPS);
    for (const bar of bars) {
      const from = Math.max(bar.start, t0);
      const to = Math.min(bar.end, t1);
      const beatsInBar = beatsOf(bar.start);
      const beat = (bar.end - bar.start) / beatsInBar;
      // beat positions inside [from, to), plus the chord's own start if it falls between beats
      const beats: { time: number; index: number }[] = [];
      for (let b = 0, t = bar.start; t < to - EPS; b++, t = bar.start + b * beat) {
        if (t >= from - EPS) beats.push({ time: t, index: b });
      }
      if (!beats.length || beats[0].time > from + EPS) beats.unshift({ time: from, index: 0 });
      pattern(acc.style, v, beats, to, beat, beatsInBar, add);
    }
  });
  return out;
}

type Add = (time: number, duration: number, midi: number, velocity: number) => void;

function pattern(
  style: AccompanimentStyle,
  v: { bass: number; tones: number[] },
  beats: { time: number; index: number }[],
  end: number,
  beat: number,
  beatsInBar: number,
  add: Add,
) {
  const until = (k: number) => (beats[k + 1]?.time ?? end) - beats[k].time;
  const chord = (time: number, dur: number, vel: number) => v.tones.forEach((n) => add(time, dur, n, vel));
  switch (style) {
    case 'block': {
      const t = beats[0].time;
      add(t, end - t, v.bass, 0.5);
      chord(t, end - t, 0.42);
      break;
    }
    case 'pop':
      beats.forEach((b, k) => {
        const strong = b.index === 0 || (beatsInBar % 2 === 0 && b.index === beatsInBar / 2);
        if (strong || k === 0) add(b.time, Math.min(until(k), beat * 2), v.bass, 0.55);
        chord(b.time, Math.min(until(k), beat) * 0.85, strong ? 0.42 : 0.34);
      });
      break;
    case 'waltz':
      beats.forEach((b, k) => {
        if (b.index === 0 || k === 0) add(b.time, until(k) * 0.95, v.bass, 0.55);
        else chord(b.time, until(k) * 0.8, 0.36);
      });
      break;
    case 'arpeggio': {
      const seq = [v.bass, ...v.tones, ...v.tones.slice(1, -1).reverse()];
      const step = beat / 2;
      let k = 0;
      for (let t = beats[0].time; t < end - 1e-4; t += step, k++) {
        add(t, Math.min(step * 2.5, end - t), seq[k % seq.length], k % seq.length === 0 ? 0.5 : 0.38);
      }
      break;
    }
    case 'strum':
      beats.forEach((b, k) => {
        const down = b.index % 2 === 0;
        const notes = [v.bass, ...v.tones];
        const order = down ? notes : [...notes].reverse();
        const dur = Math.min(until(k), beat) * 0.95;
        order.forEach((n, j) => add(b.time + j * 0.018, dur - j * 0.018, n, down ? 0.45 : 0.3));
      });
      break;
  }
}
