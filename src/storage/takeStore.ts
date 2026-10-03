import type { Take } from '../model/take';
import { TAKES, run } from './db';

/** Takes saved in the browser, indexed by the scene they were recorded in. */

export interface TakeSummary {
  id: string;
  name: string;
  sceneId: string;
  createdAt: string;
  fps: number;
  duration: number;
  frameCount: number;
  source: Take['source'];
  smoothing: number;
}

export function summarize(t: Take): TakeSummary {
  const { id, name, sceneId, createdAt, fps, duration, frameCount, source, smoothing } = t;
  return { id, name, sceneId, createdAt, fps, duration, frameCount, source, smoothing };
}

export async function saveTake(take: Take): Promise<void> {
  await run(TAKES, 'readwrite', (s) => s.put(take));
}

export async function loadTake(id: string): Promise<Take | null> {
  return (await run<Take | undefined>(TAKES, 'readonly', (s) => s.get(id))) ?? null;
}

/** Takes of one scene, newest first. */
export async function listTakes(sceneId: string): Promise<TakeSummary[]> {
  const takes = await run<Take[]>(TAKES, 'readonly', (s) => s.index('sceneId').getAll(sceneId));
  return takes.map(summarize).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteTake(id: string): Promise<void> {
  await run(TAKES, 'readwrite', (s) => s.delete(id));
}

export async function deleteTakesOfScene(sceneId: string): Promise<void> {
  for (const t of await listTakes(sceneId)) await deleteTake(t.id);
}
