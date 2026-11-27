/**
 * Pictures of the printed page a score came from (a scan, or a picture you chose), kept on this
 * computer next to the score in My scores, so the page can be shown beside the score whenever
 * that score is opened again. Keyed by the score's id in the library on this computer.
 */
export interface PageStore {
  get(id: string): Promise<Blob[] | null>;
  put(id: string, pages: Blob[]): Promise<void>;
  remove(id: string): Promise<void>;
}

export function indexedDbPages(name = 'pianissimo-pages'): PageStore {
  let opened: Promise<IDBDatabase> | null = null;
  const db = () =>
    (opened ??= new Promise((ok, fail) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('pages', { keyPath: 'id' });
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    }));
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const tx = (await db()).transaction('pages', mode);
    const req = fn(tx.objectStore('pages'));
    return new Promise<T>((ok, fail) => {
      tx.oncomplete = () => ok(req.result);
      tx.onerror = () => fail(tx.error ?? req.error);
      tx.onabort = () => fail(tx.error ?? new Error('Interrupted'));
    });
  };
  return {
    get: async (id) => ((await run('readonly', (s) => s.get(id) as IDBRequest<{ pages: Blob[] } | undefined>))?.pages ?? null),
    put: async (id, pages) => void (await run('readwrite', (s) => s.put({ id, pages }))),
    remove: async (id) => void (await run('readwrite', (s) => s.delete(id))),
  };
}

export function memoryPages(): PageStore {
  const items = new Map<string, Blob[]>();
  return {
    get: async (id) => items.get(id) ?? null,
    put: async (id, pages) => void items.set(id, pages),
    remove: async (id) => void items.delete(id),
  };
}

/** Base64 (as the scanners send it) to bytes. */
export function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
