/**
 * Recordings to notes. A recording (WAV, MP3…) is decoded to mono; for a melody (a voice, a
 * flute, a violin: one note at a time) the pitch is followed frame by frame with the same McLeod
 * method as the microphone, and cut into notes where the pitch changes, the sound stops or a
 * new note is struck. Chords use Basic Pitch instead (see basicPitch.ts). Then the beat is found
 * from when the notes start, the key from which notes are used, and everything is written as a
 * score through the same quantiser as MIDI files.
 */
import { pitchFromNsdf } from './pitchDetect';
import { TPQ } from '../model/duration';
import { tracksToScore, type RawNote } from '../io/midiImport';
import type { Score } from '../model/types';

/** A note heard in a recording; times in seconds. */
export interface AudioNote {
  start: number;
  end: number;
  midi: number;
  /** 0–1 */
  velocity: number;
}

/** The sample rate recordings are analysed at (what Basic Pitch needs too). */
export const ANALYSIS_RATE = 22050;
/** Longer recordings are cut here: this is for songs and exercises, not whole concerts. */
export const MAX_SECONDS = 15 * 60;

/** Decode an audio file to mono samples at ANALYSIS_RATE (the browser does the decoding and resampling). */
export async function decodeAudio(file: Blob): Promise<{ samples: Float32Array; duration: number }> {
  const data = await file.arrayBuffer();
  const probe = new OfflineAudioContext(1, 1, ANALYSIS_RATE);
  let decoded: AudioBuffer;
  try {
    decoded = await probe.decodeAudioData(data);
  } catch {
    throw new Error('This audio file could not be read. Try a WAV or MP3 file.');
  }
  const duration = Math.min(decoded.duration, MAX_SECONDS);
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(duration * ANALYSIS_RATE)), ANALYSIS_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded; // a stereo recording is mixed down to mono by the destination
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return { samples: rendered.getChannelData(0), duration };
}

const tick = () => new Promise<void>((ok) => setTimeout(ok, 0));

/**
 * The notes of a melody: one note at a time. Samples at `rate` (ANALYSIS_RATE normally); they are
 * halved to rate/2 for speed, which still follows pitches from about 55 Hz to 2 kHz.
 */
export async function melodyNotes(samples: Float32Array, rate: number, onProgress?: (fraction: number) => void): Promise<AudioNote[]> {
  // halve the rate (a small low-pass first, so high overtones do not fold down)
  const sr = rate / 2;
  const x = new Float32Array(Math.floor(samples.length / 2));
  for (let i = 0; i < x.length; i++) {
    const j = 2 * i;
    x[i] = 0.25 * (samples[j - 1] ?? samples[j]) + 0.5 * samples[j] + 0.25 * (samples[j + 1] ?? samples[j]);
  }
  const win = 512; // ~46 ms
  const hop = 128; // ~11.6 ms
  const minLag = Math.floor(sr / 2000);
  const maxLag = Math.min(win - 2, Math.ceil(sr / 55));
  const frames = Math.max(0, Math.floor((x.length - win) / hop) + 1);
  const hopSec = hop / sr;

  // loudness of every frame, to tell sound from silence relative to this recording
  const level = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop, end = i + win; i < end; i++) sum += x[i] * x[i];
    level[f] = Math.sqrt(sum / win);
  }
  const sorted = [...level].sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const gate = Math.max(0.003, loud * 0.08);

  // the pitch of every frame (fractional MIDI note), or NaN where there is no clear note
  const pitch = new Float32Array(frames).fill(NaN);
  const nsdf = new Float32Array(maxLag + 2);
  const sq = new Float32Array(win);
  let lastYield = performance.now();
  for (let f = 0; f < frames; f++) {
    if (performance.now() - lastYield > 40) {
      onProgress?.(f / frames);
      await tick();
      lastYield = performance.now();
    }
    if (level[f] < gate) continue;
    const o = f * hop;
    let total = 0;
    for (let i = 0; i < win; i++) {
      sq[i] = x[o + i] * x[o + i];
      total += sq[i];
    }
    // normalised square difference; the energy term shrinks by one sample at each end per lag
    let energy = 2 * total;
    for (let tau = 0; tau <= maxLag + 1; tau++) {
      if (tau > 0) energy -= sq[tau - 1] + sq[win - tau];
      let acf = 0;
      for (let i = 0, n = win - tau; i < n; i++) acf += x[o + i] * x[o + i + tau];
      nsdf[tau] = energy > 0 ? (2 * acf) / energy : 0;
    }
    const p = pitchFromNsdf(nsdf, sr, Math.max(2, minLag), maxLag);
    if (p && p.clarity > 0.8) pitch[f] = 69 + 12 * Math.log2(p.freq / 440);
  }
  onProgress?.(1);
  return segment(pitch, level, gate, hopSec, win / sr / 2);
}

