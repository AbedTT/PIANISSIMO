# Pianissimo Roadmap

This document lists what Pianissimo does today, what is still missing or needs work, and the order in which we build it. Each phase ends with a working, tested product. Tick boxes are updated as phases ship.

Reference for "what good looks like": the Flat (flat.io) analysis in [flat-analysis.md](flat-analysis.md).

---

## 1. Where we are (phases 1–34, shipped)

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
| **Finishing (15)** | Incremental rendering (only changed systems are redrawn); editor and website in EN/FR/ES/DE, including command names and the status bar; end-to-end browser tests in CI; `app.html?template=…` links |
| **Reach (16)** | Embeddable player; installable PWA that works offline; opens `.musicxml`/`.mxl`/`.mid` files from the desktop |
| **Notation extras (17)** | Tremolos; multi-measure rests in printed parts; drum kit staff; guitar tablature and chord diagrams |
| **Practice and helpers (19–21)** | Mixer, reverb, practice tempo, swing, MIDI wait mode; record by singing or playing into the microphone, tuner; instrument ranges, chord suggestions, generated left hand, score checks |
| **Teaching and community (22–23)** | Classes with join codes, assignments, hand-in and feedback; public profiles, likes, remixes, comments with reporting |
| **Live co-editing (18)** | Invite editors; edit the same score at once with merged bar-level edits, presence cursors and leader-only saving; optional Node realtime service |
| **Rounding out (24–28)** | Wait mode with the microphone or on-screen piano; grades, marking criteria and a due-date calendar; notifications and an admin screen for reports; translated messages and guide; up to four voices per staff |
| **Closing the list (29)** | Scanning sheet music (with Audiveris on the server); self-service data download and account deletion; Privacy and Terms rewritten and all legal pages translated (draft for review); emails in each person's language, or a daily digest; voices 3–4 kept clear of 1–2 |
| **Production readiness (32–33)** | Password reset, password change and email confirmation; SMTP email; security headers and a Content-Security-Policy on every page; fonts as separate files (40% smaller first load); built-in crash reports for admins; trusted proxies; tested on MySQL/MariaDB, nightly backups and restore; installer signing; project lint |
| **Quality** | Command registry for shortcuts, toolbar, help and search; 207 unit and API tests (the API tests also on MySQL in CI); 21 end-to-end browser tests (headless Chrome over the DevTools protocol, no extra dependencies), including two-person sessions, a fake microphone, offline use, phone layouts down to 320px and any security-policy violation; `npm run lint` with strict type-checking of the app and the tests |

---

## 2. What is missing or needs enhancing

Everything from the original gap list that shipped in phases 7–18 has been removed. **Priority**: P1 = core and expected by every user, P2 = important, P3 = nice to have.

| Area | Item | Priority | Planned in |
|---|---|---|---|
| Legal | The rewritten Privacy and Terms, and their French, Spanish and German translations, are drafts: a person (the site operator, ideally with legal advice) must review them and add contact details and governing law | P1 before going live | Needs a person |
| Input | Scanning quality depends on the engine. Audiveris reads clean printed scores well, and handwriting and phone photos taken at an angle poorly. There is no in-app correction step beyond normal editing | P3 | Idea |
| Notation | More than four voices per staff: a deliberate limit, the same as MuseScore and Sibelius and the usual MusicXML practice | — | Not planned |

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
- [x] Dark mode (`Ctrl`+`Alt`+`D`, or *Theme* in the side panel; follows the system by default). **i18n (completed in Phase 15):** English, French, Spanish and German for the fixed interface (menus, side panel, dialogs). Phase 15 added command names, the status bar and the website

