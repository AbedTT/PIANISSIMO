// Pianissimo score model. Mirrors MusicXML concepts (parts -> measures -> notes)
// but is intentionally small and typed.

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

export interface Pitch {
  step: Step;
  /** -2 double flat … +2 double sharp */
  alter: number;
  octave: number;
}

/** Base note value. */
export type DurationType = 'w' | 'h' | 'q' | '8' | '16' | '32' | '64';
export const DURATION_TYPES: DurationType[] = ['w', 'h', 'q', '8', '16', '32', '64'];

/** `percussion`: a drum staff; each line/space is a drum sound (see model/drums.ts). */
export type Clef = 'treble' | 'bass' | 'alto' | 'percussion';

export type Articulation = 'staccato' | 'accent' | 'tenuto' | 'marcato' | 'fermata';
export type Dynamic = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff' | 'sfz';

export interface NoteEvent {
  id: string;
  /** Empty array = rest. */
  pitches: Pitch[];
  type: DurationType;
  dots: number;
  /** Tie from this event into the next event on the same staff. */
  tie?: boolean;
  /** Tuplet ratio, e.g. a triplet is 3 notes in the time of 2. */
  tuplet?: Tuplet;
  /** Slur from this note to the event with this id (same staff). */
  slurEnd?: string;
  articulations?: Articulation[];
  dynamic?: Dynamic;
  /** Verse 1 lyric syllable; `hyphen` joins it to the next syllable of the same word. */
  lyric?: Lyric;
  /** Verses 2, 3, … (index 0 = verse 2). Use the helpers in model/lyrics.ts. */
  extraVerses?: (Lyric | null)[];
  /** Chord symbol shown above the staff, e.g. "Cmaj7", "F#m7b5", "G/B". */
  harmony?: string;
  /** Staff text above the note ("dolce", "rit.", "swing"…). */
  text?: string;
  /** Lines that start at this note and end at another note of the same lane. */
  spans?: Span[];
  /** Grace notes played just before this note (acciaccature, slashed). */
  graces?: Grace[];
  /** Single-note tremolo: 1–3 strokes through the stem (repeated 8ths, 16ths or 32nds). */
  tremolo?: number;
}

export type SpanKind = 'cresc' | 'dim' | 'pedal' | '8va' | '8vb';

export interface Span {
  kind: SpanKind;
  /** id of the last note covered */
  end: string;
}

export interface Grace {
  pitches: Pitch[];
}

export interface Lyric {
  text: string;
  hyphen?: boolean;
}

export interface Tuplet {
  actual: number;
  normal: number;
}
export const TRIPLET: Tuplet = { actual: 3, normal: 2 };

export interface StaffDef {
  clef: Clef;
  /** Playback sound id (see audio/sounds.ts); defaults to the concert piano. */
  sound?: string;
  /** Show guitar tablature under this staff (worked out from the notes, standard tuning). */
  tab?: boolean;
  /** Mixer (set for every staff of a part): volume 0–1.5 (1 = as written), mute, solo. */
  volume?: number;
  mute?: boolean;
  solo?: boolean;
}

export interface Measure {
  /** Voice 1: one event list per staff. */
  staves: NoteEvent[][];
  /** Voices 2–4 per staff (null/missing = this staff has no such voice in this bar). */
  voice2?: (NoteEvent[] | null)[];
  voice3?: (NoteEvent[] | null)[];
  voice4?: (NoteEvent[] | null)[];
  repeatStart?: boolean;
  repeatEnd?: boolean;
  /** First/second ending: this bar is played only on that pass through the repeat. */
  volta?: number;
  /** Navigation: 𝄋 segno / 𝄌 coda sign at the start of this bar. */
  segno?: boolean;
  coda?: boolean;
  /** "To Coda" / "Fine" at the end of this bar (used after a D.C./D.S. jump). */
  toCoda?: boolean;
  fine?: boolean;
  /** Jump instruction at the end of this bar. */
  jump?: JumpType;
  /** Changes that take effect at this bar (and stay until the next change). */
  key?: number;
  time?: { beats: number; beatType: number };
  /** Clef change per staff (null = no change for that staff). */
  clefs?: (Clef | null)[];
  tempo?: { bpm: number; text?: string };
  /** Rehearsal mark shown in a box above the bar ("A", "B", "Verse"…). */
  rehearsal?: string;
  /** Start a new line (system) after this bar. */
  lineBreak?: boolean;
  /** Start a new page after this bar (printing). */
  pageBreak?: boolean;
  /** Review comments attached to this bar (not printed or exported). */
  comments?: BarComment[];
}

export interface BarComment {
  id: string;
  author: string;
  text: string;
  /** ISO time. */
  at: string;
  resolved?: boolean;
}

export type JumpType = 'dc' | 'dcFine' | 'dcCoda' | 'ds' | 'dsFine' | 'dsCoda';

export const JUMP_LABELS: Record<JumpType, string> = {
  dc: 'D.C.',
  dcFine: 'D.C. al Fine',
  dcCoda: 'D.C. al Coda',
  ds: 'D.S.',
  dsFine: 'D.S. al Fine',
  dsCoda: 'D.S. al Coda',
};

/** A named instrument made of consecutive staves (a piano has two). */
export interface Part {
  name: string;
  /** Abbreviation shown on later systems ("Vln."). */
  short: string;
  /** Number of consecutive staves (from where the previous part ends). */
  staves: number;
  /** Written minus sounding pitch in semitones (B♭ clarinet = 2, F horn = 7). */
  transpose?: number;
  /** Instrument template id (see model/parts.ts). */
  instrument?: string;
}

export type PageSize = 'a4' | 'letter';

/** Print / PDF layout settings. */
export interface PrintSettings {
  pageSize: PageSize;
  /** Staff size as a fraction of the on-screen size (smaller fits more bars per line). */
  scale: number;
}

export type AccompanimentStyle = 'block' | 'pop' | 'arpeggio' | 'waltz' | 'strum';

/** Backing generated from the chord symbols during playback. */
export interface Accompaniment {
  enabled: boolean;
  style: AccompanimentStyle;
  /** Sound id (audio/sounds.ts). */
  sound: string;
  /** Mixer volume 0–1.5 (1 = default). */
  volume?: number;
}

export interface Score {
  version: 1;
  title: string;
  composer: string;
  /** Quarter notes per minute. */
  tempo: number;
  /** Circle-of-fifths position: -7 (7 flats) … +7 (7 sharps). */
  keyFifths: number;
  timeBeats: number;
  timeBeatType: number;
  staves: StaffDef[];
  measures: Measure[];
  /** Instruments; when missing the whole score is one part. */
  parts?: Part[];
  /** Show transposing instruments at concert pitch (default) or as their players read them. */
  transposedView?: boolean;
  /** Set on an extracted part: shown under the title. */
  partName?: string;
  accompaniment?: Accompaniment;
  print?: PrintSettings;
  /** Draw guitar chord diagrams above the chord symbols. */
  chordDiagrams?: boolean;
  /** Room reverb on playback, 0 (dry) – 1. */
  reverb?: number;
  /** Swing the eighth notes (the off-beat eighth comes late, as in a triplet feel). */
  swing?: boolean;
}

export const isRest = (e: NoteEvent) => e.pitches.length === 0;
