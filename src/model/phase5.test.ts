// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { barTicks, eventTicks, lane, laneOf, newScore, refitMeasures } from './score';
import { transposeScore } from './transpose';
import type { Score } from './types';
import { Editor } from '../editor/editor';
import { timeline } from '../audio/player';
import { fromMusicXML, toMusicXML } from '../io/musicxml';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

const total = (s: Score, m: number, st: number, v: number) => lane(s, m, st, v).reduce((a, e) => a + eventTicks(e), 0);
const steps = (s: Score, m: number, v: number) => lane(s, m, 0, v).map((e) => e.pitches.map((p) => p.step).join('') || 'r');

/** Bar 1: voice 1 = half notes E5 D5, voice 2 = quarters C5 B4 A4 G4. */
function twoVoices() {
  const ed = new Editor(newScore({ measures: 2, staves: [{ clef: 'treble' }] }));
  ed.setDuration('h');
  ed.typeLetter('E');
  ed.typeLetter('D');
  ed.setCursor({ m: 0, s: 0, i: 0 });
  ed.toggleVoice();
  ed.setDuration('q');
  for (const l of ['C', 'B', 'A', 'G'] as const) ed.typeLetter(l);
  return ed;
}

describe('two voices on one staff', () => {
  it('types a second line independently, both voices filling the bar', () => {
    const ed = twoVoices();
    expect(steps(ed.score, 0, 0)).toEqual(['E', 'D']);
    expect(steps(ed.score, 0, 1)).toEqual(['C', 'B', 'A', 'G']);
    expect(total(ed.score, 0, 0, 0)).toBe(barTicks(ed.score));
    expect(total(ed.score, 0, 0, 1)).toBe(barTicks(ed.score));
    // typing past the bar keeps going in voice 2 of the next bar
    expect(ed.cursor).toMatchObject({ m: 1, i: 0, v: 1 });
    expect(laneOf(ed.score.measures[1], 0, 1)).toBeTruthy();
  });

  it('switching voice keeps the beat and lands on voice 1 where there is no voice 2', () => {
    const ed = twoVoices();
    ed.setCursor({ m: 0, s: 0, i: 2, v: 1 }); // A4 on beat 3
    ed.toggleVoice();
    expect(ed.cursor).toMatchObject({ v: 0, i: 1 }); // D5 half note covers beat 3
    ed.setCursor({ m: 1, s: 0, i: 0, v: 1 });
    ed.removeVoice2();
    expect(laneOf(ed.score.measures[1], 0, 1)).toBeUndefined();
    expect(ed.cursor.v).toBe(0);
  });

  it('edits, selects and transposes both voices', () => {
    const ed = twoVoices();
    ed.setCursor({ m: 0, s: 0, i: 0, v: 1 });
    ed.shift(-1); // C5 -> B4, voice 2 only
    expect(steps(ed.score, 0, 1)[0]).toBe('B');
    expect(steps(ed.score, 0, 0)[0]).toBe('E');
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.stepMeasure(1, true); // select bar 1 (both voices)
    expect(ed.selected().filter((x) => x.v === 1)).toHaveLength(4);
    ed.transpose(2, false);
    expect(steps(ed.score, 0, 0)).toEqual(['F', 'E']);
    expect(steps(ed.score, 0, 1)).toEqual(['C', 'C', 'B', 'A']);
  });

  it('copies and pastes both voices', () => {
    const ed = twoVoices();
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.stepMeasure(1, true);
    ed.copy();
    ed.setCursor({ m: 1, s: 0, i: 0 });
    ed.paste();
    expect(steps(ed.score, 1, 0)).toEqual(['E', 'D']);
    expect(steps(ed.score, 1, 1)).toEqual(['C', 'B', 'A', 'G']);
  });

  it('plays both voices, keeps them through refits and whole-score transposition', () => {
    const ed = twoVoices();
    const { notes, events } = timeline(ed.score);
    expect(notes.filter((n) => n.time < 2.4).length).toBe(6); // 2 + 4 notes in bar 1 (tempo 100)
    expect(events.some((e) => e.v === 1)).toBe(true);
    ed.score.timeBeats = 3;
    refitMeasures(ed.score);
    expect(total(ed.score, 0, 0, 1)).toBe(barTicks(ed.score));
    transposeScore(ed.score, 12);
    expect(lane(ed.score, 0, 0, 1)[0].pitches[0].octave).toBe(6);
  });
});

