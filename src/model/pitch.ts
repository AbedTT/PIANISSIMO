import { STEPS, type Clef, type Pitch, type Step } from './types';

const SEMITONE: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Alteration a step receives from the key signature. */
export function keyAlter(step: Step, fifths: number): number {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(step) ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(step) ? -1 : 0;
  return 0;
}

export function midiOf(p: Pitch): number {
  return (p.octave + 1) * 12 + SEMITONE[p.step] + p.alter;
}

/** Diatonic position (C0 = 0, D0 = 1, …). */
export function diatonic(p: Pick<Pitch, 'step' | 'octave'>): number {
  return p.octave * 7 + STEPS.indexOf(p.step);
}

export function fromDiatonic(index: number, fifths: number): Pitch {
  const octave = Math.floor(index / 7);
  const step = STEPS[((index % 7) + 7) % 7];
  return { step, octave, alter: keyAlter(step, fifths) };
}

/** Reference pitch for each clef: the middle line of the staff. */
export function clefMiddle(clef: Clef): Pitch {
  switch (clef) {
    case 'bass':
      return { step: 'D', octave: 3, alter: 0 };
    case 'alto':
      return { step: 'C', octave: 4, alter: 0 };
    default:
      return { step: 'B', octave: 4, alter: 0 };
  }
}

/** Pitch at a staff position. `halfSpaces` counts down from the top line (0 = top line). */
export function pitchAtStaffPosition(clef: Clef, halfSpaces: number, fifths: number): Pitch {
  const top = diatonic(clefMiddle(clef)) + 4;
  return fromDiatonic(top - halfSpaces, fifths);
}

/**
 * Choose the octave for `step` closest to `reference` (Flat/MuseScore style entry):
 * typing letters walks melodically instead of jumping around.
 */
export function nearestPitch(step: Step, reference: Pitch, fifths: number): Pitch {
  const ref = diatonic(reference);
  let best: Pitch | null = null;
  let bestDist = Infinity;
  for (let oct = reference.octave - 1; oct <= reference.octave + 1; oct++) {
    const d = Math.abs(diatonic({ step, octave: oct }) - ref);
    if (d < bestDist) {
      bestDist = d;
      best = { step, octave: oct, alter: keyAlter(step, fifths) };
    }
  }
  return best!;
}

/** Move a pitch by diatonic steps, re-applying the key signature. */
export function shiftDiatonic(p: Pitch, steps: number, fifths: number): Pitch {
  return fromDiatonic(diatonic(p) + steps, fifths);
}

export function pitchName(p: Pitch): string {
  const acc = p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter);
  return `${p.step}${acc}${p.octave}`;
}

/** Spelled enharmonic alternative (C# <-> Db etc.). Returns the input if none is sensible. */
export function enharmonic(p: Pitch): Pitch {
  const midi = midiOf(p);
  const idx = STEPS.indexOf(p.step);
  const candidates: Pitch[] = [];
  for (const dir of [1, -1]) {
    const ni = idx + dir;
    const step = STEPS[(ni + 7) % 7];
    const octave = p.octave + (ni > 6 ? 1 : ni < 0 ? -1 : 0);
    const alter = midi - ((octave + 1) * 12 + SEMITONE[step]);
    if (Math.abs(alter) <= 2) candidates.push({ step, octave, alter });
  }
  // prefer single accidentals
  candidates.sort((a, b) => Math.abs(a.alter) - Math.abs(b.alter));
  return candidates.find((c) => Math.abs(c.alter) <= 1) ?? p;
}

export const KEY_NAMES: Record<number, string> = {
  [-7]: 'Cb', [-6]: 'Gb', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F',
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
};

/**
 * Spell a MIDI note number in a key: notes in the key use the key's spelling,
 * others use sharps in sharp keys and flats in flat keys.
 */
export function spellMidi(midi: number, fifths: number): Pitch {
  const pc = ((midi % 12) + 12) % 12;
  const octaveOf = (step: Step, alter: number) => Math.floor((midi - SEMITONE[step] - alter) / 12) - 1;
  for (const step of STEPS) {
    const alter = keyAlter(step, fifths);
    if ((SEMITONE[step] + alter + 12) % 12 === pc) return { step, alter, octave: octaveOf(step, alter) };
  }
  // a natural (e.g. F natural in G major) beats an enharmonic sharp/flat (E#)
  const order = fifths < 0 ? [0, -1, 1] : [0, 1, -1];
  for (const alter of order) {
    for (const step of STEPS) {
      if ((SEMITONE[step] + alter + 12) % 12 === pc) return { step, alter, octave: octaveOf(step, alter) };
    }
  }
  return { step: 'C', alter: 0, octave: Math.floor(midi / 12) - 1 };
}
