import './styles.css';
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
import { allEvents, lane, laneOf, newScore, refitMeasures, syncStaves } from './model/score';
import { isRest, type Clef, type Pitch, type Score } from './model/types';
import { renderScore, type Layout } from './render/renderer';
import { addComment, allComments, commentsAt, removeComment, setResolved } from './model/comments';
import { TEMPLATES } from './model/templates';
import { announce, enhanceDialogs, labelIconButtons } from './ui/a11y';
import { currentLang, LANGUAGES, setLang, translatePage, type Lang } from './ui/i18n';
import { PianoKeys } from './ui/pianoKeys';
import { initTheme, setTheme, themeChoice, toggleTheme, type ThemeChoice } from './ui/theme';
import { Tutorial } from './ui/tutorial';

initTheme();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const editor = new Editor();
const player = new Player();
editor.onPreview = (p, s) => void player.preview(p, editor.score.staves[s]?.sound);
player.onLoading = (name, failed) => {
  if (name && failed) toast(`Couldn't load “${name}” (offline?). Using a synth sound for now.`);
  else if (name) toast(`Loading ${name}…`);
};
const midi = new MidiInput();
const cloud = new Cloud(editor, (m) => toast(m), (s) => {
  player.stop();
  editor.load(s);
});
midi.onChord = (notes) => {
  if (!recording) editor.writeMidi(notes); // while recording, notes are collected with their timing instead
};
midi.onChange = () => {
  renderToolbar();
  updateStatus();
};

let layout: Layout | null = null;
const pianoKeys = new PianoKeys(editor, (m) => announce(m));
const tutorial = new Tutorial(editor, () => player.playing, (m) => announce(m, 400));
let commentBar = 0;

// ------------------------------------------------------------------ helpers
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
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

