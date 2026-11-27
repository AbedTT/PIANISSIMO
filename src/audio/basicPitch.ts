/*
 * Chords from recordings: Spotify's Basic Pitch model hears several notes at once (piano, guitar…).
 *
 * The model (public/vendor/basic-pitch) runs on TensorFlow.js (public/vendor/tfjs), both loaded
 * only when needed, from this site, so nothing is sent anywhere. The code below that cuts the
 * recording into windows for the model and turns its output into notes is ported from Basic
 * Pitch's src/inference.ts and src/toMidi.ts (version 1.0.1):
 *
 *   Copyright 2022 Spotify AB
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 *
 * Changes: windows are cut in plain JavaScript and every tensor is freed; the "melodia trick"
 * finds the loudest remaining energy from a sorted list instead of searching the whole matrix
 * each time (same result, much faster on long recordings); pitch bends are not computed.
 */
import type { AudioNote } from './transcribe';

// ------------------------------------------------------------------ the parts of TensorFlow.js we use
interface Tensor {
  readonly shape: number[];
  array(): Promise<number[][][]>;
  dispose(): void;
}
interface GraphModel {
  execute(input: Tensor, outputs: string[]): Tensor[];
}
interface TF {
  ready(): Promise<void>;
  loadGraphModel(url: string): Promise<GraphModel>;
  tensor3d(values: Float32Array, shape: [number, number, number]): Tensor;
}

const base = () => new URL(`${import.meta.env.BASE_URL}vendor/`, location.href).href;
let loaded: Promise<{ tf: TF; model: GraphModel }> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => fail(new Error('The chord listener could not be loaded. Check your connection and try again.'));
    document.head.appendChild(s);
  });
}

/** TensorFlow.js and the model, loaded once. */
function load() {
  return (loaded ??= (async () => {
    const w = window as unknown as { tf?: TF };
    if (!w.tf) await loadScript(`${base()}tfjs/tf.es2017.min.js`);
    const tf = w.tf;
    if (typeof tf?.ready !== 'function') throw new Error('The chord listener could not be loaded. Check your connection and try again.');
    await tf.ready();
    const model = await tf.loadGraphModel(`${base()}basic-pitch/model.json`);
    return { tf, model };
  })().catch((err) => {
    loaded = null;
    throw err;
  }));
}

// ------------------------------------------------------------------ constants (basic_pitch/constants.py)
const AUDIO_SAMPLE_RATE = 22050;
const FFT_HOP = 256;
const ANNOTATIONS_FPS = Math.floor(AUDIO_SAMPLE_RATE / FFT_HOP);
const AUDIO_WINDOW_LENGTH = 2;
const AUDIO_N_SAMPLES = AUDIO_SAMPLE_RATE * AUDIO_WINDOW_LENGTH - FFT_HOP;
const N_OVERLAPPING_FRAMES = 30;
const N_OVERLAP_OVER_2 = Math.floor(N_OVERLAPPING_FRAMES / 2);
const OVERLAP_LENGTH_FRAMES = N_OVERLAPPING_FRAMES * FFT_HOP;
const HOP_SIZE = AUDIO_N_SAMPLES - OVERLAP_LENGTH_FRAMES;
const ANNOT_N_FRAMES = ANNOTATIONS_FPS * AUDIO_WINDOW_LENGTH;
const WINDOW_OFFSET = (FFT_HOP / AUDIO_SAMPLE_RATE) * (ANNOT_N_FRAMES - AUDIO_N_SAMPLES / FFT_HOP) + 0.0018;
const MIDI_OFFSET = 21;
const MAX_FREQ_IDX = 87;
const OUTPUTS = { frames: 'Identity_1', onsets: 'Identity_2', contours: 'Identity' };

const tick = () => new Promise<void>((ok) => setTimeout(ok, 0));

/**
 * Run the model over the whole recording (mono, 22050 Hz): for every frame (11.6 ms) and every
 * piano key, how likely that key sounds (frames) and starts (onsets).
 */
async function evaluate(samples: Float32Array, onProgress?: (f: number) => void, cancelled?: () => boolean) {
  const { tf, model } = await load();
  const padded = new Float32Array(Math.floor(OVERLAP_LENGTH_FRAMES / 2) + samples.length);
  padded.set(samples, Math.floor(OVERLAP_LENGTH_FRAMES / 2));
  const starts: number[] = [];
  for (let start = 0; start < padded.length; start += HOP_SIZE) starts.push(start);
  const wanted = Math.floor(samples.length * (ANNOTATIONS_FPS / AUDIO_SAMPLE_RATE));
  const frames: number[][] = [];
  const onsets: number[][] = [];
  for (let w = 0; w < starts.length && frames.length < wanted; w++) {
    if (cancelled?.()) throw new Error('Cancelled');
    onProgress?.(w / starts.length);
    const window = new Float32Array(AUDIO_N_SAMPLES); // the last one is padded with silence
    window.set(padded.subarray(starts[w], starts[w] + AUDIO_N_SAMPLES));
    const input = tf.tensor3d(window, [1, AUDIO_N_SAMPLES, 1]);
    const [f, o] = model.execute(input, [OUTPUTS.frames, OUTPUTS.onsets]);
    input.dispose();
    const [fa, oa] = await Promise.all([f.array(), o.array()]);
    f.dispose();
    o.dispose();
    // drop the overlapping frames at both ends of the window
    const rows = fa[0].length;
    for (let r = N_OVERLAP_OVER_2; r < rows - N_OVERLAP_OVER_2 && frames.length < wanted; r++) {
      frames.push(fa[0][r]);
      onsets.push(oa[0][r]);
    }
    await tick();
  }
  onProgress?.(1);
  return { frames, onsets };
}

