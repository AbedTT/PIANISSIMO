import './site.css';
import { api, type PublicScore } from '../cloud/api';
import { COMMANDS, prettyKey, type Command } from '../editor/commands';

const NAV = [
  { href: 'index.html', label: 'Home', page: 'home' },
  { href: 'guide.html', label: 'Guide', page: 'guide' },
  { href: 'explore.html', label: 'Explore scores', page: 'explore' },
  { href: 'about.html', label: 'About', page: 'about' },
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function header(page: string) {
  const el = document.createElement('header');
  el.className = 'site-header';
  el.innerHTML = `<div class="wrap">
      <a class="brand" href="index.html"><span class="logo">𝄞</span> Pianissimo</a>
      <nav class="site-nav" id="siteNav">
        ${NAV.map((n) => `<a href="${n.href}" class="${n.page === page ? 'active' : ''}">${n.label}</a>`).join('')}
      </nav>
      <a class="btn btn-primary btn-small cta" href="app.html">Open the editor</a>
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
          <p style="color:var(--muted);max-width:340px">Write sheet music as fast as you can type. Free, in your browser.</p>
        </div>
        <div><h4>Product</h4><ul>
          <li><a href="app.html">Editor</a></li><li><a href="guide.html">Guide &amp; shortcuts</a></li><li><a href="explore.html">Explore scores</a></li>
        </ul></div>
        <div><h4>Project</h4><ul>
          <li><a href="about.html">About</a></li><li><a href="about.html#credits">Credits</a></li>
        </ul></div>
        <div><h4>Legal</h4><ul>
          <li><a href="privacy.html">Privacy</a></li><li><a href="terms.html">Terms</a></li>
        </ul></div>
      </div>
      <div class="fine">© ${new Date().getFullYear()} Pianissimo. Music engraving by VexFlow, sound by Tone.js.</div>
    </div>`;
  document.body.append(el);
}

// ------------------------------------------------------------------ page features

/** Cards for a list of public scores. */
export function scoreCards(scores: PublicScore[]): string {
  return scores
    .map(
      (s) => `<a class="score-card" href="view.html?s=${encodeURIComponent(s.slug)}">
        <span class="t">${esc(s.title)}</span>
        <span class="meta">${esc(s.composer || 'Unknown composer')}</span>
        <span class="meta">by ${esc(s.author)} · ${new Date(s.updated_at).toLocaleDateString()}</span>
      </a>`,
    )
    .join('');
}

async function gallery(host: HTMLElement, opts: { query?: string; limit?: number; hideWhenEmpty?: HTMLElement }) {
  try {
    const { scores } = await api.publicList(opts.query);
    const list = opts.limit ? scores.slice(0, opts.limit) : scores;
    if (!list.length) {
      if (opts.hideWhenEmpty) opts.hideWhenEmpty.hidden = true;
      else host.innerHTML = `<div class="empty">No public scores${opts.query ? ' match your search' : ' yet'}. Be the first: write one and share it publicly.</div>`;
      return;
    }
    host.innerHTML = scoreCards(list);
    if (opts.hideWhenEmpty) opts.hideWhenEmpty.hidden = false;
  } catch {
    if (opts.hideWhenEmpty) opts.hideWhenEmpty.hidden = true;
    else host.innerHTML = `<div class="empty">The score server is not reachable right now.</div>`;
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
    if (!ev) btn.textContent = '▶ Listen';
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
  const keys = (c: Command) => c.keys!.slice(0, 2).map((k) => `<kbd>${esc(prettyKey(k))}</kbd>`).join(' or ');
  host.innerHTML =
    `<h3>Writing notes</h3><table><tr><th>Action</th><th>Keys</th></tr>
      <tr><td>Write a note</td><td><kbd>A</kbd> … <kbd>G</kbd></td></tr>
      <tr><td>Add a note to the chord</td><td><kbd>Shift</kbd> + <kbd>A</kbd> … <kbd>G</kbd></td></tr>
      <tr><td>Add an interval above</td><td><kbd>Alt</kbd> + <kbd>2</kbd> … <kbd>8</kbd></td></tr></table>` +
    [...groups]
      .map(
        ([g, cmds]) =>
          `<h3>${esc(g)}</h3><table><tr><th>Action</th><th>Keys</th></tr>${cmds
            .map((c) => `<tr><td>${esc(c.label)}${c.palette ? ` <em>(${c.palette} tab)</em>` : ''}</td><td>${keys(c)}</td></tr>`)
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
  const run = () => gallery(host, { query: search.value.trim() });
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = window.setTimeout(run, 250);
  });
  void run();
}

// ------------------------------------------------------------------ boot
const page = document.body.dataset.page ?? '';
header(page);
footer();
void homeDemo();
guideTables();
explorePage();
const recent = document.getElementById('recentGallery');
if (recent) void gallery(recent, { limit: 6, hideWhenEmpty: document.getElementById('recentSection')! });
