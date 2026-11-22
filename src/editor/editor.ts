import {
  clefMiddle,
  diatonic,
  enharmonic,
  keyAlter,
  midiOf,
  nearestPitch,
  pitchAtStaffPosition,
  shiftDiatonic,
  spellMidi,
} from '../model/pitch';
import { decompose, ticksOf } from '../model/duration';
import {
  allEvents,
  barTicks,
  clearEvent,
  ensureLane,
  eventAt,
  lane,
  laneOf,
  lanesOf,
  eventTicks,
  insertMeasure,
  newScore,
  removeMeasure,
  startTick,
  writeAt,
} from '../model/score';
import { MAX_VERSES, setLyricOn } from '../model/lyrics';
import { transposeEvents, transposeScore } from '../model/transpose';
import {
  isRest,
  TRIPLET,
  type Accompaniment,
  type Articulation,
  type DurationType,
  type Dynamic,
  type JumpType,
  type Lyric,
  type NoteEvent,
  type Pitch,
  type PrintSettings,
  type Score,
  type Step,
} from '../model/types';

export interface Cursor {
  m: number;
  s: number;
  i: number;
  /** Voice on the staff: 0 = voice 1 (stems up when two voices), 1 = voice 2. */
  v?: number;
}

export interface Located {
  m: number;
  s: number;
  i: number;
  v?: number;
  e: NoteEvent;
}

/** What the number row does — Flat calls these toolbars. */
export type Palette = 'notes' | 'articulations' | 'dynamics';
export type Tool = 'keyboard' | 'pencil';

type Listener = (kind: 'score' | 'cursor' | 'ui') => void;
type EventData = Omit<NoteEvent, 'id'>;
/** Clipboard entry: slurs are kept as an index into the same copied staff. */
type ClipEvent = EventData & { slurTo?: number };
/** One copied lane: staff offset from the first copied staff, and the voice. */
type ClipLane = { ds: number; v: number; events: ClipEvent[] };

const STORAGE_KEY = 'pianissimo:autosave';
const HISTORY_LIMIT = 200;

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function findIn(score: Score, id: string): NoteEvent | undefined {
  return allEvents(score).find((e) => e.id === id);
}

export class Editor {
  score: Score;
  cursor: Cursor = { m: 0, s: 0, i: 0 };
  /** Other end of a range selection; null when nothing is selected. */
  anchor: Cursor | null = null;
  inputType: DurationType = 'q';
  inputDots = 0;
  inputTriplet = false;
  palette: Palette = 'notes';
  tool: Tool = 'keyboard';
  /** Last note written by the user, the target for chord/accidental/tie commands. */
  lastEntered: string | null = null;
  /** Playback switches (shown on the toolbar). */
  metronome = false;
  countIn = false;
  loop = false;
  /** Copied events, one list per staff. */
  clipboard: ClipLane[] | null = null;

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners: Listener[] = [];
  /** Called when a note should be auditioned. */
  onPreview: (pitches: Pitch[], staff: number) => void = () => {};

  constructor(score?: Score) {
    this.score = score ?? Editor.restore() ?? newScore();
  }

  // ---------- events ----------
  subscribe(fn: Listener) {
    this.listeners.push(fn);
  }
  emit(kind: 'score' | 'cursor' | 'ui') {
    for (const l of this.listeners) l(kind);
  }

