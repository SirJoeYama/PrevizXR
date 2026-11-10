/** The app's IndexedDB database. Bump DB_VERSION and extend upgrade() when adding stores. */

const DB_NAME = 'previzxr';
const DB_VERSION = 4;
export const SCENES = 'scenes';
export const TAKES = 'takes';
export const IMAGES = 'images';
/** One small record per take (see takeStore), so listing a scene's takes never reads their frames. */
export const TAKE_SUMMARIES = 'takeSummaries';

/** Fields copied from a take into its summary record. */
export const TAKE_SUMMARY_FIELDS = ['id', 'name', 'sceneId', 'createdAt', 'fps', 'duration', 'frameCount', 'source', 'smoothing'] as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function upgrade(db: IDBDatabase, tx: IDBTransaction): void {
  if (!db.objectStoreNames.contains(SCENES)) db.createObjectStore(SCENES, { keyPath: 'id' });
  if (!db.objectStoreNames.contains(TAKES)) {
    const takes = db.createObjectStore(TAKES, { keyPath: 'id' });
    takes.createIndex('sceneId', 'sceneId');
  }
  if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES, { keyPath: 'id' });
  if (!db.objectStoreNames.contains(TAKE_SUMMARIES)) {
    const summaries = db.createObjectStore(TAKE_SUMMARIES, { keyPath: 'id' });
    summaries.createIndex('sceneId', 'sceneId');
    // v3 → v4: summarize the takes already stored, one at a time so they are never all in memory.
    const cursor = tx.objectStore(TAKES).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      const take = c.value as Record<string, unknown>;
      const summary: Record<string, unknown> = {};
      for (const k of TAKE_SUMMARY_FIELDS) summary[k] = take[k];
      summaries.put(summary);
      c.continue();
    };
  }
}

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const fail = (err: unknown) => {
      dbPromise = null;
      reject(err instanceof Error ? err : new Error('Could not open browser storage.'));
    };
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => upgrade(req.result, req.transaction!);
    req.onsuccess = () => {
      const db = req.result;
      // Another tab opened a newer version of the app: let it upgrade, and reopen on the next request.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => fail(req.error);
    // An older version of the app is open in another tab and holds the database.
    req.onblocked = () => fail(new Error('PrevizXR is open in another tab that needs to be reloaded or closed first.'));
  });
  return dbPromise;
}

/**
 * Runs `op` in one transaction over `stores` and resolves with its request's result once the transaction
 * has committed. A request can succeed and its transaction still abort (storage quota), so writes are
 * only reported as done on `complete`.
 */
export function transact<T>(stores: string[], mode: IDBTransactionMode, op: (store: (name: string) => IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        let result: T;
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(tx.error ?? new Error('Browser storage transaction aborted.'));
        tx.onerror = () => reject(tx.error);
        const req = op((name) => tx.objectStore(name));
        if (req) req.onsuccess = () => (result = req.result);
      }),
  );
}

/** Runs one request in its own transaction. */
export function run<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return transact([store], mode, (get) => op(get(store)));
}
