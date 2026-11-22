/**
 * Accessibility helpers for the editor:
 * - a polite live region so screen readers hear where the cursor is and what was written;
 * - dialogs that behave like dialogs: labelled, focus moves in when they open, Tab stays
 *   inside, Escape closes, and focus returns to where it was when they close.
 */

let live: HTMLElement | null = null;
let timer = 0;

/** Speak a short message through the live region (debounced so fast typing is not a flood). */
export function announce(message: string, delay = 120) {
  if (!live) {
    live = document.createElement('div');
    live.id = 'srLive';
    live.className = 'sr-only';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    document.body.append(live);
  }
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    // re-setting identical text is not announced again, so clear it first
    live!.textContent = '';
    requestAnimationFrame(() => (live!.textContent = message));
  }, delay);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function visibleFocusables(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[hidden]') && el.offsetParent !== null);
}

const returnTo = new WeakMap<HTMLElement, HTMLElement | null>();
let counter = 0;

function enhance(modal: HTMLElement) {
  if (modal.dataset.a11y) return;
  modal.dataset.a11y = '1';
  const card = modal.querySelector<HTMLElement>('.modal-card') ?? modal;
  if (!card.getAttribute('role')) card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  const heading = card.querySelector<HTMLElement>('h2');
  if (heading && !card.getAttribute('aria-labelledby')) {
    heading.id ||= `dlgTitle${++counter}`;
    card.setAttribute('aria-labelledby', heading.id);
  } else if (!heading && !card.getAttribute('aria-label')) {
    card.setAttribute('aria-label', modal.id.replace(/Modal$/, '').replace(/([A-Z])/g, ' $1'));
  }
  modal.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.setAttribute('aria-label', 'Close'));

  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      modal.hidden = true;
      return;
    }
    if (e.key !== 'Tab') return;
    const items = visibleFocusables(card);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  new MutationObserver(() => {
    if (!modal.hidden) {
      returnTo.set(modal, document.activeElement as HTMLElement | null);
      // let the opener fill and focus the dialog first; only step in if focus is still outside
      requestAnimationFrame(() => {
        if (modal.hidden || card.contains(document.activeElement)) return;
        const items = visibleFocusables(card);
        (items.find((el) => !el.matches('[data-close]')) ?? items[0])?.focus();
      });
    } else {
      const back = returnTo.get(modal);
      returnTo.delete(modal);
      if (back && document.contains(back) && !back.closest('[hidden]')) back.focus();
      else (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }).observe(modal, { attributes: true, attributeFilter: ['hidden'] });
}

/** Make every current and future `.modal` an accessible dialog. */
export function enhanceDialogs() {
  document.querySelectorAll<HTMLElement>('.modal').forEach(enhance);
  new MutationObserver((records) => {
    for (const r of records)
      r.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement && n.classList.contains('modal')) enhance(n);
      });
  }).observe(document.body, { childList: true });
}

/** Buttons that only show a glyph get their tooltip as an accessible name. */
export function labelIconButtons(root: ParentNode = document) {
  root.querySelectorAll<HTMLButtonElement>('button[title]:not([aria-label])').forEach((b) => {
    b.setAttribute('aria-label', b.title);
  });
}
