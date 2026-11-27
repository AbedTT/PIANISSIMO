/**
 * Where each bar of a scanned score is on the page pictures, from Audiveris's description of each
 * page (sheet#N.xml in its project file). Bars are counted in reading order, the same order as
 * the bars of the MusicXML it exported, so bar m of the score is box m. Coordinates are pixels of
 * the page picture (BINARY.png) that comes with it.
 */
export interface BarBox {
  /** Page index (0 = the first picture). */
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function barBoxes(sheets: string[]): BarBox[] {
  const out: BarBox[] = [];
  sheets.forEach((xml, page) => {
    let from = 0;
    for (;;) {
      const start = xml.indexOf('<system ', from);
      if (start < 0) break;
      const end = xml.indexOf('</system>', start);
      if (end < 0) break;
      const system = xml.slice(start, end);
      from = end + 9;
      // the height of the system: from its top staff line to its bottom one
      let top = Infinity;
      let bottom = -Infinity;
      for (const lines of system.matchAll(/<lines>([\s\S]*?)<\/lines>/g)) {
        for (const p of lines[1].matchAll(/<point\b[^>]*\by="(-?\d+(?:\.\d+)?)"/g)) {
          const y = Number(p[1]);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
      if (!Number.isFinite(top)) continue;
      // a margin above and below for notes, chord names and words outside the staff
      const margin = Math.max(20, (bottom - top) * 0.35);
      for (const s of system.matchAll(/<stack\b[^>]*>/g)) {
        const left = /\bleft="(-?\d+(?:\.\d+)?)"/.exec(s[0]);
        const right = /\bright="(-?\d+(?:\.\d+)?)"/.exec(s[0]);
        if (!left || !right) continue;
        out.push({ page, x: Number(left[1]), y: top - margin, w: Number(right[1]) - Number(left[1]), h: bottom - top + 2 * margin });
      }
    }
  });
  return out;
}
