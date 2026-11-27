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
    empty.setDuration('e');
    empty.setCursor({ m: 0, s: 0, i: 0 });
    expect(empty.inputType).toBe('e');
  });
});

describe('combining voices into chords', () => {
  /** Bar 1: voice 1 C5 D5 E5 F5, voice 2 A4 B4 (same rhythm) then a half note G4 (different rhythm). */
  function satb() {
    const ed = new Editor(newScore({ measures: 2, staves: [{ clef: 'treble' }] }));
    for (const l of ['C', 'D', 'E', 'F']) ed.typeLetter(l);
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
    for (const l of ['E', 'F', 'G', 'A']) ed.typeLetter(l);
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.toggleVoice(1);
    for (const l of ['C', 'D', 'E', 'F']) ed.typeLetter(l);
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
