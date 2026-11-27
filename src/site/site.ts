import './site.css';
import { api, type PublicScore } from '../cloud/api';
import { COMMANDS, prettyKey, type Command } from '../editor/commands';
import { currentLang, LANGUAGES, setLang, siteText, t, tLabel, translateSite, type Lang } from '../ui/i18n';
import { registerServiceWorker } from '../pwa/register';

const NAV = [
  { href: 'index.html', label: 'Home', page: 'home', key: 'nav.home' },
  { href: 'guide.html', label: 'Guide', page: 'guide', key: 'nav.guide' },
  { href: 'explore.html', label: 'Explore scores', page: 'explore', key: 'nav.explore' },
  { href: 'about.html', label: 'About', page: 'about', key: 'nav.about' },
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function header(page: string) {
  const el = document.createElement('header');
  el.className = 'site-header';
  el.innerHTML = `<div class="wrap">
      <a class="brand" href="index.html"><span class="logo">𝄞</span> Pianissimo</a>
      <nav class="site-nav" id="siteNav">
        ${NAV.map((n) => `<a href="${n.href}" class="${n.page === page ? 'active' : ''}" data-i18n="${n.key}">${n.label}</a>`).join('')}
      </nav>
      <a class="btn btn-primary btn-small cta" href="app.html" data-i18n="nav.open">Open the editor</a>
      <button class="menu-toggle" aria-label="Menu" aria-controls="siteNav">☰</button>
    </div>`;
  el.querySelector('.menu-toggle')!.addEventListener('click', () => el.querySelector('.site-nav')!.classList.toggle('open'));
  document.body.prepend(el);
}

function footer() {
  const el = document.createElement('footer');
  el.className = 'site-footer';
  el.innerHTML = `<div class="wrap">
      <div class="cols">
        <div>
          <a class="brand" href="index.html"><span class="logo">𝄞</span> Pianissimo</a>
          <p style="color:var(--muted);max-width:340px" data-i18n="foot.tagline">Write sheet music as fast as you can type. Free, in your browser.</p>
          <label class="lang-pick"><span data-i18n="foot.lang">Language</span>
            <select id="siteLang">${LANGUAGES.map((l) => `<option value="${l.id}">${l.name}</option>`).join('')}</select></label>
        </div>
        <div><h4 data-i18n="foot.product">Product</h4><ul>
          <li><a href="app.html" data-i18n="foot.editor">Editor</a></li><li><a href="guide.html" data-i18n="foot.guide">Guide &amp; shortcuts</a></li><li><a href="explore.html" data-i18n="nav.explore">Explore scores</a></li>
        </ul></div>
        <div><h4 data-i18n="foot.project">Project</h4><ul>
          <li><a href="about.html" data-i18n="nav.about">About</a></li><li><a href="about.html#credits" data-i18n="foot.credits">Credits</a></li>
        </ul></div>
        <div><h4 data-i18n="foot.legal">Legal</h4><ul>
          <li><a href="privacy.html" data-i18n="foot.privacy">Privacy</a></li><li><a href="terms.html" data-i18n="foot.terms">Terms</a></li>
        </ul></div>
      </div>
      <div class="fine">© ${new Date().getFullYear()} Pianissimo. Music engraving by VexFlow, sound by Tone.js.</div>
    </div>`;
  document.body.append(el);
  const pick = el.querySelector<HTMLSelectElement>('#siteLang')!;
  pick.value = currentLang();
  pick.addEventListener('change', () => {
    setLang(pick.value as Lang);
    applyLanguage();
  });
}

let runExplore: (() => Promise<void>) | undefined;

/** Translate the page; pages that have no translation say so instead. */
function applyLanguage() {
  translateSite();
  document.getElementById('englishOnly')?.remove();
  const main = document.querySelector('main');
  if (currentLang() !== 'en' && main?.dataset.englishOnly !== undefined) {
    const note = document.createElement('p');
    note.id = 'englishOnly';
    note.className = 'english-only wrap';
    note.textContent = main.dataset.englishOnly === 'partial' ? siteText('foot.partialEnglish', '') : siteText('foot.englishOnly', '');
    main.prepend(note);
  }
  guideTables();
  if (runExplore) void runExplore();
}

// ------------------------------------------------------------------ page features

/** Cards for a list of public scores. */
export function scoreCards(scores: PublicScore[]): string {
  return scores
    .map(
      (s) => `<a class="score-card" href="view.html?s=${encodeURIComponent(s.slug)}">
        <span class="t">${esc(s.title)}</span>
        <span class="meta">${esc(s.composer || siteText('gallery.unknown', 'Unknown composer'))}</span>
        <span class="meta">${siteText('gallery.by', 'by')} ${esc(s.author)}${s.likes ? ` · ♥ ${s.likes}` : ''} · ${new Date(s.updated_at).toLocaleDateString()}</span>
      </a>`,
    )
    .join('');
}

async function gallery(host: HTMLElement, opts: { query?: string; limit?: number; hideWhenEmpty?: HTMLElement; sort?: 'new' | 'likes' }) {
  try {
    const { scores } = await api.publicList(opts.query, opts.sort);
    const list = opts.limit ? scores.slice(0, opts.limit) : scores;
    if (!list.length) {
      if (opts.hideWhenEmpty) opts.hideWhenEmpty.hidden = true;
      else {
        const msg = opts.query
          ? siteText('gallery.noMatch', 'No public scores match your search.')
          : siteText('gallery.none', 'No public scores yet. Be the first: write one and share it publicly.');
        host.innerHTML = `<div class="empty">${msg}</div>`;
      }
      return;
    }
    host.innerHTML = scoreCards(list);
    if (opts.hideWhenEmpty) opts.hideWhenEmpty.hidden = false;
  } catch {
    if (opts.hideWhenEmpty) opts.hideWhenEmpty.hidden = true;
    else host.innerHTML = `<div class="empty">${siteText('gallery.offline', 'The score server is not reachable right now.')}</div>`;
  }
}

async function homeDemo() {
  const host = document.getElementById('demoScore');
  if (!host) return;
  const [{ demoScore }, { renderScore }, { Player }] = await Promise.all([
    import('./demo'),
    import('../render/renderer'),
    import('../audio/player'),
  ]);
  const score = demoScore();
  const draw = () => renderScore(host, score, Math.max(320, host.clientWidth - 4));
  // the music font must be loaded before layout, or glyph widths (and stems) come out wrong
  await document.fonts.ready;
  draw();
  let t = 0;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = window.setTimeout(draw, 150);
  });
  const player = new Player();
  const btn = document.getElementById('demoPlay') as HTMLButtonElement;
  player.onEvent = (ev) => {
    if (!ev) btn.textContent = siteText('home.listen', '▶ Listen');
  };
  btn.addEventListener('click', async () => {
    if (player.playing) return player.stop();
    btn.textContent = '■ Stop';
    await player.play(score);
  });
}