/** Cut the pitch track into notes. Exported for tests. */
export function segment(pitch: Float32Array, level: Float32Array, gate: number, hopSec: number, latency = 0): AudioNote[] {
  const n = pitch.length;
  // a median of five frames removes single-frame octave slips and blips
  const smooth = new Float32Array(n).fill(NaN);
  for (let f = 0; f < n; f++) {
    const around: number[] = [];
    for (let k = f - 2; k <= f + 2; k++) if (k >= 0 && k < n && !Number.isNaN(pitch[k])) around.push(pitch[k]);
    if (around.length >= 3 && !Number.isNaN(pitch[f])) smooth[f] = around.sort((a, b) => a - b)[Math.floor(around.length / 2)];
  }
  let loudest = 1e-9;
  for (const v of level) loudest = Math.max(loudest, v);
  const notes: AudioNote[] = [];
  let cur: { start: number; values: number[]; peak: number; midi: number } | null = null;
  let gap = 0;
  let cand: { midi: number; start: number; count: number } | null = null;
  const finish = (endFrame: number) => {
    if (!cur) return;
    const len = endFrame - cur.start;
    if (len * hopSec >= 0.06) {
      const vals = cur.values.sort((a, b) => a - b);
      notes.push({
        start: Math.max(0, cur.start * hopSec + latency),
        end: endFrame * hopSec + latency,
        midi: Math.round(vals[Math.floor(vals.length / 2)]),
        velocity: Math.min(1, Math.max(0.3, (cur.peak / loudest) * 1.1)),
      });
    }
    cur = null;
  };
  const start = (f: number, m: number) => {
    cur = { start: f, values: [m], peak: level[f], midi: Math.round(m) };
    cand = null;
  };
  for (let f = 0; f < n; f++) {
    const m = smooth[f];
    if (Number.isNaN(m)) {
      cand = null;
      if (cur && ++gap >= 3) {
        finish(f - gap + 1);
        gap = 0;
      }
      continue;
    }
    const c = cur as { start: number; values: number[]; peak: number; midi: number } | null;
    if (!c) {
      gap = 0;
      start(f, m);
      continue;
    }
    gap = 0;
    // a new attack on the same pitch: the sound jumps up after having faded
    const before = Math.min(level[f - 3] ?? Infinity, level[f - 4] ?? Infinity);
    const struck = f - c.start > 8 && level[f] > 1.8 * before && level[f] > 2 * gate;
    if (Math.abs(m - c.midi) < 0.7) {
      cand = null;
      if (struck) {
        finish(f);
        start(f, m);
        continue;
      }
      c.values.push(m);
      c.peak = Math.max(c.peak, level[f]);
      continue;
    }
    // another pitch: it must hold for a few frames (so a slide or vibrato does not split the note)
    const r = Math.round(m);
    if (cand && cand.midi === r) cand.count++;
    else cand = { midi: r, start: f, count: 1 };
    if (cand.count >= 3 || struck) {
      const at = struck ? f : cand.start;
      finish(at);
      start(at, m);
    }
  }
  finish(n);
  return notes;
}

// ------------------------------------------------------------------ beat and key

