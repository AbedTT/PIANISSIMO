import './fonts'; // loads Bravura and Academico, and tells VexFlow to use them
import {
  Accidental,
  Annotation,
  Articulation,
  Barline,
  Beam,
  Curve,
  Dot,
  Formatter,
  Modifier,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Tuplet,
  GhostNote,
  GraceNote,
  GraceNoteGroup,
  MultiMeasureRest,
  TabNote,
  TabStave,
  Tremolo,
  PedalMarking,
  Repetition,
  StaveHairpin,
  TextBracket,
  TextBracketPosition,
  Voice,
  VoiceMode,
  VoltaType,
} from 'vexflow/core';
import { contexts, type BarContext } from '../model/context';
import { drumAt } from '../model/drums';
import { outOfRange } from '../model/checks';
import { chordShape, tabFor, type ChordShape } from '../model/guitar';
import { partsOf, writtenShift } from '../model/parts';
import { transposeEvents, transposeKey } from '../model/transpose';
import { prettyChord } from '../model/harmony';
import { lyricsOf } from '../model/lyrics';
import { diatonic, keyAlter, KEY_NAMES, midiOf } from '../model/pitch';
import { barTicks, eventTicks as eventTicksOf, lanesOf, laneOf, startTick, tupletGroups } from '../model/score';
import { isRest, type Articulation as Art, type Clef, type NoteEvent, type Score } from '../model/types';

const ART_CODE: Record<Art, string> = {
  staccato: 'a.',
  accent: 'a>',
  tenuto: 'a-',
  marcato: 'a^',
  fermata: 'a@a',
};
const ACC_CODE: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 0: 'n', 1: '#', 2: '##' };
const REST_KEY: Record<Clef, string> = { treble: 'b/4', bass: 'd/3', alto: 'c/4', percussion: 'b/4' };
/**
 * With several voices, rests move out of each other's way: voice 1 up, voice 2 down,
 * voices 3 and 4 a step further up and down.
 */
const REST_KEY_MV: Record<Clef, [string, string, string, string]> = {
  treble: ['e/5', 'f/4', 'a/5', 'd/4'],
  bass: ['g/3', 'a/2', 'c/4', 'f/2'],
  alto: ['f/4', 'g/3', 'b/4', 'e/3'],
  percussion: ['e/5', 'f/4', 'a/5', 'd/4'],
};
/** Odd voices (1, 3) have stems up, even voices (2, 4) stems down. */
const stemOf = (v: number) => (v % 2 ? -1 : 1);

/** Room under a staff for its tablature, and the tab staff's offset from the staff. */
const TAB_ROOM = 100;
const TAB_OFFSET = 62;
/** Room above the chord symbols for guitar chord diagrams. */
const DIAGRAM_ROOM = 58;
const DIAGRAM_W = 40;

/** Geometry of one rendered event, used for the cursor and mouse hit-testing. */
export interface EventBox {
  m: number;
  s: number;
  i: number;
  v?: number;
  x: number;
  width: number;
}

export interface StaveBox {
  m: number;
  s: number;
  x: number;
  width: number;
  /** y of the top staff line */
  top: number;
  spacing: number;
  noteStartX: number;
}

export interface SystemBox {
  /** y range of the whole system including chord symbols, endings and lyrics */
  top: number;
  bottom: number;
  measures: number[];
  /** a page break was requested after the last bar of this system */
  pageBreakAfter: boolean;
}

export interface Layout {
  events: Map<string, EventBox>;
  staves: StaveBox[];
  /** SVG note element per event id (for playback highlighting). */
  elements: Map<string, SVGElement>;
  systems: SystemBox[];
  height: number;
}

const STAFF_GAP = 100; // distance between staves of one system
const SYSTEM_GAP = 50; // extra space between systems
const MARGIN_X = 24;
const TOP = 10;

interface LaneBuild {
  v: number;
  events: NoteEvent[];
  notes: StaveNote[];
  /** null when the lane is not drawn (a voice 2 holding only rests). */
  voice: Voice | null;
  /** All rests, shown as one centred whole-bar rest. */
  collapsed: boolean;
  /** Fixed stem direction when the staff has two voices. */
  stem?: number;
}

interface BuiltMeasure {
  lanes: LaneBuild[][]; // per staff: voice 1, then voice 2 if present
  eventNote: Map<string, StaveNote>[]; // per staff: event id -> drawn note
  tuplets: Tuplet[];
  minWidth: number;
}

const laneVoices = (b: BuiltMeasure) => b.lanes.flat().flatMap((l) => (l.voice ? [l.voice] : []));

function buildMeasure(
  score: Score,
  m: number,
  ctx: BarContext,
  keyOf: (s: number) => number = () => ctx.key,
  flagged: (e: NoteEvent) => boolean = () => false,
): BuiltMeasure {
  const measure = score.measures[m];
  const lanes: LaneBuild[][] = [];
  const eventNote: Map<string, StaveNote>[] = [];
  const tuplets: Tuplet[] = [];

  measure.staves.forEach((_, s) => {
    const clef = ctx.clefs[s] ?? score.staves[s].clef;
    const map = new Map<string, StaveNote>();
    // voices 2–4 that hold only rests are not drawn
    const shown = (v: number, events: NoteEvent[]) => !v || events.some((e) => !isRest(e));
    const several = lanesOf(measure, s).filter(({ v, events }) => shown(v, events)).length > 1;
    // accidentals: what each step+octave currently sounds like in this bar (shared by all voices)
    const state = new Map<string, number>();
    const staffLanes: LaneBuild[] = lanesOf(measure, s).map(({ v, events }) => {
      const stem = several ? stemOf(v) : undefined;
      if (!shown(v, events)) return { v, events, notes: [], voice: null, collapsed: true };
      const restKey = several ? REST_KEY_MV[clef][v] : REST_KEY[clef];
      const notes: StaveNote[] = [];
      const collapsed = events.every(isRest);
      if (collapsed) {
        // A bar of nothing but rests shows one centred whole-bar rest.
        const n = new StaveNote({ keys: [restKey], duration: 'wr', clef, alignCenter: true });
        notes.push(n);
        events.forEach((e) => map.set(e.id, n));
      } else {
        for (const e of events) {
          const n = makeNote(e, clef, keyOf(s), state, stem, restKey);
          // a note the instrument cannot play is shown in red (editor only)
          if (flagged(e)) n.setStyle({ fillStyle: '#e03131', strokeStyle: '#e03131' });
          notes.push(n);
          map.set(e.id, n);
        }
        tuplets.push(...groupTuplets(events, notes));
      }
      const voice = new Voice({ numBeats: ctx.beats, beatValue: ctx.beatType });
      voice.setMode(VoiceMode.SOFT);
      voice.addTickables(notes);
      return { v, events, notes, voice, collapsed, stem };
    });
    lanes.push(staffLanes);
    eventNote.push(map);
  });

  let minWidth = 60;
  const built: BuiltMeasure = { lanes, eventNote, tuplets, minWidth };
  try {
    const f = new Formatter();
    for (const staff of lanes) {
      const vs = staff.flatMap((l) => (l.voice ? [l.voice] : []));
      if (vs.length) f.joinVoices(vs);
    }
    minWidth = f.preCalculateMinTotalWidth(laneVoices(built));
  } catch {
    minWidth = 30 * Math.max(...lanes.flat().map((l) => l.notes.length));
  }
  built.minWidth = minWidth;
  return built;
}

