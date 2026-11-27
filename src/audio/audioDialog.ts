import { soundById } from './sounds';
import { KEY_NAMES } from '../model/pitch';
import type { Score } from '../model/types';
import { t, translatePage } from '../ui/i18n';
import {
  ANALYSIS_RATE,
  MAX_SECONDS,
  audioToScore,
  decodeAudio,
  estimateFirstBeat,
  estimateKey,
  estimateTempo,
  melodyNotes,
  type AudioNote,
} from './transcribe';

const AUDIO_EXT = /\.(wav|wave|mp3|ogg|oga|opus|m4a|aac|flac|webm|weba)$/i;
export const isAudioFile = (file: File) => AUDIO_EXT.test(file.name) || file.type.startsWith('audio/');

const MELODY_SOUNDS = ['choir', 'flute', 'violin', 'clarinet', 'oboe', 'alto_sax', 'trumpet', 'french_horn', 'trombone', 'cello', 'guitar_nylon', 'piano'];
const CHORD_SOUNDS = ['piano', 'guitar_nylon', 'guitar_steel', 'electric_piano', 'harp', 'church_organ', 'strings', 'marimba'];
const TIMES = ['4/4', '3/4', '2/4', '2/2', '6/8', '9/8', '12/8'];
const NAMES: Record<string, string> = { choir: 'Voice' };
const MINOR: Record<number, string> = { [-7]: 'Ab', [-6]: 'Eb', [-5]: 'Bb', [-4]: 'F', [-3]: 'C', [-2]: 'G', [-1]: 'D', 0: 'A', 1: 'E', 2: 'B', 3: 'F#', 4: 'C#', 5: 'G#', 6: 'D#', 7: 'A#' };

type Mode = 'melody' | 'chords';

/**
 * "Turn an audio recording into notes": choose a WAV, MP3… of a melody (one note at a time), or of
 * chords (piano, guitar), check the tempo, time signature, key and instrument it found, and get an
 * editable score. Everything happens in this browser; the recording is not uploaded.
 */
export class AudioDialog {
  readonly el: HTMLElement;
  private notes: AudioNote[] = [];
  private beat = 0;
  /** The tempo found, unrounded (100 shown for 99.6 would drift by a beat over a few minutes). */
  private bpm = 100;
  private fileName = '';
  private cancelled = false;

