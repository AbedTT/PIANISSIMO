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
  GraceNote,
  GraceNoteGroup,
  PedalMarking,
  Repetition,
  StaveHairpin,
  TextBracket,
  TextBracketPosition,
  Voice,
  VoiceMode,
  VoltaType,
} from 'vexflow';
import { contexts, type BarContext } from '../model/context';
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
const REST_KEY: Record<Clef, string> = { treble: 'b/4', bass: 'd/3', alto: 'c/4' };
/** With two voices, rests move up (voice 1) or down (voice 2) out of each other's way. */
const REST_KEY_2V: Record<Clef, [string, string]> = {
  treble: ['e/5', 'f/4'],
  bass: ['g/3', 'a/2'],
  alto: ['f/4', 'g/3'],
};

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

function buildMeasure(score: Score, m: number, ctx: BarContext, keyOf: (s: number) => number = () => ctx.key): BuiltMeasure {
  const measure = score.measures[m];
  const lanes: LaneBuild[][] = [];
  const eventNote: Map<string, StaveNote>[] = [];
  const tuplets: Tuplet[] = [];

  measure.staves.forEach((_, s) => {
    const clef = ctx.clefs[s] ?? score.staves[s].clef;
    const map = new Map<string, StaveNote>();
    const v2 = laneOf(measure, s, 1);
    const twoVoices = !!v2 && v2.some((e) => !isRest(e));
    // accidentals: what each step+octave currently sounds like in this bar (shared by both voices)
    const state = new Map<string, number>();
    const staffLanes: LaneBuild[] = lanesOf(measure, s).map(({ v, events }) => {
      const stem = twoVoices ? (v ? -1 : 1) : undefined;
      if (v && !twoVoices) return { v, events, notes: [], voice: null, collapsed: true };
      const restKey = twoVoices ? REST_KEY_2V[clef][v] : REST_KEY[clef];
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
  const n = new StaveNote({
    keys: pitches.map((p) => `${p.step.toLowerCase()}/${p.octave}`),
    duration: e.type,
    dots: e.dots,
    clef,
    ...(stem ? { stemDirection: stem, autoStem: false } : { autoStem: true }),
  });
  pitches.forEach((p, idx) => {
    const key = `${p.step}${p.octave}`;
    const current = state.has(key) ? state.get(key)! : keyAlter(p.step, fifths);
    if (current !== p.alter) {
      n.addModifier(new Accidental(ACC_CODE[p.alter] ?? 'n'), idx);
      state.set(key, p.alter);
    }
  });
  if (e.dots) Dot.buildAndAttach([n], { all: true });
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

function drawTextLines(ctx: ReturnType<Renderer['getContext']>, items: TextItem[]) {
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
    const widths = list.map((i) => ctx.measureText(i.text).width);
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
      if (bar.voice2?.[s]) transposeEvents(bar.voice2[s]!, sh, key);
    });
  });
  return { shown, shift };
}

export function renderScore(host: HTMLElement, original: Score, width: number): Layout {
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
  const built = score.measures.map((_, m) => buildMeasure(score, m, ctxs[m], keyFor(m)));

  // ---- line breaking ----
  const usable = width - MARGIN_X * 2 - nameW;
  const keyWidth = (m: number) => 12 * Math.abs(ctxs[m]?.key ?? score.keyFifths);
  const systems: number[][] = [];
  let line: number[] = [];
  let lineWidth = 0;
  // width grows with content; busy bars get proportionally more room than near-empty ones
  const desired = (m: number) => {
    const events = Math.max(...built[m].lanes.flat().map((l) => l.notes.length));
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
    return Math.max(110, built[m].minWidth * 1.6 + 26 * events + 20, textRoom + 40);
  };
  built.forEach((_, m) => {
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
    const bar = score.measures[m];
    if ((bar.lineBreak || bar.pageBreak) && m < score.measures.length - 1) {
      systems.push(line);
      line = [];
      lineWidth = 0;
    }
  });
  if (line.length) systems.push(line);

  const staffCount = score.staves.length;
  // room for chord symbols above / lyrics below each staff
  const has = (s: number, key: 'harmony' | 'lyric' | 'text') =>
    score.measures.some((mm) => mm.staves[s]?.some((e) => e[key]));
  const versesOn = (s: number) =>
    Math.max(
      0,
      ...score.measures.flatMap((mm) =>
        [...(mm.staves[s] ?? []), ...(mm.voice2?.[s] ?? [])].flatMap((e) => lyricsOf(e).map((l) => l.verse)),
      ),
    );
  const staffY: number[] = [];
  let yAcc = 0;
  score.staves.forEach((_, s) => {
    yAcc += (has(s, 'harmony') ? 22 : 0) + (has(s, 'text') ? 20 : 0);
    staffY.push(yAcc);
    const verses = versesOn(s);
    yAcc += STAFF_GAP + (verses ? 26 + (verses - 1) * VERSE_LINE : 0);
  });
  const systemHeight = yAcc + SYSTEM_GAP;
  const multiVerse = score.staves.some((_, s) => versesOn(s) > 1);
  const verseLabelled = new Set<string>(); // `${s}:${verse}` labelled on the first system it appears
  const totalHeight = TOP + systems.length * systemHeight + 20;

  const renderer = new Renderer(host as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(width, totalHeight);
  const ctx = renderer.getContext();

  const ties: { from: NoteEvent; s: number; m: number; v: number }[] = [];
  const slurs: { from: NoteEvent; s: number; m: number }[] = [];
  const noteById = new Map<string, { note: StaveNote; m: number; s: number }>();
  const textItems: TextItem[] = [];
  const sysOfNote = new Map<string, number>();
  const laneNotes = new Map<string, StaveNote[]>(); // `${system}:${staff}:${voice}` -> notes in order
  const spans: { from: NoteEvent; s: number; v: number; kind: string; end: string }[] = [];
  const staveOf = new Map<string, Stave>(); // `${m}:${s}`
  const drawn: BuiltMeasure[] = [];

  systems.forEach((measures, sysIdx) => {
    const y0 = TOP + sysIdx * systemHeight;
    layout.systems.push({
      top: y0 - 4,
      bottom: y0 + systemHeight - SYSTEM_GAP / 2,
      measures,
      pageBreakAfter: !!score.measures[measures[measures.length - 1]].pageBreak,
    });
    const isLast = sysIdx === systems.length - 1;
    // header widths
    const firstBar = score.measures[measures[0]];
    const headerW = 50 + keyWidth(measures[0]) + (sysIdx === 0 || firstBar.time ? 30 : 0);
    const natural = measures.map((m) => desired(m));
    const sum = natural.reduce((a, b) => a + b, 0) + headerW;
    const stretch = isLast && sum < usable * 0.7 ? 1 : usable / sum;

    let x = MARGIN_X + nameW;
    const firstStaves: Stave[] = [];
    const lastStaves: Stave[] = [];
    measures.forEach((m, k) => {
      const w = natural[k] * stretch + (k === 0 ? headerW * stretch : 0);
      // fresh notes for drawing: the width pass already attached formatter state to built[m]
      const b = buildMeasure(score, m, ctxs[m], keyFor(m));
      drawn[m] = b;
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
          if (key !== 0 || (prev && prevKey !== 0 && bar.key !== undefined)) {
            st.addKeySignature(KEY_NAMES[key], bar.key !== undefined && prev ? KEY_NAMES[prevKey] : undefined);
          }
          if (sysIdx === 0 || bar.time) st.addTimeSignature(`${bc.beats}/${bc.beatType}`);
          if (s === 0 && m > 0) st.setMeasure(m + 1);
        } else {
          // changes in the middle of a line
          if (bar.clefs?.[s]) st.addClef(clef, 'small');
          if (bar.key !== undefined) st.addKeySignature(KEY_NAMES[keyFor(m)(s)], prev ? KEY_NAMES[keyFor(m - 1)(s)] : undefined);
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
        else if (m === score.measures.length - 1) st.setEndBarType(Barline.type.END);
        st.setContext(ctx).draw();
        if (s === 0 && bar.segno) {
          // VexFlow's built-in segno is drawn tiny; use the Bravura glyph (U+E047) at a readable size
          ctx.save();
          ctx.setFont('Bravura', 30);
          ctx.fillText('\uE047', st.getX() + (k === 0 ? 2 : 6), st.getYForLine(0) - 14);
          ctx.restore();
        }
        staveOf.set(`${m}:${s}`, st);
        return st;
      });
      if (k === 0) firstStaves.push(...staves);
      lastStaves.splice(0, lastStaves.length, ...staves);

      // measure barline across the grand staff
      if (staffCount > 1) {
        for (const { part, start } of parts) {
          if (part.staves > 1) {
            new StaveConnector(staves[start], staves[start + part.staves - 1]).setType('singleRight').setContext(ctx).draw();
          }
        }
      }

      // format all staves of this bar together so beats line up
      const noteWidth = w - (staves[0].getNoteStartX() - x) - 14;
      const f = new Formatter();
      b.lanes.forEach((staffLanes, s) => {
        const vs = staffLanes.flatMap((l) => (l.voice ? [l.voice] : []));
        vs.forEach((v) => v.setStave(staves[s]));
        if (vs.length) f.joinVoices(vs);
      });
      const beams = b.lanes.flat().flatMap((l) => {
        const pitched = l.notes.filter((n) => !n.isRest());
        try {
          if (pitched.length < 2) return [];
          return l.stem
            ? Beam.generateBeams(l.notes, { stemDirection: l.stem, maintainStemDirections: true })
            : Beam.generateBeams(l.notes);
        } catch {
          return [];
        }
      });
      const voicesToDraw = laneVoices(b);
      f.format(voicesToDraw, Math.max(noteWidth, 20));
      voicesToDraw.forEach((v) => v.draw(ctx));
      beams.forEach((bm) => bm.setContext(ctx).draw());
      b.tuplets.forEach((t) => t.setContext(ctx).draw());

      // record geometry
      b.lanes.forEach((staffLanes, s) => {
        const st = staves[s];
        layout.staves.push({
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
            layout.events.set(e.id, { m, s, i, v, x: x0, width: Math.max(12, (eventTicksOf(e) / barTicks(score, m)) * span - 4) });
          });
          continue;
        }
        events.forEach((e, i) => {
          const n = b.eventNote[s].get(e.id)!;
          let nx = n.getAbsoluteX();
          let nw = 14;
          try {
            const bb = n.getBoundingBox();
            nx = bb.getX();
            nw = bb.getW();
          } catch {
            /* rests without bbox */
          }
          layout.events.set(e.id, { m, s, i, v, x: nx, width: Math.max(nw, 10) });
          const el = n.getSVGElement();
          if (el) layout.elements.set(e.id, el);
          if (e.tie && !isRest(e)) ties.push({ from: e, s, m, v });
          if (e.slurEnd && !isRest(e)) slurs.push({ from: e, s, m });
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
                const labelKey = `${s}:${verse}`;
                const label = multiVerse && !verseLabelled.has(labelKey) ? `${verse}.` : undefined;
                if (label) verseLabelled.add(labelKey);
                textItems.push({
                  ...base,
                  kind: 'lyric',
                  group: `${sysIdx}:${s}:${v}:l${verse}`,
                  baseKey: `${sysIdx}:${s}:${v}:l`,
                  line: verse - 1,
                  label,
                  x: (headL + headR) / 2,
                  text: lyric.text,
                  hyphen: !!lyric.hyphen,
                });
              }
            }
          }
          noteById.set(e.id, { note: n, m, s });
          sysOfNote.set(e.id, sysIdx);
          if (!isRest(e)) {
            const key = `${sysIdx}:${s}:${v}`;
            if (!laneNotes.has(key)) laneNotes.set(key, []);
            laneNotes.get(key)!.push(n);
          }
          if (e.spans) for (const sp of e.spans) spans.push({ from: e, s, v, kind: sp.kind, end: sp.end });
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
  });

  // ---- ties (possibly across bars and systems) ----
  const noteFor = (m: number, s: number, id: string) => drawn[m].eventNote[s].get(id);
  for (const { from, s, m, v } of ties) {
    const events = laneOf(score.measures[m], s, v) ?? [];
    const i = events.indexOf(from);
    let nm = m;
    let next = events[i + 1];
    if (!next && score.measures[m + 1]) {
      nm = m + 1;
      next = laneOf(score.measures[nm], s, v)?.[0] as NoteEvent;
    }
    if (!next || isRest(next)) continue;
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
    if (!firstIdx.length) continue;
    const n1 = noteFor(m, s, from.id)!;
    const n2 = noteFor(nm, s, next.id)!;
    const sameSystem =
      nm === m || staveOf.get(`${m}:${s}`)!.getY() === staveOf.get(`${nm}:${s}`)!.getY();
    // with two voices on the staff, voice 1 ties curve up and voice 2 ties curve down
    const hasTwo = (mm: number) => !!laneOf(score.measures[mm], s, 1)?.some((e) => !isRest(e));
    const dir = hasTwo(m) || hasTwo(nm) ? (v ? 1 : -1) : 0;
    const tie = (notes: ConstructorParameters<typeof StaveTie>[0]) => {
      const t = new StaveTie(notes);
      if (dir) t.setDirection(dir);
      return t;
    };
    try {
      if (sameSystem) {
        tie({ firstNote: n1, lastNote: n2, firstIndexes: firstIdx, lastIndexes: lastIdx }).setContext(ctx).draw();
      } else {
        tie({ firstNote: n1, lastNote: null, firstIndexes: firstIdx, lastIndexes: firstIdx }).setContext(ctx).draw();
        tie({ firstNote: null, lastNote: n2, firstIndexes: lastIdx, lastIndexes: lastIdx }).setContext(ctx).draw();
      }
    } catch {
      /* ignore tie layout failures */
    }
  }

  drawTextLines(ctx, textItems);

  // ---- hairpins, pedal, 8va/8vb (split at line breaks) ----
  for (const sp of spans) {
    const a = noteById.get(sp.from.id);
    const b = noteById.get(sp.end);
    if (!a || !b) continue;
    const sa = sysOfNote.get(sp.from.id)!;
    const sb = sysOfNote.get(sp.end)!;
    const pieces: [StaveNote, StaveNote][] = [];
    if (sa === sb) pieces.push([a.note, b.note]);
    else {
      const first = laneNotes.get(`${sa}:${sp.s}:${sp.v}`) ?? [];
      const last = laneNotes.get(`${sb}:${sp.s}:${sp.v}`) ?? [];
      if (first.length) pieces.push([a.note, first[first.length - 1]]);
      for (let k = sa + 1; k < sb; k++) {
        const mid = laneNotes.get(`${k}:${sp.s}:${sp.v}`) ?? [];
        if (mid.length) pieces.push([mid[0], mid[mid.length - 1]]);
      }
      if (last.length) pieces.push([last[0], b.note]);
    }
    for (const [n1, n2] of pieces) {
      try {
        if (sp.kind === 'cresc' || sp.kind === 'dim') {
          const hp = new StaveHairpin(
            { firstNote: n1, lastNote: n2 },
            sp.kind === 'cresc' ? StaveHairpin.type.CRESC : StaveHairpin.type.DECRESC,
          );
          hp.setPosition(Modifier.Position.BELOW);
          hp.setRenderOptions({ height: 10, yShift: 2, leftShiftPx: 0, rightShiftPx: 0 });
          hp.setContext(ctx).draw();
        } else if (sp.kind === 'pedal') {
          const pm = new PedalMarking([n1, n2]);
          pm.setType(PedalMarking.type.MIXED);
          pm.setContext(ctx).draw();
        } else {
          new TextBracket({
            start: n1,
            stop: n2,
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
  }

  // ---- slurs ----
  for (const { from, s, m } of slurs) {
    const a = noteById.get(from.id);
    const b = noteById.get(from.slurEnd!);
    if (!a || !b || b.s !== s) continue;
    const sameSystem = staveOf.get(`${m}:${s}`)!.getY() === staveOf.get(`${b.m}:${s}`)!.getY();
    // VexFlow places the curve opposite the stems by itself
    const opts = {};
    try {
      if (sameSystem) new Curve(a.note, b.note, opts).setContext(ctx).draw();
      else {
        new Curve(a.note, undefined, opts).setContext(ctx).draw();
        new Curve(undefined, b.note, opts).setContext(ctx).draw();
      }
    } catch {
      /* ignore slur layout failures */
    }
  }

  layout.height = totalHeight;
  return layout;
}
