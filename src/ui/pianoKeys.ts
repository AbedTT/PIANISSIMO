import type { Editor } from '../editor/editor';
import { spellMidi } from '../model/pitch';
import type { DurationType } from '../model/types';

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const STORAGE = 'pianissimo:keys';

/**
 * An on-screen piano for mouse and touch: tap a key to write that note at the cursor,
 * with the most-used length buttons beside it. "Chord" mode collects several keys and
 * writes them together. Works without a computer keyboard (tablets, phones).
 */
export class PianoKeys {
  /** Lowest C shown (MIDI number). */
  private low = 48;
  private drawnSpan = 0;
  /**
   * Octaves shown: as many as fit the screen at a comfortable key width, up to six (C1-B6);
   * one octave of wide keys on a phone. The arrows still reach every octave.
   */
  private span = () => {
    if (window.matchMedia('(max-width: 560px)').matches) return 12;
    const octaves = Math.floor((window.innerWidth - 32) / (7 * 30));
    return 12 * Math.max(2, Math.min(6, octaves));
  };
  private chordMode = false;
  private pending = new Set<number>();
  readonly el: HTMLElement;
  /**
   * Takes played notes before they are written (wait mode uses it). Returning true means the
   * notes were used and nothing is written.
   */
  onNotes: ((midis: number[]) => boolean) | null = null;

