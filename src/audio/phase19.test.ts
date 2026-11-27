// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TPQ } from '../model/duration';
import { newScore, writeStream } from '../model/score';
import { parseMelody, TEMPLATES } from '../model/templates';
import { fullTimeline, mixNotes, timeline } from './player';
import { WaitPractice } from './practice';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

const melody = (text: string, staves = 1) => {
  const s = newScore({ measures: 1, staves: Array.from({ length: staves }, () => ({ clef: 'treble' as const })) });
  writeStream(s, 0, parseMelody(text));
  return s;
};

describe('swing', () => {
  it('delays off-beat eighths to a 2:1 feel and leaves other notes alone', () => {
    const s = melody('C4:8 D4:8 E4:q F4:8 G4:8 A4:q');
    const straight = timeline(s).notes.map((n) => n.tick);
    expect(straight).toEqual([0, TPQ / 2, TPQ, 2 * TPQ, 2.5 * TPQ, 3 * TPQ]);
    s.swing = true;
    const swung = timeline(s).notes;
    expect(swung.map((n) => n.tick)).toEqual([0, (2 * TPQ) / 3, TPQ, 2 * TPQ, 2 * TPQ + (2 * TPQ) / 3, 3 * TPQ]);
    // the on-beat eighth is held longer, the off-beat one is shorter
    expect(swung[0].ticks).toBe((2 * TPQ) / 3);
    expect(swung[1].ticks).toBe(TPQ / 3);
    // 6/8 is not swung
    const compound = newScore({ measures: 1, timeBeats: 6, timeBeatType: 8, staves: [{ clef: 'treble' }] });
    writeStream(compound, 0, parseMelody('C4:8 D4:8 E4:8 F4:8 G4:8 A4:8'));
    compound.swing = true;
    expect(timeline(compound).notes[1].tick).toBe(TPQ / 2);
  });
});

describe('mixer', () => {
  it('mutes, solos and scales volume per staff; the accompaniment has its own volume', () => {
    const s = melody('C4:q D4:q E4:q F4:q', 2);
    writeStream(s, 1, parseMelody('C3:w'));
    s.measures[0].staves[0][0].harmony = 'C';
    s.accompaniment = { enabled: true, style: 'block', sound: 'piano' };
    const all = fullTimeline(s).notes;
    const count = (notes: typeof all, staff: number) => notes.filter((n) => n.s === staff).length;
    expect(count(all, 2)).toBeGreaterThan(0); // accompaniment on "staff" 2

    s.staves[1].mute = true;
    expect(count(mixNotes(s, all), 1)).toBe(0);
    delete s.staves[1].mute;

    s.staves[0].solo = true;
    const solo = mixNotes(s, all);
    expect([count(solo, 0), count(solo, 1), count(solo, 2)]).toEqual([4, 0, 0]);
    delete s.staves[0].solo;

    s.staves[0].volume = 0.5;
    s.accompaniment.volume = 0;
    const mixed = mixNotes(s, all);
    expect(mixed.find((n) => n.s === 0)!.velocity).toBeCloseTo(all.find((n) => n.s === 0)!.velocity * 0.5);
    expect(count(mixed, 2)).toBe(0);
  });
});

describe('wait mode', () => {
  it('asks for each chord of the part in order, with the other parts as accompaniment', () => {
    const s = melody('C4:q D4:q E4+G4:q r:q', 2);
    writeStream(s, 1, parseMelody('C3:h G2:h'));
    const p = new WaitPractice(s, [0]);
    expect(p.steps.map((st) => st.expected)).toEqual([[60], [62], [64, 67]]); // the rest is skipped
    expect(p.steps[0].others).toEqual([{ midi: 48, s: 1 }]);
    expect(p.steps[1].others).toEqual([]);
    expect(p.play([62])).toBe('wrong');
    expect(p.index).toBe(0);
    expect(p.play([60])).toBe('right');
    expect(p.play([62])).toBe('right');
    expect(p.play([67, 64])).toBe('done');
    expect(p.misses).toBe(1);
  });

  it('loose matching for the microphone: the melody note in any octave', () => {
    const s = melody('C4+E4+G4:h A4:h', 1);
    const p = new WaitPractice(s, [0]);
    expect(p.play([55], true)).toBe('right'); // G3: the top note of the chord, an octave down
    expect(p.play([60], true)).toBe('wrong');
    expect(p.play([81], true)).toBe('done'); // A5
    // strict matching still wants the exact notes
    expect(new WaitPractice(s, [0]).play([55])).toBe('wrong');
  });

  it('follows repeats and does not ask again for tied notes', () => {
    const s = TEMPLATES.find((t) => t.id === 'blues')!.make(); // a 12-bar repeat
    const once = new WaitPractice({ ...s, measures: s.measures.map((m) => ({ ...m, repeatEnd: false })) }, [0]);
    const twice = new WaitPractice(s, [0]);
    expect(twice.steps.length).toBe(once.steps.length * 2);
    const tied = melody('C4:h C4:h');
    tied.measures[0].staves[0][0].tie = true;
    expect(new WaitPractice(tied, [0]).steps).toHaveLength(1);
  });
});
