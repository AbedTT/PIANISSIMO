import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fill, ticksOf, TPQ } from './duration';
import { spellMidi } from './pitch';
import { barTicks, eventTicks, newScore, playOrder, tupletGroups } from './score';
import { TRIPLET, type Score } from './types';
import { Editor } from '../editor/editor';
import { timeline } from '../audio/player';

const total = (s: Score, m: number, st: number) => s.measures[m].staves[st].reduce((a, e) => a + eventTicks(e), 0);
const steps = (s: Score, m: number, st = 0) => s.measures[m].staves[st].map((e) => e.pitches.map((p) => p.step).join('') || 'r');

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});
const melodyEditor = (measures = 2) => new Editor(newScore({ measures, staves: [{ clef: 'treble' }] }));

describe('triplets', () => {
  it('fills gaps with triplet rests when plain values cannot', () => {
    expect(fill(TPQ - ticksOf('8', 0, TRIPLET))).toEqual([
      { type: '8', dots: 0, tuplet: TRIPLET },
      { type: '8', dots: 0, tuplet: TRIPLET },
    ]);
    expect(fill(TPQ * 2)).toEqual([{ type: 'h', dots: 0 }]);
  });

  it('writes triplet eighths that fill exactly one beat, with brackets grouped', () => {
    const ed = melodyEditor();
    ed.setDuration('8');
    ed.toggleTriplet();
    ed.typeLetter('C');
    // after one triplet note the rest of the beat is two triplet rests
    expect(ed.score.measures[0].staves[0].slice(0, 3).map((e) => !!e.tuplet)).toEqual([true, true, true]);
    ed.typeLetter('D');
    ed.typeLetter('E');
    ed.toggleTriplet();
    ed.setDuration('q');
    ed.typeLetter('F');
    const bar = ed.score.measures[0].staves[0];
    expect(steps(ed.score, 0).slice(0, 4)).toEqual(['C', 'D', 'E', 'F']);
    expect(total(ed.score, 0, 0)).toBe(barTicks(ed.score));
    expect(tupletGroups(bar)).toEqual([[0, 1, 2]]);
  });

  it('moves a triplet that does not fit to the next bar instead of splitting it', () => {
    const ed = melodyEditor();
    ed.setDuration('h');
    ed.typeLetter('C');
    ed.setDuration('q');
    ed.typeLetter('D'); // one beat left in bar 1
    ed.setDuration('h');
    ed.toggleTriplet(); // a triplet half lasts 4/3 beats: does not fit
    ed.typeLetter('G');
    expect(steps(ed.score, 0)).toEqual(['C', 'D', 'r']);
    expect(ed.score.measures[1].staves[0][0]).toMatchObject({ type: 'h', tuplet: TRIPLET, pitches: [{ step: 'G' }] });
    expect(total(ed.score, 0, 0)).toBe(barTicks(ed.score));
    expect(total(ed.score, 1, 0)).toBe(barTicks(ed.score));
  });
});

describe('selection, clipboard and transposition', () => {
  const twoBars = () => {
    const ed = melodyEditor(3);
    for (const l of ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C'] as const) ed.typeLetter(l);
    return ed;
  };

  it('selects with shift-moves and transposes the whole selection', () => {
    const ed = twoBars();
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.step(1, true);
    ed.step(1, true); // C D E selected
    expect(ed.selected().map((x) => x.e.pitches[0].step)).toEqual(['C', 'D', 'E']);
    ed.shift(1);
    expect(steps(ed.score, 0)).toEqual(['D', 'E', 'F', 'F']);
    ed.step(1); // plain move clears the selection
    expect(ed.anchor).toBeNull();
  });

  it('copies a bar and pastes it later, then undoes in one step', () => {
    const ed = twoBars();
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.stepMeasure(1, true); // whole first bar
    expect(ed.copy()).toBe(4);
    ed.setCursor({ m: 2, s: 0, i: 0 });
    expect(ed.paste()).toBe(true);
    expect(steps(ed.score, 2)).toEqual(['C', 'D', 'E', 'F']);
    expect(ed.score.measures[2].staves[0][0].id).not.toBe(ed.score.measures[0].staves[0][0].id);
    ed.undo();
    expect(steps(ed.score, 2)).toEqual(['r']);
  });

  it('keeps slurs that lie inside the copied range', () => {
    const ed = twoBars();
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.step(1, true);
    ed.step(1, true);
    ed.toggleSlur(); // C..E
    ed.copy();
    ed.setCursor({ m: 2, s: 0, i: 0 });
    ed.paste();
    const bar = ed.score.measures[2].staves[0];
    expect(bar[0].slurEnd).toBe(bar[2].id);
  });

  it('cut turns the selection into rests', () => {
    const ed = twoBars();
    ed.setCursor({ m: 1, s: 0, i: 0 });
    ed.step(1, true);
    ed.cut();
    // the two cleared quarters merge into one half rest on beat 1
    expect(steps(ed.score, 1)).toEqual(['r', 'B', 'C']);
    expect(ed.score.measures[1].staves[0][0].type).toBe('h');
  });

  it('select-all covers every staff and bar', () => {
    const ed = new Editor(newScore({ measures: 2 }));
    ed.selectAll();
    expect(ed.selectionRange()).toMatchObject({ start: 0, end: 2 * barTicks(ed.score), s0: 0, s1: 1 });
  });
});

describe('slurs and repeats', () => {
  it('slurs from the target to the next note, and toggles off', () => {
    const ed = melodyEditor();
    ed.typeLetter('C');
    ed.rest();
    ed.typeLetter('E');
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.toggleSlur();
    const [c, , e] = ed.score.measures[0].staves[0];
    expect(c.slurEnd).toBe(e.id); // skips the rest
    ed.toggleSlur();
    expect(ed.score.measures[0].staves[0][0].slurEnd).toBeUndefined();
  });

  it('plays repeated bars twice', () => {
    const s = newScore({ measures: 4 });
    s.measures[1].repeatStart = true;
    s.measures[2].repeatEnd = true;
    expect(playOrder(s)).toEqual([0, 1, 2, 1, 2, 3]);
    const noStart = newScore({ measures: 3 });
    noStart.measures[1].repeatEnd = true;
    expect(playOrder(noStart)).toEqual([0, 1, 0, 1, 2]);
    expect(timeline(s).length).toBeCloseTo((60 / s.tempo) * 4 * 6);
  });
});

describe('MIDI input', () => {
  it('spells notes in the key', () => {
    expect(spellMidi(60, 0)).toEqual({ step: 'C', alter: 0, octave: 4 });
    expect(spellMidi(66, 1)).toEqual({ step: 'F', alter: 1, octave: 4 }); // F# in G major
    expect(spellMidi(65, 1)).toEqual({ step: 'F', alter: 0, octave: 4 }); // F natural, not E#
    expect(spellMidi(70, -1)).toEqual({ step: 'B', alter: -1, octave: 4 }); // Bb in F major
    expect(spellMidi(61, -2)).toEqual({ step: 'D', alter: -1, octave: 4 }); // flat key -> Db
    expect(spellMidi(61, 0)).toEqual({ step: 'C', alter: 1, octave: 4 });
    expect(spellMidi(71, -7)).toEqual({ step: 'C', alter: -1, octave: 5 }); // Cb5 in Cb major
  });

  it('writes a chord from simultaneous keys', () => {
    const ed = melodyEditor();
    ed.writeMidi([67, 60, 64]);
    expect(ed.score.measures[0].staves[0][0].pitches.map((p) => p.step)).toEqual(['C', 'E', 'G']);
    expect(ed.cursor.i).toBe(1);
  });
});