### Phase 14: Collaboration and production hardening ✅ (co-editing scoped down)
- [x] Version history: the state before a save is kept, at most one per 5 minutes and the last 50 per score. *File → Version history* (`Ctrl`+`Alt`+`H`) restores one, and `Ctrl`+`Z` undoes the restore
- [x] Comments on bars (`Ctrl`+`Alt`+`M` or 💬): add, resolve/reopen, delete, jump to bar. Bars with comments show a marker. Comments are saved and shared with the score and are not printed or exported
- [~] **Real-time co-editing: scoped down to safe concurrent editing.**
  - Every save carries the revision it was based on, and the server refuses to overwrite a newer save (HTTP 409).
  - The editor checks for saves made elsewhere every 20 s and whenever the tab becomes visible. If there are no local changes it updates itself; otherwise it asks *Keep mine / Load the other version*. Neither version is lost, because the other one stays in the history.
  - Live cursors and character-by-character merging (WebSockets plus operation transforms) are **not built**. Shared hosting (XAMPP/PHP) cannot hold WebSocket connections, so this needs a separate realtime service.
- [x] CI: GitHub Actions runs PHP lint, type-check, unit and API tests, and the build on every push and pull request, and keeps the build as an artifact. A deploy guide is in [DEPLOY.md](DEPLOY.md). *Playwright end-to-end tests are not in CI yet*

### Phase 15: Finish the open items ✅
- [x] **Per-system incremental rendering.** Each system is drawn into its own SVG group and cached with a signature of everything it depends on: its bars and their context, ties, slurs and lines running in or out, verse labels, position and width. An unchanged system is moved into the new SVG as is. Bar widths are cached by bar content, so line breaking no longer re-formats every bar. An edit that keeps the rhythm redraws one system; one that changes a bar's width redraws from there on, because bars move between lines
- [x] **Full i18n (EN/FR/ES/DE).** Command names (shortcut sheet, command search, toolbar tooltips and menus), command groups, status bar, save status and toolbar tabs. Website: header, footer with a language picker, home, explore, guide headings and contents, and the generated shortcut tables. A test fails when a new command has no translation. *Still English: toast messages and the long guide paragraphs. About, Privacy and Terms say they are English-only*
- [x] **End-to-end browser tests in CI** (`npm run e2e`): a small DevTools-protocol driver (`scripts/e2e.mjs`) runs headless Chrome against the production build and a throw-away PHP API. Covered: home demo and language switch; guide tables; typing, undo and redo; incremental redraw; command search; German shortcut sheet; sign up → share publicly → a signed-out visitor plays the score → it shows on Explore
- [x] `app.html?template=<id>` opens a template directly (for links from the website)

### Phase 16: Reach — embed and offline ✅
- [x] **Embeddable player**: `embed.html?s=<slug>`, a compact responsive page with the score, play/stop with a playhead, and a link to the full viewer. When a score is unlisted or public, the share dialog shows its `<iframe>` code with a copy button. Unknown or private scores show a message
- [x] **Installable PWA**: web app manifest, icons (including maskable) and shortcuts (new piano score, new lead sheet). The service worker is generated at build time with every built file in its precache list, plus a version from their contents; each new build replaces the old cache
  - Pages are network-first, so a new version shows as soon as you are online.
  - Built files are cache-first.
  - Instrument samples are cached the first time they play.
  - The API is never cached.
- [x] **Works offline**: the editor, viewer and website open and work with no network. Cloud saving pauses ("Offline: kept in this browser"), keeps the link to the library copy, and saves automatically when the connection returns
- [x] **Open files from the desktop**: the installed app registers for `.musicxml`, `.mxl`, `.mid` and `.pianissimo` files (Chromium file handlers)
- [x] End-to-end tests:
  - The embed code works inside another page.
  - An unknown slug shows a message.
  - With the web server **stopped**, the installed editor reloads and edits, and the website still renders.

### Phase 17: Notation extras ✅
- [x] **Tremolos**: 1–3 strokes on a note (`Alt`+`Shift`+`R` cycles; also on the Articulations toolbar). Playback repeats the note as 8ths, 16ths or 32nds. MusicXML `<tremolo type="single">` both ways
- [x] **Multi-measure rests** in printed parts:
  - Runs of empty bars become one bar with an H-bar and the count.
  - A rehearsal mark, a tempo change or a line break starts a new run.
  - Repeats, endings, key/time/clef changes and navigation marks are never folded in.
  - The full score always shows every bar.
