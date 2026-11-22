import type { Step } from './types';

/** MusicXML <kind> values for common chord-symbol suffixes (first match wins on export). */
const KINDS: [string[], string][] = [
  [[''], 'major'],
  [['m', 'min', '-'], 'minor'],
  [['7'], 'dominant'],
  [['maj7', 'M7', 'Δ7', 'Δ', 'ma7'], 'major-seventh'],
  [['m7', 'min7', '-7'], 'minor-seventh'],
  [['dim', '°', 'o'], 'diminished'],
  [['dim7', '°7', 'o7'], 'diminished-seventh'],
  [['aug', '+'], 'augmented'],
  [['m7b5', 'ø', 'ø7', 'min7b5', '-7b5'], 'half-diminished'],
  [['sus4', 'sus'], 'suspended-fourth'],
  [['sus2'], 'suspended-second'],
  [['6'], 'major-sixth'],
  [['m6', 'min6'], 'minor-sixth'],
  [['9'], 'dominant-ninth'],
  [['maj9', 'M9'], 'major-ninth'],
  [['m9', 'min9'], 'minor-ninth'],
  [['11'], 'dominant-11th'],
  [['13'], 'dominant-13th'],
  [['mMaj7', 'mM7', 'm(maj7)'], 'major-minor'],
  [['5'], 'power'],
];

export interface ChordSymbol {
  root: { step: Step; alter: number };
  /** Text after the root, e.g. "m7b5". */
  suffix: string;
  /** MusicXML kind; "other" when the suffix is not a standard kind. */
  kind: string;
  bass?: { step: Step; alter: number };
}

