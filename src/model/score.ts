import { fill, largestFitting, measureTicks, ticksOf, type Piece } from './duration';
import { isRest, type Measure, type NoteEvent, type Pitch, type Score, type StaffDef } from './types';

let counter = 0;
export const uid = () => `e${Date.now().toString(36)}${(counter++).toString(36)}`;

export function restsFor(ticks: number): NoteEvent[] {
  return fill(ticks).map(({ type, dots, tuplet }) => ({ id: uid(), pitches: [], type, dots, ...(tuplet ? { tuplet } : {}) }));
}

export function barTicks(score: Score): number {
  return measureTicks(score.timeBeats, score.timeBeatType);
}

export function emptyMeasure(score: Score): Measure {
  return { staves: score.staves.map(() => restsFor(barTicks(score))) };
}

export function newScore(opts: Partial<Pick<Score, 'title' | 'composer' | 'tempo' | 'keyFifths' | 'timeBeats' | 'timeBeatType'>> & {
  staves?: StaffDef[];
  measures?: number;
} = {}): Score {
  const score: Score = {
    version: 1,
    title: opts.title ?? 'Untitled score',
    composer: opts.composer ?? '',
    tempo: opts.tempo ?? 100,
    keyFifths: opts.keyFifths ?? 0,
    timeBeats: opts.timeBeats ?? 4,
    timeBeatType: opts.timeBeatType ?? 4,
    staves: opts.staves ?? [{ clef: 'treble' }, { clef: 'bass' }],
    measures: [],
  };
  for (let i = 0; i < (opts.measures ?? 8); i++) score.measures.push(emptyMeasure(score));
  return score;
}

// ---------- voices ("lanes" = staff + voice) ----------

/** Event list of a staff's voice in a bar, or undefined when voice 2 does not exist there. */
export function laneOf(measure: Measure, s: number, v = 0): NoteEvent[] | undefined {
  return v ? measure.voice2?.[s] ?? undefined : measure.staves[s];
}

/** Same as laneOf, but an empty list instead of undefined (for reading). */
export function lane(score: Score, m: number, s: number, v = 0): NoteEvent[] {
  const measure = score.measures[m];
  return (measure && laneOf(measure, s, v)) || [];
}

export function setLane(measure: Measure, s: number, v: number, events: NoteEvent[]) {
  if (!v) {
    measure.staves[s] = events;
    return;
  }
  measure.voice2 ??= [];
  while (measure.voice2.length <= s) measure.voice2.push(null);
  measure.voice2[s] = events;
}

/** The lane, created as a bar of rests when voice 2 does not exist yet (call inside a mutation). */
export function ensureLane(score: Score, m: number, s: number, v = 0): NoteEvent[] {
  const measure = score.measures[m];
  let events = laneOf(measure, s, v);
  if (!events) {
    events = restsFor(barTicks(score));
    setLane(measure, s, v, events);
  }
  return events;
}

/** Lanes that exist in a bar for one staff: voice 1, and voice 2 if present. */
export function lanesOf(measure: Measure, s: number): { v: number; events: NoteEvent[] }[] {
  const out = [{ v: 0, events: measure.staves[s] }];
  const v2 = measure.voice2?.[s];
  if (v2) out.push({ v: 1, events: v2 });
  return out;
}

/** Event at a position. */
export function eventAt(score: Score, p: { m: number; s: number; i: number; v?: number }): NoteEvent | undefined {
  return lane(score, p.m, p.s, p.v ?? 0)[p.i];
}

/** Every event of the score, all staves and voices. */
export function allEvents(score: Score): NoteEvent[] {
  return score.measures.flatMap((m) => [...m.staves.flat(), ...(m.voice2 ?? []).flatMap((l) => l ?? [])]);
}

export const eventTicks = (e: Pick<NoteEvent, 'type' | 'dots' | 'tuplet'>) => ticksOf(e.type, e.dots, e.tuplet);

export function startTick(events: NoteEvent[], index: number): number {
  let t = 0;
  for (let i = 0; i < index; i++) t += eventTicks(events[i]);
  return t;
}

/**
 * Write an event at `index`, overwriting whatever follows (like typing in overwrite mode).
 * The duration is clamped to what is left in the bar. Partially covered events
 * become rests for their remaining time. Returns the index of the written event.
 */