function guideTables() {
  const host = document.getElementById('shortcutTables');
  if (!host) return;
  const groups = new Map<string, Command[]>();
  for (const c of COMMANDS) {
    if (!c.keys?.length || /^(note|chord|interval)[A-G2-8]$/.test(c.id)) continue;
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group)!.push(c);
  }
  const tx = (key: string, en: string) => siteText(`guide.${key}`, en);
  const keys = (c: Command) => c.keys!.slice(0, 2).map((k) => `<kbd>${esc(prettyKey(k))}</kbd>`).join(` ${tx('or', 'or')} `);
  const head = `<tr><th>${tx('action', 'Action')}</th><th>${tx('keys', 'Keys')}</th></tr>`;
  host.innerHTML =
    `<h3>${tx('writing', 'Writing notes')}</h3><table>${head}
      <tr><td>${tx('writeNote', 'Write a note')}</td><td><kbd>A</kbd> … <kbd>G</kbd></td></tr>
      <tr><td>${tx('addChord', 'Add a note to the chord')}</td><td><kbd>Shift</kbd> + <kbd>A</kbd> … <kbd>G</kbd></td></tr>
      <tr><td>${tx('addInterval', 'Add an interval above')}</td><td><kbd>Alt</kbd> + <kbd>2</kbd> … <kbd>8</kbd></td></tr></table>` +
    [...groups]
      .map(
        ([g, cmds]) =>
          `<h3>${esc(t(g))}</h3><table>${head}${cmds
            .map((c) => `<tr><td>${esc(tLabel(c.label))}${c.palette ? ` <em>(${t(c.palette)} ${t('tab')})</em>` : ''}</td><td>${keys(c)}</td></tr>`)
            .join('')}</table>`,
      )
      .join('');
}

