# Pianissimo Roadmap

This document lists what Pianissimo does today, what is still missing or needs work, and the order in which we build it. Each phase ends with a working, tested product. Tick boxes are updated as phases ship.

Reference for "what good looks like": the Flat (flat.io) analysis in [flat-analysis.md](flat-analysis.md).

---

## 1. Where we are (phases 1–14, shipped)

| Area | Shipped |
|---|---|
| **Entry** | Keyboard-first overwrite entry (A–G, durations 1–7, dots, rests); chords (Shift+letter, Alt+interval); pencil/mouse entry; MIDI keyboard input; triplets; notes split and tied across bar lines; undo/redo; autosave |
| **Editing** | Range selection; copy, cut and paste; transpose (score, selection, semitone); accidentals and enharmonics; ties; slurs; articulations; dynamics; two voices per staff; tidy rest merging |
| **Structure** | Grand staff and single staves; key and time signature for the whole score; repeats; 1st/2nd endings; line and page breaks |
| **Text** | Chord symbols; lyrics with up to 8 verses and hyphenation |
| **Sound** | About 30 sampled instruments plus offline synths, chosen per staff; chord-symbol accompaniment in 5 styles; metronome; count-in; loop |
| **Files** | Pianissimo JSON; MusicXML import/export (`.musicxml`, `.xml`, `.mxl`); MIDI export; print/PDF with pagination |
| **Notation (10–11)** | Key/time/clef/tempo changes on any bar; hairpins, pedal, 8va; grace notes; duplets, quintuplets, sextuplets; rehearsal marks and staff text; multiple named parts with brackets, part extraction and transposing instruments |
| **Input/output (12)** | MIDI file import; WAV, PNG and SVG export; recording from a MIDI keyboard |
| **Experience (13)** | On-screen piano and touch layout; templates; interactive tutorial; screen-reader announcements and accessible dialogs; dark mode; FR/ES/DE interface |
| **Collaboration (14)** | Version history; comments on bars; conflict-safe saving across tabs and devices; CI and a deploy guide |
| **Quality** | Command registry for shortcuts, toolbar, help and search; 113 unit and API tests; browser-verified rendering |

---

## 2. What is missing or needs enhancing

Grouped by area. **Priority**: P1 = core and expected by every user, P2 = important, P3 = nice to have.

### 2.1 Product surface and platform
| Item | Priority | Notes |
|---|---|---|
| Public website: home, features, guide, about, privacy/terms | P1 | There is no front door; the editor opens straight away |
| Accounts (sign up, sign in, sign out) | P1 | Needed for cloud saving and sharing |
| Cloud score library (list, open, rename, delete, duplicate) | P1 | Scores currently live only in one browser's autosave |
| Share links: public or unlisted read-only score page with playback | P1 | Flat's core loop: write, then share |
| Embeddable player (`<iframe>`) | P3 | For blogs and teachers |
| Server API with secure sessions, CSRF protection, rate limits, input validation | P1 | PHP 8 + PDO (SQLite by default, MySQL in production) |
| Installable PWA and offline editing | P3 | |

### 2.2 Notation completeness
| Item | Priority | Notes |
|---|---|---|
| D.C. / D.S. / Coda / Fine with playback | P1 | Common in lead sheets and hymns |
| Key, time and clef changes mid-score | P1 | Currently score-wide only |
| Hairpins (crescendo/diminuendo), pedal marks, 8va/8vb | P2 | |
| Tempo text and tempo changes ("Allegro", ♩ = 120 mid-piece) | P2 | |
| Grace notes, tremolos, fermatas on rests | P2 | |
| Tuplets beyond triplets (duplets, quintuplets, sextuplets) | P2 | The model already stores any ratio; entry and rendering need work |
| Multi-measure rests in parts | P3 | |
| More than two voices per staff | P3 | |
| Multiple named parts/instruments (score with violin + cello + piano) and part extraction | P2 | Today: up to 2 staves in one part |
| Text annotations, rehearsal marks (A, B, C) | P2 | |
| Guitar tablature and chord diagrams | P3 | |
| Percussion staff | P3 | |

### 2.3 Input and output
| Item | Priority | Notes |
|---|---|---|
| MIDI file import | P2 | Export exists |
| Real-time MIDI recording with quantisation | P3 | |
| Audio export (WAV) | P2 | Offline render with Tone.js |
| PNG/SVG export of a page | P3 | |
| OMR (scan sheet music from a photo or PDF) | P3 | Heavy; server-side (Audiveris) later |