  // ---------- persistence & history ----------
  static restore(): Score | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Score) : null;
    } catch {
      return null;
    }
  }

  private autosave() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.score));
    } catch {
      /* storage full or unavailable */
    }
  }

  /** Apply a change to the score with undo support. */
  mutate(fn: (score: Score) => void) {
    const before = JSON.stringify(this.score);
    fn(this.score);
    if (JSON.stringify(this.score) === before) {
      this.emit('cursor');
      return;
    }
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.clampCursor();
    this.autosave();
    this.emit('score');
  }

  private restoreSnapshot(json: string) {
    this.score = JSON.parse(json);
    this.anchor = null;
    this.clampCursor();
    this.autosave();
    this.emit('score');
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.score));
    this.restoreSnapshot(prev);
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.score));
    this.restoreSnapshot(next);
  }

  load(score: Score) {
    this.undoStack.push(JSON.stringify(this.score));
    this.redoStack = [];
    this.score = score;
    this.cursor = { m: 0, s: 0, i: 0 };
    this.anchor = null;
    this.lastEntered = null;
    this.autosave();
    this.emit('score');
  }

  // ---------- cursor ----------
  get events(): NoteEvent[] {
    return lane(this.score, this.cursor.m, this.cursor.s, this.cursor.v);
  }
  get voice(): number {
    return this.cursor.v ?? 0;
  }
  get current(): NoteEvent | undefined {
    return this.events[this.cursor.i];
  }

  private clampPos(c: Cursor) {
    c.m = Math.max(0, Math.min(c.m, this.score.measures.length - 1));
    c.s = Math.max(0, Math.min(c.s, this.score.staves.length - 1));
    // voice 2 only where it exists in this bar
    if (c.v && !laneOf(this.score.measures[c.m], c.s, c.v)) c.v = 0;
    c.i = Math.max(0, Math.min(c.i, lane(this.score, c.m, c.s, c.v).length - 1));
  }

  clampCursor() {
    this.clampPos(this.cursor);
    if (this.anchor) this.clampPos(this.anchor);
  }

  setCursor(c: Cursor, extend = false) {
    this.beginMove(extend);
    this.cursor = { ...c };
    this.clampCursor();
    this.emit('cursor');
  }

  /** Start/clear a range selection before a cursor move. */
  private beginMove(extend: boolean) {
    if (extend) this.anchor ??= { ...this.cursor };
    else this.anchor = null;
  }

  /** Move one event; crossing bar lines. */
  step(dir: 1 | -1, extend = false) {
    this.beginMove(extend);
    const c = this.cursor;
    if (dir > 0) {
      if (c.i < this.events.length - 1) c.i++;
      else if (c.m < this.score.measures.length - 1) {
        c.m++;
        c.i = 0;
      }
    } else {
      if (c.i > 0) c.i--;
      else if (c.m > 0) {
        c.m--;
        c.i = this.events.length - 1;
      }
    }
    this.clampCursor();
    this.emit('cursor');
  }

  stepMeasure(dir: 1 | -1, extend = false) {
    if (extend && dir > 0) {
      // extend to the end of the next bar
      this.beginMove(true);
      const m = Math.min(this.score.measures.length - 1, this.cursor.m + (this.cursor.i === this.events.length - 1 ? 1 : 0));
      this.cursor = { ...this.cursor, m, i: lane(this.score, m, this.cursor.s, this.cursor.v).length - 1 };
      this.clampCursor();
      this.emit('cursor');
      return;
    }
    this.setCursor({ ...this.cursor, m: this.cursor.m + dir, i: 0 }, extend);
  }

  stepStaff(dir: 1 | -1, extend = false) {
    this.beginMove(extend);
    const tick = startTick(this.events, this.cursor.i);
    this.cursor.s = Math.max(0, Math.min(this.score.staves.length - 1, this.cursor.s + dir));
    this.cursor.v = 0;
    this.cursor.i = this.indexAtTick(this.cursor.m, this.cursor.s, tick);
    this.emit('cursor');
  }

  private indexAtTick(m: number, s: number, tick: number, v = 0) {
    let t = 0;
    const ev = lane(this.score, m, s, v);
    for (let i = 0; i < ev.length; i++) {
      t += eventTicks(ev[i]);
      if (t > tick) return i;
    }
    return ev.length - 1;
  }

  // ---------- selection ----------
  private absStart(c: Cursor) {
    return c.m * barTicks(this.score) + startTick(lane(this.score, c.m, c.s, c.v), c.i);
  }

  selectAll() {
    const last = this.score.measures.length - 1;
    const s = this.score.staves.length - 1;
    this.anchor = { m: 0, s: 0, i: 0 };
    this.cursor = { m: last, s, i: lane(this.score, last, s).length - 1 };
    this.emit('cursor');
  }

  /** Range covered by the selection, or null. */
  selectionRange(): { start: number; end: number; s0: number; s1: number } | null {
    if (!this.anchor) return null;
    const a = this.anchor;
    const c = this.cursor;
    const ev = (p: Cursor) => eventAt(this.score, p)!;
    const aStart = this.absStart(a);
    const cStart = this.absStart(c);
    const start = Math.min(aStart, cStart);
    const end = Math.max(aStart + eventTicks(ev(a)), cStart + eventTicks(ev(c)));
    return { start, end, s0: Math.min(a.s, c.s), s1: Math.max(a.s, c.s) };
  }

  /** Every event (rests included) inside the selection: per staff, voice 1 then voice 2, in time order. */
  selected(): Located[] {
    const r = this.selectionRange();
    if (!r) return [];
    const bar = barTicks(this.score);
    const out: Located[] = [];
    for (let s = r.s0; s <= r.s1; s++) {
      for (const v of [0, 1]) {
        for (let m = Math.floor(r.start / bar); m < this.score.measures.length && m * bar < r.end; m++) {
          let t = m * bar;
          laneOf(this.score.measures[m], s, v)?.forEach((e, i) => {
            if (t >= r.start && t < r.end) out.push({ m, s, i, v, e });
            t += eventTicks(e);
          });
        }
      }
    }
    return out;
  }

  clearSelection() {
    if (!this.anchor) return;
    this.anchor = null;
    this.emit('cursor');
  }

  // ---------- lookup ----------
  find(id: string | null): Located | null {
    if (!id) return null;
    for (let m = 0; m < this.score.measures.length; m++) {
      const measure = this.score.measures[m];
      for (let s = 0; s < measure.staves.length; s++) {
        for (const { v, events } of lanesOf(measure, s)) {
          const i = events.findIndex((e) => e.id === id);
          if (i >= 0) return { m, s, i, v, e: events[i] };
        }
      }
    }
    return null;
  }

  /** The note commands act on: the note under the cursor, else the note just typed. */
  target(): Located | null {
    const cur = this.current;
    if (cur && !isRest(cur)) return { ...this.cursor, e: cur };
    const last = this.find(this.lastEntered);
    return last && !isRest(last.e) ? last : null;
  }

  /** All notes a command applies to: the selection's notes, or the single target. */
  targets(): Located[] {
    if (this.anchor) return this.selected().filter((x) => !isRest(x.e));
    const t = this.target();
    return t ? [t] : [];
  }

  /** Next event after a position on the same staff (crossing bar lines). */
  private nextOnStaff(p: Located): Located | null {
    const v = p.v ?? 0;
    const staff = lane(this.score, p.m, p.s, v);
    if (p.i + 1 < staff.length) return { m: p.m, s: p.s, i: p.i + 1, v, e: staff[p.i + 1] };
    const next = lane(this.score, p.m + 1, p.s, v)[0];
    return next ? { m: p.m + 1, s: p.s, i: 0, v, e: next } : null;
  }

  /** Pitch to search from when picking the octave for a typed letter. */
  private referencePitch(): Pitch {
    const { m, s, i } = this.cursor;
    for (let mm = m; mm >= 0; mm--) {
      const ev = lane(this.score, mm, s, this.voice);
      for (let k = mm === m ? i - 1 : ev.length - 1; k >= 0; k--) {
        if (!isRest(ev[k])) {
          const ps = ev[k].pitches;
          return ps.reduce((a, b) => (diatonic(a) >= diatonic(b) ? a : b));
        }
      }
    }
    return clefMiddle(this.score.staves[s].clef);
  }

  // ---------- entry ----------
  /**
   * Write one event at (m, s, i), overwriting what is there. Values longer than the
   * room left in the bar are split across the bar line and tied (tuplets move to the
   * next bar instead). Returns the position after the event and the id written first.
   */
  private writeEvent(
    score: Score,
    m: number,
    s: number,
    i: number,
    ev: EventData,
    v = 0,
  ): { m: number; i: number; id: string } {
    const bar = barTicks(score);
    let remaining = eventTicks(ev);
    let first = true;
    let id = '';
    let prev: NoteEvent | null = null;
    const pitched = ev.pitches.length > 0;
    const { pitches, type, dots, tuplet, tie, slurEnd: _slur, ...extra } = ev;

    const advanceIfFull = () => {
      if (i >= ensureLane(score, m, s, v).length) {
        if (m === score.measures.length - 1) insertMeasure(score, score.measures.length);
        m++;
        i = 0;
      }
    };

    while (remaining > 0) {
      const room = bar - startTick(ensureLane(score, m, s, v), i); // voice 2 continues into the next bar
      let pieces: { type: DurationType; dots: number; tuplet?: typeof tuplet }[];
      if (tuplet) {
        if (remaining > room) {
          // tuplets don't split: start them in the next bar
          i = ensureLane(score, m, s, v).length;
          advanceIfFull();
          continue;
        }
        pieces = [{ type, dots, tuplet }];
      } else {
        pieces = first && remaining <= room ? [{ type, dots }] : decompose(Math.min(remaining, room), false);
      }
      if (!pieces.length) break; // sub-64th remainder: nothing notatable
      for (const piece of pieces) {
        if (prev && pitched) prev.tie = true;
        const idx = writeAt(score, m, s, i, { pitches: clone(pitches), ...piece }, first ? clone(extra) : undefined, v);
        prev = lane(score, m, s, v)[idx];
        if (first) id = prev.id;
        first = false;
        remaining -= ticksOf(piece.type, piece.dots, piece.tuplet);
        i = idx + 1;
      }
      advanceIfFull();
    }
    if (prev && pitched && tie) prev.tie = true;
    return { m, i, id };
  }

  /** Write a note (or rest when pitches is empty) at the cursor and advance. */
  write(pitches: Pitch[]) {
    const { s } = this.cursor;
    const v = this.voice;
    let pos = { m: this.cursor.m, i: this.cursor.i, id: '' };
    this.anchor = null;
    this.mutate((score) => {
      pos = this.writeEvent(
        score,
        this.cursor.m,
        s,
        this.cursor.i,
        {
          pitches,
          type: this.inputType,
          dots: this.inputDots,
          ...(this.inputTriplet ? { tuplet: TRIPLET } : {}),
        },
        v,
      );
      // keep typing in voice 2 when the line continues into the next bar
      if (v) ensureLane(score, pos.m, s, v);
    });
    this.lastEntered = pitches.length ? pos.id : null;
    if (pitches.length) this.onPreview(pitches, s);
    this.setCursor({ m: pos.m, s, i: pos.i, v });
  }

  typeLetter(step: Step) {
    this.write([nearestPitch(step, this.referencePitch(), this.score.keyFifths)]);
  }

  /** Notes from a MIDI keyboard (one or several keys pressed together). */
  writeMidi(notes: number[]) {
    if (!notes.length) return;
    this.write([...notes].sort((a, b) => a - b).map((n) => spellMidi(n, this.score.keyFifths)));
  }

  writePitchAt(c: Cursor, pitch: Pitch) {
    this.cursor = { ...c };
    this.write([pitch]);
  }

  rest() {
    this.write([]);
  }

  /** Add a letter to the target chord, above its top note. */
  addToChord(step: Step) {
    const t = this.target();
    if (!t) return this.typeLetter(step);
    const top = t.e.pitches.reduce((a, b) => (diatonic(a) >= diatonic(b) ? a : b));
    let p = nearestPitch(step, top, this.score.keyFifths);
    if (diatonic(p) <= diatonic(top)) p = { ...p, octave: p.octave + 1 };
    this.addPitch(t, p);
  }

  /** Add an interval (2 = second … 8 = octave) above the target's top note. */
  addInterval(n: number) {
    const t = this.target();
    if (!t) return;
    const top = t.e.pitches.reduce((a, b) => (diatonic(a) >= diatonic(b) ? a : b));
    this.addPitch(t, shiftDiatonic(top, n - 1, this.score.keyFifths));
  }

  private addPitch(t: Located, p: Pitch) {
    if (t.e.pitches.some((q) => midiOf(q) === midiOf(p))) return;
    this.mutate((score) => {
      eventAt(score, t)!.pitches.push(p);
    });
    this.lastEntered = t.e.id;
    this.onPreview([...t.e.pitches, p], t.s);
  }

  // ---------- editing the target(s) ----------
  private updateTargets(fn: (e: NoteEvent) => void, preview = true) {
    const ts = this.targets();
    if (!ts.length) return;
    this.mutate((score) => {
      for (const t of ts) fn(eventAt(score, t)!);
    });
    if (preview && ts.length === 1) {
      const e = eventAt(this.score, ts[0])!;
      if (!isRest(e)) this.onPreview(e.pitches, ts[0].s);
    }
  }

  /** Raise/lower by diatonic step (all chord notes; whole selection when there is one). */
  shift(steps: number) {
    this.updateTargets((e) => {
      e.pitches = e.pitches.map((p) => shiftDiatonic(p, steps, this.score.keyFifths));
    });
  }

  octave(dir: 1 | -1) {
    this.updateTargets((e) => {
      e.pitches = e.pitches.map((p) => ({ ...p, octave: p.octave + dir }));
    });
  }

  /** Toggle sharp/flat/natural. Pressing again returns to the key-signature default. */
  accidental(alter: number) {
    const fifths = this.score.keyFifths;
    this.updateTargets((e) => {
      e.pitches = e.pitches.map((p) => ({ ...p, alter: p.alter === alter ? keyAlter(p.step, fifths) : alter }));
    });
  }

  enharmonic() {
    this.updateTargets((e) => {
      e.pitches = e.pitches.map(enharmonic);
    }, false);
  }

  toggleTie() {
    const ts = this.targets();
    const on = !ts.every((t) => t.e.tie);
    this.updateTargets((e) => {
      if (on) e.tie = true;
      else delete e.tie;
    }, false);
  }

  /**
   * Slur: over the selection (first to last note of the top staff) or from the
   * target note to the next note. Toggles off when the start note already has one.
   */
  toggleSlur() {
    const ts = this.targets();
    if (!ts.length) return;
    const from = ts[0];
    let to: Located | null = null;
    if (this.anchor) {
      const sameStaff = ts.filter((t) => t.s === from.s);
      to = sameStaff.length > 1 ? sameStaff[sameStaff.length - 1] : null;
    } else {
      for (let n = this.nextOnStaff(from); n; n = this.nextOnStaff(n)) {
        if (!isRest(n.e)) {
          to = n;
          break;
        }
      }
    }
    this.mutate((score) => {
      const e = eventAt(score, from)!;
      if (e.slurEnd) delete e.slurEnd;
      else if (to) e.slurEnd = to.e.id;
    });
  }

  toggleArticulation(a: Articulation) {
    const ts = this.targets();
    const on = !ts.every((t) => t.e.articulations?.includes(a));
    this.updateTargets((e) => {
      const set = new Set(e.articulations ?? []);
      if (on) set.add(a);
      else set.delete(a);
      e.articulations = [...set];
      if (!e.articulations.length) delete e.articulations;
    }, false);
  }

  /** Dynamics go on the first note of the selection (per staff), or the target. */
  toggleDynamic(d: Dynamic) {
    const ts = this.targets();
    const firsts = ts.filter((t, k) => ts.findIndex((u) => u.s === t.s) === k);
    this.mutate((score) => {
      for (const t of firsts) {
        const e = eventAt(score, t)!;
        if (e.dynamic === d) delete e.dynamic;
        else e.dynamic = d;
      }
    });
  }

  /** Set the input duration; also re-times the note under the cursor (Flat behaviour). */
  setDuration(type: DurationType) {
    this.inputType = type;
    this.inputDots = 0;
    this.retimeCurrent();
    this.emit('ui');
  }

  toggleDot() {
    this.inputDots = this.inputDots ? 0 : 1;
    this.retimeCurrent();
    this.emit('ui');
  }

  toggleTriplet() {
    this.inputTriplet = !this.inputTriplet;
    this.retimeCurrent();
    this.emit('ui');
  }

  private retimeCurrent() {
    const cur = this.current;
    if (!cur || isRest(cur) || this.anchor) return;
    const { m, s, i } = this.cursor;
    const v = this.voice;
    this.mutate((score) => {
      writeAt(
        score,
        m,
        s,
        i,
        { pitches: cur.pitches, type: this.inputType, dots: this.inputDots, tuplet: this.inputTriplet ? TRIPLET : undefined },
        cur,
        v,
      );
    });
  }

  /** Duplicate the target note at the cursor. */
  duplicate() {
    const t = this.target();
    if (!t) return;
    this.inputType = t.e.type;
    this.inputDots = t.e.dots;
    this.inputTriplet = !!t.e.tuplet;
    this.write(clone(t.e.pitches));
  }

  // ---------- removing ----------
  remove() {
    if (this.anchor) {
      const sel = this.selected();
      // clear only the notes, from the end: merging rests after a note never moves an earlier note
      const notes = sel.filter((x) => !isRest(x.e)).reverse();
      this.mutate((score) => notes.forEach((x) => clearEvent(score, x.m, x.s, x.i, x.v)));
      this.clampCursor();
      return;
    }
    const { m, s, i } = this.cursor;
    const v = this.voice;
    const tick = startTick(this.events, i);
    this.mutate((score) => clearEvent(score, m, s, i, v));
    // rests may have merged: stay on the same beat
    this.cursor.i = this.indexAtTick(m, s, tick, v);
    this.emit('cursor');
  }

  backspace() {
    if (this.anchor) return this.remove();
    const cur = this.current;
    if (!cur || isRest(cur)) this.step(-1);
    this.remove();
  }

  // ---------- clipboard ----------
  copy(): number {
    const sel = this.selected();
    if (!sel.length) {
      const cur = this.current;
      if (!cur) return 0;
      this.clipboard = [{ ds: 0, v: 0, events: [this.stripForClipboard(cur, [])] }];
      return 1;
    }
    const r = this.selectionRange()!;
    this.clipboard = [];
    for (let s = r.s0; s <= r.s1; s++) {
      for (const v of [0, 1]) {
        const laneEvents = sel.filter((x) => x.s === s && (x.v ?? 0) === v).map((x) => x.e);
        // a second voice that is only rests is not worth copying
        if (!laneEvents.length || (v && laneEvents.every(isRest))) continue;
        this.clipboard.push({ ds: s - r.s0, v, events: laneEvents.map((e) => this.stripForClipboard(e, laneEvents)) });
      }
    }
    return sel.length;
  }

  private stripForClipboard(e: NoteEvent, copied: NoteEvent[]): ClipEvent {
    const { id: _id, slurEnd, ...rest } = clone(e);
    const to = slurEnd ? copied.findIndex((x) => x.id === slurEnd) : -1;
    return to >= 0 ? { ...rest, slurTo: to } : rest;
  }

  cut() {
    const n = this.copy();
    if (n) this.remove();
    return n;
  }

  /** Paste at the cursor; each copied staff goes onto consecutive staves from the cursor's. */
  paste(): boolean {
    const clip = this.clipboard;
    if (!clip?.length) return false;
    const { m, s, i } = this.cursor;
    const tick = startTick(this.events, i);
    let end = { m, i };
    this.mutate((score) => {
      clip.forEach(({ ds, v, events }, k) => {
        const staff = s + ds;
        if (staff >= score.staves.length) return;
        if (v) ensureLane(score, m, staff, v);
        let pos = { m, i: this.indexAtTick(m, staff, tick, v) };
        const ids: string[] = [];
        for (const { slurTo: _to, ...ev } of events) {
          const r = this.writeEvent(score, pos.m, staff, pos.i, clone(ev), v);
          ids.push(r.id);
          pos = { m: r.m, i: r.i };
        }
        // re-link slurs that were inside the copied range
        events.forEach((ev, j) => {
          if (ev.slurTo === undefined) return;
          const from = findIn(score, ids[j]);
          if (from) from.slurEnd = ids[ev.slurTo];
        });
        if (k === 0) end = pos;
      });
    });
    this.setCursor({ m: end.m, s, i: end.i });
    return true;
  }

  // ---------- bars ----------
  addMeasureAfter() {
    const m = this.cursor.m;
    this.mutate((score) => insertMeasure(score, m + 1));
    this.setCursor({ m: m + 1, s: this.cursor.s, i: 0 });
  }

  addMeasureAtEnd() {
    this.mutate((score) => insertMeasure(score, score.measures.length));
  }

  deleteMeasure() {
    const m = this.cursor.m;
    this.anchor = null;
    this.mutate((score) => removeMeasure(score, m));
    this.cursor.i = 0;
    this.clampCursor();
    this.emit('cursor');
  }

  toggleRepeat(which: 'repeatStart' | 'repeatEnd') {
    const m = this.cursor.m;
    this.mutate((score) => {
      const measure = score.measures[m];
      if (measure[which]) delete measure[which];
      else measure[which] = true;
    });
  }

  // ---------- voices ----------
  /**
   * Switch the cursor between voice 1 and voice 2 of the staff (Flat/MuseScore style).
   * Voice 2 is created for this bar on first use; the cursor keeps its beat.
   */
  toggleVoice() {
    const { m, s } = this.cursor;
    const tick = startTick(this.events, this.cursor.i);
    const v = this.voice ? 0 : 1;
    this.anchor = null;
    if (v && !laneOf(this.score.measures[m], s, 1)) this.mutate((score) => ensureLane(score, m, s, 1));
    this.cursor = { m, s, v, i: this.indexAtTick(m, s, tick, v) };
    this.clampCursor();
    this.emit('ui');
    this.emit('cursor');
  }

  /** Remove voice 2 from the bar (or selected bars) of the cursor's staff. */
  removeVoice2() {
    const s = this.cursor.s;
    const ms = this.selectedMeasures();
    this.anchor = null;
    this.mutate((score) => {
      for (const m of ms) {
        const v2 = score.measures[m].voice2;
        if (v2?.[s]) v2[s] = null;
        if (v2 && v2.every((l) => !l)) delete score.measures[m].voice2;
      }
    });
    this.cursor.v = 0;
    this.clampCursor();
    this.emit('cursor');
  }

  // ---------- lyrics, chord symbols, sounds ----------
  /** Neighbouring event on the same staff (crossing bar lines), optionally skipping rests. */
  neighbor(c: Cursor, dir: 1 | -1, skipRests: boolean): Cursor | null {
    let { m, i } = c;
    for (;;) {
      const v = c.v ?? 0;
      i += dir;
      if (i < 0) {
        if (--m < 0) return null;
        i = lane(this.score, m, c.s, v).length - 1;
        if (i < 0) continue; // no such voice in that bar
      } else if (i >= lane(this.score, m, c.s, v).length) {
        if (++m >= this.score.measures.length) return null;
        i = -1; // re-enter the loop at the start of the next bar
        continue;
      }
      const e = lane(this.score, m, c.s, v)[i];
      if (!skipRests || !isRest(e)) return { m, s: c.s, i, v };
    }
  }

  eventAt(c: Cursor): NoteEvent | undefined {
    return eventAt(this.score, c);
  }

  /** Verse being typed in lyrics mode (1-based). */
  lyricVerse = 1;

  setLyric(c: Cursor, lyric: Lyric | null, verse = this.lyricVerse) {
    this.mutate((score) => {
      const e = eventAt(score, c);
      if (!e || isRest(e)) return;
      setLyricOn(e, verse, lyric);
    });
  }

  setLyricVerse(verse: number) {
    this.lyricVerse = Math.max(1, Math.min(MAX_VERSES, verse));
    this.emit('ui');
  }

  /**
   * Toggle a navigation mark on the cursor's bar. Segno and Coda are unique in a
   * score (setting one moves it); a bar holds at most one D.C./D.S. jump.
   * Returns whether the mark is now on.
   */
  toggleNav(kind: 'segno' | 'coda' | 'toCoda' | 'fine' | JumpType): boolean {
    const m = this.cursor.m;
    let on = false;
    this.mutate((score) => {
      const bar = score.measures[m];
      if (kind === 'segno' || kind === 'coda' || kind === 'toCoda' || kind === 'fine') {
        on = !bar[kind];
        if (on && (kind === 'segno' || kind === 'coda')) for (const b of score.measures) delete b[kind];
        if (on) bar[kind] = true;
        else delete bar[kind];
      } else {
        on = bar.jump !== kind;
        if (on) bar.jump = kind;
        else delete bar.jump;
      }
    });
    return on;
  }

  clearNav() {
    const m = this.cursor.m;
    this.mutate((score) => {
      const bar = score.measures[m];
      for (const k of ['segno', 'coda', 'toCoda', 'fine', 'jump'] as const) delete bar[k];
    });
  }

  /** Toggle a line or page break after the cursor's bar. */
  toggleBreak(kind: 'lineBreak' | 'pageBreak') {
    const m = this.cursor.m;
    let on = false;
    this.mutate((score) => {
      const bar = score.measures[m];
      on = !bar[kind];
      if (on) bar[kind] = true;
      else delete bar[kind];
    });
    return on;
  }

  setPrint(patch: Partial<PrintSettings>) {
    this.mutate((score) => {
      score.print = { pageSize: 'a4', scale: 0.8, ...score.print, ...patch };
    });
  }

  setHarmony(c: Cursor, text: string | null) {
    this.mutate((score) => {
      const e = eventAt(score, c);
      if (!e) return;
      if (text && text.trim()) e.harmony = text.trim();
      else delete e.harmony;
    });
  }

  setStaffSound(s: number, sound: string) {
    this.mutate((score) => {
      if (score.staves[s]) score.staves[s].sound = sound;
    });
  }

  // ---------- endings, transposition, accompaniment ----------
  /** Bars covered by the selection, or the cursor's bar. */
  selectedMeasures(): number[] {
    const r = this.selectionRange();
    if (!r) return [this.cursor.m];
    const bar = barTicks(this.score);
    const out: number[] = [];
    for (let m = Math.floor(r.start / bar); m * bar < r.end && m < this.score.measures.length; m++) out.push(m);
    return out;
  }

  /** Cycle the bar(s) through: no ending → 1st ending → 2nd ending → none. */
  cycleVolta() {
    const ms = this.selectedMeasures();
    const cur = this.score.measures[ms[0]].volta ?? 0;
    const next = cur >= 2 ? 0 : cur + 1;
    this.mutate((score) => {
      for (const m of ms) {
        if (next) score.measures[m].volta = next;
        else delete score.measures[m].volta;
      }
    });
    return next;
  }

  /** Transpose by semitones: the whole score (key signature too) or only the selection. */
  transpose(semitones: number, wholeScore: boolean) {
    if (!semitones) return;
    if (wholeScore || !this.anchor) {
      this.mutate((score) => transposeScore(score, semitones));
      return;
    }
    const sel = this.selected();
    this.mutate((score) =>
      transposeEvents(
        sel.map((x) => eventAt(score, x)!),
        semitones,
        score.keyFifths,
      ),
    );
  }

  setAccompaniment(patch: Partial<Accompaniment>) {
    this.mutate((score) => {
      score.accompaniment = { enabled: false, style: 'pop', sound: 'piano', ...score.accompaniment, ...patch };
    });
  }

  /** Move notes by a semitone (chromatic), spelled in the current key. */
  chromatic(dir: 1 | -1) {
    this.updateTargets((e) => {
      e.pitches = e.pitches.map((p) => spellMidi(midiOf(p) + dir, this.score.keyFifths));
    });
  }

  togglePlayback(flag: 'metronome' | 'countIn' | 'loop') {
    this[flag] = !this[flag];
    this.emit('ui');
  }

  // ---------- modes ----------
  setPalette(p: Palette) {
    this.palette = p;
    this.emit('ui');
  }

  setTool(t: Tool) {
    this.tool = t;
    this.emit('ui');
  }

  /** Pitch for a mouse click at a vertical staff position. */
  pitchAt(s: number, halfSpacesFromTop: number): Pitch {
    return pitchAtStaffPosition(this.score.staves[s].clef, halfSpacesFromTop, this.score.keyFifths);
  }
}
