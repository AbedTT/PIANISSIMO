/**
 * Instrument sounds. Sampled instruments stream from the free FluidR3 General MIDI
 * soundfont (gleitz/midi-js-soundfonts, CORS-enabled); the concert piano uses the
 * Salamander Grand samples; "synth" sounds are generated in the browser and work offline.
 */
export interface SoundDef {
  id: string;
  name: string;
  group: string;
  /** General MIDI program (0-based), used for MIDI/MusicXML export. */
  program: number;
  /** FluidR3 folder name (without -mp3) for sampled sounds. */
  gm?: string;
  synth?: 'epiano' | 'pad' | 'chip' | 'bells';
}

export const DEFAULT_SOUND = 'piano';

export const SOUNDS: SoundDef[] = [
  { id: 'piano', name: 'Concert grand piano', group: 'Keyboards', program: 0 },
  { id: 'bright_piano', name: 'Bright piano', group: 'Keyboards', program: 1, gm: 'bright_acoustic_piano' },
  { id: 'electric_piano', name: 'Electric piano', group: 'Keyboards', program: 4, gm: 'electric_piano_1' },
  { id: 'harpsichord', name: 'Harpsichord', group: 'Keyboards', program: 6, gm: 'harpsichord' },
  { id: 'church_organ', name: 'Church organ', group: 'Keyboards', program: 19, gm: 'church_organ' },
  { id: 'accordion', name: 'Accordion', group: 'Keyboards', program: 21, gm: 'accordion' },

  { id: 'celesta', name: 'Celesta', group: 'Mallets & bells', program: 8, gm: 'celesta' },
  { id: 'music_box', name: 'Music box', group: 'Mallets & bells', program: 10, gm: 'music_box' },
  { id: 'vibraphone', name: 'Vibraphone', group: 'Mallets & bells', program: 11, gm: 'vibraphone' },
  { id: 'marimba', name: 'Marimba', group: 'Mallets & bells', program: 12, gm: 'marimba' },
  { id: 'xylophone', name: 'Xylophone', group: 'Mallets & bells', program: 13, gm: 'xylophone' },

  { id: 'guitar_nylon', name: 'Classical guitar', group: 'Guitars & harp', program: 24, gm: 'acoustic_guitar_nylon' },
  { id: 'guitar_steel', name: 'Acoustic guitar', group: 'Guitars & harp', program: 25, gm: 'acoustic_guitar_steel' },
  { id: 'guitar_clean', name: 'Electric guitar (clean)', group: 'Guitars & harp', program: 27, gm: 'electric_guitar_clean' },
  { id: 'acoustic_bass', name: 'Acoustic bass', group: 'Guitars & harp', program: 32, gm: 'acoustic_bass' },
  { id: 'harp', name: 'Harp', group: 'Guitars & harp', program: 46, gm: 'orchestral_harp' },

  { id: 'violin', name: 'Violin', group: 'Strings', program: 40, gm: 'violin' },
  { id: 'viola', name: 'Viola', group: 'Strings', program: 41, gm: 'viola' },
  { id: 'cello', name: 'Cello', group: 'Strings', program: 42, gm: 'cello' },
  { id: 'contrabass', name: 'Double bass', group: 'Strings', program: 43, gm: 'contrabass' },
  { id: 'pizzicato', name: 'Pizzicato strings', group: 'Strings', program: 45, gm: 'pizzicato_strings' },
  { id: 'strings', name: 'String ensemble', group: 'Strings', program: 48, gm: 'string_ensemble_1' },

  { id: 'choir', name: 'Choir (aah)', group: 'Voices', program: 52, gm: 'choir_aahs' },

  { id: 'flute', name: 'Flute', group: 'Woodwinds', program: 73, gm: 'flute' },
  { id: 'oboe', name: 'Oboe', group: 'Woodwinds', program: 68, gm: 'oboe' },
  { id: 'clarinet', name: 'Clarinet', group: 'Woodwinds', program: 71, gm: 'clarinet' },
  { id: 'bassoon', name: 'Bassoon', group: 'Woodwinds', program: 70, gm: 'bassoon' },
  { id: 'alto_sax', name: 'Alto saxophone', group: 'Woodwinds', program: 65, gm: 'alto_sax' },
  { id: 'pan_flute', name: 'Pan flute', group: 'Woodwinds', program: 75, gm: 'pan_flute' },

  { id: 'trumpet', name: 'Trumpet', group: 'Brass', program: 56, gm: 'trumpet' },
  { id: 'trombone', name: 'Trombone', group: 'Brass', program: 57, gm: 'trombone' },
  { id: 'french_horn', name: 'French horn', group: 'Brass', program: 60, gm: 'french_horn' },
  { id: 'tuba', name: 'Tuba', group: 'Brass', program: 58, gm: 'tuba' },

  { id: 'synth_epiano', name: 'Synth e-piano (offline)', group: 'Synths (no download)', program: 5, synth: 'epiano' },
  { id: 'synth_pad', name: 'Warm pad (offline)', group: 'Synths (no download)', program: 89, synth: 'pad' },
  { id: 'synth_chip', name: '8-bit chip (offline)', group: 'Synths (no download)', program: 80, synth: 'chip' },
  { id: 'synth_bells', name: 'FM bells (offline)', group: 'Synths (no download)', program: 14, synth: 'bells' },
];

export const soundById = (id: string | undefined): SoundDef =>
  SOUNDS.find((s) => s.id === id) ?? SOUNDS[0];

/** Closest sound for a General MIDI program (for MusicXML/MIDI import). */
export function soundForProgram(program: number): string {
  const exact = SOUNDS.find((s) => s.program === program && !s.synth);
  if (exact) return exact.id;
  // nearest program in the same GM family of 8 (pianos, chromatic percussion, organs, guitars, …)
  const family = SOUNDS.filter((s) => !s.synth && Math.floor(s.program / 8) === Math.floor(program / 8));
  family.sort((a, b) => Math.abs(a.program - program) - Math.abs(b.program - program));
  return family[0]?.id ?? DEFAULT_SOUND;
}

/** Sample URLs for a FluidR3 instrument: every minor third from A0 to C8 (flat note names). */
export function gmSampleUrls(): Record<string, string> {
  const names = ['C', 'Eb', 'Gb', 'A'];
  const urls: Record<string, string> = { A0: 'A0.mp3', C8: 'C8.mp3' };
  for (let o = 1; o <= 7; o++) for (const n of names) urls[`${n}${o}`] = `${n}${o}.mp3`;
  return urls;
}

export const GM_BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/';