/** The tempo (quarter notes per minute) and the time of one beat, from when the notes start. */
export function estimateTempo(notes: AudioNote[]): { bpm: number; beat: number } {
  if (notes.length < 4) return { bpm: 100, beat: notes[0]?.start ?? 0 };
  const onsets = notes.map((n) => n.start);
  // longer and louder notes are more likely to fall on beats
  const weights = notes.map((n) => Math.sqrt(Math.min(2, n.end - n.start)) * n.velocity);
  const total = weights.reduce((a, b) => a + b, 0);
  const coherence = (period: number) => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < onsets.length; i++) {
      const a = (2 * Math.PI * onsets[i]) / period;
      re += weights[i] * Math.cos(a);
      im += weights[i] * Math.sin(a);
    }
    return { r: Math.hypot(re, im) / total, phase: Math.atan2(im, re) };
  };
  // beats, eighths and sixteenths all line up at the right tempo; prefer moderate tempos
  const fit = (bpm: number) => {
    const p = 60 / bpm;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 100) / 0.7) ** 2);
    return (coherence(p).r + 0.5 * coherence(p / 2).r + 0.25 * coherence(p / 4).r) * (0.6 + 0.4 * prior);
  };
  let best = 100;
  let bestFit = -1;
  for (let bpm = 50; bpm <= 200; bpm += 0.5) {
    const v = fit(bpm);
    if (v > bestFit) [best, bestFit] = [bpm, v];
  }
  // half, double (or 2/3, 3/2) that tempo fit almost as well: a melody in eighths at 72 is also one in
  // quarters at 144. Take the one where the usual time from note to note is about one beat
  const iois = onsets.slice(1).map((t, i) => t - onsets[i]).filter((d) => d > 0.05).sort((a, b) => a - b);
  const typical = iois[Math.floor(iois.length / 2)] ?? 60 / best;
  const family = [best, best / 2, best * 2, (best * 2) / 3, (best * 3) / 2].filter((b) => b >= 40 && b <= 220);
  const scored = family
    .map((b) => {
      let v = -1;
      let at = b;
      for (let x = b - 0.6; x <= b + 0.6; x += 0.02) {
        const f = fit(x);
        if (f > v) [v, at] = [f, x];
      }
      return { bpm: at, fit: v, beats: typical / (60 / at) };
    })
    .filter((c) => c.fit >= bestFit * 0.8);
  scored.sort((a, b) => Math.abs(Math.log2(a.beats)) - Math.abs(Math.log2(b.beats)));
  best = scored[0]?.bpm ?? best;
  const period = 60 / best;
  const { phase } = coherence(period);
  const beat = (((phase / (2 * Math.PI)) * period) % period + period) % period;
  return { bpm: Math.round(best * 10) / 10, beat };
}

// key profiles of Aarden (from the Essen folk-song collection): good for melodies
const MAJOR = [17.7661, 0.145624, 14.9265, 0.160186, 19.8049, 11.3587, 0.291248, 22.062, 0.145624, 8.15494, 0.232998, 4.95122];
const MINOR = [18.2648, 0.737619, 14.0499, 16.8599, 0.702494, 14.4362, 0.702494, 18.6161, 4.56621, 1.93186, 7.37619, 1.75623];

/** The key signature (−7…7) that suits the notes best (Krumhansl–Schmuckler method, weighted by length). */
export function estimateKey(notes: { midi: number; start: number; end: number }[]): number {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[((n.midi % 12) + 12) % 12] += Math.min(2, n.end - n.start);
  if (!hist.some((v) => v > 0)) return 0;
  const corr = (profile: number[], tonic: number) => {
    const xs = hist.map((_, i) => hist[(i + tonic) % 12]);
    const mx = xs.reduce((a, b) => a + b, 0) / 12;
    const my = profile.reduce((a, b) => a + b, 0) / 12;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < 12; i++) {
      num += (xs[i] - mx) * (profile[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (profile[i] - my) ** 2;
    }
    return dx && dy ? num / Math.sqrt(dx * dy) : 0;
  };
  let bestMajorTonic = 0;
  let best = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    const maj = corr(MAJOR, tonic);
    if (maj > best) [best, bestMajorTonic] = [maj, tonic];
    const min = corr(MINOR, tonic);
    if (min > best) [best, bestMajorTonic] = [min, (tonic + 3) % 12]; // a minor key shares its relative major's signature
  }
  const fifths = (bestMajorTonic * 7) % 12;
  return fifths > 6 ? fifths - 12 : fifths;
}

