# Flat (flat.io) Desktop: Reverse-Engineering Assessment

Target: `FlatTutteoLtd.Flat-Musicnotationeditor` v26.11.22482.0 (MSIX, x64), installed at
`C:\Program Files\WindowsApps\FlatTutteoLtd.Flat-Musicnotationeditor_26.11.22482.0_x64__czehczssptv9y`.
Method: static analysis only (REA `analyze_javascript_application` + targeted string extraction). The app was not run.
REA evidence: `ev_fdd3d6688cc46d59ef2ef57e1e974ee0d6485075853c0a9baf9e7cd6219acf64` (main process + package.json; 3,186 other files inventoried but not semantically analyzed).

> This document records how Flat works so we can build **our own** editor. We do not reuse Flat's code, bundles,
> fonts (Eugene, flat-icons), icons, or WASM. Everything in Pianissimo is built from open-source parts.

## 1. Architecture (observed)

| Layer | What Flat uses | Evidence |
|---|---|---|
| Shell | Electron 45, built with electron-vite / Vite 8 | `package.json` |
| UI | Vue 3.5 + Pinia + vue-router, LESS | `package.json` devDependencies |
| Score model + engraving | Private `@flat/adagio` (v39) engine, rendering to **SVG (`createElementNS`) and Canvas 2D** | `package.json`; renderer bundles |
| Document format | **"Adagio JSON" = MusicXML `score-partwise` converted to JSON** (`parts → measures → notes`, `pitch{step,octave,alter}`, `duration`, `tie`, `slur`, `lyrics`, `harmony`, …) | `AdagioToMxl-*.js` |
| Interop | MusicXML (.musicxml/.mxl) + MIDI import/export, PDF via pdf.js, audio export (MP3 via LAME) | AppxManifest file associations; `AdagioToMxl`, `AdagioToAudio`, `mp3lame.dll` |
| Playback | `@flat/score-player` compiled to **WASM** (`flat_score_player_web_bg.wasm`, 2.6 MB) + native `flat-audio-engine.exe` with soundfonts | renderer assets; `resources/audio` |
| Sheet-music scanning (OMR) | ONNX Runtime Web (`ort-wasm-simd-threaded.wasm`, 11 MB) + `scoreImportWorker.mjs` | renderer assets; `omrImport` window |
| Local storage | SQLite (`better-sqlite3`, `@flat/rt-sqlite`), cloud sync over socket.io | `package.json`; IPC `sync:*`, `rt-storage:dispatch` |
| Music fonts | Bravura (SMuFL), Petaluma (handwritten style), Flat's own Eugene | `out/renderer/fonts`; bundle names |

Main ↔ renderer IPC (≈75 literal channels, all `ipcMain.handle`) groups into: `editor:*` (save, saveAs, printPDF, exportSave),
`score:*` (open, open-file, fetch-revision), `audio:*` (exportRender, getSoundfonts), `omrImport:*`, `sync:*`, `settings:*`,
`auth:*`, `upgrade:*`/`credits:*` (payments), and `dev:*` debug tools.

## 2. Why Flat feels easy: the command system (observed)

Every editing operation is a **named action in a declarative registry**, e.g.:

```json
"toggleNoteC": { "groups": ["pub","rw","note","addNote"], "actionTarget": "note", "actionType": "toggle",
                 "requirements": { "isPitchedPart": true },
                 "defaultKbShortcuts": { "shortcuts": ["KeyC"], "staff": "pitched" } }
```

One registry drives the toolbar buttons, keyboard shortcuts, permissions (`ro`/`rw`), context requirements, and analytics.
176 actions carry default shortcuts. Key patterns:

- **Cursor-based entry**: a cursor sits on the staff. Letter `A–G` writes that pitch at the cursor (nearest octave) and advances;
  `Shift+A–G` adds a note to the previous chord; `Alt+2…8` adds an interval above.
- **Duration first**: `Numpad1–7` = whole → 64th, `NumpadDecimal` = dot, `Numpad8` = rest, `Numpad9` = grace note.
- **Edit in place**: `↑/↓` diatonic step, `Ctrl+↑/↓` octave, `=`/`-`/`0` sharp/flat/natural, `J` enharmonic, `,` tie, `S` slur,
  `Shift+3/5/…` tuplets, `R` repeat selection, `V` change voice.
- **Contextual number row**: `Digit1–9` change meaning based on the active toolbar
  (main / articulations: staccato, tenuto… / dynamics: ppp…sfz / ornaments), switched with `Ctrl+Numpad1–6`.
- **Modes**: lyrics (`Ctrl+L`), chord symbols (`Ctrl+K`), text annotations (`Ctrl+E`), MIDI-keyboard input (`Shift+M`), live MIDI recording (`Shift+R`).
- **Playback** always one key away: `Space` play/stop, `Ctrl+Space` from start, `L` loop.

Full extracted table: scratchpad `flat_actions.json` (reference only).

## 3. Unknowns / not verified

- Engraving/layout algorithms inside `@flat/adagio` were not decompiled; only their inputs/outputs are known.
- Runtime behavior (e.g., exact cursor-advance rules, auto-fill of incomplete measures with rests) was inferred from action names, not observed.
- The renderer bundles were string-searched, not fully graph-analyzed.

## 4. Pianissimo build plan (design choices, not observations)

Open-source equivalents for each Flat layer:

| Flat layer | Pianissimo choice |
|---|---|
| Adagio JSON | Our own JSON model mirroring MusicXML (clean, typed), with MusicXML import/export |
| Adagio engraver | **VexFlow 5** (SVG, MIT) for interactive editing; optionally Verovio (LGPL) for print-quality PDF |
| Bravura/Petaluma | Bravura + Petaluma are SIL OFL (free to bundle) |
| score-player WASM | **Tone.js** + General MIDI soundfonts (e.g., FluidR3 via `soundfont-player`/`smplr`) |
| Action registry | Our own declarative command registry → toolbar + shortcuts + command palette |
| MIDI in | Web MIDI API |
| OMR | Later phase: Audiveris (GPL, server-side) or oemer (MIT, ONNX) |
| Shell | Web app first (runs from XAMPP), Electron/PWA wrapper later |

MVP scope: single/multi-staff piano score; cursor + keyboard entry (A–G, durations, accidentals, ties, dots, rests);
mouse click-to-place; undo/redo; playback with cursor follow; save/load JSON; MusicXML + MIDI + PDF export.