describe('MusicXML with two voices', () => {
  it('round-trips voice 2 with stems and backups', () => {
    const ed = twoVoices();
    const xml = toMusicXML(ed.score);
    expect(xml).toContain('<voice>2</voice>');
    expect(xml).toContain('<stem>down</stem>');
    const back = fromMusicXML(xml);
    expect(steps(back, 0, 0)).toEqual(['E', 'D']);
    expect(steps(back, 0, 1)).toEqual(['C', 'B', 'A', 'G']);
  });

  it('places a voice that enters late (forward) at the right beat', () => {
    const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>x</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
      <backup><duration>4</duration></backup>
      <forward><duration>2</duration><voice>2</voice></forward>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>2</voice><type>half</type></note>
      </measure></part></score-partwise>`;
    const s = fromMusicXML(xml);
    expect(steps(s, 0, 0)).toEqual(['E']);
    expect(steps(s, 0, 1)).toEqual(['r', 'G']);
    expect(lane(s, 0, 0, 1)[0].type).toBe('h');
  });
});

describe('rest tidying', () => {
  it('merges leftover rests into beat-aligned values', async () => {
    const { tidyRests } = await import('./score');
    const r = (type: '8' | 'q' | 'h', id: string) => ({ id, pitches: [], type, dots: 0 });
    const n = { id: 'n', pitches: [{ step: 'C' as const, alter: 0, octave: 4 }], type: 'q' as const, dots: 0 };
    // q note, then 8+8+q+q rests -> quarter rest on beat 2, half rest on beat 3
    const out = tidyRests([n, r('8', 'a'), r('8', 'b'), r('q', 'c'), r('q', 'd')]);
    expect(out.map((e) => e.type)).toEqual(['q', 'q', 'h']);
    // a half rest may not start on beat 2: q note + h rest + q rest stays q, q, h
    expect(tidyRests([n, r('h', 'x'), r('q', 'y')]).map((e) => e.type)).toEqual(['q', 'q', 'h']);
    // already tidy: same objects kept
    const tidy = [n, r('q', 'k'), r('h', 'l')];
    expect(tidyRests(tidy)[1]).toBe(tidy[1]);
  });

  it('shows one quarter rest after six eighths in voice 2, and deleting a selection spares other notes', () => {
    const ed = new Editor(newScore({ measures: 1, staves: [{ clef: 'treble' }] }));
    ed.toggleVoice();
    ed.setDuration('8');
    for (const l of ['F', 'E', 'D', 'E', 'F', 'G'] as const) ed.typeLetter(l);
    expect(lane(ed.score, 0, 0, 1).slice(6).map((e) => e.type)).toEqual(['q']);
    // n0 r r n3 n4: select from the first rest to n3, delete -> n4 survives
    const ed2 = new Editor(newScore({ measures: 1, staves: [{ clef: 'treble' }] }));
    ed2.setDuration('8');
    ed2.typeLetter('C');
    ed2.rest();
    ed2.rest();
    ed2.typeLetter('D');
    ed2.typeLetter('E');
    ed2.setCursor({ m: 0, s: 0, i: 1 });
    ed2.step(1, true);
    ed2.step(1, true);
    ed2.remove();
    const steps2 = lane(ed2.score, 0, 0, 0).map((e) => e.pitches[0]?.step ?? 'r');
    expect(steps2[0]).toBe('C');
    expect(steps2).toContain('E');
    expect(steps2).not.toContain('D');
  });
});
