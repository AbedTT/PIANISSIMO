import { startErrorReporting } from './monitor/errors';
import { isValidScore } from './model/validate';
import { LocalLibrary } from './library/local';
import { initUpdates } from './desktop/updateUi';
import './styles.css';
import './ios.css';
import { MidiInput } from './audio/midiInput';
import { Cloud } from './cloud/ui';
import { Player } from './audio/player';
import { SOUNDS, soundById } from './audio/sounds';
import { STYLES } from './audio/accompaniment';
import { INTERVALS, transposeKey } from './model/transpose';
import { getLyric, MAX_VERSES } from './model/lyrics';
import { extractPart, INSTRUMENTS, partOfStaff, partsOf, scoreFromInstruments } from './model/parts';
import { contextAt } from './model/context';
import { buildPrintPages, PAGE_SIZES } from './render/print';
import { ARTICULATIONS, COMMANDS, DYNAMICS, comboOf, commandFor, prettyKey, type AppActions, type Command } from './editor/commands';
import { Editor } from './editor/editor';
import { fromMusicXML, toMusicXML } from './io/musicxml';
import { toMidi } from './io/midi';
import { readMxl } from './io/mxl';
import { midiToScore, notesToStream, type RawNote } from './io/midiImport';
import { TPQ } from './model/duration';
import { KEY_NAMES, pitchName } from './model/pitch';
import { allEvents, lane, laneOf, lanesOf, newScore, refitMeasures, syncStaves } from './model/score';
import { isRest, type Clef, type Pitch, type Score } from './model/types';
import { renderScore, type Layout } from './render/renderer';
import { addComment, allComments, commentsAt, removeComment, setResolved } from './model/comments';
import { TEMPLATES } from './model/templates';
import { announce, enhanceDialogs, labelIconButtons } from './ui/a11y';
import { currentLang, LANGUAGES, setLang, t, tLabel, tMsg, translatePage, type Lang } from './ui/i18n';
import { registerServiceWorker } from './pwa/register';
import { drumAt } from './model/drums';
import { initLive } from './cloud/liveUi';
import { initClasses } from './cloud/classesUi';
import { initNotifications } from './cloud/notifyUi';
import { api } from './cloud/api';
import { WaitPractice } from './audio/practice';
import { MicInput, type MicFrame } from './audio/micInput';
import { NoteTracker } from './audio/pitchDetect';
import { checkScore, outOfRange, type Issue } from './model/checks';
import { fillLeftHand, suggestChords } from './model/harmonise';
import { midiOf, spellMidi } from './model/pitch';
import { PianoKeys } from './ui/pianoKeys';
import { initTheme, setTheme, themeChoice, toggleTheme, type ThemeChoice } from './ui/theme';
import { Tutorial } from './ui/tutorial';

// unexpected errors from here on reach the admins (admin.html)
startErrorReporting();

initTheme();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const editor = new Editor();
const player = new Player();
editor.onPreview = (p, s) => void player.preview(p, editor.score.staves[s]?.sound);
editor.notice = (msg) => toast(msg);
player.onLoading = (name, failed) => {
  if (name && failed) toast(`Couldn't load “${name}” (offline?). Using a synth sound for now.`);
  else if (name) toast(`Loading ${name}…`);
};
const midi = new MidiInput();
const cloud = new Cloud(editor, (m) => toast(m), (s) => {
  player.stop();
  editor.load(s);
});
// desktop app: new releases (checked once a day; "Check for updates" in the command search)
const updates = initUpdates({ toast: (m) => toast(m), beforeInstall: () => cloud.flush() });
midi.onChord = (notes) => {
  if (practice) return practiseChord(notes);
  if (!recording) editor.writeMidi(notes); // while recording, notes are collected with their timing instead
};

// ------------------------------------------------------------------ practice: tempo and wait mode
const TEMPO_KEY = 'pianissimo:practiceTempo';
/** Practice speed for this browser (not saved in the score). */
let practiceTempo = 1;
try {
  practiceTempo = Math.min(1.5, Math.max(0.5, Number(localStorage.getItem(TEMPO_KEY)) || 1));
} catch {
  /* storage blocked */
}
let practice: WaitPractice | null = null;
const midiNames = (midis: number[]) => midis.map((m) => pitchName(spellMidi(m, editor.score.keyFifths))).join(' + ');

function showPracticeStep() {
  const step = practice?.current;
  if (!step) return;
  const e = step.event;
  editor.setCursor({ m: e.m, s: e.s, i: e.i, v: e.v });
  updateStatus();
}

function stopPractice(message?: string) {
  practice = null;
  if (practiceEars) {
    practiceEars = null;
    stopMicIfIdle();
  }
  if (message) toast(message);
  updateStatus();
  renderToolbar();
}

/** Wait mode is listening through the microphone (no MIDI keyboard). */
let practiceEars: NoteTracker | null = null;

/**
 * Notes played in wait mode: a chord from a MIDI keyboard or the on-screen piano, or one
 * note heard by the microphone (matched loosely: the melody note, in any octave).
 */
function practiseChord(notes: number[], source: 'midi' | 'piano' | 'mic' = 'midi') {
  const step = practice?.current;
  if (!step) return;
  const heard = source === 'mic';
  const result = practice!.play(notes, heard);
  if (result === 'wrong') {
    const want = heard ? midiNames(step.expected.slice(-1)) : midiNames(step.expected);
    announce(`Not quite: ${heard ? 'sing or play' : 'play'} ${want}`);
    toast(`Not quite: ${heard ? 'sing or play' : 'play'} ${want}`);
    return;
  }
  // the right notes: sound them together with what the other parts play at that moment
  // (not when listening: the microphone would hear it as the next note)
  const soundOf = (s: number) => editor.score.staves[s]?.sound;
  if (!heard) void player.playChord([
    ...step.expected.map((midi) => ({ midi, sound: soundOf(step.event.s) })),
    ...step.others.filter((o) => !editor.score.staves[o.s]?.mute).map((o) => ({ midi: o.midi, sound: soundOf(o.s) })),
  ]);
  if (result === 'done') {
    const misses = practice!.misses;
    stopPractice(`Well played: the end! ${misses ? `${misses} wrong ${misses === 1 ? 'try' : 'tries'} on the way.` : 'Not a single wrong note.'}`);
    return;
  }
  showPracticeStep();
}
midi.onChange = () => {
  renderToolbar();
  updateStatus();
};

let layout: Layout | null = null;
/** Live co-editing (set up with the cloud library below). */
let liveUi: ReturnType<typeof initLive> | null = null;
/** Classes and assignments (set up with the cloud library below). */
let classes: ReturnType<typeof initClasses> | null = null;
/** The bell (set up with the cloud library below). */
let bell: ReturnType<typeof initNotifications> | null = null;
const pianoKeys = new PianoKeys(editor, (m) => announce(m));
const tutorial = new Tutorial(editor, () => player.playing, (m) => announce(m, 400));
let commentBar = 0;

