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

// Multi-page app: the public website, the editor and the score viewer.
// `base: './'` makes the production build work from any folder,
// e.g. http://localhost/Pianissimo/dist/ under XAMPP.
export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
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
