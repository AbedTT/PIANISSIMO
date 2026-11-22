import { JUMP_LABELS, type Articulation, type DurationType, type Dynamic, type JumpType, type Step } from '../model/types';
import type { Editor, Palette } from './editor';

/**
 * Every editing operation is a named command. The same list drives keyboard
 * shortcuts, the toolbar, the command search and the shortcut help sheet.
 */
export interface Command {
  id: string;
  label: string;
  group: string;
  /** Key combos like "Ctrl+Shift+KeyZ" (KeyboardEvent.code with modifiers in Ctrl, Alt, Shift order). */
  keys?: string[];
  /** Only active while this number-row palette is selected. */
  palette?: Palette;
  /** Short toolbar text/glyph. */
  icon?: string;
  run: (ed: Editor, app: AppActions) => void;
  /** Highlight state for toolbar buttons. */
  active?: (ed: Editor) => boolean;
}

/** Actions implemented outside the editor (playback, files, dialogs). */
export interface AppActions {
  togglePlay(fromStart?: boolean): void;
  newScore(): void;
  openFile(): void;
  saveFile(): void;
  exportMusicXML(): void;
  exportMidi(): void;
  print(): void;
  showHelp(): void;
  showSearch(): void;
  toggleMidi(): void;
  notify(message: string): void;
  startText(kind: 'lyric' | 'chord'): void;
  chooseSound(): void;
  showTranspose(): void;
  downloadFile(): void;
  showNavMenu(): void;
  openLibrary(): void;
  share(): void;
}

const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const DURATIONS: { type: DurationType; label: string; icon: string }[] = [
  { type: 'w', label: 'Whole note', icon: '𝅝' },
  { type: 'h', label: 'Half note', icon: '𝅗𝅥' },
  { type: 'q', label: 'Quarter note', icon: '♩' },
  { type: '8', label: 'Eighth note', icon: '♪' },
  { type: '16', label: '16th note', icon: '𝅘𝅥𝅯' },
  { type: '32', label: '32nd note', icon: '𝅘𝅥𝅰' },
  { type: '64', label: '64th note', icon: '𝅘𝅥𝅱' },
];
export const ARTICULATIONS: { a: Articulation; label: string; icon: string }[] = [
  { a: 'staccato', label: 'Staccato', icon: '·' },
  { a: 'accent', label: 'Accent', icon: '>' },
  { a: 'tenuto', label: 'Tenuto', icon: '–' },
  { a: 'marcato', label: 'Marcato', icon: '^' },
  { a: 'fermata', label: 'Fermata', icon: '𝄐' },
];
export const DYNAMICS: Dynamic[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'sfz'];

