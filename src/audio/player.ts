import * as Tone from 'tone';
import { TPQ } from '../model/duration';
import { midiOf } from '../model/pitch';
import { contexts } from '../model/context';
import { eventTicks, laneOf, MAX_VOICES, playOrder } from '../model/score';
import { isRest, type Dynamic, type Pitch, type Score } from '../model/types';
import { accompanimentNotes } from './accompaniment';
import { drumAt } from '../model/drums';
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
  /** Practice speed: 0.5 = half speed … 1.5 (the written tempo is not changed). */
  tempoScale?: number;
  /** Silent run (the cursor moves, clicks sound, no notes): for recording from the microphone. */
  clicksOnly?: boolean;
}

/** Score notes plus the generated chord accompaniment. */
export function fullTimeline(score: Score) {
  const t = timeline(score);
  const backing = accompanimentNotes(score, t.events, t.length, t.tempos);
  return { ...t, notes: [...t.notes, ...backing].sort((a, b) => a.time - b.time) };
}

export interface TimedNote {
  /** seconds */
  time: number;
  duration: number;
  /** position in ticks along the playback (for MIDI export) */
  tick: number;
  ticks: number;
  midi: number;
  velocity: number;
  /** staff index */
  s: number;
}

export interface TimedEvent {
  time: number;
  /** seconds */
  dur: number;
  tick: number;
  id: string;
  m: number;
  s: number;
  i: number;
  /** voice (0 or 1) */
  v: number;
}

export interface TempoChange {
  tick: number;
  time: number;
  bpm: number;
}

const VELOCITY: Record<Dynamic, number> = {
  ppp: 0.2, pp: 0.3, p: 0.42, mp: 0.55, mf: 0.67, f: 0.8, ff: 0.9, fff: 1, sfz: 1,
};

/** How late a swung off-beat eighth comes, in ticks (from 1/2 to 2/3 of the beat). */
const SWING = TPQ / 6;

/**
 * The mixer applied to timed notes: muted staves (or, when anything is soloed, the staves
 * that are not) are left out, and each staff's volume scales its velocities. The chord
 * accompaniment (staff index = number of staves) has its own volume and is silent while
 * any part is soloed.
 */
export function mixNotes(score: Score, notes: TimedNote[]): TimedNote[] {
  const staves = score.staves;
  const soloing = staves.some((st) => st.solo);
  const gain = (s: number) => {
    if (s >= staves.length) return soloing ? 0 : (score.accompaniment?.volume ?? 1);
    const st = staves[s];
    if (st.mute || (soloing && !st.solo)) return 0;
    return st.volume ?? 1;
  };
  const out: TimedNote[] = [];
  for (const n of notes) {
    const g = gain(n.s);
    if (g > 0) out.push(g === 1 ? n : { ...n, velocity: Math.min(1, n.velocity * g) });
  }
  return out;
}

/** Grace notes are played this long before the beat (seconds), each. */
const GRACE_SECONDS = 0.06;

/**
 * Flatten the score into sounding notes plus per-event times for the cursor.
 * Follows the playback order (repeats, endings, jumps) and every bar's tempo; merges ties;
 * applies dynamics, accents, staccato, hairpins (gradual volume), sustain pedal,
 * 8va/8vb (sounding an octave away) and grace notes.
 */
