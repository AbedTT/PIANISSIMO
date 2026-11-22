import { contextAt, contexts } from './context';
import { fill, largestFitting, measureTicks, ticksOf, type Piece } from './duration';
import { isRest, type DurationType, type Measure, type NoteEvent, type Pitch, type Score, type StaffDef, type Tuplet } from './types';

let counter = 0;
export const uid = () => `e${Date.now().toString(36)}${(counter++).toString(36)}`;

export function restsFor(ticks: number, prefer?: Tuplet, preferType?: DurationType): NoteEvent[] {
  return fill(ticks, prefer, preferType).map(({ type, dots, tuplet }) => ({ id: uid(), pitches: [], type, dots, ...(tuplet ? { tuplet } : {}) }));
}

/** Ticks in bar `m` (time signatures can change from bar to bar). */
export function barTicks(score: Score, m = 0): number {
  if (!score.measures.length) return measureTicks(score.timeBeats, score.timeBeatType);
  return contextAt(score, m).ticks;
}

/** Absolute tick where bar `m` starts (score order). */
export function barStart(score: Score, m: number): number {
  return contextAt(score, m).start;
}

/** A bar of rests, as long as bar `m` would be. */
export function emptyMeasure(score: Score, m = score.measures.length - 1): Measure {
  const ticks = score.measures.length ? barTicks(score, Math.max(0, m)) : measureTicks(score.timeBeats, score.timeBeatType);
  return { staves: score.staves.map(() => restsFor(ticks)) };
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
    events = restsFor(barTicks(score, m));
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
  const bar = barTicks(score, m);
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
    if (eStart < end) after.push(...restsFor(eEnd - end, tuplet, tuplet ? type : undefined)); // partially overwritten
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
  // the new bar takes the time signature in effect where it is inserted
  score.measures.splice(at, 0, emptyMeasure(score, Math.max(0, at - 1)));
}

export function removeMeasure(score: Score, at: number) {
  if (score.measures.length <= 1) {
    score.measures[0] = emptyMeasure(score, 0);
    return;
  }
  // keep changes that started at the removed bar by moving them to the next one
  const gone = score.measures[at];
  const next = score.measures[at + 1];
  if (next) {
    if (gone.key !== undefined && next.key === undefined) next.key = gone.key;
    if (gone.time && !next.time) next.time = gone.time;
    if (gone.tempo && !next.tempo) next.tempo = gone.tempo;
    if (gone.clefs && !next.clefs) next.clefs = gone.clefs;
  }
  score.measures.splice(at, 1);
  refitMeasures(score);
}

/** Re-fit every bar to its time signature: truncate overflow, pad with rests. */
export function refitMeasures(score: Score) {
  const ctx = contexts(score);
  score.measures.forEach((measure, m) => {
    const bar = ctx[m].ticks;
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
    // bars that already fit are left untouched (keeps ids, ties and rest spelling)
    const fits = (l: NoteEvent[]) => l.reduce((a, e) => a + eventTicks(e), 0) === bar;
    measure.staves = measure.staves.map((l) => (fits(l) ? l : fit(l)));
    if (measure.voice2) measure.voice2 = measure.voice2.map((l) => (l ? (fits(l) ? l : fit(l)) : null));
  });
}

