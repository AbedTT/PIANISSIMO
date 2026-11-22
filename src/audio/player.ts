import * as Tone from 'tone';
import { TPQ } from '../model/duration';
import { midiOf } from '../model/pitch';
import { barTicks, eventTicks, laneOf, playOrder } from '../model/score';
import { isRest, type Dynamic, type Pitch, type Score } from '../model/types';
import { accompanimentNotes } from './accompaniment';
import { GM_BASE, gmSampleUrls, soundById, type SoundDef } from './sounds';

export interface PlayOptions {
  /** Start at this event (first time it is played). */
  fromId?: string;
  /** Play only events whose ids are in this set (a selection); loops if `loop`. */
  range?: Set<string>;
  loop?: boolean;
  metronome?: boolean;
  /** One bar of clicks before the music starts. */
  countIn?: boolean;
}

/** Score notes plus the generated chord accompaniment. */
export function fullTimeline(score: Score) {
  const t = timeline(score);
  const backing = accompanimentNotes(score, t.events, t.length);
  return { ...t, notes: [...t.notes, ...backing].sort((a, b) => a.time - b.time) };
}

export interface TimedNote {
  /** seconds */
  time: number;
  duration: number;
  midi: number;
  velocity: number;
  /** staff index */
  s: number;
}

export interface TimedEvent {
  time: number;
  /** seconds */
  dur: number;
  id: string;
  m: number;
  s: number;
  i: number;
  /** voice (0 or 1) */
  v: number;
}

const VELOCITY: Record<Dynamic, number> = {
  ppp: 0.2, pp: 0.3, p: 0.42, mp: 0.55, mf: 0.67, f: 0.8, ff: 0.9, fff: 1, sfz: 1,
};

/** Flatten the score into sounding notes (ties merged) plus per-event times for the cursor. */
export function timeline(score: Score): { notes: TimedNote[]; events: TimedEvent[]; length: number } {
  const secPerTick = 60 / (score.tempo * TPQ);
  const notes: TimedNote[] = [];
  const events: TimedEvent[] = [];
  let length = 0;
  const order = playOrder(score);

  const bar = barTicks(score);
  score.staves.forEach((_, s) => {
   for (const v of [0, 1]) {
    if (v && !score.measures.some((mm) => mm.voice2?.[s])) continue;
    let tick = 0;
    let velocity = VELOCITY.mf;
    /** midi -> note still sounding because of a tie */
    let held = new Map<number, TimedNote>();
    order.forEach((m) => {
      const laneEvents = laneOf(score.measures[m], s, v);
      if (!laneEvents) {
        // no second voice in this bar: time still passes
        tick += bar;
        held = new Map();
        return;
      }
      laneEvents.forEach((e, i) => {
        const len = eventTicks(e);
        events.push({ time: tick * secPerTick, dur: len * secPerTick, id: e.id, m, s, i, v });
        if (e.dynamic) velocity = VELOCITY[e.dynamic];
        const nextHeld = new Map<number, TimedNote>();
        if (!isRest(e)) {
          const accent = e.articulations?.includes('accent') || e.articulations?.includes('marcato') ? 0.15 : 0;
          const staccato = e.articulations?.includes('staccato') ? 0.5 : 1;
          for (const p of e.pitches) {
            const midi = midiOf(p);
            const dur = len * secPerTick;
            let n = held.get(midi);
            if (n) n.duration += dur;
            else {
              n = { time: tick * secPerTick, duration: dur * staccato, midi, velocity: Math.min(1, velocity + accent), s };
              notes.push(n);
            }
            if (e.tie) nextHeld.set(midi, n);
          }
        }
        held = nextHeld;
        tick += len;
      });
    });
    length = Math.max(length, tick * secPerTick);
   }
  });
  notes.sort((a, b) => a.time - b.time);
  events.sort((a, b) => a.time - b.time);
  return { notes, events, length };
}

type Instrument = {
  triggerAttackRelease: (notes: string | string[], duration: number, time?: number, velocity?: number) => unknown;
  releaseAll?: (time?: number) => unknown;
};

