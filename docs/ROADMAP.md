# Pianissimo Roadmap

This document lists what Pianissimo does today, what is still missing or needs work, and the order in which we build it. Each phase ends with a working, tested product. Tick boxes are updated as phases ship.

Reference for "what good looks like": the Flat (flat.io) analysis in [flat-analysis.md](flat-analysis.md).

---

## 1. Where we are (phases 1–6, shipped)

| Area | Shipped |
|---|---|
| **Entry** | Keyboard-first overwrite entry (A–G, durations 1–7, dots, rests); chords (Shift+letter, Alt+interval); pencil/mouse entry; MIDI keyboard input; triplets; notes split and tied across bar lines; undo/redo; autosave |
| **Editing** | Range selection; copy, cut and paste; transpose (score, selection, semitone); accidentals and enharmonics; ties; slurs; articulations; dynamics; two voices per staff; tidy rest merging |
| **Structure** | Grand staff and single staves; key and time signature for the whole score; repeats; 1st/2nd endings; line and page breaks |
| **Text** | Chord symbols; lyrics with up to 8 verses and hyphenation |
| **Sound** | About 30 sampled instruments plus offline synths, chosen per staff; chord-symbol accompaniment in 5 styles; metronome; count-in; loop |
| **Files** | Pianissimo JSON; MusicXML import/export (`.musicxml`, `.xml`, `.mxl`); MIDI export; print/PDF with pagination |
| **Quality** | Command registry for shortcuts, toolbar, help and search; 63 unit tests; browser-verified rendering |

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

### Phase 10: Notation depth (next)
- [ ] Key, time and clef changes on any bar (model: per-bar overrides; renderer: courtesy signatures)
- [ ] Hairpins, pedal, 8va
- [ ] Tempo marks and tempo changes (playback follows them)
- [ ] Grace notes; tuplets 2:3, 5:4, 6:4
- [ ] Rehearsal marks and text annotations

### Phase 11: Parts and ensembles
- [ ] Multiple named parts (instrument list dialog: add, remove, reorder)
- [ ] Brackets and braces per instrument group
- [ ] Part extraction view and print each part
- [ ] Transposing instruments (B♭ clarinet, F horn): concert-pitch toggle

### Phase 12: Input/output
- [ ] MIDI file import (quantised to the nearest 16th, with triplet detection)
- [ ] Audio export (WAV) via offline rendering
- [ ] PNG/SVG page export
- [ ] Real-time MIDI recording

### Phase 13: Experience
- [ ] Incremental rendering (re-render only changed systems)
- [ ] Touch editing and on-screen keyboard
- [ ] Templates gallery and interactive tutorial
- [ ] Accessibility pass (ARIA live region announcing cursor note and beat; keyboard-only dialogs)
- [ ] Dark mode, i18n

### Phase 14: Collaboration and production hardening
- [ ] Version history
- [ ] Comments on bars
- [ ] Real-time co-editing (WebSocket server, operation transforms on the command level)
- [ ] CI: type-check, unit tests, Playwright e2e and build on every push; deploy guide

---

## 5. How a phase is built

1. Model changes first, with unit tests.
2. Editor commands registered in `src/editor/commands.ts` (toolbar, shortcuts, help and search come for free).
3. Rendering, then MusicXML/MIDI round trips.
4. Browser check of real usage (screenshots), then fix what looks wrong.
5. Update the README and tick this roadmap.
