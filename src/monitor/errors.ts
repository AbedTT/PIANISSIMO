import { api } from '../cloud/api';

/** At most this many reports per page load (a crash loop must not flood the server). */
const MAX_REPORTS = 5;

/** Errors that are not ours or tell us nothing. */
const IGNORE = [
  /^Script error\.?$/, // from another origin: no details
  /ResizeObserver loop/, // a harmless browser notice
  /extension:\/\//, // browser extensions
  /^AbortError/,
];

/**
 * Keep only what helps fixing the bug: our file names and line numbers. The page's address,
 * query strings and #parts (which can hold tokens) are cut off.
 */
export function cleanStack(stack: string, origin = location.origin): string {
  return stack
    .split('\n')
    .slice(0, 25)
    .map((line) => line.split(origin).join('').replace(/([^\s()]+\.(?:js|ts|mjs))(?:\?[^\s:)]*)?/g, '$1').replace(/[?#][^\s:)]*(?=:\d+:\d+)/g, ''))
    .join('\n');
}

/** Decide whether to send this error, remembering what this page sent already. */
export function reporter(send: (report: { message: string; stack: string; page: string; version: string }) => void) {
  const seen = new Set<string>();
  return (message: string, stack: string) => {
    if (!message || IGNORE.some((re) => re.test(message) || re.test(stack))) return;
    const key = `${message}\n${stack.slice(0, 300)}`;
    if (seen.has(key) || seen.size >= MAX_REPORTS) return;
    seen.add(key);
    send({ message: message.slice(0, 500), stack: cleanStack(stack).slice(0, 4000), page: location.pathname.split('/').pop() || 'index.html', version: __APP_VERSION__ });
  };
}

/**
 * Report unexpected errors (uncaught exceptions and rejected promises) to the server, where
 * admins see them grouped in admin.html. Only in the production build, and silent when the
 * server cannot be reached. No score content or personal details are sent.
 */
export function startErrorReporting() {
  if (!import.meta.env.PROD || typeof window === 'undefined') return;
  const report = reporter((r) => void api.reportError(r).catch(() => {}));
  window.addEventListener('error', (e) => {
    const err = e.error as Error | undefined;
    report(err?.message ? `${err.name}: ${err.message}` : String(e.message ?? ''), err?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as unknown;
    if (r instanceof Error) report(`${r.name}: ${r.message}`, r.stack ?? '');
    else report(`Unhandled rejection: ${String(r)}`, '');
  });
}