/** Multi-instrument playback with Tone.js: one instrument per sound, loaded on demand. */
export class Player {
  private instruments = new Map<string, Promise<Instrument>>();
  private part: Tone.Part | null = null;
  private stopTimer = 0;
  playing = false;
  onEvent: (e: TimedEvent | null) => void = () => {};
  /** Called while a sound downloads (name) and when it is ready/failed (null). */
  onLoading: (soundName: string | null, failed?: boolean) => void = () => {};

  /** Get (loading if needed) the instrument for a sound id. Falls back to a synth offline. */
  load(soundId: string): Promise<Instrument> {
    const def = soundById(soundId);
    let p = this.instruments.get(def.id);
    if (!p) {
      p = this.create(def);
      this.instruments.set(def.id, p);
    }
    return p;
  }

  private async create(def: SoundDef): Promise<Instrument> {
    if (def.synth) return makeSynth(def.synth);
    this.onLoading(def.name);
    const piano = def.id === 'piano';
    const urls = piano ? salamanderUrls() : gmSampleUrls();
    const baseUrl = piano ? 'https://tonejs.github.io/audio/salamander/' : `${GM_BASE}${def.gm}-mp3/`;
    try {
      const sampler = await new Promise<Tone.Sampler>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 15000);
        const s: Tone.Sampler = new Tone.Sampler({
          urls,
          baseUrl,
          release: piano ? 1 : 0.6,
          onload: () => {
            clearTimeout(timer);
            resolve(s);
          },
          onerror: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        }).toDestination();
      });
      sampler.volume.value = piano ? 0 : -4;
      this.onLoading(null);
      return sampler;
    } catch {
      this.instruments.delete(def.id); // retry next time (e.g. once back online)
      this.onLoading(def.name, true);
      return makeSynth('epiano');
    }
  }

  /** Short audition of a note or chord while typing. */
  async preview(pitches: Pitch[], soundId?: string) {
    if (this.playing) return;
    await Tone.start();
    const inst = await this.load(soundId ?? 'piano');
    const names = pitches.map((p) => Tone.Frequency(midiOf(p), 'midi').toNote());
    inst.triggerAttackRelease(names, 0.6, undefined, 0.7);
  }

  async play(score: Score, opts: PlayOptions = {}) {
    this.stop();
    await Tone.start();
    const soundIds = [...score.staves.map((st) => st.sound ?? 'piano'), score.accompaniment?.sound ?? 'piano'];
    const insts = await Promise.all(soundIds.map((id) => this.load(id)));
    const { notes, events, length } = fullTimeline(score);

    // time window: a selection range, or from an event to the end
    let start = 0;
    let end = length;
    if (opts.range?.size) {
      const inRange = events.filter((e) => opts.range!.has(e.id)).sort((a, b) => a.time - b.time);
      if (inRange.length) {
        // first contiguous pass through the selection (a repeat may play it again later)
        start = inRange[0].time;
        end = start;
        for (const e of inRange) {
          if (e.time > end + 1e-4) break;
          end = Math.max(end, e.time + e.dur);
        }
      }
    } else if (opts.fromId) {
      start = events.find((e) => e.id === opts.fromId)?.time ?? 0;
    }
    const barLen = (60 / score.tempo) * (4 / score.timeBeatType) * score.timeBeats;
    const beat = (60 / score.tempo) * (4 / score.timeBeatType);
    const lead = opts.countIn ? barLen : 0;

    const transport = Tone.getTransport();
    transport.cancel();
    transport.position = 0;
    type Item = { time: number } & (
      | { kind: 'n'; note: TimedNote }
      | { kind: 'e'; ev: TimedEvent }
      | { kind: 'c'; accent: boolean }
    );
    const within = (t: number) => t >= start - 1e-6 && t < end - 1e-6;
    const items: Item[] = [
      ...notes.filter((n) => within(n.time)).map<Item>((n) => ({
        time: lead + n.time - start,
        kind: 'n',
        note: { ...n, duration: Math.min(n.duration, end - n.time) },
      })),
      ...events.filter((e) => e.s === 0 && !e.v && within(e.time)).map<Item>((e) => ({ time: lead + e.time - start, kind: 'e', ev: e })),
    ];
    // metronome clicks on every beat of the bars being played (and the count-in bar)
    if (opts.metronome || opts.countIn) {
      const bars = events.filter((e) => e.s === 0 && !e.v && e.i === 0).map((e) => e.time);
      const clicks: Item[] = [];
      if (opts.countIn) {
        for (let b = 0; b < score.timeBeats; b++) clicks.push({ time: b * beat, kind: 'c', accent: b === 0 });
      }
      if (opts.metronome) {
        for (const bt of bars) {
          for (let b = 0; b < score.timeBeats; b++) {
            const t = bt + b * beat;
            if (within(t)) clicks.push({ time: lead + t - start, kind: 'c', accent: b === 0 });
          }
        }
      }
      items.push(...clicks);
    }
    const click = this.metronomeSynth();
    this.part = new Tone.Part<Item>((time, item) => {
      if (item.kind === 'n') {
        const name = Tone.Frequency(item.note.midi, 'midi').toNote();
        insts[item.note.s]?.triggerAttackRelease(name, Math.max(0.05, item.note.duration), time, item.note.velocity);
      } else if (item.kind === 'c') {
        click.triggerAttackRelease(item.accent ? 'C6' : 'G5', 0.03, time, item.accent ? 0.9 : 0.55);
      } else {
        const ev = item.ev;
        Tone.getDraw().schedule(() => this.onEvent(ev), time);
      }
    }, items).start(0);
    this.playing = true;
    if (opts.loop) {
      transport.loop = true;
      transport.loopStart = lead;
      transport.loopEnd = lead + (end - start);
    } else {
      transport.loop = false;
      this.stopTimer = window.setTimeout(() => this.stop(), (lead + end - start + 1.5) * 1000);
    }
    transport.start('+0.05');
  }

  private click: Tone.Synth | null = null;
  private metronomeSynth() {
    if (!this.click) {
      this.click = new Tone.Synth({
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
      }).toDestination();
      this.click.volume.value = -6;
    }
    return this.click;
  }

  stop() {
    clearTimeout(this.stopTimer);
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    transport.loop = false;
    this.part?.dispose();
    this.part = null;
    // cut sustained instruments (organ, strings) immediately
    for (const p of this.instruments.values()) void p.then((i) => i.releaseAll?.());
    if (this.playing) {
      this.playing = false;
      this.onEvent(null);
    }
  }
}