/** How far a voice 3 or 4 note moves right when it sounds together with voice 1 or 2. */
const SAME_STEM_SPREAD = 16;

/**
 * VexFlow separates two voices with opposite stems, but voices that share a stem direction
 * (1 with 3, 2 with 4) would be drawn on top of each other. After formatting, a voice 3 or 4
 * note that starts together with a note of voice 1 or 2 is moved to the right of it.
 */
function separateSameStemVoices(b: BuiltMeasure) {
  for (const staffLanes of b.lanes) {
    const starts = (l: LaneBuild) => {
      const at = new Map<number, StaveNote>();
      let t = 0;
      l.events.forEach((e, i) => {
        if (!isRest(e)) at.set(t, l.notes[i]);
        t += eventTicksOf(e);
      });
      return at;
    };
    for (const ln of staffLanes) {
      if (ln.v < 2 || !ln.voice || ln.collapsed) continue;
      const partner = staffLanes.find((x) => x.v === ln.v - 2 && x.voice && !x.collapsed);
      if (!partner) continue;
      const theirs = starts(partner);
      for (const [t, n] of starts(ln)) {
        const other = theirs.get(t);
        if (other) n.setXShift(other.getXShift() + SAME_STEM_SPREAD);
      }
    }
  }
}

/** Bracket tuplet groups. Must run before the notes join a voice: Tuplet rescales their ticks. */
function groupTuplets(events: NoteEvent[], notes: StaveNote[]): Tuplet[] {
  return tupletGroups(events).map((idx) => {
    const ratio = events[idx[0]].tuplet!;
    return new Tuplet(
      idx.map((k) => notes[k]),
      { numNotes: ratio.actual, notesOccupied: ratio.normal, bracketed: true },
    );
  });
}

function makeNote(
  e: NoteEvent,
  clef: Clef,
  fifths: number,
  state: Map<string, number>,
  stem?: number,
  restKey = REST_KEY[clef],
): StaveNote {
  if (isRest(e)) {
    const n = new StaveNote({ keys: [restKey], duration: e.type + 'r', dots: e.dots, clef });
    if (e.dots) Dot.buildAndAttach([n], { all: true });
    addText(n, e);
    return n;
  }
  const pitches = [...e.pitches].sort((a, b) => diatonic(a) - diatonic(b));
  const drums = clef === 'percussion';
  // cymbals and hi-hats get x noteheads
  const xHead = e.type === 'w' ? 'x0' : e.type === 'h' ? 'x1' : 'x2';
  const n = new StaveNote({
    keys: pitches.map((p) => `${p.step.toLowerCase()}/${p.octave}${drums && drumAt(p).x ? `/${xHead}` : ''}`),
    duration: e.type,
    dots: e.dots,
    clef,
    ...(stem ? { stemDirection: stem, autoStem: false } : { autoStem: true }),
  });
  pitches.forEach((p, idx) => {
    if (drums) return; // a drum staff has no accidentals
    const key = `${p.step}${p.octave}`;
    const current = state.has(key) ? state.get(key)! : keyAlter(p.step, fifths);
    if (current !== p.alter) {
      n.addModifier(new Accidental(ACC_CODE[p.alter] ?? 'n'), idx);
      state.set(key, p.alter);
    }
  });
  if (e.dots) Dot.buildAndAttach([n], { all: true });
  if (e.tremolo) n.addModifier(new Tremolo(e.tremolo), 0);
  if (e.graces?.length) {
    // slashed grace notes (acciaccature) before the main note, beamed when there are several
    const graces = e.graces.map((g) => {
      const ps = [...g.pitches].sort((a, b) => diatonic(a) - diatonic(b));
      const gn = new GraceNote({
        keys: ps.map((p) => `${p.step.toLowerCase()}/${p.octave}`),
        duration: e.graces!.length > 1 ? '16' : '8',
        slash: e.graces!.length === 1,
        clef,
      });
      ps.forEach((p, idx) => {
        if (drums) return;
        const key = `${p.step}${p.octave}`;
        const current = state.has(key) ? state.get(key)! : keyAlter(p.step, fifths);
        if (current !== p.alter) {
          gn.addModifier(new Accidental(ACC_CODE[p.alter] ?? 'n'), idx);
          state.set(key, p.alter);
        }
      });
      return gn;
    });
    const group = new GraceNoteGroup(graces, true);
    if (graces.length > 1) group.beamNotes();
    n.addModifier(group, 0);
  }
  for (const a of e.articulations ?? []) n.addModifier(new Articulation(ART_CODE[a]), 0);
  if (e.dynamic) {
    const ann = new Annotation(e.dynamic);
    ann.setFont('Times New Roman, serif', 15, 'bold', 'italic');
    ann.setVerticalJustification(Annotation.VerticalJustify.BOTTOM);
    n.addModifier(ann, 0);
  }
  addText(n, e);
  return n;
}

/**
 * Chord symbols and lyrics are drawn after layout on one baseline per staff and
 * system (see drawTextLines), so they line up like printed music. Nothing to attach here.
 */
function addText(_n: StaveNote, _e: NoteEvent) {}

interface TextItem {
  kind: 'chord' | 'lyric' | 'text';
  group: string; // system:staff:voice:kind+verse (one text line)
  /** lines sharing a baseline origin (all verses of one staff+voice in one system) */
  baseKey: string;
  /** 0-based line below the base (lyric verse - 1) */
  line: number;
  /** "1." label drawn before this line (first lyric line of a verse when there are several verses) */
  label?: string;
  x: number; // chords: left edge; lyrics: centre
  text: string;
  hyphen: boolean;
  noteTop: number;
  noteBottom: number;
  staveTop: number;
  staveBottom: number;
}

const CHORD_FONT = ['Arial, Helvetica, sans-serif', 15, 'bold'] as const;
const LYRIC_FONT = ['Georgia, Times New Roman, serif', 14, 'normal'] as const;

const VERSE_LINE = 19; // distance between verse lines

type Ctx = ReturnType<Renderer['getContext']>;

