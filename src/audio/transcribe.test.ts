import { describe, expect, it } from 'vitest';
import { audioToScore, estimateFirstBeat, estimateKey, estimateTempo, melodyNotes, type AudioNote } from './transcribe';

const RATE = 22050;

/** A played melody: [midi, beats] at `bpm`, each note a tone with overtones, slightly detached. */
function play(melody: [number | null, number][], bpm: number, opts: { lead?: number; vibrato?: number; noise?: number } = {}) {
  const beat = 60 / bpm;
  const lead = opts.lead ?? 0.3;
  const total = lead + melody.reduce((a, [, b]) => a + b, 0) * beat + 0.5;
  const out = new Float32Array(Math.ceil(total * RATE));
  let t = lead;
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const [midi, beats] of melody) {
    const len = beats * beat * 0.92; // a small gap before the next note
    if (midi !== null) {
      const f0 = 440 * 2 ** ((midi - 69) / 12);
      const start = Math.floor(t * RATE);
      let phase = 0;
      for (let i = 0; i < len * RATE; i++) {
        const time = i / RATE;
        const env = Math.min(1, time / 0.01) * Math.min(1, (len - time) / 0.03) * Math.exp(-time * 0.8);
        const f = f0 * (1 + (opts.vibrato ?? 0) * Math.sin(2 * Math.PI * 5.5 * time));
        phase += (2 * Math.PI * f) / RATE;
        out[start + i] += 0.3 * env * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase) + 0.15 * Math.sin(4 * phase));
      }
    }
    t += beats * beat;
  }
  if (opts.noise) for (let i = 0; i < out.length; i++) out[i] += opts.noise * rand();
  return out;
}

// "Ode to joy" (bars 1–4) in G major: B B C D | D C B A | G G A B | B. A A_
const ODE: [number, number][] = [
  [71, 1], [71, 1], [72, 1], [74, 1],
  [74, 1], [72, 1], [71, 1], [69, 1],
  [67, 1], [67, 1], [69, 1], [71, 1],
  [71, 1.5], [69, 0.5], [69, 2],
];

describe('recordings to notes: a melody', () => {
  it('hears every note of a sung or played line, including repeated notes', async () => {
    const notes = await melodyNotes(play(ODE, 100, { vibrato: 0.004, noise: 0.003 }), RATE);
    expect(notes.map((n) => n.midi)).toEqual(ODE.map(([m]) => m));
    // the notes start where they were played (within a frame or two)
    const beat = 0.6;
    notes.forEach((n, i) => {
      const at = 0.3 + ODE.slice(0, i).reduce((a, [, b]) => a + b, 0) * beat;
      expect(Math.abs(n.start - at)).toBeLessThan(0.04);
    });
  });

  it('follows low and high instruments (a cello line, a flute line)', async () => {
    const low: [number, number][] = [[43, 1], [47, 1], [50, 1], [55, 1]]; // G2 B2 D3 G3
    const high: [number, number][] = [[84, 1], [88, 1], [91, 1], [96, 1]]; // C6 E6 G6 C7
    expect((await melodyNotes(play(low, 90), RATE)).map((n) => n.midi)).toEqual([43, 47, 50, 55]);
    expect((await melodyNotes(play(high, 90), RATE)).map((n) => n.midi)).toEqual([84, 88, 91, 96]);
  });

  it('says nothing about silence', async () => {
    expect(await melodyNotes(new Float32Array(RATE * 2), RATE)).toEqual([]);
  });
});

describe('recordings to notes: beat, key and the score', () => {
  const at = (bpm: number, melody: [number, number][], lead = 0.25): AudioNote[] => {
    const beat = 60 / bpm;
    let t = lead;
    return melody.map(([midi, beats]) => {
      const n = { start: t, end: t + beats * beat * 0.9, midi, velocity: 0.8 };
      t += beats * beat;
      return n;
    });
  };

  it('finds the tempo and where the beat falls', () => {
    for (const bpm of [72, 100, 132]) {
      const notes = at(bpm, ODE);
      const { bpm: found, beat } = estimateTempo(notes);
      expect(Math.abs(found - bpm)).toBeLessThan(1);
      const period = 60 / bpm;
      const off = (((beat - 0.25) % period) + period) % period;
      expect(Math.min(off, period - off)).toBeLessThan(0.02);
    }
  });

  it('finds the key signature from the notes', () => {
    expect(estimateKey(at(100, ODE))).toBe(1); // G major
    // F major scale up and down
    const f: [number, number][] = [65, 67, 69, 70, 72, 74, 76, 77, 76, 74, 72, 70, 69, 67, 65].map((m) => [m, 1] as [number, number]);
    expect(estimateKey(at(100, f))).toBe(-1);
    // A minor (natural): no sharps or flats
    const am: [number, number][] = [57, 60, 64, 69, 67, 65, 64, 62, 60, 59, 57].map((m) => [m, 1] as [number, number]);
    expect(estimateKey(at(100, am))).toBe(0);
  });

  it('writes the score in bars, quantised, from the first bar line', async () => {
    // a little rubato: each note up to 25 ms early or late
    const wobble = [0.01, -0.02, 0.015, -0.01, 0.02, -0.015, 0, 0.025, -0.02, 0.01, -0.005, 0.015, -0.01, 0.02, 0];
    const notes = at(100, ODE).map((n, i) => ({ ...n, start: n.start + wobble[i] }));
    const { bpm, beat } = estimateTempo(notes);
    const firstBeat = estimateFirstBeat(notes, bpm, beat, 4);
    expect(firstBeat).toBe(1);
    const score = audioToScore(notes, { title: 'Ode', bpm, beat, firstBeat, beats: 4, beatType: 4, keyFifths: estimateKey(notes), sound: 'flute', name: 'Flute' });
    expect(score.tempo).toBe(100);
    expect(score.keyFifths).toBe(1);
    expect(score.staves).toEqual([{ clef: 'treble', sound: 'flute' }]);
    const bars = score.measures.map((m) =>
      m.staves[0].map((e) => `${e.pitches.map((p) => `${p.step}${p.octave}`).join('') || 'r'}:${e.type}${'.'.repeat(e.dots)}`).join(' '),
    );
    expect(bars).toEqual([
      'B4:q B4:q C5:q D5:q',
      'D5:q C5:q B4:q A4:q',
      'G4:q G4:q A4:q B4:q',
      'B4:q. A4:8 A4:h',
    ]);
    // the same tune with a one-beat pickup: the first note on beat 4
    const pickup = audioToScore(notes, { title: 'Ode', bpm, beat, firstBeat: 4, beats: 4, beatType: 4, keyFifths: 1, sound: 'flute', name: 'Flute' });
    expect(pickup.measures[0].staves[0].map((e) => (e.pitches.length ? `${e.pitches[0].step}${e.pitches[0].octave}` : `r${e.type}`))).toEqual(['rh', 'rq', 'B4']);
  });
});
