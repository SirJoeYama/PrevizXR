/** The app's IndexedDB database. Bump DB_VERSION and extend upgrade() when adding stores. */

const DB_NAME = 'previzxr';
const DB_VERSION = 3;
export const SCENES = 'scenes';
export const TAKES = 'takes';
export const IMAGES = 'images';

let dbPromise: Promise<IDBDatabase> | null = null;

function upgrade(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(SCENES)) db.createObjectStore(SCENES, { keyPath: 'id' });
  if (!db.objectStoreNames.contains(TAKES)) {
    const takes = db.createObjectStore(TAKES, { keyPath: 'id' });
    takes.createIndex('sceneId', 'sceneId');
  }
  if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES, { keyPath: 'id' });
}

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

/** Runs one request in its own transaction. */
export function run<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = op(db.transaction(store, mode).objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}
