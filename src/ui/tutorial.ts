import type { Editor } from '../editor/editor';
import { allEvents, newScore } from '../model/score';

/**
 * An interactive tutorial: a small coach card walks through the basics and moves on by
 * itself when the user has done each step (it watches the score, not the keys pressed),
 * so it works the same with the keyboard, the mouse or the on-screen piano.
 */
interface Step {
  title: string;
  body: string;
  /** Done when this returns true (checked after every change and a few times a second). */
  done?: () => boolean;
}

const SEEN = 'pianissimo:tutorialSeen';

export class Tutorial {
  private card: HTMLElement;
  private index = 0;
  private steps: Step[] = [];
  private poll = 0;
  private subscribed = false;

  constructor(
    private editor: Editor,
    private isPlaying: () => boolean,
    private announce: (msg: string) => void,
  ) {
    this.card = document.createElement('aside');
    this.card.className = 'coach';
    this.card.hidden = true;
    this.card.setAttribute('role', 'region');
    this.card.setAttribute('aria-label', 'Tutorial');
    document.body.append(this.card);
  }

  static get seen() {
    return localStorage.getItem(SEEN) === '1';
  }

  get running() {
    return !this.card.hidden;
  }

  start() {
    // a fresh single-staff score keeps the instructions simple; Ctrl+Z brings the old one back
    this.editor.load(newScore({ title: 'My first melody', measures: 4, staves: [{ clef: 'treble', sound: 'piano' }] }));
    const ed = this.editor;
    const notes = () => allEvents(ed.score).filter((x) => x.pitches.length);
    this.steps = [
      {
        title: 'Welcome to Pianissimo 👋',
        body: 'This two-minute tour shows how to write music. Each step continues by itself once you have done it. You can stop any time.',
      },
      {
        title: 'Write three notes',
        body: 'Type <kbd>C</kbd> <kbd>D</kbd> <kbd>E</kbd> on your keyboard (or tap keys on the on-screen piano). Each letter writes a note and moves on.',
        done: () => notes().length >= 3,
      },
      {
        title: 'Change the length',
        body: 'Press <kbd>4</kbd> for eighth notes (or tap ♪), then type <kbd>F</kbd> <kbd>G</kbd>. <kbd>3</kbd> is a quarter, <kbd>2</kbd> a half, <kbd>1</kbd> a whole note, <kbd>5</kbd> a 16th.',
        done: () => notes().some((x) => x.type === '8'),
      },
      {
        title: 'Build a chord',
        body: 'Hold <kbd>Shift</kbd> and type a letter, e.g. <kbd>Shift</kbd>+<kbd>E</kbd>, to add that note on top of the one you just wrote.',
        done: () => notes().some((x) => x.pitches.length >= 2),
      },
      {
        title: 'Fix a note',
        body: 'Move with <kbd>←</kbd> <kbd>→</kbd>, then press <kbd>↑</kbd> or <kbd>↓</kbd> to move the note up or down. <kbd>=</kbd> and <kbd>-</kbd> add a sharp or flat.',
        done: () => notes().some((x) => x.pitches.some((p) => p.alter !== 0)) || ed.score.measures.length > 4 || this.moved(),
      },
      {
        title: 'Add a chord symbol',
        body: 'Press <kbd>Ctrl</kbd>+<kbd>K</kbd>, type <b>C</b> and press <kbd>Enter</kbd>. With <kbd>Alt</kbd>+<kbd>A</kbd> a band plays along with your chords.',
        done: () => allEvents(ed.score).some((x) => !!x.harmony),
      },
      {
        title: 'Listen',
        body: 'Press <kbd>Space</kbd> (or ▶ at the top) to hear your melody. Press it again to stop.',
        done: () => this.isPlaying(),
      },
      {
        title: 'You are ready 🎉',
        body: 'Save with <kbd>Ctrl</kbd>+<kbd>S</kbd>, export from the <b>Export</b> menu and press <kbd>?</kbd> for every shortcut. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> searches all commands.',
      },
    ];
    this.index = 0;
    this.card.hidden = false;
    localStorage.setItem(SEEN, '1');
    if (!this.subscribed) {
      ed.subscribe(() => this.check());
      this.subscribed = true;
    }
    clearInterval(this.poll);
    this.poll = window.setInterval(() => this.check(), 400);
    this.show();
  }

  /** For the "fix a note" step: any note moved up/down since that step began. */
  private stepSnapshot = '';
  private moved() {
    const now = allEvents(this.editor.score)
      .map((x) => x.pitches.map((p) => `${p.step}${p.alter}${p.octave}`).join('+'))
      .join(' ');
    return this.stepSnapshot !== '' && now !== this.stepSnapshot && now.split(' ').length === this.stepSnapshot.split(' ').length;
  }

  stop() {
    this.card.hidden = true;
    clearInterval(this.poll);
  }

  private check() {
    const step = this.steps[this.index];
    if (!this.running || !step?.done) return;
    if (step.done()) this.next();
  }

  private next() {
    if (this.index >= this.steps.length - 1) return this.stop();
    this.index++;
    this.stepSnapshot = allEvents(this.editor.score)
      .map((x) => x.pitches.map((p) => `${p.step}${p.alter}${p.octave}`).join('+'))
      .join(' ');
    this.show();
  }

  private show() {
    const step = this.steps[this.index];
    const last = this.index === this.steps.length - 1;
    this.card.innerHTML = `
      <div class="coach-progress" aria-hidden="true">${this.steps.map((_, i) => `<span class="${i <= this.index ? 'on' : ''}"></span>`).join('')}</div>
      <p class="coach-count">Step ${this.index + 1} of ${this.steps.length}</p>
      <h3>${step.title}</h3>
      <p>${step.body}</p>
      <div class="coach-actions">
        <button data-act="stop">${last ? 'Close' : 'Stop tutorial'}</button>
        ${step.done ? '<button data-act="skip">Skip step</button>' : `<button data-act="next" class="primary small">${last ? 'Finish' : 'Next'}</button>`}
      </div>`;
    this.card.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
    this.card.querySelector('[data-act=stop]')!.addEventListener('click', () => this.stop());
    this.card.querySelector('[data-act=next], [data-act=skip]')?.addEventListener('click', () => this.next());
    this.announce(`Tutorial step ${this.index + 1}: ${step.title}. ${step.body.replace(/<[^>]+>/g, '')}`);
  }
}
