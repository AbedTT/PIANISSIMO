# Pianissimo

A keyboard-first music notation editor for the browser, with a public website, a cloud library and share links. You type music the way you type text: pick a note length, press a letter, keep going.

Built with [VexFlow](https://www.vexflow.com/) (engraving, SMuFL Bravura font), [Tone.js](https://tonejs.github.io/) (playback) and a small PHP API. See [docs/ROADMAP.md](docs/ROADMAP.md) for what is done and what comes next, and [docs/flat-analysis.md](docs/flat-analysis.md) for the research behind the design.

## What's in the box

| Page | URL | What it is |
|---|---|---|
| Website | `index.html` | Home with a live, playable demo score, plus Guide, Explore, About, Privacy and Terms pages |
| Editor | `app.html` | The notation editor |
| Viewer | `view.html?s=<link id>` | Public, read-only page for a shared score (play, print, MusicXML, open in editor). Without `?s=` it opens a local MusicXML file |
| Profile | `profile.html?u=<id>` | A person's public scores and likes |
| Embed | `embed.html?s=<link id>` | Compact player for an `<iframe>` on another site (the share dialog gives the code) |
| API | `server/api/index.php/...` | Accounts, cloud library, sharing, editors (PHP 8.1+, SQLite or MySQL) |
| Realtime | `realtime/server.mjs` | Optional live co-editing service (Node, no dependencies) |

## Run it (development)

```bash
npm install
npm run api        # PHP API on http://localhost:8000 (uses php from PATH or XAMPP's php.exe)
npm run dev        # site + editor on http://localhost:5173 (proxies /server to the API)
npm test           # unit tests + API integration tests (the API test is skipped if PHP is missing)
npm run build      # production build into dist/
npm run e2e        # end-to-end tests in headless Chrome against dist/ (set CHROME_PATH if Chrome is not found)
npm run lint       # type-check the app and the tests, then the project rules in scripts/lint.mjs
```

In development, `npm run api` writes emails (password reset and confirmation links) to `server/data/dev-mail.log` instead of sending them.

Live co-editing in development: start `PIANISSIMO_REALTIME_SECRET=dev-secret-0123456789 npm run realtime`. Start the API with the same secret and `PIANISSIMO_REALTIME_URL=ws://localhost:8090`.

The production build is an installable app (PWA) that keeps working offline.

The editor works without the API; only sign-in, the library and sharing need it.

> Windows: run `npm test` from a path with an upper-case drive letter (`C:\xampp\...`). A lower-case `c:\` cwd makes vitest load twice and every suite fails with "Cannot read properties of undefined (reading 'config')".

## Deploy

**XAMPP (or any Apache + PHP host).** Run `npm run build`, then open `http://localhost/Pianissimo/dist/`. The pages call the API at `../server/api/index.php`, so keep `dist/` and `server/` side by side.
- `server/lib` and `server/data` are protected by `.htaccess` (`Require all denied`), so Apache needs `AllowOverride All`, which is XAMPP's default.
- On other servers, block those two folders yourself.

**Database.** The default is SQLite, created automatically at `server/data/pianissimo.sqlite`. To use MySQL, create a database and user, then add `server/config.local.php`:

```php
<?php return [
  'db_dsn'  => 'mysql:host=127.0.0.1;dbname=pianissimo;charset=utf8mb4',
  'db_user' => 'pianissimo',
  'db_pass' => 'change-me',
];
```

The tables are created on the first request.

**Email.** Set up a mail service (SMTP) before opening sign-ups: it is how people reset a forgotten password. See [docs/DEPLOY.md](docs/DEPLOY.md#6-email-accounts-and-admins).

**HTTPS.** Serve over HTTPS in production. The session cookie is marked `Secure` automatically, and is always `HttpOnly` and `SameSite=Lax`. Every write needs the CSRF token.

**Full guide.** See [docs/DEPLOY.md](docs/DEPLOY.md) for Nginx, the production checklist and CI.

**Other layouts.** If the API lives elsewhere, set `window.PIANISSIMO_API = 'https://…/server/api/index.php'` before the page scripts.

**Desktop app.** `npm run package` builds three installers in `release/`: a Windows setup `.exe`, a portable Windows zip, and a macOS/Linux `.tar.gz` with an install script. No extra tools are needed. See [docs/INSTALL.md](docs/INSTALL.md).

## Writing music

| Do this | Keys |
|---|---|
| Choose note length (whole … 64th) | `1`–`7` or numpad `1`–`7`; `.` for a dotted note; `Shift`+`3` for triplets |
| Write a note at the cursor | `A`–`G` (the octave nearest the previous note is chosen) |
| Rest | `0` |
| Build a chord | `Shift`+`A`–`G`, or `Alt`+`2`–`8` to add an interval above |
| Move the note | `↑` `↓` by step, `Ctrl`+`↑` `↓` by octave |
| Sharp / flat / natural | `=` `-` `N` (press again to undo); `J` respells |
| Two voices on one staff | `V` switches the cursor between voice 1 (stems up, blue cursor) and voice 2 (stems down, orange cursor) at the same beat; type the second line as usual. `Ctrl`+`Shift`+`V` removes voice 2 from the bar or selected bars |
| Tie / slur | `,` / `S` (a slur goes to the next note, or covers the selection) |
| Select | `Shift`+arrows (`Shift`+`↑` `↓` adds staves), `Ctrl`+`Shift`+`←` `→` by bar, `Ctrl`+`A` all, `Shift`+click |
| Copy / cut / paste | `Ctrl`+`C` / `X` / `V` (pastes at the cursor; `Delete` clears the selection) |
| Transpose selection | `↑` `↓` by step, `Ctrl`+`↑` `↓` by octave; accidentals and articulations also apply to the whole selection |
| Repeat barlines | `[` start, `]` end (playback takes each repeat once) |
| Lyrics | `Ctrl`+`L`, then type a syllable: `Space` = next note, `-` = hyphen to the next syllable, `↓` / `↑` = next / previous verse (up to 8, labelled 1., 2., …), `Enter` = done, `Backspace` on an empty box = previous note |
| Chord symbols | `Ctrl`+`K`, then type `Cmaj7`, `F#m7b5`, `G/B`…: `Space` = next note/rest, `Enter` = done |
| Instrument sound | **Sounds** in the side panel: one sound per staff, about 30 instruments (strings, winds, brass, guitars, mallets, organ, choir…) plus offline synths |
| Chord accompaniment | `Alt`+`A` (or *Chord accompaniment* in the side panel): the chord symbols play as a backing in one of 5 styles (block, pop, arpeggio, waltz, guitar strum) with its own sound |
| Practice | `Alt`+`M` metronome, `Alt`+`C` one-bar count-in, `L` loop. With notes selected, `Space` plays (and loops) just the selection |
| 1st / 2nd endings | `Ctrl`+`]` cycles the bar (or selected bars) through 1st ending → 2nd ending → none; playback follows them |
| D.C. / D.S. / Coda / Fine | The 𝄋 toolbar menu (or search "D.S."): Segno, Coda, To Coda, Fine and the six D.C./D.S. jumps; playback follows them |
| Transpose | `Alt`+`T`: whole score (key signature and chord symbols too) or just the selection; `Alt`+`Shift`+`↑` `↓` moves notes by a semitone |
| MIDI keyboard | `Shift`+`M` or the 🎹 button: play keys to write notes; keys pressed together become a chord (Chrome or Edge) |
| Articulations / dynamics | `Tab` switches the number row to articulations, then dynamics; `Esc` goes back |
| Click notes in with the mouse | `I` toggles pencil mode |
| Move around | `←` `→`, `Ctrl`+`←` `→` by bar, `Alt`+`↑` `↓` between staves |
| Play | `Space` (from the cursor's bar), `Ctrl`+`Space` from the start |
| Layout | `Ctrl`+`Enter` line break after the bar, `Ctrl`+`Alt`+`Enter` page break (shown as ↵ / ⤓ markers on screen) |
| Bar settings | `Alt`+`B` (or **Bar** in the toolbar): key, time, tempo, clef and rehearsal mark from this bar on |
| Hairpins / pedal / 8va | `<` `>` `Ped` `8va` in the toolbar, over a selection |
| Grace notes, tuplets | Grace note before the cursor note; triplets plus duplets, quintuplets and sextuplets from the command search |
| Staff text | `Ctrl`+`E` (*dolce*, *rit.*, *swing*…) |
| Instruments | **🎻 Instruments…** in the side panel: named parts, order, transposition; *Transposed score* shows what players read |
| On-screen keyboard | `Shift`+`K` (or 🎹 in the toolbar): tap keys to write notes, with lengths, rest, dot and chord mode. Opens automatically on touch screens |
| Record from a MIDI keyboard | `Shift`+`R`: count-in, then play with the metronome; `Shift`+`R` or `Space` stops and the take is quantised into the score |
| Comment on a bar | `Ctrl`+`Alt`+`M` (or 💬): add, resolve or delete review comments |
| Dark mode | `Ctrl`+`Alt`+`D`, or *Theme* in the side panel (follows the system by default) |
| Language | *Language* in the side panel: English, Français, Español, Deutsch |
| Learn the basics | *Start the tutorial* in the side panel, or open `app.html?tutorial` |
| Everything else | `?` lists every shortcut; `Ctrl`+`Shift`+`P` or `F1` searches commands |

Entry overwrites, like Flat and MuseScore. Every bar (and every voice) always adds up to the time signature:
- Notes replace what is under the cursor, and leftover space is filled with rests.
- A note too long for the space left in the bar is split across the bar line and tied.
- Typing past the last bar adds a new bar.
- Leftover rests are tidied into the fewest beat-aligned values (two eighth rests on a beat become a quarter rest).

## Files

- **Cloud library**: sign in, then `Ctrl`+`S` saves to **My scores**. Changes then sync automatically a few seconds after you stop editing.
- **Share** (`Alt`+`S`): *private*, *anyone with the link* (unlisted) or *public* (listed on Explore). The link opens the viewer page.
- **Backup file**: `Ctrl`+`Shift`+`S` downloads `.pianissimo.json` (the full model). The current score is also autosaved in the browser.
- **MusicXML**: export, and import of `.musicxml`, `.xml` and compressed `.mxl` files, including triplets, slurs and repeats (opens in MuseScore, Flat, Finale, Sibelius, Dorico).
- **MIDI**: export, with one channel and General MIDI program per staff (plus the chord accompaniment on its own channel when it is on).
- **MusicXML** also carries lyrics (syllabic), chord symbols (`<harmony>`) and each staff's instrument.
- **New from a template**: **New** (`Alt`+`N`) offers a gallery: blank piano, lead sheet, waltz, 12-bar blues, scale exercise, SATB chorale and string quartet.
- **MIDI import**: open a `.mid` file. It is quantised to 16ths or triplets per beat, with one part per track and wide piano tracks on a grand staff.
- **Audio / image export**: *Export → Audio (.wav)* renders offline (built-in synths are used if the samples cannot be downloaded). *Image (.png / .svg)* saves the whole score as one picture.
- **Version history**: *Export → Version history…* (`Ctrl`+`Alt`+`H`) lists earlier saves of a library score and restores one (`Ctrl`+`Z` undoes it).
- **Editing in two places**: if the score was saved from another tab or device, a clean editor updates itself. With unsaved changes you are asked which version to keep; the other one stays in the history.
- **Edit together**: in the share dialog, invite people by their account email. The score appears in their library. When the realtime service runs, everyone editing sees the others' notes and coloured cursors as they type; undo only takes back your own edits.
- **Practise**: the side panel's *Mixer & practice* has volume, mute and solo per part, reverb, swing and a practice tempo. *Wait mode* (`Ctrl`+`Alt`+`W`) steps through your part on a MIDI keyboard, the on-screen piano or by singing into the microphone.
- **Sing or play to write**: `Ctrl`+`Alt`+`R` (🎤) records one line from the microphone; `Ctrl`+`Alt`+`U` is a tuner.
- **Helpers**:
  - Notes outside an instrument's range show in red.
  - `Ctrl`+`Alt`+`K` suggests chords for a bar.
  - `Ctrl`+`Alt`+`L` writes a left hand from the chord symbols.
  - `Ctrl`+`Alt`+`C` checks the score before you print.
- **Classes** (`Ctrl`+`Alt`+`J`): teachers create a class, share its code and set assignments, with optional marking criteria. Students start, hand in and get feedback, a grade and marks. The teacher can open and comment on every student's copy. A due-date agenda exports to your calendar (`.ics`).
- **Notifications** (🔔): invitations, new assignments, hand-ins, feedback and comments; optional email copies. Admins review reported content on `admin.html`.
- **Up to four voices per staff**: `V` moves through voices 1–4.
- **Import ▾ → Scan a page** (`Ctrl`+`Alt`+`O`): a PDF or photo of printed music becomes an editable score, with its title and lyrics. The desktop app reads it on your computer with [Audiveris](https://audiveris.github.io) (free), which it sets up for you; a website needs Audiveris on its server ([docs/DEPLOY.md](docs/DEPLOY.md)). The pages are shown **beside the score** (`Ctrl`+`Alt`+`P`): the cursor's bar is outlined on them and they follow the cursor, a click on a bar goes there, and they are kept with the score in My scores.
- **Import ▾ → Turn a recording into notes** (`Ctrl`+`Alt`+`A`): a WAV, MP3, M4A, OGG or FLAC file of a melody, or of chords (with Spotify's Basic Pitch), becomes a score with its tempo, time signature and key, also when a live performance speeds up and slows down. Everything runs in the browser; the recording is not uploaded.
- **Your data**: the account menu downloads everything about your account, or deletes it.
- **Community**: shared score pages have likes, comments, *Remix* (your own copy, crediting the original) and a link to the author's profile. Explore can sort by most liked.
- **Embed**: unlisted and public scores get `<iframe>` code in the share dialog for a compact player on any website.
- **Offline**: the built app installs from the browser and opens without a network. Cloud saving resumes when you are back online.
- **PDF / print**: `Ctrl`+`P` opens a page-layout preview (A4 or US Letter, four staff sizes). Systems are never split across pages; page 1 carries the title and composer, later pages a running title and page numbers. Choose *Save as PDF* in the print dialog for a PDF file.

## Code map

| Path | What it holds |
|---|---|
| `src/model/` | Score types, durations (480 ticks per quarter), pitch maths, editing operations (`writeAt` = overwrite entry, `tidyRests`). Voice 1 lives in `Measure.staves[s]`, voice 2 in `Measure.voice2[s]`; always go through the lane helpers (`lane`, `laneOf`, `ensureLane`, `lanesOf`, `allEvents`) |
| `src/editor/editor.ts` | Cursor, input state, undo/redo, all editing behaviour |
| `src/editor/commands.ts` | **Command registry**: one entry per action, with label, shortcuts, palette and toolbar icon. The toolbar, keyboard handler, help sheet and command search all read this list. |
| `src/render/renderer.ts` | VexFlow layout: line breaking, grand staff, accidentals, beams, ties, hit-test geometry |
| `src/audio/sounds.ts` | Sound catalogue: sampled instruments from the free FluidR3 General MIDI soundfont (streamed on first use, then cached by the browser), Salamander concert piano, and offline synths |
| `src/model/harmony.ts` | Chord-symbol parser (root, quality, slash bass) ↔ MusicXML `<harmony>`, chord voicing and chord transposition |
| `src/model/transpose.ts` | Key-aware transposition of the score or a selection |
| `src/audio/accompaniment.ts` | Generates backing patterns from chord symbols along the playback timeline (repeats and endings included) |
| `src/audio/midiInput.ts` | Web MIDI keyboard input, grouping keys pressed together into chords |
| `src/audio/player.ts` | Playback timeline (ties merged, dynamics → velocity) using Tone.js. Plays a sampled piano when online, a synth when offline. |
| `src/render/print.ts` | Pagination: renders once at page width and gives each page an SVG view of the whole systems that fit |
| `src/model/lyrics.ts` | Verse helpers (verse 1 = `NoteEvent.lyric`, verses 2+ = `extraVerses`) |
| `src/cloud/` | API client (`api.ts`) and the editor's sign-in, library and share dialogs (`ui.ts`); `server.test.ts` drives the real PHP API |
| `src/site/`, `*.html` | Website pages; the guide's shortcut tables are generated from the command registry |
| `src/viewer.ts` | Public score viewer |
| `server/` | PHP API: `api/index.php` (routes), `lib/Auth.php` (sessions, CSRF, throttling), `lib/Scores.php` (library, sharing), `lib/Db.php` (schema) |
| `src/io/` | MusicXML import/export, `.mxl` unzip (native `DecompressionStream`), MIDI export and import (`midiImport.ts`), PNG/SVG export (`image.ts`) |
| `src/audio/render.ts` | Offline WAV rendering and encoding |
| `src/model/parts.ts`, `context.ts` | Instruments/parts; per-bar key, time, clef and tempo context |
| `src/model/templates.ts`, `comments.ts` | New-score templates (with a compact melody notation) and bar comments |
| `src/ui/` | On-screen keyboard, tutorial, accessibility helpers, theme and translations |
| `src/render/renderer.ts` (cache) | Each system is drawn into its own SVG group and reused while nothing it depends on changes |
| `src/model/drums.ts`, `guitar.ts` | Drum-kit map for percussion staves; guitar tab fingering and chord-diagram search |
| `src/cloud/live.ts`, `liveUi.ts` | Live co-editing: bar-level edits ordered by the service, pending edits re-applied on top, presence |
| `realtime/server.mjs` | The realtime relay (WebSocket framing on `node:http`, signed tickets, rooms) |
| `src/audio/practice.ts`, `pitchDetect.ts`, `micInput.ts` | Wait mode; microphone pitch detection and note tracking |
| `src/model/checks.ts`, `harmonise.ts` | Score checks and instrument ranges; chord suggestions and the generated left hand |
| `src/cloud/classesUi.ts`, `server/lib/Classes.php` | Classes, assignments and submissions |
| `server/lib/Community.php` | Profiles, likes, remixes, comments and reports |
| `src/pwa/` | Service worker template (filled in at build time) and its registration |
| `src/ui/i18n*.ts` | Interface and website translations (EN/FR/ES/DE) |
| `scripts/e2e.mjs` | End-to-end tests: a small DevTools-protocol driver for headless Chrome |
| `.github/workflows/ci.yml` | CI: PHP lint, type-check, unit/API tests, build, end-to-end tests |

## Not yet supported

See [docs/ROADMAP.md](docs/ROADMAP.md), section 2. In short:
- more than four voices per staff (a deliberate limit);
- the Privacy and Terms texts (and translations) are drafts that a site operator must review before going live.

Deployment details: [docs/DEPLOY.md](docs/DEPLOY.md).
