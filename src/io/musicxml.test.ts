// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { newScore, writeAt } from '../model/score';
import { TRIPLET } from '../model/types';
import { fromMusicXML, toMusicXML } from './musicxml';
import { readMxl } from './mxl';

const CONTAINER =
  '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>';

/** Minimal ZIP writer (deflate) for test fixtures. CRCs are not checked by readMxl. */
function makeZip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: number[] = [];
  const central: number[] = [];
  const u16 = (n: number) => [n & 255, (n >> 8) & 255];
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  let count = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = [...enc.encode(name)];
    const raw = enc.encode(content);
    const data = [...deflateRawSync(raw)];
    const offset = locals.length;
    const common = [...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(raw.length), ...u16(nameBytes.length), ...u16(0)];
    locals.push(...u32(0x04034b50), ...common, ...nameBytes, ...data);
    central.push(...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes);
    count++;
  }
  const eocd = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(central.length), ...u32(locals.length), ...u16(0)];
  return new Uint8Array([...locals, ...central, ...eocd]);
}

describe('MusicXML round trip', () => {
  it('preserves notes, chords, ties, articulations, dynamics and setup', () => {
    const s = newScore({ measures: 2, title: 'Round trip', composer: 'Me', keyFifths: -2, timeBeats: 3, tempo: 72 });
    writeAt(s, 0, 0, 0, {
      pitches: [
        { step: 'B', alter: -1, octave: 4 },
        { step: 'D', alter: 0, octave: 5 },
      ],
      type: 'h',
      dots: 0,
    });
    Object.assign(s.measures[0].staves[0][0], { tie: true, articulations: ['accent'], dynamic: 'p' });
    writeAt(s, 0, 0, 1, { pitches: [{ step: 'B', alter: -1, octave: 4 }], type: 'q', dots: 0 });
    writeAt(s, 0, 1, 0, { pitches: [{ step: 'G', alter: 0, octave: 2 }], type: 'h', dots: 1 });

    const back = fromMusicXML(toMusicXML(s));
    expect(back).toMatchObject({ title: 'Round trip', composer: 'Me', keyFifths: -2, timeBeats: 3, timeBeatType: 4, tempo: 72 });
    expect(back.staves.map((x) => x.clef)).toEqual(['treble', 'bass']);
    expect(back.measures).toHaveLength(2);
    const strip = (sc: typeof s) =>
      sc.measures.map((m) => m.staves.map((ev) => ev.map(({ id: _id, ...rest }) => rest)));
    expect(strip(back)).toEqual(strip(s));
  });

  it('preserves triplets, slurs and repeats', () => {
    const s = newScore({ measures: 2, staves: [{ clef: 'treble' }] });
    const c = { step: 'C' as const, alter: 0, octave: 5 };
    writeAt(s, 0, 0, 0, { pitches: [c], type: '8', dots: 0, tuplet: TRIPLET });
    writeAt(s, 0, 0, 1, { pitches: [{ ...c, step: 'D' }], type: '8', dots: 0, tuplet: TRIPLET });
    writeAt(s, 0, 0, 2, { pitches: [{ ...c, step: 'E' }], type: '8', dots: 0, tuplet: TRIPLET });
    const bar = s.measures[0].staves[0];
    bar[0].slurEnd = bar[2].id;
    s.measures[0].repeatStart = true;
    s.measures[1].repeatEnd = true;

    const xml = toMusicXML(s);
    expect(xml).toContain('<tuplet type="start" bracket="yes"/>');
    expect(xml).toContain('<repeat direction="backward"/>');

    const back = fromMusicXML(xml);
    const b = back.measures[0].staves[0];
    expect(b.slice(0, 3).map((e) => e.tuplet)).toEqual([TRIPLET, TRIPLET, TRIPLET]);
    expect(b[0].slurEnd).toBe(b[2].id);
    expect(back.measures[0].repeatStart).toBe(true);
    expect(back.measures[1].repeatEnd).toBe(true);
  });

  it('reads compressed .mxl files', async () => {
    const xml = toMusicXML(newScore({ title: 'Zipped' }));
    const back = fromMusicXML(await readMxl(makeZip({ 'META-INF/container.xml': CONTAINER, 'score.xml': xml })));
    expect(back.title).toBe('Zipped');
  });

  it('rejects non-MusicXML input with a clear error', () => {
    expect(() => fromMusicXML('<html></html>')).toThrow(/MusicXML/);
  });
});
