import { Player } from './audio/player';
import { api, ApiError, type PublicComment, type PublicScore, type User } from './cloud/api';
import { fromMusicXML, toMusicXML } from './io/musicxml';
import { readMxl } from './io/mxl';
import type { Score } from './model/types';
import { buildPrintPages, PAGE_SIZES } from './render/print';
import { renderScore, type Layout } from './render/renderer';

/** Key the editor reads on start-up to import a score (see main.ts). */
export const IMPORT_KEY = 'pianissimo:import';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const player = new Player();
let score: Score | null = null;
let layout: Layout | null = null;

function message(text: string) {
  const el = $('vMessage');
  el.textContent = text;
  el.hidden = false;
}

function draw() {
  if (!score) return;
  const host = $('vScore');
  layout = renderScore(host, score, Math.min(1100, $('vSheet').clientWidth - 8));
}

function show(s: Score, by: string) {
  score = s;
  document.title = `${s.title} · Pianissimo`;
  $('vTitle').textContent = s.title;
  $('vBy').textContent = [s.composer, by].filter(Boolean).join(' · ');
  $('vHeaderNote').textContent = s.headerNote ?? '';
  $('vHeaderNote').hidden = !s.headerNote;
  $('vFooterNote').textContent = s.footerNote ?? '';
  $('vFooterNote').hidden = !s.footerNote;
  $('viewerBar').hidden = false;
  $('vSheet').hidden = false;
  $('vDrop').hidden = true;
  $('vMessage').hidden = true;
  // lay out once the music font is ready (glyph metrics depend on it)
  void document.fonts.ready.then(draw);
}

function isScore(x: unknown): x is Score {
  const s = x as Score;
  return !!s && s.version === 1 && Array.isArray(s.measures) && Array.isArray(s.staves);
}

async function openFile(file: File) {
  try {
    const text = /\.mxl$/i.test(file.name) ? await readMxl(await file.arrayBuffer()) : await file.text();
    const s = text.trimStart().startsWith('{') ? JSON.parse(text) : fromMusicXML(text);
    if (!isScore(s)) throw new Error('Not a Pianissimo score file.');
    show(s, file.name);
  } catch (err) {
    message(`Could not open “${file.name}”: ${(err as Error).message}`);
  }
}

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------------------------ controls
player.onEvent = (ev) => {
  const ph = $('vPlayhead');
  if (!ev || !layout) {
    ph.style.display = 'none';
    $('vPlay').textContent = '▶ Play';
    return;
  }
  const box = layout.events.get(ev.id);
  const tops = layout.staves.filter((b) => b.m === ev.m);
  if (!box || !tops.length) return;
  const first = tops[0];
  const last = tops[tops.length - 1];
  ph.style.display = 'block';
  ph.style.left = `${box.x - 4}px`;
  ph.style.top = `${first.top - first.spacing + 18}px`; // sheet padding
  ph.style.height = `${last.top - first.top + last.spacing * 6}px`;
};

$('vPlay').addEventListener('click', async () => {
  if (!score) return;
  if (player.playing) return player.stop();
  $('vPlay').textContent = '■ Stop';
  await player.play(score);
});
$('vPrint').addEventListener('click', () => {
  if (!score) return;
  $('printPages').replaceChildren(...buildPrintPages(score));
  $('pageStyle').textContent = `@page { size: ${PAGE_SIZES[score.print?.pageSize ?? 'a4'].css}; margin: 0; }`;
  window.print();
});
$('vXml').addEventListener('click', () => {
  if (score) download(toMusicXML(score), `${score.title || 'score'}.musicxml`, 'application/vnd.recordare.musicxml+xml');
});
$('vEdit').addEventListener('click', () => {
  if (!score) return;
  localStorage.setItem(IMPORT_KEY, JSON.stringify(score));
  location.href = 'app.html?import=1';
});
$<HTMLInputElement>('vFile').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void openFile(f);
});
const drop = $('vDrop');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer?.files?.[0];
  if (f) void openFile(f);
});
let resize = 0;
window.addEventListener('resize', () => {
  clearTimeout(resize);
  resize = window.setTimeout(draw, 150);
});

// ------------------------------------------------------------------ likes, remixes, comments
let me: User | null = null;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const needSignIn = () => {
  $('vCommentHint').hidden = false;
  $('vCommentHint').scrollIntoView({ block: 'nearest' });
};

