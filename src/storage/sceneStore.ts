import { parseScene } from '../model/serialize';
import type { SceneDoc } from '../model/scene';
import { SCENES, run } from './db';

/** Scenes saved in the browser (IndexedDB). Each record holds the full SceneDoc. */

export interface SceneSummary {
  id: string;
  name: string;
  updatedAt: number;
  objectCount: number;
}

interface SceneRecord extends SceneSummary {
  doc: SceneDoc;
}

export async function saveScene(doc: SceneDoc): Promise<void> {
  const record: SceneRecord = {
    id: doc.id,
    name: doc.name,
    updatedAt: Date.now(),
    objectCount: doc.objects.length,
    doc: structuredClone(doc) as SceneDoc,
  };
  await run(SCENES, 'readwrite', (s) => s.put(record));
}

export async function loadScene(id: string): Promise<SceneDoc | null> {
  const record = await run<SceneRecord | undefined>(SCENES, 'readonly', (s) => s.get(id));
  return record ? parseScene(record.doc) : null;
}

export async function listScenes(): Promise<SceneSummary[]> {
  const records = await run<SceneRecord[]>(SCENES, 'readonly', (s) => s.getAll());
  return records
    .map(({ id, name, updatedAt, objectCount }) => ({ id, name, updatedAt, objectCount }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteScene(id: string): Promise<void> {
  await run(SCENES, 'readwrite', (s) => s.delete(id));
}
