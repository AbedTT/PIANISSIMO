// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../editor/editor';
import { fromMusicXML, toMusicXML } from '../io/musicxml';
import { lane, laneOf, newScore } from './score';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

describe('the toolbar follows the selected note', () => {
  it('takes over the length and dot of a note when it is selected, not of a rest', () => {
    const ed = new Editor(newScore({ measures: 1, staves: [{ clef: 'treble' }] }));
    ed.typeLetter('C'); // quarter
    ed.setDuration('h');
    ed.toggleDot();
    ed.typeLetter('D'); // dotted half
    ed.setCursor({ m: 0, s: 0, i: 0 });
    expect([ed.inputType, ed.inputDots]).toEqual(['q', 0]);
    ed.step(1); // onto the dotted half
    expect([ed.inputType, ed.inputDots]).toEqual(['h', 1]);
    // a rest keeps the chosen length, so typing into empty bars works as before
    const empty = new Editor(newScore({ measures: 1, staves: [{ clef: 'treble' }] }));
    empty.setDuration('8');
    empty.setCursor({ m: 0, s: 0, i: 0 });
    expect(empty.inputType).toBe('8');
  });
});

describe('combining voices into chords', () => {
  /** Bar 1: voice 1 C5 D5 E5 F5, voice 2 A4 B4 (same rhythm) then a half note G4 (different rhythm). */
  function satb() {
    const ed = new Editor(newScore({ measures: 2, staves: [{ clef: 'treble' }] }));
    for (const l of ['C', 'D', 'E', 'F'] as const) ed.typeLetter(l);
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.toggleVoice(1);
    ed.typeLetter('A');
    ed.typeLetter('B');
    ed.setDuration('h');
    ed.typeLetter('G');
    return ed;
  }

  it('puts notes with the same rhythm on one stem and keeps the others as voice 2', () => {
    const ed = satb();
    const v2before = lane(ed.score, 0, 0, 1).filter((e) => e.pitches.length).length;
    expect(v2before).toBe(3);
    expect(ed.combineVoices()).toBe(2);
    const top = lane(ed.score, 0, 0, 0);
    expect(top.map((e) => e.pitches.length)).toEqual([2, 2, 1, 1]);
    // lowest note first, as in a chord
    expect(top[0].pitches.map((p) => p.step)).toEqual(['A', 'C']);
    const low = lane(ed.score, 0, 0, 1);
    expect(low.filter((e) => e.pitches.length).map((e) => [e.pitches[0].step, e.type])).toEqual([['G', 'h']]);
    expect(ed.voice).toBe(0);
  });

  it('removes voice 2 when everything was combined, and undo brings it back', () => {
    const ed = new Editor(newScore({ measures: 1, staves: [{ clef: 'treble' }] }));
    for (const l of ['E', 'F', 'G', 'A'] as const) ed.typeLetter(l);
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.toggleVoice(1);
    for (const l of ['C', 'D', 'E', 'F'] as const) ed.typeLetter(l);
    expect(ed.combineVoices()).toBe(4);
    expect(laneOf(ed.score.measures[0], 0, 1)).toBeFalsy();
    expect(lane(ed.score, 0, 0, 0).every((e) => e.pitches.length === 2)).toBe(true);
    ed.undo();
    expect(lane(ed.score, 0, 0, 1).filter((e) => e.pitches.length)).toHaveLength(4);
  });

  it('says so when there is nothing to combine', () => {
    const ed = new Editor(newScore({ measures: 1, staves: [{ clef: 'treble' }] }));
    ed.typeLetter('C');
    expect(ed.combineVoices()).toBe(0);
  });
});

describe('header and footer notes', () => {
  it('travel through MusicXML as page credits', () => {
    const s = newScore({ title: 'Behold', measures: 1 });
    s.headerNote = 'Tune: EPIPHANE · 6.6.6.6';
    s.footerNote = 'Based on Isaiah 9:6\nFor the Christmas service';
    const xml = toMusicXML(s);
    expect(xml).toContain('<credit-type>subtitle</credit-type>');
    const back = fromMusicXML(xml);
    expect(back.headerNote).toBe('Tune: EPIPHANE · 6.6.6.6');
    expect(back.footerNote).toBe('Based on Isaiah 9:6\nFor the Christmas service');
    expect(fromMusicXML(toMusicXML(newScore({ measures: 1 }))).headerNote).toBeUndefined();
  });
});

