// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chordShape, GUITAR_TUNING, tabFor } from './guitar';
import { drumAt, drumForMidi, DRUM_KIT } from './drums';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

const shape = (s: string) => chordShape(s)?.frets.map((f) => (f < 0 ? 'x' : String(f))).join('');

describe('guitar chord diagrams', () => {
  it('finds the familiar open shapes', () => {
    expect(shape('C')).toBe('x32010');
    expect(shape('Am')).toBe('x02210');
    expect(shape('E')).toBe('022100');
    expect(shape('Em')).toBe('022000');
    expect(shape('D')).toBe('xx0232');
    expect(shape('Dm')).toBe('xx0231');
    expect(shape('A')).toBe('x02220');
    expect(shape('G7')).toMatch(/^3[2x]0001$/);
  });

  it('uses a barre for chords with no open shape', () => {
    const f = chordShape('F#m')!;
    expect(f.barre).toBeDefined();
    // every played note is a chord tone of F#m (F#, A, C#)
    const low = [...GUITAR_TUNING].reverse();
    const pcs = f.frets.flatMap((fr, k) => (fr < 0 ? [] : [(low[k] + fr) % 12]));
    expect(pcs.every((pc) => [6, 9, 1].includes(pc))).toBe(true);
    expect(pcs[0]).toBe(6); // root in the bass
  });

  it('puts the slash bass lowest', () => {
    const s = chordShape('C/E')!;
    const low = [...GUITAR_TUNING].reverse();
    const first = s.frets.findIndex((f) => f >= 0);
    expect((low[first] + s.frets[first]) % 12).toBe(4);
  });

  it('returns null for text that is not a chord', () => {
    expect(chordShape('N.C.')).toBeNull();
    expect(chordShape('rit.')).toBeNull();
  });
});

describe('tablature', () => {
  it('places single notes low on the neck', () => {
    expect(tabFor([40])).toEqual([{ str: 6, fret: 0 }]); // low E
    expect(tabFor([64])).toEqual([{ str: 1, fret: 0 }]); // high E open
    expect(tabFor([60])).toEqual([{ str: 2, fret: 1 }]); // middle C on the B string
  });

  it('gives each note of a chord its own string', () => {
    const t = tabFor([48, 52, 55, 60, 64]); // C major chord as in x32010
    expect(new Set(t.map((p) => p.str)).size).toBe(5);
    t.forEach((p) => expect(GUITAR_TUNING[p.str - 1] + p.fret).toBeGreaterThanOrEqual(40));
    expect(Math.max(...t.map((p) => p.fret))).toBeLessThanOrEqual(3);
  });

  it('stays near the previous hand position', () => {
    // A4 (69): fret 5 on the high E, or fret 10 on the B string, 14 on G…
    expect(tabFor([69], 0)).toEqual([{ str: 1, fret: 5 }]);
    expect(tabFor([69], 12)[0].fret).toBeGreaterThan(5);
  });

  it('leaves out notes below the lowest string', () => {
    expect(tabFor([30])).toEqual([]);
  });
});

describe('drum kit', () => {
  it('maps staff positions to drums and back', () => {
    expect(drumAt({ step: 'C', alter: 0, octave: 5 }).name).toBe('Snare');
    expect(drumAt({ step: 'F', alter: 0, octave: 4 }).name).toBe('Kick');
    expect(drumAt({ step: 'G', alter: 0, octave: 5 }).x).toBe(true);
    // between drums: the one below
    expect(drumAt({ step: 'G', alter: 0, octave: 4 }).name).toBe('Kick');
    for (const d of DRUM_KIT) expect(drumForMidi(d.midi)).toBe(d);
    expect(drumForMidi(35).name).toBe('Kick');
    expect(drumForMidi(46).name).toBe('Hi-hat');
  });
});

// ------------------------------------------------------------------ integration
import { newScore, lane } from './score';
import { Editor } from '../editor/editor';
import { timeline } from '../audio/player';
import { toMidi } from '../io/midi';
import { midiToScore } from '../io/midiImport';
import { fromMusicXML, toMusicXML } from '../io/musicxml';
import { transposeScore } from './transpose';
import { TEMPLATES } from './templates';
import { renderScore } from '../render/renderer';
import { TPQ } from './duration';

