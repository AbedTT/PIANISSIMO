import './print.css';
import type { PageSize, Score } from '../model/types';
import { renderScore } from './renderer';

export const PAGE_SIZES: Record<PageSize, { name: string; w: number; h: number; css: string }> = {
  a4: { name: 'A4', w: 210, h: 297, css: 'A4' },
  letter: { name: 'US Letter', w: 215.9, h: 279.4, css: 'letter' },
};

const MARGIN_MM = 15;
const FOOTER_MM = 10;
const FIRST_HEADER_MM = 24; // title + composer
const RUNNING_HEADER_MM = 7; // small title on later pages
const PX_PER_MM = 96 / 25.4;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Lay the score out on real pages: render it once at the page's content width (scaled
 * by the staff size), then give each page a view (SVG viewBox) of the whole systems that
 * fit on it. Systems are never cut in half; page breaks after a bar are honoured.
 */
export function buildPrintPages(score: Score): HTMLElement[] {
  const size = PAGE_SIZES[score.print?.pageSize ?? 'a4'];
  const scale = score.print?.scale ?? 0.8;
  const contentWmm = size.w - 2 * MARGIN_MM;
  const renderW = (contentWmm * PX_PER_MM) / scale; // render wider, then shrink to fit = smaller staves

  const scratch = document.createElement('div');
  scratch.style.cssText = 'position:absolute;left:-99999px;top:0;';
  document.body.append(scratch);
  const layout = renderScore(scratch, score, renderW);
  // keep the root <svg> itself (its font and style attributes matter), not just its contents
  const source = scratch.querySelector('svg')!;
  scratch.remove();

  // available height (in render px) for systems on a page
  const usable = (headerMm: number) => ((size.h - 2 * MARGIN_MM - FOOTER_MM - headerMm) * PX_PER_MM) / scale;

  // paginate whole systems
  const pages: { top: number; bottom: number }[][] = [];
  let current: { top: number; bottom: number }[] = [];
  let used = 0;
  layout.systems.forEach((sys) => {
    const h = sys.bottom - sys.top;
    const room = usable(pages.length === 0 ? FIRST_HEADER_MM : RUNNING_HEADER_MM);
    if (current.length && used + h > room) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(sys);
    used += h;
    if (sys.pageBreakAfter) {
      pages.push(current);
      current = [];
      used = 0;
    }
  });
  if (current.length) pages.push(current);
  if (!pages.length) pages.push([]);

  const total = pages.length;
  return pages.map((systems, k) => {
    const page = document.createElement('section');
    page.className = 'print-page';
    page.style.width = `${size.w}mm`;
    page.style.height = `${size.h}mm`;
    page.style.padding = `${MARGIN_MM}mm`;
    let html = '';
    if (k === 0) {
      html += `<div class="pp-title">${esc(score.title)}</div>`;
      html += `<div class="pp-composer">${esc(score.composer || ' ')}</div>`;
    } else {
      html += `<div class="pp-running">${esc(score.title)}</div>`;
    }
    page.innerHTML = html;
    for (const sys of systems) {
      const h = sys.bottom - sys.top;
      const svg = source.cloneNode(true) as SVGSVGElement;
      svg.setAttribute('viewBox', `0 ${sys.top} ${renderW} ${h}`);
      svg.setAttribute('width', `${contentWmm}mm`);
      svg.setAttribute('height', `${(h * scale) / PX_PER_MM}mm`);
      svg.style.width = `${contentWmm}mm`;
      svg.style.height = `${(h * scale) / PX_PER_MM}mm`;
      page.append(svg);
    }
    if (total > 1) {
      const footer = document.createElement('div');
      footer.className = 'pp-footer';
      footer.textContent = `${k + 1} / ${total}`;
      page.append(footer);
    }
    return page;
  });
}