describe('changing one note of a chord', () => {
  /** F major, a C5 (doh) with an A4 under it (written as a chord: C then Shift+A). */
  function chord() {
    const ed = new Editor(newScore({ measures: 1, keyFifths: -1, staves: [{ clef: 'treble' }] }));
    ed.typeLetter('C');
    ed.addToChord('A'); // goes above: A5
    ed.setCursor({ m: 0, s: 0, i: 0 });
    return ed;
  }
  const names = (ed: Editor) => ed.current!.pitches.map((p) => `${p.step}${p.alter ? (p.alter > 0 ? '#' : 'b') : ''}${p.octave}`).sort().join(' ');

  it('Alt+Up and Down walk through the notes; Escape-style null goes back to the whole chord', () => {
    const ed = chord();
    expect(ed.chordNote).toBeNull();
    expect(ed.cycleChordNote(1)).toBe(true);
    const low = ed.chordNote!;
    expect(ed.current!.pitches[low].step).toBe('C'); // lowest first
    ed.cycleChordNote(1);
    expect(ed.current!.pitches[ed.chordNote!].step).toBe('A');
    ed.cycleChordNote(1);
    expect(ed.chordNote).toBeNull(); // past the top: whole chord
    ed.cycleChordNote(-1);
    expect(ed.current!.pitches[ed.chordNote!].step).toBe('A'); // Down starts at the top
    ed.selectChordNote(null);
    expect(ed.chordNote).toBeNull();
  });

  it('moves, retypes or deletes only the picked note', () => {
    const ed = chord();
    expect(names(ed)).toBe('A5 C5');
    ed.cycleChordNote(-1); // the top note, A5
    ed.shift(-1); // down a step: G5, the C stays
    expect(names(ed)).toBe('C5 G5');
    ed.typeLetter('B'); // retype it: the nearest B is Bb in F major
    expect(names(ed)).toBe('Bb5 C5');
    expect(ed.chordNote).not.toBeNull(); // still picked after the change
    ed.octave(-1);
    expect(names(ed)).toBe('Bb4 C5');
    ed.remove(); // only that note goes
    expect(names(ed)).toBe('C5');
    expect(ed.chordNote).toBeNull();
    ed.undo();
    expect(names(ed)).toBe('Bb4 C5');
  });

  it('without a pick, commands still change the whole chord', () => {
    const ed = chord();
    ed.shift(1);
    expect(names(ed)).toBe('B5 D5'.replace('B5', 'Bb5'));
  });

  it('moving to another note forgets the pick', () => {
    const ed = chord();
    ed.step(1); // the rest after the chord
    ed.typeLetter('F');
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.cycleChordNote(1);
    expect(ed.chordNote).not.toBeNull();
    ed.step(1);
    ed.step(-1);
    expect(ed.chordNote).toBeNull();
  });
});

describe('a different length for one note of a chord', () => {
  /** F major: soprano C5 and alto A4 sharing one stem, a half note. */
  function chord() {
    const ed = new Editor(newScore({ measures: 2, keyFifths: -1, staves: [{ clef: 'treble' }] }));
    ed.setDuration('h');
    ed.typeLetter('A');
    ed.step(-1);
    ed.addToChord('C'); // C5 above the A4
    ed.setCursor({ m: 0, s: 0, i: 0 });
    return ed;
  }
  const show = (ed: Editor, v: number) =>
    lane(ed.score, 0, 0, v).map((e) => (e.pitches.map((p) => p.step + p.octave).join('+') || 'r') + ':' + e.type + (e.dots ? '.' : '')).join(' ');

  it('a lower note (alto) gets its own stem with the new length; the soprano keeps hers', () => {
    const ed = chord();
    expect(show(ed, 0)).toBe('A4+C5:h r:h');
    ed.cycleChordNote(1); // the lowest note: A4
    ed.setDuration('q');
    expect(show(ed, 0)).toBe('C5:h r:h');
    expect(show(ed, 1)).toBe('A4:q r:q r:h');
    // the cursor is on the alto now: the next alto note goes straight in under the soprano's half note
    expect(ed.voice).toBe(1);
    ed.step(1);
    ed.typeLetter('G');
    expect(show(ed, 1)).toBe('A4:q G4:q r:h');
    expect(show(ed, 0)).toBe('C5:h r:h');
  });

  it('the top note (soprano) keeps the upper stem with its new length; the notes under it go down unchanged', () => {
    const ed = chord();
    ed.cycleChordNote(-1); // the top note: C5
    ed.setDuration('w');
    expect(show(ed, 0)).toBe('C5:w');
    expect(show(ed, 1)).toBe('A4:h r:h');
    expect(ed.voice).toBe(0);
  });

  it('works later in the bar too, and undo puts the chord back', () => {
    const ed = chord();
    ed.step(1); // beat 3
    ed.setDuration('h');
    ed.typeLetter('B'); // Bb4 (shown as B4 here)
    ed.step(-1);
    ed.addToChord('D');
    expect(show(ed, 0)).toBe('A4+C5:h B4+D5:h');
    ed.setCursor({ m: 0, s: 0, i: 1 });
    ed.cycleChordNote(1); // Bb4
    ed.setDuration('q');
    expect(show(ed, 0)).toBe('A4+C5:h D5:h');
    expect(show(ed, 1)).toBe('r:h B4:q r:q');
    ed.undo();
    expect(show(ed, 0)).toBe('A4+C5:h B4+D5:h');
  });

  it('when the voice below is taken, the whole chord changes and says so', () => {
    const ed = chord();
    const told: string[] = [];
    ed.notice = (m) => told.push(m);
    // fill voices 2 and 4 under the chord
    for (const v of [1, 3]) {
      ed.setCursor({ m: 0, s: 0, i: 0 });
      ed.toggleVoice(v);
      ed.setDuration('w');
      ed.typeLetter('F');
    }
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.cycleChordNote(1);
    ed.setDuration('q');
    expect(show(ed, 0).startsWith('A4+C5:q')).toBe(true);
    expect(told).toHaveLength(1);
  });
});