// ------------------------------------------------------------------ helpers
function toast(msg: string) {
  const t = $('toast');
  t.textContent = tMsg(msg);
  t.classList.add('show');
  clearTimeout((toast as any).timer);
  (toast as any).timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileBase = () => (editor.score.title || 'score').replace(/[\\/:*?"<>|]+/g, '').trim() || 'score';


// ------------------------------------------------------------------ app actions
const app: AppActions = {
  togglePlay(fromStart = false) {
    if (recording) {
      finishRecording();
      return;
    }
    if (player.playing) {
      player.stop();
      return;
    }
    // a selection plays just that range; otherwise from the cursor's bar (or the start)
    const range = editor.anchor && !fromStart ? new Set(editor.selected().map((x) => x.e.id)) : undefined;
    const fromId = fromStart || range ? undefined : editor.score.measures[editor.cursor.m].staves[0][0]?.id;
    void player.play(editor.score, {
      fromId,
      range,
      loop: editor.loop,
      metronome: editor.metronome,
      countIn: editor.countIn,
      tempoScale: practiceTempo,
    });
    updatePlayButton();
  },
  newScore() {
    showModal('newModal');
  },
  openFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.pianissimo,.musicxml,.xml,.mxl,.mid,.midi';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void openScoreFile(file);
    };
    input.click();
  },
  async saveFile() {
    // signed in, a new score goes online; scores from this computer's library stay there (and say so themselves)
    const online = !cloud.localId && !!cloud.user;
    if ((await cloud.saveAnywhere()) && online) toast('Saved to your library');
  },
  downloadFile() {
    download(JSON.stringify(editor.score, null, 1), `${fileBase()}.pianissimo.json`, 'application/json');
    toast('Backup downloaded (your work is also auto-saved in this browser)');
  },
  openLibrary() {
    void cloud.openLibrary();
  },
  checkUpdates() {
    void updates.checkNow();
  },
  share() {
    void cloud.share();
  },
  exportMusicXML() {
    download(toMusicXML(editor.score), `${fileBase()}.musicxml`, 'application/vnd.recordare.musicxml+xml');
  },
  exportMidi() {
    download(toMidi(editor.score), `${fileBase()}.mid`, 'audio/midi');
  },
  print() {
    showPrintPreview();
  },
  showHelp() {
    showModal('helpModal');
  },
  async toggleMidi() {
    if (midi.enabled) {
      midi.disable();
      toast('MIDI input off');
      return;
    }
    try {
      await midi.enable();
      toast(midi.devices.length ? `MIDI input on: ${midi.devices.join(', ')}` : 'MIDI input on: connect a keyboard');
    } catch (err) {
      toast((err as Error).message);
    }
  },
  notify(message: string) {
    toast(message);
  },
  startText(kind) {
    startText(kind);
  },
  showBarSettings() {
    showBarSettings();
  },
  async exportAudio() {
    toast('Rendering audio… (sounds download the first time)');
    try {
      const { renderAudio, encodeWav } = await import('./audio/render');
      let fallback = false;
      const audio = await renderAudio(editor.score, () => (fallback = true));
      download(encodeWav(audio), `${fileBase()}.wav`, 'audio/wav');
      toast(fallback ? 'Audio exported with built-in synth sounds (the sampled instruments could not be downloaded)' : 'Audio exported');
    } catch (err) {
      toast(`Could not render audio: ${(err as Error).message}`);
    }
  },
  async exportImage(kind) {
    try {
      const { scoreToPng, scoreToSvg } = await import('./io/image');
      if (kind === 'svg') download(await scoreToSvg(editor.score), `${fileBase()}.svg`, 'image/svg+xml');
      else download(await scoreToPng(editor.score), `${fileBase()}.png`, 'image/png');
    } catch (err) {
      toast(`Could not export the image: ${(err as Error).message}`);
    }
  },
  toggleRecording() {
    void toggleRecording();
  },
  showInstruments() {
    renderPartsList();
    showModal('partsModal');
  },
  showNavMenu() {
    const anchor = document.querySelector<HTMLElement>('[data-command-id="navMenu"]');
    if (!anchor) return;
    const ids = [
      'nav-segno', 'nav-coda', 'nav-toCoda', 'nav-fine',
      'nav-dc', 'nav-dcFine', 'nav-dcCoda', 'nav-ds', 'nav-dsFine', 'nav-dsCoda', 'navClear',
    ];
    showCommandMenu(anchor, ids.map(byId));
  },
  showTranspose() {
    showModal('transposeModal');
    const scope = $<HTMLSelectElement>('transposeScope');
    scope.value = editor.anchor ? 'selection' : 'score';
    scope.querySelector<HTMLOptionElement>('option[value="selection"]')!.disabled = !editor.anchor;
    updateTransposePreview();
    $('transposeInterval').focus();
  },
  chooseSound() {
    const sel = document.querySelectorAll<HTMLSelectElement>('#sounds select')[editor.cursor.s];
    if (!sel) return;
    sel.focus();
    sel.scrollIntoView({ block: 'nearest' });
    toast('Pick a sound for this staff in the side panel (↑ ↓ then Enter)');
  },
  showComments() {
    openComments(editor.cursor.m);
  },
  showHistory() {
    void cloud.showHistory();
  },
  togglePianoKeys() {
    const open = pianoKeys.toggle();
    $<HTMLInputElement>('keysToggle').checked = open;
    toast(open ? 'On-screen keyboard: tap a key to write that note' : 'On-screen keyboard hidden');
    renderAll();
  },
  toggleTheme() {
    const now = toggleTheme();
    $<HTMLSelectElement>('themeSelect').value = themeChoice();
    toast(now === 'dark' ? 'Dark mode' : 'Light mode');
  },
  toggleMicRecording() {
    void toggleMicRecording();
  },
  suggestChords() {
    const { m, s } = editor.cursor;
    const ideas = suggestChords(editor.score, m, s);
    if (!ideas.length) return toast('Write some melody in this bar first, then ask for chords');
    const anchor = document.querySelector<HTMLElement>('#cursor') ?? $('score');
    showCommandMenu(
      anchor,
      ideas.map((c) => ({
        id: `chord-${c.symbol}`,
        label: `${c.symbol}  (${c.degree}, fits ${Math.round(c.fit * 100)}% of the melody)`,
        group: 'Text',
        run: () => {
          editor.setHarmony({ m, s, i: 0 }, c.symbol);
          toast(`${c.symbol} on bar ${m + 1}`);
        },
      })),
    );
  },
  harmoniseAll() {
    const s = editor.cursor.s;
    let added = 0;
    editor.mutate((score) => {
      score.measures.forEach((bar, m) => {
        if (bar.staves.some((evs) => evs.some((e) => e.harmony))) return;
        const best = suggestChords(score, m, s, 1)[0];
        const first = bar.staves[s]?.[0];
        if (best && first) {
          first.harmony = best.symbol;
          added++;
        }
      });
    });
    toast(added ? `Suggested chords for ${added} ${added === 1 ? 'bar' : 'bars'} (Ctrl+Z to undo)` : 'Every bar with melody already has a chord');
  },
  fillLeftHand() {
    const score = editor.score;
    // the bass staff under the cursor, or the bass staff of the cursor's instrument
    const { part, start } = partOfStaff(score, editor.cursor.s);
    const candidates = [editor.cursor.s, ...Array.from({ length: part.staves }, (_, k) => start + k)];
    const target = candidates.find((st) => score.staves[st]?.clef === 'bass');
    if (target === undefined) return toast('Put the cursor on a piano (grand staff) or a bass staff first');
    let bars = 0;
    editor.mutate((sc) => (bars = fillLeftHand(sc, target, sc.accompaniment?.style ?? 'pop')));
    toast(bars ? `Left hand written in ${bars} ${bars === 1 ? 'bar' : 'bars'}: edit it like any notes (Ctrl+Z to undo)` : 'No empty bars with chord symbols to fill on that staff');
  },
  showChecks() {
    showChecks();
  },
  openClasses() {
    void classes?.open();
  },
  async scanMusic() {
    if (!cloud.user) return cloud.showAuth('Sign in to scan sheet music (the server reads the page).', async () => app.scanMusic());
    const available = await api.omrAvailable().then((r) => r.available, () => false);
    if (!available) return toast('Scanning sheet music is not set up on this server.');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/tiff,application/pdf';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      toast('Reading the music… (this can take a minute)');
      try {
        const { result } = await api.scanMusic(file);
        const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
        const xml = result.format === 'mxl' ? await readMxl(bytes.buffer) : new TextDecoder().decode(bytes);
        const score = fromMusicXML(xml);
        player.stop();
        editor.load(score);
        cloud.detach();
        toast('Scanned: check the notes against the page, recognition is not perfect (Ctrl+Z returns to your previous score)');
      } catch (err) {
        toast((err as Error).message);
      }
    };
    input.click();
  },
  toggleTuner() {
    void toggleTuner();
  },
  get practising() {
    return !!practice;
  },
  async toggleWaitMode() {
    if (practice) return stopPractice('Wait mode off');
    // a MIDI keyboard if there is one; otherwise the microphone, or else the on-screen piano
    let viaMidi = false;
    if (MidiInput.supported) {
      try {
        // a browser that asks for MIDI permission may never answer: give it two seconds
        if (!midi.enabled) await Promise.race([midi.enable(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 2000))]);
        viaMidi = midi.devices.length > 0;
      } catch {
        /* no MIDI access: fall back below */
      }
    }
    player.stop();
    // the part under the cursor, from the cursor's bar
    const { part, start } = partOfStaff(editor.score, editor.cursor.s);
    const staves = Array.from({ length: part.staves }, (_, k) => start + k);
    practice = new WaitPractice(editor.score, staves);
    const from = practice.steps.findIndex((st) => st.event.m >= editor.cursor.m);
    practice.index = Math.max(0, from);
    if (!practice.current) return stopPractice('Nothing to play in this part from here');
    if (viaMidi) toast(`Wait mode: play the highlighted notes of ${part.name} on your MIDI keyboard (Ctrl+Alt+W stops)`);
    else if (await startMic()) {
      practiceEars = new NoteTracker();
      practiceEars.onStart = (m) => practiseChord([m], 'mic');
      toast(`Wait mode: sing or play the highlighted notes of ${part.name} into the microphone, or use the on-screen keyboard (Ctrl+Alt+W stops)`);
    } else {
      pianoKeys.toggle(true);
      toast(`Wait mode: play the highlighted notes of ${part.name} on the on-screen keyboard (Ctrl+Alt+W stops)`);
    }
    showPracticeStep();
    renderToolbar();
  },
  startTutorial() {
    hideModals();
    player.stop();
    tutorial.start();
  },
  showSearch() {
    showModal('searchModal');
    const input = $<HTMLInputElement>('searchInput');
    input.value = '';
    renderSearch('');
    input.focus();
  },
};

function run(cmd: Command) {
  cmd.run(editor, app);
}

/** Open a Pianissimo, MusicXML (.musicxml/.xml/.mxl) or MIDI file into the editor. */
async function openScoreFile(file: File) {
  try {
    if (/\.midi?$/i.test(file.name)) {
      const imported = midiToScore(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.midi?$/i, ''));
      player.stop();
      editor.load(imported);
      cloud.detach();
      toast(`Imported “${imported.title}” from MIDI (quantised to 16ths and triplets)`);
      return;
    }
    const text = /\.mxl$/i.test(file.name) ? await readMxl(await file.arrayBuffer()) : await file.text();
    let score: Score;
    if (LocalLibrary.isBackup(text)) {
      // a backup of the whole library ("Back up all…"): add its scores to My scores
      await cloud.restoreLibrary(text);
      void cloud.openLibrary();
      return;
    }
    if (text.trimStart().startsWith('{')) {
      const parsed = JSON.parse(text);
      if (!isValidScore(parsed)) throw new Error('Not a Pianissimo score file.');
      score = parsed;
    } else {
      score = fromMusicXML(text);
    }
    player.stop();
    editor.load(score);
    cloud.detach(); // a file is not (yet) in a library
    toast(`Opened “${score.title}”`);
  } catch (err) {
    toast(`Could not open file: ${(err as Error).message}`);
  }
}

// ------------------------------------------------------------------ rendering
function sheetWidth() {
  return Math.min(1100, $('sheetScroll').clientWidth - 48);
}

function renderAll() {
  layout = renderScore($('score'), editor.score, sheetWidth(), { hints: true });
  $<HTMLInputElement>('title').value = editor.score.title;
  $<HTMLInputElement>('composer').value = editor.score.composer;
  $<HTMLInputElement>('headerNote').value = editor.score.headerNote ?? '';
  $<HTMLTextAreaElement>('footerNote').value = editor.score.footerNote ?? '';
  syncSidePanel();
  updateCursor();
  renderToolbar();
  positionTextEntry();
  updateBreakMarkers();
  updateCommentMarkers();
  liveUi?.render();
}

function staveBox(m: number, s: number) {
  return layout?.staves.find((b) => b.m === m && b.s === s);
}

/**
 * Scroll the sheet just enough to show a box given in score coordinates. The cursor element itself
 * can't be used for this: it glides to its new place (CSS transition), so while it moves the browser
 * would still see it at the old note, often far up the page.
 */
