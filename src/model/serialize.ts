import { ACTOR_CLIPS, SCENE_FORMAT_VERSION, type SceneDoc, type SceneObject } from './scene';

export class SceneFormatError extends Error {}

export function serializeScene(doc: SceneDoc): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Validates untrusted JSON (imported files, IndexedDB records) and returns a SceneDoc.
 * Throws SceneFormatError with a readable message when the input is not a PrevizXR scene.
 */
export function parseScene(input: unknown): SceneDoc {
  const data = typeof input === 'string' ? safeJson(input) : input;
  if (!isObj(data) || data.format !== 'previzxr.scene') throw new SceneFormatError('Not a PrevizXR scene file.');
  if (typeof data.version !== 'number' || data.version > SCENE_FORMAT_VERSION) {
    throw new SceneFormatError(`Unsupported scene version ${String(data.version)}; this app reads up to ${SCENE_FORMAT_VERSION}.`);
  }
  if (typeof data.id !== 'string' || typeof data.name !== 'string' || !Array.isArray(data.objects)) {
    throw new SceneFormatError('Scene file is missing id, name or objects.');
  }
  const objects = data.objects.map((o, i) => parseObject(o, i));
  const ids = new Set(objects.map((o) => o.id));
  if (ids.size !== objects.length) throw new SceneFormatError('Scene file has duplicate object ids.');
  return { format: 'previzxr.scene', version: SCENE_FORMAT_VERSION, id: data.id, name: data.name, objects };
}

function parseObject(o: unknown, i: number): SceneObject {
  const where = `object ${i + 1}`;
  if (!isObj(o)) throw new SceneFormatError(`${where} is not an object.`);
  const { id, kind, name, asset, transform, color } = o;
  if (typeof id !== 'string' || typeof name !== 'string') throw new SceneFormatError(`${where} needs an id and name.`);
  if (kind !== 'actor' && kind !== 'prop' && kind !== 'light') throw new SceneFormatError(`${where} has unknown kind.`);
  if (!isObj(asset) || typeof asset.source !== 'string' || typeof asset.id !== 'string') {
    throw new SceneFormatError(`${where} has an invalid asset.`);
  }
  if (!isObj(transform) || !isNums(transform.position, 3) || !isNums(transform.rotation, 4) || !isNums(transform.scale, 3)) {
    throw new SceneFormatError(`${where} has an invalid transform.`);
  }
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new SceneFormatError(`${where} has an invalid color.`);

  const obj = structuredClone(o) as unknown as SceneObject;
  if (obj.actor) {
    const a = obj.actor;
    if (!ACTOR_CLIPS.includes(a.clip)) a.clip = 'idle';
    if (typeof a.speed !== 'number' || !Number.isFinite(a.speed)) a.speed = 1.3;
    if (!Array.isArray(a.waypoints) || !a.waypoints.every((w) => isNums(w, 3))) a.waypoints = [];
    a.loop = !!a.loop;
  }
  return obj;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new SceneFormatError('File is not valid JSON.');
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNums(v: unknown, n: number): boolean {
  return Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));
}
