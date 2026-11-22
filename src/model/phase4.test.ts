// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chordVoicing, transposeChord } from './harmony';
import { newScore, playOrder, writeAt } from './score';
import { transposeKey, transposeScore } from './transpose';
import type { Score } from './types';
import { Editor } from '../editor/editor';
import { fullTimeline, timeline } from '../audio/player';
import { accompanimentNotes } from '../audio/accompaniment';
import { fromMusicXML, toMusicXML } from '../io/musicxml';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

const bars = (n: number, setup: (s: Score) => void) => {
  const s = newScore({ measures: n, staves: [{ clef: 'treble' }] });
  setup(s);
  return s;
};

describe('first and second endings', () => {
  it('plays 1st ending, repeats, then skips to the 2nd ending', () => {
    const s = bars(4, (s) => {
      s.measures[0].repeatStart = true;
      s.measures[1].volta = 1;
      s.measures[1].repeatEnd = true;
      s.measures[2].volta = 2;
    });
    expect(playOrder(s)).toEqual([0, 1, 0, 2, 3]);
  });

  it('handles multi-bar endings and a repeat without a start bar', () => {
    const s = bars(6, (s) => {
      s.measures[2].volta = 1;
      s.measures[3].volta = 1;
      s.measures[3].repeatEnd = true;
      s.measures[4].volta = 2;
    });
    expect(playOrder(s)).toEqual([0, 1, 2, 3, 0, 1, 4, 5]);
  });

  it('cycles bars through 1st, 2nd and no ending, and round-trips MusicXML', () => {
    const ed = new Editor(bars(4, (s) => (s.measures[1].repeatEnd = true)));
    ed.setCursor({ m: 1, s: 0, i: 0 });
    expect(ed.cycleVolta()).toBe(1);
    ed.setCursor({ m: 2, s: 0, i: 0 });
    ed.cycleVolta();
    expect(ed.cycleVolta()).toBe(2);
    const back = fromMusicXML(toMusicXML(ed.score));
    expect(back.measures.map((m) => m.volta)).toEqual([undefined, 1, 2, undefined]);
    expect(back.measures[1].repeatEnd).toBe(true);
    expect(playOrder(back)).toEqual([0, 1, 0, 2, 3]);
  });
});

describe('chord voicing', () => {
  it('voices chords with a low bass and close position tones', () => {
    expect(chordVoicing('C')).toEqual({ bass: 36, tones: [60, 64, 67] });
    expect(chordVoicing('Am7')).toEqual({ bass: 45, tones: [57, 60, 64, 67] });
    expect(chordVoicing('F')!.tones).toEqual([65, 69, 72]); // F3 would be too low
    expect(chordVoicing('G/B')!.bass).toBe(47);
    expect(chordVoicing('Cadd9')!.tones).toEqual([60, 64, 67, 74]);
    expect(chordVoicing('nope')).toBeNull();
  });
});

describe('transposition', () => {
  it('moves the key signature by the interval', () => {
    expect(transposeKey(0, 2)).toBe(2); // C -> D
    expect(transposeKey(0, -2)).toBe(-2); // C -> Bb
    expect(transposeKey(0, 1)).toBe(-5); // C -> Db (not C#)
    expect(transposeKey(1, 12)).toBe(1); // octave keeps the key
    expect(transposeKey(-1, 1)).toBe(-6); // F -> Gb
  });

  it('transposes notes and chord symbols of the whole score', () => {
    const s = newScore({ measures: 1, staves: [{ clef: 'treble' }] });
    writeAt(s, 0, 0, 0, { pitches: [{ step: 'C', alter: 0, octave: 4 }, { step: 'F', alter: 1, octave: 4 }], type: 'q', dots: 0 });
    s.measures[0].staves[0][0].harmony = 'Am7/G';
    transposeScore(s, -2);
    expect(s.keyFifths).toBe(-2);
    expect(s.measures[0].staves[0][0].pitches).toEqual([
      { step: 'B', alter: -1, octave: 3 },
      { step: 'E', alter: 0, octave: 4 },
    ]);
    expect(s.measures[0].staves[0][0].harmony).toBe('Gm7/F');
    expect(transposeChord('Bb', 1, false)).toBe('B');
  });

  it('transposes only the selection and keeps the key', () => {
    const ed = new Editor(newScore({ measures: 2, staves: [{ clef: 'treble' }] }));
    for (const l of ['C', 'D', 'E', 'F'] as const) ed.typeLetter(l);
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.step(1, true);
    ed.transpose(1, false);
    const bar = ed.score.measures[0].staves[0];
    expect(ed.score.keyFifths).toBe(0);
    expect(bar.map((e) => `${e.pitches[0].step}${e.pitches[0].alter}`)).toEqual(['C1', 'D1', 'E0', 'F0']);
    ed.setCursor({ m: 0, s: 0, i: 3 });
    ed.chromatic(-1);
    expect(ed.score.measures[0].staves[0][3].pitches[0]).toMatchObject({ step: 'E', alter: 0 });
  });
});

describe('chord accompaniment', () => {
  const song = (style: 'pop' | 'block' | 'waltz', beats = 4) => {
    const s = newScore({ measures: 2, timeBeats: beats, tempo: 120, staves: [{ clef: 'treble' }] });
    s.measures[0].staves[0][0].harmony = 'C';
    s.measures[1].staves[0][0].harmony = 'G7';
    s.accompaniment = { enabled: true, style, sound: 'piano' };
    return s;
  };
  const run = (s: Score) => {
    const t = timeline(s);
    return accompanimentNotes(s, t.events, t.length);
  };

  it('pop: bass on beats 1 and 3, a chord on every beat, own channel', () => {
    const notes = run(song('pop'));
    const bar1 = notes.filter((n) => n.time < 2 - 1e-6); // 4/4 at 120 = 2 s per bar
    expect(bar1.filter((n) => n.midi === 36).map((n) => n.time)).toEqual([0, 1]);
    expect(bar1.filter((n) => n.midi === 60).map((n) => n.time)).toEqual([0, 0.5, 1, 1.5]);
    expect(notes.every((n) => n.s === 1)).toBe(true);
    expect(notes.some((n) => n.midi === 43 && n.time >= 2)).toBe(true); // G bass in bar 2
  });

  it('block: one held chord per bar; waltz: oom-pah-pah', () => {
    const block = run(song('block'));
    expect(block.filter((n) => n.time === 0).map((n) => n.midi).sort()).toEqual([36, 60, 64, 67]);
    expect(block.find((n) => n.midi === 60)!.duration).toBeCloseTo(2);
    const waltz = run(song('waltz', 3));
    const bar1 = waltz.filter((n) => n.time < 1.5 - 1e-6);
    expect(bar1.filter((n) => n.midi === 36).map((n) => n.time)).toEqual([0]);
    expect(bar1.filter((n) => n.midi === 60).map((n) => n.time)).toEqual([0.5, 1]);
  });

  it('is silent when off, follows repeats when on, and merges into the full timeline', () => {
    const off = song('block');
    off.accompaniment!.enabled = false;
    expect(run(off)).toEqual([]);
    const rep = song('block');
    rep.measures[0].repeatEnd = true; // bar 1 twice: C, C, G7
    const starts = run(rep).filter((n) => n.midi < 48).map((n) => n.time);
    expect(starts).toEqual([0, 2, 4]);
    expect(fullTimeline(rep).notes.length).toBe(run(rep).length);
  });
});
