import { diatonic } from './pitch';
import type { Pitch, Step } from './types';

/**
 * Drum kit on a percussion staff: each staff position is one drum, as in most drum
 * notation (kick in the bottom space, snare on the third space, hi-hat above the staff).
 * Notes keep an ordinary Pitch for their position; the sound is looked up here.
 */
export interface DrumSound {
  name: string;
  /** General MIDI percussion key (channel 10). */
  midi: number;
  step: Step;
  octave: number;
  /** Cymbals and hi-hats use an x notehead. */
  x?: boolean;
}

export const DRUM_KIT: DrumSound[] = [
  { name: 'Pedal hi-hat', midi: 44, step: 'D', octave: 4, x: true },
  { name: 'Kick', midi: 36, step: 'F', octave: 4 },
  { name: 'Floor tom', midi: 41, step: 'A', octave: 4 },
  { name: 'Snare', midi: 38, step: 'C', octave: 5 },
  { name: 'Mid tom', midi: 47, step: 'D', octave: 5 },
  { name: 'High tom', midi: 50, step: 'E', octave: 5 },
  { name: 'Ride cymbal', midi: 51, step: 'F', octave: 5, x: true },
  { name: 'Hi-hat', midi: 42, step: 'G', octave: 5, x: true },
  { name: 'Crash cymbal', midi: 49, step: 'A', octave: 5, x: true },
];

/** The drum at a staff position (positions between drums use the nearest one below). */
export function drumAt(p: Pitch): DrumSound {
  const d = diatonic(p);
  let best = DRUM_KIT[0];
  for (const drum of DRUM_KIT) if (diatonic({ step: drum.step, octave: drum.octave }) <= d) best = drum;
  return best;
}

/** Staff position of the drum for a General MIDI percussion key (for MIDI/MusicXML import). */
export function drumForMidi(midi: number): DrumSound {
  const exact = DRUM_KIT.find((d) => d.midi === midi);
  if (exact) return exact;
  // close relatives in the GM drum map
  const alias: Record<number, number> = { 35: 36, 37: 38, 40: 38, 43: 41, 45: 47, 48: 50, 46: 42, 52: 49, 55: 49, 57: 49, 53: 51, 59: 51 };
  return DRUM_KIT.find((d) => d.midi === alias[midi]) ?? DRUM_KIT.find((d) => d.name === 'Snare')!;
}

export const drumPitch = (d: DrumSound): Pitch => ({ step: d.step, alter: 0, octave: d.octave });