  constructor(
    private editor: Editor,
    private announce: (msg: string) => void,
  ) {
    this.el = document.createElement('section');
    this.el.className = 'piano-keys';
    this.el.setAttribute('aria-label', 'On-screen piano keyboard');
    this.el.hidden = true;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
      if (saved && typeof saved.low === 'number') this.low = Math.max(12, Math.min(96, saved.low));
      if (saved?.open) this.el.hidden = false;
    } catch {
      /* ignore */
    }
    this.render();
    editor.subscribe(() => this.syncLengths());
  }

  get open() {
    return !this.el.hidden;
  }

  toggle(force?: boolean) {
    this.el.hidden = force === undefined ? !this.el.hidden : !force;
    this.save();
    return this.open;
  }

  private save() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({ low: this.low, open: this.open }));
    } catch {
      /* ignore */
    }
  }

  private render() {
    const lengths: [DurationType, string, string][] = [
      ['w', '𝅝', 'Whole'],
      ['h', '𝅗𝅥', 'Half'],
      ['q', '♩', 'Quarter'],
      ['8', '♪', 'Eighth'],
      ['16', '𝅘𝅥𝅯', '16th'],
    ];
    const tools = `
      <div class="pk-tools" role="toolbar" aria-label="Note length and actions">
        ${lengths.map(([t, g, n]) => `<button data-len="${t}" aria-label="${n} note" title="${n}">${g}</button>`).join('')}
        <button data-act="dot" aria-label="Dotted" title="Dotted">𝅭.</button>
        <button data-act="rest" aria-label="Rest" title="Rest">𝄽</button>
        <span class="pk-sep"></span>
        <button data-act="left" aria-label="Previous note" title="Previous note">◀</button>
        <button data-act="right" aria-label="Next note" title="Next note">▶</button>
        <button data-act="undo" aria-label="Undo" title="Undo">↶</button>
        <button data-act="delete" aria-label="Delete note" title="Delete">⌫</button>
        <span class="pk-sep"></span>
        <button data-act="chord" aria-pressed="false" title="Chord mode: tap several keys, then Add chord">Chord</button>
        <button data-act="commit" class="primary" hidden>Add chord</button>
        <span class="pk-sep"></span>
        <button data-act="down" aria-label="Octave down" title="Octave down">− 8va</button>
        <span class="pk-range" aria-live="off"></span>
        <button data-act="up" aria-label="Octave up" title="Octave up">+ 8va</button>
        <button data-act="close" class="pk-close" aria-label="Hide keyboard" title="Hide keyboard">✕</button>
      </div>
      <div class="pk-keys"></div>`;
    this.el.innerHTML = tools;
    this.el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
    this.el.querySelectorAll<HTMLButtonElement>('[data-len]').forEach((b) =>
      b.addEventListener('click', () => this.editor.setDuration(b.dataset.len as DurationType)),
    );
    const act = (name: string, fn: () => void) => this.el.querySelector(`[data-act=${name}]`)!.addEventListener('click', fn);
    act('dot', () => this.editor.toggleDot());
    act('rest', () => this.editor.rest());
    act('left', () => this.editor.step(-1));
    act('right', () => this.editor.step(1));
    act('undo', () => this.editor.undo());
    act('delete', () => this.editor.remove());
    act('chord', () => {
      this.chordMode = !this.chordMode;
      this.pending.clear();
      this.drawKeys();
    });
    act('commit', () => this.commitChord());
    act('down', () => this.shift(-12));
    act('up', () => this.shift(12));
    act('close', () => this.toggle(false));
    this.drawKeys();
    this.syncLengths();
    window.addEventListener('resize', () => {
      if (this.span() !== this.drawnSpan) this.drawKeys();
    });
  }

  private shift(by: number) {
    this.low = Math.max(12, Math.min(108 - this.span(), this.low + by));
    this.save();
    this.drawKeys();
  }

  private commitChord() {
    if (!this.pending.size) return;
    if (!this.onNotes?.([...this.pending])) this.editor.writeMidi([...this.pending]);
    this.pending.clear();
    this.drawKeys();
  }

  private press(midi: number) {
    const name = `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
    if (this.chordMode) {
      if (this.pending.has(midi)) this.pending.delete(midi);
      else this.pending.add(midi);
      this.editor.onPreview?.([spellMidi(midi, this.editor.keyAt(this.editor.cursor.m))], this.editor.cursor.s);
      this.drawKeys();
      this.announce(`${name} ${this.pending.has(midi) ? 'added to' : 'removed from'} chord`);
      return;
    }
    if (this.onNotes?.([midi])) {
      this.editor.onPreview?.([spellMidi(midi, this.editor.keyAt(this.editor.cursor.m))], this.editor.cursor.s);
      return;
    }
    this.editor.writeMidi([midi]);
  }

  private drawKeys() {
    const host = this.el.querySelector<HTMLElement>('.pk-keys')!;
    const chordBtn = this.el.querySelector<HTMLButtonElement>('[data-act=chord]')!;
    chordBtn.classList.toggle('active', this.chordMode);
    chordBtn.setAttribute('aria-pressed', String(this.chordMode));
    this.el.querySelector<HTMLElement>('[data-act=commit]')!.hidden = !this.chordMode;
    const span = this.span();
    // when the number of octaves changes, keep the same middle (saved positions were for two octaves)
    const middle = this.low + (this.drawnSpan || 24) / 2;
    if (span !== this.drawnSpan) this.low = Math.round((middle - span / 2) / 12) * 12;
    this.low = Math.max(12, Math.min(108 - span, this.low));
    this.drawnSpan = span;
    this.el.querySelector('.pk-range')!.textContent = `C${this.low / 12 - 1}–B${(this.low + span) / 12 - 2}`;
    const whites: string[] = [];
    const blacks: string[] = [];
    let w = 0;
    for (let midi = this.low; midi < this.low + span; midi++) {
      const pc = midi % 12;
      const label = `${NAMES[pc]}${Math.floor(midi / 12) - 1}`;
      const on = this.pending.has(midi) ? ' on' : '';
      if (WHITE.includes(pc)) {
        whites.push(
          `<button class="pk-white${on}" data-midi="${midi}" aria-label="${label}">${pc === 0 ? `<span>${label}</span>` : ''}</button>`,
        );
        w++;
      } else {
        // a black key sits on the boundary after white key number w
        blacks.push(`<button class="pk-black${on}" data-midi="${midi}" aria-label="${label}" style="left:calc(${w} * var(--pk-w) - var(--pk-bw) / 2)"></button>`);
      }
    }
    host.style.setProperty('--pk-count', String(w));
    this.el.style.setProperty('--pk-n', String(w));
    host.innerHTML = whites.join('') + blacks.join('');
    host.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      // pointerdown reacts instantly on touch screens (no 300 ms click delay)
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.classList.add('down');
        this.press(Number(b.dataset.midi));
      });
      const up = () => b.classList.remove('down');
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
      // keyboard users: Enter/Space on a focused key
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          this.press(Number(b.dataset.midi));
        }
      });
    });
  }

  private syncLengths() {
    this.el.querySelectorAll<HTMLButtonElement>('[data-len]').forEach((b) => {
      const on = b.dataset.len === this.editor.inputType;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const dot = this.el.querySelector<HTMLButtonElement>('[data-act=dot]')!;
    dot.classList.toggle('active', !!this.editor.inputDots);
    dot.setAttribute('aria-pressed', String(!!this.editor.inputDots));
  }
}