- [x] **Percussion staff**: a *Drum kit* instrument with a drum clef. Each line or space is a drum: kick, snare, three toms, hi-hat, pedal hi-hat, ride and crash, with x noteheads for cymbals.
  - The status bar names the drums under the cursor.
  - It plays a synthesized kit, so it works offline.
  - MIDI export puts it on channel 10, and MIDI import turns channel 10 into a drum staff.
  - MusicXML uses `<unpitched>` notes and x noteheads.
  - Transposing leaves it alone.
- [x] **Guitar**:
  - *Tablature* under any staff (`Alt`+`Shift`+`B`, or the *Guitar + tab* instrument). It is worked out from the notes in standard tuning, giving each note of a chord its own string and staying near the previous hand position.
  - *Chord diagrams* above chord symbols (`Alt`+`Shift`+`D`). Shapes come from a search of the neck, not a fixed table, so any chord symbol gets a playable shape: open shapes first, barre chords otherwise, slash bass lowest.
- [x] Templates: *Rock band* (guitar riff + drum groove) and *Guitar song* (melody, tab, chords and diagrams)

*Note:* tab and diagrams are display options worked out from the notes, so MusicXML carries the notes and chord symbols and they reappear on import. They are not written as `<technical><fret>` or `<frame>`.

### Phase 18: Live co-editing ✅
- [x] **Editors**: the owner invites people by their account email (share dialog → *Edit together*).
  - Editors find the score in their library, marked *shared by …*.
  - They can open, save, see the history and co-edit. Only the owner deletes it, changes who sees it, or manages editors.
  - An editor can leave.
  - API: `GET/POST /scores/{id}/editors`, `DELETE /scores/{id}/editors/{userId}`.
- [x] **Realtime service** (`realtime/server.mjs`): Node with no dependencies.
  - WebSocket framing is written on `node:http`.
  - It accepts one-hour tickets that PHP signs with a shared secret (`POST /scores/{id}/realtime`), so it needs no database access.
  - One room per open score, at most 20 people. Dead connections are dropped by ping.
- [x] **Merged edits**:
  - Typing travels as "replace bar N" edits. Adding or removing bars, or changing parts, sends the whole score.
  - The service puts every edit in one order. Each client keeps the agreed score plus its own unconfirmed edits and re-applies them on top of what arrives, so all copies end up identical.
  - Two people on different bars never collide. On the same bar, the edit the service received last wins on every screen.
  - A bar edit made against bars that someone has just added or removed is refused, and everyone resyncs.
  - Remote edits are applied to the undo history too, so `Ctrl`+`Z` only takes back your own edits. A layout change by someone else restarts undo, with a message.
- [x] **Presence**: a *Live* badge with each person's initial, and a coloured cursor with their name on the score
- [x] **Saving**: the first person in a room (the leader) saves to the library and tells the others which revision they now match. When the leader leaves, the next person takes over and saves anything outstanding. If the connection drops, the editor reconnects with backoff and meanwhile falls back to the normal conflict-safe saving
- [x] Tests:
  - Merge rules against a simulated service: concurrent edits, same-bar races, refused edits, personal undo.
  - API tests for editor permissions and tickets, plus a real WebSocket session through the service.
  - End-to-end: two browsers editing one score at once.
- [x] Without the service, hosting is unchanged: conflict-safe saves and polling every 20 s (see [DEPLOY.md](DEPLOY.md), *Live co-editing*)

**The original plan (phases 1–18) is complete.** What remains from section 2 is listed there, with the reason each item is not planned yet.

---

## 4b. New features (phases 19–23)

Beyond the original plan, built after it was complete.