/** A guitar chord diagram with its bottom-left corner at (x, bottom). */
function drawChordDiagram(ctx: Ctx, shape: ChordShape, x: number, bottom: number) {
  const gap = DIAGRAM_W / 5;
  const fretH = 8;
  const top = bottom - 4 * fretH;
  ctx.save();
  ctx.setLineWidth(1);
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    ctx.moveTo(x + k * gap, top);
    ctx.lineTo(x + k * gap, bottom);
  }
  for (let f = 0; f <= 4; f++) {
    ctx.moveTo(x, top + f * fretH);
    ctx.lineTo(x + DIAGRAM_W, top + f * fretH);
  }
  ctx.stroke();
  if (shape.baseFret === 1) ctx.fillRect(x - 0.5, top - 2.5, DIAGRAM_W + 1, 3); // the nut
  else {
    ctx.setFont('Arial, Helvetica, sans-serif', 9, 'normal');
    ctx.fillText(`${shape.baseFret}fr`, x + DIAGRAM_W + 3, top + fretH - 1);
  }
  ctx.setFont('Arial, Helvetica, sans-serif', 8, 'normal');
  shape.frets.forEach((f, k) => {
    const sx = x + k * gap;
    if (f < 0) ctx.fillText('×', sx - 2.5, top - 4);
    else if (f === 0) {
      ctx.beginPath();
      ctx.arc(sx, top - 6, 2.2, 0, Math.PI * 2, false);
      ctx.stroke();
    } else if (!(shape.barre && f === shape.barre.fret)) {
      ctx.beginPath();
      ctx.arc(sx, top + (f - shape.baseFret + 0.5) * fretH, 2.8, 0, Math.PI * 2, false);
      ctx.fill();
    }
  });
  if (shape.barre) {
    const from = x + (6 - shape.barre.from) * gap;
    const to = x + (6 - shape.barre.to) * gap;
    const cy = top + (shape.barre.fret - shape.baseFret + 0.5) * fretH;
    ctx.fillRect(from - 2.5, cy - 2.5, to - from + 5, 5);
  }
  ctx.restore();
}

function drawTextLines(ctx: Ctx, items: TextItem[], diagrams = false) {
  const groups = new Map<string, TextItem[]>();
  // one baseline per staff/voice/system, clear of the staff and of every note in it; verses stack below
  const bases = new Map<string, number>();
  for (const it of items) {
    if (!groups.has(it.group)) groups.set(it.group, []);
    groups.get(it.group)!.push(it);
    const above = it.kind !== 'lyric';
    const y = above ? Math.min(it.staveTop - 22, it.noteTop - 10) : Math.max(it.staveBottom + 30, it.noteBottom + 18);
    const prev = bases.get(it.baseKey);
    bases.set(it.baseKey, prev === undefined ? y : above ? Math.min(prev, y) : Math.max(prev, y));
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.x - b.x);
    const kind = list[0].kind;
    const chord = kind !== 'lyric'; // chords and staff text are left-aligned above the staff
    // staff text sits one line above the chord symbols when both are present
    const chordBase = bases.get(list[0].baseKey.replace(/:t$/, ':c'));
    const y =
      kind === 'text'
        ? Math.min(bases.get(list[0].baseKey)!, chordBase !== undefined ? chordBase - 20 : Infinity)
        : bases.get(list[0].baseKey)! + list[0].line * VERSE_LINE;
    ctx.save();
    if (kind === 'text') ctx.setFont('Georgia, Times New Roman, serif', 14, 'normal', 'italic');
    else {
      const [family, size, weight] = chord ? CHORD_FONT : LYRIC_FONT;
      ctx.setFont(family, size, weight);
    }
    const shapes = list.map((i) => (diagrams && kind === 'chord' ? chordShape(i.text.replace(/♯/g, '#').replace(/♭/g, 'b')) : null));
    // with diagrams, each chord needs at least the diagram's width
    const widths = list.map((i, k) => Math.max(ctx.measureText(i.text).width, shapes[k] ? DIAGRAM_W + 6 : 0));
    // nudge right any label that would collide with the previous one
    const gap = chord ? 10 : 6;
    let prevRight = -Infinity;
    list.forEach((it, k) => {
      let left = chord ? it.x : it.x - widths[k] / 2;
      if (left < prevRight + gap) left = prevRight + gap;
      it.x = chord ? left : left + widths[k] / 2;
      prevRight = left + widths[k] + (!chord && it.hyphen ? 10 : 0);
    });
    const label = list.find((i) => i.label)?.label;
    if (label) {
      const firstLeft = list[0].x - widths[0] / 2;
      ctx.fillText(label, firstLeft - ctx.measureText(label).width - 6, y);
    }
    list.forEach((it, k) => {
      const left = chord ? it.x : it.x - widths[k] / 2;
      ctx.fillText(it.text, left, y);
      const shape = shapes[k];
      if (shape) drawChordDiagram(ctx, shape, left + 2, y - 26);
      if (!chord && it.hyphen) {
        // centre the hyphen in the gap before the next syllable (or just after, at a line end)
        const right = left + widths[k];
        const next = list[k + 1];
        const nextLeft = next ? next.x - widths[k + 1] / 2 : right + 16;
        const hx = (right + nextLeft) / 2;
        const hw = ctx.measureText('-').width;
        ctx.fillText('-', hx - hw / 2, y);
      }
    });
    ctx.restore();
  }
}

/**
 * The score as it should be shown: in the transposed view every transposing instrument
 * is written at its own pitch, key signature and chord symbols (ids are kept, so the
 * cursor and selection still line up). Returns the score and each staff's key shift.
 */
function displayScore(score: Score): { shown: Score; shift: number[] } {
  const shift = score.staves.map((_, s) => (score.transposedView ? writtenShift(score, s) : 0));
  if (!shift.some((x) => x)) return { shown: score, shift };
  const shown: Score = JSON.parse(JSON.stringify(score));
  const ctxs = contexts(score);
  shown.measures.forEach((bar, m) => {
    shift.forEach((sh, s) => {
      if (!sh) return;
      const key = transposeKey(ctxs[m].key, sh);
      transposeEvents(bar.staves[s] ?? [], sh, key);
      for (const { v, events } of lanesOf(bar, s)) if (v) transposeEvents(events, sh, key);
    });
  });
  return { shown, shift };
}

// ------------------------------------------------------------------ incremental rendering
/**
 * Each system is drawn into its own SVG group. The group and its geometry are kept per host
 * element together with a signature of everything the system depends on (its bars, their
 * context, ties/slurs/lines running in or out, its position and width). On the next render a
 * system whose signature is unchanged is moved into the new SVG as is, so an edit redraws
 * only the systems it actually touches.
 */
interface SystemCache {
  group: SVGGElement;
  events: [string, EventBox][];
  staves: StaveBox[];
  elements: [string, SVGElement][];
}
interface HostCache {
  systems: Map<string, SystemCache>;
  /** natural bar width by bar signature */
  widths: Map<string, number>;
}
const hostCaches = new WeakMap<HTMLElement, HostCache>();

/** How the last render went (for tests and the debug overlay). */
export const renderStats = { drawn: 0, reused: 0 };

/** Forget cached systems of a host (e.g. after a font finished loading). */
export function clearRenderCache(host: HTMLElement) {
  hostCaches.delete(host);
}

const json = (x: unknown) => JSON.stringify(x) ?? '';

function tieIndexes(from: NoteEvent, next: NoteEvent): [number[], number[]] | null {
  const a = [...from.pitches].sort((p, q) => diatonic(p) - diatonic(q));
  const b = [...next.pitches].sort((p, q) => diatonic(p) - diatonic(q));
  const firstIdx: number[] = [];
  const lastIdx: number[] = [];
  a.forEach((p, ai) => {
    const bi = b.findIndex((q) => midiOf(q) === midiOf(p));
    if (bi >= 0) {
      firstIdx.push(ai);
      lastIdx.push(bi);
    }
  });
  return firstIdx.length ? [firstIdx, lastIdx] : null;
}

