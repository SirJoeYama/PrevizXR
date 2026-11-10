import { parseTake, type Take } from '../model/take';
import { TAKES, TAKE_SUMMARIES, TAKE_SUMMARY_FIELDS, run, transact } from './db';

/**
 * Takes saved in the browser, indexed by the scene they were recorded in. Each take has a small summary
 * record next to it, written in the same transaction, so lists are built without reading any frames.
 */

export type TakeSummary = Pick<Take, (typeof TAKE_SUMMARY_FIELDS)[number]>;

export function summarize(t: Take): TakeSummary {
  const { id, name, sceneId, createdAt, fps, duration, frameCount, source, smoothing } = t;
  return { id, name, sceneId, createdAt, fps, duration, frameCount, source, smoothing };
}

export async function saveTake(take: Take): Promise<void> {
  await transact([TAKES, TAKE_SUMMARIES], 'readwrite', (store) => {
    store(TAKES).put(take);
    store(TAKE_SUMMARIES).put(summarize(take));
  });
}

/** A stored take, validated like an imported file; null when it is missing or unreadable. */
export async function loadTake(id: string): Promise<Take | null> {
  const stored = await run<unknown>(TAKES, 'readonly', (s) => s.get(id));
  if (!stored) return null;
  try {
    return parseTake(stored);
  } catch (err) {
    console.warn(`Stored take ${id} is damaged`, err);
    return null;
  }
}

/** Takes of one scene, newest first. */
export async function listTakes(sceneId: string): Promise<TakeSummary[]> {
  const summaries = await run<TakeSummary[]>(TAKE_SUMMARIES, 'readonly', (s) => s.index('sceneId').getAll(sceneId));
  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteTake(id: string): Promise<void> {
  await transact([TAKES, TAKE_SUMMARIES], 'readwrite', (store) => {
    store(TAKES).delete(id);
    store(TAKE_SUMMARIES).delete(id);
  });
}

export async function deleteTakesOfScene(sceneId: string): Promise<void> {
  await transact([TAKES, TAKE_SUMMARIES], 'readwrite', (store) => {
    // Key cursors: the takes are deleted without being read.
    for (const name of [TAKES, TAKE_SUMMARIES]) {
      const s = store(name);
      const cursor = s.index('sceneId').openKeyCursor(IDBKeyRange.only(sceneId));
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        s.delete(c.primaryKey);
        c.continue();
      };
    }
  });
}