### Phase 19: Mixer and practice ✅
- [x] **Mixer** (side panel → *Mixer & practice*): volume, mute and solo per part, and a volume for the chord accompaniment, which goes quiet while a part is soloed. Saved with the score and undoable. Playback and WAV export follow it; MIDI and MusicXML export keep every part
- [x] **Reverb** amount (saved with the score), on the master output
- [x] **Practice tempo** slider (50–150 %): playback, the cursor and the metronome all run at that speed, and the written tempo stays as it is. The setting is remembered per browser, not in the score
- [x] **Swing** (`Ctrl`+`Alt`+`G`): off-beat eighths come a third of a beat late (2:1 feel) in bars counted in quarters or halves (not 6/8). Playback, the cursor, WAV and MIDI export all swing
- [x] **Wait mode** (`Ctrl`+`Alt`+`W`): practise the part under the cursor with a MIDI keyboard.
  - The cursor waits on each chord, and the status bar says what to play.
  - A right chord sounds together with the other parts at that moment; a wrong one says which notes were wanted.
  - It follows repeats and jumps, skips rests and tied notes, and sums up the wrong tries at the end.

### Phase 20: Sing or play to write ✅
- [x] **Pitch detection** with the McLeod method (normalised square difference). It is robust to strong overtones, so a sung A3 is not read as A4, and noise is reported as unclear
- [x] **Note tracking**: a note needs three steady frames to start and ends on silence or a held new pitch. Vibrato and scoops do not split it, and blips under 70 ms are dropped
- [x] **Record from the microphone** (`Ctrl`+`Alt`+`R`, or 🎤 next to *Rec*).
  - You get a count-in, then sing or play one line. Only the clicks play, so the speakers are not recorded.
  - It is quantised like MIDI recording, at concert pitch.
  - The browser's echo cancellation, noise suppression and automatic gain are turned off, because they bend the pitch.
- [x] **Tuner** (`Ctrl`+`Alt`+`U`): note name, cents and Hz, with a needle that turns green within 5 cents; also shown while recording
- [x] End-to-end: Chrome's fake microphone plays a generated, voice-like C5. The tuner reads C5 and the recording writes only C5s

### Phase 21: Writing helpers ✅
- [x] **Instrument ranges** for every instrument template.
  - In the editor, notes an instrument cannot play are drawn in red, and the status bar explains: *F3 is too low for Violin (lowest G3)*.
  - Prints, the viewer and embeds are not coloured.
  - Ranges are checked at concert pitch, so the transposed view agrees.
- [x] **Chord suggestions** (`Ctrl`+`Alt`+`K`): the three chords of the key that best hold the bar's melody, weighted by note length and strong beats, with V7 only when the melody has the seventh. Spelled in the key. *Suggest chords for every bar without one* fills a whole melody in one step (undoable)
- [x] **Left hand from the chord symbols** (`Ctrl`+`Alt`+`L`): writes real, editable notes into the empty bars of the piano's bass staff.
  - It follows chord changes within a bar.
  - The pattern comes from the accompaniment style: block chords, bass + chords, broken chords or strummed chords.
  - It stays in a comfortable left-hand range.
- [x] **Check the score** (`Ctrl`+`Alt`+`C`): notes out of range, bars that do not add up (in beats), ties to a different pitch, slurs and lines that lost their end note, and parts with no notes. Each line jumps to the place. The print dialog shows *⚠ N things to check* when there are any

### Phase 22: Teaching ✅
- [x] **Classes** (📚 in the account menu, or `Ctrl`+`Alt`+`J`): anyone can create a class and becomes its teacher. Students join with an 8-character code (no 0/O or 1/I) or a link, `app.html?join=CODE`, which works even before signing in. Teachers see the students; students can leave, teachers can remove them or delete the class
- [x] **Assignments**: the teacher sets the score being edited as an assignment, with a title, instructions and an optional due date. The assignment stores a copy, so later edits to the teacher's own score do not change it
- [x] **Students' work**: *Start* gives each student their own copy in their library, and the teacher is made an editor of it.
  - The teacher can open it, play it, comment on bars and even co-edit it live with the Phase 18 tools.
  - A banner over the copy shows the instructions, the due date and the status, with *Hand in*.
