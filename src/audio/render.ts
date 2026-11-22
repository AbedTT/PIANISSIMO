import * as Tone from 'tone';
import { fullTimeline, makeSynth, salamanderUrls, type Instrument } from './player';
import { GM_BASE, gmSampleUrls, soundById } from './sounds';
import type { Score } from '../model/types';

const SAMPLE_RATE = 44100;

/** How long to wait for sampled instruments before falling back to built-in synths. */
const LOAD_TIMEOUT_MS = 20000;

/**
 * Render the whole score (with repeats, jumps and the chord accompaniment) to audio,
 * offline and faster than real time, with the same instrument sounds as playback.
 * If the sampled sounds cannot be downloaded in time, built-in synths are used instead
 * (so the export always finishes) and `onFallback` is called.
 */
export async function renderAudio(score: Score, onFallback?: () => void): Promise<AudioBuffer> {
  const { notes, length } = fullTimeline(score);
  const soundIds = [...score.staves.map((st) => st.sound ?? 'piano'), score.accompaniment?.sound ?? 'piano'];
  const used = new Set(notes.map((n) => n.s)); // only load the instruments that actually play
  const lead = 0.05;
  const tail = 2.5; // let the last notes ring out
  const buffer = await Tone.Offline(async () => {
    const insts: (Instrument | undefined)[] = soundIds.map((id, k) => {
      if (!used.has(k)) return undefined;
      const def = soundById(id);
      if (def.synth) return makeSynth(def.synth);
      const piano = def.id === 'piano';
      const sampler = new Tone.Sampler({
        urls: piano ? salamanderUrls() : gmSampleUrls(),
        baseUrl: piano ? 'https://tonejs.github.io/audio/salamander/' : `${GM_BASE}${def.gm}-mp3/`,
        release: piano ? 1 : 0.6,
      }).toDestination();
      sampler.volume.value = piano ? 0 : -4;
      return sampler;
    });
    let timer = 0;
    const loaded = await Promise.race([
      Tone.loaded().then(() => true, () => false),
      new Promise<boolean>((resolve) => (timer = window.setTimeout(() => resolve(false), LOAD_TIMEOUT_MS))),
    ]);
    clearTimeout(timer);
    if (!loaded) {
      // slow or no connection: swap every sampled instrument for a synth so the render completes
      insts.forEach((inst, k) => {
        if (inst instanceof Tone.Sampler) {
          inst.dispose();
          insts[k] = makeSynth('epiano');
        }
      });
      onFallback?.();
    }
    for (const n of notes) {
      insts[n.s]?.triggerAttackRelease(
        Tone.Frequency(n.midi, 'midi').toNote(),
        Math.max(0.05, n.duration),
        lead + n.time,
        n.velocity,
      );
    }
  }, length + lead + tail, 2, SAMPLE_RATE);
  const audio = buffer.get();
  if (!audio) throw new Error('Rendering produced no audio.');
  return audio;
}

/** 16-bit PCM WAV file from an AudioBuffer. */
export function encodeWav(audio: AudioBuffer): Blob {
  const channels = audio.numberOfChannels;
  const frames = audio.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  const data = Array.from({ length: channels }, (_, c) => audio.getChannelData(c));
  // normalise softly so loud scores do not clip
  let peak = 0;
  for (const ch of data) for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(ch[i]));
  const gain = peak > 0.98 ? 0.98 / peak : 1;
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i] * gain));
      view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}
