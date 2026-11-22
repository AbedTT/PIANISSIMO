// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newScore, playOrder } from './score';
import type { Measure, Score } from './types';
import { Editor } from '../editor/editor';
import { fromMusicXML, toMusicXML } from '../io/musicxml';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

const bars = (n: number, marks: Record<number, Partial<Measure>>): Score => {
  const s = newScore({ measures: n, staves: [{ clef: 'treble' }] });
  for (const [m, patch] of Object.entries(marks)) Object.assign(s.measures[Number(m)], patch);
  return s;
};

describe('D.C. / D.S. / Coda / Fine playback order', () => {
  it('D.C. plays from the top to the end', () => {
    expect(playOrder(bars(3, { 2: { jump: 'dc' } }))).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('D.C. al Fine stops at Fine', () => {
    expect(playOrder(bars(4, { 1: { fine: true }, 3: { jump: 'dcFine' } }))).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('D.S. al Coda: back to the sign, then To Coda jumps to the coda', () => {
    const s = bars(6, { 1: { segno: true }, 2: { toCoda: true }, 4: { jump: 'dsCoda' }, 5: { coda: true } });
    // 0 1 2 3 4 | D.S. -> 1 2 | To Coda -> 5
    expect(playOrder(s)).toEqual([0, 1, 2, 3, 4, 1, 2, 5]);
  });

  it('D.S. al Fine with a sign', () => {
    const s = bars(5, { 1: { segno: true }, 2: { fine: true }, 4: { jump: 'dsFine' } });
    expect(playOrder(s)).toEqual([0, 1, 2, 3, 4, 1, 2]);
  });

  it('takes the repeat first, then the D.C., without repeating again', () => {
    const s = bars(3, { 0: { repeatStart: true }, 1: { repeatEnd: true }, 2: { jump: 'dc' } });
    expect(playOrder(s)).toEqual([0, 1, 0, 1, 2, 0, 1, 2]);
  });

  it('plays only the last ending after a D.C.', () => {
    const s = bars(4, { 1: { volta: 1, repeatEnd: true }, 2: { volta: 2 }, 3: { jump: 'dcFine', fine: false } });
    // first time: 0 1(1st) 0 2(2nd) 3 ; after D.C.: 0 2(2nd ending only) 3 (no second jump)
    expect(playOrder(s)).toEqual([0, 1, 0, 2, 3, 0, 2, 3]);
  });
});

describe('navigation marks in the editor and MusicXML', () => {
  it('toggles marks; segno and coda are unique in the score', () => {
    const ed = new Editor(newScore({ measures: 4 }));
    ed.setCursor({ m: 0, s: 0, i: 0 });
    expect(ed.toggleNav('segno')).toBe(true);
    ed.setCursor({ m: 2, s: 0, i: 0 });
    ed.toggleNav('segno'); // moves the sign
    expect(ed.score.measures.map((b) => !!b.segno)).toEqual([false, false, true, false]);
    expect(ed.toggleNav('dsCoda')).toBe(true);
    expect(ed.toggleNav('dsCoda')).toBe(false);
    ed.toggleNav('dc');
    ed.clearNav();
    expect(ed.score.measures[2]).not.toHaveProperty('segno');
    expect(ed.score.measures[2]).not.toHaveProperty('jump');
  });

  it('round-trips every mark through MusicXML', () => {
    const s = bars(6, { 1: { segno: true }, 2: { toCoda: true, fine: true }, 4: { jump: 'dsCoda' }, 5: { coda: true } });
    const xml = toMusicXML(s);
    expect(xml).toContain('<segno/></direction-type><sound segno="segno"/>');
    expect(xml).toContain('<words>D.S. al Coda</words></direction-type><sound dalsegno="segno"/>');
    const back = fromMusicXML(xml);
    const pick = (m: Measure) => ({ segno: m.segno, coda: m.coda, toCoda: m.toCoda, fine: m.fine, jump: m.jump });
    expect(back.measures.map(pick)).toEqual(s.measures.map(pick));
    expect(playOrder(back)).toEqual(playOrder(s));
  });

  it('reads D.C. al Fine written only as words (other programs)', () => {
    const xml = toMusicXML(bars(2, {})).replace(
      '<measure number="2">',
      '<measure number="2"><direction><direction-type><words>D.C. al Fine</words></direction-type></direction>',
    );
    expect(fromMusicXML(xml).measures[1].jump).toBe('dcFine');
  });
});
