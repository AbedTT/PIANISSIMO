/**
 * Pitch from the microphone: the McLeod pitch method (normalised square difference). It finds
 * the period of a voice or a single-line instrument and is not fooled by strong overtones, so
 * a sung A3 is not read as A4. Plus a note tracker that turns the stream of pitches into notes.
 */

export interface Pitched {
  /** Hz */
  freq: number;
  /** 0–1: how periodic the sound is (above about 0.85 is a clear note). */
  clarity: number;
}

/** Fundamental frequency of one window of samples, or null when nothing periodic is found. */
export function detectPitch(buf: Float32Array, sampleRate: number, minFreq = 70, maxFreq = 1400): Pitched | null {
  const n = buf.length;
  const maxLag = Math.min(n - 2, Math.floor(sampleRate / minFreq));
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
  const nsdf = new Float32Array(maxLag + 2);
  for (let tau = 0; tau <= maxLag + 1; tau++) {
    let acf = 0;
    let energy = 0;
    for (let i = 0; i < n - tau; i++) {
      const a = buf[i];
      const b = buf[i + tau];
      acf += a * b;
      energy += a * a + b * b;
    }
    nsdf[tau] = energy > 0 ? (2 * acf) / energy : 0;
  }
  // the highest point of each positive lobe after the first zero crossing
  const peaks: number[] = [];
  let tau = 1;
  while (tau <= maxLag && nsdf[tau] > 0) tau++;
  while (tau <= maxLag) {
    while (tau <= maxLag && nsdf[tau] <= 0) tau++;
    let best = -1;
    while (tau <= maxLag && nsdf[tau] > 0) {
      if (best < 0 || nsdf[tau] > nsdf[best]) best = tau;
      tau++;
    }
    if (best >= minLag) peaks.push(best);
  }
  if (!peaks.length) return null;
  const top = Math.max(...peaks.map((p) => nsdf[p]));
  // the first peak close to the highest one is the period (later ones are its multiples)
  const pick = peaks.find((p) => nsdf[p] >= 0.9 * top)!;
  const a = nsdf[pick - 1];
  const b = nsdf[pick];
  const c = nsdf[pick + 1];
  const denom = a - 2 * b + c;
  const shift = denom ? (a - c) / (2 * denom) : 0;
  return { freq: sampleRate / (pick + (Math.abs(shift) < 1 ? shift : 0)), clarity: b };
}

/** Loudness (root mean square) of a window. */
export function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

export const freqToMidi = (freq: number) => 69 + 12 * Math.log2(freq / 440);

export interface PitchFrame {
  /** milliseconds */
  t: number;
  /** fractional MIDI note, or null for silence / no clear pitch */
  midi: number | null;
  rms: number;
}

export interface HeardNote {
  /** milliseconds */
  start: number;
  end: number;
  midi: number;
  /** 0–1 from the loudest moment */
  velocity: number;
}

/**
 * Turns pitch frames into notes. A note starts after a few frames on the same semitone, ends
 * when it goes quiet or another pitch holds for a few frames (so vibrato and a scoop into a
 * note do not split it), and very short blips are dropped.
 */
export class NoteTracker {
  readonly notes: HeardNote[] = [];
  /** Called as soon as a note is recognised (wait mode listens for this). */
  onStart: ((midi: number, t: number) => void) | null = null;
  private current: { midi: number; start: number; peak: number } | null = null;
  private candidate: { midi: number; since: number; count: number } | null = null;
  private silentSince: number | null = null;
  private silentFrames = 0;

  constructor(
    private opts = { stableFrames: 3, silentFrames: 3, minMs: 70 },
  ) {}

  push(f: PitchFrame) {
    const m = f.midi === null ? null : Math.round(f.midi);
    if (m === null) {
      this.candidate = null;
      if (this.current) {
        if (this.silentFrames === 0) this.silentSince = f.t;
        if (++this.silentFrames >= this.opts.silentFrames) this.end(this.silentSince!);
      }
      return;
    }
    if (this.current && m === this.current.midi) {
      this.silentFrames = 0;
      this.candidate = null;
      this.current.peak = Math.max(this.current.peak, f.rms);
      return;
    }
    this.silentFrames = 0;
    if (this.candidate?.midi === m) this.candidate.count++;
    else this.candidate = { midi: m, since: f.t, count: 1 };
    if (this.candidate.count >= this.opts.stableFrames) {
      if (this.current) this.end(this.candidate.since);
      this.current = { midi: m, start: this.candidate.since, peak: f.rms };
      this.candidate = null;
      this.onStart?.(m, this.current.start);
    }
  }

  /** Finish the note still sounding (when recording stops). */
  flush(t: number) {
    if (this.current) this.end(this.silentFrames ? this.silentSince! : t);
  }

  private end(t: number) {
    const c = this.current!;
    this.current = null;
    this.silentFrames = 0;
    if (t - c.start >= this.opts.minMs) {
      this.notes.push({ start: c.start, end: t, midi: c.midi, velocity: Math.min(1, Math.max(0.3, c.peak * 4)) });
    }
  }
}