export function timeline(score: Score): {
  notes: TimedNote[];
  events: TimedEvent[];
  length: number;
  tempos: TempoChange[];
} {
  const notes: TimedNote[] = [];
  const events: TimedEvent[] = [];
  const order = playOrder(score);
  const ctx = contexts(score);
  // swing applies to bars counted in quarter or half notes (not 6/8, 12/8…)
  const swingOn = (m: number) => !!score.swing && ctx[m].beatType <= 4;

  // start time/tick of every bar along the playback, and the tempo map
  const barTime: number[] = [];
  const barTick: number[] = [];
  const tempos: TempoChange[] = [];
  let t = 0;
  let tk = 0;
  for (const m of order) {
    barTime.push(t);
    barTick.push(tk);
    if (!tempos.length || tempos[tempos.length - 1].bpm !== ctx[m].tempo) tempos.push({ tick: tk, time: t, bpm: ctx[m].tempo });
    t += ctx[m].ticks * (60 / (ctx[m].tempo * TPQ));
    tk += ctx[m].ticks;
  }
  const length = t;

  score.staves.forEach((def, s) => {
    // a drum staff sounds General MIDI drum keys: the staff position picks the drum
    const drums = def.clef === 'percussion';
    const soundOf = (p: Pitch, shift: number) => (drums ? drumAt(p).midi : midiOf(p) + shift);
    for (let v = 0; v < MAX_VOICES; v++) {
      if (v && !score.measures.some((mm) => laneOf(mm, s, v))) continue;
      let velocity = VELOCITY.mf;
      let held = new Map<number, TimedNote>(); // midi -> note still sounding because of a tie
      // active lines on this lane
      let hairpin: { kind: 'cresc' | 'dim'; end: string; from: number } | null = null;
      let ottava = 0; // semitone shift while an 8va/8vb is active
      let ottavaEnd: string | null = null;
      let pedalNotes: TimedNote[] | null = null;
      let pedalEnd: string | null = null;

      order.forEach((m, k) => {
        const spt = 60 / (ctx[m].tempo * TPQ);
        const laneEvents = laneOf(score.measures[m], s, v);
        if (!laneEvents) {
          held = new Map(); // no second voice in this bar
          return;
        }
        let off = 0; // ticks into the bar
        laneEvents.forEach((e, i) => {
          const len = eventTicks(e);
          // swing: an off-beat eighth starts a third of the way into its half-beat later (2:1 feel)
          // and the on-beat eighth before it is held that much longer
          let start = off;
          let dur = len;
          if (swingOn(m) && !e.tuplet && len === TPQ / 2) {
            if (off % TPQ === TPQ / 2) {
              start += SWING;
              dur -= SWING;
            } else if (off % TPQ === 0) dur += SWING;
          }
          const time = barTime[k] + start * spt;
          const tick = barTick[k] + start;
          events.push({ time, dur: dur * spt, tick, id: e.id, m, s, i, v });
          if (e.dynamic) velocity = VELOCITY[e.dynamic];
          // lines starting here
          for (const sp of e.spans ?? []) {
            if (sp.kind === 'cresc' || sp.kind === 'dim') hairpin = { kind: sp.kind, end: sp.end, from: velocity };
            else if (sp.kind === 'pedal') {
              pedalNotes = [];
              pedalEnd = sp.end;
            } else {
              ottava = sp.kind === '8va' ? 12 : -12;
              ottavaEnd = sp.end;
            }
          }
          // hairpins move the volume step by step toward the next level
          if (hairpin && !isRest(e)) {
            const step = hairpin.kind === 'cresc' ? 0.05 : -0.05;
            velocity = Math.max(0.15, Math.min(1, velocity + step));
          }
          const nextHeld = new Map<number, TimedNote>();
          if (!isRest(e)) {
            const accent = e.articulations?.includes('accent') || e.articulations?.includes('marcato') ? 0.15 : 0;
            const staccato = e.articulations?.includes('staccato') ? 0.5 : 1;
            // grace notes just before the beat
            (e.graces ?? []).forEach((g, gi, all) => {
              const gTime = Math.max(0, time - (all.length - gi) * GRACE_SECONDS);
              for (const p of g.pitches) {
                notes.push({
                  time: gTime,
                  duration: GRACE_SECONDS,
                  tick: Math.max(0, tick - Math.round((all.length - gi) * GRACE_SECONDS / spt)),
                  ticks: Math.max(1, Math.round(GRACE_SECONDS / spt)),
                  midi: soundOf(p, ottava),
                  velocity: Math.min(1, velocity * 0.85),
                  s,
                });
              }
            });
            // tremolo: the note is played as repeated 8ths, 16ths or 32nds for its whole length
            const tremTicks = e.tremolo ? TPQ / 2 ** e.tremolo : 0;
            const repeats = tremTicks ? Math.max(1, Math.round(len / tremTicks)) : 0;
            for (const p of e.pitches) {
              const midi = soundOf(p, ottava);
              if (repeats) {
                for (let r = 0; r < repeats; r++) {
                  notes.push({
                    time: time + r * tremTicks * spt,
                    duration: tremTicks * spt * 0.9,
                    tick: tick + r * tremTicks,
                    ticks: Math.max(1, Math.round(tremTicks * 0.9)),
                    midi,
                    velocity: Math.min(1, velocity + accent),
                    s,
                  });
                }
                continue;
              }
              let n = held.get(midi);
              if (n) {
                n.duration += dur * spt;
                n.ticks += dur;
              } else {
                n = { time, duration: dur * spt * staccato, tick, ticks: Math.max(1, Math.round(dur * staccato)), midi, velocity: Math.min(1, velocity + accent), s };
                notes.push(n);
                if (pedalNotes) (pedalNotes as TimedNote[]).push(n);
              }
              if (e.tie) nextHeld.set(midi, n);
            }
          }
          held = nextHeld;
          // lines ending here
          if (hairpin && e.id === hairpin.end) hairpin = null;
          if (ottavaEnd && e.id === ottavaEnd) {
            ottava = 0;
            ottavaEnd = null;
          }
          if (pedalNotes && e.id === pedalEnd) {
            // the pedal lifts at the end of this note: everything played under it rings until then
            const lift = time + dur * spt;
            const liftTick = tick + dur;
            for (const n of pedalNotes as TimedNote[]) {
              n.duration = Math.max(n.duration, lift - n.time);
              n.ticks = Math.max(n.ticks, liftTick - n.tick);
            }
            pedalNotes = null;
            pedalEnd = null;
          }
          off += len;
        });
      });
    }
  });
  notes.sort((a, b) => a.time - b.time);
  events.sort((a, b) => a.time - b.time);
  return { notes, events, length, tempos };
}

