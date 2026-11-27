import { startErrorReporting } from './monitor/errors';
import { Player } from './audio/player';
import { api } from './cloud/api';
import type { Score } from './model/types';
import { renderScore, type Layout } from './render/renderer';

// unexpected errors from here on reach the admins (admin.html)
startErrorReporting();

/**
 * Compact player for an `<iframe>` on another site: embed.html?s=<share slug>.
 * Only unlisted and public scores load (the API refuses private ones).
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const player = new Player();
let score: Score | null = null;
let layout: Layout | null = null;

const slug = new URLSearchParams(location.search).get('s') ?? '';
$<HTMLAnchorElement>('eOpen').href = new URL(`view.html?s=${encodeURIComponent(slug)}`, location.href).href;

function message(text: string) {
  $('eTitle').textContent = 'Pianissimo';
  $('eScore').innerHTML = `<p class="msg"></p>`;
  $('eScore').querySelector('p')!.textContent = text;
}

function draw() {
  if (!score) return;
  layout = renderScore($('eScore'), score, Math.max(320, Math.min(1100, $('eSheet').clientWidth - 4)));
}

player.onEvent = (ev) => {
  const ph = $('ePlayhead');
  const btn = $('ePlay');
  btn.textContent = player.playing ? '■' : '▶';
  btn.setAttribute('aria-label', player.playing ? 'Stop' : 'Play');
  if (!ev || !layout) {
    ph.style.display = 'none';
    return;
  }
  const box = layout.events.get(ev.id);
  const bars = layout.staves.filter((b) => b.m === ev.m);
  if (!box || !bars.length) return;
  const first = bars[0];
  const last = bars[bars.length - 1];
  ph.style.display = 'block';
  ph.style.left = `${box.x - 4}px`;
  ph.style.top = `${first.top - first.spacing + 8}px`; // sheet padding
  ph.style.height = `${last.top - first.top + last.spacing * 6}px`;
  ph.scrollIntoView({ block: 'nearest' });
};

$('ePlay').addEventListener('click', async () => {
  if (!score) return;
  if (player.playing) return player.stop();
  $('ePlay').textContent = '■';
  await player.play(score);
});

let resize = 0;
window.addEventListener('resize', () => {
  clearTimeout(resize);
  resize = window.setTimeout(draw, 150);
});

if (!slug) message('No score given. Use embed.html?s=<share link code>.');
else {
  api
    .publicScore(slug)
    .then(async ({ score: s }) => {
      score = s.data;
      document.title = `${s.title} · Pianissimo`;
      $('eTitle').textContent = s.title;
      $('eBy').textContent = [s.composer, `shared by ${s.author}`].filter(Boolean).join(' · ');
      $<HTMLButtonElement>('ePlay').disabled = false;
      // glyph metrics depend on the music font
      await document.fonts.ready;
      draw();
    })
    .catch((err) =>
      message(err.status === 404 ? 'This score does not exist or is no longer shared.' : `Could not load the score: ${(err as Error).message}`),
    );
}
