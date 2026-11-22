// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractPart, partsOf, scoreFromInstruments, writtenShift } from './parts';
import { barTicks, eventTicks, lane, newScore } from './score';
import { Editor } from '../editor/editor';
import { fromMusicXML, toMusicXML } from '../io/musicxml';
import { midiOf } from './pitch';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

const quartet = () =>
  scoreFromInstruments(['violin', 'violin', 'viola', 'cello'], { measures: 2, title: 'Quartet' }, (o) => newScore(o));

describe('parts', () => {
  it('builds ensembles with numbered names, clefs and sounds', () => {
    const s = quartet();
    expect(partsOf(s).map((p) => p.part.name)).toEqual(['Violin 1', 'Violin 2', 'Viola', 'Cello']);
    expect(s.staves.map((st) => st.clef)).toEqual(['treble', 'treble', 'alto', 'bass']);
    expect(s.staves.map((st) => st.sound)).toEqual(['violin', 'violin', 'viola', 'cello']);
    expect(s.measures[0].staves).toHaveLength(4);
  });

  it('adds, moves and removes parts together with their music', () => {
    const ed = new Editor(quartet());
    ed.setCursor({ m: 0, s: 3, i: 0 });
    ed.typeLetter('C'); // a note for the cello
    ed.addPart('piano');
    expect(ed.score.staves).toHaveLength(6);
    expect(partsOf(ed.score)[4]).toMatchObject({ start: 4, part: { name: 'Piano', staves: 2 } });
    ed.movePart(3, 1); // cello below the piano
    expect(partsOf(ed.score).map((p) => p.part.name)).toEqual(['Violin 1', 'Violin 2', 'Viola', 'Piano', 'Cello']);
    expect(ed.score.staves[5].clef).toBe('bass');
    expect(lane(ed.score, 0, 5)[0].pitches[0].step).toBe('C'); // the cello's note moved with it
    expect(ed.removePart(0)).toBe(true);
    expect(ed.score.staves).toHaveLength(5);
    ed.undo();
    expect(ed.score.staves).toHaveLength(6);
  });

  it('extracts one part as its own score', () => {
    const s = quartet();
    const viola = extractPart(s, 2);
    expect(viola.staves).toEqual([{ clef: 'alto', sound: 'viola' }]);
    expect(viola.partName).toBe('Viola');
    expect(viola.measures[1].staves).toHaveLength(1);
  });
});

describe('transposing instruments', () => {
  it('stores concert pitch; in the transposed view typed letters are written notes', () => {
    const s = scoreFromInstruments(['clarinet'], { measures: 1 }, (o) => newScore(o));
    expect(writtenShift(s, 0)).toBe(2);
    const ed = new Editor(s);
    ed.toggleTransposedView();
    ed.typeLetter('D'); // written D on a B♭ clarinet sounds C
    const p = lane(ed.score, 0, 0)[0].pitches[0];
    expect(p.step).toBe('C');
    expect(ed.writtenKey(0, 0)).toBe(2); // concert C major = written D major
    ed.toggleTransposedView();
    ed.typeLetter('D'); // at concert pitch the letter is the sounding note
    expect(lane(ed.score, 0, 0)[1].pitches[0].step).toBe('D');
  });

  it('round-trips a multi-part score with a B♭ clarinet through MusicXML (written pitch in the file)', () => {
    const s = scoreFromInstruments(['flute', 'clarinet', 'cello'], { measures: 2, keyFifths: -1 }, (o) => newScore(o));
    const ed = new Editor(s);
    ed.setCursor({ m: 0, s: 1, i: 0 });
    ed.typeLetter('F'); // concert F
    ed.setBarChanges(1, { time: { beats: 3, beatType: 4 } });
    const xml = toMusicXML(ed.score);
    expect(xml.match(/<score-part id=/g)).toHaveLength(3);
    expect(xml).toContain('<part-name>Clarinet in B♭</part-name>');
    expect(xml).toContain('<chromatic>-2</chromatic>');
    // the clarinet part is written a tone higher: concert F -> written G, key F -> G major
    const clarinet = xml.slice(xml.indexOf('<part id="P2">'), xml.indexOf('<part id="P3">'));
    expect(clarinet).toContain('<fifths>1</fifths>');
    expect(clarinet).toContain('<step>G</step>');

    const back = fromMusicXML(xml);
    expect(partsOf(back).map((p) => [p.part.name, p.part.transpose ?? 0])).toEqual([
      ['Flute', 0],
      ['Clarinet in B♭', 2],
      ['Cello', 0],
    ]);
    expect(back.keyFifths).toBe(-1);
    expect(midiOf(lane(back, 0, 1)[0].pitches[0])).toBe(midiOf(lane(ed.score, 0, 1)[0].pitches[0]));
    // every bar of every staff has the right length after the 3/4 change
    back.measures.forEach((_, m) =>
      back.staves.forEach((__, st) =>
        expect(lane(back, m, st).reduce((a, e) => a + eventTicks(e), 0)).toBe(barTicks(back, m)),
      ),
    );
  });
});