export type Instrument = {
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
    const midis = soundId === 'drums' ? pitches.map((p) => drumAt(p).midi) : pitches.map(midiOf);
    const names = midis.map((m) => Tone.Frequency(m, 'midi').toNote());
    inst.triggerAttackRelease(names, 0.6, undefined, 0.7);
  }

  /**
   * Start playback. Resolves with when the music (after any count-in) starts, on the
   * performance.now() clock, so a recording can line up played notes with the beat.
   */
  async play(score: Score, opts: PlayOptions = {}): Promise<{ musicStartsAt: number }> {
    this.stop();
    await Tone.start();
    const soundIds = [...score.staves.map((st) => st.sound ?? 'piano'), score.accompaniment?.sound ?? 'piano'];
    const insts = await Promise.all(soundIds.map((id) => this.load(id)));
    this.setReverb(score.reverb ?? 0);
    const full = fullTimeline(score);
    // practice speed: stretch every time in the playback (the score itself keeps its tempo)
    const k = 1 / Math.min(2, Math.max(0.25, opts.tempoScale ?? 1));
    const notes = mixNotes(score, full.notes).map((n) => (k === 1 ? n : { ...n, time: n.time * k, duration: n.duration * k }));
    const events = k === 1 ? full.events : full.events.map((e) => ({ ...e, time: e.time * k, dur: e.dur * k }));
    const length = full.length * k;

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
    // bar starts along the playback with their length and number of beats (meter/tempo can change)
    const ctx = contexts(score);
    const barEvents = events.filter((e) => e.s === 0 && !e.v && e.i === 0);
    const bars = barEvents.map((e, k) => {
      const endTime = barEvents[k + 1]?.time ?? length;
      return { time: e.time, beats: ctx[e.m].beats, beat: (endTime - e.time) / ctx[e.m].beats };
    });
    const firstBar = bars.find((b) => b.time >= start - 1e-6) ?? bars[0];
    const lead = opts.countIn && firstBar ? firstBar.beat * firstBar.beats : 0;

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
      ...notes.filter((n) => !opts.clicksOnly && within(n.time)).map<Item>((n) => ({
        time: lead + n.time - start,
        kind: 'n',
        note: { ...n, duration: Math.min(n.duration, end - n.time) },
      })),
      ...events.filter((e) => e.s === 0 && !e.v && within(e.time)).map<Item>((e) => ({ time: lead + e.time - start, kind: 'e', ev: e })),
    ];
    // metronome clicks on every beat of the bars being played (and the count-in bar)
    if (opts.metronome || opts.countIn) {
      const clicks: Item[] = [];
      if (opts.countIn && firstBar) {
        for (let b = 0; b < firstBar.beats; b++) clicks.push({ time: b * firstBar.beat, kind: 'c', accent: b === 0 });
      }
      if (opts.metronome) {
        for (const bar of bars) {
          for (let b = 0; b < bar.beats; b++) {
            const t = bar.time + b * bar.beat;
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
    return { musicStartsAt: performance.now() + 50 + lead * 1000 };
  }

  private reverb: Tone.Reverb | null = null;

  /** Room reverb on everything that plays (0 = dry). Created the first time it is needed. */
  setReverb(amount: number) {
    if (!this.reverb) {
      if (amount <= 0) return;
      this.reverb = new Tone.Reverb({ decay: 2.8, preDelay: 0.02, wet: 0 });
      Tone.getDestination().chain(this.reverb);
    }
    this.reverb.wet.value = Math.min(1, Math.max(0, amount)) * 0.6;
  }

  /** Sound several notes at once, each with its staff's sound (wait mode). */
  async playChord(notes: { midi: number; sound?: string }[], velocity = 0.75) {
    await Tone.start();
    const bySound = new Map<string, number[]>();
    for (const n of notes) {
      const id = n.sound ?? 'piano';
      if (!bySound.has(id)) bySound.set(id, []);
      bySound.get(id)!.push(n.midi);
    }
    for (const [id, midis] of bySound) {
      const inst = await this.load(id);
      inst.triggerAttackRelease(midis.map((m) => Tone.Frequency(m, 'midi').toNote()), 0.8, undefined, velocity);
    }
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

export function salamanderUrls(): Record<string, string> {
  const urls: Record<string, string> = {};
  for (let o = 1; o <= 7; o++) for (const n of ['A', 'C', 'D#', 'F#']) urls[`${n}${o}`] = `${n.replace('#', 's')}${o}.mp3`;
  return urls;
}

/**
 * A drum kit made of synthesizers (no download): membranes for the kick and toms, filtered
 * noise for the snare and metal for hi-hats and cymbals. Plays General MIDI drum keys.
 */
function makeDrumKit(): Instrument {
  const out = new Tone.Volume(-6).toDestination();
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 6, envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.1 } }).connect(out);
  const tom = new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 2.5, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.2 } }).connect(out);
  const snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 } }).connect(
    new Tone.Filter(1800, 'highpass').connect(out),
  );
  const snareBody = new Tone.MembraneSynth({ octaves: 1.5, envelope: { attack: 0.001, decay: 0.12, sustain: 0 } }).connect(out);
  const hat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.06, release: 0.02 }, harmonicity: 5.1, modulationIndex: 32, resonance: 7000, octaves: 1.5 }).connect(out);
  const cymbal = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 1.2, release: 0.6 }, harmonicity: 5.1, modulationIndex: 40, resonance: 5000, octaves: 1.5 }).connect(out);
  hat.volume.value = -14;
  cymbal.volume.value = -16;
  snareBody.volume.value = -8;
  const TOM_PITCH: Record<number, string> = { 41: 'F2', 43: 'G2', 45: 'A2', 47: 'C3', 48: 'D3', 50: 'E3' };
  return {
    triggerAttackRelease(notes, _duration, time, velocity = 0.8) {
      for (const name of Array.isArray(notes) ? notes : [notes]) {
        const key = Tone.Frequency(name).toMidi();
        if (key === 35 || key === 36) kick.triggerAttackRelease('C1', 0.3, time, velocity);
        else if (key === 37 || key === 38 || key === 40) {
          snare.triggerAttackRelease(0.15, time, velocity);
          snareBody.triggerAttackRelease('G2', 0.1, time, velocity);
        } else if (TOM_PITCH[key]) tom.triggerAttackRelease(TOM_PITCH[key], 0.35, time, velocity);
        else if (key === 42 || key === 44 || key === 46) hat.triggerAttackRelease('C6', key === 46 ? 0.3 : 0.05, time, velocity * 0.8);
        else cymbal.triggerAttackRelease('C6', 1, time, velocity * 0.8);
      }
    },
  };
}

/** Sounds generated in the browser (no download). */
export function makeSynth(kind: NonNullable<SoundDef['synth']>): Instrument {
  if (kind === 'drums') return makeDrumKit();
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
