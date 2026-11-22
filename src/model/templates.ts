import { ticksOf } from './duration';
import { scoreFromInstruments } from './parts';
import { lane, newScore, writeStream, type StreamItem } from './score';
import type { DurationType, Pitch, Score, Step } from './types';

/**
 * Starter scores for the "New score" gallery: each one is a small, playable example
 * that shows a common layout (lead sheet, waltz, blues…), ready to edit.
 */
export interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  make: () => Score;
}

/** "C5" / "F#4" / "Bb3" → pitch. */
function pitch(text: string): Pitch {
  const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d)$/.exec(text);
  if (!m) throw new Error(`Bad pitch “${text}”`);
  const alter = !m[2] ? 0 : m[2][0] === '#' ? m[2].length : -m[2].length;
  return { step: m[1] as Step, alter, octave: Number(m[3]) };
}

/**
 * A compact melody notation: space-separated `pitch:length` tokens, where pitch is
 * `C5`, a chord `C4+E4+G4` or `r` for a rest, and length is w h q 8 16 with an optional
 * dot (`q.`). Bar lines `|` are only for readability.
 */
export function parseMelody(text: string): StreamItem[] {
  return text
    .split(/\s+/)
    .filter((t) => t && t !== '|')
    .map((token) => {
      const [p, len] = token.split(':');
      const dotted = len.endsWith('.');
      const type = (dotted ? len.slice(0, -1) : len) as DurationType;
      return { pitches: p === 'r' ? [] : p.split('+').map(pitch), ticks: ticksOf(type, dotted ? 1 : 0) };
    });
}

/** Put chord symbols on the first event of each bar (one per bar, `-` skips a bar). */
function chordsPerBar(score: Score, s: number, chords: string) {
  chords
    .split(/\s+/)
    .filter(Boolean)
    .forEach((c, m) => {
      const first = lane(score, m, s)[0];
      if (first && c !== '-') first.harmony = c;
    });
}

export const TEMPLATES: Template[] = [
  {
    id: 'blank-piano',
    name: 'Blank piano',
    description: 'Grand staff, 4/4, eight empty bars.',
    icon: '🎹',
    make: () => newScore({ title: 'Untitled score', measures: 8 }),
  },
  {
    id: 'lead-sheet',
    name: 'Lead sheet',
    description: 'Melody with chord symbols: the usual pop/jazz song layout.',
    icon: '🎤',
    make: () => {
      const s = newScore({ title: 'My song', tempo: 96, measures: 1, staves: [{ clef: 'treble', sound: 'guitar_steel' }] });
      writeStream(
        s,
        0,
        parseMelody(`E5:q G5:q G5:q. E5:8 | A5:q G5:q E5:h | F5:q F5:q E5:q D5:q | E5:w
                     E5:q G5:q G5:q. E5:8 | A5:q C6:q B5:h | A5:q G5:q F5:q D5:q | C5:w`),
      );
      chordsPerBar(s, 0, 'C Am F G C Am Dm7 C');
      s.accompaniment = { enabled: true, style: 'pop', sound: 'piano' };
      return s;
    },
  },
  {
    id: 'waltz',
    name: 'Piano waltz',
    description: '3/4 with an “oom-pah-pah” left hand.',
    icon: '💃',
    make: () => {
      const s = newScore({ title: 'Little waltz', tempo: 132, timeBeats: 3, measures: 1 });
      writeStream(s, 0, parseMelody(`E5:h. | G5:q F5:q E5:q | D5:h. | F5:q E5:q D5:q | C5:h G5:q | E5:h C5:q | D5:q E5:q D5:q | C5:h.`));
      const bass = ['C3', 'G2', 'G2', 'G2', 'C3', 'C3', 'G2', 'C3'];
      const upper = ['E3+G3', 'F3+B3', 'F3+B3', 'F3+B3', 'E3+G3', 'E3+G3', 'F3+B3', 'E3+G3'];
      writeStream(s, 1, parseMelody(bass.map((b, i) => `${b}:q ${upper[i]}:q ${upper[i]}:q`).join(' ')));
      return s;
    },
  },
  {
    id: 'blues',
    name: '12-bar blues',
    description: 'Blues in F with a riff and the classic chord changes.',
    icon: '🎷',
    make: () => {
      const s = newScore({ title: 'Blues in F', tempo: 110, keyFifths: -1, measures: 1, staves: [{ clef: 'treble', sound: 'alto_sax' }] });
      const riff = (root: string) => `${root}:8 r:8 ${root}:8 r:8 ${root}:q r:q`;
      const bars = ['F4', 'Bb4', 'F4', 'F4', 'Bb4', 'Bb4', 'F4', 'F4', 'C5', 'Bb4', 'F4', 'C5'];
      writeStream(s, 0, parseMelody(bars.map(riff).join(' ')));
      chordsPerBar(s, 0, 'F7 Bb7 F7 F7 Bb7 Bb7 F7 F7 C7 Bb7 F7 C7');
      s.measures[0].repeatStart = true;
      s.measures[11].repeatEnd = true;
      s.accompaniment = { enabled: true, style: 'strum', sound: 'piano' };
      return s;
    },
  },
  {
    id: 'scale',
    name: 'Scale exercise',
    description: 'C major scale up and down in eighths, for practice pieces.',
    icon: '🎼',
    make: () => {
      const s = newScore({ title: 'C major scale', tempo: 80, measures: 1, staves: [{ clef: 'treble' }] });
      writeStream(s, 0, parseMelody('C4:8 D4:8 E4:8 F4:8 G4:8 A4:8 B4:8 C5:8 | C5:8 B4:8 A4:8 G4:8 F4:8 E4:8 D4:8 C4:8 | C4:w'));
      return s;
    },
  },
  {
    id: 'choir',
    name: 'SATB choir',
    description: 'Four voice parts with a short hymn-style cadence.',
    icon: '🎶',
    make: () => {
      const s = scoreFromInstruments(['soprano', 'alto', 'tenor', 'bass_voice'], { title: 'Chorale', tempo: 72, measures: 1 }, newScore);
      // concert pitch (the tenor part shows an octave higher on its treble-8 staff)
      const lines = ['E5:h D5:h | C5:w', 'C5:h B4:h | G4:w', 'G4:h G4:h | E4:w', 'C3:h G2:h | C3:w'];
      lines.forEach((l, k) => writeStream(s, k, parseMelody(l)));
      return s;
    },
  },
  {
    id: 'quartet',
    name: 'String quartet',
    description: 'Two violins, viola and cello, eight empty bars.',
    icon: '🎻',
    make: () => scoreFromInstruments(['violin', 'violin', 'viola', 'cello'], { title: 'String quartet', measures: 8 }, newScore),
  },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);
