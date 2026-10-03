import { parseScene } from '../model/serialize';
import type { SceneDoc } from '../model/scene';

/** Scenes saved in the browser (IndexedDB). Each record holds the full SceneDoc. */

const DB_NAME = 'previzxr';
const DB_VERSION = 1;
const SCENES = 'scenes';

export interface SceneSummary {
  id: string;
  name: string;
  updatedAt: number;
  objectCount: number;
}

interface SceneRecord extends SceneSummary {
  doc: SceneDoc;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SCENES)) db.createObjectStore(SCENES, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = op(db.transaction(SCENES, mode).objectStore(SCENES));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function saveScene(doc: SceneDoc): Promise<void> {
  const record: SceneRecord = {
    id: doc.id,
    name: doc.name,
    updatedAt: Date.now(),
    objectCount: doc.objects.length,
    doc: structuredClone(doc) as SceneDoc,
  };
  await run('readwrite', (s) => s.put(record));
}

export async function loadScene(id: string): Promise<SceneDoc | null> {
  const record = await run<SceneRecord | undefined>('readonly', (s) => s.get(id));
  return record ? parseScene(record.doc) : null;
}

export async function listScenes(): Promise<SceneSummary[]> {
  const records = await run<SceneRecord[]>('readonly', (s) => s.getAll());
  return records
    .map(({ id, name, updatedAt, objectCount }) => ({ id, name, updatedAt, objectCount }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteScene(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}