export function writeAt(
  score: Score,
  m: number,
  s: number,
  index: number,
  value: { pitches: Pitch[] } & Piece,
  keep?: Partial<NoteEvent>,
  v = 0,
): number {
  const events = ensureLane(score, m, s, v);
  const bar = barTicks(score);
  const t = startTick(events, Math.min(index, events.length));
  let { type, dots, tuplet } = value;
  if (t + ticksOf(type, dots, tuplet) > bar) {
    const fit = largestFitting(bar - t);
    if (!fit) return index;
    ({ type, dots } = fit);
    tuplet = undefined;
  }
  const end = t + ticksOf(type, dots, tuplet);
  const written: NoteEvent = { ...keep, id: keep?.id ?? uid(), pitches: value.pitches, type, dots };
  if (tuplet) written.tuplet = tuplet;
  else delete written.tuplet;
  if (value.pitches.length === 0) {
    delete written.tie;
    delete written.articulations;
    delete written.slurEnd;
    delete written.dynamic;
    delete written.lyric; // chord symbols may stay on rests
    delete written.extraVerses;
  }

  const before = events.slice(0, index);
  const after: NoteEvent[] = [];
  let pos = t;
  for (let i = index; i < events.length; i++) {
    const e = events[i];
    const eStart = pos;
    const eEnd = pos + eventTicks(e);
    pos = eEnd;
    if (eEnd <= end) continue; // fully overwritten
    if (eStart < end) after.push(...restsFor(eEnd - end)); // partially overwritten
    else after.push(e);
  }
  const tidy = tidyRests([...before, written, ...after], written.id);
  setLane(score.measures[m], s, v, tidy);
  return tidy.indexOf(written);
}

/** Rest values longest first, for tidying. */
const REST_VALUES = (['w', 'h', 'q', '8', '16', '32', '64'] as const).map((type) => ({ type, ticks: ticksOf(type) }));

/**
 * Merge runs of plain rests into the fewest rests that start on their own beat grid
 * (two eighth rests on a beat become a quarter rest, a half rest never starts on beat 2 of 4/4).
 * Rests carrying a chord symbol, tuplet rests and notes are left alone.
 */
export function tidyRests(events: NoteEvent[], keepId?: string): NoteEvent[] {
  const out: NoteEvent[] = [];
  let t = 0;
  let k = 0;
  while (k < events.length) {
    const e = events[k];
    const plain = (x: NoteEvent) => isRest(x) && !x.tuplet && !x.harmony && x.id !== keepId;
    if (!plain(e)) {
      out.push(e);
      t += eventTicks(e);
      k++;
      continue;
    }
    // collect the run of plain rests
    let len = 0;
    const run: NoteEvent[] = [];
    while (k < events.length && plain(events[k])) {
      run.push(events[k]);
      len += eventTicks(events[k]);
      k++;
    }
    // greedy: at each position the longest rest that fits and is aligned to its own length
    const rebuilt: NoteEvent[] = [];
    let pos = t;
    let left = len;
    while (left > 0) {
      const pick = REST_VALUES.find((r) => r.ticks <= left && pos % r.ticks === 0) ?? REST_VALUES.find((r) => r.ticks <= left);
      if (!pick) break;
      rebuilt.push({ id: '', pitches: [], type: pick.type, dots: 0 });
      pos += pick.ticks;
      left -= pick.ticks;
    }
    // keep the original rests (and their ids) when nothing changes
    const same =
      rebuilt.length === run.length && rebuilt.every((r, j) => r.type === run[j].type && run[j].dots === 0);
    if (same) out.push(...run);
    else out.push(...rebuilt.map((r, j) => ({ ...r, id: run[j]?.id ?? uid() })));
    t += len;
  }
  return out;
}

/** Turn an event into a rest of equal length (Flat's "remove"). Adjacent rests are left as-is. */
export function clearEvent(score: Score, m: number, s: number, index: number, v = 0) {
  const events = laneOf(score.measures[m], s, v);
  const e = events?.[index];
  if (!events || !e) return;
  events[index] = {
    id: e.id,
    pitches: [],
    type: e.type,
    dots: e.dots,
    ...(e.tuplet ? { tuplet: e.tuplet } : {}),
    ...(e.harmony ? { harmony: e.harmony } : {}),
  };
  setLane(score.measures[m], s, v, tidyRests(events));
}

export function insertMeasure(score: Score, at: number) {
  score.measures.splice(at, 0, emptyMeasure(score));
}

export function removeMeasure(score: Score, at: number) {
  if (score.measures.length <= 1) {
    score.measures[0] = emptyMeasure(score);
    return;
  }
  score.measures.splice(at, 1);
}

