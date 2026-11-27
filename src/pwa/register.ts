/**
 * Register the service worker (production builds only: the dev server has no sw.js).
 * It caches the app so the editor, viewer and website open without a network.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // sw.js sits at the root of the build, next to the pages, so its scope covers all of them
  const url = new URL('sw.js', location.href);
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(url).catch(() => {
      /* private mode or blocked: everything still works online */
    });
  });
}