function revealInSheet(left: number, top: number, width: number, height: number) {
  const sc = $('sheetScroll');
  const wrap = $('scoreWrap').getBoundingClientRect();
  const view = sc.getBoundingClientRect();
  const pad = 16;
  const y0 = wrap.top - view.top + sc.scrollTop + top;
  const x0 = wrap.left - view.left + sc.scrollLeft + left;
  if (y0 - pad < sc.scrollTop) sc.scrollTop = y0 - pad;
  else if (y0 + height + pad > sc.scrollTop + sc.clientHeight) sc.scrollTop = Math.min(y0 - pad, y0 + height + pad - sc.clientHeight);
  if (x0 - pad < sc.scrollLeft) sc.scrollLeft = x0 - pad;
  else if (x0 + width + pad > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = x0 + width + pad - sc.clientWidth;
}

/** Each head of the chord under the cursor with the index of its pitch (lowest note = lowest head). */
function chordHeads(ev: { id: string; pitches: Pitch[] }) {
  const el = layout?.elements.get(ev.id);
  if (!el) return [];
  const rects = [...el.querySelectorAll('.vf-notehead')]
    .map((n) => n.getBoundingClientRect())
    .sort((a, b) => b.top + b.height / 2 - (a.top + a.height / 2));
  const order = ev.pitches.map((p, k) => ({ k, midi: midiOf(p) })).sort((a, b) => a.midi - b.midi);
  if (rects.length !== order.length) return [];
  return order.map((o, i) => ({ k: o.k, rect: rects[i] }));
}

/** A ring around the one chord note that is picked (Alt+Up/Down or a click on its head). */
function placeChordMark() {
  const mark = $('chordMark');
  const ev = editor.current;
  const k = editor.chordNote;
  const head = ev && k !== null ? chordHeads(ev).find((h) => h.k === k) : undefined;
  if (!head) {
    mark.style.display = 'none';
    return;
  }
  // the head's line or space gives its height (a glyph's box is much taller than the head itself)
  const st = staveBox(editor.cursor.m, editor.cursor.s);
  if (!st) {
    mark.style.display = 'none';
    return;
  }
  const wrap = $('scoreWrap').getBoundingClientRect();
  const y = st.top + (editor.halfSpacesOf(ev!.pitches[k!], editor.cursor.s) * st.spacing) / 2;
  const size = st.spacing * 1.9;
  mark.style.display = 'block';
  mark.style.left = `${head.rect.left - wrap.left + head.rect.width / 2 - size * 0.62}px`;
  mark.style.top = `${y - size / 2}px`;
  mark.style.width = `${size * 1.24}px`;
  mark.style.height = `${size}px`;
}

/** A click on one head of a chord picks that note, to change it alone; elsewhere on the chord, the whole chord. */
function pickChordNote(evt: MouseEvent) {
  const ev = editor.current;
  if (!ev || ev.pitches.length < 2) return;
  const st = staveBox(editor.cursor.m, editor.cursor.s);
  if (!st) return;
  const wrap = $('scoreWrap').getBoundingClientRect();
  // each head's height comes from its line or space; the glyph's box is far taller than the head
  let best: { k: number; d: number } | null = null;
  for (const { k, rect } of chordHeads(ev)) {
    const y = wrap.top + st.top + (editor.halfSpacesOf(ev.pitches[k], editor.cursor.s) * st.spacing) / 2;
    const d = Math.hypot((evt.clientX - (rect.left + rect.width / 2)) / 1.4, evt.clientY - y);
    if (!best || d < best.d) best = { k, d };
  }
  editor.selectChordNote(best && best.d <= st.spacing * 0.9 ? best.k : null);
}

function updateCursor(scroll = true) {
  const el = $('cursor');
  const { m, s } = editor.cursor;
  const ev = editor.current;
  const box = ev && layout?.events.get(ev.id);
  const st = staveBox(m, s);
  if (!box || !st) {
    el.style.display = 'none';
    $('chordMark').style.display = 'none';
    return;
  }
  const allSame = editor.events.every((e) => layout!.events.get(e.id)?.x === box.x);
  el.style.display = 'block';
  // one colour per voice (as in the toolbar): 1 blue, 2 orange, 3 green, 4 purple
  for (let v = 1; v < 4; v++) el.classList.toggle(`voice${v + 1}`, editor.voice === v);
  // collapsed whole-bar rest: show the slot as a proportion of the bar
  if (allSame && editor.events.length > 1) {
    const total = editor.events.reduce((a, e) => a + ticks(e), 0);
    let before = 0;
    for (let i = 0; i < editor.cursor.i; i++) before += ticks(editor.events[i]);
    const span = st.x + st.width - st.noteStartX - 10;
    el.style.left = `${st.noteStartX + (before / total) * span}px`;
    el.style.width = `${Math.max(16, (ticks(ev) / total) * span)}px`;
  } else {
    el.style.left = `${box.x - 5}px`;
    el.style.width = `${box.width + 10}px`;
  }
  el.style.top = `${st.top - st.spacing * 2}px`;
  el.style.height = `${st.spacing * 8}px`;
  placeChordMark();
  if (scroll) revealInSheet(parseFloat(el.style.left), parseFloat(el.style.top), parseFloat(el.style.width), st.spacing * 8);
  updateSelection();
  updateStatus();
  announce(describeCursor());
}

/** What a screen reader hears when the cursor moves: bar, beat, staff and the note there. */
function describeCursor() {
  const ev = editor.current;
  const { m, s } = editor.cursor;
  if (!ev) return `Bar ${m + 1}`;
  const ctx = contextAt(editor.score, m);
  const beatTicks = (4 * TPQ) / ctx.beatType;
  let before = 0;
  for (let i = 0; i < editor.cursor.i; i++) before += ticks(editor.events[i]) * (TPQ / 4);
  const beat = Math.round((1 + before / beatTicks) * 100) / 100;
  const staves = editor.score.staves.length;
  const staff = staves > 1 ? `, ${partsOf(editor.score).length > 1 ? partOfStaff(editor.score, s).part.name + ' ' : ''}${editor.score.staves[s].clef} staff` : '';
  const len = `${ev.dots ? 'dotted ' : ''}${durationLabel(ev.type)}${ev.tuplet ? ' triplet' : ''}`;
  const what = ev.pitches.length
    ? `${len} ${ev.pitches.length > 1 ? 'chord ' : 'note '}${ev.pitches.map((p) => pitchName(p).replace('#', ' sharp').replace(/b(?=\d)/, ' flat')).join(', ')}`
    : `${len} rest`;
  const extras = [ev.harmony && `chord symbol ${ev.harmony}`, commentsAt(editor.score, m).some((c) => !c.resolved) && 'bar has comments']
    .filter(Boolean)
    .join(', ');
  return `Bar ${m + 1}, beat ${beat}${staff}${editor.voice ? `, voice ${editor.voice + 1}` : ''}: ${what}${extras ? `. ${extras}` : ''}`;
}

function updateSelection() {
  const host = $('selection');
  host.innerHTML = '';
  if (!layout || !editor.anchor) return;
  const groups = new Map<string, { m: number; s: number; ids: string[] }>();
  for (const x of editor.selected()) {
    const key = `${x.m}:${x.s}`;
    if (!groups.has(key)) groups.set(key, { m: x.m, s: x.s, ids: [] });
    groups.get(key)!.ids.push(x.e.id);
  }
  for (const { m, s, ids } of groups.values()) {
    const st = staveBox(m, s);
    if (!st) continue;
    const whole = ids.length === lane(editor.score, m, s, 0).length + lane(editor.score, m, s, 1).length;
    const boxes = ids.map((id) => layout!.events.get(id)).filter((b) => !!b);
    const left = whole ? st.noteStartX - 6 : Math.min(...boxes.map((b) => b.x)) - 5;
    const right = whole ? st.x + st.width - 4 : Math.max(...boxes.map((b) => b.x + b.width)) + 5;
    const r = document.createElement('div');
    r.className = 'sel-rect';
    r.style.left = `${left}px`;
    r.style.width = `${right - left}px`;
    r.style.top = `${st.top - st.spacing * 2}px`;
    r.style.height = `${st.spacing * 8}px`;
    host.append(r);
  }
}

const ticks = (e: { type: string; dots: number; tuplet?: { actual: number; normal: number } }) =>
  ({ w: 16, h: 8, q: 4, '8': 2, '16': 1, '32': 0.5, '64': 0.25 })[e.type as 'w']! *
  (e.dots ? 1.5 : 1) *
  (e.tuplet ? e.tuplet.normal / e.tuplet.actual : 1);

function durationLabel(t: string) {
  return ({ w: 'whole', h: 'half', q: 'quarter', '8': '8th', '16': '16th', '32': '32nd', '64': '64th' } as Record<string, string>)[t];
}

function updateStatus() {
  const ev = editor.current;
  const clef = editor.score.staves[editor.cursor.s]?.clef ?? '';
  const drums = editor.score.staves[editor.cursor.s]?.clef === 'percussion';
  const what = !ev ? '' : ev.pitches.length ? ev.pitches.map((p) => (drums ? drumAt(p).name : pitchName(p))).join(' + ') : t('rest');
  const paletteHint =
    editor.palette === 'notes'
      ? t('Tab: articulations / dynamics')
      : `${t('Number keys')}: ${t(editor.palette)} · ${t('Esc: back to notes')}`;
  $('status').innerHTML = `
    <span>${t('Bar')} <b>${editor.cursor.m + 1}</b> / ${editor.score.measures.length}</span>
    <span>${partsOf(editor.score).length > 1 ? `<b>${partOfStaff(editor.score, editor.cursor.s).part.name}</b> · ` : ''}${t('Staff')} <b>${t(clef)}</b>${editor.voice ? ` · <b class="v${editor.voice + 1}">${t('voice')} ${editor.voice + 1}</b>` : ''}</span>
    <span>${t('At cursor')} <b>${what}</b></span>
    ${editor.chordNote !== null && ev ? `<span class="chord-pick">${t('Chord note')} <b>${pitchName(ev.pitches[editor.chordNote])}</b> · ${t('Esc: whole chord')}</span>` : ''}
    <span>${t('Input')} <b>${t(durationLabel(editor.inputType))}${editor.inputDots ? ` ${t('dotted')}` : ''}${editor.inputTriplet ? ` ${t('triplet')}` : ''}</b></span>
    ${editor.anchor ? `<span>${t('Selected')} <b>${editor.selected().length}</b> · Ctrl+C / Ctrl+X / Delete</span>` : ''}
    ${midi.enabled ? `<span>MIDI <b>${midi.devices.join(', ') || t('no device')}</b></span>` : ''}
    ${ev && outOfRange(editor.score, editor.cursor.s, ev) ? `<span class="range-warn">⚠ ${outOfRange(editor.score, editor.cursor.s, ev)}</span>` : ''}
    ${practice?.current ? `<span class="practice-hint">🎹 Play <b>${midiNames(practice.current.expected)}</b> · ${practice.index + 1}/${practice.steps.length}</span>` : ''}
    <span>${t('Mode')} <b>${t(editor.tool === 'pencil' ? 'click to add notes' : 'keyboard')}</b></span>
    <span style="margin-left:auto">${paletteHint} · <kbd>?</kbd> ${t('all shortcuts')}</span>`;
}

function updatePlayButton() {
  const b = $('play');
  b.textContent = player.playing ? '■' : '▶';
  b.classList.toggle('playing', player.playing);
}

player.onEvent = (ev) => {
  const ph = $('playhead');
  updatePlayButton();
  if (!ev && recording && recording.startsAt !== Infinity) finishRecording(); // the score ended
  if (!ev || !layout) {
    ph.style.display = 'none';
    return;
  }
  const box = layout.events.get(ev.id);
  const first = staveBox(ev.m, 0);
  const last = staveBox(ev.m, editor.score.staves.length - 1);
  if (!box || !first || !last) return;
  ph.style.display = 'block';
  ph.style.left = `${box.x - 4}px`;
  ph.style.top = `${first.top - first.spacing}px`;
  ph.style.height = `${last.top - first.top + last.spacing * 6}px`;
  ph.scrollIntoView({ block: 'nearest' });
};

// ------------------------------------------------------------------ toolbar
function toolButton(cmd: Command, extraClass = '') {
  const b = document.createElement('button');
  b.className = `tool ${extraClass}`;
  b.innerHTML = `${cmd.icon ?? tLabel(cmd.label)}`;
  const key = cmd.keys?.[0];
  if (key && !key.includes('+')) b.innerHTML += `<small>${prettyKey(key)}</small>`;
  b.title = `${tLabel(cmd.label)}${key ? ` (${prettyKey(key)})` : ''}`;
  if (cmd.active?.(editor)) b.classList.add('active');
  b.onmousedown = (e) => e.preventDefault(); // keep keyboard focus on the score
  b.onclick = () => run(cmd);
  b.dataset.commandId = cmd.id;
  return b;
}

const byId = (id: string) => COMMANDS.find((c) => c.id === id)!;

function renderToolbar() {
  const bar = $('toolbar');
  bar.innerHTML = '';
  const group = (...nodes: HTMLElement[]) => {
    const g = document.createElement('div');
    g.className = 'group';
    g.append(...nodes);
    bar.append(g);
    return g;
  };

  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  for (const [p, label] of [['notes', 'Notes'], ['articulations', 'Articulations'], ['dynamics', 'Dynamics']] as const) {
    const tab = document.createElement('button');
    tab.className = `tab ${editor.palette === p ? 'active' : ''}`;
    tab.textContent = t(label);
    tab.title = 'Switch with Tab';
    tab.onmousedown = (e) => e.preventDefault();
    tab.onclick = () => editor.setPalette(p);
    tabs.append(tab);
  }
  group(tabs);

  if (editor.palette === 'notes') {
    group(
      ...['w', 'h', 'q', '8', '16', '32', '64'].map((d) => toolButton(byId(`duration-${d}`))),
      toolButton(byId('dot')),
      toolButton(byId('triplet')),
    );
    group(toolButton(byId('rest')), toolButton(byId('tie')), toolButton(byId('slur')), toolButton(byId('voice')), toolButton(byId('grace')));
    group(...['cresc', 'dim', 'pedal', '8va'].map((k) => toolButton(byId(`span-${k}`))));
    group(toolButton(byId('sharp')), toolButton(byId('flat')), toolButton(byId('natural')));
  } else if (editor.palette === 'articulations') {
    group(...ARTICULATIONS.map((a) => toolButton(byId(`art-${a.a}`))), toolButton(byId('tremolo')));
  } else {
    group(...DYNAMICS.map((d) => toolButton(byId(`dyn-${d}`), 'text')));
  }
  group(toolButton(byId('repeatStart')), toolButton(byId('repeatEnd')));
  group(
    toolButton(byId('barSettings')),
    toolButton(byId('rehearsal')),
    toolButton(byId('volta')),
    toolButton(byId('navMenu')),
    toolButton(byId('transpose')),
  );
  group(toolButton(byId('lyrics')), toolButton(byId('chords')), toolButton(byId('staffText')), toolButton(byId('comment')));
  group(toolButton(byId('accompaniment')), toolButton(byId('metronome')), toolButton(byId('countIn')), toolButton(byId('loop')));
  group(toolButton(byId('copy')), toolButton(byId('cut')), toolButton(byId('paste')));
  group(toolButton(byId('pencil')), toolButton(byId('pianoKeys'), pianoKeys.open ? 'active' : ''), toolButton(byId('undo')), toolButton(byId('redo')));
  $('scoreWrap').classList.toggle('pencil', editor.tool === 'pencil');
  $('midiBtn').classList.toggle('active', midi.enabled);
}

/** Small pop-up list of commands under a toolbar button (✓ marks the ones that are on). */
function showCommandMenu(anchor: HTMLElement, cmds: Command[]) {
  document.getElementById('cmdMenu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'cmdMenu';
  menu.className = 'cmd-menu';
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${r.left}px`;
  menu.style.top = `${r.bottom + 4}px`;
  for (const c of cmds) {
    const b = document.createElement('button');
    b.innerHTML = `<span class="tick">${c.active?.(editor) ? '✓' : ''}</span>${tLabel(c.label)}`;
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => {
      menu.remove();
      run(c);
    };
    menu.append(b);
  }
  document.body.append(menu);
  // keep the whole menu on screen: buttons near the right edge open it leftwards, and near the
  // bottom upwards; a menu taller than the window scrolls
  const gap = 8;
  const m = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(gap, Math.min(r.left, window.innerWidth - m.width - gap))}px`;
  if (r.bottom + 4 + m.height > window.innerHeight - gap) {
    const above = r.top - 4 - m.height;
    if (above >= gap) menu.style.top = `${above}px`;
    else {
      menu.style.top = `${gap}px`;
      menu.style.maxHeight = `${window.innerHeight - 2 * gap}px`;
    }
  }
  const close = (e: Event) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('keydown', close, true);
    }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', close, true);
    document.addEventListener('keydown', close, true);
  });
}