- [x] **Review**: for each assignment the teacher sees every student as *not started*, *working*, *handed in* or *returned*. Opening a student's work and *Give back…* with written feedback both work from that list and from the banner. The student sees the feedback on the banner and in the class
- [x] API: `/classes`, `/classes/join`, `/classes/{id}`, `/classes/{id}/assignments`, `/assignments/{id}/start|submit|submissions`, `/submissions/{id}/return`, `/scores/{id}/assignment`. Students never see the join code or other students' work. Deleting a class leaves students their copies
- [x] Tests: the API flow end to end; in the browser, a teacher and a student in separate sessions go from creating the class to the student reading the feedback

### Phase 23: Community ✅
- [x] **Profiles**: `profile.html?u=<id>` with the person's public scores, the date they joined, and the likes they have received. Score pages link to the author
- [x] **Likes** on shared scores (♥ with a count; signed-in members only), shown on cards and score pages. Explore can sort by *Most liked*
- [x] **Remix**: copies a shared score into your library and opens it in the editor (`app.html?open=<id>`). If the remix is shared, its page credits the original: *remix of … by …*
- [x] **Comments** on shared score pages:
  - Anyone reads them; members post them, at most 10 every 10 minutes.
  - The comment's author or the score's owner can delete one.
  - Signed-out visitors see a sign-in hint.
- [x] **Moderation**: reporting a comment or a score.
  - Three different people reporting a comment hide it. Three reporting a score take it off Explore and profiles; its link keeps working for the owner.
  - There is no admin screen yet. Hidden items stay in the database (`hidden = 1`) for review
- [x] Tests: the API rules (permissions, counts, hiding after reports); in the browser, liking, commenting, the profile, Explore by likes, and remixing into the editor

### Phase 24: Practice without a MIDI keyboard ✅
- [x] Wait mode picks its input:
  - a MIDI keyboard if one is connected (asking for MIDI access is capped at 2 s, because some browsers never answer);
  - otherwise the **microphone**: one line, matched on the melody note in any octave, so a singer's own range counts;
  - otherwise the **on-screen piano**, which also works in wait mode alongside the others.
- [x] Through the microphone the app plays nothing back, so it does not hear itself
- [x] End-to-end: Chrome's fake microphone sings C5 and wait mode steps through three Cs to the end

### Phase 25: Marking and the calendar ✅
- [x] **Marking criteria** on an assignment (up to 8). Giving work back uses a form, no longer a prompt: feedback, a free-text grade ("8/10", "B+") and a 0–4 mark per criterion, which can be changed later. Students see the grade and marks on the banner and in the class; the teacher sees grades in the work list. The banner's *Give back…* opens that form for the student
- [x] **Due-date agenda** at the top of the Classes dialog: *Overdue* (not handed in), *This week*, *Later*, across all classes. A teacher sees how many have handed in. *Add to my calendar* downloads an `.ics` file of all-day events for phone and Google calendars
- [x] API: `rubric` on assignments; `grade` and `marks` on submissions; `GET /calendar`

