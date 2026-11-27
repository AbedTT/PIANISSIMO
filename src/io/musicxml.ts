import { largestFitting, ticksOf, TPQ } from '../model/duration';
import { midiOf } from '../model/pitch';
import { drumAt } from '../model/drums';
import { soundById, soundForProgram } from '../audio/sounds';
import { chordToText, parseChord, suffixForKind } from '../model/harmony';
import { lyricsOf, setLyricOn } from '../model/lyrics';
import { contextAt } from '../model/context';
import { extractPart, partsOf } from '../model/parts';
import { transposeEvents, transposeKey, transposeScore } from '../model/transpose';
import { sameTuplet, TUPLETS } from '../model/duration';
import { allEvents, barTicks, eventTicks, lanesOf, MAX_VOICES, refitMeasures, restsFor, setLane, tupletGroups, uid } from '../model/score';
import {
  isRest,
  JUMP_LABELS,
  type JumpType,
  type Measure,
  type Part,
  type Pitch,
  type SpanKind,
  type Articulation,
  type Clef,
  type DurationType,
  type Dynamic,
  type NoteEvent,
  type Score,
  type Step,
} from '../model/types';

const TYPE_NAME: Record<DurationType, string> = {
  w: 'whole', h: 'half', q: 'quarter', '8': 'eighth', '16': '16th', '32': '32nd', '64': '64th',
};
const NAME_TYPE: Record<string, DurationType> = Object.fromEntries(
  Object.entries(TYPE_NAME).map(([k, v]) => [v, k as DurationType]),
);
const CLEF_XML: Record<Clef, [string, number]> = { treble: ['G', 2], bass: ['F', 4], alto: ['C', 3], percussion: ['percussion', 0] };
const clefXML = (s: number, c: Clef) => {
  const [sign, line] = CLEF_XML[c];
  return `<clef number="${s + 1}"><sign>${sign}</sign>${line ? `<line>${line}</line>` : ''}</clef>`;
};
const clefOfSign = (sign: string): Clef => (sign === 'F' ? 'bass' : sign === 'C' ? 'alto' : sign === 'percussion' ? 'percussion' : 'treble');
const ART_XML: Record<Articulation, string> = {
  staccato: 'staccato', accent: 'accent', tenuto: 'tenuto', marcato: 'strong-accent', fermata: 'fermata',
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ------------------------------------------------------------------ export

/**
 * MusicXML (partwise 4.0). Each instrument becomes a <part>; transposing instruments are
 * written at their written pitch with a <transpose> element (sounding = written + chromatic).
 */
export function toMusicXML(score: Score): string {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  out.push(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
  );
  out.push('<score-partwise version="4.0">');
  out.push(`<work><work-title>${esc(score.title)}</work-title></work>`);
  out.push('<identification>');
  if (score.composer) out.push(`<creator type="composer">${esc(score.composer)}</creator>`);
  out.push('<encoding><software>Pianissimo</software></encoding></identification>');

  const parts = partsOf(score);
  let channel = 0;
  out.push('<part-list>');
  parts.forEach(({ part, start }, k) => {
    const pid = `P${k + 1}`;
    const sounds = [...new Set(score.staves.slice(start, start + part.staves).map((st) => soundById(st.sound).id))];
    out.push(`<score-part id="${pid}"><part-name>${esc(part.name)}</part-name>`);
    if (part.short) out.push(`<part-abbreviation>${esc(part.short)}</part-abbreviation>`);
    sounds.forEach((id, i) =>
      out.push(`<score-instrument id="${pid}-I${i + 1}"><instrument-name>${esc(soundById(id).name)}</instrument-name></score-instrument>`),
    );
    sounds.forEach((id, i) => {
      channel++;
      if (channel === 10) channel++; // 10 is the drum channel
      out.push(
        `<midi-instrument id="${pid}-I${i + 1}"><midi-channel>${Math.min(16, channel)}</midi-channel><midi-program>${soundById(id).program + 1}</midi-program></midi-instrument>`,
      );
    });
    out.push('</score-part>');
  });
  out.push('</part-list>');

  parts.forEach(({ part }, k) => {
    const pid = `P${k + 1}`;
    let partScore = parts.length > 1 ? extractPart(score, k) : score;
    // transposing instruments are written at written pitch (key, notes and chord symbols)
    if (part.transpose) {
      partScore = JSON.parse(JSON.stringify(partScore)) as Score;
      transposeScore(partScore, part.transpose);
    }
    out.push(`<part id="${pid}">`);
    writePart(partScore, pid, out, part.transpose ?? 0);
    out.push('</part>');
  });
  out.push('</score-partwise>');
  return out.join('\n');
}

function writePart(score: Score, pid: string, out: string[], transpose: number) {
  const staffCount = score.staves.length;
  // one score-instrument per distinct staff sound; notes point at theirs with <instrument>
  const soundIds = [...new Set(score.staves.map((st) => soundById(st.sound).id))];
  const instOf = (s: number) => `${pid}-I${soundIds.indexOf(soundById(score.staves[s].sound).id) + 1}`;
  const multi = soundIds.length > 1;

  // per lane (staff*2 + voice): previous event (for tie stops) and whether a word is still open (hyphen)
  const prev: (NoteEvent | null)[] = [];
  const lyricOpen = new Map<string, boolean>(); // `${lane}:${verse}` -> word still open (hyphen)
  const slurStops = new Set<string>();
  for (const e of allEvents(score)) if (e.slurEnd) slurStops.add(e.slurEnd);
  // lines (hairpins, pedal, 8va) that end at each note
  const spanStops = new Map<string, SpanKind[]>();
  for (const e of allEvents(score)) for (const sp of e.spans ?? []) spanStops.set(sp.end, [...(spanStops.get(sp.end) ?? []), sp.kind]);
  const ottava: number[] = []; // per lane: octaves added to written pitch while an 8va/8vb is active

  score.measures.forEach((measure, m) => {
    out.push(`<measure number="${m + 1}">`);
    const prevVolta = score.measures[m - 1]?.volta;
    const nextVolta = score.measures[m + 1]?.volta;
    const endingStart = measure.volta && measure.volta !== prevVolta;
    if (measure.repeatStart || endingStart) {
      out.push(
        '<barline location="left">' +
          (measure.repeatStart ? '<bar-style>heavy-light</bar-style>' : '') +
          (endingStart ? `<ending number="${measure.volta}" type="start">${measure.volta}.</ending>` : '') +
          (measure.repeatStart ? '<repeat direction="forward"/>' : '') +
          '</barline>',
      );
    }
    if (m === 0) {
      out.push(`<attributes><divisions>${TPQ}</divisions>`);
      out.push(`<key><fifths>${score.keyFifths}</fifths></key>`);
      out.push(`<time><beats>${score.timeBeats}</beats><beat-type>${score.timeBeatType}</beat-type></time>`);
      if (staffCount > 1) out.push(`<staves>${staffCount}</staves>`);
      score.staves.forEach((st, s) => out.push(clefXML(s, st.clef)));
      if (transpose) {
        // sounding = written + chromatic (e.g. B♭ clarinet: chromatic -2, diatonic -1)
        out.push(`<transpose><diatonic>${-Math.round((transpose * 7) / 12)}</diatonic><chromatic>${-transpose}</chromatic></transpose>`);
      }
      out.push('</attributes>');
      out.push(
        `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.tempo}</per-minute></metronome></direction-type><sound tempo="${score.tempo}"/></direction>`,
      );
    }
    // changes of key, time or clef at this bar
    if (m > 0 && (measure.key !== undefined || measure.time || measure.clefs?.some((c) => c))) {
      out.push('<attributes>');
      if (measure.key !== undefined) out.push(`<key><fifths>${measure.key}</fifths></key>`);
      if (measure.time) out.push(`<time><beats>${measure.time.beats}</beats><beat-type>${measure.time.beatType}</beat-type></time>`);
      measure.clefs?.forEach((c, s) => {
        if (c) out.push(clefXML(s, c));
      });
      out.push('</attributes>');
    }
    if (measure.rehearsal) {
      out.push(`<direction placement="above"><direction-type><rehearsal>${esc(measure.rehearsal)}</rehearsal></direction-type></direction>`);
    }
    if (measure.tempo) {
      const words = measure.tempo.text ? `<direction-type><words>${esc(measure.tempo.text)}</words></direction-type>` : '';
      out.push(
        `<direction placement="above">${words}<direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${measure.tempo.bpm}</per-minute></metronome></direction-type><sound tempo="${measure.tempo.bpm}"/></direction>`,
      );
    }
    // navigation signs at the start of the bar
    if (measure.segno) {
      out.push('<direction placement="above"><direction-type><segno/></direction-type><sound segno="segno"/></direction>');
    }
    if (measure.coda) {
      out.push('<direction placement="above"><direction-type><coda/></direction-type><sound coda="coda"/></direction>');
    }
    // voice 1 of every staff, plus voices 2–4 where they have notes; each lane after the first rewinds the bar
    const exportLanes = measure.staves.flatMap((_, s) =>
      lanesOf(measure, s)
        .filter(({ v, events }) => !v || events.some((e) => !isRest(e)))
        .map((l) => ({ ...l, s })),
    );
    const twoVoices = new Set(exportLanes.filter((l) => l.v).map((l) => l.s));
    exportLanes.forEach(({ s, v, events }, laneIdx) => {
      // rewind to the start of this bar (bars can differ in length after a time change)
      if (laneIdx > 0) out.push(`<backup><duration>${barTicks(score, m)}</duration></backup>`);
      const L = s * 4 + v;
      const tupletStart = new Set<number>();
      const tupletStop = new Set<number>();
      for (const g of tupletGroups(events)) {
        tupletStart.add(g[0]);
        tupletStop.add(g[g.length - 1]);
      }
      const staffEl = staffCount > 1 ? `<staff>${s + 1}</staff>` : '';
      const direction = (placement: string, type: string) =>
        out.push(`<direction placement="${placement}"><direction-type>${type}</direction-type>${staffEl}</direction>`);
      events.forEach((e, idx) => {
        if (e.harmony) out.push(harmonyXML(e.harmony, s + 1, staffCount > 1));
        if (e.text) direction('above', `<words font-style="italic">${esc(e.text)}</words>`);
        for (const sp of e.spans ?? []) {
          if (sp.kind === 'cresc' || sp.kind === 'dim') direction('below', `<wedge type="${sp.kind === 'cresc' ? 'crescendo' : 'diminuendo'}"/>`);
          else if (sp.kind === 'pedal') direction('below', '<pedal type="start" line="yes"/>');
          else {
            direction(sp.kind === '8va' ? 'above' : 'below', `<octave-shift type="${sp.kind === '8va' ? 'down' : 'up'}" size="8"/>`);
            ottava[L] = sp.kind === '8va' ? 1 : -1;
          }
        }
        // grace notes come right before their main note and take no time
        for (const g of e.graces ?? []) {
          g.pitches.forEach((gp, k) => {
            out.push(`<note><grace slash="yes"/>${k > 0 ? '<chord/>' : ''}${pitchXML(gp, ottava[L] ?? 0)}`);
            out.push(`<voice>${s * 4 + 1 + v}</voice><type>eighth</type>${staffEl}</note>`);
          });
        }
        if (e.dynamic) {
          out.push(
            `<direction placement="below"><direction-type><dynamics><${e.dynamic}/></dynamics></direction-type><staff>${s + 1}</staff></direction>`,
          );
        }
        const p = prev[L];
        const tiedFrom = new Set(p && p.tie ? p.pitches.map(midiOf) : []);
        const chord = isRest(e) ? [null] : e.pitches;
        chord.forEach((pitch, k) => {
          out.push('<note>');
          if (k > 0) out.push('<chord/>');
          const drums = score.staves[s].clef === 'percussion';
          if (!pitch) out.push('<rest/>');
          else if (drums) {
            out.push(`<unpitched><display-step>${pitch.step}</display-step><display-octave>${pitch.octave}</display-octave></unpitched>`);
          } else {
            // under 8va/8vb MusicXML keeps the sounding pitch; we store the written one
            out.push(pitchXML(pitch, ottava[L] ?? 0));
          }
          out.push(`<duration>${eventTicks(e)}</duration>`);
          const stop = pitch && tiedFrom.has(midiOf(pitch));
          const start = pitch && e.tie;
          if (stop) out.push('<tie type="stop"/>');
          if (start) out.push('<tie type="start"/>');
          if (multi) out.push(`<instrument id="${instOf(s)}"/>`);
          out.push(`<voice>${s * 4 + 1 + v}</voice><type>${TYPE_NAME[e.type]}</type>`);
          for (let d = 0; d < e.dots; d++) out.push('<dot/>');
          if (e.tuplet) {
            out.push(
              `<time-modification><actual-notes>${e.tuplet.actual}</actual-notes><normal-notes>${e.tuplet.normal}</normal-notes></time-modification>`,
            );
          }
          if (pitch && twoVoices.has(s)) out.push(`<stem>${v % 2 ? 'down' : 'up'}</stem>`);
          if (pitch && drums && drumAt(pitch).x) out.push('<notehead>x</notehead>');
          if (staffCount > 1) out.push(`<staff>${s + 1}</staff>`);
          const lead = k === 0;
          const arts = lead ? e.articulations ?? [] : [];
          const tStart = lead && tupletStart.has(idx);
          const tStop = lead && tupletStop.has(idx);
          const sStart = lead && !!e.slurEnd && !!pitch;
          const sStop = lead && slurStops.has(e.id) && !!pitch;
          const trem = lead && pitch && e.tremolo ? e.tremolo : 0;
          if (stop || start || arts.length || tStart || tStop || sStart || sStop || trem) {
            out.push('<notations>');
            if (stop) out.push('<tied type="stop"/>');
            if (start) out.push('<tied type="start"/>');
            if (tStart) out.push('<tuplet type="start" bracket="yes"/>');
            if (tStop) out.push('<tuplet type="stop"/>');
            if (sStop) out.push('<slur type="stop" number="1"/>');
            if (sStart) out.push('<slur type="start" number="1"/>');
            if (arts.includes('fermata')) out.push('<fermata type="upright"/>');
            const plain = arts.filter((a) => a !== 'fermata');
            if (plain.length) out.push(`<articulations>${plain.map((a) => `<${ART_XML[a]}/>`).join('')}</articulations>`);
            if (trem) out.push(`<ornaments><tremolo type="single">${trem}</tremolo></ornaments>`);
            out.push('</notations>');
          }
          if (lead && pitch) {
            for (const { verse, lyric } of lyricsOf(e)) {
              const key = `${L}:${verse}`;
              const open = lyricOpen.get(key);
              const syllabic = open ? (lyric.hyphen ? 'middle' : 'end') : lyric.hyphen ? 'begin' : 'single';
              out.push(`<lyric number="${verse}"><syllabic>${syllabic}</syllabic><text>${esc(lyric.text)}</text></lyric>`);
              lyricOpen.set(key, !!lyric.hyphen);
            }
          }
          out.push('</note>');
        });
        prev[L] = e;
        for (const kind of spanStops.get(e.id) ?? []) {
          if (kind === 'cresc' || kind === 'dim') direction('below', '<wedge type="stop"/>');
          else if (kind === 'pedal') direction('below', '<pedal type="stop" line="yes"/>');
          else {
            direction(kind === '8va' ? 'above' : 'below', '<octave-shift type="stop" size="8"/>');
            ottava[L] = 0;
          }
        }
      });
    });
    // navigation instructions at the end of the bar (after all lanes, the position is the bar end)
    const words = (text: string, sound: string) =>
      out.push(`<direction placement="above"><direction-type><words>${esc(text)}</words></direction-type><sound ${sound}/></direction>`);
    if (measure.fine) words('Fine', 'fine="yes"');
    if (measure.toCoda) words('To Coda', 'tocoda="coda"');
    if (measure.jump) words(JUMP_LABELS[measure.jump], measure.jump.startsWith('dc') ? 'dacapo="yes"' : 'dalsegno="segno"');
    const endingStop = measure.volta && measure.volta !== nextVolta;
    const last = m === score.measures.length - 1;
    if (measure.repeatEnd || endingStop || last) {
      out.push(
        '<barline location="right">' +
          (measure.repeatEnd || last ? '<bar-style>light-heavy</bar-style>' : '') +
          (endingStop
            ? `<ending number="${measure.volta}" type="${measure.repeatEnd ? 'stop' : 'discontinue'}"/>`
            : '') +
          (measure.repeatEnd ? '<repeat direction="backward"/>' : '') +
          '</barline>',
      );
    }
    out.push('</measure>');
  });
}

/** Segno/Coda signs and Fine/To Coda/D.C./D.S. instructions (from the sign, <sound> or the words). */
function readNavigation(el: Element, bar: Measure) {
  if (el.querySelector('direction-type > segno')) bar.segno = true;
  if (el.querySelector('direction-type > coda')) bar.coda = true;
  const sound = el.querySelector(':scope > sound');
  const words = text(el, 'direction-type > words').toLowerCase().replace(/\s+/g, ' ');
  if (sound?.hasAttribute('fine') || words === 'fine') bar.fine = true;
  if (sound?.hasAttribute('tocoda') || words.startsWith('to coda')) bar.toCoda = true;
  const dc = sound?.hasAttribute('dacapo') || /^d\.? ?c\.?( |$)|^da capo/.test(words);
  const ds = sound?.hasAttribute('dalsegno') || /^d\.? ?s\.?( |$)|^dal segno/.test(words);
  if (dc || ds) {
    const variant = words.includes('fine') ? 'Fine' : words.includes('coda') ? 'Coda' : '';
    bar.jump = `${dc ? 'dc' : 'ds'}${variant}` as JumpType;
  }
}

function pitchXML(p: Pitch, octaveShift: number): string {
  return `<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave + octaveShift}</octave></pitch>`;
}

/** Words that are navigation instructions rather than staff text. */
function isNavigationWords(words: string): boolean {
  const w = words.toLowerCase().trim();
  return w === 'fine' || w.startsWith('to coda') || /^d\.? ?[cs]\.?( |$)|^da capo|^dal segno/.test(w);
}

function harmonyXML(text: string, staff: number, withStaff: boolean): string {
  const c = parseChord(text);
  const staffEl = withStaff ? `<staff>${staff}</staff>` : '';
  if (!c) {
    // not a recognisable chord: keep it as text above the staff
    return `<direction placement="above"><direction-type><words>${esc(text)}</words></direction-type>${staffEl}</direction>`;
  }
  const alter = (a: number) => (a ? `<root-alter>${a}</root-alter>` : '');
  const bass = c.bass
    ? `<bass><bass-step>${c.bass.step}</bass-step>${c.bass.alter ? `<bass-alter>${c.bass.alter}</bass-alter>` : ''}</bass>`
    : '';
  return `<harmony><root><root-step>${c.root.step}</root-step>${alter(c.root.alter)}</root><kind text="${esc(c.suffix)}">${c.kind}</kind>${bass}${staffEl}</harmony>`;
}

function readHarmony(el: Element): string | null {
  const step = text(el, 'root > root-step') as Step;
  if (!step) return null;
  const kindEl = el.querySelector('kind');
  const suffix = kindEl?.getAttribute('text') ?? suffixForKind(kindEl?.textContent?.trim() ?? 'major');
  const bassStep = text(el, 'bass > bass-step') as Step;
  return chordToText({
    root: { step, alter: parseInt(text(el, 'root > root-alter') || '0', 10) },
    suffix,
    ...(bassStep ? { bass: { step: bassStep, alter: parseInt(text(el, 'bass > bass-alter') || '0', 10) } } : {}),
  });
}

// ------------------------------------------------------------------ import

const text = (el: Element | null | undefined, sel: string) => el?.querySelector(sel)?.textContent?.trim() ?? '';
const kids = (el: Element, name: string) => Array.from(el.children).filter((c) => c.tagName === name);

/**
 * Basic MusicXML (uncompressed .musicxml/.xml) import. Every staff of every part becomes
 * a Pianissimo staff; only the first voice per staff is kept; tuplets are approximated.
 */
export function fromMusicXML(xml: string): Score {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This file is not valid XML.');
  const root = doc.querySelector('score-partwise');
  if (!root) {
    throw new Error(doc.querySelector('score-timewise') ? 'Timewise MusicXML is not supported yet.' : 'Not a MusicXML score.');
  }

  const score: Score = {
    version: 1,
    title: text(root, 'work > work-title') || text(root, 'movement-title') || 'Imported score',
    composer: root.querySelector('identification creator[type="composer"]')?.textContent?.trim() ?? '',
    tempo: 100,
    keyFifths: 0,
    timeBeats: 4,
    timeBeatType: 4,
    staves: [],
    measures: [],
  };
  const firstKey = root.querySelector('key > fifths');
  if (firstKey) score.keyFifths = Math.max(-7, Math.min(7, parseInt(firstKey.textContent!, 10) || 0));
  const firstTime = root.querySelector('time');
  if (firstTime) {
    score.timeBeats = parseInt(text(firstTime, 'beats'), 10) || 4;
    score.timeBeatType = parseInt(text(firstTime, 'beat-type'), 10) || 4;
  }
  const tempo = root.querySelector('sound[tempo]')?.getAttribute('tempo');
  if (tempo) score.tempo = Math.round(parseFloat(tempo)) || 100;

  const parts = Array.from(root.querySelectorAll(':scope > part'));
  let staffBase = 0;
  const partDefs: Part[] = [];
  for (const part of parts) {
    const measures = kids(part, 'measure');
    const staffCount = parseInt(text(part, 'attributes > staves'), 10) || 1;
    // written minus sounding (a <transpose> with chromatic -2 = B♭ instrument = +2)
    const chromatic = parseInt(text(part, 'attributes > transpose > chromatic') || '0', 10) || 0;
    const octaveChange = parseInt(text(part, 'attributes > transpose > octave-change') || '0', 10) || 0;
    const writtenOver = -(chromatic + 12 * octaveChange);
    // instrument id -> sound, from this part's <midi-instrument> list
    const scorePart = root.querySelector(`part-list score-part[id="${part.getAttribute('id')}"]`);
    const soundOfInst = new Map<string, string>();
    scorePart?.querySelectorAll('midi-instrument').forEach((mi) => {
      const prog = parseInt(text(mi, 'midi-program'), 10);
      if (prog) soundOfInst.set(mi.getAttribute('id') ?? '', soundForProgram(prog - 1));
    });
    const partSound: string | undefined = soundOfInst.values().next().value;
    for (let s = 0; s < staffCount; s++) {
      const clefEl =
        part.querySelector(`attributes > clef[number="${s + 1}"]`) ?? (s === 0 ? part.querySelector('attributes > clef') : null);
      const sign = text(clefEl, 'sign');
      // the staff's own instrument: from its first note that names one
      const instId = Array.from(part.querySelectorAll('note'))
        .find((n) => (parseInt(text(n, ':scope > staff'), 10) || 1) === s + 1 && n.querySelector(':scope > instrument'))
        ?.querySelector(':scope > instrument')
        ?.getAttribute('id');
      const sound = (instId && soundOfInst.get(instId)) || partSound;
      const clef = clefOfSign(sign);
      // a drum staff plays the drum kit, whatever program the file names
      const staffSound = clef === 'percussion' ? 'drums' : sound;
      score.staves.push({ clef, ...(staffSound ? { sound: staffSound } : {}) });
    }
    let divisions = 1;
    const slurOpen: (NoteEvent | null)[] = Array(staffCount).fill(null);
    let openVolta: number | null = null;
    // per staff of this part: lines waiting for their first note, lines that are open, the last note,
    // grace notes waiting for their main note, staff text, and the 8va/8vb shift in force
    const pendingSpans: SpanKind[][] = Array.from({ length: staffCount }, () => []);
    const openSpans: Map<string, { ev: NoteEvent; kind: SpanKind }>[] = Array.from({ length: staffCount }, () => new Map());
    const lastNote: (NoteEvent | null)[] = Array(staffCount).fill(null);
    const pendingGraces: Pitch[][][] = Array.from({ length: staffCount }, () => []);
    const pendingText: (string | null)[] = Array(staffCount).fill(null);
    const shift: number[] = Array(staffCount).fill(0);
    const family = (k: SpanKind) => (k === 'cresc' || k === 'dim' ? 'hairpin' : k === 'pedal' ? 'pedal' : 'ottava');
    const closeSpan = (s: number, fam: string) => {
      const open = openSpans[s].get(fam);
      if (open && lastNote[s]) (open.ev.spans ??= []).push({ kind: open.kind, end: lastNote[s]!.id });
      openSpans[s].delete(fam);
    };
    measures.forEach((mEl, m) => {
      while (score.measures.length <= m) score.measures.push({ staves: [] });
      if (openVolta) score.measures[m].volta = openVolta;
      // lanes per staff: [voice 1, voice 2]; each remembers how much of the bar it has filled
      type Lane = { events: NoteEvent[]; filled: number };
      const lanes: (Lane | null)[][] = Array.from({ length: staffCount }, () => Array(MAX_VOICES).fill(null));
      const voiceIds: string[][] = Array.from({ length: staffCount }, () => []);
      let pos = 0; // current time position in ticks (moved by notes, <backup> and <forward>)
      const toTicks = (el: Element) => Math.round(((parseInt(text(el, ':scope > duration'), 10) || 0) * TPQ) / divisions);
      const pendingDyn: (Dynamic | null)[] = Array(staffCount).fill(null);
      const pendingChord: (string | null)[] = Array(staffCount).fill(null);
      for (const el of Array.from(mEl.children)) {
        if (el.tagName === 'barline') {
          const dir = el.querySelector('repeat')?.getAttribute('direction');
          if (dir === 'forward') score.measures[m].repeatStart = true;
          if (dir === 'backward') score.measures[m].repeatEnd = true;
          const ending = el.querySelector('ending');
          if (ending) {
            const n = parseInt(ending.getAttribute('number') ?? '', 10) || 1; // "1, 2" -> 1
            if (ending.getAttribute('type') === 'start') {
              openVolta = n;
              score.measures[m].volta = n;
            } else {
              score.measures[m].volta = openVolta ?? n;
              openVolta = null;
            }
          }
        } else if (el.tagName === 'attributes') {
          const d = parseInt(text(el, 'divisions'), 10);
          if (d) divisions = d;
          if (m > 0) {
            // changes during the piece (the first bar's values are the score's starting values)
            const before = contextAt(score, m - 1);
            const fifths = el.querySelector(':scope > key > fifths');
            if (fifths && staffBase === 0) {
              const k = Math.max(-7, Math.min(7, parseInt(fifths.textContent ?? '0', 10) || 0));
              if (k !== before.key) score.measures[m].key = k;
            }
            const timeEl = el.querySelector(':scope > time');
            if (timeEl && staffBase === 0) {
              const beats = parseInt(text(timeEl, 'beats'), 10) || before.beats;
              const beatType = parseInt(text(timeEl, 'beat-type'), 10) || before.beatType;
              if (beats !== before.beats || beatType !== before.beatType) score.measures[m].time = { beats, beatType };
            }
            el.querySelectorAll(':scope > clef').forEach((c) => {
              const idx = staffBase + (parseInt(c.getAttribute('number') ?? '1', 10) || 1) - 1;
              const sign = text(c, 'sign');
              const clef: Clef = clefOfSign(sign);
              if (idx < score.staves.length && clef !== before.clefs[idx]) {
                const clefs = (score.measures[m].clefs ??= score.staves.map(() => null));
                clefs[idx] = clef;
              }
            });
          }
        } else if (el.tagName === 'harmony') {
          const s = Math.min(staffCount - 1, (parseInt(text(el, ':scope > staff'), 10) || 1) - 1);
          pendingChord[s] = readHarmony(el);
        } else if (el.tagName === 'direction') {
          readNavigation(el, score.measures[m]);
          const ds = Math.min(staffCount - 1, (parseInt(text(el, ':scope > staff'), 10) || 1) - 1);
          const rehearsal = text(el, 'direction-type > rehearsal');
          if (rehearsal) score.measures[m].rehearsal = rehearsal;
          const bpm = parseFloat(el.querySelector(':scope > sound')?.getAttribute('tempo') ?? '');
          const words = text(el, 'direction-type > words');
          if (bpm && m > 0) score.measures[m].tempo = { bpm: Math.round(bpm), ...(words ? { text: words } : {}) };
          else if (bpm && m === 0 && words) score.measures[0].tempo = { bpm: Math.round(bpm), text: words };
          else if (words && !isNavigationWords(words)) pendingText[ds] = words;
          const wedge = el.querySelector('direction-type > wedge')?.getAttribute('type');
          if (wedge === 'crescendo' || wedge === 'diminuendo') pendingSpans[ds].push(wedge === 'crescendo' ? 'cresc' : 'dim');
          if (wedge === 'stop') closeSpan(ds, 'hairpin');
          const pedal = el.querySelector('direction-type > pedal')?.getAttribute('type');
          if (pedal === 'stop' || pedal === 'change') closeSpan(ds, 'pedal');
          if (pedal === 'start' || pedal === 'change') pendingSpans[ds].push('pedal');
          const shiftEl = el.querySelector('direction-type > octave-shift');
          const shiftType = shiftEl?.getAttribute('type');
          if (shiftType === 'down' || shiftType === 'up') {
            pendingSpans[ds].push(shiftType === 'down' ? '8va' : '8vb');
            shift[ds] = shiftType === 'down' ? -1 : 1; // written = sounding -/+ an octave
          } else if (shiftType === 'stop') {
            closeSpan(ds, 'ottava');
            shift[ds] = 0;
          }
          const dyn = el.querySelector('dynamics > *')?.tagName as Dynamic | undefined;
          const s = (parseInt(text(el, ':scope > staff'), 10) || 1) - 1;
          if (dyn && s < staffCount) pendingDyn[s] = dyn;
        } else if (el.tagName === 'backup') {
          pos = Math.max(0, pos - toTicks(el));
        } else if (el.tagName === 'forward') {
          pos += toTicks(el);
        } else if (el.tagName === 'note') {
          if (el.querySelector(':scope > grace')) {
            // grace notes take no time: keep them for the next main note on this staff
            const gs = Math.min(staffCount - 1, (parseInt(text(el, ':scope > staff'), 10) || 1) - 1);
            const gp = el.querySelector(':scope > pitch');
            if (gp) {
              const gpitch = {
                step: text(gp, 'step') as Step,
                alter: Math.round(parseFloat(text(gp, 'alter') || '0')),
                octave: parseInt(text(gp, 'octave'), 10) + shift[gs],
              };
              const list = pendingGraces[gs];
              if (el.querySelector(':scope > chord') && list.length) list[list.length - 1].push(gpitch);
              else list.push([gpitch]);
            }
            continue;
          }
          const isChord = !!el.querySelector(':scope > chord');
          const ticks = toTicks(el);
          if (!isChord) pos += ticks; // time moves on even for cue notes and dropped voices
          if (el.querySelector(':scope > cue')) continue;
          const s = Math.min(staffCount - 1, (parseInt(text(el, ':scope > staff'), 10) || 1) - 1);
          // the first four voices seen on a staff become voices 1–4; any more are dropped
          const voiceId = text(el, ':scope > voice') || '1';
          let v = voiceIds[s].indexOf(voiceId);
          if (v < 0) {
            if (voiceIds[s].length >= MAX_VOICES) continue;
            voiceIds[s].push(voiceId);
            v = voiceIds[s].length - 1;
          }
          const lane = (lanes[s][v] ??= { events: [], filled: 0 });
          const list = lane.events;
          const pitchEl = el.querySelector(':scope > pitch');
          const unpitched = el.querySelector(':scope > unpitched');
          const pitch = pitchEl
            ? {
                step: text(pitchEl, 'step') as Step,
                alter: Math.round(parseFloat(text(pitchEl, 'alter') || '0')),
                octave: parseInt(text(pitchEl, 'octave'), 10) + shift[s],
              }
            : unpitched
              ? // drums: the staff position is the sound
                { step: (text(unpitched, 'display-step') || 'C') as Step, alter: 0, octave: parseInt(text(unpitched, 'display-octave'), 10) || 5 }
              : null;
          if (isChord && list.length) {
            if (pitch) list[list.length - 1].pitches.push(pitch);
            continue;
          }
          // a voice that starts later in the bar (after <forward>/<backup>) gets rests before it
          const start = pos - ticks;
          if (start > lane.filled) {
            list.push(...restsFor(start - lane.filled));
            lane.filled = start;
          }
          let type = NAME_TYPE[text(el, ':scope > type')];
          let dots = kids(el, 'dot').length;
          const tm = el.querySelector(':scope > time-modification');
          const ratio = tm ? { actual: parseInt(text(tm, 'actual-notes'), 10), normal: parseInt(text(tm, 'normal-notes'), 10) } : null;
          let tuplet = ratio ? TUPLETS.find((t) => sameTuplet(t.ratio, ratio))?.ratio : undefined;
          if (!type || ticksOf(type, dots, tuplet) !== ticks) {
            const fit = largestFitting(ticks || TPQ);
            if (!fit) continue;
            ({ type, dots } = fit);
            tuplet = undefined;
          }
          const ev: NoteEvent = { id: uid(), pitches: pitch ? [pitch] : [], type, dots };
          if (tuplet) ev.tuplet = tuplet;
          if (pitch && el.querySelector('notations slur[type="stop"]') && slurOpen[s]) {
            slurOpen[s]!.slurEnd = ev.id;
            slurOpen[s] = null;
          }
          if (pitch && el.querySelector('notations slur[type="start"]')) slurOpen[s] = ev;
          if (pitch && el.querySelector(':scope > tie[type="start"]')) ev.tie = true;
          const arts: Articulation[] = [];
          for (const [a, tag] of Object.entries(ART_XML)) {
            if (el.querySelector(`notations ${tag}`)) arts.push(a as Articulation);
          }
          if (pitch && arts.length) ev.articulations = arts;
          const trem = el.querySelector('notations ornaments tremolo');
          if (pitch && trem && (trem.getAttribute('type') ?? 'single') === 'single') {
            const strokes = parseInt(trem.textContent ?? '', 10);
            if (strokes >= 1 && strokes <= 3) ev.tremolo = strokes;
          }
          if (pitch && pendingDyn[s]) {
            ev.dynamic = pendingDyn[s]!;
            pendingDyn[s] = null;
          }
          if (pitch) {
            kids(el, 'lyric').forEach((lyricEl, k) => {
              const lyricText = text(lyricEl, 'text');
              if (!lyricText) return;
              const verse = parseInt(lyricEl.getAttribute('number') ?? '', 10) || k + 1;
              const syl = text(lyricEl, 'syllabic');
              setLyricOn(ev, verse, { text: lyricText, hyphen: syl === 'begin' || syl === 'middle' });
            });
          }
          const chordText = pendingChord[s];
          pendingChord[s] = null;
          // whole-bar rests are written as "whole" regardless of meter
          if (!pitch && el.querySelector(':scope > rest[measure="yes"]')) {
            const rests = restsFor(barTicks(score));
            if (chordText) rests[0].harmony = chordText;
            list.push(...rests);
            lane.filled = start + barTicks(score);
            continue;
          }
          if (chordText) ev.harmony = chordText;
          if (pitch) {
            for (const kind of pendingSpans[s]) {
              const fam = family(kind);
              closeSpan(s, fam);
              openSpans[s].set(fam, { ev, kind });
            }
            pendingSpans[s] = [];
            if (pendingGraces[s].length) ev.graces = pendingGraces[s].map((pitches) => ({ pitches }));
            pendingGraces[s] = [];
            lastNote[s] = ev;
          }
          if (pendingText[s]) {
            ev.text = pendingText[s]!;
            pendingText[s] = null;
          }
          list.push(ev);
          lane.filled = start + eventTicks(ev);
        }
      }
      lanes.forEach(([v1, ...more], s) => {
        score.measures[m].staves[staffBase + s] = v1?.events ?? [];
        more.forEach((l, k) => {
          if (l && l.events.some((e) => !isRest(e))) setLane(score.measures[m], staffBase + s, k + 1, l.events);
        });
      });
    });
    const listEntry = root.querySelector(`part-list score-part[id="${part.getAttribute('id')}"]`);
    partDefs.push({
      name: text(listEntry, 'part-name') || `Part ${partDefs.length + 1}`,
      short: text(listEntry, 'part-abbreviation'),
      staves: staffCount,
      ...(writtenOver ? { transpose: writtenOver } : {}),
    });
    if (writtenOver) {
      // the file holds written pitches: bring this part to concert pitch
      if (staffBase === 0) {
        // the first part also gave the score its key: that was the written key
        score.keyFifths = transposeKey(score.keyFifths, -writtenOver);
        for (const bar of score.measures) if (bar.key !== undefined) bar.key = transposeKey(bar.key, -writtenOver);
      }
      score.measures.forEach((bar, m) => {
        const key = contextAt(score, m).key;
        for (let s = staffBase; s < staffBase + staffCount; s++) {
          if (!bar.staves[s]) continue;
          for (const { events } of lanesOf(bar, s)) transposeEvents(events, -writtenOver, key);
        }
      });
    }
    staffBase += staffCount;
  }
  if (!score.staves.length) throw new Error('The score has no parts.');
  if (partDefs.length > 1 || partDefs.some((p) => p.transpose)) score.parts = partDefs;
  // fill missing staves (parts with fewer measures) and fit every bar to the meter
  score.measures.forEach((measure, m) => {
    for (let s = 0; s < score.staves.length; s++) measure.staves[s] ??= restsFor(barTicks(score, m));
  });
  refitMeasures(score);
  return score;
}