// ------------------------------------------------------------------ side panel
function syncSidePanel() {
  const s = editor.score;
  $<HTMLSelectElement>('key').value = String(s.keyFifths);
  $<HTMLInputElement>('beats').value = String(s.timeBeats);
  $<HTMLSelectElement>('beatType').value = String(s.timeBeatType);
  $<HTMLSelectElement>('staves').value = s.staves.map((x) => x.clef).join(',');
  const several = partsOf(s).length > 1;
  $('staves').closest('label')!.hidden = several; // ensembles are edited in the Instruments dialog
  $<HTMLInputElement>('transposedToggle').checked = !!s.transposedView;
  $<HTMLInputElement>('tempo').value = String(s.tempo);
  renderSoundPanel();
  renderMixer();
  const acc = s.accompaniment;
  $<HTMLInputElement>('accOn').checked = !!acc?.enabled;
  $<HTMLSelectElement>('accStyle').value = acc?.style ?? 'pop';
  $<HTMLSelectElement>('accSound').value = soundById(acc?.sound ?? 'piano').id;
  $('accOptions').classList.toggle('dim', !acc?.enabled);
}

function fillSoundSelect(sel: HTMLSelectElement) {
  for (const group of [...new Set(SOUNDS.map((x) => x.group))]) {
    const og = document.createElement('optgroup');
    og.label = group;
    for (const snd of SOUNDS.filter((x) => x.group === group)) {
      const o = document.createElement('option');
      o.value = snd.id;
      o.textContent = snd.name;
      og.append(o);
    }
    sel.append(og);
  }
}

function initAccompanimentPanel() {
  const style = $<HTMLSelectElement>('accStyle');
  for (const st of STYLES) {
    const o = document.createElement('option');
    o.value = st.id;
    o.textContent = st.name;
    style.append(o);
  }
  fillSoundSelect($<HTMLSelectElement>('accSound'));
  $<HTMLInputElement>('accOn').onchange = (e) => {
    const on = (e.target as HTMLInputElement).checked;
    editor.setAccompaniment({ enabled: on });
    if (on && !allEvents(editor.score).some((ev) => ev.harmony)) {
      toast('Add chord symbols with Ctrl+K: the accompaniment plays them');
    }
  };
  style.onchange = () => editor.setAccompaniment({ style: style.value as never, enabled: true });
  $<HTMLSelectElement>('accSound').onchange = (e) => {
    const id = (e.target as HTMLSelectElement).value;
    editor.setAccompaniment({ sound: id, enabled: true });
    void player.preview(demoChord('treble'), id);
  };
}

// ------------------------------------------------------------------ transpose dialog
function initTransposeDialog() {
  const sel = $<HTMLSelectElement>('transposeInterval');
  const add = (semitones: number, label: string) => {
    const o = document.createElement('option');
    o.value = String(semitones);
    o.textContent = label;
    sel.append(o);
  };
  for (const iv of [...INTERVALS].reverse()) add(iv.semitones, `Up a ${iv.name} (+${iv.semitones})`);
  for (const iv of INTERVALS) add(-iv.semitones, `Down a ${iv.name} (−${iv.semitones})`);
  sel.value = '2';
  sel.onchange = updateTransposePreview;
  $('transposeScope').onchange = updateTransposePreview;
  $<HTMLFormElement>('transposeForm').onsubmit = (e) => {
    e.preventDefault();
    const semis = parseInt(sel.value, 10);
    const whole = $<HTMLSelectElement>('transposeScope').value === 'score';
    hideModals();
    editor.transpose(semis, whole);
    toast(whole ? `Transposed to ${KEY_NAMES[editor.score.keyFifths]} major` : 'Selection transposed');
  };
  $('transposeModal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideModals();
  });
}

function updateTransposePreview() {
  const semis = parseInt($<HTMLSelectElement>('transposeInterval').value, 10);
  const whole = $<HTMLSelectElement>('transposeScope').value === 'score';
  const from = editor.score.keyFifths;
  $('transposePreview').textContent = whole
    ? `Key: ${KEY_NAMES[from]} major → ${KEY_NAMES[transposeKey(from, semis)]} major`
    : `Key stays ${KEY_NAMES[from]} major; selected notes and chord symbols move.`;
}

let soundPanelSig = '';
/** One sound picker per staff. Rebuilt only when staves or sounds change. */
const escapeHtml = (x: string) => x.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Volume, mute and solo per part (and for the chord accompaniment when it is on). */
function renderMixer() {
  const host = $('mixer');
  const s = editor.score;
  const rows = partsOf(s).map(({ part, start }) => ({ name: part.name || `Staff ${start + 1}`, staves: Array.from({ length: part.staves }, (_, k) => start + k) }));
  const row = (name: string, key: string, vol: number, mute: boolean, solo: boolean | null) =>
    `<div class="mix-row" data-key="${key}">
      <span class="mix-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
      <input type="range" min="0" max="150" step="5" value="${Math.round(vol * 100)}" aria-label="Volume of ${escapeHtml(name)}" />
      <button type="button" class="mix-btn ${mute ? 'on' : ''}" data-act="mute" title="Mute" aria-pressed="${mute}">M</button>
      ${solo === null ? '' : `<button type="button" class="mix-btn solo ${solo ? 'on' : ''}" data-act="solo" title="Solo" aria-pressed="${solo}">S</button>`}
    </div>`;
  host.innerHTML =
    rows.map((r, k) => row(r.name, `p${k}`, s.staves[r.staves[0]].volume ?? 1, !!s.staves[r.staves[0]].mute, !!s.staves[r.staves[0]].solo)).join('') +
    (s.accompaniment?.enabled ? row(t('Chord accompaniment'), 'acc', s.accompaniment.volume ?? 1, false, null) : '');
  host.querySelectorAll<HTMLElement>('.mix-row').forEach((el) => {
    const key = el.dataset.key!;
    const staves = key === 'acc' ? [] : rows[Number(key.slice(1))].staves;
    const set = (fn: (score: Score) => void) => {
      player.stop();
      editor.mutate(fn);
    };
    el.querySelector<HTMLInputElement>('input')!.addEventListener('change', (e) => {
      const v = Number((e.target as HTMLInputElement).value) / 100;
      set((score) => {
        if (key === 'acc') score.accompaniment!.volume = v;
        else for (const st of staves) score.staves[st].volume = v;
      });
    });
    el.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        const prop = b.dataset.act as 'mute' | 'solo';
        set((score) => {
          const on = !score.staves[staves[0]][prop];
          for (const st of staves) {
            if (on) score.staves[st][prop] = true;
            else delete score.staves[st][prop];
          }
        });
      }),
    );
  });
  $<HTMLInputElement>('reverb').value = String(Math.round((s.reverb ?? 0) * 100));
  $<HTMLInputElement>('swingToggle').checked = !!s.swing;
}

function initPracticeControls() {
  const tempo = $<HTMLInputElement>('practiceTempo');
  const out = $('practiceTempoOut');
  const show = () => (out.textContent = `${Math.round(practiceTempo * 100)}%`);
  tempo.value = String(Math.round(practiceTempo * 100));
  show();
  tempo.addEventListener('input', () => {
    practiceTempo = Number(tempo.value) / 100;
    show();
    try {
      localStorage.setItem(TEMPO_KEY, String(practiceTempo));
    } catch {
      /* storage blocked */
    }
  });
  tempo.addEventListener('change', () => {
    if (player.playing) player.stop(); // the next play uses the new speed
  });
  $<HTMLInputElement>('reverb').addEventListener('change', (e) => {
    const v = Number((e.target as HTMLInputElement).value) / 100;
    editor.mutate((score) => {
      if (v) score.reverb = v;
      else delete score.reverb;
    });
    player.setReverb(v);
  });
  $<HTMLInputElement>('swingToggle').addEventListener('change', () => run(byId('swing')));
}

function renderSoundPanel() {
  const staves = editor.score.staves;
  const sig = staves.map((st) => `${st.clef}:${soundById(st.sound).id}`).join(',');
  if (sig === soundPanelSig) return;
  soundPanelSig = sig;
  const host = $('sounds');
  host.innerHTML = '';
  staves.forEach((st, s) => {
    const label = document.createElement('label');
    label.textContent = staves.length > 1 ? `${t('Staff')} ${s + 1} (${t(st.clef)})` : t('Sound');
    const sel = document.createElement('select');
    fillSoundSelect(sel);
    sel.value = soundById(st.sound).id;
    sel.onchange = () => {
      editor.setStaffSound(s, sel.value);
      void player.preview(demoChord(st.clef), sel.value);
    };
    label.append(sel);
    host.append(label);
  });
}

function demoChord(clef: Clef): Pitch[] {
  // kick, snare and hi-hat together on a drum staff
  if (clef === 'percussion') return ['F4', 'C5', 'G5'].map((t) => ({ step: t[0] as Pitch['step'], alter: 0, octave: Number(t[1]) }));
  const o = clef === 'bass' ? 3 : 4;
  return [
    { step: 'C', alter: 0, octave: o },
    { step: 'E', alter: 0, octave: o },
    { step: 'G', alter: 0, octave: o },
  ];
}

function keyOptions(select: HTMLSelectElement) {
  for (let f = -7; f <= 7; f++) {
    const o = document.createElement('option');
    o.value = String(f);
    o.textContent = `${KEY_NAMES[f]} major${f === 0 ? ' (no sharps/flats)' : ` (${Math.abs(f)} ${f > 0 ? '♯' : '♭'})`}`;
    select.append(o);
  }
  select.value = '0';
}

function initSidePanel() {
  keyOptions($<HTMLSelectElement>('key'));
  keyOptions($<HTMLSelectElement>('newKey'));
  $<HTMLSelectElement>('key').onchange = (e) =>
    editor.mutate((s) => (s.keyFifths = parseInt((e.target as HTMLSelectElement).value, 10)));
  const time = () =>
    editor.mutate((s) => {
      s.timeBeats = Math.max(1, Math.min(16, parseInt($<HTMLInputElement>('beats').value, 10) || 4));
      s.timeBeatType = parseInt($<HTMLSelectElement>('beatType').value, 10);
      refitMeasures(s);
    });
  $('beats').onchange = time;
  $('beatType').onchange = time;
  $<HTMLSelectElement>('staves').onchange = (e) =>
    editor.mutate((s) => {
      const old = s.staves;
      delete s.parts; // a staff preset makes the score a single instrument again
      s.staves = (e.target as HTMLSelectElement).value
        .split(',')
        .map((c, k) => ({ clef: c as Clef, ...(old[k]?.sound ? { sound: old[k].sound } : {}) }));
      syncStaves(s);
    });
  $<HTMLInputElement>('tempo').onchange = (e) =>
    editor.mutate((s) => (s.tempo = Math.max(20, Math.min(300, parseInt((e.target as HTMLInputElement).value, 10) || 100))));
  $<HTMLInputElement>('title').onchange = (e) => editor.mutate((s) => (s.title = (e.target as HTMLInputElement).value));
  $<HTMLInputElement>('composer').onchange = (e) => editor.mutate((s) => (s.composer = (e.target as HTMLInputElement).value));
  // the two free-text notes; an empty one is removed from the score
  for (const key of ['headerNote', 'footerNote'] as const) {
    $<HTMLInputElement>(key).onchange = (e) =>
      editor.mutate((s) => {
        const text = (e.target as HTMLInputElement).value.trim();
        if (text) s[key] = text;
        else delete s[key];
      });
  }
  for (const input of ['title', 'composer', 'headerNote']) {
    $(input).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLElement).blur();
    });
  }
  // the footer may hold several lines: Escape (or Ctrl+Enter) finishes it
  $('footerNote').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) (e.target as HTMLElement).blur();
  });
}