describe('tremolo', () => {
  it('cycles 1 → 2 → 3 → off and plays repeated notes', () => {
    const ed = new Editor(newScore({ measures: 1, staves: [{ clef: 'treble' }] }));
    ed.setDuration('h');
    ed.typeLetter('C');
    ed.setCursor({ m: 0, s: 0, i: 0 });
    expect([ed.cycleTremolo(), ed.cycleTremolo()]).toEqual([1, 2]);
    expect(lane(ed.score, 0, 0)[0].tremolo).toBe(2);
    // a half note with 2 strokes = eight 16ths
    const notes = timeline(ed.score).notes;
    expect(notes).toHaveLength(8);
    expect(notes[1].tick - notes[0].tick).toBe(TPQ / 4);
    // survives MusicXML
    const back = fromMusicXML(toMusicXML(ed.score));
    expect(lane(back, 0, 0)[0].tremolo).toBe(2);
    expect([ed.cycleTremolo(), ed.cycleTremolo()]).toEqual([3, 0]);
    expect(lane(ed.score, 0, 0)[0].tremolo).toBeUndefined();
  });
});

describe('drum staff', () => {
  const rock = () => TEMPLATES.find((t) => t.id === 'rock')!.make();

  it('plays General MIDI drum keys and exports them on channel 10', () => {
    const s = rock();
    expect(s.staves[1]).toMatchObject({ clef: 'percussion', sound: 'drums' });
    const drumNotes = timeline(s).notes.filter((n) => n.s === 1);
    expect(new Set(drumNotes.map((n) => n.midi))).toEqual(new Set([42, 36, 38, 50, 41, 49]));
    const bytes = toMidi(s);
    // a note-on on channel 10 (0x99) for the hi-hat (42)
    const hasDrumOn = bytes.some((b, i) => b === 0x99 && bytes[i + 1] === 42);
    expect(hasDrumOn).toBe(true);
    // and back: the drum channel becomes a percussion staff again
    const imported = midiToScore(bytes);
    const drumStaff = imported.staves.findIndex((st) => st.clef === 'percussion');
    expect(drumStaff).toBeGreaterThanOrEqual(0);
    expect(imported.staves[drumStaff].sound).toBe('drums');
    const first = lane(imported, 0, drumStaff)[0].pitches.map((p) => `${p.step}${p.octave}`).sort();
    expect(first).toEqual(['F4', 'G5']); // kick + hi-hat
  });

  it('round-trips through MusicXML as unpitched notes with x noteheads', () => {
    const s = rock();
    const xml = toMusicXML(s);
    expect(xml).toContain('<sign>percussion</sign>');
    expect(xml).toContain('<unpitched><display-step>G</display-step><display-octave>5</display-octave></unpitched>');
    expect(xml).toContain('<notehead>x</notehead>');
    const back = fromMusicXML(xml);
    const drum = back.staves.findIndex((st) => st.clef === 'percussion');
    expect(back.staves[drum].sound).toBe('drums');
    expect(lane(back, 0, drum).map((e) => e.pitches.length)).toEqual(lane(s, 0, 1).map((e) => e.pitches.length));
  });

  it('is left alone when the score is transposed', () => {
    const s = rock();
    const before = JSON.stringify(lane(s, 0, 1).map((e) => e.pitches));
    const guitar = lane(s, 0, 0)[0].pitches[0].step;
    transposeScore(s, 2);
    expect(JSON.stringify(lane(s, 0, 1).map((e) => e.pitches))).toBe(before);
    expect(lane(s, 0, 0)[0].pitches[0].step).not.toBe(guitar);
  });
});

describe('rendering the new notation', () => {
  it('draws tab staves, chord diagrams and x noteheads', () => {
    const host = document.createElement('div');
    renderScore(host, TEMPLATES.find((t) => t.id === 'guitar-song')!.make(), 900);
    // a tab staff is drawn under the guitar staff (VexFlow classes it as a stave too)
    expect(host.querySelectorAll('.vf-stave').length).toBe(2 * 4);
    expect(host.querySelectorAll('.vf-tabnote').length).toBeGreaterThan(8);
    const rock = document.createElement('div');
    expect(() => renderScore(rock, TEMPLATES.find((t) => t.id === 'rock')!.make(), 900)).not.toThrow();
  });

  it('collapses empty bars into multi-measure rests only when asked', () => {
    const s = newScore({ measures: 12, staves: [{ clef: 'treble' }] });
    const ed = new Editor(s);
    ed.typeLetter('C'); // bar 1 has a note; bars 2–12 are empty
    ed.mutate((score) => (score.measures[6].rehearsal = 'B')); // a new section splits the rest
    const plain = renderScore(document.createElement('div'), ed.score, 900);
    const host = document.createElement('div');
    const parts = renderScore(host, ed.score, 900, { multiRests: true });
    expect(parts.staves.length).toBe(3);
    expect(plain.staves.length).toBe(12);
    // every bar is still accounted for in the systems (for printing)
    expect(parts.systems.flatMap((x) => x.measures)).toEqual([...Array(12).keys()]);
  });
});
