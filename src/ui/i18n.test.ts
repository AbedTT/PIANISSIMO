// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../editor/commands';
import { siteText, t, tLabel, translateSite } from './i18n';
import { SITE_BLOCKS } from './i18n-strings';

describe('interface language', () => {
  it('translates fixed and templated command labels', () => {
    expect(tLabel('Undo', 'fr')).toBe('Annuler');
    expect(tLabel('Write C', 'de')).toBe('C schreiben');
    expect(tLabel('Add E to chord', 'es')).toBe('Añadir E al acorde');
    expect(tLabel('Add interval: 3rd above', 'fr')).toBe('Ajouter une tierce au-dessus');
    expect(tLabel('Dynamic mf', 'de')).toBe('Dynamik mf');
    expect(tLabel('D.S. al Coda (end of this bar)', 'es')).toBe('D.S. al Coda (final de este compás)');
    expect(tLabel('Undo', 'en')).toBe('Undo');
    expect(tLabel('Something new', 'fr')).toBe('Something new');
  });

  it('every command and group has a name in French, Spanish and German', () => {
    for (const lang of ['fr', 'es', 'de'] as const) {
      const missing = COMMANDS.filter((c) => tLabel(c.label, lang) === c.label && !/^[A-Z][a-z]+ato$|^Metronome$/.test(c.label))
        .map((c) => c.label)
        // names that are the same word in every language
        .filter((l) => !['Staccato', 'Tenuto', 'Marcato', 'Accent', 'Navigation', 'Notes', 'Interface'].includes(l));
      expect(missing, lang).toEqual([]);
      const groups = [...new Set(COMMANDS.map((c) => c.group))].filter((g) => t(g, lang) === g && !['Notes', 'Navigation', 'Interface', 'Articulations', 'Layout', 'Text'].includes(g));
      expect(groups, lang).toEqual([]);
    }
  });

  it('every website block has all three translations', () => {
    for (const [key, row] of Object.entries(SITE_BLOCKS)) {
      expect(row.every((x) => x.length > 0), key).toBe(true);
    }
  });

  it('translates data-i18n blocks and can switch back to English', () => {
    document.body.innerHTML = `<h2 data-i18n="home.cta">Your next song starts with one key</h2>
      <input data-i18n-placeholder="gallery.search" placeholder="Search by title or composer…" />`;
    translateSite(document, 'de');
    expect(document.querySelector('h2')!.textContent).toBe('Ihr nächstes Lied beginnt mit einer Taste');
    expect(document.querySelector('input')!.placeholder).toBe('Nach Titel oder Komponist suchen…');
    translateSite(document, 'en');
    expect(document.querySelector('h2')!.textContent).toBe('Your next song starts with one key');
    expect(document.querySelector('input')!.placeholder).toBe('Search by title or composer…');
    expect(siteText('nope', 'fallback', 'fr')).toBe('fallback');
  });
});

import { tMsg } from './i18n';
import { MESSAGE_ROWS } from './i18n-messages';

describe('toast messages', () => {
  it('translates fixed messages and templates, keeping names and numbers', () => {
    expect(tMsg('Saved to your library', 'fr')).toBe('Enregistré dans votre bibliothèque');
    expect(tMsg('Opened “Moon River”', 'de')).toBe('„Moon River“ geöffnet');
    expect(tMsg('Recorded 12 notes (Ctrl+Z to undo)', 'es')).toBe('12 nota(s) grabada(s) (Ctrl+Z para deshacer)');
    expect(tMsg('Line break added', 'fr')).toBe('Saut de ligne ajouté'); // the exact row wins over "… added"
    expect(tMsg('Violin added', 'de')).toBe('Violin hinzugefügt');
    expect(tMsg('Something brand new', 'fr')).toBe('Something brand new');
    expect(tMsg('Saved to your library', 'en')).toBe('Saved to your library');
  });

  it('every message row has all three translations', () => {
    for (const row of MESSAGE_ROWS) expect(row.every((x) => x.length > 0), row[0]).toBe(true);
  });
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

describe('toast coverage', () => {
  it('every literal toast message in the source has a translation', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p);
      }
    };
    walk(join(__dirname, '..'));
    const literal = /\b(?:toast|notify|stopPractice)\('((?:[^'\\]|\\.)+)'\)/g;
    const missing: string[] = [];
    let found = 0;
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(literal)) {
        const msg = m[1].replace(/\\'/g, "'");
        found++;
        if (tMsg(msg, 'fr') === msg) missing.push(msg);
      }
    }
    expect(found).toBeGreaterThan(20); // the scan really sees the messages
    expect(missing).toEqual([]);
  });
});

import { GUIDE_BLOCKS } from './i18n-guide';

describe('guide translations', () => {
  it('every tagged block of the guide has a translation, keeping its links', () => {
    const html = readFileSync(join(__dirname, '../../guide.html'), 'utf8');
    const keys = [...html.matchAll(/data-i18n="(gp\.[\w.]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(15);
    for (const k of keys) {
      expect(GUIDE_BLOCKS[k], k).toBeDefined();
      // the block's own content, up to its closing tag
      const block = html.match(new RegExp(`<(p|ol|ul|table) data-i18n="${k.replace(/\./g, '\\.')}"[^>]*>([\\s\\S]*?)</\\1>`))![2];
      for (const [, href] of block.matchAll(/href="([^"]+)"/g)) {
        for (const t of GUIDE_BLOCKS[k]) expect(t, k).toContain(`href="${href}"`);
      }
    }
  });
});

import { LEGAL_BLOCKS } from './i18n-legal';

describe('legal pages', () => {
  it('About, Privacy and Terms: every block is translated, links kept', () => {
    for (const page of ['about.html', 'privacy.html', 'terms.html']) {
      const html = readFileSync(join(__dirname, '../..', page), 'utf8');
      expect(html).not.toContain('data-english-only');
      const keys = [...html.matchAll(/data-i18n="((?:ab|pv|tm)\.[\w.]+)"/g)].map((m) => m[1]);
      expect(keys.length, page).toBeGreaterThan(8);
      for (const k of keys) {
        expect(LEGAL_BLOCKS[k], `${page}: ${k}`).toBeDefined();
        const block = html.match(new RegExp(`data-i18n="${k.replace(/\./g, '\\.')}"[^>]*>([\\s\\S]*?)</(?:p|ul|table|h1|h2|a)>`))![1];
        for (const [, href] of block.matchAll(/href="([^"]+)"/g)) {
          for (const t of LEGAL_BLOCKS[k]) expect(t, k).toContain(`href="${href}"`);
        }
      }
    }
  });
});