export interface RenderOptions {
  /** Runs of empty bars become one bar with a multi-measure rest (printed parts). */
  multiRests?: boolean;
  /** Editing hints on the page: notes out of the instrument's range in red. */
  hints?: boolean;
}

/**
 * Bars that may join a multi-measure rest: nothing but rests, and no marks that need the
 * bar drawn on its own (the first bar of a run may carry a rehearsal mark or tempo).
 */
function restRuns(score: Score): Map<number, number> {
  const empty = (m: number) => {
    const bar = score.measures[m];
    return bar.staves.every((evs, s) =>
      [evs, ...lanesOf(bar, s).slice(1).map((l) => l.events)].every((lane) => lane.every((e) => isRest(e) && !e.harmony && !e.text && !e.dynamic && !e.spans)),
    );
  };
  // marks that need the bar drawn on its own
  const marked = (m: number) => {
    const b = score.measures[m];
    return !!(b.repeatStart || b.repeatEnd || b.volta || b.segno || b.coda || b.toCoda || b.fine || b.jump || b.key !== undefined || b.time || b.clefs?.some((c) => c));
  };
  const runs = new Map<number, number>();
  let start = -1;
  const flush = (end: number) => {
    if (start >= 0 && end - start >= 2) runs.set(start, end - start);
    start = -1;
  };
  score.measures.forEach((b, m) => {
    if (!empty(m) || marked(m)) return flush(m);
    if (start >= 0 && (b.rehearsal || b.tempo)) flush(m); // a new section starts a new rest
    if (start < 0) start = m;
    if (b.lineBreak || b.pageBreak) flush(m + 1); // the rest ends where the line does
  });
  flush(score.measures.length);
  return runs;
}