// ------------------------------------------------------------------ lyrics & chord symbols
let textMode: 'lyric' | 'chord' | 'text' | null = null;
const textInput = () => $<HTMLInputElement>('textEntry');

function startText(kind: 'lyric' | 'chord' | 'text') {
  editor.clearSelection();
  if (kind === 'lyric' && (!editor.current || isRest(editor.current))) {
    const next = editor.neighbor(editor.cursor, 1, true);
    if (!next) {
      toast('Write some notes first, then add lyrics to them');
      return;
    }
    editor.setCursor(next);
  }
  textMode = kind;
  const input = textInput();
  input.hidden = false;
  input.classList.toggle('chord', kind === 'chord');
  input.classList.toggle('stafftext', kind === 'text');
  input.placeholder = kind === 'lyric' ? 'syllable' : kind === 'chord' ? 'e.g. Cmaj7' : 'e.g. dolce';
  loadTextValue();
  positionTextEntry();
  input.focus();
  input.select();
  toast(
    kind === 'lyric'
      ? `Lyrics, verse ${editor.lyricVerse}: Space = next note, - = hyphen, ↓ ↑ = other verse, Enter = done`
      : kind === 'chord'
        ? 'Chords: Space = next note, Enter = done (Cm7, F#dim, G/B…)'
        : 'Staff text: Enter = done, Tab = next note (spaces are allowed)',
  );
}

function loadTextValue() {
  const e = editor.current;
  textInput().value =
    (textMode === 'lyric' ? e && getLyric(e, editor.lyricVerse)?.text : textMode === 'text' ? e?.text : e?.harmony) ?? '';
  const badge = $('verseBadge');
  badge.hidden = textMode !== 'lyric';
  badge.textContent = `Verse ${editor.lyricVerse}`;
}

/** Save the box into the note under the cursor. `hyphen` undefined keeps the current one. */
function commitText(hyphen?: boolean) {
  const value = textInput().value;
  const c = { ...editor.cursor };
  if (textMode === 'lyric') {
    const cur = editor.current;
    const keep = hyphen ?? !!(cur && getLyric(cur, editor.lyricVerse)?.hyphen);
    editor.setLyric(c, value.trim() ? { text: value, hyphen: keep } : null);
  } else if (textMode === 'chord') {
    editor.setHarmony(c, value);
  } else if (textMode === 'text') {
    editor.setText(c, value);
  }
}

function moveText(dir: 1 | -1): boolean {
  const next = editor.neighbor(editor.cursor, dir, textMode === 'lyric');
  if (!next) return false;
  editor.setCursor(next);
  loadTextValue();
  positionTextEntry();
  textInput().select();
  return true;
}

function endText() {
  textMode = null;
  $('verseBadge').hidden = true;
  const input = textInput();
  input.hidden = true;
  input.blur();
}

function positionTextEntry() {
  if (!textMode || !layout) return;
  const e = editor.current;
  const box = e && layout.events.get(e.id);
  const st = staveBox(editor.cursor.m, editor.cursor.s);
  if (!box || !st) return;
  const input = textInput();
  input.style.left = `${box.x + box.width / 2 - 45}px`;
  // verse n sits one lyric line lower than verse n-1
  const lyricTop = st.top + st.spacing * 4 + 16 + (editor.lyricVerse - 1) * 19;
  input.style.top =
    textMode === 'lyric' ? `${lyricTop}px` : `${st.top - st.spacing * 2 - (textMode === 'text' ? 58 : 34)}px`;
  const badge = $('verseBadge');
  badge.style.left = input.style.left;
  badge.style.top = `${(textMode === 'lyric' ? lyricTop : 0) - 13}px`;
  input.scrollIntoView({ block: 'nearest' });
}

function initTextEntry() {
  const input = textInput();
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    // staff text may contain spaces: only Tab moves on
    if ((e.key === ' ' && textMode !== 'text') || (e.key === 'Tab' && !e.shiftKey) || e.key === 'ArrowRight') {
      if (e.key === 'ArrowRight' && input.selectionStart !== input.value.length) return;
      e.preventDefault();
      commitText(textMode === 'lyric' ? false : undefined);
      if (!moveText(1)) endText();
    } else if (e.key === '-' && textMode === 'lyric') {
      e.preventDefault();
      commitText(true);
      if (!moveText(1)) endText();
    } else if ((e.key === 'Tab' && e.shiftKey) || (e.key === 'ArrowLeft' && input.selectionStart === 0)) {
      e.preventDefault();
      commitText();
      moveText(-1);
    } else if (e.key === 'Backspace' && input.value === '') {
      e.preventDefault();
      commitText();
      moveText(-1);
    } else if (textMode === 'lyric' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      // switch verse on the same note
      e.preventDefault();
      const next = editor.lyricVerse + (e.key === 'ArrowDown' ? 1 : -1);
      if (next < 1 || next > MAX_VERSES) return;
      commitText();
      editor.setLyricVerse(next);
      loadTextValue();
      positionTextEntry();
      input.select();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitText();
      endText();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      endText();
    }
  });
  input.addEventListener('blur', () => {
    if (!textMode) return;
    commitText();
    endText();
  });
}

// ------------------------------------------------------------------ mouse
function hit(evt: MouseEvent) {
  if (!layout) return null;
  const rect = $('scoreWrap').getBoundingClientRect();
  const x = evt.clientX - rect.left;
  const y = evt.clientY - rect.top;
  const st = layout.staves.find(
    (b) => x >= b.x && x <= b.x + b.width && y >= b.top - b.spacing * 4 && y <= b.top + b.spacing * 8,
  );
  if (!st) return null;
  // which voice: pencil keeps the current one; otherwise the voice whose stems point to where
  // the click is (upper half: voices 1 and 3, lower half: 2 and 4), among those with notes here
  const bar = editor.score.measures[st.m];
  const withNotes = lanesOf(bar, st.s).filter(({ v, events }) => !v || events.some((e) => e.pitches.length)).map((l) => l.v);
  const lower = y > st.top + st.spacing * 2;
  const v =
    editor.tool === 'pencil'
      ? editor.cursor.s === st.s && laneOf(bar, st.s, editor.voice)
        ? editor.voice
        : 0
      : (withNotes.find((x) => x % 2 === (lower ? 1 : 0) && x === editor.voice) ??
        withNotes.find((x) => x % 2 === (lower ? 1 : 0)) ??
        0);
  const events = lane(editor.score, st.m, st.s, v);
  const boxes = events.map((e) => layout!.events.get(e.id)!);
  let i = 0;
  if (boxes.length > 1 && boxes.every((b) => b.x === boxes[0].x)) {
    // collapsed whole-bar rest: choose by horizontal proportion
    const total = events.reduce((a, e) => a + ticks(e), 0);
    const frac = (x - st.noteStartX) / (st.x + st.width - st.noteStartX);
    let acc = 0;
    for (i = 0; i < events.length - 1; i++) {
      acc += ticks(events[i]) / total;
      if (frac < acc) break;
    }
  } else {
    let best = Infinity;
    boxes.forEach((b, k) => {
      const d = Math.abs(b.x + b.width / 2 - x);
      if (d < best) {
        best = d;
        i = k;
      }
    });
  }
  const half = Math.round((y - st.top) / (st.spacing / 2));
  return { m: st.m, s: st.s, i, v, half, st, x };
}

function initMouse() {
  const wrap = $('scoreWrap');
  wrap.addEventListener('mousedown', (e) => {
    const h = hit(e);
    if (!h) return;
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur();
    if (editor.tool === 'pencil' && !e.shiftKey) editor.writePitchAt(h, editor.pitchAt(h.s, h.half));
    else {
      editor.setCursor(h, e.shiftKey);
      dragFrom = h;
      if (!e.shiftKey) pickChordNote(e);
    }
  });
  // drag across notes to select them (then Ctrl+C / the copy button, and paste elsewhere)
  let dragFrom: ReturnType<typeof hit> = null;
  window.addEventListener('mouseup', () => (dragFrom = null));
  wrap.addEventListener('mousemove', (e) => {
    if (dragFrom && e.buttons & 1) {
      const h = hit(e);
      const c = editor.cursor;
      if (h && (h.m !== c.m || h.s !== c.s || h.i !== c.i || (h.v ?? 0) !== (c.v ?? 0))) editor.setCursor(h, true);
    }
  });
  wrap.addEventListener('mousemove', (e) => {
    const g = $('ghost');
    const h = editor.tool === 'pencil' ? hit(e) : null;
    if (!h) {
      g.style.display = 'none';
      return;
    }
    g.style.display = 'block';
    g.style.left = `${h.x - 13}px`;
    g.style.top = `${h.st.top + (h.half * h.st.spacing) / 2 - 1}px`;
    g.querySelector('span')!.textContent = pitchName(editor.pitchAt(h.s, h.half));
  });
  wrap.addEventListener('mouseleave', () => ($('ghost').style.display = 'none'));
}

// ------------------------------------------------------------------ keyboard
function initKeyboard() {
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const typing = target.matches('input, textarea, select, [contenteditable="true"]');
    if (['searchModal', 'newModal', 'transposeModal', 'printModal', 'barModal', 'partsModal', 'commentsModal', 'checksModal', 'classesModal'].some((id) => !document.getElementById(id)?.hidden)) {
      return; // modal handles its own keys
    }
    if (!$('helpModal').hidden) {
      if (e.key === 'Escape' || e.key === '?') hideModals();
      return;
    }
    if (typing) return;
    const cmd = commandFor(comboOf(e), editor.palette);
    if (!cmd) return;
    e.preventDefault();
    run(cmd);
  });
}

// ------------------------------------------------------------------ modals
function showModal(id: string) {
  hideModals();
  $(id).hidden = false;
}
function hideModals() {
  closeSidePanel();
  for (const id of ['moreModal', 'helpModal', 'searchModal', 'newModal', 'transposeModal', 'printModal', 'barModal', 'partsModal', 'commentsModal', 'checksModal']) {
    $(id).hidden = true;
  }
}

// ------------------------------------------------------------------ recording from a MIDI keyboard
let recording: {
  startsAt: number;
  m: number;
  s: number;
  v: number;
  bpm: number;
  open: Map<number, { t: number; vel: number }>;
  notes: RawNote[];
  /** Recording from the microphone instead of a MIDI keyboard. */
  tracker?: NoteTracker;
} | null = null;

// ------------------------------------------------------------------ microphone: tuner and sung/played recording
const mic = new MicInput();
let tunerOn = false;
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

function showTuner(f: MicFrame | null) {
  const box = $('tuner');
  box.hidden = !f;
  if (!f) return;
  if (f.midi === null) {
    $('tunerNote').textContent = '–';
    $('tunerCents').textContent = 'listening…';
    $('tunerNeedle').style.left = '50%';
    box.classList.remove('in-tune');
    return;
  }
  const near = Math.round(f.midi);
  const cents = Math.round((f.midi - near) * 100);
  $('tunerNote').textContent = `${NOTE_NAMES[((near % 12) + 12) % 12]}${Math.floor(near / 12) - 1}`;
  $('tunerCents').textContent = `${cents > 0 ? '+' : ''}${cents} cents · ${f.freq!.toFixed(1)} Hz`;
  $('tunerNeedle').style.left = `${50 + cents}%`;
  box.classList.toggle('in-tune', Math.abs(cents) <= 5);
}

mic.onFrame = (f) => {
  showTuner(f);
  recording?.tracker?.push(f);
  practiceEars?.push(f);
};
// the on-screen piano plays into wait mode while it runs
pianoKeys.onNotes = (midis) => {
  if (!practice) return false;
  practiseChord(midis, 'piano');
  return true;
};