function isValidScore(x: any): x is Score {
  return x && x.version === 1 && Array.isArray(x.measures) && Array.isArray(x.staves);
}

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
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        if (/\.midi?$/i.test(file.name)) {
          const imported = midiToScore(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.midi?$/i, ''));
          player.stop();
          editor.load(imported);
          cloud.forget();
          toast(`Imported “${imported.title}” from MIDI (quantised to 16ths and triplets)`);
          return;
        }
        const text = /\.mxl$/i.test(file.name) ? await readMxl(await file.arrayBuffer()) : await file.text();
        let score: Score;
        if (text.trimStart().startsWith('{')) {
          const parsed = JSON.parse(text);
          if (!isValidScore(parsed)) throw new Error('Not a Pianissimo score file.');
          score = parsed;
        } else {
          score = fromMusicXML(text);
        }
        player.stop();
        editor.load(score);
        cloud.forget(); // a file is not (yet) in the library
        toast(`Opened “${score.title}”`);
      } catch (err) {
        toast(`Could not open file: ${(err as Error).message}`);
      }
    };
    input.click();
  },
  async saveFile() {
    if (await cloud.save()) toast('Saved to your library');
  },
  downloadFile() {
    download(JSON.stringify(editor.score, null, 1), `${fileBase()}.pianissimo.json`, 'application/json');
    toast('Backup downloaded (your work is also auto-saved in this browser)');
  },
  openLibrary() {
    void cloud.openLibrary();
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

// ------------------------------------------------------------------ rendering
function sheetWidth() {
  return Math.min(1100, $('sheetScroll').clientWidth - 48);
}

function renderAll() {
  layout = renderScore($('score'), editor.score, sheetWidth());
  $<HTMLInputElement>('title').value = editor.score.title;
  $<HTMLInputElement>('composer').value = editor.score.composer;
  syncSidePanel();
  updateCursor();
  renderToolbar();
  positionTextEntry();
  updateBreakMarkers();
  updateCommentMarkers();
}

function staveBox(m: number, s: number) {
  return layout?.staves.find((b) => b.m === m && b.s === s);
}

function updateCursor(scroll = true) {
  const el = $('cursor');
  const { m, s } = editor.cursor;
  const ev = editor.current;
  const box = ev && layout?.events.get(ev.id);
  const st = staveBox(m, s);
  if (!box || !st) {
    el.style.display = 'none';
    return;
  }
  const allSame = editor.events.every((e) => layout!.events.get(e.id)?.x === box.x);
  el.style.display = 'block';
  el.classList.toggle('voice2', editor.voice === 1);
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
  if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
  return `Bar ${m + 1}, beat ${beat}${staff}${editor.voice ? ', voice 2' : ''}: ${what}${extras ? `. ${extras}` : ''}`;
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
  const what = !ev ? '' : ev.pitches.length ? ev.pitches.map(pitchName).join(' ') : 'rest';
  const paletteHint =
    editor.palette === 'notes' ? 'Tab: articulations / dynamics' : `Number keys: ${editor.palette} · Esc: back to notes`;
  $('status').innerHTML = `
    <span>Bar <b>${editor.cursor.m + 1}</b> / ${editor.score.measures.length}</span>
    <span>${partsOf(editor.score).length > 1 ? `<b>${partOfStaff(editor.score, editor.cursor.s).part.name}</b> · ` : ''}Staff <b>${clef}</b>${editor.voice ? ' · <b class="v2">voice 2</b>' : ''}</span>
    <span>At cursor <b>${what}</b></span>
    <span>Input <b>${durationLabel(editor.inputType)}${editor.inputDots ? ' dotted' : ''}${editor.inputTriplet ? ' triplet' : ''}</b></span>
    ${editor.anchor ? `<span>Selected <b>${editor.selected().length}</b> · Ctrl+C / Ctrl+X / Delete</span>` : ''}
    ${midi.enabled ? `<span>MIDI <b>${midi.devices.join(', ') || 'no device'}</b></span>` : ''}
    <span>Mode <b>${editor.tool === 'pencil' ? 'click to add notes' : 'keyboard'}</b></span>
    <span style="margin-left:auto">${paletteHint} · <kbd>?</kbd> all shortcuts</span>`;
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
  b.innerHTML = `${cmd.icon ?? cmd.label}`;
  const key = cmd.keys?.[0];
  if (key && !key.includes('+')) b.innerHTML += `<small>${prettyKey(key)}</small>`;
  b.title = `${cmd.label}${key ? ` (${prettyKey(key)})` : ''}`;
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
    const t = document.createElement('button');
    t.className = `tab ${editor.palette === p ? 'active' : ''}`;
    t.textContent = label;
    t.title = 'Switch with Tab';
    t.onmousedown = (e) => e.preventDefault();
    t.onclick = () => editor.setPalette(p);
    tabs.append(t);
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
    group(...ARTICULATIONS.map((a) => toolButton(byId(`art-${a.a}`))));
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
    b.innerHTML = `<span class="tick">${c.active?.(editor) ? '✓' : ''}</span>${c.label}`;
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => {
      menu.remove();
      run(c);
    };
    menu.append(b);
  }
  document.body.append(menu);
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
function renderSoundPanel() {
  const staves = editor.score.staves;
  const sig = staves.map((st) => `${st.clef}:${soundById(st.sound).id}`).join(',');
  if (sig === soundPanelSig) return;
  soundPanelSig = sig;
  const host = $('sounds');
  host.innerHTML = '';
  staves.forEach((st, s) => {
    const label = document.createElement('label');
    label.textContent = staves.length > 1 ? `Staff ${s + 1} (${st.clef})` : 'Sound';
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
  for (const input of ['title', 'composer']) {
    $(input).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLElement).blur();
    });
  }
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
  // which voice: pencil keeps the current one; otherwise voice 2 if the click is in the lower half
  // of a staff whose voice 2 has notes in this bar
  const v2 = laneOf(editor.score.measures[st.m], st.s, 1);
  const v =
    editor.tool === 'pencil'
      ? v2 && editor.cursor.s === st.s
        ? editor.voice
        : 0
      : v2 && v2.some((e) => e.pitches.length) && y > st.top + st.spacing * 2
        ? 1
        : 0;
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
    else editor.setCursor(h, e.shiftKey);
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
    if (['searchModal', 'newModal', 'transposeModal', 'printModal', 'barModal', 'partsModal', 'commentsModal'].some((id) => !$(id).hidden)) {
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
  for (const id of ['helpModal', 'searchModal', 'newModal', 'transposeModal', 'printModal', 'barModal', 'partsModal', 'commentsModal']) {
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
} | null = null;

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

function showPrintPreview() {
  player.stop();
  showModal('printModal');
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
    updateStatus();
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
      cloud.forget();
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
  const notes = `<section><h4>Writing notes</h4>
    <div><span>Write note</span><span><kbd>A</kbd>…<kbd>G</kbd></span></div>
    <div><span>Add note to chord</span><span><kbd>Shift</kbd>+<kbd>A</kbd>…<kbd>G</kbd></span></div>
    <div><span>Add interval above</span><span><kbd>Alt</kbd>+<kbd>2</kbd>…<kbd>8</kbd></span></div></section>`;
  $('helpGrid').innerHTML =
    notes +
    [...groups]
      .map(
        ([g, cmds]) =>
          `<section><h4>${g}</h4>${cmds
            .map(
              (c) =>
                `<div><span>${c.label}${c.palette ? ` <span class="palette-note">(${c.palette} tab)</span>` : ''}</span><span>${c
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
  searchHits = COMMANDS.filter((c) => words.every((w) => `${c.label} ${c.group}`.toLowerCase().includes(w))).slice(0, 40);
  searchSel = Math.min(searchSel, Math.max(0, searchHits.length - 1));
  $('searchList').innerHTML = searchHits
    .map(
      (c, k) =>
        `<li data-k="${k}" class="${k === searchSel ? 'sel' : ''}">${c.label}<span>${c.keys?.[0] ? prettyKey(c.keys[0]) : ''}</span></li>`,
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
    cloud.forget();
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

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(renderAll, 150);
});

initSidePanel();
initMouse();
initKeyboard();
initModals();
initTextEntry();
initAccompanimentPanel();
initTransposeDialog();
initPrint();
initBarSettings();
initInstruments();
initComments();
initViewSettings();
initTemplates();
enhanceDialogs();
labelIconButtons();
translatePage();
document.fonts.ready.then(renderAll);
// first visit: offer the tutorial
if (!Tutorial.seen && !/[?&](import|tutorial)\b/.test(location.search)) {
  setTimeout(() => toast('New here? Open “Start the tutorial” in the side panel for a 2-minute tour.'), 1200);
}
if (new URLSearchParams(location.search).has('tutorial')) {
  history.replaceState(null, '', location.pathname);
  setTimeout(() => tutorial.start(), 300);
}

// ------------------------------------------------------------------ account & cloud library
function updateAccountUI() {
  const signedIn = !!cloud.user;
  $('signInBtn').hidden = signedIn;
  $('accountMenu').hidden = !signedIn;
  if (cloud.user) $('accountName').textContent = `👤 ${cloud.user.name} ▾`;
  const status = cloud.status;
  const el = $('cloudStatus');
  el.textContent = status === 'Saved' ? '✓ Saved' : status;
  el.className = `cloud-status ${status === 'Unsaved changes' ? 'dirty' : ''}`;
}
cloud.onChange = updateAccountUI;
$('signInBtn').addEventListener('click', () => cloud.showAuth());
$('signOutBtn').addEventListener('click', () => void cloud.signOut());
void cloud.init();

// a score handed over by the public viewer ("Open in editor")
if (new URLSearchParams(location.search).has('import')) {
  const raw = localStorage.getItem('pianissimo:import');
  localStorage.removeItem('pianissimo:import');
  history.replaceState(null, '', location.pathname);
  try {
    const imported = raw ? JSON.parse(raw) : null;
    if (isValidScore(imported)) {
      editor.load(imported);
      cloud.forget();
      toast(`“${imported.title}” copied into the editor (Ctrl+Z returns to your previous score)`);
    }
  } catch {
    /* ignore a broken hand-over */
  }
}
renderAll();
