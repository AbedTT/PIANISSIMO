import { uid } from './score';
import type { BarComment, Score } from './types';

/** Longest comment we keep (a review note, not an essay). */
export const MAX_COMMENT = 1000;

export function commentsAt(score: Score, m: number): BarComment[] {
  return score.measures[m]?.comments ?? [];
}

/** Every comment in the score with its bar, in bar order. */
export function allComments(score: Score): { m: number; c: BarComment }[] {
  return score.measures.flatMap((measure, m) => (measure.comments ?? []).map((c) => ({ m, c })));
}

/** Bars that have at least one comment still open. */
export function openCommentBars(score: Score): number[] {
  return score.measures.flatMap((measure, m) => (measure.comments?.some((c) => !c.resolved) ? [m] : []));
}

export function addComment(score: Score, m: number, author: string, text: string, at = new Date().toISOString()): BarComment | null {
  const measure = score.measures[m];
  const body = text.trim().slice(0, MAX_COMMENT);
  if (!measure || !body) return null;
  const comment: BarComment = { id: uid(), author: author.trim().slice(0, 60) || 'Anonymous', text: body, at };
  (measure.comments ??= []).push(comment);
  return comment;
}

function find(score: Score, id: string) {
  for (const measure of score.measures) {
    const i = measure.comments?.findIndex((c) => c.id === id) ?? -1;
    if (i >= 0) return { measure, i };
  }
  return null;
}

export function removeComment(score: Score, id: string): boolean {
  const hit = find(score, id);
  if (!hit) return false;
  hit.measure.comments!.splice(hit.i, 1);
  if (!hit.measure.comments!.length) delete hit.measure.comments;
  return true;
}

export function setResolved(score: Score, id: string, resolved: boolean): boolean {
  const hit = find(score, id);
  if (!hit) return false;
  const c = hit.measure.comments![hit.i];
  if (resolved) c.resolved = true;
  else delete c.resolved;
  return true;
}