// ------------------------------------------------------------------ model output to notes (toMidi.ts)
interface NoteEvent {
  startFrame: number;
  durationFrames: number;
  pitchMidi: number;
  amplitude: number;
}

const modelFrameToTime = (frame: number) => (frame * FFT_HOP) / AUDIO_SAMPLE_RATE - WINDOW_OFFSET * Math.floor(frame / ANNOT_N_FRAMES);

/** Onsets also where a key's frame activation jumps up (getInferredOnsets, nDiff = 2). */
function inferredOnsets(onsets: number[][], frames: number[][]): number[][] {
  const n = frames.length;
  const keys = frames[0]?.length ?? 0;
  const diff = frames.map(() => new Array<number>(keys).fill(0));
  let diffMax = 0;
  let onsetMax = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < keys; c++) {
      onsetMax = Math.max(onsetMax, onsets[r][c]);
      if (r < 2) continue;
      const d = Math.max(0, Math.min(frames[r][c] - frames[r - 1][c], frames[r][c] - frames[r - 2][c]));
      diff[r][c] = d;
      diffMax = Math.max(diffMax, d);
    }
  }
  return onsets.map((row, r) => row.map((v, c) => Math.max(v, diffMax > 0 ? (onsetMax * diff[r][c]) / diffMax : 0)));
}

/** Notes from the model's frame and onset activations (outputToNotesPoly). */
export function outputToNotes(
  frames: number[][],
  onsetsIn: number[][],
  onsetThresh = 0.5,
  frameThresh = 0.3,
  minNoteLen = 5,
  energyTolerance = 11,
): NoteEvent[] {
  const nFrames = frames.length;
  if (!nFrames) return [];
  const keys = frames[0].length;
  const onsets = inferredOnsets(onsetsIn, frames);

  // peaks of the onset activation in time (argrelmax, order 1) above the threshold, last first
  const starts: [number, number][] = [];
  for (let r = 0; r < nFrames; r++) {
    for (let c = 0; c < keys; c++) {
      const v = onsets[r][c];
      if (v <= onsetThresh) continue;
      if ((r > 0 && !(v > onsets[r - 1][c])) || (r < nFrames - 1 && !(v > onsets[r + 1][c]))) continue;
      starts.push([r, c]);
    }
  }
  starts.reverse();

  const remaining = frames.map((row) => row.slice());
  const clear = (i: number, c: number) => {
    remaining[i][c] = 0;
    if (c < MAX_FREQ_IDX) remaining[i][c + 1] = 0;
    if (c > 0) remaining[i][c - 1] = 0;
  };
  const meanOf = (from: number, to: number, c: number) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += frames[i][c];
    return sum / Math.max(1, to - from);
  };
  const notes: NoteEvent[] = [];
  for (const [start, c] of starts) {
    if (start >= nFrames - 1) continue;
    // where this key's energy stays below the threshold for a while
    let i = start + 1;
    let k = 0;
    while (i < nFrames - 1 && k < energyTolerance) {
      k = remaining[i][c] < frameThresh ? k + 1 : 0;
      i++;
    }
    i -= k;
    if (i - start <= minNoteLen) continue;
    for (let j = start; j < i; j++) clear(j, c);
    notes.push({ startFrame: start, durationFrames: i - start, pitchMidi: c + MIDI_OFFSET, amplitude: meanOf(start, i, c) });
  }

  // "melodia trick": notes that sound without a clear onset, from the loudest energy left down
  const candidates: [number, number, number][] = [];
  for (let r = 0; r < nFrames; r++) for (let c = 0; c < keys; c++) if (remaining[r][c] > frameThresh) candidates.push([remaining[r][c], r, c]);
  candidates.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  for (const [, iMid, c] of candidates) {
    if (!(remaining[iMid][c] > frameThresh)) continue; // used up by an earlier note
    remaining[iMid][c] = 0;
    let i = iMid + 1;
    let k = 0;
    while (i < nFrames - 1 && k < energyTolerance) {
      k = remaining[i][c] < frameThresh ? k + 1 : 0;
      clear(i, c);
      i++;
    }
    const iEnd = i - 1 - k;
    i = iMid - 1;
    k = 0;
    while (i > 0 && k < energyTolerance) {
      k = remaining[i][c] < frameThresh ? k + 1 : 0;
      clear(i, c);
      i--;
    }
    const iStart = i + 1 + k;
    if (iEnd - iStart <= minNoteLen) continue;
    notes.push({ startFrame: iStart, durationFrames: iEnd - iStart, pitchMidi: c + MIDI_OFFSET, amplitude: meanOf(iStart, iEnd, c) });
  }
  return notes;
}

/** Notes of a recording with chords (mono samples at 22050 Hz). */
export async function chordNotes(
  samples: Float32Array,
  rate: number,
  onProgress?: (fraction: number) => void,
  cancelled?: () => boolean,
): Promise<AudioNote[]> {
  if (rate !== AUDIO_SAMPLE_RATE) throw new Error('Basic Pitch needs audio at 22050 Hz');
  const { frames, onsets } = await evaluate(samples, onProgress, cancelled);
  // a little longer than Basic Pitch's default shortest note (58 ms): a score wants fewer fragments
  return outputToNotes(frames, onsets, 0.5, 0.3, 8)
    .map((n) => ({
      start: Math.max(0, modelFrameToTime(n.startFrame)),
      end: modelFrameToTime(n.startFrame + n.durationFrames),
      midi: n.pitchMidi,
      velocity: Math.min(1, Math.max(0.3, n.amplitude * 1.2)),
    }))
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
}