export function renderScore(host: HTMLElement, original: Score, width: number, opts: RenderOptions = {}): Layout {
  const old: HostCache = hostCaches.get(host) ?? { systems: new Map(), widths: new Map() };
  const next: HostCache = { systems: new Map(), widths: new Map() };
  renderStats.drawn = 0;
  renderStats.reused = 0;
  // detach reusable groups before the old SVG is thrown away
  host.innerHTML = '';
  const { shown: score, shift } = displayScore(original);
  const parts = partsOf(score);
  const multiPart = parts.length > 1;
  // room on the left for instrument names when there are several instruments
  // (about 7.5px per character of 13px Georgia, plus padding; capped so music keeps most of the line)
  const nameW = multiPart ? Math.min(170, Math.max(...parts.map((p) => p.part.name.length)) * 7.5 + 26) : 0;
  const layout: Layout = { events: new Map(), staves: [], elements: new Map(), systems: [], height: 0 };
  const ctxs = contexts(score);
  const keyFor = (m: number) => (s: number) => (shift[s] ? transposeKey(ctxs[m].key, shift[s]) : ctxs[m].key);
  const keysAt = (m: number) => (m < 0 ? [] : score.staves.map((_, s) => keyFor(m)(s)));
  // out-of-range notes, checked on the concert-pitch score (ids are the same in the shown one)
  const flaggedIds = new Set<string>();
  if (opts.hints) {
    original.measures.forEach((bar) =>
      bar.staves.forEach((_, s) => lanesOf(bar, s).forEach(({ events }) => events.forEach((e) => outOfRange(original, s, e) && flaggedIds.add(e.id)))),
    );
  }
  const flagged = (e: NoteEvent) => flaggedIds.has(e.id);
  const barSig = (m: number) => `${json(score.measures[m])}|${json(ctxs[m])}|${keysAt(m).join(',')}`;

  // ---- natural bar widths (cached by bar content) ----
  const desiredW: number[] = score.measures.map((_, m) => {
    const sig = barSig(m);
    const hit = old.widths.get(sig) ?? next.widths.get(sig);
    if (hit !== undefined) {
      next.widths.set(sig, hit);
      return hit;
    }
    const b = buildMeasure(score, m, ctxs[m], keyFor(m));
    const events = Math.max(...b.lanes.flat().map((l) => l.notes.length));
    // chord symbols and lyrics need horizontal room too (rough glyph-width estimate)
    const textRoom = Math.max(
      ...score.measures[m].staves.map((evs) =>
        evs.reduce((sum, e) => {
          const chord = e.harmony ? prettyChord(e.harmony).length * 10 + 12 : 0;
          const lyric = Math.max(0, ...lyricsOf(e).map(({ lyric: l }) => l.text.length * 8.5 + (l.hyphen ? 22 : 12)));
          return sum + Math.max(chord, lyric, 24);
        }, 0),
      ),
    );
    // width grows with content; busy bars get proportionally more room than near-empty ones
    const w = Math.max(110, b.minWidth * 1.6 + 26 * events + 20, textRoom + 40);
    next.widths.set(sig, w);
    return w;
  });
  const runs = opts.multiRests ? restRuns(score) : new Map<number, number>();
  const hiddenBar = new Set<number>();
  runs.forEach((len, m) => {
    for (let k = 1; k < len; k++) hiddenBar.add(m + k);
  });
  const MULTI_REST_W = 170;
  const desired = (m: number) => (runs.has(m) ? MULTI_REST_W : desiredW[m]);
  /** Last bar a drawn bar stands for (itself, or the end of its multi-measure rest). */
  const lastOf = (m: number) => m + (runs.get(m) ?? 1) - 1;
  const diagrams = !!score.chordDiagrams;

  // ---- line breaking ----
  const usable = width - MARGIN_X * 2 - nameW;
  const keyWidth = (m: number) => 12 * Math.abs(ctxs[m]?.key ?? score.keyFifths);
  const systems: number[][] = [];
  let line: number[] = [];
  let lineWidth = 0;
  score.measures.forEach((_, m) => {
    if (hiddenBar.has(m)) return;
    // a key, time or clef change inside a line needs room too
    const here = score.measures[m];
    const change =
      (here.key !== undefined ? 12 * Math.abs(ctxs[m].key) + 14 : 0) + (here.time ? 30 : 0) + (here.clefs?.some((c) => c) ? 28 : 0);
    const header = line.length === 0 ? 50 + keyWidth(m) + (systems.length === 0 || here.time ? 30 : 0) : change;
    const w = desired(m) + header;
    if (line.length > 0 && lineWidth + w > usable) {
      systems.push(line);
      line = [];
      lineWidth = 0;
      const head = 50 + keyWidth(m) + (score.measures[m].time ? 30 : 0);
      line.push(m);
      lineWidth = desired(m) + head;
    } else {
      line.push(m);
      lineWidth += w;
    }
    // manual line / page break after this bar
    const bar = score.measures[lastOf(m)];
    if ((bar.lineBreak || bar.pageBreak) && lastOf(m) < score.measures.length - 1) {
      systems.push(line);
      line = [];
      lineWidth = 0;
    }
  });
  if (line.length) systems.push(line);
  const sysOf: number[] = [];
  systems.forEach((ms, k) => ms.forEach((m) => {
    for (let x = m; x <= lastOf(m); x++) sysOf[x] = k;
  }));

  const staffCount = score.staves.length;
  // room for chord symbols above / lyrics below each staff
  const has = (s: number, key: 'harmony' | 'lyric' | 'text') =>
    score.measures.some((mm) => mm.staves[s]?.some((e) => e[key]));
  const versesOn = (s: number) =>
    Math.max(
      0,
      ...score.measures.flatMap((mm) =>
        lanesOf(mm, s).flatMap((l) => l.events).flatMap((e) => lyricsOf(e).map((l) => l.verse)),
      ),
    );
  const staffY: number[] = [];
  let yAcc = 0;
  score.staves.forEach((def, s) => {
    yAcc += (has(s, 'harmony') ? 22 + (diagrams ? DIAGRAM_ROOM : 0) : 0) + (has(s, 'text') ? 20 : 0);
    staffY.push(yAcc);
    const verses = versesOn(s);
    yAcc += STAFF_GAP + (verses ? 26 + (verses - 1) * VERSE_LINE : 0) + (def.tab ? TAB_ROOM : 0);
  });
  const systemHeight = yAcc + SYSTEM_GAP;
  const multiVerse = score.staves.some((_, s) => versesOn(s) > 1);
  const totalHeight = TOP + systems.length * systemHeight + 20;

  // ---- what crosses between systems (read from the model, so cached systems need no notes) ----
  const locOf = new Map<string, { m: number; s: number; v: number }>();
  score.measures.forEach((bar, m) =>
    bar.staves.forEach((_, s) => lanesOf(bar, s).forEach(({ v, events }) => events.forEach((e) => locOf.set(e.id, { m, s, v })))),
  );
  const slursAll: { from: string; end: string; sa: number; sb: number }[] = [];
  const spansAll: { from: string; end: string; s: number; v: number; kind: string; sa: number; sb: number }[] = [];
  // "1." verse label goes on the first syllable of each verse of each staff (in drawing order)
  const labelAt = new Set<string>();
  const labelSeen = new Set<string>();
  const sysExtras: string[][] = systems.map(() => []);
  systems.forEach((ms, k) =>
    ms.forEach((m) => {
      const bar = score.measures[m];
      bar.staves.forEach((_, s) =>
        lanesOf(bar, s).forEach(({ v, events }) =>
          events.forEach((e) => {
            if (multiVerse && !isRest(e)) {
              for (const { verse } of lyricsOf(e)) {
                if (labelSeen.has(`${s}:${verse}`)) continue;
                labelSeen.add(`${s}:${verse}`);
                labelAt.add(`${e.id}:${verse}`);
                sysExtras[k].push(`L${e.id}:${verse}`);
              }
            }
            if (e.slurEnd && !isRest(e)) {
              const b = locOf.get(e.slurEnd);
              if (b && b.s === s) slursAll.push({ from: e.id, end: e.slurEnd, sa: k, sb: sysOf[b.m] });
            }
            for (const sp of e.spans ?? []) {
              const b = locOf.get(sp.end);
              if (b) spansAll.push({ from: e.id, end: sp.end, s, v, kind: sp.kind, sa: k, sb: sysOf[b.m] });
            }
          }),
        ),
      );
    }),
  );
  for (const sl of slursAll) {
    if (sl.sa === sl.sb) continue;
    sysExtras[sl.sa].push(`S${sl.from}>${sl.end}`);
    sysExtras[sl.sb].push(`S${sl.from}>${sl.end}`);
  }
  for (const sp of spansAll) {
    if (sp.sa === sp.sb) continue;
    for (let k = sp.sa; k <= sp.sb; k++) sysExtras[k].push(`P${sp.kind}:${sp.from}>${sp.end}:${sp.sa}:${sp.sb}`);
  }
  /** The staff has more than one voice with notes in this bar (stems and ties then follow the voice). */
  const hasTwo = (mm: number, s: number) =>
    !!score.measures[mm] && lanesOf(score.measures[mm], s).some(({ v, events }) => v > 0 && events.some((e) => !isRest(e)));
  /** Tie-relevant edge of a bar: last events (outgoing ties) or first events (incoming ties) of each lane. */
  const edge = (m: number, first: boolean) => {
    const bar = score.measures[m];
    if (!bar) return '';
    return json(
      bar.staves.map((_, s) => [
        hasTwo(m, s),
        lanesOf(bar, s).map(({ events }) => {
          const e = first ? events[0] : events[events.length - 1];
          return e && { p: e.pitches, t: e.tie };
        }),
      ]),
    );
  };

  const globalSig = json([
    width,
    nameW,
    parts.map((p) => [p.part.name, p.part.short, p.part.staves, p.start, p.part.instrument]),
    !!opts.hints,
    staffY,
    systemHeight,
    staffCount,
    multiVerse,
    diagrams,
    score.staves.map((d) => [d.clef, !!d.tab]),
    shift,
    typeof document !== 'undefined' ? document.fonts?.status : '',
  ]);

  const renderer = new Renderer(host as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(width, totalHeight);
  const ctx = renderer.getContext();
  const svg = (ctx as unknown as { svg: SVGSVGElement }).svg;

  systems.forEach((measures, sysIdx) => {
    const y0 = TOP + sysIdx * systemHeight;
    layout.systems.push({
      top: y0 - 4,
      bottom: y0 + systemHeight - SYSTEM_GAP / 2,
      measures: measures.flatMap((m) => Array.from({ length: lastOf(m) - m + 1 }, (_, k) => m + k)),
      pageBreakAfter: !!score.measures[lastOf(measures[measures.length - 1])].pageBreak,
    });
    const isLast = sysIdx === systems.length - 1;
    // header widths
    const firstBar = score.measures[measures[0]];
    const headerW = 50 + keyWidth(measures[0]) + (sysIdx === 0 || firstBar.time ? 30 : 0);
    const natural = measures.map((m) => desired(m));
    const sum = natural.reduce((a, b) => a + b, 0) + headerW;
    const stretch = isLast && sum < usable * 0.7 ? 1 : usable / sum;
    const m0 = measures[0];
    const mz = lastOf(measures[measures.length - 1]);

    const sig = json([
      globalSig,
      sysIdx,
      stretch,
      headerW,
      measures.map((m) => [
        m,
        runs.get(m) ?? 0,
        lastOf(m) === score.measures.length - 1,
        barSig(m),
        keysAt(m - 1),
        score.measures[m - 1]?.volta,
        score.measures[m + 1]?.volta,
      ]),
      edge(m0 - 1, false),
      edge(mz + 1, true),
      sysExtras[sysIdx],
    ]);
    const cached = old.systems.get(sig);
    if (cached) {
      svg.appendChild(cached.group);
      cached.events.forEach(([id, b]) => layout.events.set(id, b));
      cached.elements.forEach(([id, el]) => layout.elements.set(id, el));
      layout.staves.push(...cached.staves);
      next.systems.set(sig, cached);
      renderStats.reused++;
      return;
    }
    renderStats.drawn++;
    const group = ctx.openGroup('system') as SVGGElement;
    const mine: SystemCache = { group, events: [], staves: [], elements: [] };

    const ties: { from: NoteEvent; s: number; m: number; v: number }[] = [];
    const noteById = new Map<string, { note: StaveNote; m: number; s: number }>();
    const textItems: TextItem[] = [];
    const laneNotes = new Map<string, StaveNote[]>(); // `${staff}:${voice}` -> notes in order
    const drawn = new Map<number, BuiltMeasure>();
    // last hand position on each tab staff (kept within the system)
    const handAt = new Map<number, number>();
    const bar0RepeatEnd = (m: number) => !!score.measures[m].repeatEnd;

    let x = MARGIN_X + nameW;
    const firstStaves: Stave[] = [];
    measures.forEach((m, k) => {
      const w = natural[k] * stretch + (k === 0 ? headerW * stretch : 0);
      const b = buildMeasure(score, m, ctxs[m], keyFor(m), flagged);
      drawn.set(m, b);
      const staves = score.staves.map((def, s) => {
        const st = new Stave(x, y0 + staffY[s], w);
        const bar = score.measures[m];
        const bc = ctxs[m];
        const prev = m > 0 ? ctxs[m - 1] : null;
        const clef = bc.clefs[s] ?? def.clef;
        if (k === 0) {
          st.addClef(clef);
          const key = keyFor(m)(s);
          const prevKey = prev ? keyFor(m - 1)(s) : 0;
          if (clef !== 'percussion' && (key !== 0 || (prev && prevKey !== 0 && bar.key !== undefined))) {
            st.addKeySignature(KEY_NAMES[key], bar.key !== undefined && prev ? KEY_NAMES[prevKey] : undefined);
          }
          if (sysIdx === 0 || bar.time) st.addTimeSignature(`${bc.beats}/${bc.beatType}`);
          if (s === 0 && m > 0) st.setMeasure(m + 1);
        } else {
          // changes in the middle of a line
          if (bar.clefs?.[s]) st.addClef(clef, 'small');
          if (bar.key !== undefined && clef !== 'percussion') st.addKeySignature(KEY_NAMES[keyFor(m)(s)], prev ? KEY_NAMES[keyFor(m - 1)(s)] : undefined);
          if (bar.time) st.addTimeSignature(`${bc.beats}/${bc.beatType}`);
        }
        if (s === 0 && bar.tempo) {
          st.setTempo({ name: bar.tempo.text || undefined, duration: 'q', bpm: bar.tempo.bpm }, 0);
        }
        // the rehearsal box sits above the tempo mark when both are present
        if (s === 0 && bar.rehearsal) st.setSection(bar.rehearsal, bar.tempo ? -24 : 0, 0, 14, true);
        if (bar.repeatStart) st.setBegBarType(Barline.type.REPEAT_BEGIN);
        if (bar.volta && s === 0) {
          // bracket runs over consecutive bars of the same ending within this system
          const first = k === 0 || score.measures[m - 1]?.volta !== bar.volta;
          const last = k === measures.length - 1 || score.measures[m + 1]?.volta !== bar.volta;
          const closed = last && !!bar.repeatEnd; // a final ending is left open
          const type = first ? (closed ? VoltaType.BEGIN_END : VoltaType.BEGIN) : closed ? VoltaType.END : VoltaType.MID;
          st.setVoltaType(type, first ? `${bar.volta}.` : '', -5);
        }
        if (s === 0) {
          // navigation marks on the top staff: signs at the start of the bar, instructions at its end
          const R = Repetition.type;
          if (bar.coda) st.setRepetitionType(R.CODA_LEFT);
          if (bar.fine) st.setRepetitionType(R.FINE);
          if (bar.toCoda) st.setRepetitionType(R.TO_CODA);
          if (bar.jump) {
            const jumpType = { dc: R.DC, dcFine: R.DC_AL_FINE, dcCoda: R.DC_AL_CODA, ds: R.DS, dsFine: R.DS_AL_FINE, dsCoda: R.DS_AL_CODA }[bar.jump];
            st.setRepetitionType(jumpType, bar.fine || bar.toCoda ? 14 : 0);
          }
        }
        if (bar.repeatEnd) st.setEndBarType(Barline.type.REPEAT_END);
        else if (lastOf(m) === score.measures.length - 1) st.setEndBarType(Barline.type.END);
        st.setContext(ctx).draw();
        if (s === 0 && bar.segno) {
          // VexFlow's built-in segno is drawn tiny; use the Bravura glyph (U+E047) at a readable size
          ctx.save();
          ctx.setFont('Bravura', 30);
          ctx.fillText('', st.getX() + (k === 0 ? 2 : 6), st.getYForLine(0) - 14);
          ctx.restore();
        }
        return st;
      });
      if (k === 0) firstStaves.push(...staves);

      // measure barline across the grand staff
      if (staffCount > 1) {
        for (const { part, start } of parts) {
          if (part.staves > 1) {
            new StaveConnector(staves[start], staves[start + part.staves - 1]).setType('singleRight').setContext(ctx).draw();
          }
        }
      }

      if (runs.has(m)) {
        // a run of empty bars: one bar with a multi-measure rest and its count
        staves.forEach((st, s) => {
          // explicit padding: the rest spans the bar from after its clef/key/time to the barline
          const padL = Math.max(10, st.getNoteStartX() - st.getX() + 8);
          const count = runs.get(m)!;
          try {
            new MultiMeasureRest(count, { numberOfMeasures: count, paddingLeft: padL, paddingRight: 14 }).setStave(st).setContext(ctx).draw();
          } catch {
            // no glyph metrics (e.g. fonts not ready): draw the H-bar and its number by hand
            const left = st.getX() + padL + 10;
            const right = st.getX() + st.getWidth() - 24;
            const mid = st.getYForLine(2);
            ctx.save();
            ctx.fillRect(left, mid - 4, right - left, 8);
            ctx.fillRect(left, st.getYForLine(1), 2, st.getYForLine(3) - st.getYForLine(1));
            ctx.fillRect(right - 2, st.getYForLine(1), 2, st.getYForLine(3) - st.getYForLine(1));
            ctx.setFont('Times New Roman, serif', 18, 'bold');
            ctx.fillText(String(count), (left + right) / 2 - 5, st.getYForLine(0) - 8);
            ctx.restore();
          }
          mine.staves.push({ m, s, x: st.getX(), width: st.getWidth(), top: st.getYForLine(0), spacing: st.getSpacingBetweenLines(), noteStartX: st.getNoteStartX() });
        });
        x += w;
        return;
      }

      // tablature under staves that show it (worked out from voice 1; sounding pitch)
      const tabVoices: Voice[] = [];
      score.staves.forEach((def, s) => {
        if (!def.tab) return;
        const ts = new TabStave(x, y0 + staffY[s] + TAB_OFFSET, w);
        if (k === 0) ts.addTabGlyph();
        if (bar0RepeatEnd(m)) ts.setEndBarType(Barline.type.REPEAT_END);
        ts.setContext(ctx).draw();
        const events = score.measures[m].staves[s] ?? [];
        const tabNotes = events.map((e) => {
          if (isRest(e)) return new GhostNote({ duration: e.type, dots: e.dots });
          const pos = tabFor(e.pitches.map((p) => midiOf(p) - shift[s]), handAt.get(s) ?? 0);
          if (!pos.length) return new GhostNote({ duration: e.type, dots: e.dots });
          const fretted = pos.filter((q) => q.fret > 0).map((q) => q.fret);
          if (fretted.length) handAt.set(s, fretted.reduce((a, b) => a + b, 0) / fretted.length);
          const tn = new TabNote({ positions: pos, duration: e.type, dots: e.dots });
          return tn;
        });
        tupletGroups(events).forEach((idx) => {
          const ratio = events[idx[0]].tuplet!;
          new Tuplet(idx.map((i) => tabNotes[i]), { numNotes: ratio.actual, notesOccupied: ratio.normal });
        });
        const tv = new Voice({ numBeats: ctxs[m].beats, beatValue: ctxs[m].beatType });
        tv.setMode(VoiceMode.SOFT);
        tv.addTickables(tabNotes);
        tv.setStave(ts);
        tabVoices.push(tv);
      });

      // format all staves of this bar together so beats line up
      const noteWidth = w - (staves[0].getNoteStartX() - x) - 14;
      const f = new Formatter();
      b.lanes.forEach((staffLanes, s) => {
        const vs = staffLanes.flatMap((l) => (l.voice ? [l.voice] : []));
        vs.forEach((v) => v.setStave(staves[s]));
        if (vs.length) f.joinVoices(vs);
      });
      // beam by the beat of the time signature: 6/8, 9/8 and 12/8 in threes (one dotted-quarter beat each)
      const groups = Beam.getDefaultBeamGroups(`${ctxs[m].beats}/${ctxs[m].beatType}`);
      const beams = b.lanes.flat().flatMap((l) => {
        const pitched = l.notes.filter((n) => !n.isRest());
        try {
          if (pitched.length < 2) return [];
          return l.stem
            ? Beam.generateBeams(l.notes, { groups, stemDirection: l.stem, maintainStemDirections: true })
            : Beam.generateBeams(l.notes, { groups });
        } catch {
          return [];
        }
      });
      const voicesToDraw = laneVoices(b);
      for (const tv of tabVoices) f.joinVoices([tv]);
      f.format([...voicesToDraw, ...tabVoices], Math.max(noteWidth, 20));
      separateSameStemVoices(b);
      voicesToDraw.forEach((v) => v.draw(ctx));
      tabVoices.forEach((v) => {
        try {
          v.draw(ctx);
        } catch {
          /* a tab bar that cannot be drawn should not stop the rest */
        }
      });
      beams.forEach((bm) => bm.setContext(ctx).draw());
      b.tuplets.forEach((t) => t.setContext(ctx).draw());

      // record geometry
      b.lanes.forEach((staffLanes, s) => {
        const st = staves[s];
        mine.staves.push({
          m,
          s,
          x: st.getX(),
          width: st.getWidth(),
          top: st.getYForLine(0),
          spacing: st.getSpacingBetweenLines(),
          noteStartX: st.getNoteStartX(),
        });
        for (const ln of staffLanes) {
          const { v, events } = ln;
          if (!ln.voice) {
            // hidden voice 2 (only rests): place its slots proportionally so the cursor can still sit there
            const span = st.getX() + st.getWidth() - st.getNoteStartX() - 12;
            events.forEach((e, i) => {
              const x0 = st.getNoteStartX() + (startTick(events, i) / barTicks(score, m)) * span;
              mine.events.push([e.id, { m, s, i, v, x: x0, width: Math.max(12, (eventTicksOf(e) / barTicks(score, m)) * span - 4) }]);
            });
            continue;
          }
          events.forEach((e, i) => {
            const n = b.eventNote[s].get(e.id)!;
            let nx = n.getAbsoluteX() + n.getXShift();
            let nw = 14;
            try {
              const bb = n.getBoundingBox();
              nx = bb.getX();
              nw = bb.getW();
            } catch {
              /* rests without bbox */
            }
            // a note moved right (voices 3 and 4 beside 1 and 2): VexFlow's box still starts at the
            // unshifted place, so start the cursor's box at the notehead instead
            if (n.getXShift() > 0 && !isRest(e)) {
              const head = n.getNoteHeadBeginX();
              nw = Math.max(10, nx + nw - head);
              nx = head;
            }
            mine.events.push([e.id, { m, s, i, v, x: nx, width: Math.max(nw, 10) }]);
            const el = n.getSVGElement();
            if (el) mine.elements.push([e.id, el]);
            if (e.tie && !isRest(e)) ties.push({ from: e, s, m, v });
            if (e.harmony || e.text || (lyricsOf(e).length && !isRest(e))) {
              let top = st.getYForLine(0);
              let bottom = st.getYForLine(4);
              try {
                const bb = n.getBoundingBox();
                top = Math.min(top, bb.getY());
                bottom = Math.max(bottom, bb.getY() + bb.getH());
              } catch {
                /* no bbox */
              }
              const collapsed = ln.collapsed && events.length > 1;
              const headL = isRest(e) ? nx : n.getNoteHeadBeginX();
              const headR = isRest(e) ? nx + nw : n.getNoteHeadEndX();
              const base = {
                noteTop: top,
                noteBottom: bottom,
                staveTop: st.getYForLine(0),
                staveBottom: st.getYForLine(4),
                hyphen: false,
              };
              if (e.harmony && !(collapsed && i > 0 && events.slice(0, i).some((x) => x.harmony))) {
                const x = collapsed ? st.getNoteStartX() + 4 : headL;
                textItems.push({
                  ...base,
                  kind: 'chord',
                  group: `${sysIdx}:${s}:c`,
                  baseKey: `${sysIdx}:${s}:c`,
                  line: 0,
                  x,
                  text: prettyChord(e.harmony),
                });
              }
              if (e.text) {
                textItems.push({
                  ...base,
                  kind: 'text',
                  group: `${sysIdx}:${s}:t`,
                  baseKey: `${sysIdx}:${s}:t`,
                  line: 0,
                  x: headL,
                  text: e.text,
                });
              }
              if (!isRest(e)) {
                for (const { verse, lyric } of lyricsOf(e)) {
                  textItems.push({
                    ...base,
                    kind: 'lyric',
                    group: `${sysIdx}:${s}:${v}:l${verse}`,
                    baseKey: `${sysIdx}:${s}:${v}:l`,
                    line: verse - 1,
                    label: labelAt.has(`${e.id}:${verse}`) ? `${verse}.` : undefined,
                    x: (headL + headR) / 2,
                    text: lyric.text,
                    hyphen: !!lyric.hyphen,
                  });
                }
              }
            }
            noteById.set(e.id, { note: n, m, s });
            if (!isRest(e)) {
              const key = `${s}:${v}`;
              if (!laneNotes.has(key)) laneNotes.set(key, []);
              laneNotes.get(key)!.push(n);
            }
          });
        }
      });
      x += w;
    });

    if (staffCount > 1) {
      new StaveConnector(firstStaves[0], firstStaves[staffCount - 1]).setType('singleLeft').setContext(ctx).draw();
      // braces join the staves of one instrument; a bracket groups the instruments of the ensemble
      for (const { part, start } of parts) {
        if (part.staves > 1) {
          new StaveConnector(firstStaves[start], firstStaves[start + part.staves - 1]).setType('brace').setContext(ctx).draw();
        }
      }
      if (multiPart) {
        const singles = parts.filter((p) => p.part.staves === 1);
        if (singles.length > 1) {
          const a = singles[0].start;
          const z = singles[singles.length - 1].start;
          new StaveConnector(firstStaves[a], firstStaves[z]).setType('bracket').setContext(ctx).draw();
        }
      }
    }
    // instrument names: full on the first system, abbreviated after
    if (multiPart && firstStaves.length) {
      ctx.save();
      ctx.setFont('Georgia, Times New Roman, serif', sysIdx === 0 ? 13 : 12, 'normal');
      for (const { part, start } of parts) {
        const label = sysIdx === 0 ? part.name : part.short || part.name;
        const top = firstStaves[start].getYForLine(0);
        const bottom = firstStaves[start + part.staves - 1].getYForLine(4);
        const w = ctx.measureText(label).width;
        ctx.fillText(label, MARGIN_X + nameW - 14 - w, (top + bottom) / 2 + 4);
      }
      ctx.restore();
    }

    // ---- ties (a tie into the next system is drawn as two halves, one per system) ----
    const noteIn = (m: number, s: number, id: string) => drawn.get(m)?.eventNote[s].get(id);
    // with two voices on the staff, voice 1 ties curve up and voice 2 ties curve down
    const drawTie = (
      n1: StaveNote | null,
      n2: StaveNote | null,
      idx: [number[], number[]],
      dir: number,
    ) => {
      const [firstIdx, lastIdx] = idx;
      const notes = n1 && n2
        ? { firstNote: n1, lastNote: n2, firstIndexes: firstIdx, lastIndexes: lastIdx }
        : n1
          ? { firstNote: n1, lastNote: null, firstIndexes: firstIdx, lastIndexes: firstIdx }
          : { firstNote: null, lastNote: n2, firstIndexes: lastIdx, lastIndexes: lastIdx };
      try {
        const t = new StaveTie(notes);
        if (dir) t.setDirection(dir);
        t.setContext(ctx).draw();
      } catch {
        /* ignore tie layout failures */
      }
    };
    for (const { from, s, m, v } of ties) {
      const events = laneOf(score.measures[m], s, v) ?? [];
      const i = events.indexOf(from);
      let nm = m;
      let nxt = events[i + 1];
      if (!nxt && score.measures[m + 1]) {
        nm = m + 1;
        nxt = laneOf(score.measures[nm], s, v)?.[0] as NoteEvent;
      }
      if (!nxt || isRest(nxt)) continue;
      const idx = tieIndexes(from, nxt);
      const n1 = noteIn(m, s, from.id);
      if (!idx || !n1) continue;
      const dir = hasTwo(m, s) || hasTwo(nm, s) ? -stemOf(v) : 0;
      if (sysOf[nm] === sysIdx) {
        const n2 = noteIn(nm, s, nxt.id);
        if (n2) drawTie(n1, n2, idx, dir);
      } else drawTie(n1, null, idx, dir);
    }
    // the second half of ties coming in from the previous system
    if (m0 > 0) {
      const pm = m0 - 1;
      score.measures[pm].staves.forEach((_, s) =>
        lanesOf(score.measures[pm], s).forEach(({ v, events }) => {
          const last = events[events.length - 1];
          if (!last?.tie || isRest(last)) return;
          const nxt = laneOf(score.measures[m0], s, v)?.[0];
          if (!nxt || isRest(nxt)) return;
          const idx = tieIndexes(last, nxt);
          const n2 = noteIn(m0, s, nxt.id);
          if (!idx || !n2) return;
          drawTie(null, n2, idx, hasTwo(pm, s) || hasTwo(m0, s) ? -stemOf(v) : 0);
        }),
      );
    }

    drawTextLines(ctx, textItems, diagrams);

    // ---- hairpins, pedal, 8va/8vb (split at line breaks) ----
    for (const sp of spansAll) {
      if (sysIdx < sp.sa || sysIdx > sp.sb) continue;
      const lane = laneNotes.get(`${sp.s}:${sp.v}`) ?? [];
      const a = sp.sa === sysIdx ? noteById.get(sp.from)?.note : lane[0];
      const b = sp.sb === sysIdx ? noteById.get(sp.end)?.note : lane[lane.length - 1];
      if (!a || !b) continue;
      try {
        if (sp.kind === 'cresc' || sp.kind === 'dim') {
          const hp = new StaveHairpin(
            { firstNote: a, lastNote: b },
            sp.kind === 'cresc' ? StaveHairpin.type.CRESC : StaveHairpin.type.DECRESC,
          );
          hp.setPosition(Modifier.Position.BELOW);
          hp.setRenderOptions({ height: 10, yShift: 2, leftShiftPx: 0, rightShiftPx: 0 });
          hp.setContext(ctx).draw();
        } else if (sp.kind === 'pedal') {
          const pm = new PedalMarking([a, b]);
          pm.setType(PedalMarking.type.MIXED);
          pm.setContext(ctx).draw();
        } else {
          new TextBracket({
            start: a,
            stop: b,
            text: '8',
            superscript: sp.kind === '8va' ? 'va' : 'vb',
            position: sp.kind === '8va' ? TextBracketPosition.TOP : TextBracketPosition.BOTTOM,
          })
            .setContext(ctx)
            .draw();
        }
      } catch {
        /* ignore layout failures of a single line */
      }
    }

    // ---- slurs (VexFlow places the curve opposite the stems by itself) ----
    for (const sl of slursAll) {
      if (sl.sa !== sysIdx && sl.sb !== sysIdx) continue;
      const a = sl.sa === sysIdx ? noteById.get(sl.from)?.note : undefined;
      const b = sl.sb === sysIdx ? noteById.get(sl.end)?.note : undefined;
      if ((sl.sa === sysIdx && !a) || (sl.sb === sysIdx && !b)) continue;
      try {
        new Curve(a, b, {}).setContext(ctx).draw();
      } catch {
        /* ignore slur layout failures */
      }
    }

    ctx.closeGroup();
    mine.events.forEach(([id, bx]) => layout.events.set(id, bx));
    mine.elements.forEach(([id, el]) => layout.elements.set(id, el));
    layout.staves.push(...mine.staves);
    next.systems.set(sig, mine);
  });

  hostCaches.set(host, next);
  layout.height = totalHeight;
  return layout;
}
