import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const page = (name: string) => resolve(import.meta.dirname, name);

/**
 * Writes dist/sw.js from src/pwa/sw.js with the list of every built file to precache and a
 * version derived from their contents, so each build that changes anything replaces the cache.
 */
function serviceWorker(): Plugin {
  return {
    name: 'pianissimo-service-worker',
    apply: 'build',
    enforce: 'post',
    // writeBundle sees the finished output, including the HTML pages Vite adds late
    writeBundle(options, bundle) {
      const publicDir = page('public');
      const publicFiles = ['manifest.webmanifest', ...readdirSync(resolve(publicDir, 'icons')).map((f) => `icons/${f}`)];
      const hash = createHash('sha256');
      const built = Object.values(bundle)
        .filter((f) => !f.fileName.endsWith('.map'))
        .map((f) => {
          hash.update(f.fileName).update(f.type === 'chunk' ? f.code : f.source);
          return f.fileName;
        });
      for (const f of publicFiles) hash.update(f).update(readFileSync(resolve(publicDir, f)));
      const files = [...built, ...publicFiles].sort();
      const source = readFileSync(page('src/pwa/sw.js'), 'utf8')
        .replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify(files)};`)
        .replace("const VERSION = '__VERSION__';", `const VERSION = '${hash.digest('hex').slice(0, 12)}';`);
      writeFileSync(resolve(options.dir ?? page('dist'), 'sw.js'), source);
    },
  };
}

/**
 * `virtual:vexflow-fonts`: the URLs of VexFlow's Bravura (music) and Academico (text) fonts.
 *
 * VexFlow ships its fonts as base64 inside JavaScript (its default entry carries six fonts,
 * about 800 kB that gzip can barely shrink). We use the font-less `vexflow/core` and turn the
 * two fonts we need into real .woff2 files: a third smaller, cached on their own, and loaded in
 * parallel with the code. The dev server and the tests get the data URLs as they are.
 */
function vexflowFonts(): Plugin {
  const id = 'virtual:vexflow-fonts';
  const fonts = { bravura: 'bravura', academico: 'academico', academicoBold: 'academicobold' } as const;
  const dataUrl = (file: string) => {
    const js = readFileSync(page(`node_modules/vexflow/build/esm/src/fonts/${file}.js`), 'utf8');
    const m = /'(data:font\/woff2;charset=utf-8;base64,[A-Za-z0-9+/=]+)'/.exec(js);
    if (!m) throw new Error(`vexflow font ${file}: data URL not found`);
    return m[1];
  };
  let building = false;
  return {
    name: 'pianissimo-vexflow-fonts',
    configResolved(config) {
      building = config.command === 'build';
    },
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(source) {
      if (source !== `\0${id}`) return null;
      return Object.entries(fonts)
        .map(([name, file]) => {
          const url = dataUrl(file);
          if (!building) return `export const ${name} = ${JSON.stringify(url)};`;
          const ref = this.emitFile({ type: 'asset', name: `${file}.woff2`, source: Buffer.from(url.slice(url.indexOf(',') + 1), 'base64') });
          return `export const ${name} = import.meta.ROLLUP_FILE_URL_${ref};`;
        })
        .join('\n');
    },
  };
}

/** Where the instrument samples come from (src/audio/player.ts and sounds.ts). */
const SAMPLE_HOSTS = 'https://tonejs.github.io https://gleitz.github.io';

/**
 * The Content-Security-Policy every page carries: scripts only from this site (Tone.js loads
 * its audio worklet from a blob: URL), no plugins, no inline scripts. Styles may be inline
 * (the editor positions things with style attributes). ws:/wss: is for live co-editing, whose
 * address is set on the server. Put a matching header in the web server as well (docs/DEPLOY.md):
 * `frame-ancestors` only works as a header.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `media-src 'self' blob: data: ${SAMPLE_HOSTS}`,
  `connect-src 'self' ${SAMPLE_HOSTS} ws: wss:`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** Adds the security policy and referrer policy to every built page (not to the dev server, which injects scripts). */
function securityMeta(): Plugin {
  return {
    name: 'pianissimo-security-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'strict-origin-when-cross-origin' }, injectTo: 'head-prepend' },
    ],
  };
}

// Multi-page app: the public website, the editor and the score viewer.
// `base: './'` makes the production build work from any folder,
// e.g. http://localhost/Pianissimo/dist/ under XAMPP.
const VERSION = JSON.parse(readFileSync(page('package.json'), 'utf8')).version as string;

export default defineConfig({
  base: './',
  // the app version, sent with error reports (src/monitor/errors.ts)
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [vexflowFonts(), securityMeta(), serviceWorker()],
  build: {
    outDir: 'dist',
    // the largest file is the engraver (VexFlow, ~590 kB, 180 kB gzipped); warn if anything outgrows it
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      input: {
        home: page('index.html'),
        app: page('app.html'),
        view: page('view.html'),
        embed: page('embed.html'),
        guide: page('guide.html'),
        explore: page('explore.html'),
        profile: page('profile.html'),
        admin: page('admin.html'),
        about: page('about.html'),
        privacy: page('privacy.html'),
        terms: page('terms.html'),
      },
    },
  },
  server: {
    // the PHP API (npm run api) runs on :8000 (or API_PORT); dev and preview servers forward /server/* to it
    proxy: { '/server': `http://localhost:${process.env.API_PORT ?? 8000}` },
  },
});