function showSocial(s: PublicScore, slug: string) {
  $('socialBar').hidden = false;
  const author = $<HTMLAnchorElement>('vAuthor');
  author.textContent = `by ${s.author}`;
  author.href = `profile.html?u=${s.author_id}`;
  $('vRemixOf').innerHTML = s.remix_of
    ? `· remix of <a href="view.html?s=${encodeURIComponent(s.remix_of.slug)}">${esc(s.remix_of.title)}</a> by ${esc(s.remix_of.author)}`
    : '';
  const like = $('vLike');
  const paint = (liked: boolean, n: number) => {
    like.firstChild!.textContent = liked ? '♥ ' : '♡ ';
    $('vLikes').textContent = String(n);
    like.setAttribute('aria-pressed', String(liked));
    like.classList.toggle('on', liked);
  };
  paint(!!s.liked, s.likes);
  like.onclick = async () => {
    if (!me) return needSignIn();
    try {
      const r = await api.like(slug);
      paint(r.liked, r.likes);
    } catch (err) {
      message((err as Error).message);
    }
  };
  $('vRemix').onclick = async () => {
    if (!me) return needSignIn();
    try {
      const { score } = await api.remix(slug);
      location.href = `app.html?open=${score.id}`;
    } catch (err) {
      message((err as Error).message);
    }
  };
  $('vReport').onclick = async () => {
    if (!me) return needSignIn();
    if (!confirm('Report this score as inappropriate? After a few reports it is taken off Explore.')) return;
    await api.reportScore(slug).catch(() => {});
    $('vReport').textContent = '⚑ Reported';
    $<HTMLButtonElement>('vReport').disabled = true;
  };
  void loadComments(slug);
}

function renderComments(slug: string, list: PublicComment[]) {
  $('vCommentList').innerHTML =
    list
      .map(
        (c) => `<li data-id="${c.id}"><div class="comment-head"><a href="profile.html?u=${c.author.id}"><b>${esc(c.author.name)}</b></a>
          <span class="hint">${new Date(c.created_at).toLocaleDateString()}</span>
          ${c.can_delete ? '<button class="link-btn" data-act="del">Delete</button>' : me ? '<button class="link-btn report" data-act="report">Report</button>' : ''}</div>
          <p>${esc(c.text)}</p></li>`,
      )
      .join('') || '<li class="hint">No comments yet.</li>';
  $('vCommentList').querySelectorAll<HTMLElement>('li[data-id]').forEach((li) => {
    const id = Number(li.dataset.id);
    li.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
      if (!confirm('Delete this comment?')) return;
      await api.deleteComment(id).catch(() => {});
      void loadComments(slug);
    });
    li.querySelector('[data-act="report"]')?.addEventListener('click', async (e) => {
      await api.reportComment(id).catch(() => {});
      (e.target as HTMLButtonElement).textContent = 'Reported';
      (e.target as HTMLButtonElement).disabled = true;
    });
  });
}

async function loadComments(slug: string) {
  $('vComments').hidden = false;
  $('vCommentForm').hidden = !me;
  $('vCommentHint').hidden = !!me;
  try {
    renderComments(slug, (await api.comments(slug)).comments);
  } catch {
    $('vCommentList').innerHTML = '<li class="hint">Comments could not be loaded.</li>';
  }
  const form = $<HTMLFormElement>('vCommentForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const box = form.elements.namedItem('text') as HTMLTextAreaElement;
    try {
      renderComments(slug, (await api.addComment(slug, box.value)).comments);
      box.value = '';
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) needSignIn();
      else alert((err as Error).message);
    }
  };
}

// ------------------------------------------------------------------ boot
const slug = new URLSearchParams(location.search).get('s');
if (slug) {
  // who is looking (for likes and comments); the page works signed out too
  const who = api.me().then(
    (r) => (me = r.user),
    () => null,
  );
  api
    .publicScore(slug)
    .then(async ({ score: s }) => {
      show(s.data!, `shared by ${s.author}`);
      await who;
      showSocial(s, slug);
    })
    .catch((err) =>
      message(
        err.status === 404
          ? 'This score does not exist or is no longer shared.'
          : `Could not load the score: ${(err as Error).message}`,
      ),
    );
} else {
  drop.hidden = false;
}
