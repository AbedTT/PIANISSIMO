// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TPQ } from '../model/duration';
import { midiOf } from '../model/pitch';
import { eventTicks, lane, newScore, writeAt, writeStream } from '../model/score';
import { TRIPLET } from '../model/types';
import { toMidi } from './midi';
import { midiToScore, notesToStream, parseMidi } from './midiImport';
import { encodeWav } from '../audio/render';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

const notesOf = (s: ReturnType<typeof newScore>, st = 0) =>
  s.measures.flatMap((m) => m.staves[st]).filter((e) => e.pitches.length);

describe('MIDI file import', () => {
  it('reads tempo, meter and notes back from our own MIDI export', () => {
    const s = newScore({ measures: 2, tempo: 90, timeBeats: 3, staves: [{ clef: 'treble' }] });
    const melody: [string, number, 'q' | 'h' | '8'][] = [['C', 5, 'q'], ['E', 5, '8'], ['F', 5, '8'], ['G', 5, 'q'], ['A', 5, 'h'], ['G', 5, 'q']];
    let i = 0;
    let m = 0;
    let used = 0;
    for (const [step, octave, type] of melody) {
      const len = { q: TPQ, h: 2 * TPQ, '8': TPQ / 2 }[type];
      if (used + len > 3 * TPQ) {
        m++;
        i = 0;
        used = 0;
      }
      writeAt(s, m, 0, i++, { pitches: [{ step: step as 'C', alter: 0, octave }], type, dots: 0 });
      used += len;
    }
    const file = parseMidi(toMidi(s));
    expect(file).toMatchObject({ bpm: 90, beats: 3, beatType: 4 });
    const back = midiToScore(toMidi(s));
    expect(notesOf(back).map((e) => `${e.pitches[0].step}${e.pitches[0].octave}:${e.type}`)).toEqual(
      notesOf(s).map((e) => `${e.pitches[0].step}${e.pitches[0].octave}:${e.type}`),
    );
  });

  it('detects triplets from timing alone', () => {
    const s = newScore({ measures: 1, staves: [{ clef: 'treble' }] });
    for (let k = 0; k < 3; k++) writeAt(s, 0, 0, k, { pitches: [{ step: 'C', alter: 0, octave: 5 }], type: '8', dots: 0, tuplet: TRIPLET });
    writeAt(s, 0, 0, 3, { pitches: [{ step: 'D', alter: 0, octave: 5 }], type: 'h', dots: 1 });
    const back = midiToScore(toMidi(s));
    const bar = lane(back, 0, 0);
    expect(bar.slice(0, 3).every((e) => e.tuplet?.actual === 3)).toBe(true);
    expect(bar[3]).toMatchObject({ type: 'h', dots: 1 });
  });

  it('splits a wide piano track onto a grand staff', () => {
    const s = newScore({ measures: 1, staves: [{ clef: 'treble' }] });
    writeAt(s, 0, 0, 0, { pitches: [{ step: 'C', alter: 0, octave: 3 }, { step: 'E', alter: 0, octave: 5 }], type: 'w', dots: 0 });
    const back = midiToScore(toMidi(s));
    expect(back.staves.map((st) => st.clef)).toEqual(['treble', 'bass']);
    expect(midiOf(lane(back, 0, 0)[0].pitches[0])).toBe(76);
    expect(midiOf(lane(back, 0, 1)[0].pitches[0])).toBe(48);
  });

  it('quantises sloppy human timing to the 16th grid', () => {
    const items = notesToStream(
      [
        { start: 8, end: 470, midi: 60, velocity: 0.7 }, // slightly late quarter
        { start: 475, end: 715, midi: 62, velocity: 0.7 }, // slightly early eighth
        { start: 722, end: 960, midi: 64, velocity: 0.7 },
      ],
      0,
    );
    expect(items.map((i) => i.ticks)).toEqual([TPQ, TPQ / 2, TPQ / 2]);
  });
});

describe('writing streams and audio files', () => {
  it('lays a stream into bars, tying across bar lines and adding bars', () => {
    const s = newScore({ measures: 1, staves: [{ clef: 'treble' }] });
    const C = [{ step: 'C' as const, alter: 0, octave: 5 }];
    writeStream(s, 0, [{ pitches: C, ticks: 3 * TPQ }, { pitches: C, ticks: 2 * TPQ }, { pitches: [], ticks: TPQ }]);
    expect(s.measures).toHaveLength(2);
    expect(lane(s, 0, 0).at(-1)).toMatchObject({ tie: true });
    expect(s.measures.every((m) => m.staves[0].reduce((a, e) => a + eventTicks(e), 0) === 4 * TPQ)).toBe(true);
  });

  it('encodes a valid 16-bit stereo WAV', async () => {
    const frames = 100;
    const fake = {
      numberOfChannels: 2,
      length: frames,
      sampleRate: 44100,
      getChannelData: (c: number) => Float32Array.from({ length: frames }, (_, i) => (c ? -0.5 : 0.5) * Math.sin(i)),
    } as unknown as AudioBuffer;
    const bytes = new Uint8Array(await encodeWav(fake).arrayBuffer());
    const text = (a: number, n: number) => String.fromCharCode(...bytes.slice(a, a + n));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(bytes.length).toBe(44 + frames * 2 * 2);
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
  });
});
