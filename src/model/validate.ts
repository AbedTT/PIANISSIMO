import type { Score } from './types';

/** Looks like a Pianissimo score (the JSON the editor saves). */
export function isValidScore(x: unknown): x is Score {
  const s = x as Partial<Score> | null;
  return !!s && typeof s === 'object' && s.version === 1 && Array.isArray(s.measures) && Array.isArray(s.staves);
}