async function startMic(): Promise<boolean> {
  try {
    await mic.start();
    return true;
  } catch (err) {
    const name = (err as Error).name;
    toast(name === 'NotAllowedError' ? 'The microphone is blocked: allow it in the browser’s address bar, then try again.' : (err as Error).message);
    return false;
  }
}

function stopMicIfIdle() {
  if (!tunerOn && !recording?.tracker && !practiceEars) {
    mic.stop();
    showTuner(null);
  }
}

async function toggleTuner() {
  if (tunerOn) {
    tunerOn = false;
    stopMicIfIdle();
    return;
  }
  if (!(await startMic())) return;
  tunerOn = true;
  toast('Tuner on: sing or play a note (Ctrl+Alt+U turns it off)');
}

async function toggleMicRecording() {
  if (recording) return finishRecording();
  if (!(await startMic())) return;
  const { m, s } = editor.cursor;
  recording = { startsAt: Infinity, m, s, v: editor.voice, bpm: contextAt(editor.score, m).tempo, open: new Map(), notes: [], tracker: new NoteTracker() };
  updateRecordButton();
  // count-in clicks only: anything the speakers play would be recorded too
  const { musicStartsAt } = await player.play(editor.score, {
    fromId: editor.score.measures[m].staves[0][0]?.id,
    countIn: true,
    clicksOnly: true,
  });
  if (recording) recording.startsAt = musicStartsAt;
  toast('Listening: sing or play one line after the count-in. Space stops.');
}

async function toggleRecording() {
  if (recording) return finishRecording();
  if (!midi.enabled) {
    try {
      await midi.enable();
    } catch (err) {
      toast((err as Error).message);
      return;
    }
  }
  if (!midi.devices.length) {
    toast('No MIDI keyboard found. Connect one, then press Shift+R again.');
    return;
  }
  const { m, s } = editor.cursor;
  recording = { startsAt: Infinity, m, s, v: editor.voice, bpm: contextAt(editor.score, m).tempo, open: new Map(), notes: [] };
  updateRecordButton();
  const { musicStartsAt } = await player.play(editor.score, {
    fromId: editor.score.measures[m].staves[0][0]?.id,
    metronome: true,
    countIn: true,
  });
  if (recording) recording.startsAt = musicStartsAt;
  toast('Recording: play after the count-in. Shift+R or Space stops.');
}

function finishRecording() {
  const rec = recording;
  if (!rec) return;
  recording = null;
  player.stop();
  updateRecordButton();
  const now = performance.now();
  const toTicks = (t: number) => Math.round((((t - rec.startsAt) / 1000) * rec.bpm * TPQ) / 60);
  for (const [note, o] of rec.open) rec.notes.push({ start: toTicks(o.t), end: toTicks(now), midi: note, velocity: o.vel });
  if (rec.tracker) {
    rec.tracker.flush(now);
    for (const n of rec.tracker.notes) rec.notes.push({ start: toTicks(n.start), end: toTicks(n.end), midi: n.midi, velocity: n.velocity });
    stopMicIfIdle();
  }
  // notes played during the count-in (more than half a beat early) are ignored
  const notes = rec.notes.filter((n) => n.start > -TPQ / 2).map((n) => ({ ...n, start: Math.max(0, n.start) }));
  if (!notes.length) {
    toast('Nothing was recorded.');
    return;
  }
  editor.writeRecorded(rec.s, rec.m, notesToStream(notes, contextAt(editor.score, rec.m).key), rec.v);
  toast(`Recorded ${notes.length} ${notes.length === 1 ? 'note' : 'notes'} (Ctrl+Z to undo)`);
}

function updateRecordButton() {
  $('recBtn').classList.toggle('recording', !!recording);
  $('recBtn').textContent = recording ? '■ Stop' : '● Rec';
}

midi.onNote = (note, vel, on, time) => {
  if (!recording) return;
  const toTicks = (t: number) => Math.round((((t - recording!.startsAt) / 1000) * recording!.bpm * TPQ) / 60);
  if (on) recording.open.set(note, { t: time, vel });
  else {
    const o = recording.open.get(note);
    if (!o) return;
    recording.open.delete(note);
    recording.notes.push({ start: toTicks(o.t), end: toTicks(time), midi: note, velocity: o.vel });
  }
};

// ------------------------------------------------------------------ instruments (parts)
const TRANSPOSITIONS: [number, string][] = [
  [0, 'Concert pitch'],
  [2, 'in B♭ (sounds a 2nd lower)'],
  [9, 'in E♭ (sounds a 6th lower)'],
  [7, 'in F (sounds a 5th lower)'],
  [3, 'in A (sounds a 3rd lower)'],
  [14, 'in B♭, octave lower (tenor sax)'],
  [12, 'octave lower (guitar, bass)'],
  [-12, 'octave higher (piccolo)'],
];

function renderPartsList() {
  const host = $('partsList');
  const parts = partsOf(editor.score);
  host.innerHTML = parts
    .map(
      ({ part, index }) => `<div class="part-row" data-i="${index}">
        <input class="p-name" value="${part.name.replace(/"/g, '&quot;')}" aria-label="Name" maxlength="40" />
        <input class="p-short" value="${(part.short ?? '').replace(/"/g, '&quot;')}" aria-label="Short name" maxlength="12" />
        <span class="p-staves">${part.staves} ${part.staves === 1 ? 'staff' : 'staves'}</span>
        <select class="p-tr" aria-label="Transposition">${TRANSPOSITIONS.map(
          ([v, l]) => `<option value="${v}" ${(part.transpose ?? 0) === v ? 'selected' : ''}>${l}</option>`,
        ).join('')}</select>
        <button data-act="up" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button data-act="down" title="Move down" ${index === parts.length - 1 ? 'disabled' : ''}>↓</button>
        <button data-act="del" class="danger" title="Remove" ${parts.length === 1 ? 'disabled' : ''}>✕</button>
      </div>`,
    )
    .join('');
  host.querySelectorAll<HTMLElement>('.part-row').forEach((row) => {
    const i = Number(row.dataset.i);
    const name = row.querySelector<HTMLInputElement>('.p-name')!;
    const short = row.querySelector<HTMLInputElement>('.p-short')!;
    const rename = () => editor.renamePart(i, name.value, short.value);
    name.onchange = rename;
    short.onchange = rename;
    row.querySelector<HTMLSelectElement>('.p-tr')!.onchange = (e) =>
      editor.setPartTranspose(i, Number((e.target as HTMLSelectElement).value));
    row.querySelector<HTMLButtonElement>('[data-act=up]')!.onclick = () => {
      editor.movePart(i, -1);
      renderPartsList();
    };
    row.querySelector<HTMLButtonElement>('[data-act=down]')!.onclick = () => {
      editor.movePart(i, 1);
      renderPartsList();
    };
    row.querySelector<HTMLButtonElement>('[data-act=del]')!.onclick = () => {
      const label = partsOf(editor.score)[i]?.part.name;
      if (!confirm(`Remove “${label}” and all its music? (Ctrl+Z undoes it.)`)) return;
      editor.removePart(i);
      renderPartsList();
    };
  });
}

function initInstruments() {
  const sel = $<HTMLSelectElement>('partAddSelect');
  for (const group of [...new Set(INSTRUMENTS.map((x) => x.group))]) {
    const og = document.createElement('optgroup');
    og.label = group;
    for (const ins of INSTRUMENTS.filter((x) => x.group === group)) {
      const o = document.createElement('option');
      o.value = ins.id;
      o.textContent = ins.name;
      og.append(o);
    }
    sel.append(og);
  }
  $('partAddBtn').onclick = () => {
    editor.addPart(sel.value);
    renderPartsList();
    toast(`${INSTRUMENTS.find((x) => x.id === sel.value)?.name} added`);
  };
  $('partsModal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideModals();
    e.stopPropagation();
  });
  $<HTMLInputElement>('transposedToggle').onchange = () => editor.toggleTransposedView();
}

