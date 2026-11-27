import { describe, expect, it } from 'vitest';
import { outputToNotes } from './basicPitch';

/** Model output for `n` frames: each note [key index, first frame, last frame], with an onset peak at its start. */
function activations(n: number, notes: [number, number, number][], quiet: [number, number, number][] = []) {
  const frames = Array.from({ length: n }, () => new Array<number>(88).fill(0.02));
  const onsets = Array.from({ length: n }, () => new Array<number>(88).fill(0.01));
  for (const [key, a, b] of notes) {
    for (let f = a; f <= b; f++) frames[f][key] = 0.8;
    onsets[a][key] = 0.9;
    if (a > 0) onsets[a - 1][key] = 0.3;
    if (a + 1 < n) onsets[a + 1][key] = 0.3;
  }
  // energy without a clear onset (picked up by the "melodia trick")
  for (const [key, a, b] of quiet) for (let f = a; f <= b; f++) frames[f][key] = 0.5;
  return { frames, onsets };
}

describe('Basic Pitch: model output to notes', () => {
  it('finds a chord and a melody note from the onsets and frames', () => {
    // C major chord (C4 E4 G4 = keys 39, 43, 46) on frames 10–60, then A4 (48) on frames 70–100
    const { frames, onsets } = activations(120, [[39, 10, 60], [43, 10, 60], [46, 10, 60], [48, 70, 100]]);
    const notes = outputToNotes(frames, onsets, 0.5, 0.3, 8).sort((a, b) => a.startFrame - b.startFrame || a.pitchMidi - b.pitchMidi);
    expect(notes.map((n) => [n.pitchMidi, n.startFrame, n.startFrame + n.durationFrames])).toEqual([
      [60, 10, 61],
      [64, 10, 61],
      [67, 10, 61],
      [69, 70, 101],
    ]);
    expect(notes[0].amplitude).toBeCloseTo(0.8, 1);
  });

  it('drops notes shorter than the minimum, and keeps a held note that has no onset', () => {
    const { frames, onsets } = activations(120, [[39, 10, 14]], [[51, 40, 90]]);
    const notes = outputToNotes(frames, onsets, 0.5, 0.3, 8);
    expect(notes.map((n) => n.pitchMidi)).toEqual([72]);
    expect(notes[0].startFrame).toBe(40);
  });

  it('says nothing about silence', () => {
    const { frames, onsets } = activations(50, []);
    expect(outputToNotes(frames, onsets)).toEqual([]);
  });
});
