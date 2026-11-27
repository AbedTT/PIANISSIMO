import { chordVoicing, parseChord } from './harmony';

/** Standard tuning, sounding MIDI notes of the open strings from string 1 (high E) to 6 (low E). */
export const GUITAR_TUNING = [64, 59, 55, 50, 45, 40];
const MAX_FRET = 19;

export interface TabPos {
  /** 1 = high E … 6 = low E */
  str: number;
  fret: number;
}

/**
 * Strings and frets for the notes of one chord (sounding MIDI numbers): every note gets its
 * own string, frets stay low and close together, and near `around` (the previous hand
 * position) so a melody does not jump up and down the neck. Notes that cannot be placed
 * (too low, or more notes than strings) are left out.
 */
export function tabFor(midis: number[], around = 0): TabPos[] {
  const notes = [...new Set(midis)].sort((a, b) => b - a).slice(0, 6);
  const options = notes.map((m) =>
    GUITAR_TUNING.map((open, k) => ({ str: k + 1, fret: m - open })).filter((o) => o.fret >= 0 && o.fret <= MAX_FRET),
  );
  let best: TabPos[] = [];
  let bestCost = Infinity;
  const chosen: TabPos[] = [];
  const used = new Set<number>();
  const visit = (i: number) => {
    if (i === notes.length) {
      const fretted = chosen.filter((c) => c.fret > 0).map((c) => c.fret);
      const lo = fretted.length ? Math.min(...fretted) : 0;
      const hi = fretted.length ? Math.max(...fretted) : 0;
      if (hi - lo > 4) return; // a hand spans about four frets
      const centre = fretted.length ? (lo + hi) / 2 : 0;
      const cost = fretted.reduce((a, f) => a + f, 0) * 0.3 + (hi - lo) * 2 + Math.abs(centre - around) * 1.5;
      if (cost < bestCost) {
        bestCost = cost;
        best = [...chosen];
      }
      return;
    }
    for (const o of options[i]) {
      // higher notes on higher (lower-numbered) strings, as a guitarist would play them
      if (used.has(o.str) || (chosen.length && o.str <= chosen[chosen.length - 1].str)) continue;
      used.add(o.str);
      chosen.push(o);
      visit(i + 1);
      chosen.pop();
      used.delete(o.str);
    }
  };
  visit(0);
  if (best.length < notes.length && notes.length > 1) {
    // could not place them all: keep the top notes that fit
    return tabFor(notes.slice(0, -1), around);
  }
  return best;
}

export interface ChordShape {
  /** Fret per string from 6 (low E) to 1 (high E): -1 = not played, 0 = open. */
  frets: number[];
  /** Fret shown at the top of the diagram (1 = the nut). */
  baseFret: number;
  /** A finger laid across several strings at one fret. */
  barre?: { fret: number; from: number; to: number };
}

const shapeCache = new Map<string, ChordShape | null>();

/**
 * A playable guitar shape for a chord symbol, found by searching the neck: the lowest
 * position whose notes are all chord tones, with the root (or the slash bass) lowest,
 * every chord tone present (the fifth may be left out of bigger chords), muted strings
 * only on the bass side, and at most four fingers (a barre counts as one).
 */
export function chordShape(symbol: string): ChordShape | null {
  if (shapeCache.has(symbol)) return shapeCache.get(symbol)!;
  const shape = findShape(symbol);
  shapeCache.set(symbol, shape);
  return shape;
}

function findShape(symbol: string): ChordShape | null {
  const v = chordVoicing(symbol);
  const parsed = parseChord(symbol);
  if (!v || !parsed) return null;
  const pcs = [...new Set(v.tones.map((t) => ((t % 12) + 12) % 12))];
  const bassPc = ((v.bass % 12) + 12) % 12;
  if (!pcs.includes(bassPc)) pcs.push(bassPc);
  const tones = v.tones.map((t) => ((t % 12) + 12) % 12);
  const rootPc = tones[0];
  const fifthPc = (rootPc + 7) % 12;
  const required = pcs.filter((pc) => !(pcs.length >= 4 && pc === fifthPc && pc !== bassPc));
  const low = [...GUITAR_TUNING].reverse(); // string 6 … 1

  let best: ChordShape | null = null;
  let bestCost = Infinity;
  for (let base = 0; base <= 9; base++) {
    // per string: muted, open (only near the nut) or a fret in the 4-fret window that is a chord tone
    const choices = low.map((open) => {
      const c = [-1];
      if (base <= 1 && pcs.includes(open % 12)) c.push(0);
      for (let f = Math.max(1, base); f <= base + 3; f++) if (pcs.includes((open + f) % 12)) c.push(f);
      return c;
    });
    const frets: number[] = [];
    const visit = (k: number) => {
      if (k === 6) {
        const cost = shapeCost(frets, low, required, bassPc, base);
        if (cost < bestCost) {
          bestCost = cost;
          best = { frets: [...frets], baseFret: 1, barre: undefined };
        }
        return;
      }
      for (const f of choices[k]) {
        // muted strings only below the first played string
        if (f === -1 && frets.some((x) => x !== -1)) continue;
        frets.push(f);
        visit(k + 1);
        frets.pop();
      }
    };
    visit(0);
  }
  if (!best) return null;
  return finishShape(best);
}

function shapeCost(frets: number[], low: number[], required: number[], bassPc: number, base: number): number {
  const played = frets.map((f, k) => (f < 0 ? null : (low[k] + f) % 12));
  const sounding = played.filter((x): x is number => x !== null);
  if (sounding.length < 3) return Infinity;
  if (sounding[0] !== bassPc) return Infinity;
  if (!required.every((pc) => sounding.includes(pc))) return Infinity;
  const fretted = frets.filter((f) => f > 0);
  const lo = fretted.length ? Math.min(...fretted) : 0;
  const hi = fretted.length ? Math.max(...fretted) : 0;
  if (hi - lo > 3) return Infinity;
  // fingers: a barre at the lowest fret covers every string at that fret
  const atLow = fretted.filter((f) => f === lo).length;
  const fingers = atLow > 1 ? fretted.length - atLow + 1 : fretted.length;
  if (fingers > 4) return Infinity;
  const barrePenalty = atLow > 1 && fretted.length > 4 ? 3 : 0;
  return lo * 3 + (6 - sounding.length) * 2 + fingers + barrePenalty + base * 0.1;
}

function finishShape(s: ChordShape): ChordShape {
  const fretted = s.frets.filter((f) => f > 0);
  const lo = fretted.length ? Math.min(...fretted) : 1;
  const hi = fretted.length ? Math.max(...fretted) : 1;
  const baseFret = hi <= 4 ? 1 : lo;
  let barre: ChordShape['barre'];
  const at = s.frets.map((f, k) => (f === lo ? k : -1)).filter((k) => k >= 0);
  if (lo > 0 && at.length > 1 && fretted.length > 4) {
    // strings are numbered 6 (index 0) to 1 (index 5)
    barre = { fret: lo, from: 6 - at[0], to: 6 - at[at.length - 1] };
  }
  return { frets: s.frets, baseFret, barre };
}
