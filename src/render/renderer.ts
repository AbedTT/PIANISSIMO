import {
  Accidental,
  Annotation,
  Articulation,
  Barline,
  Beam,
  Curve,
  Dot,
  Formatter,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Tuplet,
  Repetition,
  Voice,
  VoiceMode,
  VoltaType,
} from 'vexflow';
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

function buildMeasure(score: Score, m: number): BuiltMeasure {
  const measure = score.measures[m];
  const lanes: LaneBuild[][] = [];
  const eventNote: Map<string, StaveNote>[] = [];
  const tuplets: Tuplet[] = [];

  measure.staves.forEach((_, s) => {
    const clef = score.staves[s].clef;
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
          const n = makeNote(e, clef, score.keyFifths, state, stem, restKey);
          notes.push(n);
          map.set(e.id, n);
        }
        tuplets.push(...groupTuplets(events, notes));
      }
      const voice = new Voice({ numBeats: score.timeBeats, beatValue: score.timeBeatType });
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
  kind: 'chord' | 'lyric';
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
    const y = it.kind === 'chord' ? Math.min(it.staveTop - 22, it.noteTop - 10) : Math.max(it.staveBottom + 30, it.noteBottom + 18);
    const prev = bases.get(it.baseKey);
    bases.set(it.baseKey, prev === undefined ? y : it.kind === 'chord' ? Math.min(prev, y) : Math.max(prev, y));
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.x - b.x);
    const chord = list[0].kind === 'chord';
    const y = bases.get(list[0].baseKey)! + list[0].line * VERSE_LINE;
    ctx.save();
    const [family, size, weight] = chord ? CHORD_FONT : LYRIC_FONT;
    ctx.setFont(family, size, weight);
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

export function renderScore(host: HTMLElement, score: Score, width: number): Layout {
  host.innerHTML = '';
  const layout: Layout = { events: new Map(), staves: [], elements: new Map(), systems: [], height: 0 };
  const built = score.measures.map((_, m) => buildMeasure(score, m));

  // ---- line breaking ----
  const usable = width - MARGIN_X * 2;
  const keyWidth = 12 * Math.abs(score.keyFifths);
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
    const header = line.length === 0 ? 50 + keyWidth + (systems.length === 0 ? 30 : 0) : 0;
    const w = desired(m) + header;
    if (line.length > 0 && lineWidth + w > usable) {
      systems.push(line);
      line = [];
      lineWidth = 0;
      const head = 50 + keyWidth;
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
  const has = (s: number, key: 'harmony' | 'lyric') =>
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
    yAcc += has(s, 'harmony') ? 22 : 0;
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
    const headerW = 50 + keyWidth + (sysIdx === 0 ? 30 : 0);
    const natural = measures.map((m) => desired(m));
    const sum = natural.reduce((a, b) => a + b, 0) + headerW;
    const stretch = isLast && sum < usable * 0.7 ? 1 : usable / sum;

    let x = MARGIN_X;
    const firstStaves: Stave[] = [];
    const lastStaves: Stave[] = [];
    measures.forEach((m, k) => {
      const w = natural[k] * stretch + (k === 0 ? headerW * stretch : 0);
      // fresh notes for drawing: the width pass already attached formatter state to built[m]
      const b = buildMeasure(score, m);
      drawn[m] = b;
      const staves = score.staves.map((def, s) => {
        const st = new Stave(x, y0 + staffY[s], w);
        if (k === 0) {
          st.addClef(def.clef);
          if (score.keyFifths !== 0) st.addKeySignature(KEY_NAMES[score.keyFifths]);
          if (sysIdx === 0) st.addTimeSignature(`${score.timeBeats}/${score.timeBeatType}`);
          if (s === 0 && m > 0) st.setMeasure(m + 1);
        }
        const bar = score.measures[m];
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
        new StaveConnector(staves[0], staves[staffCount - 1]).setType('singleRight').setContext(ctx).draw();
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
            const x0 = st.getNoteStartX() + (startTick(events, i) / barTicks(score)) * span;
            layout.events.set(e.id, { m, s, i, v, x: x0, width: Math.max(12, (eventTicksOf(e) / barTicks(score)) * span - 4) });
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
          if (e.harmony || (lyricsOf(e).length && !isRest(e))) {
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
        });
        }
      });
      x += w;
    });

    if (staffCount > 1) {
      new StaveConnector(firstStaves[0], firstStaves[staffCount - 1]).setType('brace').setContext(ctx).draw();
      new StaveConnector(firstStaves[0], firstStaves[staffCount - 1]).setType('singleLeft').setContext(ctx).draw();
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
