import { t } from './i18n';

const WIDTH_KEY = 'pianissimo:pageWidth';
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/**
 * The printed page beside the score: after a scan (or with any picture you choose), so you can
 * check the notes against the original and fix what the scanner misread. Several pages: ‹ ›.
 * Zoom with − + (or Ctrl + mouse wheel); drag the edge to make it wider. On phones it is a
 * sheet at the bottom of the screen.
 */
export class PagePanel {
  readonly el: HTMLElement;
  /** Called when pages come or go, or the panel opens or closes (to update the top bar). */
  onChange: () => void = () => {};
  private pages: Blob[] = [];
  private urls: string[] = [];
  private index = 0;
  private zoom = 2; // index into ZOOMS: 1 = fit the width

  constructor(host: HTMLElement, before: HTMLElement) {
    this.el = document.createElement('aside');
    this.el.className = 'page-panel';
    this.el.id = 'pagePanel';
    this.el.hidden = true;
    this.el.setAttribute('aria-label', t('The printed page'));
    this.el.innerHTML = `
      <div class="page-head">
        <b>${t('The printed page')}</b>
        <span class="page-nav">
          <button type="button" data-act="prev" aria-label="${t('Previous page')}" title="${t('Previous page')}">‹</button>
          <span class="page-count"></span>
          <button type="button" data-act="next" aria-label="${t('Next page')}" title="${t('Next page')}">›</button>
        </span>
        <span class="page-zoom">
          <button type="button" data-act="out" aria-label="${t('Zoom out')}" title="${t('Zoom out')}">−</button>
          <button type="button" data-act="in" aria-label="${t('Zoom in')}" title="${t('Zoom in')}">+</button>
        </span>
        <button type="button" class="close" data-act="close" aria-label="${t('Hide the page')}" title="${t('Hide the page')}">✕</button>
      </div>
      <div class="page-body"><img alt="" draggable="false" /></div>
      <div class="page-resize" role="separator" aria-orientation="vertical" aria-label="${t('Drag to resize')}" title="${t('Drag to resize')}"></div>`;
    host.insertBefore(this.el, before);
    try {
      const w = Number(localStorage.getItem(WIDTH_KEY));
      if (w >= 220) host.style.setProperty('--page-width', `${w}px`);
    } catch {
      /* storage blocked */
    }
    this.el.querySelector('.page-head')!.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'prev') this.go(this.index - 1);
      else if (act === 'next') this.go(this.index + 1);
      else if (act === 'in') this.setZoom(this.zoom + 1);
      else if (act === 'out') this.setZoom(this.zoom - 1);
      else if (act === 'close') this.toggle(false);
    });
    this.body.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        this.setZoom(this.zoom + (e.deltaY < 0 ? 1 : -1));
      },
      { passive: false },
    );
    this.initResize();
  }

  get hasPages(): boolean {
    return this.pages.length > 0;
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** The pages now shown (to keep them with the score). */
  get current(): Blob[] {
    return this.pages;
  }

  /** Show these pages (replacing any others). */
  set(pages: Blob[], open = true) {
    this.release();
    this.pages = pages;
    this.urls = pages.map((p) => URL.createObjectURL(p));
    this.index = 0;
    this.render();
    this.el.hidden = !(open && pages.length);
    this.onChange();
  }

  /** No page any more (another score was opened). */
  clear() {
    if (!this.pages.length && this.el.hidden) return;
    this.release();
    this.pages = [];
    this.el.hidden = true;
    this.onChange();
  }

  toggle(open = this.el.hidden) {
    this.el.hidden = !(open && this.pages.length);
    this.onChange();
  }

  private get body(): HTMLElement {
    return this.el.querySelector('.page-body')!;
  }

  private release() {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
  }

  private go(i: number) {
    if (i < 0 || i >= this.urls.length) return;
    this.index = i;
    this.render();
    this.body.scrollTo(0, 0);
  }

  private setZoom(z: number) {
    this.zoom = Math.max(0, Math.min(ZOOMS.length - 1, z));
    this.render();
  }

  private render() {
    const img = this.el.querySelector('img')!;
    img.src = this.urls[this.index] ?? '';
    img.alt = this.urls.length ? `${t('Page')} ${this.index + 1}` : '';
    img.style.width = `${ZOOMS[this.zoom] * 100}%`;
    const many = this.urls.length > 1;
    (this.el.querySelector('.page-nav') as HTMLElement).hidden = !many;
    this.el.querySelector('.page-count')!.textContent = `${this.index + 1} / ${this.urls.length}`;
    (this.el.querySelector('[data-act=prev]') as HTMLButtonElement).disabled = this.index === 0;
    (this.el.querySelector('[data-act=next]') as HTMLButtonElement).disabled = this.index >= this.urls.length - 1;
  }

  /** Drag the right edge (or use the arrow keys on it) to change the width. */
  private initResize() {
    const handle = this.el.querySelector<HTMLElement>('.page-resize')!;
    handle.tabIndex = 0;
    const setWidth = (w: number) => {
      const max = Math.max(260, window.innerWidth * 0.7);
      const width = Math.round(Math.max(220, Math.min(max, w)));
      // on the workspace: its grid gives the page this column
      this.el.parentElement?.style.setProperty('--page-width', `${width}px`);
      try {
        localStorage.setItem(WIDTH_KEY, String(width));
      } catch {
        /* storage blocked */
      }
    };
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const left = this.el.getBoundingClientRect().left;
      const move = (ev: PointerEvent) => setWidth(ev.clientX - left);
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    handle.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      setWidth(this.el.getBoundingClientRect().width + (e.key === 'ArrowRight' ? 40 : -40));
    });
  }
}
