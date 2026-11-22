import { TRIPLET, type DurationType, type Tuplet } from './types';

/** Ticks per quarter note. Divisible down to 64th notes with two dots. */
export const TPQ = 480;

export const BASE_TICKS: Record<DurationType, number> = {
  w: TPQ * 4,
  h: TPQ * 2,
  q: TPQ,
  '8': TPQ / 2,
  '16': TPQ / 4,
  '32': TPQ / 8,
  '64': TPQ / 16,
};

export function ticksOf(type: DurationType, dots = 0, tuplet?: Tuplet): number {
  const base = BASE_TICKS[type];
  let total = base;
  let add = base;
  for (let i = 0; i < dots; i++) {
    add /= 2;
    total += add;
  }
  return tuplet ? (total * tuplet.normal) / tuplet.actual : total;
}

export interface Piece {
  type: DurationType;
  dots: number;
  tuplet?: Tuplet;
}

const sumTicks = (ps: Piece[]) => ps.reduce((a, p) => a + ticksOf(p.type, p.dots, p.tuplet), 0);

/**
 * Exact notation for a gap. Uses plain values when they add up; otherwise peels
 * off triplet values first (the gap left behind when a triplet overwrites part of a beat).
 */
export function fill(ticks: number): Piece[] {
  const plain = decompose(ticks);
  if (sumTicks(plain) === ticks) return plain;
  for (const type of Object.keys(BASE_TICKS) as DurationType[]) {
    const unit = ticksOf(type, 0, TRIPLET);
    if (!Number.isInteger(unit)) continue;
    for (let n = 1; n <= 5 && n * unit <= ticks; n++) {
      const rest = decompose(ticks - n * unit);
      if (sumTicks(rest) === ticks - n * unit) {
        return [...Array.from({ length: n }, () => ({ type, dots: 0, tuplet: TRIPLET })), ...rest];
      }
    }
  }
  return plain; // best effort
}

export function measureTicks(beats: number, beatType: number): number {
  return (TPQ * 4 * beats) / beatType;
}

/** Longest-first list of every (type, dots) combo we can notate, for decomposing gaps. */
const NOTATABLE: { type: DurationType; dots: number; ticks: number }[] = (() => {
  const out: { type: DurationType; dots: number; ticks: number }[] = [];
  for (const type of Object.keys(BASE_TICKS) as DurationType[]) {
    for (const dots of [0, 1]) {
      const t = ticksOf(type, dots);
      if (Number.isInteger(t)) out.push({ type, dots, ticks: t });
    }
  }
  return out.sort((a, b) => b.ticks - a.ticks);
})();

/**
 * Split a span of ticks into notatable values, longest first.
 * When `plain` is true dotted values are avoided (cleaner rests).
 */
export function decompose(ticks: number, plain = true): { type: DurationType; dots: number }[] {
  const out: { type: DurationType; dots: number }[] = [];
  let left = ticks;
  while (left > 0) {
    const pick = NOTATABLE.find((n) => n.ticks <= left && (!plain || n.dots === 0));
    if (!pick) break; // smaller than a 64th: drop
    out.push({ type: pick.type, dots: pick.dots });
    left -= pick.ticks;
  }
  return out;
}

/** Largest single notatable value (dots allowed) that fits in `ticks`. */
export function largestFitting(ticks: number): { type: DurationType; dots: number } | null {
  const pick = NOTATABLE.find((n) => n.ticks <= ticks);
  return pick ? { type: pick.type, dots: pick.dots } : null;
}