/**
 * On which beat of its bar the first note falls (1 = it starts the bar; 4 in 4/4 = a one-beat
 * pickup). Accents rarely make this certain, so the first note starts a bar unless the strong
 * notes clearly fall elsewhere; the import dialog lets you change it.
 */
export function estimateFirstBeat(notes: AudioNote[], bpm: number, beat: number, beats: number): number {
  if (notes.length < 8) return 1;
  const period = 60 / bpm;
  const first = Math.floor((notes[0].start - beat) / period + 1 / 8);
  const weight = new Array(beats).fill(0);
  for (const n of notes) {
    const k = Math.round((n.start - beat) / period);
    if (Math.abs(n.start - beat - k * period) > period / 4) continue;
    weight[(((k - first) % beats) + beats) % beats] += n.velocity ** 2 * Math.min(2, n.end - n.start);
  }
  const best = weight.indexOf(Math.max(...weight));
  // bar lines at the strongest beat: the first note is `best` beats before one
  return best !== 0 && weight[best] > 1.5 * weight[0] ? ((beats - best) % beats) + 1 : 1;
}

// ------------------------------------------------------------------ a tempo that changes

/**
 * The time of every beat, for a performance whose tempo drifts (no click track): dynamic
 * programming over how strongly notes start at each moment (after Ellis, "Beat tracking by dynamic
 * programming", 2007). Each beat is placed where notes start, about one beat after the previous
 * one. Unlike Ellis's fixed target tempo, a beat is compared with the beat before it, so the tempo
 * can drift a long way (110 to 70) as long as it changes gradually; a weak pull towards the
 * starting estimate (`bpm`, from estimateTempo) keeps it from jumping to double or half speed.
 */
export function trackBeats(notes: AudioNote[], bpm: number): number[] {
  if (notes.length < 4) return [];
  const fps = 100;
  const end = Math.max(...notes.map((n) => n.end)) + 1;
  const n = Math.ceil(end * fps);
  // how strongly notes start at each 10 ms, a little smoothed
  const raw = new Float64Array(n);
  for (const note of notes) {
    const i = Math.round(note.start * fps);
    if (i >= 0 && i < n) raw[i] += note.velocity * Math.sqrt(Math.min(2, Math.max(0.05, note.end - note.start)));
  }
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (!raw[i]) continue;
    for (let k = -6; k <= 6; k++) if (i + k >= 0 && i + k < n) env[i + k] += raw[i] * Math.exp(-(k * k) / 18);
  }
  let peak = 0;
  for (const v of env) peak = Math.max(peak, v);
  for (let i = 0; i < n; i++) env[i] /= peak || 1;

  const period = (60 / bpm) * fps;
  const local = 8; // cost of changing the beat length from one beat to the next
  const anchor = 0.4; // the weak pull towards the starting tempo
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = 0;
    let from = -1;
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue;
      const gap = t - tau;
      const before = back[tau] >= 0 ? tau - back[tau] : period;
      const v = score[tau] - local * Math.log(gap / before) ** 2 - anchor * Math.log(gap / period) ** 2;
      if (v > best) [best, from] = [v, tau];
    }
    score[t] = env[t] + best;
    back[t] = from;
  }
  // the last beat: the best place near the last note's start
  const last = Math.round(notes[notes.length - 1].start * fps);
  let t = -1;
  for (let i = Math.max(0, last - lo); i < Math.min(n, last + lo); i++) if (t < 0 || score[i] > score[t]) t = i;
  const beats: number[] = [];
  while (t >= 0) {
    beats.push(t / fps);
    t = back[t];
  }
  return beats.reverse();
}

