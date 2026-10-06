import { ASPECTS, FPS_OPTIONS, SENSORS, clampFocal } from '../camera/lens';
import { DEFAULT_MOTION_SPEED, isClipName, SCENE_FORMAT_VERSION, defaultCamera, type CameraRig, type MotionPath, type PathHandle, type Quat, type SceneDoc, type SceneObject, type Vec3 } from './scene';

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
  return { format: 'previzxr.scene', version: SCENE_FORMAT_VERSION, id: data.id, name: data.name, objects, camera: parseCamera(data.camera) };
}

/** Camera rig with every missing or invalid field replaced by its default (older files have no camera). */
function parseCamera(c: unknown): CameraRig {
  const rig = defaultCamera();
  if (!isObj(c)) return rig;
  const t = c.transform;
  if (isObj(t) && isNums(t.position, 3) && isNums(t.rotation, 4)) {
    rig.transform.position = [...(t.position as [number, number, number])];
    rig.transform.rotation = [...(t.rotation as [number, number, number, number])];
  }
  const l = isObj(c.lens) ? c.lens : {};
  const lens = rig.lens;
  if (typeof l.focalLength === 'number' && Number.isFinite(l.focalLength)) lens.focalLength = clampFocal(l.focalLength);
  if (typeof l.sensor === 'string' && l.sensor in SENSORS) lens.sensor = l.sensor as typeof lens.sensor;
  if (typeof l.aspect === 'string' && l.aspect in ASPECTS) lens.aspect = l.aspect as typeof lens.aspect;
  if (FPS_OPTIONS.includes(l.fps as never)) lens.fps = l.fps as typeof lens.fps;
  if (l.focusMode === 'auto' || l.focusMode === 'manual') lens.focusMode = l.focusMode;
  if (typeof l.focusDistance === 'number' && l.focusDistance > 0) lens.focusDistance = l.focusDistance;
  if (isObj(l.guides)) {
    for (const k of ['thirds', 'safe', 'center'] as const) if (typeof l.guides[k] === 'boolean') lens.guides[k] = l.guides[k];
  }
  if (Array.isArray(c.keyframes)) {
    rig.keyframes = c.keyframes
      .filter((k): k is Record<string, unknown> => isObj(k) && typeof k.time === 'number' && k.time >= 0 && isNums(k.position, 3) && isNums(k.rotation, 4))
      .map((k) => ({
        time: k.time as number,
        position: [...(k.position as Vec3)] as Vec3,
        rotation: [...(k.rotation as Quat)] as Quat,
        focalLength: typeof k.focalLength === 'number' ? clampFocal(k.focalLength) : lens.focalLength,
        ...(isHandle(k.handles) ? { handles: cloneHandle(k.handles) } : {}),
      }))
      .sort((a, b) => a.time - b.time);
  }
  return rig;
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
  if (obj.asset.source === 'm2m') {
    const a = obj.asset as Record<string, unknown>;
    for (const k of ['title', 'creator', 'licence'] as const) if (typeof a[k] !== 'string') a[k] = '';
  }
  if (obj.asset.source === 'poly') {
    const a = obj.asset as { clips?: unknown };
    if (a.clips !== undefined && !(Array.isArray(a.clips) && a.clips.every(isClipName))) delete a.clips;
  }
  if (obj.asset.source === 'image') {
    const a = obj.asset as { aspect: unknown };
    if (typeof a.aspect !== 'number' || !(a.aspect > 0) || !Number.isFinite(a.aspect)) a.aspect = 1;
  }
  if (obj.hiddenInRenders !== undefined) obj.hiddenInRenders = !!obj.hiddenInRenders;
  if (obj.actor) {
    const a = obj.actor;
    if (!isClipName(a.clip)) a.clip = 'idle';
    repairPath(a, 1.3);
  }
  if (obj.motion !== undefined) {
    if (obj.actor || !isObj(obj.motion)) delete obj.motion;
    else repairPath(obj.motion, DEFAULT_MOTION_SPEED);
  }
  return obj;
}

function repairPath(p: MotionPath, defaultSpeed: number): void {
  if (typeof p.speed !== 'number' || !Number.isFinite(p.speed)) p.speed = defaultSpeed;
  if (!Array.isArray(p.waypoints) || !p.waypoints.every((w) => isNums(w, 3))) p.waypoints = [];
  p.loop = !!p.loop;
  if (p.handles !== undefined) {
    if (!Array.isArray(p.handles)) delete p.handles;
    else p.handles = p.handles.slice(0, p.waypoints.length + 1).map((h) => (isHandle(h) ? cloneHandle(h) : null));
  }
}

function isHandle(h: unknown): h is PathHandle {
  return isObj(h) && isNums(h.in, 3) && isNums(h.out, 3);
}

function cloneHandle(h: PathHandle): PathHandle {
  return { in: [...h.in], out: [...h.out] };
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
