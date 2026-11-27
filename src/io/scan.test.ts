// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { templateById } from '../model/templates';
import type { Score } from '../model/types';
import { fromMusicXML } from './musicxml';
import { readMxl } from './mxl';

/** Every bar as text: "E5:h. | G5:q F5:q E5:q | …" per staff, voice 1 and voice 2 merged by onset. */
function sketch(score: Score): string[] {
  return score.staves.map((_, s) =>
    score.measures
      .map((m) =>
        [...m.staves[s], ...(m.voice2?.[s] ?? [])]
          .map((e) => (e.pitches.length ? e.pitches.map((p) => `${p.step}${p.alter > 0 ? '#' : p.alter < 0 ? 'b' : ''}${p.octave}`).join('+') : 'r') + `:${e.type}${'.'.repeat(e.dots)}`)
          .join(' '),
      )
      .join(' | '),
  );
}

describe('scanning with Audiveris', () => {
  it('a page Audiveris 5.11 read (the waltz template printed to PDF) opens with the same notes', async () => {
    // fixtures/audiveris-waltz.mxl: the real output of `Audiveris -batch -export` on that PDF
    const bytes = readFileSync(resolve(__dirname, 'fixtures/audiveris-waltz.mxl'));
    const xml = await readMxl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const scanned = fromMusicXML(xml);
    const original = templateById('waltz')!.make();
    expect(scanned.timeBeats).toBe(3);
    expect(scanned.timeBeatType).toBe(4);
    expect(scanned.keyFifths).toBe(0);
    expect(scanned.staves.map((s) => s.clef)).toEqual(['treble', 'bass']);
    // Audiveris did not see the last line of that page (one short bar alone on a line: its log says
    // "7 raw measures: [3 in system#1, 4 in system#2]"); the seven bars it read are all right
    expect(scanned.measures).toHaveLength(7);
    const firstSeven = { ...original, measures: original.measures.slice(0, 7) };
    expect(sketch(scanned)).toEqual(sketch(firstSeven));
  });
});
