import { soundById } from '../audio/sounds';
import { barTicks, restsFor } from './score';
import type { Clef, Part, Score } from './types';

/** Instrument templates for the "Instruments" dialog. `transpose` = written minus sounding, in semitones. */
export interface InstrumentDef {
  id: string;
  name: string;
  short: string;
  clefs: Clef[];
  sound: string;
  transpose?: number;
  group: string;
}

export const INSTRUMENTS: InstrumentDef[] = [
  { id: 'piano', name: 'Piano', short: 'Pno.', clefs: ['treble', 'bass'], sound: 'piano', group: 'Keyboards' },
  { id: 'organ', name: 'Organ', short: 'Org.', clefs: ['treble', 'bass'], sound: 'church_organ', group: 'Keyboards' },
  { id: 'epiano', name: 'Electric Piano', short: 'E.Pno.', clefs: ['treble', 'bass'], sound: 'electric_piano', group: 'Keyboards' },
  { id: 'harpsichord', name: 'Harpsichord', short: 'Hpd.', clefs: ['treble', 'bass'], sound: 'harpsichord', group: 'Keyboards' },
  { id: 'soprano', name: 'Soprano', short: 'S.', clefs: ['treble'], sound: 'choir', group: 'Voices' },
  { id: 'alto', name: 'Alto', short: 'A.', clefs: ['treble'], sound: 'choir', group: 'Voices' },
  { id: 'tenor', name: 'Tenor', short: 'T.', clefs: ['treble'], sound: 'choir', transpose: 12, group: 'Voices' },
  { id: 'bass_voice', name: 'Bass', short: 'B.', clefs: ['bass'], sound: 'choir', group: 'Voices' },
  { id: 'voice', name: 'Voice', short: 'Vo.', clefs: ['treble'], sound: 'choir', group: 'Voices' },
  { id: 'violin', name: 'Violin', short: 'Vln.', clefs: ['treble'], sound: 'violin', group: 'Strings' },
  { id: 'viola', name: 'Viola', short: 'Vla.', clefs: ['alto'], sound: 'viola', group: 'Strings' },
  { id: 'cello', name: 'Cello', short: 'Vc.', clefs: ['bass'], sound: 'cello', group: 'Strings' },
  { id: 'contrabass', name: 'Double Bass', short: 'Cb.', clefs: ['bass'], sound: 'contrabass', transpose: 12, group: 'Strings' },
  { id: 'harp', name: 'Harp', short: 'Hp.', clefs: ['treble', 'bass'], sound: 'harp', group: 'Strings' },
  { id: 'guitar', name: 'Guitar', short: 'Gtr.', clefs: ['treble'], sound: 'guitar_nylon', transpose: 12, group: 'Strings' },
  { id: 'flute', name: 'Flute', short: 'Fl.', clefs: ['treble'], sound: 'flute', group: 'Woodwinds' },
  { id: 'oboe', name: 'Oboe', short: 'Ob.', clefs: ['treble'], sound: 'oboe', group: 'Woodwinds' },
  { id: 'clarinet', name: 'Clarinet in B♭', short: 'Cl.', clefs: ['treble'], sound: 'clarinet', transpose: 2, group: 'Woodwinds' },
  { id: 'bassoon', name: 'Bassoon', short: 'Bsn.', clefs: ['bass'], sound: 'bassoon', group: 'Woodwinds' },
  { id: 'alto_sax', name: 'Alto Saxophone', short: 'A.Sax.', clefs: ['treble'], sound: 'alto_sax', transpose: 9, group: 'Woodwinds' },
  { id: 'tenor_sax', name: 'Tenor Saxophone', short: 'T.Sax.', clefs: ['treble'], sound: 'alto_sax', transpose: 14, group: 'Woodwinds' },
  { id: 'trumpet', name: 'Trumpet in B♭', short: 'Tpt.', clefs: ['treble'], sound: 'trumpet', transpose: 2, group: 'Brass' },
  { id: 'horn', name: 'Horn in F', short: 'Hn.', clefs: ['treble'], sound: 'french_horn', transpose: 7, group: 'Brass' },
  { id: 'trombone', name: 'Trombone', short: 'Tbn.', clefs: ['bass'], sound: 'trombone', group: 'Brass' },
  { id: 'tuba', name: 'Tuba', short: 'Tba.', clefs: ['bass'], sound: 'tuba', group: 'Brass' },
  { id: 'marimba', name: 'Marimba', short: 'Mar.', clefs: ['treble', 'bass'], sound: 'marimba', group: 'Percussion' },
  { id: 'vibraphone', name: 'Vibraphone', short: 'Vib.', clefs: ['treble'], sound: 'vibraphone', group: 'Percussion' },
];

export const instrumentById = (id: string) => INSTRUMENTS.find((i) => i.id === id);

/** Parts of a score with the index of their first staff. Scores without parts are one part. */
export function partsOf(score: Score): { part: Part; start: number; index: number }[] {
  const parts: Part[] = score.parts?.length
    ? score.parts
    : [{ name: defaultName(score), short: '', staves: score.staves.length }];
  let start = 0;
  return parts.map((part, index) => {
    const out = { part, start, index };
    start += part.staves;
    return out;
  });
}

function defaultName(score: Score): string {
  return soundById(score.staves[0]?.sound).name.replace(/^Concert grand piano$/, 'Piano');
}

/** The part a staff belongs to. */
export function partOfStaff(score: Score, s: number) {
  const all = partsOf(score);
  return all.find((p) => s >= p.start && s < p.start + p.part.staves) ?? all[0];
}