function salamanderUrls(): Record<string, string> {
  const urls: Record<string, string> = {};
  for (let o = 1; o <= 7; o++) for (const n of ['A', 'C', 'D#', 'F#']) urls[`${n}${o}`] = `${n.replace('#', 's')}${o}.mp3`;
  return urls;
}

/** Sounds generated in the browser (no download). */
function makeSynth(kind: NonNullable<SoundDef['synth']>): Instrument {
  let synth: Tone.PolySynth;
  switch (kind) {
    case 'pad':
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fatsawtooth', count: 3, spread: 30 },
        envelope: { attack: 0.4, decay: 0.2, sustain: 0.8, release: 1.5 },
      });
      synth.volume.value = -18;
      break;
    case 'chip':
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'square' },
        envelope: { attack: 0.005, decay: 0.1, sustain: 0.4, release: 0.1 },
      });
      synth.volume.value = -18;
      break;
    case 'bells':
      synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.01,
        modulationIndex: 14,
        envelope: { attack: 0.001, decay: 1.2, sustain: 0, release: 1.2 },
        modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.2 },
      });
      synth.volume.value = -14;
      break;
    default:
      synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 1,
        modulationIndex: 3.5,
        envelope: { attack: 0.005, decay: 0.8, sustain: 0.25, release: 0.8 },
        modulationEnvelope: { attack: 0.005, decay: 0.4, sustain: 0.1, release: 0.4 },
      });
      synth.volume.value = -12;
  }
  synth.maxPolyphony = 48;
  return synth.toDestination();
}
