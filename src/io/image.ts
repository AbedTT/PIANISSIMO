import type { Score } from '../model/types';
import { FONT_URLS } from '../render/fonts';
import { renderScore } from '../render/renderer';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A font file as a data URL (the built fonts are separate .woff2 files; in development they are data URLs already). */
async function inline(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const blob = await (await fetch(url)).blob();
  return new Promise((ok, fail) => {
    const reader = new FileReader();
    reader.onload = () => ok(String(reader.result));
    reader.onerror = () => fail(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** VexFlow's music (Bravura) and text (Academico) fonts as data URLs, so exported images carry them. */
async function fontFaces(): Promise<string> {
  const [bravura, academico] = await Promise.all([inline(FONT_URLS.Bravura), inline(FONT_URLS.Academico)]);
  return (
    `@font-face{font-family:Bravura;src:url(${bravura}) format('woff2');}` +
    `@font-face{font-family:Academico;src:url(${academico}) format('woff2');}`
  );
}

/**
 * The whole score as one standalone SVG (title, composer, all systems), with the
 * music font embedded so it looks the same in any viewer or image converter.
 */
export async function scoreToSvg(score: Score, width = 1100): Promise<string> {
  const scratch = document.createElement('div');
  scratch.style.cssText = 'position:absolute;left:-99999px;top:0;';
  document.body.append(scratch);
  try {
    await document.fonts.ready;
    const layout = renderScore(scratch, score, width);
    const svg = scratch.querySelector('svg')!;
    const header = 90;
    // the footer note goes under the music, one text line per line of the note
    const footLines = (score.footerNote ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const footer = footLines.length ? 24 + footLines.length * 18 : 0;
    const height = layout.height + header + footer;
    const inner = svg.innerHTML;
    // VexFlow sets the ink colour once on its <svg> element; staff lines, stems and barlines inherit it.
    // Copy those presentation attributes, or the lines come out with no stroke in the exported file.
    const paint = ['fill', 'stroke', 'stroke-width', 'font-family']
      .map((a) => [a, svg.getAttribute(a) ?? ({ fill: '#000', stroke: '#000', 'stroke-width': '1' } as Record<string, string>)[a]])
      .filter(([, v]) => v)
      .map(([a, v]) => `${a}="${esc(v!)}"`)
      .join(' ');
    const style = await fontFaces();
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Bravura,Academico">
<style>${style}</style>
<rect width="100%" height="100%" fill="#fff"/>
<text x="${width / 2}" y="44" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="28" font-weight="600">${esc(score.title)}</text>
${score.composer ? `<text x="${width - 40}" y="74" text-anchor="end" font-family="Georgia, serif" font-size="14">${esc(score.composer)}</text>` : ''}
${score.headerNote ? `<text x="40" y="74" font-family="Georgia, serif" font-size="14">${esc(score.headerNote)}</text>` : ''}
<g transform="translate(0 ${header})" ${paint}>${inner}</g>
${footLines.map((l, k) => `<text x="40" y="${header + layout.height + 20 + k * 18}" font-family="Georgia, serif" font-size="13" font-style="italic">${esc(l)}</text>`).join('')}
</svg>`;
  } finally {
    scratch.remove();
  }
}

/** The score as a PNG (rasterised from the standalone SVG at `scale`× for sharpness). */
export async function scoreToPng(score: Score, scale = 2): Promise<Blob> {
  const svg = await scoreToSvg(score);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not draw the score image.'));
      img.src = url;
    });
    await img.decode().catch(() => undefined);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