### Phase 26: Notifications and moderation ✅
- [x] **Notifications** (🔔 in the editor's header when signed in), for these events:
  - being invited to edit;
  - a new assignment;
  - a student handing in;
  - work given back;
  - a comment on your score.
  - The list refreshes every minute and when the tab comes back; opening an item marks it read and goes there. Nobody is notified of their own actions, and the last 200 are kept.
- [x] **Email copies**, optional: off unless the server has `mail_from` (`PIANISSIMO_MAIL_FROM`); `site_url` makes the links absolute. Each person can turn emails off in the bell's panel. Sending uses PHP's `mail()` and can never break the request that caused it
- [x] **Admin screen** (`admin.html`) for accounts listed in `admins` (`PIANISSIMO_ADMINS`): reported comments and scores, most reported first, with *Show again*, *Dismiss reports*, and *Delete comment* or *Make private*. Everyone else is turned away, in the API too
- [x] `app.html?class=<id>` opens a class (used by notification links)

### Phase 27: Translations ✅
- [x] **Toast messages** in French, Spanish and German. Templated messages keep their titles, names and numbers. Screen-reader announcements are translated the same way. A test scans the source and fails when a new message has no translation
- [x] **The guide** is now translated in full (every explanation, the key names such as *Strg*, *Maj*, *Mayús*, and the lyrics table). A test checks that every block has a translation and keeps its links

### Phase 28: Up to four voices per staff ✅
- [x] **Model**: `voice3` and `voice4` beside `voice2`, so existing scores need no migration. All access goes through the lane helpers (`laneOf`, `lanesOf`, `setLane`, `dropLane`), and copying, refitting, reflowing, parts, extraction and transposition all handle every voice
- [x] **Editing**: `V` goes 1 → 2 → 3 → 4 → 1, keeping the beat. A voice is created on first use and removed again if left with only rests. *Remove this voice* takes out the cursor's voice, or all extra voices from voice 1. Each voice has its own cursor colour (blue, orange, green, purple), and the status bar and screen reader name it
- [x] **Drawing**: voices 1 and 3 have stems up, 2 and 4 stems down. Rests move apart, ties curve with their stems, and voices that are only rests are not drawn. A click picks the voice whose stems point to where you clicked
- [x] **Playback and files**: all voices play; MusicXML exports and imports four voices per staff (stems up and down)

### Phase 29: Closing the list ✅
- [x] **Scanning sheet music** (`Ctrl`+`Alt`+`O`, *Scan sheet music (photo or PDF)…*):
  - The page goes to the server, where an OMR engine turns it into MusicXML that opens in the editor. The engine is set with `omr_command`, normally Audiveris.
  - Uploads are checked by their content (PNG, JPEG, TIFF or PDF, up to 10 MB).
  - The engine runs with a time limit in a private temporary folder, which is always deleted afterwards.
  - There is a limit of 20 scans an hour per person, and signing in is required.
  - Without an engine the command says scanning is not set up.
  - Tested end to end (API and browser) with a stand-in engine, `scripts/fake-omr.mjs`. *Not yet run against a real Audiveris install.*
- [x] **Your data**: *Download my data* (everything about the account as one JSON file) and *Delete my account…* (password required). Deletion removes the library, shared scores, classes taught, work in classes, comments, likes, notifications and reports
- [x] **Legal pages**:
  - Privacy now describes what the software really stores: the microphone, editing together, classes and grades, the community, email, scanning, and the new download and delete options.
  - Terms cover remixes, comments, moderation and classes.
  - About, Privacy and Terms are translated into French, Spanish and German, with a note that the English version is the reference. *These are drafts for the site operator to review* (see section 2).
  - Tests check every block has a translation and keeps its links.
- [x] **Email in each person's language**:
  - Notifications store their kind and details, so emails are written in the language the person uses in the editor; the bell translates them too.
  - Each person chooses *no emails*, *each one* or *a daily summary*. Summaries are sent by `server/cron/digest.php`, run from cron, which tracks the last notification sent by id so nothing is skipped or sent twice.
  - `mail_log` writes emails to a file for development and tests.
- [x] **Crossing voices**: when voice 3 or 4 sounds together with the voice that shares its stem direction (1 or 2), its note moves to the right so stems and heads do not overlap. The cursor and clicks follow the moved note

### Phase 30: Phones and desktop installers ✅
- [x] **Phones**:
  - The editor's top bar is one row on phones.
  - The settings panel slides up as a sheet, and a ⋯ action sheet holds the file, export, recording and help commands.
  - The on-screen piano shows one octave of wide keys.
  - Drop-down menus open on tap.
  - Notches and the home bar are respected.
  - Every page fits a 320px screen, which an end-to-end test checks.
- [x] **Image export**: staff lines, stems and barlines were missing from PNG and SVG exports, because they inherit their colour from the `<svg>` element, which the export dropped. There is now a unit test for it.
- [x] **Installers** (`npm run package`, [INSTALL.md](INSTALL.md)), with no new dependencies:
  - A Windows setup that installs per user without admin rights. It adds shortcuts, an Apps & features entry and "Open with" for score files.
  - A portable Windows zip.
  - A macOS/Linux package with an install script.
  - On every system, a small launcher serves the app on `127.0.0.1` and opens it in its own window.
  - An online server can be connected for sign-in and sharing.
  - The Windows install and uninstall were tested silently. *The macOS/Linux install scripts have not yet been run on those systems.*

### Phase 31: Editing comforts ✅
- [x] **Long notes at the end of a bar** carry on into the next bar as tied notes when they are made longer, as when they are typed.
- [x] **The toolbar follows the selected note**: clicking or arrowing onto a note shows its length, dot and tuplet, and the next length chosen changes it.
- [x] **Clicking a note no longer scrolls to the top**: the cursor glides to its place (CSS transition), so the scrolling now uses its target position instead of where it is drawn mid-glide.
- [x] **Wider on-screen keyboard**: as many octaves as fit, up to six (C1–B6); one octave of wide keys on phones.
- [x] **Notes at the top left and in the footer** (tune and meter; scripture, dedication), kept in the score, printed, exported as images and as MusicXML credits, and shown on shared pages.
- [x] **Combine voices into chords**: where voice 2 moves with voice 1, both share one stem (soprano + alto, tenor + bass); other notes stay in voice 2.
- [x] **Beaming by the time signature**: 6/8, 9/8 and 12/8 beam eighths in threes.
- [x] **Select by dragging** across notes, with **Copy, Cut and Paste** buttons in the toolbar.
- [x] **Change one note of a chord**: click its head (or Alt+Up/Down) to pick it; a letter, the arrows, octave, accidentals and Delete then change only that note. Escape goes back to the whole chord.
- [x] **A different length for one chord note**: with a chord note picked, a new length gives it its own stem in the voice below (alto under soprano, bass under tenor), so the parts can move separately while staying aligned; the top note keeps the upper stem.
- [x] **The score setup panel folds away** on wider screens (the settings button in the top bar); the choice is remembered.

### Phase 32: Accounts people can get back into, and safer pages ✅
- [x] **Forgot your password?** in the sign-in dialog emails a one-time link (1 hour). The answer is the same whether or not the address has an account. The token travels in the `#` part of the link (never sent to a server or in a referrer), is removed from the address bar at once, and only its SHA-256 is stored.
- [x] **Change password** in the account menu (asks for the current one). A new or reset password **signs the account out on every other device** (an epoch per account that sessions must match).
- [x] **Email confirmation**: new accounts get a link (7 days); **✉ Confirm my email** sends a new one. Optional `require_verified_email` lets only confirmed accounts comment or list scores publicly.
- [x] **Reliable email**: a dependency-free SMTP client (STARTTLS or TLS, AUTH PLAIN/LOGIN, dot-stuffing, UTF-8), tested against a fake SMTP server; PHP `mail()` only as a fallback. Failures are logged, never break a request. Links come only from `site_url`, never from the request's `Host`.
- [x] **Sign-in limits per account and per address**: wrong passwords are counted per account (10 / 15 min) and per IP (50), new accounts per IP (30), so a classroom behind one address is not locked out.
- [x] **Security headers**: every page carries a Content-Security-Policy (scripts only from the site, no inline scripts or `eval`, samples only from their two hosts). `dist/.htaccess` adds clickjacking protection (except `embed.html`), HSTS, `nosniff`, a referrer policy, a permissions policy and caching rules; the API sends its own strict policy. Nginx settings are in DEPLOY.md. The end-to-end tests fail on any policy violation, and the Apache headers were checked on a real Apache.

### Phase 33: Ready for real traffic ✅
- [x] **Smaller first load**: VexFlow's font-free core, with Bravura and Academico as separate `.woff2` files (cached on their own) instead of six fonts inlined as base64. The engraver went from 1,382 kB (775 kB gzipped) to 591 kB (177 kB) plus 293 kB of fonts; the installers shrank by a quarter. Image export fetches the font files to embed them.
- [x] **Crash reports**: uncaught errors in browsers and unexpected API exceptions are stored grouped (message, place in the code, page, version, browser; emails, tokens and query strings removed), at most 5 per page and 30 per address and hour. Admins see them in **admin.html → Errors** and mark them fixed; an optional webhook posts new ones to a team chat. The privacy page says so, in all four languages.
- [x] **Behind proxies and CDNs**: `trusted_proxies` (addresses or CIDR ranges, IPv4 and IPv6) and `client_ip_header` (e.g. Cloudflare's), so limits use the visitor's address and HTTPS is recognised for the `Secure` cookie and HSTS. Forwarded headers from anyone else are ignored.
- [x] **MySQL/MariaDB for larger sites**: the API tests now also run on MySQL 8 in CI, and all API and browser tests were run on MariaDB 10.4, which found and fixed a search query that only worked on SQLite. The database can be set from the environment.
- [x] **Backups**: `server/cron/backup.php` (nightly, keeps 14) writes every table as compressed JSON lines, the same for SQLite and MySQL; `restore.php` loads one into an empty database in one transaction. This is also how a site moves from SQLite to MySQL (checked with a copy of a real database).
- [x] **Signed installers**: `npm run package` signs the Windows programs with Authenticode (certificate file or store, timestamped) when a certificate is configured, and says so when not; checked with a test certificate. On macOS the install script clears the download's quarantine flag and signs the app locally, so Gatekeeper opens it.
- [x] **Lint**: stricter compiler settings, the tests type-checked too (which found a test using a note length that does not exist), and `scripts/lint.mjs` for project rules (no `eval`/`debugger`/`.only`, `noopener` on new-tab links, every toast translated, PHP strict types and no request input in SQL text, no private keys, whitespace, `php -l`). `npm run lint` runs in CI.

### Phase 34: My scores without an account, and updates for the desktop app ✅
- [x] **A library on this computer**: Ctrl+S saves the score to **My scores** without signing in or a server (IndexedDB, persistent storage requested). A saved score keeps itself saved as you edit ("Saved on this computer"). My scores lists every score to open, duplicate or delete; when signed in it shows the online library too, with **Copy online**. **Back up all…** / **Restore…** move the whole library as one file. Without a server (the desktop app on its own) the Sign in button is hidden.
- [x] **Updates for the desktop app**: the launcher tells the app its version (`/__desktop.json`); once a day the app looks at the latest GitHub release (or a self-hosted `latest.json`) and shows a bar with what is new, **Update now** / **Download** and **Later**; also *Check for updates* in the command search.
- [x] **One-click install on Windows**: the launcher downloads the setup only from that repository's releases, checks the file, its SHA-256 and (for signed builds) the publisher's signature, and runs it with `/update`. The setup waits for the window to close (it closes itself after saving), installs over the old version keeping scores, settings and shortcuts, and opens Pianissimo again. Requests from other websites are refused. Tested with a local feed (download, checksum rejection) and against the real GitHub repository; the final install step was not run, so as not to replace the installed copy on the development machine.

**Phases 1–34 are complete.** Section 2 lists what is still open.

## 5. How a phase is built

1. Model changes first, with unit tests.
2. Editor commands registered in `src/editor/commands.ts` (toolbar, shortcuts, help and search come for free).
3. Rendering, then MusicXML/MIDI round trips.
4. Browser check of real usage (screenshots), then fix what looks wrong.
5. Update the README and tick this roadmap.
