import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decompose, ticksOf, TPQ } from './duration';
import { enharmonic, keyAlter, midiOf, nearestPitch, pitchAtStaffPosition } from './pitch';
import { barTicks, eventTicks, newScore, refitMeasures, writeAt } from './score';
import type { Score } from './types';
import { Editor } from '../editor/editor';
import { toMusicXML } from '../io/musicxml';
import { toMidi } from '../io/midi';
import { timeline } from '../audio/player';

const total = (s: Score, m: number, st: number) => s.measures[m].staves[st].reduce((a, e) => a + eventTicks(e), 0);

describe('durations', () => {
  it('computes dotted ticks', () => {
    expect(ticksOf('q')).toBe(TPQ);
    expect(ticksOf('q', 1)).toBe(TPQ * 1.5);
    expect(ticksOf('h', 2)).toBe(TPQ * 3.5);
  });
  it('decomposes gaps into plain rests', () => {
    expect(decompose(TPQ * 3)).toEqual([
      { type: 'h', dots: 0 },
      { type: 'q', dots: 0 },
    ]);
  });
});

describe('pitch', () => {
  it('applies key signatures', () => {
    expect(keyAlter('F', 1)).toBe(1);
    expect(keyAlter('B', -1)).toBe(-1);
    expect(keyAlter('E', -1)).toBe(0);
  });
  it('picks the nearest octave when typing', () => {
    expect(nearestPitch('C', { step: 'B', octave: 4, alter: 0 }, 0)).toMatchObject({ step: 'C', octave: 5 });
    expect(nearestPitch('A', { step: 'C', octave: 5, alter: 0 }, 0)).toMatchObject({ step: 'A', octave: 4 });
  });
  it('maps staff positions to pitches', () => {
    expect(pitchAtStaffPosition('treble', 0, 0)).toMatchObject({ step: 'F', octave: 5 }); // top line
    expect(pitchAtStaffPosition('treble', 8, 0)).toMatchObject({ step: 'E', octave: 4 }); // bottom line
    expect(pitchAtStaffPosition('bass', 0, 0)).toMatchObject({ step: 'A', octave: 3 });
  });
  it('respells enharmonics', () => {
    const p = enharmonic({ step: 'C', alter: 1, octave: 4 });
    expect(p).toMatchObject({ step: 'D', alter: -1, octave: 4 });
    expect(midiOf(p)).toBe(61);
  });
});

describe('writeAt (overwrite entry)', () => {
  it('keeps every bar full', () => {
    const s = newScore({ measures: 1 });
    const c4 = { step: 'C' as const, alter: 0, octave: 4 };
    writeAt(s, 0, 0, 0, { pitches: [c4], type: 'q', dots: 0 });
    expect(total(s, 0, 0)).toBe(barTicks(s));
    expect(s.measures[0].staves[0][0].pitches).toEqual([c4]);
    // a half note at slot 1 overwrites the following rests
    writeAt(s, 0, 0, 1, { pitches: [c4], type: 'h', dots: 0 });
    expect(total(s, 0, 0)).toBe(barTicks(s));
    expect(s.measures[0].staves[0].map((e) => e.type)).toEqual(['q', 'h', 'q']);
  });
  it('clamps notes that would overflow the bar', () => {
    const s = newScore({ measures: 1, timeBeats: 3 });
    writeAt(s, 0, 0, 0, { pitches: [{ step: 'C', alter: 0, octave: 4 }], type: 'w', dots: 0 });
    expect(s.measures[0].staves[0][0]).toMatchObject({ type: 'h', dots: 1 });
    expect(total(s, 0, 0)).toBe(barTicks(s));
  });
  it('turns partly overwritten notes into rests', () => {
    const s = newScore({ measures: 1 });
    const d = { step: 'D' as const, alter: 0, octave: 4 };
    writeAt(s, 0, 0, 0, { pitches: [d], type: 'h', dots: 0 });
    writeAt(s, 0, 0, 0, { pitches: [d], type: 'q', dots: 0 });
    const ev = s.measures[0].staves[0];
    expect(ev[1].pitches).toEqual([]);
    expect(total(s, 0, 0)).toBe(barTicks(s));
  });
  it('refits bars after a time signature change', () => {
    const s = newScore({ measures: 2 });
    s.timeBeats = 3;
    refitMeasures(s);
    expect(total(s, 0, 0)).toBe(barTicks(s));
    expect(total(s, 1, 1)).toBe(barTicks(s));
  });
});