// ------------------------------------------------------------------ bar settings (changes at a bar)
function showBarSettings() {
  const m = editor.cursor.m;
  const ctx = contextAt(editor.score, m);
  const bar = editor.score.measures[m];
  $('barTitle').textContent = `Bar ${m + 1}`;
  const key = $<HTMLSelectElement>('barKey');
  if (!key.options.length) keyOptions(key);
  key.value = String(ctx.key);
  $<HTMLInputElement>('barBeats').value = String(ctx.beats);
  $<HTMLSelectElement>('barBeatType').value = String(ctx.beatType);
  $<HTMLInputElement>('barBpm').value = String(ctx.tempo);
  $<HTMLInputElement>('barTempoText').value = bar.tempo?.text ?? '';
  $<HTMLInputElement>('barRehearsal').value = bar.rehearsal ?? '';
  const clefs = $('barClefs');
  clefs.innerHTML = editor.score.staves
    .map(
      (_, s) => `<label>Clef, staff ${s + 1} <select data-staff="${s}">
        ${['treble', 'bass', 'alto'].map((c) => `<option value="${c}" ${ctx.clefs[s] === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select></label>`,
    )
    .join('');
  $('barHint').textContent =
    m === 0
      ? 'Bar 1 sets the starting key, time, clef and tempo of the whole score.'
      : 'Changes start at this bar and last until the next change. Setting the same value as before removes the change.';
  showModal('barModal');
  key.focus();
}

function initBarSettings() {
  $<HTMLFormElement>('barForm').onsubmit = (e) => {
    e.preventDefault();
    const m = editor.cursor.m;
    const bpm = parseInt($<HTMLInputElement>('barBpm').value, 10) || 100;
    const text = $<HTMLInputElement>('barTempoText').value.trim();
    const before = m > 0 ? contextAt(editor.score, m - 1) : null;
    editor.setBarChanges(m, {
      key: parseInt($<HTMLSelectElement>('barKey').value, 10),
      time: {
        beats: Math.max(1, Math.min(16, parseInt($<HTMLInputElement>('barBeats').value, 10) || 4)),
        beatType: parseInt($<HTMLSelectElement>('barBeatType').value, 10),
      },
      // a tempo mark only when the tempo changes here or a tempo word is given
      tempo: text || (before ? before.tempo !== bpm : true) ? { bpm, ...(text ? { text } : {}) } : null,
      rehearsal: $<HTMLInputElement>('barRehearsal').value || null,
    });
    $('barClefs')
      .querySelectorAll<HTMLSelectElement>('select')
      .forEach((sel) => editor.setBarChanges(m, { clef: { s: Number(sel.dataset.staff), clef: sel.value as Clef } }));
    hideModals();
    toast(`Bar ${m + 1} updated`);
  };
  $('barClear').onclick = () => {
    const m = editor.cursor.m;
    editor.setBarChanges(m, { key: null, time: null, tempo: null, rehearsal: null });
    editor.score.staves.forEach((_, s) => editor.setBarChanges(m, { clef: { s, clef: null } }));
    hideModals();
    toast(`Changes removed from bar ${m + 1}`);
  };
  $('barModal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideModals();
    e.stopPropagation();
  });
}

// ------------------------------------------------------------------ print / PDF
function printSource() {
  const what = $<HTMLSelectElement>('printWhat').value;
  return what === 'score' ? editor.score : extractPart(editor.score, Number(what));
}

function fillPrintPages(host: HTMLElement) {
  const pages = buildPrintPages(printSource());
  host.replaceChildren(...pages);
  // the printer page must match the chosen paper size
  const size = PAGE_SIZES[editor.score.print?.pageSize ?? 'a4'];
  $('pageStyle').textContent = `@page { size: ${size.css}; margin: 0; }`;
  return pages.length;
}

const ISSUE_ICON: Record<Issue['kind'], string> = { range: '🎚', length: '⏱', tie: '⌒', slur: '⌒', line: '〰', empty: '∅' };

function showChecks() {
  const issues = checkScore(editor.score);
  showModal('checksModal');
  $('checksSummary').textContent = issues.length
    ? `${issues.length} ${issues.length === 1 ? 'thing' : 'things'} to look at. Click one to go there.`
    : 'Everything looks right: bars add up, notes are in range, ties and lines are complete.';
  $('checksList').innerHTML = issues
    .slice(0, 200)
    .map((x, k) => `<li><button type="button" data-k="${k}"><span aria-hidden="true">${ISSUE_ICON[x.kind]}</span> ${escapeHtml(x.message)}${editor.score.staves.length > 1 ? ` <span class="hint">· ${escapeHtml(partOfStaff(editor.score, x.s).part.name || `staff ${x.s + 1}`)}</span>` : ''}</button></li>`)
    .join('');
  $('checksList').querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
    b.addEventListener('click', () => {
      const x = issues[Number(b.dataset.k)];
      hideModals();
      editor.setCursor({ m: x.m, s: x.s, i: x.i ?? 0, v: x.v ?? 0 });
      $('score').focus();
    }),
  );
}

function showPrintPreview() {
  player.stop();
  showModal('printModal');
  // a reminder of anything that might look wrong on paper
  const issues = checkScore(editor.score);
  $('printChecks').hidden = !issues.length;
  $('printChecks').textContent = `⚠ ${issues.length} ${issues.length === 1 ? 'thing' : 'things'} to check`;
  $('printChecks').onclick = () => showChecks();
  const p = editor.score.print;
  $<HTMLSelectElement>('pageSize').value = p?.pageSize ?? 'a4';
  $<HTMLSelectElement>('staffSize').value = String(p?.scale ?? 0.8);
  const what = $<HTMLSelectElement>('printWhat');
  const parts = partsOf(editor.score);
  what.innerHTML =
    '<option value="score">Full score</option>' +
    (parts.length > 1 ? parts.map(({ part, index }) => `<option value="${index}">Part: ${part.name}</option>`).join('') : '');
  refreshPrintPreview();
}

function refreshPrintPreview() {
  const n = fillPrintPages($('printPreview'));
  $('printInfo').textContent = `${n} ${n === 1 ? 'page' : 'pages'} · ${PAGE_SIZES[editor.score.print?.pageSize ?? 'a4'].name}`;
}

function initPrint() {
  const onChange = () => {
    editor.setPrint({
      pageSize: $<HTMLSelectElement>('pageSize').value as 'a4' | 'letter',
      scale: parseFloat($<HTMLSelectElement>('staffSize').value),
    });
    refreshPrintPreview();
  };
  $('pageSize').onchange = onChange;
  $('printWhat').onchange = () => refreshPrintPreview();
  $('staffSize').onchange = onChange;
  $('printNow').onclick = () => {
    fillPrintPages($('printPages'));
    hideModals();
    toast('In the print dialog choose “Save as PDF” to get a PDF file');
    setTimeout(() => window.print(), 50);
  };
  $('printModal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideModals();
  });
  // the browser's own File > Print also gets the paginated layout
  window.addEventListener('beforeprint', () => fillPrintPages($('printPages')));
}

/** Small ↵ / ⤓ markers after bars with a manual line or page break (screen only). */
function updateBreakMarkers() {
  const host = $('breakMarks');
  host.innerHTML = '';
  if (!layout) return;
  editor.score.measures.forEach((bar, m) => {
    if (!bar.lineBreak && !bar.pageBreak) return;
    const st = staveBox(m, 0);
    if (!st) return;
    const mark = document.createElement('div');
    mark.className = 'break-mark';
    mark.textContent = bar.pageBreak ? '⤓ page' : '↵';
    mark.title = bar.pageBreak ? 'Page break (Ctrl+Alt+Enter to remove)' : 'Line break (Ctrl+Enter to remove)';
    mark.style.left = `${st.x + st.width + 3}px`;
    mark.style.top = `${st.top - st.spacing * 2}px`;
    host.append(mark);
  });
}

// ------------------------------------------------------------------ comments on bars
function commentAuthor() {
  return cloud.user?.name ?? localStorage.getItem('pianissimo:author') ?? 'You';
}

function updateCommentMarkers() {
  const host = $('commentMarks');
  host.innerHTML = '';
  if (!layout) return;
  editor.score.measures.forEach((bar, m) => {
    const list = bar.comments ?? [];
    if (!list.length) return;
    const st = staveBox(m, 0);
    if (!st) return;
    const open = list.filter((c) => !c.resolved).length;
    const mark = document.createElement('button');
    mark.className = `comment-mark ${open ? '' : 'resolved'}`;
    mark.textContent = `💬${open || list.length > 1 ? ` ${open || list.length}` : ''}`;
    mark.title = `${open} open ${open === 1 ? 'comment' : 'comments'} on bar ${m + 1}: ${list[0].text.slice(0, 60)}`;
    mark.setAttribute('aria-label', mark.title);
    mark.style.left = `${st.x + st.width - 34}px`;
    mark.style.top = `${st.top - st.spacing * 2 - 26}px`;
    mark.addEventListener('mousedown', (e) => e.preventDefault());
    mark.addEventListener('click', () => openComments(m));
    host.append(mark);
  });
}

function openComments(m: number) {
  commentBar = m;
  showModal('commentsModal');
  renderComments();
  $<HTMLTextAreaElement>('commentText').value = '';
  $<HTMLTextAreaElement>('commentText').focus();
}

function renderComments() {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const list = commentsAt(editor.score, commentBar);
  $('commentsHint').textContent = `Bar ${commentBar + 1}. Comments are saved with the score and shared with it; they are not printed or exported.`;
  const row = (c: (typeof list)[number], m: number, withBar: boolean) => `
    <div class="comment ${c.resolved ? 'resolved' : ''}" data-id="${c.id}" data-m="${m}">
      <div class="comment-head"><b>${esc(c.author)}</b><span>${withBar ? `bar ${m + 1} · ` : ''}${new Date(c.at).toLocaleString()}</span></div>
      <p>${esc(c.text)}</p>
      <div class="comment-actions">
        ${withBar ? '<button data-act="go">Go to bar</button>' : ''}
        <button data-act="resolve">${c.resolved ? 'Reopen' : 'Resolve'}</button>
        <button data-act="delete" class="danger">Delete</button>
      </div>
    </div>`;
  $('commentsList').innerHTML = list.length ? list.map((c) => row(c, commentBar, false)).join('') : '<p class="hint">No comments on this bar yet.</p>';
  const open = allComments(editor.score).filter((x) => !x.c.resolved && x.m !== commentBar);
  $('commentsAll').innerHTML = open.length ? open.map((x) => row(x.c, x.m, true)).join('') : '<p class="hint">No other open comments.</p>';
  document.querySelectorAll<HTMLElement>('#commentsModal .comment').forEach((el) => {
    const id = el.dataset.id!;
    const m = Number(el.dataset.m);
    const c = commentsAt(editor.score, m).find((x) => x.id === id)!;
    el.querySelector('[data-act=go]')?.addEventListener('click', () => {
      hideModals();
      editor.setCursor({ m, s: 0, i: 0 });
    });
    el.querySelector('[data-act=resolve]')!.addEventListener('click', () => {
      editor.mutate((score) => setResolved(score, id, !c.resolved));
      renderComments();
    });
    el.querySelector('[data-act=delete]')!.addEventListener('click', () => {
      editor.mutate((score) => removeComment(score, id));
      renderComments();
    });
  });
}

function initComments() {
  $<HTMLFormElement>('commentForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $<HTMLTextAreaElement>('commentText').value;
    if (!text.trim()) return;
    editor.mutate((score) => addComment(score, commentBar, commentAuthor(), text));
    $<HTMLTextAreaElement>('commentText').value = '';
    renderComments();
    announce('Comment added');
  });
  $('commentText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $<HTMLFormElement>('commentForm').requestSubmit();
  });
  $('commentsModal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideModals();
  });
}

// ------------------------------------------------------------------ view settings, templates
function initViewSettings() {
  const theme = $<HTMLSelectElement>('themeSelect');
  theme.value = themeChoice();
  theme.onchange = () => setTheme(theme.value as ThemeChoice);
  const lang = $<HTMLSelectElement>('langSelect');
  lang.innerHTML = LANGUAGES.map((l) => `<option value="${l.id}">${l.name}</option>`).join('');
  lang.value = currentLang();
  lang.onchange = () => {
    setLang(lang.value as Lang);
    if (cloud.user) void api.setLanguage(lang.value).catch(() => {});
    updateAccountUI();
    renderHelp();
    renderAll(); // toolbar, side panel and status bar are built in code
  };
  const keys = $<HTMLInputElement>('keysToggle');
  keys.checked = pianoKeys.open;
  keys.onchange = () => {
    pianoKeys.toggle(keys.checked);
    renderAll();
  };
  $('pianoKeysHost').replaceWith(pianoKeys.el);
  // phones and tablets: show the on-screen keyboard the first time
  if (matchMedia('(pointer: coarse)').matches && localStorage.getItem('pianissimo:keys') === null) {
    pianoKeys.toggle(true);
    keys.checked = true;
  }
}

function initTemplates() {
  $('templateList').innerHTML = TEMPLATES.map(
    (t) => `<button type="button" class="template" data-id="${t.id}">
      <span class="template-icon" aria-hidden="true">${t.icon}</span>
      <b>${t.name}</b><span>${t.description}</span>
    </button>`,
  ).join('');
  $('templateList').querySelectorAll<HTMLButtonElement>('.template').forEach((b) =>
    b.addEventListener('click', () => {
      const t = TEMPLATES.find((x) => x.id === b.dataset.id)!;
      hideModals();
      player.stop();
      editor.load(t.make());
      cloud.detach();
      toast(`“${t.name}” template loaded (Ctrl+Z returns to your previous score)`);
    }),
  );
}

function renderHelp() {
  const groups = new Map<string, Command[]>();
  for (const c of COMMANDS) {
    if (!c.keys?.length || /^(note|chord|interval)[A-G2-8]$/.test(c.id)) continue;
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group)!.push(c);
  }
  const notes = `<section><h4>${t('Writing notes')}</h4>
    <div><span>${t('Write note')}</span><span><kbd>A</kbd>…<kbd>G</kbd></span></div>
    <div><span>${t('Add note to chord')}</span><span><kbd>Shift</kbd>+<kbd>A</kbd>…<kbd>G</kbd></span></div>
    <div><span>${t('Add interval above')}</span><span><kbd>Alt</kbd>+<kbd>2</kbd>…<kbd>8</kbd></span></div></section>`;
  $('helpGrid').innerHTML =
    notes +
    [...groups]
      .map(
        ([g, cmds]) =>
          `<section><h4>${t(g)}</h4>${cmds
            .map(
              (c) =>
                `<div><span>${tLabel(c.label)}${c.palette ? ` <span class="palette-note">(${t(c.palette)} ${t('tab')})</span>` : ''}</span><span>${c
                  .keys!.slice(0, 2)
                  .map((k) => `<kbd>${prettyKey(k)}</kbd>`)
                  .join(' ')}</span></div>`,
            )
            .join('')}</section>`,
      )
      .join('');
}

let searchHits: Command[] = [];
let searchSel = 0;
function renderSearch(q: string) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  searchHits = COMMANDS.filter((c) =>
    words.every((w) => `${c.label} ${c.group} ${tLabel(c.label)} ${t(c.group)}`.toLowerCase().includes(w)),
  ).slice(0, 40);
  searchSel = Math.min(searchSel, Math.max(0, searchHits.length - 1));
  $('searchList').innerHTML = searchHits
    .map(
      (c, k) =>
        `<li data-k="${k}" class="${k === searchSel ? 'sel' : ''}">${tLabel(c.label)}<span>${c.keys?.[0] ? prettyKey(c.keys[0]) : ''}</span></li>`,
    )
    .join('');
}

function initModals() {
  renderHelp();
  document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => (b.onclick = hideModals));
  document.querySelectorAll<HTMLElement>('.modal').forEach((m) =>
    m.addEventListener('mousedown', (e) => {
      if (e.target === m) hideModals();
    }),
  );
  const input = $<HTMLInputElement>('searchInput');
  input.oninput = () => {
    searchSel = 0;
    renderSearch(input.value);
  };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') searchSel = Math.min(searchHits.length - 1, searchSel + 1);
    else if (e.key === 'ArrowUp') searchSel = Math.max(0, searchSel - 1);
    else if (e.key === 'Escape') return hideModals();
    else if (e.key === 'Enter') {
      const c = searchHits[searchSel];
      hideModals();
      if (c) run(c);
      return;
    } else return;
    e.preventDefault();
    renderSearch(input.value);
  };
  $('searchList').onmousedown = (e) => {
    const li = (e.target as HTMLElement).closest('li');
    if (!li) return;
    e.preventDefault();
    const c = searchHits[Number(li.dataset.k)];
    hideModals();
    if (c) run(c);
  };
  $('newModal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideModals();
  });
  $<HTMLFormElement>('newForm').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const [beats, beatType] = String(f.get('time')).split('/').map(Number);
    const picked = String(f.get('staves'));
    const common = {
      title: String(f.get('title') || 'Untitled score'),
      composer: String(f.get('composer') || ''),
      keyFifths: Number(f.get('key')),
      timeBeats: beats,
      timeBeatType: beatType,
      tempo: Number(f.get('tempo')) || 100,
      measures: Math.max(1, Math.min(500, Number(f.get('measures')) || 8)),
    };
    const score = picked.startsWith('parts:')
      ? scoreFromInstruments(picked.slice(6).split(','), common, (o) => newScore(o))
      : newScore({
      title: String(f.get('title') || 'Untitled score'),
      composer: String(f.get('composer') || ''),
      keyFifths: Number(f.get('key')),
      timeBeats: beats,
      timeBeatType: beatType,
      tempo: Number(f.get('tempo')) || 100,
      measures: Math.max(1, Math.min(500, Number(f.get('measures')) || 8)),
      staves: String(f.get('staves'))
        .split(',')
        .map((pair) => {
          const [clef, sound] = pair.split(':');
          return { clef: clef as Clef, ...(sound ? { sound } : {}) };
        }),
    });
    hideModals();
    player.stop();
    editor.load(score);
    cloud.detach();
    toast('New score: type A–G to start writing');
  };
  // header buttons
  document.querySelectorAll<HTMLElement>('[data-cmd]').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => run(byId(b.dataset.cmd!)));
  });
}

// ------------------------------------------------------------------ boot
// Several changes in one command (or fast key repeats) become a single layout pass per frame.
let renderQueued = 0;
function queueRender() {
  if (renderQueued) return;
  renderQueued = requestAnimationFrame(() => {
    renderQueued = 0;
    renderAll();
  });
}
editor.subscribe((kind) => {
  if (kind === 'score') queueRender();
  else if (renderQueued) return; // the queued render updates the cursor and toolbar too
  else if (kind === 'cursor') updateCursor();
  else {
    renderToolbar();
    updateCursor(false);
  }
});

// Only a width change needs a new layout: on phones the height changes whenever the browser bar
// slides in or out, or the on-screen keyboard opens, and re-engraving then would make scrolling jerky.
let resizeTimer = 0;
let laidOutWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth === laidOutWidth) return;
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    laidOutWidth = window.innerWidth;
    renderAll();
  }, 150);
});

// ------------------------------------------------------------------ phones
// Below 820px the file buttons and side panel do not fit. The top bar keeps Play and tempo and adds
// two buttons: ⚙︎ slides the side panel up as a sheet and ⋯ opens an action sheet with the rest.
const MORE_GROUPS = [
  ['new', 'open', 'save', 'share', 'library'],
  ['print', 'exportXml', 'exportMidi', 'exportWav', 'exportPng', 'exportSvg', 'download', 'history'],
  ['recordMic', 'midi', 'record', 'classes'],
  ['search', 'help', 'tutorial'],
];
function openSidePanel() {
  hideModals();
  $('side').classList.add('open');
  $('sideScrim').hidden = false;
  $('panelBtn').setAttribute('aria-expanded', 'true');
  $('sideDone').focus();
}
function closeSidePanel() {
  if (!$('side').classList.contains('open')) return;
  $('side').classList.remove('open');
  $('sideScrim').hidden = true;
  $('panelBtn').setAttribute('aria-expanded', 'false');
}
function openMoreSheet() {
  const known = new Set(COMMANDS.map((c) => c.id));
  $('moreList').innerHTML = MORE_GROUPS.map(
    (ids) =>
      `<div class="sheet-group">${ids
        .filter((id) => known.has(id))
        .map((id) => `<button type="button" data-more="${id}">${escapeHtml(tLabel(byId(id).label))}</button>`)
        .join('')}</div>`,
  ).join('');
  hideModals();
  $('moreModal').hidden = false;
  $('moreList').querySelector<HTMLElement>('button')?.focus();
}
function initPhone() {
  // phones: the panel is a sheet; wider screens: the same button folds the panel away so the music gets the room
  const phone = () => matchMedia('(max-width: 820px)').matches;
  const fold = (collapsed: boolean) => {
    document.body.classList.toggle('side-collapsed', collapsed);
    if (!phone()) $('panelBtn').setAttribute('aria-expanded', String(!collapsed));
    try {
      localStorage.setItem('pianissimo:sideCollapsed', collapsed ? '1' : '0');
    } catch {
      /* private mode */
    }
  };
  let stored: string | null = null;
  try {
    stored = localStorage.getItem('pianissimo:sideCollapsed');
  } catch {
    /* private mode */
  }
  fold(stored === '1');
  $('panelBtn').addEventListener('click', () => {
    if (!phone()) {
      fold(!document.body.classList.contains('side-collapsed'));
      renderAll(); // the sheet is wider or narrower now
      return;
    }
    if ($('side').classList.contains('open')) closeSidePanel();
    else openSidePanel();
  });
  $('sideDone').addEventListener('click', closeSidePanel);
  $('sideScrim').addEventListener('click', closeSidePanel);
  $('side').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('side').classList.contains('open')) closeSidePanel();
  });
  $('moreBtn').addEventListener('click', openMoreSheet);
  $('moreList').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-more]');
    if (!b) return;
    hideModals();
    run(byId(b.dataset.more!));
  });
  $('moreModal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideModals();
  });
  // Drop-down menus open on hover or focus on a desktop. iOS does not focus a tapped button, so a tap toggles them too.
  document.querySelectorAll<HTMLElement>('.menu-trigger').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const menu = trigger.closest('.menu')!;
      const open = !menu.classList.contains('open');
      document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
      menu.classList.toggle('open', open);
    });
  });
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    document.querySelectorAll('.menu.open').forEach((m) => {
      if (!m.contains(t) || t.closest('.menu-list button')) m.classList.remove('open');
    });
  });
}

initSidePanel();
initMouse();
initKeyboard();
initModals();
initPhone();
initTextEntry();
initAccompanimentPanel();
initTransposeDialog();
initPrint();
initBarSettings();
initInstruments();
initComments();
initViewSettings();
initTemplates();
initPracticeControls();
enhanceDialogs();
labelIconButtons();
translatePage();
// the toolbar shows the length of the note the cursor starts on (a restored score)
editor.setCursor(editor.cursor);
document.fonts.ready.then(renderAll);
// first visit: offer the tutorial
if (!Tutorial.seen && !/[?&](import|file|tutorial|template|join|open|class)\b/.test(location.search)) {
  setTimeout(() => toast('New here? Open “Start the tutorial” in the side panel for a 2-minute tour.'), 1200);
}
if (new URLSearchParams(location.search).has('tutorial')) {
  history.replaceState(null, '', location.pathname);
  setTimeout(() => tutorial.start(), 300);
}

// ------------------------------------------------------------------ account & cloud library
/** The account whose email language was last sent to the server. */
let languageSentFor = 0;

function updateAccountUI() {
  bell?.update();
  // emails are written in the language the person uses here
  if (cloud.user && languageSentFor !== cloud.user.id) {
    languageSentFor = cloud.user.id;
    void api.setLanguage(currentLang()).catch(() => {});
  }
  const signedIn = !!cloud.user;
  // without a server (the desktop app on its own) there is nothing to sign in to: scores stay on this computer
  $('signInBtn').hidden = signedIn || !cloud.serverAvailable;
  $('accountMenu').hidden = !signedIn;
  if (cloud.user) $('accountName').textContent = `👤 ${cloud.user.name} ▾`;
  // offer a new confirmation link while the address is not confirmed (and the server can send it)
  $('verifyEmailBtn').hidden = !cloud.user || cloud.user.verified !== false || !cloud.mailAvailable;
  const status = cloud.status;
  const el = $('cloudStatus');
  el.textContent = status === 'Saved' || status === 'Saved on this computer' ? `✓ ${t(status)}` : t(status);
  el.className = `cloud-status ${status === 'Unsaved changes' || status.startsWith('Offline') ? 'dirty' : ''}`;
}
cloud.onChange = updateAccountUI;
liveUi = initLive(editor, cloud, {
  toast,
  layout: () => layout,
  cursorHost: () => $('cursor').parentElement!,
  indicator: () => $('liveStatus'),
});
$('signInBtn').addEventListener('click', () => cloud.showAuth());
$('signOutBtn').addEventListener('click', () => void cloud.signOut());
$('myDataBtn').addEventListener('click', () => void cloud.downloadMyData());
$('changePasswordBtn').addEventListener('click', () => cloud.changePassword());
$('verifyEmailBtn').addEventListener('click', () => void cloud.resendVerification());
$('deleteAccountBtn').addEventListener('click', () => void cloud.deleteAccount());
classes = initClasses(cloud, { toast, scoreTitle: () => editor.score.title });
bell = initNotifications(cloud, {
  openScore: (id) => void cloud.openScore(id),
  openClass: (id) => void classes!.open(id),
});
void cloud.init().then(() => {
  // app.html?join=CODE: a class invitation
  const params = new URLSearchParams(location.search);
  const code = params.get('join');
  if (code) {
    history.replaceState(null, '', location.pathname);
    void classes!.joinFromLink(code);
  }
  // app.html?class=<id>: a class (from a notification or its email)
  const cls = Number(params.get('class'));
  if (cls) {
    history.replaceState(null, '', location.pathname);
    void classes!.open(cls);
  }
  // app.html?open=<id>: a score from the library (e.g. a remix just made on a score page)
  const open = Number(params.get('open'));
  if (open) {
    history.replaceState(null, '', location.pathname);
    if (cloud.user) void cloud.openScore(open);
    else cloud.showAuth('Sign in to open this score from your library.', () => cloud.openScore(open));
  }
});

// a score handed over by the public viewer ("Open in editor")
if (new URLSearchParams(location.search).has('import')) {
  const raw = localStorage.getItem('pianissimo:import');
  localStorage.removeItem('pianissimo:import');
  history.replaceState(null, '', location.pathname);
  try {
    const imported = raw ? JSON.parse(raw) : null;
    if (isValidScore(imported)) {
      editor.load(imported);
      cloud.detach();
      toast(`“${imported.title}” copied into the editor (Ctrl+Z returns to your previous score)`);
    }
  } catch {
    /* ignore a broken hand-over */
  }
}
// installed app: files opened from the desktop ("Open with Pianissimo") arrive through the launch queue
type LaunchParams = { files: { getFile(): Promise<File> }[] };
(window as unknown as { launchQueue?: { setConsumer(fn: (p: LaunchParams) => void): void } }).launchQueue?.setConsumer(
  async (params) => {
    const handle = params.files[0];
    if (handle) await openScoreFile(await handle.getFile());
  },
);
registerServiceWorker();

// The desktop launcher (desktop/) opens double-clicked files as app.html?file=/__open/<id>/<name>.
// Only that same-origin path is accepted, so a link can't make the editor fetch anything else.
{
  const src = new URLSearchParams(location.search).get('file');
  if (src && /^\/__open\/[a-f0-9]{32}\/[^/]+$/.test(src)) {
    history.replaceState(null, '', location.pathname);
    void fetch(src)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((blob) => openScoreFile(new File([blob], decodeURIComponent(src.split('/').pop()!))))
      .catch((err) => toast(`Could not open the file: ${(err as Error).message}`));
  }
}

// app.html?template=lead-sheet opens a template straight away (links from the website)
{
  const id = new URLSearchParams(location.search).get('template');
  const tpl = id && TEMPLATES.find((x) => x.id === id);
  if (tpl) {
    history.replaceState(null, '', location.pathname);
    editor.load(tpl.make());
    cloud.detach();
  }
}
renderAll();
