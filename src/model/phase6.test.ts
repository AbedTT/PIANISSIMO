// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLyric, lyricsOf, setLyricOn, verseCount } from './lyrics';
import { newScore, writeAt } from './score';
import type { NoteEvent } from './types';
import { Editor } from '../editor/editor';
import { fromMusicXML, toMusicXML } from '../io/musicxml';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

const note = (): NoteEvent => ({ id: 'x', pitches: [{ step: 'C', alter: 0, octave: 4 }], type: 'q', dots: 0 });

describe('lyric verses', () => {
  it('stores verse 1 where it always was and later verses alongside', () => {
    const e = note();
    setLyricOn(e, 1, { text: 'Hap', hyphen: true });
    setLyricOn(e, 3, { text: 'Joy' });
    expect(e.lyric).toEqual({ text: 'Hap', hyphen: true }); // backwards compatible
    expect(e.extraVerses).toEqual([null, { text: 'Joy' }]);
    expect(getLyric(e, 2)).toBeUndefined();
    expect(lyricsOf(e).map((l) => l.verse)).toEqual([1, 3]);
    setLyricOn(e, 3, null);
    expect(e.extraVerses).toBeUndefined(); // empty tail trimmed
    setLyricOn(e, 1, { text: '   ' });
    expect(e.lyric).toBeUndefined();
  });

  it('types verse 2 under the same notes and counts verses', () => {
    const ed = new Editor(newScore({ measures: 1, staves: [{ clef: 'treble' }] }));
    ed.typeLetter('C');
    ed.typeLetter('D');
    const at = (i: number) => ({ m: 0, s: 0, i });
    ed.setLyric(at(0), { text: 'Twin', hyphen: true });
    ed.setLyric(at(1), { text: 'kle' });
    ed.setLyricVerse(2);
    ed.setLyric(at(0), { text: 'Up' });
    ed.setLyric(at(1), { text: 'a' });
    const bar = ed.score.measures[0].staves[0];
    expect(lyricsOf(bar[0]).map((l) => l.lyric.text)).toEqual(['Twin', 'Up']);
    expect(verseCount(ed.score)).toBe(2);
    // overwriting a note with a rest drops all its verses
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.rest();
    expect(lyricsOf(ed.score.measures[0].staves[0][0])).toEqual([]);
  });

  it('round-trips verses through MusicXML with per-verse syllabic', () => {
    const s = newScore({ measures: 1, staves: [{ clef: 'treble' }] });
    for (let i = 0; i < 2; i++) writeAt(s, 0, 0, i, { pitches: [{ step: 'C', alter: 0, octave: 5 }], type: 'q', dots: 0 });
    const [a, b] = s.measures[0].staves[0];
    setLyricOn(a, 1, { text: 'Hap', hyphen: true });
    setLyricOn(b, 1, { text: 'py' });
    setLyricOn(a, 2, { text: 'Good' });
    setLyricOn(b, 2, { text: 'night' });
    const xml = toMusicXML(s);
    expect(xml).toContain('<lyric number="1"><syllabic>begin</syllabic><text>Hap</text></lyric>');
    expect(xml).toContain('<lyric number="2"><syllabic>single</syllabic><text>Good</text></lyric>');
    expect(xml).toContain('<lyric number="1"><syllabic>end</syllabic><text>py</text></lyric>');
    const back = fromMusicXML(xml);
    const [a2, b2] = back.measures[0].staves[0];
    expect(lyricsOf(a2)).toEqual(lyricsOf(a));
    expect(lyricsOf(b2)).toEqual(lyricsOf(b));
  });
});

describe('layout settings', () => {
  it('toggles line and page breaks and stores print settings', () => {
    const ed = new Editor(newScore({ measures: 4 }));
    ed.setCursor({ m: 1, s: 0, i: 0 });
    expect(ed.toggleBreak('lineBreak')).toBe(true);
    expect(ed.score.measures[1].lineBreak).toBe(true);
    expect(ed.toggleBreak('lineBreak')).toBe(false);
    expect(ed.score.measures[1].lineBreak).toBeUndefined();
    ed.toggleBreak('pageBreak');
    expect(ed.score.measures[1].pageBreak).toBe(true);
    ed.setPrint({ pageSize: 'letter' });
    expect(ed.score.print).toEqual({ pageSize: 'letter', scale: 0.8 });
  });
});