export const COMMANDS: Command[] = [
  // ---- notes ----
  ...STEPS.map<Command>((s) => ({
    id: `note${s}`,
    label: `Write ${s}`,
    group: 'Notes',
    keys: [`Key${s}`],
    icon: s,
    run: (ed) => ed.typeLetter(s),
  })),
  ...STEPS.map<Command>((s) => ({
    id: `chord${s}`,
    label: `Add ${s} to chord`,
    group: 'Notes',
    keys: [`Shift+Key${s}`],
    run: (ed) => ed.addToChord(s),
  })),
  ...[2, 3, 4, 5, 6, 7, 8].map<Command>((n) => ({
    id: `interval${n}`,
    label: `Add interval: ${['', '', '2nd', '3rd', '4th', '5th', '6th', '7th', 'octave'][n]} above`,
    group: 'Notes',
    keys: [`Alt+Digit${n}`],
    run: (ed) => ed.addInterval(n),
  })),
  { id: 'rest', label: 'Write rest', group: 'Notes', keys: ['Digit0', 'Numpad0'], icon: '𝄽', run: (ed) => ed.rest() },
  {
    id: 'voice',
    label: 'Switch voice 1 / voice 2 (two melodic lines on one staff)',
    group: 'Notes',
    keys: ['KeyV'],
    icon: '<span class="text-icon voice-icon">V2</span>',
    run: (ed, app) => {
      ed.toggleVoice();
      app.notify(ed.voice ? 'Voice 2 (stems down): type the second line' : 'Voice 1');
    },
    active: (ed) => ed.voice === 1,
  },
  {
    id: 'removeVoice2',
    label: 'Remove voice 2 from this bar (or selected bars)',
    group: 'Notes',
    keys: ['Ctrl+Shift+KeyV'],
    run: (ed) => ed.removeVoice2(),
  },
  { id: 'duplicate', label: 'Repeat last note', group: 'Notes', keys: ['KeyR'], run: (ed) => ed.duplicate() },

  // ---- durations (number row in Notes palette, numpad always) ----
  ...DURATIONS.map<Command>((d, k) => ({
    id: `duration-${d.type}`,
    label: d.label,
    group: 'Durations',
    // no palette: palette-specific digit bindings win, numpad always sets durations
    keys: [`Digit${k + 1}`, `Numpad${k + 1}`],
    icon: d.icon,
    run: (ed) => ed.setDuration(d.type),
    active: (ed) => ed.inputType === d.type,
  })),
  {
    id: 'triplet',
    label: 'Triplet',
    group: 'Durations',
    keys: ['Shift+Digit3'],
    icon: '<span class="tuplet-icon">3</span>',
    run: (ed) => ed.toggleTriplet(),
    active: (ed) => ed.inputTriplet,
  },
  {
    id: 'dot',
    label: 'Dotted',
    group: 'Durations',
    keys: ['Period', 'NumpadDecimal'],
    icon: '•',
    run: (ed) => ed.toggleDot(),
    active: (ed) => ed.inputDots > 0,
  },

  // ---- pitch edits ----
  { id: 'sharp', label: 'Sharp', group: 'Accidentals', keys: ['Equal'], icon: '♯', run: (ed) => ed.accidental(1) },
  { id: 'flat', label: 'Flat', group: 'Accidentals', keys: ['Minus'], icon: '♭', run: (ed) => ed.accidental(-1) },
  { id: 'natural', label: 'Natural', group: 'Accidentals', keys: ['KeyN'], icon: '♮', run: (ed) => ed.accidental(0) },
  { id: 'enharmonic', label: 'Respell enharmonic', group: 'Accidentals', keys: ['KeyJ'], run: (ed) => ed.enharmonic() },
  { id: 'up', label: 'Pitch up', group: 'Pitch', keys: ['ArrowUp'], run: (ed) => ed.shift(1) },
  { id: 'down', label: 'Pitch down', group: 'Pitch', keys: ['ArrowDown'], run: (ed) => ed.shift(-1) },
  { id: 'semiUp', label: 'Up a semitone', group: 'Pitch', keys: ['Alt+Shift+ArrowUp'], run: (ed) => ed.chromatic(1) },
  { id: 'semiDown', label: 'Down a semitone', group: 'Pitch', keys: ['Alt+Shift+ArrowDown'], run: (ed) => ed.chromatic(-1) },
  { id: 'transpose', label: 'Transpose… (score or selection)', group: 'Pitch', keys: ['Alt+KeyT'], icon: '<span class="text-icon">⇅</span>', run: (_, app) => app.showTranspose() },
  { id: 'octaveUp', label: 'Octave up', group: 'Pitch', keys: ['Ctrl+ArrowUp'], run: (ed) => ed.octave(1) },
  { id: 'octaveDown', label: 'Octave down', group: 'Pitch', keys: ['Ctrl+ArrowDown'], run: (ed) => ed.octave(-1) },
  { id: 'tie', label: 'Tie to next note', group: 'Notes', keys: ['Comma'], icon: '⁀', run: (ed) => ed.toggleTie() },
  { id: 'slur', label: 'Slur (to next note, or over selection)', group: 'Notes', keys: ['KeyS'], icon: '◠', run: (ed) => ed.toggleSlur() },

  // ---- articulations / dynamics (number row when palette selected) ----
  ...ARTICULATIONS.map<Command>((a, k) => ({
    id: `art-${a.a}`,
    label: a.label,
    group: 'Articulations',
    keys: [`Digit${k + 1}`],
    palette: 'articulations',
    icon: a.icon,
    run: (ed) => ed.toggleArticulation(a.a),
  })),
  ...DYNAMICS.map<Command>((d, k) => ({
    id: `dyn-${d}`,
    label: `Dynamic ${d}`,
    group: 'Dynamics',
    keys: [`Digit${k + 1}`],
    palette: 'dynamics',
    icon: d,
    run: (ed) => ed.toggleDynamic(d),
  })),
  {
    id: 'nextPalette',
    label: 'Switch number-row palette',
    group: 'Interface',
    keys: ['Tab'],
    run: (ed) => {
      const order: Palette[] = ['notes', 'articulations', 'dynamics'];
      ed.setPalette(order[(order.indexOf(ed.palette) + 1) % order.length]);
    },
  },
  {
    id: 'escape',
    label: 'Clear selection / back to notes palette',
    group: 'Interface',
    keys: ['Escape'],
    run: (ed) => {
      ed.clearSelection();
      ed.setPalette('notes');
    },
  },
  {
    id: 'pencil',
    label: 'Toggle click-to-add-notes',
    group: 'Interface',
    keys: ['KeyI'],
    icon: '✎',
    run: (ed) => ed.setTool(ed.tool === 'pencil' ? 'keyboard' : 'pencil'),
    active: (ed) => ed.tool === 'pencil',
  },

  // ---- navigation ----
  { id: 'left', label: 'Previous note', group: 'Navigation', keys: ['ArrowLeft'], run: (ed) => ed.step(-1) },
  { id: 'right', label: 'Next note', group: 'Navigation', keys: ['ArrowRight'], run: (ed) => ed.step(1) },
  { id: 'selLeft', label: 'Extend selection left', group: 'Selection', keys: ['Shift+ArrowLeft'], run: (ed) => ed.step(-1, true) },
  { id: 'selRight', label: 'Extend selection right', group: 'Selection', keys: ['Shift+ArrowRight'], run: (ed) => ed.step(1, true) },
  { id: 'selPrevBar', label: 'Extend selection by bar left', group: 'Selection', keys: ['Ctrl+Shift+ArrowLeft'], run: (ed) => ed.stepMeasure(-1, true) },
  { id: 'selNextBar', label: 'Extend selection by bar right', group: 'Selection', keys: ['Ctrl+Shift+ArrowRight'], run: (ed) => ed.stepMeasure(1, true) },
  { id: 'selUp', label: 'Extend selection to staff above', group: 'Selection', keys: ['Shift+ArrowUp'], run: (ed) => ed.stepStaff(-1, true) },
  { id: 'selDown', label: 'Extend selection to staff below', group: 'Selection', keys: ['Shift+ArrowDown'], run: (ed) => ed.stepStaff(1, true) },
  { id: 'selAll', label: 'Select all', group: 'Selection', keys: ['Ctrl+KeyA'], run: (ed) => ed.selectAll() },
  {
    id: 'copy',
    label: 'Copy',
    group: 'Selection',
    keys: ['Ctrl+KeyC'],
    run: (ed, app) => {
      const n = ed.copy();
      if (n) app.notify(`Copied ${n} ${n === 1 ? 'item' : 'items'}`);
    },
  },
  {
    id: 'cut',
    label: 'Cut',
    group: 'Selection',
    keys: ['Ctrl+KeyX'],
    run: (ed, app) => {
      const n = ed.cut();
      if (n) app.notify(`Cut ${n} ${n === 1 ? 'item' : 'items'}`);
    },
  },
  {
    id: 'paste',
    label: 'Paste at cursor',
    group: 'Selection',
    keys: ['Ctrl+KeyV'],
    run: (ed, app) => {
      if (!ed.paste()) app.notify('Nothing to paste: select notes and press Ctrl+C first');
    },
  },
  { id: 'prevBar', label: 'Previous bar', group: 'Navigation', keys: ['Ctrl+ArrowLeft'], run: (ed) => ed.stepMeasure(-1) },
  { id: 'nextBar', label: 'Next bar', group: 'Navigation', keys: ['Ctrl+ArrowRight'], run: (ed) => ed.stepMeasure(1) },
  { id: 'staffUp', label: 'Staff above', group: 'Navigation', keys: ['Ctrl+Shift+ArrowUp', 'Alt+ArrowUp'], run: (ed) => ed.stepStaff(-1) },
  { id: 'staffDown', label: 'Staff below', group: 'Navigation', keys: ['Ctrl+Shift+ArrowDown', 'Alt+ArrowDown'], run: (ed) => ed.stepStaff(1) },
  { id: 'home', label: 'Go to start', group: 'Navigation', keys: ['Home'], run: (ed) => ed.setCursor({ m: 0, s: ed.cursor.s, i: 0 }) },
  {
    id: 'end',
    label: 'Go to end',
    group: 'Navigation',
    keys: ['End'],
    run: (ed) => ed.setCursor({ m: ed.score.measures.length - 1, s: ed.cursor.s, i: 999 }),
  },

  // ---- editing ----
  { id: 'remove', label: 'Delete note', group: 'Edit', keys: ['Delete'], run: (ed) => ed.remove() },
  { id: 'backspace', label: 'Delete and go back', group: 'Edit', keys: ['Backspace'], run: (ed) => ed.backspace() },
  { id: 'undo', label: 'Undo', group: 'Edit', keys: ['Ctrl+KeyZ'], icon: '↶', run: (ed) => ed.undo() },
  { id: 'redo', label: 'Redo', group: 'Edit', keys: ['Ctrl+KeyY', 'Ctrl+Shift+KeyZ'], icon: '↷', run: (ed) => ed.redo() },
  { id: 'addBar', label: 'Insert bar after', group: 'Bars', keys: ['Alt+Enter'], run: (ed) => ed.addMeasureAfter() },
  { id: 'addBarEnd', label: 'Add bar at end', group: 'Bars', keys: ['Ctrl+Shift+Enter'], run: (ed) => ed.addMeasureAtEnd() },
  { id: 'removeBar', label: 'Delete bar', group: 'Bars', keys: ['Ctrl+Backspace'], run: (ed) => ed.deleteMeasure() },
  {
    id: 'navMenu',
    label: 'Navigation marks… (D.C., D.S., Segno, Coda, Fine)',
    group: 'Bars',
    icon: '𝄋',
    run: (_, app) => app.showNavMenu(),
    active: (ed) => {
      const b = ed.score.measures[ed.cursor.m];
      return !!(b?.segno || b?.coda || b?.toCoda || b?.fine || b?.jump);
    },
  },
  ...(
    [
      ['segno', 'Segno 𝄋 (start of this bar)'],
      ['coda', 'Coda 𝄌 (start of this bar)'],
      ['toCoda', 'To Coda (end of this bar)'],
      ['fine', 'Fine (end of this bar)'],
    ] as const
  ).map<Command>(([k, label]) => ({
    id: `nav-${k}`,
    label,
    group: 'Navigation marks',
    run: (ed, app) => app.notify(`${label.split(' (')[0]} ${ed.toggleNav(k) ? 'added' : 'removed'}`),
    active: (ed) => !!ed.score.measures[ed.cursor.m]?.[k],
  })),
  ...(Object.entries(JUMP_LABELS) as [JumpType, string][]).map<Command>(([k, label]) => ({
    id: `nav-${k}`,
    label: `${label} (end of this bar)`,
    group: 'Navigation marks',
    run: (ed, app) => app.notify(`${label} ${ed.toggleNav(k) ? 'added' : 'removed'}`),
    active: (ed) => ed.score.measures[ed.cursor.m]?.jump === k,
  })),
  {
    id: 'navClear',
    label: 'Remove navigation marks from this bar',
    group: 'Navigation marks',
    run: (ed) => ed.clearNav(),
  },
  {
    id: 'lineBreak',
    label: 'Line break after this bar',
    group: 'Layout',
    keys: ['Ctrl+Enter'],
    icon: '↵',
    run: (ed, app) => app.notify(ed.toggleBreak('lineBreak') ? 'Line break added' : 'Line break removed'),
    active: (ed) => !!ed.score.measures[ed.cursor.m]?.lineBreak,
  },
  {
    id: 'pageBreak',
    label: 'Page break after this bar (printing)',
    group: 'Layout',
    keys: ['Ctrl+Alt+Enter'],
    run: (ed, app) => app.notify(ed.toggleBreak('pageBreak') ? 'Page break added' : 'Page break removed'),
    active: (ed) => !!ed.score.measures[ed.cursor.m]?.pageBreak,
  },
  {
    id: 'repeatStart',
    label: 'Start repeat at this bar',
    group: 'Bars',
    keys: ['BracketLeft'],
    icon: '𝄆',
    run: (ed) => ed.toggleRepeat('repeatStart'),
    active: (ed) => !!ed.score.measures[ed.cursor.m]?.repeatStart,
  },
  {
    id: 'volta',
    label: '1st / 2nd ending (cycles)',
    group: 'Bars',
    keys: ['Ctrl+BracketRight'],
    icon: '<span class="text-icon">1.</span>',
    run: (ed, app) => {
      const n = ed.cycleVolta();
      app.notify(n ? `${n === 1 ? '1st' : '2nd'} ending` : 'Ending removed');
    },
    active: (ed) => !!ed.score.measures[ed.cursor.m]?.volta,
  },
  {
    id: 'repeatEnd',
    label: 'End repeat at this bar',
    group: 'Bars',
    keys: ['BracketRight'],
    icon: '𝄇',
    run: (ed) => ed.toggleRepeat('repeatEnd'),
    active: (ed) => !!ed.score.measures[ed.cursor.m]?.repeatEnd,
  },

  // ---- app ----
  { id: 'play', label: 'Play / stop', group: 'Playback', keys: ['Space'], icon: '▶', run: (_, app) => app.togglePlay() },
  { id: 'playStart', label: 'Play from start', group: 'Playback', keys: ['Ctrl+Space'], run: (_, app) => app.togglePlay(true) },
  {
    id: 'accompaniment',
    label: 'Chord accompaniment on/off',
    group: 'Playback',
    keys: ['Alt+KeyA'],
    icon: '<span class="text-icon">♫</span>',
    run: (ed, app) => {
      const on = !ed.score.accompaniment?.enabled;
      ed.setAccompaniment({ enabled: on });
      app.notify(on ? 'Chord accompaniment on: chord symbols will play' : 'Chord accompaniment off');
    },
    active: (ed) => !!ed.score.accompaniment?.enabled,
  },
  {
    id: 'metronome',
    label: 'Metronome',
    group: 'Playback',
    keys: ['Alt+KeyM'],
    icon: '<span class="text-icon">Click</span>',
    run: (ed) => ed.togglePlayback('metronome'),
    active: (ed) => ed.metronome,
  },
  {
    id: 'countIn',
    label: 'Count-in (one bar of clicks)',
    group: 'Playback',
    keys: ['Alt+KeyC'],
    icon: '<span class="text-icon">1234</span>',
    run: (ed) => ed.togglePlayback('countIn'),
    active: (ed) => ed.countIn,
  },
  {
    id: 'loop',
    label: 'Loop playback (selection or whole score)',
    group: 'Playback',
    keys: ['KeyL'],
    icon: '⟲',
    run: (ed) => ed.togglePlayback('loop'),
    active: (ed) => ed.loop,
  },
  { id: 'new', label: 'New score', group: 'File', keys: ['Alt+KeyN'], run: (_, app) => app.newScore() },
  { id: 'open', label: 'Open… (Pianissimo / MusicXML)', group: 'File', keys: ['Ctrl+KeyO'], run: (_, app) => app.openFile() },
  { id: 'save', label: 'Save to my library', group: 'File', keys: ['Ctrl+KeyS'], run: (_, app) => app.saveFile() },
  { id: 'download', label: 'Download a backup file (.json)', group: 'File', keys: ['Ctrl+Shift+KeyS'], run: (_, app) => app.downloadFile() },
  { id: 'library', label: 'My scores (cloud library)', group: 'File', keys: ['Ctrl+Shift+KeyO'], run: (_, app) => app.openLibrary() },
  { id: 'share', label: 'Share a link', group: 'File', keys: ['Alt+KeyS'], run: (_, app) => app.share() },
  { id: 'exportXml', label: 'Export MusicXML', group: 'File', keys: ['Ctrl+Shift+KeyE'], run: (_, app) => app.exportMusicXML() },
  { id: 'exportMidi', label: 'Export MIDI', group: 'File', keys: ['Ctrl+Shift+KeyM'], run: (_, app) => app.exportMidi() },
  { id: 'print', label: 'Print / Save as PDF (page layout preview)', group: 'File', keys: ['Ctrl+KeyP'], run: (_, app) => app.print() },
  { id: 'midi', label: 'MIDI keyboard input on/off', group: 'Interface', keys: ['Shift+KeyM'], icon: '🎹', run: (_, app) => app.toggleMidi() },
  { id: 'help', label: 'Keyboard shortcuts', group: 'Interface', keys: ['Shift+Slash'], icon: '?', run: (_, app) => app.showHelp() },
  { id: 'search', label: 'Search commands', group: 'Interface', keys: ['Ctrl+Shift+KeyP', 'F1'], run: (_, app) => app.showSearch() },
  { id: 'lyrics', label: 'Type lyrics (Space = next note, - = hyphen)', group: 'Text', keys: ['Ctrl+KeyL'], icon: '<span class="text-icon">La</span>', run: (_, app) => app.startText('lyric') },
  { id: 'chords', label: 'Type chord symbols (Space = next note)', group: 'Text', keys: ['Ctrl+KeyK'], icon: '<span class="text-icon">C7</span>', run: (_, app) => app.startText('chord') },
  { id: 'sound', label: 'Choose the sound (instrument) of this staff', group: 'Playback', run: (_, app) => app.chooseSound() },
];

export function comboOf(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, e.code].join('+');
}

/** Find the command bound to a combo, preferring palette-specific bindings. */
export function commandFor(combo: string, palette: Palette): Command | undefined {
  const matches = COMMANDS.filter((c) => c.keys?.includes(combo) && (!c.palette || c.palette === palette));
  return matches.find((c) => c.palette === palette) ?? matches[0];
}

export function prettyKey(combo: string): string {
  return combo
    .split('+')
    .map((k) =>
      k
        .replace(/^Key/, '')
        .replace(/^Digit/, '')
        .replace(/^Numpad(\d)$/, 'Num $1')
        .replace('NumpadDecimal', 'Num .')
        .replace('ArrowUp', '↑')
        .replace('ArrowDown', '↓')
        .replace('ArrowLeft', '←')
        .replace('ArrowRight', '→')
        .replace('Equal', '=')
        .replace('Minus', '-')
        .replace('Period', '.')
        .replace('Comma', ',')
        .replace('BracketLeft', '[')
        .replace('BracketRight', ']')
        .replace('Slash', '/'),
    )
    .join(' + ');
}