/** Semitones to add to concert pitch to get the written pitch of staff `s` (0 = non-transposing). */
export function writtenShift(score: Score, s: number): number {
  return partOfStaff(score, s).part.transpose ?? 0;
}

/** Make sure `score.parts` exists (so it can be edited). */
export function ensureParts(score: Score): Part[] {
  if (!score.parts?.length) score.parts = partsOf(score).map((p) => ({ ...p.part }));
  return score.parts;
}

// ------------------------------------------------------------------ editing parts

/** Insert staves at index `at` in every bar (rests), with their clef and sound. */
function insertStaves(score: Score, at: number, clefs: Clef[], sound: string) {
  score.staves.splice(at, 0, ...clefs.map((clef) => ({ clef, sound })));
  score.measures.forEach((bar, m) => {
    bar.staves.splice(at, 0, ...clefs.map(() => restsFor(barTicks(score, m))));
    if (bar.voice2) bar.voice2.splice(Math.min(at, bar.voice2.length), 0, ...clefs.map(() => null));
    if (bar.clefs) bar.clefs.splice(at, 0, ...clefs.map(() => null));
  });
}

function removeStaves(score: Score, at: number, count: number) {
  score.staves.splice(at, count);
  for (const bar of score.measures) {
    bar.staves.splice(at, count);
    bar.voice2?.splice(at, count);
    bar.clefs?.splice(at, count);
  }
}

export function addPart(score: Score, instrumentId: string, at = ensureParts(score).length) {
  const def = instrumentById(instrumentId) ?? INSTRUMENTS[0];
  const parts = ensureParts(score);
  const start = partsOf(score)[at]?.start ?? score.staves.length;
  insertStaves(score, start, def.clefs, def.sound);
  parts.splice(at, 0, {
    name: def.name,
    short: def.short,
    staves: def.clefs.length,
    ...(def.transpose ? { transpose: def.transpose } : {}),
    instrument: def.id,
  });
}

export function removePart(score: Score, index: number) {
  const parts = ensureParts(score);
  if (parts.length <= 1) return false;
  const p = partsOf(score)[index];
  removeStaves(score, p.start, p.part.staves);
  parts.splice(index, 1);
  return true;
}

/** Move a part up (-1) or down (+1), staves and all. */
export function movePart(score: Score, index: number, dir: -1 | 1) {
  const parts = ensureParts(score);
  const other = index + dir;
  if (other < 0 || other >= parts.length) return;
  const [a, b] = dir < 0 ? [other, index] : [index, other]; // a comes first
  const all = partsOf(score);
  const pa = all[a];
  const pb = all[b];
  // swap the two staff ranges in every per-staff array
  const swap = <T>(arr: T[] | undefined) => {
    if (!arr) return;
    const first = arr.slice(pa.start, pa.start + pa.part.staves);
    const second = arr.slice(pb.start, pb.start + pb.part.staves);
    arr.splice(pa.start, pa.part.staves + pb.part.staves, ...second, ...first);
  };
  swap(score.staves);
  for (const bar of score.measures) {
    swap(bar.staves);
    if (bar.voice2) {
      while (bar.voice2.length < score.staves.length) bar.voice2.push(null);
      swap(bar.voice2);
    }
    if (bar.clefs) swap(bar.clefs);
  }
  [parts[a], parts[b]] = [parts[b], parts[a]];
}

/**
 * A single part as its own score (for viewing and printing parts): only that part's
 * staves, its name under the title, and its transposition kept.
 */
export function extractPart(score: Score, index: number): Score {
  const p = partsOf(score)[index];
  const range = (arr: unknown[] | undefined) => arr?.slice(p.start, p.start + p.part.staves);
  const copy: Score = JSON.parse(JSON.stringify(score));
  copy.staves = range(copy.staves) as Score['staves'];
  copy.parts = [{ ...p.part }];
  copy.partName = p.part.name;
  copy.accompaniment = undefined;
  copy.measures = copy.measures.map((bar) => ({
    ...bar,
    staves: range(bar.staves) as typeof bar.staves,
    ...(bar.voice2 ? { voice2: range(bar.voice2) as typeof bar.voice2 } : {}),
    ...(bar.clefs ? { clefs: range(bar.clefs) as typeof bar.clefs } : {}),
  }));
  return copy;
}

/**
 * A new score for a list of instruments (ids from INSTRUMENTS). Repeated instruments are
 * numbered ("Violin 1", "Violin 2").
 */
export function scoreFromInstruments(
  ids: string[],
  opts: Partial<Pick<Score, 'title' | 'composer' | 'tempo' | 'keyFifths' | 'timeBeats' | 'timeBeatType'>> & { measures?: number },
  make: (o: typeof opts & { staves: { clef: Clef; sound?: string }[] }) => Score,
): Score {
  const first = instrumentById(ids[0]) ?? INSTRUMENTS[0];
  const score = make({ ...opts, staves: first.clefs.map((clef) => ({ clef, sound: first.sound })) });
  score.parts = [
    {
      name: first.name,
      short: first.short,
      staves: first.clefs.length,
      ...(first.transpose ? { transpose: first.transpose } : {}),
      instrument: first.id,
    },
  ];
  for (const id of ids.slice(1)) addPart(score, id);
  // number repeated instruments
  const count = new Map<string, number>();
  for (const p of score.parts) count.set(p.name, (count.get(p.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const p of score.parts) {
    if ((count.get(p.name) ?? 0) < 2) continue;
    const n = (seen.get(p.name) ?? 0) + 1;
    seen.set(p.name, n);
    p.name = `${p.name} ${n}`;
    p.short = `${p.short} ${n}`;
  }
  return score;
}