/** Make sure every measure has one event list per staff. */
export function syncStaves(score: Score) {
  for (const measure of score.measures) {
    const m = score.measures.indexOf(measure);
    while (measure.staves.length < score.staves.length) measure.staves.push(restsFor(barTicks(score, m)));
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

/**
 * Re-bar the music from bar `from` on after a time-signature change: every lane's notes
 * flow into the new bar lengths in order, notes crossing a bar line are split and tied,
 * tuplets that do not fit move to the next bar, and bars are added at the end if needed.
 * Nothing is lost (unlike trimming each bar).
 */
export function reflow(score: Score, from: number) {
  const staves = score.staves.length;
  const lanesToFlow: { s: number; v: number; events: NoteEvent[] }[] = [];
  for (let s = 0; s < staves; s++) {
    for (const v of [0, 1]) {
      if (v && !score.measures.slice(from).some((m) => m.voice2?.[s])) continue;
      // the old stream (a missing voice 2 counts as a bar of rest so the voices stay aligned)
      const stream: NoteEvent[] = [];
      score.measures.slice(from).forEach((bar) => {
        const l = laneOf(bar, s, v);
        if (l) stream.push(...l);
        // no second voice here: rest for the bar's (old) length, taken from voice 1
        else stream.push(...restsFor(bar.staves[s].reduce((a, e) => a + eventTicks(e), 0)));
      });
      // trailing rests carry no music
      let last = stream.length - 1;
      while (last >= 0 && isRest(stream[last])) last--;
      lanesToFlow.push({ s, v, events: stream.slice(0, last + 1) });
    }
  }

  // write each stream into the new bar lengths
  const ctxOf = (m: number) => barTicks(score, Math.min(m, score.measures.length - 1));
  const result = lanesToFlow.map(({ s, v, events }) => {
    const bars: NoteEvent[][] = [[]];
    let m = from;
    let used = 0;
    const room = () => ctxOf(m) - used;
    const nextBar = () => {
      if (room() > 0) bars[bars.length - 1].push(...restsFor(room()));
      bars.push([]);
      m++;
      used = 0;
    };
    for (const e of events) {
      let remaining = eventTicks(e);
      if (e.tuplet && remaining > room()) nextBar(); // tuplets do not split
      let first = true;
      let prev: NoteEvent | null = null;
      while (remaining > 0) {
        if (room() <= 0) nextBar();
        const fits = remaining <= room();
        const pieces = fits && first ? [{ type: e.type, dots: e.dots, tuplet: e.tuplet }] : fill(Math.min(remaining, room()));
        for (const piece of pieces) {
          const len = ticksOf(piece.type, piece.dots, piece.tuplet);
          const out: NoteEvent = first
            ? { ...e, type: piece.type, dots: piece.dots, ...(piece.tuplet ? { tuplet: piece.tuplet } : {}) }
            : { id: uid(), pitches: e.pitches.map((p) => ({ ...p })), type: piece.type, dots: piece.dots, ...(piece.tuplet ? { tuplet: piece.tuplet } : {}) };
          if (!piece.tuplet) delete out.tuplet;
          delete out.tie; // the original tie (if any) goes on the last piece, below
          if (prev && !isRest(e)) prev.tie = true; // pieces of one note are tied together
          bars[bars.length - 1].push(out);
          prev = out;
          first = false;
          used += len;
          remaining -= len;
        }
      }
      if (prev && e.tie && !isRest(e)) prev.tie = true;
    }
    if (room() > 0) bars[bars.length - 1].push(...restsFor(room()));
    return { s, v, bars };
  });

  // make room and put the new bars in place
  const needed = Math.max(...result.map((r) => r.bars.length), 1);
  while (score.measures.length < from + needed) insertMeasure(score, score.measures.length);
  for (let k = from; k < score.measures.length; k++) {
    for (let s = 0; s < staves; s++) {
      setLane(score.measures[k], s, 0, restsFor(barTicks(score, k)));
      if (score.measures[k].voice2?.[s]) score.measures[k].voice2![s] = null;
    }
    if (score.measures[k].voice2?.every((l) => !l)) delete score.measures[k].voice2;
  }
  for (const { s, v, bars } of result) {
    bars.forEach((events, k) => {
      if (v && events.every(isRest)) return; // no second voice needed in this bar
      setLane(score.measures[from + k], s, v, tidyRests(events));
    });
  }
}

/** A timed item to lay into bars: a chord (or a rest when `pitches` is empty) lasting `ticks`. */
export interface StreamItem {
  pitches: Pitch[];
  ticks: number;
}

/**
 * Write a stream of chords/rests into one lane starting at bar `fromBar`, overwriting
 * what is there: items crossing a bar line are split and tied, odd lengths become
 * tuplets where needed (via fill), and bars are added at the end when the music runs on.
 * Returns the bar after the last one written.
 */
export function writeStream(score: Score, s: number, items: StreamItem[], fromBar = 0, v = 0): number {
  let m = fromBar;
  let bar: NoteEvent[] = [];
  let used = 0;
  const room = () => barTicks(score, m) - used;
  const flush = () => {
    if (room() > 0) bar.push(...restsFor(room()));
    if (m >= score.measures.length) insertMeasure(score, score.measures.length);
    setLane(score.measures[m], s, v, tidyRests(bar));
    m++;
    bar = [];
    used = 0;
  };
  for (const item of items) {
    let remaining = item.ticks;
    let prev: NoteEvent | null = null;
    while (remaining > 0) {
      if (m >= score.measures.length) insertMeasure(score, score.measures.length);
      if (room() <= 0) flush();
      const len = Math.min(remaining, room());
      // a note that is exactly one (possibly dotted) value is written as that value, not tied pieces
      const single = item.pitches.length ? largestFitting(len) : null;
      const pieces = single && ticksOf(single.type, single.dots) === len ? [single] : fill(len);
      for (const piece of pieces as Piece[]) {
        const ev: NoteEvent = {
          id: uid(),
          pitches: item.pitches.map((p) => ({ ...p })),
          type: piece.type,
          dots: piece.dots,
          ...(piece.tuplet ? { tuplet: piece.tuplet } : {}),
        };
        if (prev && item.pitches.length) prev.tie = true;
        bar.push(ev);
        prev = ev;
        used += ticksOf(piece.type, piece.dots, piece.tuplet);
      }
      remaining -= len;
    }
  }
  if (bar.length || used) flush();
  return m;
}
