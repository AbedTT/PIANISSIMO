import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const page = (name: string) => resolve(import.meta.dirname, name);

// Multi-page app: the public website, the editor and the score viewer.
// `base: './'` makes the production build work from any folder,
// e.g. http://localhost/Pianissimo/dist/ under XAMPP.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        home: page('index.html'),
        app: page('app.html'),
        view: page('view.html'),
        guide: page('guide.html'),
        explore: page('explore.html'),
        about: page('about.html'),
        privacy: page('privacy.html'),
        terms: page('terms.html'),
      },
    },
  },
  server: {
    // the PHP API (npm run api) runs on :8000; the dev server forwards /server/* to it
    proxy: { '/server': 'http://localhost:8000' },
  },
});
