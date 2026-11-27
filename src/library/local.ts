import type { Score } from '../model/types';

/** A score in the library on this computer (without its music: that is loaded on open). */
export interface LocalMeta {
  id: string;
  title: string;
  composer: string;
  created_at: string;
  updated_at: string;
}

interface Stored extends LocalMeta {
  data: Score;
}

/** Where the scores are kept: IndexedDB in browsers, memory in tests. */
export interface Store {
  all(): Promise<Stored[]>;
  get(id: string): Promise<Stored | undefined>;
  put(item: Stored): Promise<void>;
  remove(id: string): Promise<void>;
}

/** IndexedDB: holds many scores (unlike localStorage's few megabytes) and survives restarts. */
export function indexedDbStore(name = 'pianissimo-library'): Store {
  let opened: Promise<IDBDatabase> | null = null;
  const db = () =>
    (opened ??= new Promise((ok, fail) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('scores', { keyPath: 'id' });
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    }));
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const tx = (await db()).transaction('scores', mode);
    const req = fn(tx.objectStore('scores'));
    return new Promise<T>((ok, fail) => {
      // resolve once the transaction is committed, so a write is on disk before we say "Saved"
      tx.oncomplete = () => ok(req.result);
      tx.onerror = () => fail(tx.error ?? req.error);
      tx.onabort = () => fail(tx.error ?? new Error('The save was interrupted'));
    });
  };
  return {
    all: () => run('readonly', (s) => s.getAll() as IDBRequest<Stored[]>),
    get: (id) => run('readonly', (s) => s.get(id) as IDBRequest<Stored | undefined>),
    put: async (item) => void (await run('readwrite', (s) => s.put(item))),
    remove: async (id) => void (await run('readwrite', (s) => s.delete(id))),
  };
}

export function memoryStore(): Store {
  const items = new Map<string, Stored>();
  const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  return {
    all: async () => [...items.values()].map(copy),
    get: async (id) => (items.has(id) ? copy(items.get(id)!) : undefined),
    put: async (item) => void items.set(item.id, copy(item)),
    remove: async (id) => void items.delete(id),
  };
}

const metaOf = ({ data: _data, ...meta }: Stored): LocalMeta => meta;
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/**
 * The library on this computer: save as many scores as you like without an account or a
 * server, and open any of them later. Used by the desktop app and by the website when
 * signed out.
 */
export class LocalLibrary {
  constructor(private store: Store = typeof indexedDB !== 'undefined' ? indexedDbStore() : memoryStore()) {}

  /** Newest first. */
  async list(): Promise<LocalMeta[]> {
    return (await this.store.all()).map(metaOf).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async get(id: string): Promise<{ meta: LocalMeta; data: Score } | null> {
    const item = await this.store.get(id);
    return item ? { meta: metaOf(item), data: item.data } : null;
  }

  /** Save a score: as a new entry, or over the one with this id. */
  async save(score: Score, id?: string | null): Promise<LocalMeta> {
    const now = new Date().toISOString();
    const old = id ? await this.store.get(id) : undefined;
    const item: Stored = {
      id: old?.id ?? newId(),
      title: score.title?.trim() || 'Untitled',
      composer: score.composer ?? '',
      created_at: old?.created_at ?? now,
      updated_at: now,
      data: score,
    };
    await this.store.put(item);
    return metaOf(item);
  }

  async duplicate(id: string): Promise<LocalMeta | null> {
    const item = await this.store.get(id);
    if (!item) return null;
    return this.save({ ...item.data, title: `${item.title} (copy)` });
  }

  remove(id: string): Promise<void> {
    return this.store.remove(id);
  }

  /** Everything, as one file: a backup to keep elsewhere or move to another computer. */
  async exportAll(): Promise<string> {
    const items = await this.store.all();
    return JSON.stringify({ pianissimoLibrary: 1, exported_at: new Date().toISOString(), scores: items.map((i) => i.data) });
  }

  /** Add the scores from such a file (as new entries; nothing is overwritten). Returns how many. */
  async importAll(text: string, isScore: (x: unknown) => x is Score): Promise<number> {
    const parsed = JSON.parse(text) as { pianissimoLibrary?: number; scores?: unknown[] };
    if (parsed?.pianissimoLibrary !== 1 || !Array.isArray(parsed.scores)) throw new Error('This is not a Pianissimo library backup');
    let n = 0;
    for (const s of parsed.scores) {
      if (isScore(s)) {
        await this.save(s);
        n++;
      }
    }
    return n;
  }

  /** Ask the browser to keep this storage even when the disk fills up (granted silently or not at all). */
  static async keep(): Promise<void> {
    try {
      if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
    } catch {
      /* not supported */
    }
  }

  /** True if the text is a library backup made by exportAll(). */
  static isBackup(text: string): boolean {
    return /^\s*\{\s*"pianissimoLibrary"\s*:/.test(text);
  }
}