/** Re-fit every bar after a time-signature change: truncate overflow, pad with rests. */
export function refitMeasures(score: Score) {
  const bar = barTicks(score);
  for (const measure of score.measures) {
    const fit = (events: NoteEvent[]) => {
      const out: NoteEvent[] = [];
      let t = 0;
      for (const e of events) {
        const len = eventTicks(e);
        if (t + len <= bar) {
          out.push(e);
          t += len;
        } else {
          const fit = largestFitting(bar - t);
          if (fit) {
            out.push({ ...e, ...fit, tie: false, tuplet: undefined });
            t += ticksOf(fit.type, fit.dots);
          }
          break;
        }
      }
      if (t < bar) out.push(...restsFor(bar - t));
      return out;
    };
    measure.staves = measure.staves.map(fit);
    if (measure.voice2) measure.voice2 = measure.voice2.map((l) => (l ? fit(l) : null));
  }
}

/** Make sure every measure has one event list per staff. */
export function syncStaves(score: Score) {
  for (const measure of score.measures) {
    while (measure.staves.length < score.staves.length) measure.staves.push(restsFor(barTicks(score)));
    measure.staves.length = score.staves.length;
    if (measure.voice2 && measure.voice2.length > score.staves.length) measure.voice2.length = score.staves.length;
  }
}

/**
 * Measures in playback order. Follows repeat barlines (each repeat taken once),
 * 1st/2nd endings, and D.C./D.S. jumps with al Fine / al Coda. As is standard,
 * repeats are not taken again after a D.C./D.S., and only the last ending is played.
 */
export function playOrder(score: Score): number[] {
  const bars = score.measures;
  const order: number[] = [];
  const taken = new Set<number>();
  const segno = Math.max(0, bars.findIndex((b) => b.segno));
  const coda = bars.findIndex((b) => b.coda);
  let start = 0;
  let pass = 1; // which time through the current repeat
  let jumped = false; // the last move was a jump back (do not reset at its target)
  let inEnding = false;
  let navJumped = false; // a D.C./D.S. has been taken
  let navMode: 'none' | 'fine' | 'coda' = 'none';

  /** Is there a later ending right after this one (e.g. bar is 1st ending and a 2nd follows)? */
  const hasLaterEnding = (m: number) => {
    for (let k = m + 1; k < bars.length && bars[k].volta; k++) if (bars[k].volta! > bars[m].volta!) return true;
    return false;
  };

  for (let m = 0; m < bars.length; m++) {
    const bar = bars[m];
    if (bar.repeatStart && !jumped) {
      start = m;
      pass = 1;
    }
    jumped = false;
    if (bar.volta) {
      if (navJumped ? hasLaterEnding(m) : bar.volta !== pass) continue; // not this time through
      inEnding = true;
    } else if (inEnding) {
      // first bar after the endings: a new section starts here
      inEnding = false;
      pass = 1;
      start = m;
    }
    order.push(m);
    if (order.length > 10000) break; // safety

    if (navJumped && navMode === 'fine' && bar.fine) break;
    if (navJumped && navMode === 'coda' && bar.toCoda && coda >= 0) {
      navMode = 'none';
      m = coda - 1; // loop increments
      continue;
    }
    if (bar.repeatEnd && !taken.has(m) && !navJumped) {
      taken.add(m);
      pass++;
      jumped = true;
      inEnding = false; // the jump leaves the ending; the next pass picks its own
      m = start - 1;
      continue;
    }
    if (bar.repeatEnd) {
      start = m + 1; // a later end-repeat without a start goes back to here
      pass = 1;
    }
    if (bar.jump && !navJumped) {
      navJumped = true;
      navMode = /Fine$/.test(bar.jump) ? 'fine' : /Coda$/.test(bar.jump) ? 'coda' : 'none';
      jumped = true;
      inEnding = false;
      m = (bar.jump.startsWith('ds') ? segno : 0) - 1;
    }
  }
  return order;
}

/**
 * Indices of consecutive tuplet events that form one bracket. A group closes once it
 * spans the time of `normal` notes of its first value (three triplet eighths = a quarter).
 */
export function tupletGroups(events: NoteEvent[]): number[][] {
  const out: number[][] = [];
  let group: number[] = [];
  let filled = 0;
  let span = 0;
  const flush = () => {
    if (group.length) out.push(group);
    group = [];
    filled = 0;
  };
  events.forEach((e, k) => {
    if (!e.tuplet) return flush();
    if (!group.length) span = ticksOf(e.type, 0) * e.tuplet.normal;
    group.push(k);
    filled += eventTicks(e);
    if (filled >= span) flush();
  });
  flush();
  return out;
}
