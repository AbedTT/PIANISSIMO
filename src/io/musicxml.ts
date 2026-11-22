import { largestFitting, ticksOf, TPQ } from '../model/duration';
import { midiOf } from '../model/pitch';
import { soundById, soundForProgram } from '../audio/sounds';
import { chordToText, parseChord, suffixForKind } from '../model/harmony';
import { lyricsOf, setLyricOn } from '../model/lyrics';
import { allEvents, barTicks, eventTicks, lanesOf, refitMeasures, restsFor, setLane, tupletGroups, uid } from '../model/score';
import {
  isRest,
  JUMP_LABELS,
  TRIPLET,
  type JumpType,
  type Measure,
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
const CLEF_XML: Record<Clef, [string, number]> = { treble: ['G', 2], bass: ['F', 4], alto: ['C', 3] };
const ART_XML: Record<Articulation, string> = {
  staccato: 'staccato', accent: 'accent', tenuto: 'tenuto', marcato: 'strong-accent', fermata: 'fermata',
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ------------------------------------------------------------------ export

export function toMusicXML(score: Score): string {
  const out: string[] = [];
  const staffCount = score.staves.length;
  const bar = barTicks(score);
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  out.push(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
  );
  out.push('<score-partwise version="4.0">');
  out.push(`<work><work-title>${esc(score.title)}</work-title></work>`);
  out.push('<identification>');
  if (score.composer) out.push(`<creator type="composer">${esc(score.composer)}</creator>`);
  out.push('<encoding><software>Pianissimo</software></encoding></identification>');
  // one score-instrument per distinct staff sound; notes point at theirs with <instrument>
  const soundIds = [...new Set(score.staves.map((st) => soundById(st.sound).id))];
  const instOf = (s: number) => `P1-I${soundIds.indexOf(soundById(score.staves[s].sound).id) + 1}`;
  const multi = soundIds.length > 1;
  out.push(`<part-list><score-part id="P1"><part-name>${esc(soundById(soundIds[0]).name)}</part-name>`);
  soundIds.forEach((id, k) =>
    out.push(`<score-instrument id="P1-I${k + 1}"><instrument-name>${esc(soundById(id).name)}</instrument-name></score-instrument>`),
  );
  soundIds.forEach((id, k) =>
    out.push(
      `<midi-instrument id="P1-I${k + 1}"><midi-channel>${k + 1 >= 10 ? k + 2 : k + 1}</midi-channel><midi-program>${soundById(id).program + 1}</midi-program></midi-instrument>`,
    ),
  );
  out.push('</score-part></part-list>');
  out.push('<part id="P1">');

  // per lane (staff*2 + voice): previous event (for tie stops) and whether a word is still open (hyphen)
  const prev: (NoteEvent | null)[] = [];
  const lyricOpen = new Map<string, boolean>(); // `${lane}:${verse}` -> word still open (hyphen)
  const slurStops = new Set<string>();
  for (const e of allEvents(score)) if (e.slurEnd) slurStops.add(e.slurEnd);

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
      score.staves.forEach((st, s) => {
        const [sign, line] = CLEF_XML[st.clef];
        out.push(`<clef number="${s + 1}"><sign>${sign}</sign><line>${line}</line></clef>`);
      });
      out.push('</attributes>');
      out.push(
        `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.tempo}</per-minute></metronome></direction-type><sound tempo="${score.tempo}"/></direction>`,
      );
    }
    // navigation signs at the start of the bar
    if (measure.segno) {
      out.push('<direction placement="above"><direction-type><segno/></direction-type><sound segno="segno"/></direction>');
    }
    if (measure.coda) {
      out.push('<direction placement="above"><direction-type><coda/></direction-type><sound coda="coda"/></direction>');
    }
    // voice 1 of every staff, plus voice 2 where it has notes; each lane after the first rewinds the bar
    const exportLanes = measure.staves.flatMap((_, s) =>
      lanesOf(measure, s)
        .filter(({ v, events }) => !v || events.some((e) => !isRest(e)))
        .map((l) => ({ ...l, s })),
    );
    const twoVoices = new Set(exportLanes.filter((l) => l.v).map((l) => l.s));
    exportLanes.forEach(({ s, v, events }, laneIdx) => {
      if (laneIdx > 0) out.push(`<backup><duration>${bar}</duration></backup>`);
      const L = s * 2 + v;
      const tupletStart = new Set<number>();
      const tupletStop = new Set<number>();
      for (const g of tupletGroups(events)) {
        tupletStart.add(g[0]);
        tupletStop.add(g[g.length - 1]);
      }
      events.forEach((e, idx) => {
        if (e.harmony) out.push(harmonyXML(e.harmony, s + 1, staffCount > 1));
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
          if (!pitch) out.push('<rest/>');
          else {
            out.push(`<pitch><step>${pitch.step}</step>`);
            if (pitch.alter) out.push(`<alter>${pitch.alter}</alter>`);
            out.push(`<octave>${pitch.octave}</octave></pitch>`);
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
          if (pitch && twoVoices.has(s)) out.push(`<stem>${v ? 'down' : 'up'}</stem>`);
          if (staffCount > 1) out.push(`<staff>${s + 1}</staff>`);
          const lead = k === 0;
          const arts = lead ? e.articulations ?? [] : [];
          const tStart = lead && tupletStart.has(idx);
          const tStop = lead && tupletStop.has(idx);
          const sStart = lead && !!e.slurEnd && !!pitch;
          const sStop = lead && slurStops.has(e.id) && !!pitch;
          if (stop || start || arts.length || tStart || tStop || sStart || sStop) {
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
  out.push('</part></score-partwise>');
  return out.join('\n');
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
  for (const part of parts) {
    const measures = kids(part, 'measure');
    const staffCount = parseInt(text(part, 'attributes > staves'), 10) || 1;
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
      score.staves.push({ clef: sign === 'F' ? 'bass' : sign === 'C' ? 'alto' : 'treble', ...(sound ? { sound } : {}) });
    }
    let divisions = 1;
    const slurOpen: (NoteEvent | null)[] = Array(staffCount).fill(null);
    let openVolta: number | null = null;
    measures.forEach((mEl, m) => {
      while (score.measures.length <= m) score.measures.push({ staves: [] });
      if (openVolta) score.measures[m].volta = openVolta;
      // lanes per staff: [voice 1, voice 2]; each remembers how much of the bar it has filled
      type Lane = { events: NoteEvent[]; filled: number };
      const lanes: (Lane | null)[][] = Array.from({ length: staffCount }, () => [null, null]);
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
        } else if (el.tagName === 'harmony') {
          const s = Math.min(staffCount - 1, (parseInt(text(el, ':scope > staff'), 10) || 1) - 1);
          pendingChord[s] = readHarmony(el);
        } else if (el.tagName === 'direction') {
          readNavigation(el, score.measures[m]);
          const dyn = el.querySelector('dynamics > *')?.tagName as Dynamic | undefined;
          const s = (parseInt(text(el, ':scope > staff'), 10) || 1) - 1;
          if (dyn && s < staffCount) pendingDyn[s] = dyn;
        } else if (el.tagName === 'backup') {
          pos = Math.max(0, pos - toTicks(el));
        } else if (el.tagName === 'forward') {
          pos += toTicks(el);
        } else if (el.tagName === 'note') {
          if (el.querySelector(':scope > grace')) continue; // grace notes take no time
          const isChord = !!el.querySelector(':scope > chord');
          const ticks = toTicks(el);
          if (!isChord) pos += ticks; // time moves on even for cue notes and dropped voices
          if (el.querySelector(':scope > cue')) continue;
          const s = Math.min(staffCount - 1, (parseInt(text(el, ':scope > staff'), 10) || 1) - 1);
          // the first two voices seen on a staff become voice 1 and voice 2; others are dropped
          const voiceId = text(el, ':scope > voice') || '1';
          let v = voiceIds[s].indexOf(voiceId);
          if (v < 0) {
            if (voiceIds[s].length >= 2) continue;
            voiceIds[s].push(voiceId);
            v = voiceIds[s].length - 1;
          }
          const lane = (lanes[s][v] ??= { events: [], filled: 0 });
          const list = lane.events;
          const pitchEl = el.querySelector(':scope > pitch');
          const pitch = pitchEl
            ? {
                step: text(pitchEl, 'step') as Step,
                alter: Math.round(parseFloat(text(pitchEl, 'alter') || '0')),
                octave: parseInt(text(pitchEl, 'octave'), 10),
              }
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
          let tuplet =
            tm && text(tm, 'actual-notes') === '3' && text(tm, 'normal-notes') === '2' ? TRIPLET : undefined;
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
          list.push(ev);
          lane.filled = start + eventTicks(ev);
        }
      }
      lanes.forEach(([v1, v2], s) => {
        score.measures[m].staves[staffBase + s] = v1?.events ?? [];
        if (v2 && v2.events.some((e) => !isRest(e))) setLane(score.measures[m], staffBase + s, 1, v2.events);
      });
    });
    staffBase += staffCount;
  }
  if (!score.staves.length) throw new Error('The score has no parts.');
  // fill missing staves (parts with fewer measures) and fit every bar to the meter
  for (const measure of score.measures) {
    for (let s = 0; s < score.staves.length; s++) measure.staves[s] ??= restsFor(barTicks(score));
  }
  refitMeasures(score);
  return score;
}
