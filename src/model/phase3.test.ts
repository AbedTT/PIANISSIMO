// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseChord, prettyChord } from './harmony';
import { newScore, writeAt } from './score';
import { Editor } from '../editor/editor';
import { fromMusicXML, toMusicXML } from '../io/musicxml';
import { toMidi } from '../io/midi';
import { gmSampleUrls, soundById, soundForProgram, SOUNDS } from '../audio/sounds';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

describe('chord symbols', () => {
  it('parses roots, qualities and slash basses', () => {
    expect(parseChord('C')).toMatchObject({ root: { step: 'C', alter: 0 }, suffix: '', kind: 'major' });
    expect(parseChord('F#m7b5')).toMatchObject({ root: { step: 'F', alter: 1 }, suffix: 'm7b5', kind: 'half-diminished' });
    expect(parseChord('Bbmaj7')).toMatchObject({ root: { step: 'B', alter: -1 }, kind: 'major-seventh' });
    expect(parseChord('G/B')).toMatchObject({ root: { step: 'G' }, bass: { step: 'B', alter: 0 }, kind: 'major' });
    expect(parseChord('Ebadd9')).toMatchObject({ suffix: 'add9', kind: 'other' });
    expect(parseChord('hello')).toBeNull();
  });
  it('prints real accidentals', () => {
    expect(prettyChord('F#m7b5')).toBe('F♯m7♭5');
    expect(prettyChord('Bb/D')).toBe('B♭/D');
  });
});

describe('lyrics and chords in the editor', () => {
  it('stores lyrics only on notes, chords on notes or rests, and walks note to note', () => {
    const ed = new Editor(newScore({ measures: 2, staves: [{ clef: 'treble' }] }));
    ed.typeLetter('C');
    ed.rest();
    ed.typeLetter('E');
    const at = (i: number) => ({ m: 0, s: 0, i });
    ed.setLyric(at(0), { text: 'Hel', hyphen: true });
    ed.setLyric(at(1), { text: 'nope' }); // rest: ignored
    ed.setHarmony(at(1), 'G7');
    expect(ed.score.measures[0].staves[0][0].lyric).toEqual({ text: 'Hel', hyphen: true });
    expect(ed.score.measures[0].staves[0][1].lyric).toBeUndefined();
    expect(ed.score.measures[0].staves[0][1].harmony).toBe('G7');
    expect(ed.neighbor(at(0), 1, true)).toMatchObject(at(2)); // lyrics skip rests
    expect(ed.neighbor(at(0), 1, false)).toMatchObject(at(1)); // chords don't
    ed.setLyric(at(0), null);
    expect(ed.score.measures[0].staves[0][0].lyric).toBeUndefined();
  });

  it('keeps a chord symbol when its note is deleted', () => {
    const ed = new Editor(newScore({ measures: 1, staves: [{ clef: 'treble' }] }));
    ed.typeLetter('C');
    ed.setHarmony({ m: 0, s: 0, i: 0 }, 'Am');
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.remove();
    expect(ed.score.measures[0].staves[0][0]).toMatchObject({ pitches: [], harmony: 'Am' });
  });
});

describe('sounds', () => {
  it('has unique ids, valid programs and a full sample map', () => {
    expect(new Set(SOUNDS.map((x) => x.id)).size).toBe(SOUNDS.length);
    expect(SOUNDS.length).toBeGreaterThanOrEqual(30);
    for (const x of SOUNDS) {
      expect(x.program).toBeGreaterThanOrEqual(0);
      expect(x.program).toBeLessThan(128);
      expect(!!x.gm || !!x.synth || x.id === 'piano').toBe(true);
    }
    const urls = gmSampleUrls();
    expect(urls.A0).toBe('A0.mp3');
    expect(urls.Eb4).toBe('Eb4.mp3'); // FluidR3 uses flat names
    expect(Object.keys(urls).some((k) => k.includes('#'))).toBe(false);
  });
  it('maps GM programs back to sounds', () => {
    expect(soundForProgram(40)).toBe('violin');
    expect(soundForProgram(0)).toBe('piano');
    expect(soundForProgram(29)).toBe('guitar_clean'); // overdriven guitar -> nearest guitar
    expect(soundForProgram(47)).toBe('harp'); // timpani -> nearest in the strings family
    expect(soundById('nope').id).toBe('piano');
  });
});

describe('export of lyrics, chords and sounds', () => {
  const build = () => {
    const s = newScore({ measures: 1, staves: [{ clef: 'treble', sound: 'violin' }, { clef: 'bass', sound: 'cello' }] });
    const c5 = { step: 'C' as const, alter: 0, octave: 5 };
    for (let i = 0; i < 4; i++) writeAt(s, 0, 0, i, { pitches: [c5], type: 'q', dots: 0 });
    const bar = s.measures[0].staves[0];
    bar[0].lyric = { text: 'Hap', hyphen: true };
    bar[1].lyric = { text: 'py' };
    bar[2].lyric = { text: 'birth', hyphen: true };
    bar[3].lyric = { text: 'day' };
    bar[0].harmony = 'F#m7b5';
    bar[2].harmony = 'G/B';
    s.measures[0].staves[1][0].harmony = 'C';
    return s;
  };

  it('round-trips through MusicXML', () => {
    const s = build();
    const xml = toMusicXML(s);
    expect(xml).toContain('<syllabic>begin</syllabic><text>Hap</text>');
    expect(xml).toContain('<syllabic>end</syllabic><text>py</text>');
    expect(xml).toContain('<kind text="m7b5">half-diminished</kind>');
    expect(xml).toContain('<midi-program>41</midi-program>'); // violin
    expect(xml).toContain('<midi-program>43</midi-program>'); // cello
    const back = fromMusicXML(xml);
    expect(back.staves.map((x) => x.sound)).toEqual(['violin', 'cello']);
    const bar = back.measures[0].staves[0];
    expect(bar.map((e) => e.lyric)).toEqual(s.measures[0].staves[0].map((e) => e.lyric));
    expect(bar.map((e) => e.harmony)).toEqual(['F#m7b5', undefined, 'G/B', undefined]);
    expect(back.measures[0].staves[1][0].harmony).toBe('C');
  });

  it('writes one MIDI program per staff channel', () => {
    const midi = Array.from(toMidi(build()));
    const has = (seq: number[]) => midi.some((_, k) => seq.every((b, j) => midi[k + j] === b));
    expect(has([0xc0, 40])).toBe(true); // channel 1 violin
    expect(has([0xc1, 42])).toBe(true); // channel 2 cello
    expect(has([0x90])).toBe(true);
  });
});