/** How much the beat length changes in a tracked performance: 1 = steady, 1.15 = 15 % between the quick and slow parts. */
export function tempoSpread(beats: number[]): number {
  const periods = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b);
  if (periods.length < 6) return 1;
  return periods[Math.floor(periods.length * 0.9)] / periods[Math.floor(periods.length * 0.1)];
}

/** Halve (ratio 2: twice as many beats) or double (0.5) the beats of a tracked performance. */
export function scaleBeats(beats: number[], ratio: number): number[] {
  if (ratio === 2) return beats.flatMap((b, i) => (i + 1 < beats.length ? [b, (b + beats[i + 1]) / 2] : [b]));
  if (ratio === 0.5) return beats.filter((_, i) => i % 2 === 0);
  return beats;
}

export interface AudioScoreOptions {
  title: string;
  /** Quarter notes per minute. */
  bpm: number;
  /** A time (s) on the beat (from estimateTempo). */
  beat: number;
  /** The beat of its bar the first note falls on (1 = the first). */
  firstBeat: number;
  /**
   * The time of every beat (from trackBeats), for a performance whose tempo changes: notes are
   * placed between the beats around them. Without it the tempo is steady (bpm and beat).
   */
  beatTimes?: number[];
  beats: number;
  beatType: number;
  keyFifths: number;
  sound: string;
  name: string;
}

/** The notes as a score: quantised to 16ths (or triplets), in bars, held notes tidied up. */
export function audioToScore(notes: AudioNote[], o: AudioScoreOptions): Score {
  if (!notes.length) throw new Error('No notes were heard in this recording.');
  const beatSec = 60 / o.bpm; // a quarter note
  // a time as a count of beats: steady, or between the tracked beats of a changing tempo
  const B = o.beatTimes && o.beatTimes.length >= 4 ? o.beatTimes : null;
  const toBeat = (t: number) => {
    if (!B) return (t - o.beat) / beatSec;
    if (t <= B[0]) return (t - B[0]) / (B[1] - B[0]);
    const last = B.length - 1;
    if (t >= B[last]) return last + (t - B[last]) / (B[last] - B[last - 1]);
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (B[mid] <= t) lo = mid;
      else hi = mid;
    }
    return lo + (t - B[lo]) / (B[lo + 1] - B[lo]);
  };
  const unit = 4 / o.beatType; // one beat of the time signature, in quarters
  // the beat the first note is on (a note a little early is still on it), and the bar line before it
  const k = Math.floor(toBeat(notes[0].start) + 1 / 8);
  const origin = k - (Math.max(1, Math.min(o.beats, o.firstBeat)) - 1) * unit;
  const inBeats = (t: number) => toBeat(t) - origin;
  const starts = notes.map((n) => inBeats(n.start));
  const raw: RawNote[] = notes.map((n, i) => {
    const s = starts[i];
    let e = inBeats(n.end);
    // the next note that starts later (in a chord, its other notes start together with this one)
    let next = Infinity;
    for (let j = i + 1; j < notes.length; j++) {
      if (starts[j] > s + 0.15) {
        next = starts[j];
        break;
      }
    }
    if (next - e < Math.max(0.3, 0.35 * (next - s))) e = next; // detached playing: the note lasts until the next one
    else {
      // before a real rest: long notes end on a whole or half beat (a note held 90 % of a half note is a half note)
      const grid = e - s >= 1.5 ? 1 : e - s >= 0.75 ? 0.5 : 0.25;
      e = Math.max(s + 0.25, Math.round(e / grid) * grid);
    }
    return { start: Math.max(0, Math.round(s * TPQ)), end: Math.round(e * TPQ), midi: n.midi, velocity: n.velocity };
  });
  return tracksToScore(
    {
      tracks: [{ name: o.name, channel: 0, program: 0, notes: raw, sound: o.sound }],
      bpm: Math.round(o.bpm),
      beats: o.beats,
      beatType: o.beatType,
      key: o.keyFifths,
    },
    o.title,
  );
}