### 2.4 Experience and quality
| Item | Priority | Notes |
|---|---|---|
| Score templates gallery and onboarding tutorial | P2 | |
| Faster rendering for long scores (incremental re-render) | P2 | The whole score re-renders on each edit |
| Touch and mobile editing (on-screen piano keyboard) | P2 | |
| Accessibility: screen-reader descriptions of the cursor position, high-contrast theme | P2 | |
| Dark mode for the app chrome | P3 | |
| Internationalisation (EN first, then FR/ES/PT/DE) | P3 | |
| End-to-end browser tests and CI (GitHub Actions) | P2 | Unit tests only today |
| Version history (named snapshots) | P3 | |
| Real-time collaboration and comments | P3 | Largest item; needs WebSockets |

---

## 3. Architecture decisions for the next phases

- **Front end stays plain TypeScript and Vite**, now built as a **multi-page app**:
  - `/` is the website.
  - `/app.html` is the editor.
  - `/view.html` is the public score viewer.
  - Website pages are static HTML, so they're fast and easy to index.
- **Backend: PHP 8.2 in `server/`**, because it runs as-is under XAMPP and most shared hosting.
  - One JSON API, served by `server/api/index.php`.
  - PDO data layer: SQLite file by default (zero setup), MySQL by setting `server/config.php`.
  - Sessions use secure cookies: `HttpOnly` and `SameSite=Lax`, plus `Secure` on HTTPS.
  - CSRF token on every write.
  - Passwords hashed with `password_hash` (bcrypt/argon2).
  - Prepared statements only.
  - Simple per-IP rate limiting on sign-in and sign-up.
- **Data**:
  - `users`
  - `scores`: JSON document, title, owner, visibility (`private`, `unlisted`, `public`), share slug, timestamps.
  - Score bodies are size-limited (2 MB) and validated as Pianissimo JSON.
- **Dev setup**: `npm run dev` proxies `/server/*` to `php -S localhost:8000`. Under XAMPP, Apache serves both directly.

---

## 4. Phased plan

### Phase 7: Website, viewer and project structure ✅
- [x] Multi-page Vite build: website (`index.html`), editor (`app.html`), viewer (`view.html`), guide, about, privacy, terms
- [x] Website: hero, feature tour, how it works, instrument list, call to action, shared header and footer
- [x] Guide page generated from the command registry, so it can never go out of date
- [x] Public viewer: renders a score read-only with playback, from a share link or a local file
- [x] Editor gets a header link back to the site and a "My scores" entry point

**Done when:** every page builds, all links work, and the viewer opens a shared score and plays it.

### Phase 8: Accounts, cloud library and sharing ✅
- [x] PHP API: `auth/register`, `auth/login`, `auth/logout`, `auth/me`, `scores` list/create/get/update/delete, `scores/{id}/share`, `public/{slug}`
- [x] SQLite schema, auto-migrated on first request; MySQL-ready configuration
- [x] Security: sessions, CSRF, password hashing, rate limiting, size limits, ownership checks
- [x] Editor: sign in / sign up dialog, "Save to library" with auto-sync, "My scores" library (open, duplicate, delete; rename by editing the title), share dialog (private / unlisted / public, copy link)
- [x] Public score pages via `view.html?s=<slug>`, plus a gallery of public scores on the site
- [x] API tests run against PHP's built-in server

**Done when:** a user can sign up, save, reopen on another browser, share a link that plays for a signed-out visitor, and make it private again.

### Phase 9: Navigation markings ✅
- [x] Segno, Coda, Fine, D.C., D.S., D.C. al Fine, D.S. al Coda, To Coda on bars
- [x] Rendering above the staff, with playback following the jumps (repeats are taken once and not repeated after a D.C., as is standard)
- [x] MusicXML import/export of `<segno>`, `<coda>`, `<words>` and `<sound dacapo/dalsegno/fine/tocoda>`

### Phase 10: Notation depth ✅
- [x] Key, time and clef changes on any bar (model: per-bar overrides; renderer: courtesy signatures). Changing the time signature re-bars the music that follows
- [x] Hairpins, pedal, 8va / 8vb (drawn across systems, played back: hairpins shape velocity, pedal sustains)
- [x] Tempo marks and tempo changes (playback, metronome and MIDI export follow them)
- [x] Grace notes; tuplets 2:3, 5:4, 6:4
- [x] Rehearsal marks and staff text annotations