  constructor(
    private opts: {
      show: (el: HTMLElement) => void;
      hide: () => void;
      onScore: (score: Score) => void;
    },
  ) {
    this.el = document.createElement('div');
    this.el.className = 'modal';
    this.el.id = 'audioModal';
    this.el.hidden = true;
    const keyOptions = Array.from({ length: 15 }, (_, i) => i - 7)
      .map((f) => `<option value="${f}">${KEY_NAMES[f]} / ${MINOR[f]}m (${f === 0 ? '–' : `${Math.abs(f)} ${f > 0 ? '♯' : '♭'}`})</option>`)
      .join('');
    this.el.innerHTML = `
      <div class="modal-card scan-card" role="dialog" aria-labelledby="audioTitle">
        <header><h2 id="audioTitle">Turn a recording into notes</h2><button class="close" data-close>✕</button></header>
        <div data-step="pick">
          <fieldset class="audio-mode">
            <legend>What is in the recording?</legend>
            <label><input type="radio" name="audioMode" value="melody" checked /> <span>One melody</span></label>
            <small>A voice, a flute, a violin, a whistle… one note at a time.</small>
            <label><input type="radio" name="audioMode" value="chords" /> <span>Chords or several notes at once</span></label>
            <small>Piano or guitar. Takes longer, and gives a draft to tidy up.</small>
          </fieldset>
          <label class="drop-zone" tabindex="0">
            <input type="file" accept="audio/*,.wav,.mp3,.ogg,.m4a,.flac,.webm" hidden />
            <span class="drop-icon" aria-hidden="true">🎧</span>
            <b>Choose a recording…</b>
            <span>WAV, MP3, M4A, OGG or FLAC, or drop it here</span>
          </label>
          <p class="form-error" data-error hidden></p>
          <ul class="scan-tips">
            <li>Best results: one instrument or voice, little background noise and echo, a steady tempo.</li>
            <li>The recording stays on this computer: it is not uploaded.</li>
          </ul>
        </div>
        <div data-step="busy" hidden>
          <div class="scan-busy"><span class="spinner" aria-hidden="true"></span><b data-busy>Listening…</b></div>
          <progress max="1" value="0"></progress>
          <div class="form-actions"><button type="button" data-act="cancel">Cancel</button></div>
        </div>
        <form data-step="review" class="new-form" hidden>
          <p class="audio-found" data-found></p>
          <label>Title <input name="title" /></label>
          <label>Instrument <select name="sound"></select></label>
          <label>Tempo <input name="bpm" type="number" min="30" max="300" step="1" /></label>
          <label>Time <select name="time">${TIMES.map((x) => `<option>${x}</option>`).join('')}</select></label>
          <label>First note on beat <select name="firstBeat"></select></label>
          <label>Key <select name="key">${keyOptions}</select></label>
          <p class="hint">If the notes come out twice too long or too short, halve or double the tempo.</p>
          <div class="form-actions">
            <button type="button" data-act="back">← Another recording</button>
            <button type="submit" class="primary">Write the score</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(this.el);
    translatePage(this.el);

    const input = this.el.querySelector<HTMLInputElement>('input[type=file]')!;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) void this.read(file);
    });
    const zone = this.el.querySelector<HTMLElement>('.drop-zone')!;
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('over');
      const file = e.dataTransfer?.files[0];
      if (file) void this.read(file);
    });
    this.el.querySelector('[data-act=cancel]')!.addEventListener('click', () => {
      this.cancelled = true;
      this.step('pick');
    });
    this.el.querySelector('[data-close]')!.addEventListener('click', () => (this.cancelled = true));
    this.el.querySelector('[data-act=back]')!.addEventListener('click', () => this.step('pick'));
    const form = this.form;
    form.time.addEventListener('change', () => this.fillBeats(1));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.write();
    });
  }

  private get form() {
    return this.el.querySelector('form') as HTMLFormElement & {
      title: HTMLInputElement;
      sound: HTMLSelectElement;
      bpm: HTMLInputElement;
      time: HTMLSelectElement;
      firstBeat: HTMLSelectElement;
      key: HTMLSelectElement;
    };
  }

  private get mode(): Mode {
    return (this.el.querySelector<HTMLInputElement>('input[name=audioMode]:checked')?.value as Mode) ?? 'melody';
  }

  open(file?: File) {
    this.opts.show(this.el);
    this.step('pick');
    this.error('');
    if (file) void this.read(file);
    else (this.el.querySelector('.drop-zone') as HTMLElement).focus();
  }

  private step(name: 'pick' | 'busy' | 'review') {
    this.el.querySelectorAll<HTMLElement>('[data-step]').forEach((s) => (s.hidden = s.dataset.step !== name));
  }

  private error(msg: string) {
    const p = this.el.querySelector<HTMLElement>('[data-error]')!;
    p.textContent = msg;
    p.hidden = !msg;
  }

  private progress(label: string, value: number) {
    this.el.querySelector('[data-busy]')!.textContent = t(label);
    (this.el.querySelector('progress') as HTMLProgressElement).value = value;
  }

  private async read(file: File) {
    if (!isAudioFile(file)) {
      this.step('pick');
      this.error(t('Choose an audio file: WAV, MP3, M4A, OGG or FLAC.'));
      return;
    }
    const mode = this.mode;
    this.cancelled = false;
    this.error('');
    this.step('busy');
    this.progress('Reading the recording…', 0);
    try {
      const { samples, duration } = await decodeAudio(file);
      if (this.cancelled) return;
      let notes: AudioNote[];
      if (mode === 'chords') {
        this.progress('Loading the chord listener…', 0);
        const { chordNotes } = await import('./basicPitch');
        notes = await chordNotes(samples, ANALYSIS_RATE, (f) => this.progress('Listening for chords…', f), () => this.cancelled);
      } else {
        notes = await melodyNotes(samples, ANALYSIS_RATE, (f) => this.progress('Listening…', f));
      }
      if (this.cancelled) return;
      if (!notes.length) throw new Error(t('No notes were heard in this recording.'));
      this.notes = notes;
      this.fileName = file.name;
      this.review(mode, duration, notes);
    } catch (err) {
      if (this.cancelled) return;
      this.step('pick');
      this.error(t((err as Error).message));
    }
  }

  private review(mode: Mode, duration: number, notes: AudioNote[]) {
    const { bpm, beat } = estimateTempo(notes);
    this.beat = beat;
    this.bpm = bpm;
    const form = this.form;
    form.title.value = this.fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || t('Recording');
    const sounds = mode === 'chords' ? CHORD_SOUNDS : MELODY_SOUNDS;
    form.sound.innerHTML = sounds.map((id) => `<option value="${id}">${t(NAMES[id] ?? soundById(id).name)}</option>`).join('');
    form.bpm.value = String(Math.round(bpm));
    form.time.value = '4/4';
    form.key.value = String(estimateKey(notes));
    this.fillBeats(estimateFirstBeat(notes, bpm, beat, 4));
    const secs = Math.round(duration);
    const minutes = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const longer = duration >= MAX_SECONDS ? ` ${t('(only the first 15 minutes)')}` : '';
    this.el.querySelector('[data-found]')!.textContent = `${t('Notes heard:')} ${notes.length} · ${minutes}${longer}`;
    this.step('review');
    form.querySelector<HTMLButtonElement>('button[type=submit]')!.focus();
  }

  private fillBeats(selected: number) {
    const form = this.form;
    const beats = Number(form.time.value.split('/')[0]);
    form.firstBeat.innerHTML = Array.from({ length: beats }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    form.firstBeat.value = String(Math.min(beats, Math.max(1, selected)));
  }

  private write() {
    const form = this.form;
    const [beats, beatType] = form.time.value.split('/').map(Number);
    const sound = form.sound.value;
    const typed = Math.max(30, Math.min(300, Number(form.bpm.value) || 100));
    // the tempo found (or exactly double it) keeps its beat; another tempo counts from the first note
    const ratio = [1, 2].find((r) => Math.abs(typed - Math.round(this.bpm * r)) < 0.5);
    const bpm = ratio ? this.bpm * ratio : typed;
    try {
      const score = audioToScore(this.notes, {
        title: form.title.value.trim() || t('Recording'),
        bpm,
        beat: ratio ? this.beat : this.notes[0].start,
        firstBeat: Number(form.firstBeat.value) || 1,
        beats,
        beatType,
        keyFifths: Number(form.key.value) || 0,
        sound,
        name: t(NAMES[sound] ?? soundById(sound).name),
      });
      this.opts.hide();
      this.opts.onScore(score);
    } catch (err) {
      this.error(t((err as Error).message));
      this.step('pick');
    }
  }
}
