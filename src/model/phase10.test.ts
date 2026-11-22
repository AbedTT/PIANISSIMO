// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contexts } from './context';
import { TPQ } from './duration';
import { barStart, barTicks, eventTicks, lane, newScore, tupletGroups } from './score';
import type { Score } from './types';
import { Editor } from '../editor/editor';
import { timeline } from '../audio/player';
import { toMidi } from '../io/midi';
import { fromMusicXML, toMusicXML } from '../io/musicxml';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

const steps = (s: Score, m: number) => lane(s, m, 0).map((e) => e.pitches[0]?.step ?? 'r');
const total = (s: Score, m: number) => lane(s, m, 0).reduce((a, e) => a + eventTicks(e), 0);
const melody = (measures = 4) => new Editor(newScore({ measures, staves: [{ clef: 'treble' }] }));

describe('changes at a bar', () => {
  it('time change: bars change length and keep adding up', () => {
    const ed = melody();
    ed.setBarChanges(1, { time: { beats: 3, beatType: 4 } });
    expect([0, 1, 2, 3].map((m) => barTicks(ed.score, m))).toEqual([4 * TPQ, 3 * TPQ, 3 * TPQ, 3 * TPQ]);
    expect([0, 1, 2].map((m) => total(ed.score, m))).toEqual([4 * TPQ, 3 * TPQ, 3 * TPQ]);
    expect(barStart(ed.score, 2)).toBe(7 * TPQ);
    // typing a whole note into a 3/4 bar splits it across the bar line
    ed.setCursor({ m: 1, s: 0, i: 0 });
    ed.setDuration('w');
    ed.typeLetter('C');
    expect(lane(ed.score, 1, 0)[0]).toMatchObject({ type: 'h', dots: 1, tie: true });
    // same value as before removes the change
    ed.setBarChanges(1, { time: { beats: 4, beatType: 4 } });
    expect(ed.score.measures[1].time).toBeUndefined();
  });

  it('time change re-bars the music: notes flow on and tie across bar lines, none are lost', () => {
    const ed = melody(3);
    for (const l of ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C', 'B', 'A', 'G', 'F'] as const) ed.typeLetter(l);
    ed.setBarChanges(1, { time: { beats: 3, beatType: 4 } });
    const notes = ed.score.measures.flatMap((b) => b.staves[0]).filter((e) => e.pitches.length);
    expect(notes.map((e) => e.pitches[0].step).join('')).toBe('CDEFGABCBAGF');
    expect(steps(ed.score, 1)).toEqual(['G', 'A', 'B']);
    expect(steps(ed.score, 2)).toEqual(['C', 'B', 'A']);
    expect(steps(ed.score, 3)).toEqual(['G', 'F', 'r']);
    ed.score.measures.forEach((_, m) => expect(total(ed.score, m)).toBe(barTicks(ed.score, m)));
    // lengthening the last note of a 3/4 bar keeps the bar exactly full
    ed.setCursor({ m: 1, s: 0, i: 2 });
    ed.setDuration('h');
    expect(total(ed.score, 1)).toBe(barTicks(ed.score, 1));
  });

  it('key change: typed notes follow the new key from that bar on', () => {
    const ed = melody();
    ed.setBarChanges(2, { key: 1 }); // G major from bar 3
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.typeLetter('F');
    ed.setCursor({ m: 2, s: 0, i: 0 });
    ed.typeLetter('F');
    expect(lane(ed.score, 0, 0)[0].pitches[0].alter).toBe(0);
    expect(lane(ed.score, 2, 0)[0].pitches[0].alter).toBe(1);
    expect(contexts(ed.score).map((c) => c.key)).toEqual([0, 0, 1, 1]);
  });

  it('clef change: mouse entry reads the new clef', () => {
    const ed = melody();
    ed.setBarChanges(1, { clef: { s: 0, clef: 'bass' } });
    expect(ed.pitchAt(0, 0, 0)).toMatchObject({ step: 'F', octave: 5 }); // treble top line
    expect(ed.pitchAt(0, 0, 1)).toMatchObject({ step: 'A', octave: 3 }); // bass top line
  });

  it('tempo change: playback slows down and MIDI writes a tempo map', () => {
    const ed = melody(2);
    ed.score.tempo = 120;
    ed.setBarChanges(1, { tempo: { bpm: 60, text: 'Adagio' } });
    const { events, length, tempos } = timeline(ed.score);
    const bar2 = events.find((e) => e.m === 1 && e.i === 0)!;
    expect(bar2.time).toBeCloseTo(2); // 4 beats at 120
    expect(length).toBeCloseTo(2 + 4); // then 4 beats at 60
    expect(tempos.map((t) => t.bpm)).toEqual([120, 60]);
    const midi = Array.from(toMidi(ed.score));
    const tempoEvents = midi.filter((b, k) => b === 0xff && midi[k + 1] === 0x51).length;
    expect(tempoEvents).toBe(2);
  });

  it('rehearsal letters count on from earlier marks', () => {
    const ed = melody();
    expect(ed.nextRehearsalLetter(0)).toBe('A');
    ed.setBarChanges(0, { rehearsal: 'A' });
    expect(ed.nextRehearsalLetter(2)).toBe('B');
  });
});

describe('lines, grace notes and tuplets', () => {
  const fourNotes = () => {
    const ed = melody(2);
    for (const l of ['C', 'D', 'E', 'F'] as const) ed.typeLetter(l);
    return ed;
  };

  it('hairpins raise or lower the volume along the line', () => {
    const ed = fourNotes();
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.stepMeasure(1, true);
    expect(ed.toggleSpan('cresc')).toBe(true);
    const bar = lane(ed.score, 0, 0);
    expect(bar[0].spans).toEqual([{ kind: 'cresc', end: bar[3].id }]);
    const v = timeline(ed.score).notes.map((n) => n.velocity);
    expect(v[3]).toBeGreaterThan(v[0]);
    // a diminuendo on the same note replaces the crescendo
    ed.toggleSpan('dim');
    expect(lane(ed.score, 0, 0)[0].spans).toEqual([{ kind: 'dim', end: bar[3].id }]);
  });

  it('pedal sustains notes until it lifts; 8va sounds an octave higher', () => {
    const ed = fourNotes();
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.step(1, true);
    ed.step(1, true);
    ed.toggleSpan('pedal'); // C..E
    const notes = timeline(ed.score).notes;
    expect(notes[0].duration).toBeCloseTo(notes[2].time + notes[2].duration - notes[0].time); // C rings to the end of E
    ed.setCursor({ m: 0, s: 0, i: 3 });
    ed.toggleSpan('8va');
    const f = timeline(ed.score).notes.find((n) => n.time > notes[2].time + 0.01)!;
    expect(f.midi).toBe(77 + 12); // F5 written, sounding F6
  });

  it('grace notes are added above the note and play just before it', () => {
    const ed = fourNotes();
    ed.setCursor({ m: 0, s: 0, i: 1 }); // D5 (typing starts near the treble staff's middle)
    ed.addGrace();
    expect(lane(ed.score, 0, 0)[1].graces).toEqual([{ pitches: [{ step: 'E', alter: 0, octave: 5 }] }]);
    const notes = timeline(ed.score).notes;
    const grace = notes.find((n) => n.midi === 76 && n.duration < 0.1)!;
    const main = notes.find((n) => n.midi === 74)!;
    expect(grace.time).toBeLessThan(main.time);
  });

  it('quintuplets fill the beat with quintuplet rests and form one group', () => {
    const ed = melody(1);
    ed.setDuration('16');
    ed.toggleTuplet({ actual: 5, normal: 4 });
    ed.typeLetter('C');
    const bar = lane(ed.score, 0, 0);
    expect(bar.slice(0, 5).every((e) => e.tuplet?.actual === 5)).toBe(true);
    expect(total(ed.score, 0)).toBe(4 * TPQ);
    expect(tupletGroups(bar)[0]).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('MusicXML with phase 10 notation', () => {
  it('round-trips changes, text, lines, grace notes and quintuplets', () => {
    const ed = melody(3);
    ed.setDuration('16');
    ed.toggleTuplet({ actual: 5, normal: 4 });
    for (const l of ['C', 'D', 'E', 'F', 'G'] as const) ed.typeLetter(l);
    ed.toggleTuplet({ actual: 5, normal: 4 });
    ed.setDuration('q');
    ed.typeLetter('A');
    ed.setCursor({ m: 0, s: 0, i: 0 });
    ed.stepMeasure(1, true);
    ed.toggleSpan('8va');
    ed.clearSelection();
    ed.setCursor({ m: 0, s: 0, i: 5 });
    ed.addGrace();
    ed.setText({ m: 0, s: 0, i: 0 }, 'dolce');
    ed.setBarChanges(1, { key: -2, time: { beats: 3, beatType: 4 }, tempo: { bpm: 80, text: 'Andante' }, rehearsal: 'B', clef: { s: 0, clef: 'alto' } });

    const back = fromMusicXML(toMusicXML(ed.score));
    const a = lane(ed.score, 0, 0);
    const b = lane(back, 0, 0);
    expect(b.map((e) => e.pitches)).toEqual(a.map((e) => e.pitches)); // written pitches survive 8va
    expect(b.slice(0, 5).map((e) => e.tuplet)).toEqual(a.slice(0, 5).map((e) => e.tuplet));
    expect(b[0].text).toBe('dolce');
    expect(b[0].spans?.[0].kind).toBe('8va');
    expect(b[0].spans?.[0].end).toBe(b[a.findIndex((e) => e.id === a[0].spans![0].end)].id);
    expect(b[5].graces).toEqual(a[5].graces);
    const bar2 = back.measures[1];
    expect(bar2).toMatchObject({ key: -2, time: { beats: 3, beatType: 4 }, tempo: { bpm: 80, text: 'Andante' }, rehearsal: 'B' });
    expect(bar2.clefs?.[0]).toBe('alto');
  });
});