describe('Editor', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  });

  it('types a melody, advancing the cursor and growing the score', () => {
    const ed = new Editor(newScore({ measures: 1, staves: [{ clef: 'treble' }] }));
    for (const l of ['C', 'D', 'E', 'F', 'G'] as const) ed.typeLetter(l);
    expect(ed.score.measures.length).toBe(2);
    expect(ed.score.measures[0].staves[0].map((e) => e.pitches[0]?.step)).toEqual(['C', 'D', 'E', 'F']);
    expect(ed.cursor).toMatchObject({ m: 1, i: 1 });
  });

  it('builds chords, applies accidentals and undoes', () => {
    const ed = new Editor(newScore({ measures: 2, staves: [{ clef: 'treble' }] }));
    ed.typeLetter('C');
    ed.addToChord('E');
    ed.addInterval(5); // fifth above E = B
    ed.accidental(-1);
    const chord = ed.score.measures[0].staves[0][0].pitches;
    expect(chord.map((p) => p.step)).toEqual(['C', 'E', 'B']);
    expect(chord.every((p) => p.alter === -1)).toBe(true);
    ed.undo();
    expect(ed.score.measures[0].staves[0][0].pitches.every((p) => p.alter === 0)).toBe(true);
  });

  it('splits notes across the bar line with a tie instead of shortening them', () => {
    const ed = new Editor(newScore({ measures: 1, staves: [{ clef: 'treble' }] }));
    ed.setDuration('h');
    ed.typeLetter('C');
    ed.typeLetter('D');
    ed.setDuration('q');
    ed.typeLetter('E'); // bar 1 is full after two halves, so this is beat 1 of bar 2
    ed.setDuration('w');
    ed.typeLetter('F'); // 3 beats left in bar 2 -> dotted half tied to a quarter in bar 3
    const bar2 = ed.score.measures[1].staves[0];
    const bar3 = ed.score.measures[2].staves[0];
    expect(bar2.map((e) => [e.pitches[0]?.step, e.type, e.dots])).toEqual([
      ['E', 'q', 0],
      ['F', 'h', 1],
    ]);
    expect(bar2[1].tie).toBe(true);
    expect(bar3[0]).toMatchObject({ type: 'q', pitches: [{ step: 'F' }] });
    expect(total(ed.score, 2, 0)).toBe(barTicks(ed.score));
    expect(ed.cursor).toMatchObject({ m: 2, i: 1 });
    // one undo removes the whole split note
    ed.undo();
    expect(ed.score.measures[1].staves[0][1].pitches).toEqual([]);
  });

  it('changes the duration of the note under the cursor', () => {
    const ed = new Editor(newScore({ measures: 1, staves: [{ clef: 'treble' }] }));
    ed.typeLetter('G');
    ed.step(-1);
    ed.setDuration('h');
    expect(ed.score.measures[0].staves[0][0]).toMatchObject({ type: 'h' });
    expect(total(ed.score, 0, 0)).toBe(barTicks(ed.score));
  });

  it('lengthening the last note of a bar carries it into the next bar as a tie', () => {
    const ed = new Editor(newScore({ measures: 2, staves: [{ clef: 'treble' }] }));
    ed.setDuration('h');
    ed.typeLetter('C');
    ed.setDuration('q');
    ed.typeLetter('E');
    ed.typeLetter('F'); // beat 4: one beat left in bar 1
    for (const l of ['G', 'A', 'B', 'C']) ed.typeLetter(l); // bar 2: G A B C
    ed.setCursor({ m: 0, s: 0, i: 2 }); // click the F
    expect(ed.current?.pitches[0].step).toBe('F');
    ed.setDuration('h'); // two beats: one in bar 1, one tied into bar 2
    const bar1 = ed.score.measures[0].staves[0];
    const bar2 = ed.score.measures[1].staves[0];
    expect(bar1.map((e) => [e.pitches[0]?.step, e.type])).toEqual([['C', 'h'], ['E', 'q'], ['F', 'q']]);
    expect(bar1[2].tie).toBe(true);
    // the tied F takes beat 1 of bar 2 (the G is overwritten); the rest of the bar stays
    expect(bar2.map((e) => [e.pitches[0]?.step, e.type])).toEqual([['F', 'q'], ['A', 'q'], ['B', 'q'], ['C', 'q']]);
    expect(total(ed.score, 1, 0)).toBe(barTicks(ed.score));
    // the cursor stays on the note, so a further change works on it too
    expect(ed.cursor).toMatchObject({ m: 0, i: 2 });
    ed.toggleDot(); // dotted half: 1 beat here + 2 tied beats in bar 2
    expect(ed.score.measures[1].staves[0].map((e) => [e.pitches[0]?.step, e.type, e.dots])).toEqual([['F', 'h', 0], ['B', 'q', 0], ['C', 'q', 0]]);
    ed.undo();
    ed.undo();
    expect(ed.score.measures[1].staves[0].map((e) => e.pitches[0]?.step)).toEqual(['G', 'A', 'B', 'C']);
  });
});

describe('export', () => {
  const s = newScore({ measures: 2, title: 'Test & <Tune>' });
  writeAt(s, 0, 0, 0, { pitches: [{ step: 'C', alter: 1, octave: 5 }], type: 'h', dots: 0 });
  s.measures[0].staves[0][0].tie = true;
  writeAt(s, 0, 0, 1, { pitches: [{ step: 'C', alter: 1, octave: 5 }], type: 'h', dots: 0 });

  it('writes escaped, tied MusicXML', () => {
    const xml = toMusicXML(s);
    expect(xml).toContain('<work-title>Test &amp; &lt;Tune&gt;</work-title>');
    expect(xml).toContain('<alter>1</alter>');
    expect(xml).toContain('<tied type="start"/>');
    expect(xml).toContain('<tied type="stop"/>');
    expect(xml).toContain('<backup><duration>1920</duration></backup>');
  });

  it('merges tied notes for playback and MIDI', () => {
    const { notes } = timeline(s);
    expect(notes).toHaveLength(1);
    expect(notes[0].duration).toBeCloseTo((60 / s.tempo) * 4);
    const midi = toMidi(s);
    expect(String.fromCharCode(...midi.slice(0, 4))).toBe('MThd');
  });
});
