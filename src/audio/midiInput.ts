/**
 * MIDI keyboard input through the Web MIDI API (Chrome, Edge, Opera; not Safari/Firefox by default).
 * Keys pressed within a short window become one chord.
 */
export class MidiInput {
  enabled = false;
  devices: string[] = [];
  /** Receives one chord (sorted MIDI note numbers) per key-press group. */
  onChord: (notes: number[]) => void = () => {};
  onChange: () => void = () => {};

  private access: MIDIAccess | null = null;
  private pending: number[] = [];
  private timer = 0;
  private static readonly CHORD_WINDOW_MS = 60;

  static get supported() {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  async enable(): Promise<void> {
    if (!MidiInput.supported) throw new Error('This browser has no Web MIDI support (use Chrome or Edge).');
    this.access ??= await navigator.requestMIDIAccess();
    this.access.onstatechange = () => this.attach();
    this.enabled = true;
    this.attach();
  }

  disable() {
    this.enabled = false;
    this.access?.inputs.forEach((input) => (input.onmidimessage = null));
    this.devices = [];
    this.onChange();
  }

  private attach() {
    if (!this.access || !this.enabled) return;
    this.devices = [];
    this.access.inputs.forEach((input) => {
      if (input.state !== 'connected') return;
      this.devices.push(input.name ?? 'MIDI device');
      input.onmidimessage = (msg) => this.handle(msg.data);
    });
    this.onChange();
  }

  private handle(data: Uint8Array | null) {
    if (!data || data.length < 3) return;
    const command = data[0] & 0xf0;
    const note = data[1];
    const velocity = data[2];
    if (command !== 0x90 || velocity === 0) return; // note-on only (velocity 0 = note-off)
    this.pending.push(note);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      const chord = [...new Set(this.pending)].sort((a, b) => a - b);
      this.pending = [];
      this.onChord(chord);
    }, MidiInput.CHORD_WINDOW_MS);
  }
}
