import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TPQ } from './duration';
import { addComment, allComments, openCommentBars, removeComment, setResolved } from './comments';
import { barTicks, eventTicks, insertMeasure, lane } from './score';
import { parseMelody, TEMPLATES } from './templates';
import { partsOf } from './parts';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

describe('templates', () => {
  it('parses the compact melody notation', () => {
    const items = parseMelody('C5:q F#4+A4:8. r:h | Bb3:w');
    expect(items.map((i) => i.ticks)).toEqual([TPQ, (TPQ / 2) * 1.5, 2 * TPQ, 4 * TPQ]);
    expect(items[1].pitches).toEqual([
      { step: 'F', alter: 1, octave: 4 },
      { step: 'A', alter: 0, octave: 4 },
    ]);
    expect(items[2].pitches).toEqual([]);
    expect(items[3].pitches[0]).toEqual({ step: 'B', alter: -1, octave: 3 });
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s builds a complete, valid score', (_, t) => {
    const s = t.make();
    expect(s.measures.length).toBeGreaterThan(0);
    s.measures.forEach((measure, m) =>
      measure.staves.forEach((evs) => expect(evs.reduce((a, e) => a + eventTicks(e), 0)).toBe(barTicks(s, m))),
    );
  });

  it('lead sheet and blues carry one chord symbol per bar', () => {
    const lead = TEMPLATES.find((t) => t.id === 'lead-sheet')!.make();
    expect(lead.measures.map((_, m) => lane(lead, m, 0)[0].harmony)).toEqual(['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm7', 'C']);
    const blues = TEMPLATES.find((t) => t.id === 'blues')!.make();
    expect(blues.measures).toHaveLength(12);
    expect(blues.measures[11]).toMatchObject({ repeatEnd: true });
  });

  it('ensemble templates have one part per instrument', () => {
    expect(partsOf(TEMPLATES.find((t) => t.id === 'choir')!.make()).map((p) => p.part.name)).toEqual(['Soprano', 'Alto', 'Tenor', 'Bass']);
    expect(partsOf(TEMPLATES.find((t) => t.id === 'quartet')!.make())).toHaveLength(4);
  });
});

describe('bar comments', () => {
  it('adds, resolves and removes comments; they move with their bar', () => {
    const s = TEMPLATES[0].make();
    const a = addComment(s, 2, 'Ann', '  Too fast here? ', '2026-01-01T00:00:00Z')!;
    addComment(s, 5, 'Ben', 'Nice');
    expect(addComment(s, 3, 'Ann', '   ')).toBeNull();
    expect(addComment(s, 99, 'Ann', 'x')).toBeNull();
    expect(a).toMatchObject({ author: 'Ann', text: 'Too fast here?' });
    expect(openCommentBars(s)).toEqual([2, 5]);
    insertMeasure(s, 0); // comments travel with the bar they are on
    expect(openCommentBars(s)).toEqual([3, 6]);
    setResolved(s, a.id, true);
    expect(openCommentBars(s)).toEqual([6]);
    expect(allComments(s)).toHaveLength(2);
    expect(removeComment(s, a.id)).toBe(true);
    expect(s.measures[3].comments).toBeUndefined();
    expect(removeComment(s, a.id)).toBe(false);
  });
});
