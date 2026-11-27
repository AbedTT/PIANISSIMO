import type { BarBox } from '../scan/barMap';
import type { Pages } from '../library/pages';
import { t } from './i18n';

const WIDTH_KEY = 'pianissimo:pageWidth';
const FOLLOW_KEY = 'pianissimo:pageFollow';
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/**
 * The printed page beside the score: after a scan (or with any picture you choose), so you can
 * check the notes against the original and fix what the scanner misread. All pages are shown one
 * under the other (‹ › jump between them). For a scan the bar the cursor is in is outlined on the
 * page, and the page follows the cursor (⌖ turns that off); clicking a bar on the page moves the
 * cursor there. Zoom with − + (or Ctrl + mouse wheel); drag the edge to make it wider. On phones
 * it is a sheet at the bottom of the screen.
 */
export class PagePanel {
  readonly el: HTMLElement;
  /** Called when pages come or go, or the panel opens or closes (to update the top bar). */
  onChange: () => void = () => {};
  /** A bar on the page was clicked: move the cursor to bar m (0-based). */
  onBarClick: (m: number) => void = () => {};
  private pages: Blob[] = [];
  private bars: BarBox[] = [];
  private urls: string[] = [];
  private sheets: HTMLElement[] = [];
  private mark: HTMLElement;
  private bar = -1;
  private zoom = 2; // index into ZOOMS: 1 = fit the width
  private follow = true;

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
        <button type="button" class="page-follow" data-act="follow" aria-pressed="true" title="${t('Follow the cursor on the page')}" aria-label="${t('Follow the cursor on the page')}">⌖</button>
        <span class="page-zoom">
          <button type="button" data-act="out" aria-label="${t('Zoom out')}" title="${t('Zoom out')}">−</button>
          <button type="button" data-act="in" aria-label="${t('Zoom in')}" title="${t('Zoom in')}">+</button>
        </span>
        <button type="button" class="close" data-act="close" aria-label="${t('Hide the page')}" title="${t('Hide the page')}">✕</button>
      </div>
      <div class="page-body"></div>
      <div class="page-resize" role="separator" aria-orientation="vertical" aria-label="${t('Drag to resize')}" title="${t('Drag to resize')}"></div>`;
    this.mark = document.createElement('div');
    this.mark.className = 'page-bar-mark';
    host.insertBefore(this.el, before);
    try {
      const w = Number(localStorage.getItem(WIDTH_KEY));
      if (w >= 220) host.style.setProperty('--page-width', `${w}px`);
      this.follow = localStorage.getItem(FOLLOW_KEY) !== '0';
    } catch {
      /* storage blocked */
    }
    this.el.querySelector('.page-head')!.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'prev') this.go(this.visiblePage() - 1);
      else if (act === 'next') this.go(this.visiblePage() + 1);
      else if (act === 'in') this.setZoom(this.zoom + 1);
      else if (act === 'out') this.setZoom(this.zoom - 1);
      else if (act === 'close') this.toggle(false);
      else if (act === 'follow') this.setFollow(!this.follow);
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
    this.body.addEventListener('scroll', () => this.renderCount(), { passive: true });
    // a click on a bar of the page moves the cursor there
    this.body.addEventListener('click', (e) => {
      const img = (e.target as HTMLElement).closest<HTMLImageElement>('img');
      if (!img || !this.bars.length || !img.naturalWidth) return;
      const page = this.sheets.findIndex((s) => s.contains(img));
      const r = img.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * img.naturalWidth;
      const y = ((e.clientY - r.top) / r.height) * img.naturalHeight;
      const m = this.bars.findIndex((b) => b.page === page && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      if (m >= 0) this.onBarClick(m);
    });
    this.initResize();
    this.renderFollow();
  }

  get hasPages(): boolean {
    return this.pages.length > 0;
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** The pages now shown, and where the bars are on them (to keep them with the score). */
  get current(): Pages {
    return { pages: this.pages, bars: this.bars.length ? this.bars : undefined };
  }

  /** Show these pages (replacing any others). */
  set(value: Pages, open = true) {
    this.release();
    this.pages = value.pages;
    this.bars = value.bars ?? [];
    this.urls = value.pages.map((p) => URL.createObjectURL(p));
    this.bar = -1;
    this.body.innerHTML = '';
    this.sheets = this.urls.map((url, i) => {
      const sheet = document.createElement('div');
      sheet.className = 'page-sheet';
      const img = document.createElement('img');
      img.src = url;
      img.alt = `${t('Page')} ${i + 1}`;
      img.draggable = false;
      img.addEventListener('load', () => this.placeMark(false));
      sheet.append(img);
      this.body.append(sheet);
      return sheet;
    });
    this.el.classList.toggle('has-bars', this.bars.length > 0);
    this.renderZoom();
    this.renderCount();
    this.el.hidden = !(open && value.pages.length);
    this.onChange();
  }

  /** No page any more (another score was opened). */
  clear() {
    if (!this.pages.length && this.el.hidden) return;
    this.release();
    this.pages = [];
    this.bars = [];
    this.sheets = [];
    this.body.innerHTML = '';
    this.el.hidden = true;
    this.onChange();
  }

  toggle(open = this.el.hidden) {
    this.el.hidden = !(open && this.pages.length);
    if (!this.el.hidden) this.placeMark(true);
    this.onChange();
  }

  /** The cursor is in bar m (0-based): outline it on the page and, when following, bring it into view. */
  showBar(m: number) {
    if (m === this.bar) return;
    this.bar = m;
    this.placeMark(true);
  }

  private get body(): HTMLElement {
    return this.el.querySelector('.page-body')!;
  }

  private placeMark(scroll: boolean) {
    const box = this.bars[this.bar];
    const sheet = box && this.sheets[box.page];
    const img = sheet?.querySelector('img');
    if (!box || !sheet || !img?.naturalWidth) {
      this.mark.remove();
      return;
    }
    // in percent of the picture, so it stays in place at every zoom
    Object.assign(this.mark.style, {
      left: `${(box.x / img.naturalWidth) * 100}%`,
      top: `${(box.y / img.naturalHeight) * 100}%`,
      width: `${(box.w / img.naturalWidth) * 100}%`,
      height: `${(box.h / img.naturalHeight) * 100}%`,
    });
    if (this.mark.parentElement !== sheet) sheet.append(this.mark);
    if (scroll && this.follow && !this.el.hidden) this.scrollToMark();
  }

  /** Bring the outlined bar into view (only when it is not already fully visible). */
  private scrollToMark() {
    const body = this.body.getBoundingClientRect();
    const r = this.mark.getBoundingClientRect();
    const inside = r.top >= body.top && r.bottom <= body.bottom && r.left >= body.left && r.right <= body.right;
    if (inside) return;
    this.body.scrollBy({
      top: r.top - body.top - (body.height - r.height) / 2,
      left: r.left < body.left || r.right > body.right ? r.left - body.left - 16 : 0,
      behavior: 'smooth',
    });
  }

  private release() {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
    this.mark.remove();
  }

  /** The page most of the view shows. */
  private visiblePage(): number {
    const top = this.body.getBoundingClientRect().top;
    let best = 0;
    this.sheets.forEach((s, i) => {
      if (s.getBoundingClientRect().top - top <= this.body.clientHeight / 3) best = i;
    });
    return best;
  }

  private go(i: number) {
    const sheet = this.sheets[Math.max(0, Math.min(this.sheets.length - 1, i))];
    if (sheet) this.body.scrollTo({ top: sheet.offsetTop - this.body.offsetTop, behavior: 'smooth' });
  }

  private setZoom(z: number) {
    this.zoom = Math.max(0, Math.min(ZOOMS.length - 1, z));
    this.renderZoom();
    this.placeMark(true);
  }

  private setFollow(on: boolean) {
    this.follow = on;
    try {
      localStorage.setItem(FOLLOW_KEY, on ? '1' : '0');
    } catch {
      /* storage blocked */
    }
    this.renderFollow();
    if (on) this.placeMark(true);
  }

  private renderFollow() {
    const b = this.el.querySelector<HTMLElement>('[data-act=follow]')!;
    b.setAttribute('aria-pressed', String(this.follow));
    b.classList.toggle('active', this.follow);
  }

  private renderZoom() {
    for (const s of this.sheets) s.style.width = `${ZOOMS[this.zoom] * 100}%`;
  }

  private renderCount() {
    const many = this.sheets.length > 1;
    (this.el.querySelector('.page-nav') as HTMLElement).hidden = !many;
    if (!many) return;
    const i = this.visiblePage();
    this.el.querySelector('.page-count')!.textContent = `${i + 1} / ${this.sheets.length}`;
    (this.el.querySelector('[data-act=prev]') as HTMLButtonElement).disabled = i === 0;
    (this.el.querySelector('[data-act=next]') as HTMLButtonElement).disabled = i >= this.sheets.length - 1;
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
