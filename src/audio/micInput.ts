import { detectPitch, freqToMidi, rms, type PitchFrame } from './pitchDetect';

export interface MicFrame extends PitchFrame {
  freq: number | null;
}

/**
 * Microphone input: about 50 times a second, the latest 1024 samples are checked for a clear
 * pitch. Browser processing that would bend the pitch (echo cancellation, noise suppression,
 * automatic gain) is turned off.
 */
export class MicInput {
  active = false;
  onFrame: (f: MicFrame) => void = () => {};
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private timer = 0;
  private buf = new Float32Array(1024);

  static get supported() {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  async start() {
    if (this.active) return;
    if (!MicInput.supported) throw new Error('This browser cannot use the microphone.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = this.buf.length;
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    this.active = true;
    this.timer = window.setInterval(() => this.tick(), 20);
  }

  private tick() {
    if (!this.analyser || !this.ctx) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    const level = rms(this.buf);
    // quiet input is silence; otherwise a clear, periodic sound is a note
    const p = level > 0.01 ? detectPitch(this.buf, this.ctx.sampleRate) : null;
    const clear = !!p && p.clarity > 0.85;
    this.onFrame({ t: performance.now(), midi: clear ? freqToMidi(p!.freq) : null, freq: clear ? p!.freq : null, rms: level });
  }

  stop() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.active = false;
  }
}
