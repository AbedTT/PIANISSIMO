/**
 * Tidying what the scanner (Audiveris) returns, before it is opened as a score.
 *
 * Lyrics: Audiveris reads the words under the notes (with its text-reading data), but often files
 * them as "directions" (text below the staff, like *dolce*) rather than as lyrics. A row of such
 * words at the same height in several bars is a lyric line: each word goes to the next note of that
 * staff, starting again at each group's note so a word Audiveris missed does not shift the rest.
 */

const QUOTES = /[“”„"‘’‚«»�]/g;

interface Candidate {
  el: Element;
  staff: string;
  y: number;
  words: string[];
}

/** Below-staff words that form a lyric line, turned into lyrics on their notes. Returns the new MusicXML. */
export function liftLyrics(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return xml;
  let changed = false;
  for (const part of doc.querySelectorAll('part')) {
    const measures = [...part.children].filter((c) => c.tagName === 'measure');
    // only plain words below the staff, with a height to compare
    const candidates: Candidate[] = [];
    measures.forEach((m) => {
      for (const d of m.children) {
        if (d.tagName !== 'direction') continue;
        const types = [...d.children].filter((c) => c.tagName === 'direction-type');
        const words = types.length === 1 ? [...types[0].children] : [];
        if (words.length !== 1 || words[0].tagName !== 'words') continue;
        const y = Number(words[0].getAttribute('default-y'));
        if (!(y < 0 || d.getAttribute('placement') === 'below')) continue;
        const text = (words[0].textContent ?? '').replace(QUOTES, ' ').trim();
        if (!text) continue;
        candidates.push({ el: d, staff: child(d, 'staff') ?? '1', y: Number.isFinite(y) ? y : 0, words: text.split(/\s+/) });
      }
    });
    // per staff, the height used most often; it is a lyric line when it shows up in at least three bars
    const lyricEls = new Set<Element>();
    for (const staff of new Set(candidates.map((c) => c.staff))) {
      const own = candidates.filter((c) => c.staff === staff);
      const byY = new Map<number, Candidate[]>();
      for (const c of own) {
        const key = Math.round(c.y / 8);
        byY.set(key, [...(byY.get(key) ?? []), c]);
      }
      const best = [...byY.values()].sort((a, b) => b.length - a.length)[0] ?? [];
      const bars = new Set(best.map((c) => c.el.parentElement));
      if (best.length >= 3 && bars.size >= 2) best.forEach((c) => lyricEls.add(c.el));
    }
    if (!lyricEls.size) continue;

    // walk the bars in order: each group re-anchors the words of its staff on the notes that follow
    const queue = new Map<string, { words: string[]; voice: string | null }>();
    const open = new Map<string, boolean>(); // a word split with a hyphen goes on
    for (const m of measures) {
      for (const el of [...m.children]) {
        if (lyricEls.has(el)) {
          const c = candidates.find((x) => x.el === el)!;
          queue.set(c.staff, { words: [...c.words], voice: null });
          el.remove();
          changed = true;
          continue;
        }
        if (el.tagName !== 'note') continue;
        const staff = child(el, 'staff') ?? '1';
        const q = queue.get(staff);
        if (!q?.words.length) continue;
        if ([...el.children].some((c) => c.tagName === 'chord' || c.tagName === 'grace' || c.tagName === 'rest')) continue;
        const voice = child(el, 'voice');
        q.voice ??= voice;
        if (voice !== q.voice) continue;
        if ([...el.children].some((c) => c.tagName === 'lyric')) continue;
        let word = q.words.shift()!;
        const hyphen = /[-–]$/.test(word) && word.length > 1;
        if (hyphen) word = word.replace(/[-–]+$/, '');
        const was = open.get(staff) ?? false;
        const syllabic = was ? (hyphen ? 'middle' : 'end') : hyphen ? 'begin' : 'single';
        open.set(staff, hyphen);
        // in the document's own namespace (createElement would make HTML elements, named LYRIC)
        const make = (tag: string) => doc.createElementNS(doc.documentElement.namespaceURI, tag);
        const lyric = make('lyric');
        lyric.setAttribute('number', '1');
        const s = make('syllabic');
        s.textContent = syllabic;
        const t = make('text');
        t.textContent = word;
        lyric.append(s, t);
        el.appendChild(lyric);
      }
    }
  }
  return changed ? new XMLSerializer().serializeToString(doc) : xml;
}

const child = (el: Element, tag: string) => [...el.children].find((c) => c.tagName === tag)?.textContent?.trim() ?? null;