const NOTE = /^([A-Ga-g])(#|♯|b|♭)?/;

function parseNote(s: string): { step: Step; alter: number; len: number } | null {
  const m = NOTE.exec(s);
  if (!m) return null;
  const acc = m[2];
  return {
    step: m[1].toUpperCase() as Step,
    alter: acc === '#' || acc === '♯' ? 1 : acc === 'b' || acc === '♭' ? -1 : 0,
    len: m[0].length,
  };
}

/** Parse "F#m7b5", "Bbmaj7", "G/B". Returns null for text that is not a chord symbol. */
export function parseChord(text: string): ChordSymbol | null {
  const t = text.trim();
  const root = parseNote(t);
  if (!root) return null;
  let rest = t.slice(root.len);
  let bass: ChordSymbol['bass'];
  const slash = rest.lastIndexOf('/');
  if (slash >= 0) {
    const b = parseNote(rest.slice(slash + 1));
    if (b && b.len === rest.length - slash - 1) {
      bass = { step: b.step, alter: b.alter };
      rest = rest.slice(0, slash);
    }
  }
  const kind = KINDS.find(([names]) => names.includes(rest))?.[1] ?? 'other';
  return { root: { step: root.step, alter: root.alter }, suffix: rest, kind, ...(bass ? { bass } : {}) };
}

/** Suffix text for a MusicXML kind (used on import when no text attribute is given). */
export function suffixForKind(kind: string): string {
  return KINDS.find(([, k]) => k === kind)?.[0][0] ?? '';
}

const accText = (alter: number) => (alter > 0 ? '♯' : alter < 0 ? '♭' : '');

/** Display form with real accidental glyphs: "F#m7b5" -> "F♯m7♭5". */
export function prettyChord(text: string): string {
  const c = parseChord(text);
  if (!c) return text;
  const suffix = c.suffix.replace(/b(?=\d)/g, '♭').replace(/#(?=\d)/g, '♯');
  const bass = c.bass ? `/${c.bass.step}${accText(c.bass.alter)}` : '';
  return `${c.root.step}${accText(c.root.alter)}${suffix}${bass}`;
}

export function chordToText(c: Omit<ChordSymbol, 'kind'>): string {
  const n = (x: { step: Step; alter: number }) => `${x.step}${x.alter > 0 ? '#' : x.alter < 0 ? 'b' : ''}`;
  return `${n(c.root)}${c.suffix}${c.bass ? `/${n(c.bass)}` : ''}`;
}

const SEMITONE: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Intervals (semitones above the root) for each MusicXML kind. */
const KIND_INTERVALS: Record<string, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dominant: [0, 4, 7, 10],
  'major-seventh': [0, 4, 7, 11],
  'minor-seventh': [0, 3, 7, 10],
  diminished: [0, 3, 6],
  'diminished-seventh': [0, 3, 6, 9],
  augmented: [0, 4, 8],
  'half-diminished': [0, 3, 6, 10],
  'suspended-fourth': [0, 5, 7],
  'suspended-second': [0, 2, 7],
  'major-sixth': [0, 4, 7, 9],
  'minor-sixth': [0, 3, 7, 9],
  'dominant-ninth': [0, 4, 7, 10, 14],
  'major-ninth': [0, 4, 7, 11, 14],
  'minor-ninth': [0, 3, 7, 10, 14],
  'dominant-11th': [0, 7, 10, 14, 17],
  'dominant-13th': [0, 4, 10, 14, 21],
  'major-minor': [0, 3, 7, 11],
  power: [0, 7],
};

/** Best-effort intervals for suffixes that are not a standard kind ("add9", "7b9", "m11"…). */
function guessIntervals(suffix: string): number[] {
  const minor = /^(m(?!aj)|min|-)/.test(suffix);
  const set = new Set<number>([0, minor ? 3 : 4, 7]);
  if (/sus4|sus(?!2)/.test(suffix)) {
    set.delete(3);
    set.delete(4);
    set.add(5);
  }
  if (/sus2/.test(suffix)) {
    set.delete(3);
    set.delete(4);
    set.add(2);
  }
  if (/maj7|M7|Δ/.test(suffix)) set.add(11);
  else if (/7|(?<!add)9|11|13/.test(suffix)) set.add(10); // "add9" has no 7th
  if (/b5|-5|dim/.test(suffix)) {
    set.delete(7);
    set.add(6);
  }
  if (/#5|\+5|aug/.test(suffix)) {
    set.delete(7);
    set.add(8);
  }
  if (/add9|(?<![b#])9/.test(suffix)) set.add(14);
  if (/b9/.test(suffix)) set.add(13);
  if (/#9/.test(suffix)) set.add(15);
  if (/6/.test(suffix)) set.add(9);
  return [...set].sort((a, b) => a - b);
}

/**
 * MIDI notes for a chord symbol: a bass note (slash bass or root) around C2–B2 and
 * close-position chord tones starting at or above G3. Null when the text is not a chord.
 */
export function chordVoicing(text: string): { bass: number; tones: number[] } | null {
  const c = parseChord(text);
  if (!c) return null;
  const rootPc = (SEMITONE[c.root.step] + c.root.alter + 12) % 12;
  const intervals = KIND_INTERVALS[c.kind] ?? guessIntervals(c.suffix);
  const bassPc = c.bass ? (SEMITONE[c.bass.step] + c.bass.alter + 12) % 12 : rootPc;
  const bass = 36 + bassPc; // C2..B2
  let base = 48 + rootPc; // C3..B3
  if (base < 55) base += 12; // keep the voicing at or above G3, below about E5
  return { bass, tones: intervals.map((i) => base + i) };
}

/** Transpose a chord symbol by semitones, spelling with sharps or flats. */
export function transposeChord(text: string, semitones: number, preferFlats: boolean): string {
  const c = parseChord(text);
  if (!c) return text;
  const spell = (pc: number) => {
    const sharp = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const flat = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    return (preferFlats ? flat : sharp)[((pc % 12) + 12) % 12];
  };
  const shift = (n: { step: Step; alter: number }) => spell(SEMITONE[n.step] + n.alter + semitones);
  return `${shift(c.root)}${c.suffix}${c.bass ? `/${shift(c.bass)}` : ''}`;
}
