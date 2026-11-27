// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { templateById } from '../model/templates';
import type { Score } from '../model/types';
import { fromMusicXML } from './musicxml';
import { readMxl } from './mxl';
import { liftLyrics } from '../scan/scanFixes';
import { barBoxes } from '../scan/barMap';

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

const fixture = async (name: string) => {
  const bytes = readFileSync(resolve(__dirname, 'fixtures', name));
  return readMxl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};

describe('scanning with Audiveris', () => {
  it('a page Audiveris 5.11 read (the waltz template printed to PDF) opens with the same notes, last line included', async () => {
    // fixtures/audiveris-waltz.mxl: the real output of `Audiveris -batch <Scanner.Tuning> -export` on that PDF.
    // Its last line holds a single bar: without minStaffLength=10 Audiveris dropped it
    const scanned = fromMusicXML(await fixture('audiveris-waltz.mxl'));
    const original = templateById('waltz')!.make();
    expect(scanned.timeBeats).toBe(3);
    expect(scanned.timeBeatType).toBe(4);
    expect(scanned.keyFifths).toBe(0);
    expect(scanned.staves.map((s) => s.clef)).toEqual(['treble', 'bass']);
    expect(scanned.measures).toHaveLength(8);
    expect(sketch(scanned)).toEqual(sketch(original));
  });

  it('words Audiveris read under the notes (filed as text below the staff) become lyrics on their notes', async () => {
    // the waltz with a word under every melody note, scanned with the English text-reading data.
    // Audiveris missed "my", "a", "of" and the last "and"; the words around them stay in place
    const xml = await fixture('audiveris-lyrics.mxl');
    const before = fromMusicXML(xml);
    expect(before.measures.flatMap((m) => m.staves[0]).some((e) => e.lyric)).toBe(false);
    const score = fromMusicXML(liftLyrics(xml));
    const bars = score.measures.map((m) => m.staves[0].map((e) => e.lyric?.text ?? '_').join(' '));
    expect(bars).toEqual(['Dance', 'with me _', 'dear', 'and sing _', 'song _', 'joy tonight', 'under the moon', '_']);
    // the notes themselves are unchanged
    expect(sketch(score)).toEqual(sketch(before));
  });

  it('leaves a page without a lyric line alone', async () => {
    const xml = await fixture('audiveris-waltz.mxl');
    expect(liftLyrics(xml)).toBe(xml);
  });

  it('knows where each bar is on the page picture, in reading order', () => {
    const sheet = gunzipSync(readFileSync(resolve(__dirname, 'fixtures/audiveris-waltz-sheet1.xml.gz'))).toString('utf8');
    const boxes = barBoxes([sheet]);
    expect(boxes).toHaveLength(8); // 3 + 4 + 1 bars on three lines
    expect(boxes.every((b) => b.page === 0 && b.w > 100 && b.h > 200)).toBe(true);
    expect(boxes[0].x).toBe(239);
    // left to right within a line, then down to the next line
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
    expect(boxes[3].y).toBeGreaterThan(boxes[2].y + boxes[2].h / 2);
    expect(boxes[7].y).toBeGreaterThan(boxes[6].y + boxes[6].h / 2);
    // within the 2478 × 3507 picture
    expect(boxes.every((b) => b.x + b.w <= 2478 && b.y >= 0 && b.y + b.h <= 3507)).toBe(true);
  });
});
