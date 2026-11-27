import { describe, expect, it } from 'vitest';
import { detectPitch, freqToMidi, NoteTracker, rms } from './pitchDetect';

const RATE = 44100;
/** One window of a tone with optional overtones (amplitude per harmonic). */
function tone(freq: number, harmonics = [1], n = 1024, phase = 0) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    harmonics.forEach((a, k) => (v += a * Math.sin((2 * Math.PI * freq * (k + 1) * (i + phase)) / RATE)));
    buf[i] = 0.3 * v;
  }
  return buf;
}

describe('pitch detection', () => {
  it('finds the fundamental of pure and rich tones', () => {
    for (const f of [110, 196, 261.63, 440, 880]) {
      expect(detectPitch(tone(f), RATE)!.freq).toBeCloseTo(f, 0);
    }
    // a voice-like tone whose second harmonic is louder than the fundamental
    const rich = detectPitch(tone(220, [0.6, 1, 0.5, 0.3]), RATE)!;
    expect(Math.round(freqToMidi(rich.freq))).toBe(57); // A3, not A4
    expect(rich.clarity).toBeGreaterThan(0.85);
  });

  it('reports noise as unclear', () => {
    let seed = 7;
    const noise = new Float32Array(1024).map(() => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.3);
    const r = detectPitch(noise, RATE);
    expect(r === null || r.clarity < 0.85).toBe(true);
    expect(rms(new Float32Array(64))).toBe(0);
  });
});

describe('note tracking', () => {
  const frames = (spec: [number | null, number][], step = 20) => {
    const out: { t: number; midi: number | null; rms: number }[] = [];
    let t = 0;
    for (const [midi, count] of spec) for (let k = 0; k < count; k++, t += step) out.push({ t, midi, rms: midi === null ? 0 : 0.2 });
    return out;
  };

  it('turns steady pitches into notes, ignoring wobbles and blips', () => {
    const tr = new NoteTracker();
    // C4 with vibrato, a one-frame glitch, silence, then E4, then a 2-frame blip
    for (const f of frames([[60.2, 10], [59.8, 5], [67, 1], [60.1, 4], [null, 5], [64, 12], [null, 4], [70, 2], [null, 4]])) tr.push(f);
    tr.flush(2000);
    expect(tr.notes.map((n) => n.midi)).toEqual([60, 64]);
    expect(tr.notes[0].start).toBe(0);
    expect(tr.notes[0].end).toBe(400); // when it went quiet
    expect(tr.notes[1].end - tr.notes[1].start).toBe(240);
  });

  it('splits a legato change of pitch without silence', () => {
    const tr = new NoteTracker();
    for (const f of frames([[62, 8], [65, 8]])) tr.push(f);
    tr.flush(320);
    expect(tr.notes.map((n) => [n.midi, n.start, n.end])).toEqual([
      [62, 0, 160],
      [65, 160, 320],
    ]);
  });
});