### Phase 11: Parts and ensembles ✅
- [x] Multiple named parts (Instruments dialog: add, remove, reorder, rename, transposition)
- [x] Brackets and braces per instrument group, part names at the start of each system
- [x] Part extraction and printing each part on its own
- [x] Transposing instruments (B♭ clarinet, F horn, alto sax…): stored at concert pitch, with a "Transposed score" toggle; MusicXML `<transpose>` both ways

### Phase 12: Input/output ✅
- [x] MIDI file import (quantised per beat to the 16th or triplet-8th grid; wide piano tracks split onto a grand staff; one part per track/channel)
- [x] Audio export (WAV) via offline rendering. If the sampled instruments cannot be downloaded within 20 s, built-in synths are used so the export always finishes
- [x] PNG/SVG export (the whole score as one image, fonts embedded)
- [x] Real-time MIDI recording (`Shift`+`R`: count-in, play along with the metronome, quantised on stop). *Logic is unit-tested; not yet tried with a physical keyboard in our browser checks*

### Phase 13: Experience ✅ (two items partial)
- [~] **Faster rendering (partial):** edits are batched into a single layout pass per animation frame, and cursor moves never re-render. A true per-system re-render is still open; VexFlow lays out whole systems, so it needs a layout cache first
- [x] Touch editing and an on-screen piano keyboard (`Shift`+`K`): two octaves with octave shift, note lengths, rest, dot, chord mode, undo/delete. Responsive layout for phones and tablets, larger touch targets, and the keyboard opens by default on touch devices
- [x] Templates gallery in **New score** (blank piano, lead sheet with chords, piano waltz, 12-bar blues, scale exercise, SATB chorale, string quartet) and an interactive tutorial. The tutorial is a coach card that moves on when each step is done (`app.html?tutorial`, or *Start the tutorial*)
- [x] Accessibility:
  - A screen-reader live region announces bar, beat, staff and the note under the cursor.
  - Every dialog is labelled, moves focus in, keeps `Tab` inside, closes with `Esc` and returns focus.
  - Icon-only buttons have accessible names.
  - Focus rings are visible.
- [~] Dark mode (`Ctrl`+`Alt`+`D`, or *Theme* in the side panel; follows the system by default) ✅. **i18n (partial):** English, French, Spanish and German for the fixed interface (menus, side panel, dialogs). Command names in the shortcut sheet, the command search and the status bar are still English

### Phase 14: Collaboration and production hardening ✅ (co-editing scoped down)
- [x] Version history: the state before a save is kept, at most one per 5 minutes and the last 50 per score. *File → Version history* (`Ctrl`+`Alt`+`H`) restores one, and `Ctrl`+`Z` undoes the restore
- [x] Comments on bars (`Ctrl`+`Alt`+`M` or 💬): add, resolve/reopen, delete, jump to bar. Bars with comments show a marker. Comments are saved and shared with the score and are not printed or exported
- [~] **Real-time co-editing: scoped down to safe concurrent editing.**
  - Every save carries the revision it was based on, and the server refuses to overwrite a newer save (HTTP 409).
  - The editor checks for saves made elsewhere every 20 s and whenever the tab becomes visible. If there are no local changes it updates itself; otherwise it asks *Keep mine / Load the other version*. Neither version is lost, because the other one stays in the history.
  - Live cursors and character-by-character merging (WebSockets plus operation transforms) are **not built**. Shared hosting (XAMPP/PHP) cannot hold WebSocket connections, so this needs a separate realtime service.
- [x] CI: GitHub Actions runs PHP lint, type-check, unit and API tests, and the build on every push and pull request, and keeps the build as an artifact. A deploy guide is in [DEPLOY.md](DEPLOY.md). *Playwright end-to-end tests are not in CI yet*

### Still open after Phase 14
| Item | Notes |
|---|---|
| Live co-editing (WebSockets, presence, operation transforms) | Needs a realtime service next to PHP |
| Per-system incremental rendering | Needs a layout cache in `renderer.ts` |
| Full i18n (command names, status bar, website pages) | Strings are looked up by English text; add rows to `src/ui/i18n.ts` |
| Playwright end-to-end tests in CI | Browser checks are done by hand today |
| Embeddable player, PWA/offline install, tablature, percussion, OMR | From section 2 (P3) |

---

## 5. How a phase is built

1. Model changes first, with unit tests.
2. Editor commands registered in `src/editor/commands.ts` (toolbar, shortcuts, help and search come for free).
3. Rendering, then MusicXML/MIDI round trips.
4. Browser check of real usage (screenshots), then fix what looks wrong.
5. Update the README and tick this roadmap.
