import type { Editor } from '../editor/editor';
import { lane } from '../model/score';
import type { Layout } from '../render/renderer';
import { api, type ScoreMeta } from './api';
import { LiveSession, webSocketTransport, type Peer } from './live';
import type { Cloud } from './ui';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface LiveUiHooks {
  toast(message: string): void;
  /** Current score layout (for placing collaborators' cursors). */
  layout(): Layout | null;
  /** Element the cursors are positioned in (the parent of the editor's own cursor). */
  cursorHost(): HTMLElement;
  /** Header element showing "Live" and who is here. */
  indicator(): HTMLElement;
}

/**
 * Joins the live co-editing session of the library score that is open, when the server
 * offers one. Reconnects after a dropped connection; while disconnected, saving falls back to
 * the normal conflict-safe saves. Returns `render`, to call after each layout pass.
 */
export function initLive(editor: Editor, cloud: Cloud, hooks: LiveUiHooks) {
  let session: LiveSession | null = null;
  let linked: ScoreMeta | null = null;
  let peers: Peer[] = [];
  let retry = 0;
  let retryTimer = 0;

  function stop() {
    clearTimeout(retryTimer);
    const s = session;
    session = null;
    s?.close();
    cloud.live = null;
    peers = [];
    render();
  }

  async function start(meta: ScoreMeta | null) {
    stop();
    linked = meta;
    if (!meta || !cloud.user) return;
    let ticket: { url: string | null; token?: string };
    try {
      ticket = await api.realtimeTicket(meta.id);
    } catch {
      return; // offline: the 'online' handler of the cloud re-links later
    }
    if (!ticket.url || !ticket.token || linked !== meta) return;
    const mine: LiveSession = new LiveSession(editor, webSocketTransport(ticket.url, ticket.token), {
      onStatus(connected) {
        if (session !== mine) return;
        if (connected) {
          retry = 0;
          cloud.live = { leader: mine.leader };
        } else {
          cloud.live = null;
          peers = [];
          // try again: 2 s, 4 s, 8 s … up to 30 s
          const wait = Math.min(30_000, 2000 * 2 ** retry++);
          retryTimer = window.setTimeout(() => {
            if (linked === meta) void start(meta);
          }, wait);
        }
        cloud.onChange();
        render();
      },
      onLeader(leader) {
        if (session !== mine || !cloud.live) return;
        cloud.live.leader = leader;
        cloud.onChange();
        // the new leader saves what the old one may not have saved yet
        if (leader && cloud.status === 'Unsaved changes') void cloud.save();
      },
      onSaved(revision) {
        if (session === mine) cloud.markSaved(revision);
      },
      onPeers(list) {
        if (session !== mine) return;
        peers = list;
        render();
      },
      onHistoryReset() {
        hooks.toast('A collaborator changed the layout of the score (bars or instruments): undo starts again from here');
      },
    });
    session = mine;
  }

  cloud.onLinked = (meta) => void start(meta);
  cloud.onSaved = (revision) => session?.saved(revision);

  /** Collaborators' cursors on the score and the "Live" badge in the header. */
  function render() {
    const host = hooks.cursorHost();
    host.querySelectorAll('.peer-cursor').forEach((e) => e.remove());
    const badge = hooks.indicator();
    if (!session?.connected) {
      badge.hidden = true;
      return;
    }
    badge.hidden = false;
    const names = peers.map((p) => p.name);
    badge.title = names.length ? `Editing now: you, ${names.join(', ')}` : 'Live: changes are shared as you type';
    badge.innerHTML =
      `<span class="live-dot" aria-hidden="true"></span>Live` +
      peers.map((p) => `<span class="peer-chip" style="--peer:${p.color}" title="${esc(p.name)}">${esc(p.name.slice(0, 1).toUpperCase())}</span>`).join('');
    const layout = hooks.layout();
    if (!layout) return;
    for (const p of peers) {
      const c = p.cursor;
      if (!c) continue;
      const ev = lane(editor.score, c.m, c.s, c.v ?? 0)[c.i];
      const box = ev && layout.events.get(ev.id);
      const st = layout.staves.find((b) => b.m === c.m && b.s === c.s);
      if (!box || !st) continue;
      const el = document.createElement('div');
      el.className = 'peer-cursor';
      el.style.cssText = `left:${box.x - 5}px;top:${st.top - st.spacing * 2}px;width:${box.width + 10}px;height:${st.spacing * 8}px;--peer:${p.color}`;
      el.innerHTML = `<span>${esc(p.name)}</span>`;
      host.append(el);
    }
  }

  return { render, stop };
}
