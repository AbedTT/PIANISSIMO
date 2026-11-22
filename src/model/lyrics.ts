import { allEvents } from './score';
import type { Lyric, NoteEvent, Score } from './types';

/*
 * Lyrics storage: verse 1 lives in `NoteEvent.lyric` (unchanged from earlier versions, so
 * existing scores need no migration); verses 2, 3, … live in `NoteEvent.extraVerses[0, 1, …]`.
 * Always go through these helpers.
 */

export const MAX_VERSES = 8;

export function getLyric(e: NoteEvent, verse: number): Lyric | undefined {
  return verse <= 1 ? e.lyric : e.extraVerses?.[verse - 2] ?? undefined;
}

/** Set or clear (null / empty text) one verse's syllable on a note. */
export function setLyricOn(e: NoteEvent, verse: number, lyric: Lyric | null) {
  const value = lyric && lyric.text.trim() ? { text: lyric.text.trim(), ...(lyric.hyphen ? { hyphen: true } : {}) } : null;
  if (verse <= 1) {
    if (value) e.lyric = value;
    else delete e.lyric;
    return;
  }
  const extra = e.extraVerses ?? [];
  while (extra.length < verse - 1) extra.push(null);
  extra[verse - 2] = value;
  while (extra.length && !extra[extra.length - 1]) extra.pop(); // trim empty tail
  if (extra.length) e.extraVerses = extra;
  else delete e.extraVerses;
}

/** Every verse present on a note, in order. */
export function lyricsOf(e: NoteEvent): { verse: number; lyric: Lyric }[] {
  const out: { verse: number; lyric: Lyric }[] = [];
  if (e.lyric) out.push({ verse: 1, lyric: e.lyric });
  e.extraVerses?.forEach((l, k) => {
    if (l) out.push({ verse: k + 2, lyric: l });
  });
  return out;
}

export function clearLyrics(e: NoteEvent) {
  delete e.lyric;
  delete e.extraVerses;
}

/** Highest verse number used anywhere in the score (0 when there are no lyrics). */
export function verseCount(score: Score): number {
  let n = 0;
  for (const e of allEvents(score)) for (const { verse } of lyricsOf(e)) n = Math.max(n, verse);
  return n;
}
