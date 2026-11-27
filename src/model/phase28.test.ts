// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../editor/editor';
import { timeline } from '../audio/player';
import { fromMusicXML, toMusicXML } from '../io/musicxml';
import { renderScore } from '../render/renderer';
import { extractPart, scoreFromInstruments } from './parts';
import { lane, lanesOf, newScore } from './score';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

/** One bar with a note in each of four voices (whole notes), written through the editor. */
function satbOnOneStaff() {
  const ed = new Editor(newScore({ measures: 2, staves: [{ clef: 'treble' }] }));
  ed.setDuration('w');
  for (const [step, v] of [['E', 0], ['C', 1], ['G', 2], ['A', 3]] as const) {
    // back to bar 1 (typing a whole note moves the cursor on), then into the voice
    ed.setCursor({ m: 0, s: 0, i: 0, v: ed.voice });
    ed.toggleVoice(v);
    ed.typeLetter(step);
  }
  return ed;
}

describe('up to four voices per staff', () => {
  it('V cycles 1 → 2 → 3 → 4 → 1, dropping voices left empty', () => {
    const ed = new Editor(newScore({ measures: 1, staves: [{ clef: 'treble' }] }));
    const seen: number[] = [];
    for (let k = 0; k < 4; k++) {
      ed.toggleVoice();
      seen.push(ed.voice);
    }
    expect(seen).toEqual([1, 2, 3, 0]);
    // nothing was written in voices 2–4, so none of them stays in the bar
    expect(lanesOf(ed.score.measures[0], 0).map((l) => l.v)).toEqual([0]);
  });

  it('writes, plays and round-trips four voices', () => {
    const ed = satbOnOneStaff();
    const lanes = lanesOf(ed.score.measures[0], 0);
    expect(lanes.map((l) => [l.v, l.events[0].pitches[0]?.step])).toEqual([
      [0, 'E'],
      [1, 'C'],
      [2, 'G'],
      [3, 'A'],
    ]);
    // all four sound together
    const first = timeline(ed.score).notes.filter((n) => n.tick === 0);
    expect(first).toHaveLength(4);
    // MusicXML: four voices out and back, stems alternate up/down
    const xml = toMusicXML(ed.score);
    expect((xml.match(/<voice>(\d)<\/voice>/g) ?? []).filter((x, i, a) => a.indexOf(x) === i).sort()).toEqual([
      '<voice>1</voice>',
      '<voice>2</voice>',
      '<voice>3</voice>',
      '<voice>4</voice>',
    ]);
    expect(xml).toContain('<stem>down</stem>');
    const back = fromMusicXML(xml);
    expect(lanesOf(back.measures[0], 0).map((l) => l.events[0].pitches[0]?.step)).toEqual(['E', 'C', 'G', 'A']);
  });

  it('draws every voice and keeps the cursor geometry for each', () => {
    const ed = satbOnOneStaff();
    const host = document.createElement('div');
    const layout = renderScore(host, ed.score, 800);
    for (const { events } of lanesOf(ed.score.measures[0], 0)) expect(layout.events.get(events[0].id)).toBeDefined();
    expect(host.querySelectorAll('.vf-stavenote').length).toBeGreaterThanOrEqual(5); // 4 voices + bar 2
  });

  it('moves voices 3 and 4 clear of the voice with the same stems', () => {
    const ed = satbOnOneStaff();
    const layout = renderScore(document.createElement('div'), ed.score, 800);
    const x = (v: number) => layout.events.get(lanesOf(ed.score.measures[0], 0)[v].events[0].id)!.x;
    expect(x(2) - x(0)).toBeGreaterThanOrEqual(12); // voice 3 right of voice 1
    expect(x(3) - x(1)).toBeGreaterThanOrEqual(12); // voice 4 right of voice 2
  });

  it('removes one voice, or all extra voices from voice 1', () => {
    const ed = satbOnOneStaff();
    ed.setCursor({ m: 0, s: 0, i: 0, v: 2 });
    ed.toggleVoice(2);
    ed.removeVoice2();
    expect(lanesOf(ed.score.measures[0], 0).map((l) => l.v)).toEqual([0, 1, 3]);
    ed.toggleVoice(0);
    ed.removeVoice2();
    expect(lanesOf(ed.score.measures[0], 0).map((l) => l.v)).toEqual([0]);
    expect(lane(ed.score, 0, 0)[0].pitches[0].step).toBe('E');
  });

  it('keeps every voice when a part is extracted', () => {
    const s = scoreFromInstruments(['piano', 'violin'], { measures: 1 }, newScore);
    const ed = new Editor(s);
    ed.setCursor({ m: 0, s: 2, i: 0 });
    ed.setDuration('w');
    ed.typeLetter('G');
    ed.setCursor({ m: 0, s: 2, i: 0 });
    ed.toggleVoice(3);
    ed.typeLetter('D');
    const part = extractPart(ed.score, 1);
    expect(lanesOf(part.measures[0], 0).map((l) => l.v)).toEqual([0, 3]);
  });
});