function explorePage() {
  const host = document.getElementById('exploreGallery');
  if (!host) return;
  const search = document.getElementById('exploreSearch') as HTMLInputElement;
  const params = new URLSearchParams(location.search);
  search.value = params.get('q') ?? '';
  let t = 0;
  const sort = document.getElementById('exploreSort') as HTMLSelectElement | null;
  const run = () => gallery(host, { query: search.value.trim(), sort: sort?.value === 'likes' ? 'likes' : 'new' });
  sort?.addEventListener('change', () => void run());
  runExplore = run;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = window.setTimeout(run, 250);
  });
}

/** admin.html: reported comments and scores, for site admins. */
async function adminPage() {
  const host = document.getElementById('adminReports');
  if (!host) return;
  const me = await api.me().then((r) => r.user, () => null);
  if (!me?.admin) {
    host.innerHTML = `<div class="empty">${me ? 'This page is for site admins.' : 'Sign in in the <a href="app.html">editor</a> first.'}</div>`;
    return;
  }
  const load = async () => {
    const { reports } = await api.adminReports();
    host.innerHTML = reports.length
      ? `<table class="report-table"><tr><th>What</th><th>Reports</th><th>State</th><th></th></tr>${reports
          .map(
            (r) => `<tr data-kind="${r.kind}" data-id="${r.id}">
              <td><span class="kind">${r.kind === 'comment' ? '💬 Comment' : '🎼 Score'}</span> by ${esc(r.author)}<br /><q>${esc(r.text)}</q>
                <br /><a href="${esc(r.link)}" target="_blank" rel="noopener">Open ↗</a></td>
              <td>${r.reports}<br /><small>${new Date(r.last).toLocaleString()}</small></td>
              <td>${r.hidden ? 'hidden' : 'visible'}</td>
              <td class="actions">
                ${r.hidden ? '<button class="btn btn-ghost btn-small" data-act="restore">Show again</button>' : ''}
                <button class="btn btn-ghost btn-small" data-act="dismiss">Dismiss reports</button>
                <button class="btn btn-small danger" data-act="remove">${r.kind === 'comment' ? 'Delete comment' : 'Make private'}</button>
              </td></tr>`,
          )
          .join('')}</table>`
      : '<div class="empty">Nothing reported. 🎉</div>';
    host.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', async () => {
        const row = b.closest<HTMLElement>('tr')!;
        await api.moderate(row.dataset.kind as 'comment' | 'score', Number(row.dataset.id), b.dataset.act as 'restore' | 'dismiss' | 'remove');
        void load();
      }),
    );
  };
  await load().catch((err) => (host.innerHTML = `<div class="empty">${esc((err as Error).message)}</div>`));
}

/** profile.html?u=<id>: a person's public scores. */
async function profilePage() {
  const host = document.getElementById('profileGallery');
  if (!host) return;
  const id = Number(new URLSearchParams(location.search).get('u'));
  try {
    const { profile } = await api.profile(id);
    document.title = `${profile.user.name} · Pianissimo`;
    document.getElementById('profileName')!.textContent = profile.user.name;
    const since = new Date(profile.user.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    document.getElementById('profileMeta')!.textContent = `${siteText('profile.since', 'Writing music on Pianissimo since')} ${since} · ${profile.scores.length} ${siteText('profile.scores', 'public scores')} · ♥ ${profile.likes}`;
    host.innerHTML = profile.scores.length ? scoreCards(profile.scores) : `<div class="empty">${siteText('profile.none', 'No public scores yet.')}</div>`;
  } catch {
    document.getElementById('profileName')!.textContent = siteText('profile.missing', 'This person could not be found.');
    host.innerHTML = '';
  }
}

// ------------------------------------------------------------------ boot
const page = document.body.dataset.page ?? '';
header(page);
footer();
registerServiceWorker();
void homeDemo();
explorePage();
void profilePage();
void adminPage();
applyLanguage();
const recent = document.getElementById('recentGallery');
if (recent) void gallery(recent, { limit: 6, hideWhenEmpty: document.getElementById('recentSection')! });
