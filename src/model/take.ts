import { ACTOR_CLIPS, type CameraKey, type Quat, type SceneDoc, type SceneObjectKind, type Vec3 } from './scene';
import { catmullRom, lerp, lerp3, normalizeQuat, r5, round3, round4, slerp } from './math';
import { objectPoseAt, type ObjectPose } from './motion';
import type { AspectId, SensorId } from '../camera/lens';
import { ASPECTS, SENSORS } from '../camera/lens';

/**
 * A take: one recorded camera move plus every object's pose, sampled at a fixed frame rate.
 * Frame k is at time k / fps. Rendering replays frames exactly; playback interpolates between them.
 */

export const TAKE_FORMAT_VERSION = 1;
/** Recording stops by itself after this long. */
export const MAX_TAKE_SECONDS = 120;

export interface CameraSample {
  p: Vec3;
  q: Quat;
  /** Focal length, mm. */
  focal: number;
  /** Focus distance, m; null = infinity / unknown. */
  focus: number | null;
}

export interface TakeFrame {
  camera: CameraSample;
  /** Pose of every scene object at this frame, by object id. */
  objects: Record<string, ObjectPose>;
}

export interface TakeObjectInfo {
  id: string;
  name: string;
  kind: SceneObjectKind;
  color: string;
}

export interface Take {
  format: 'previzxr.take';
  version: number;
  id: string;
  name: string;
  sceneId: string;
  sceneName: string;
  createdAt: string;
  fps: number;
  frameCount: number;
  /** Seconds: (frameCount - 1) / fps, the time of the last frame. */
  duration: number;
  sensor: SensorId;
  aspect: AspectId;
  /** handheld: recorded live; keyframed: baked from the desktop camera path. */
  source: 'handheld' | 'keyframed';
  /** Camera path smoothing applied on playback/render, 0 (raw) to 1 (strong). Raw frames are kept. */
  smoothing: number;
  objects: TakeObjectInfo[];
  frames: TakeFrame[];
}

export type TakeMeta = Pick<Take, 'id' | 'name' | 'sceneId' | 'sceneName' | 'fps' | 'sensor' | 'aspect' | 'source'>;

export function emptyTake(meta: TakeMeta, doc: Readonly<SceneDoc>): Take {
  return {
    format: 'previzxr.take',
    version: TAKE_FORMAT_VERSION,
    ...meta,
    createdAt: new Date().toISOString(),
    frameCount: 0,
    duration: 0,
    smoothing: 0,
    objects: doc.objects.map((o) => ({ id: o.id, name: o.name, kind: o.kind, color: o.color })),
    frames: [],
  };
}

/** Poses of all objects at time t, rounded for storage. */
export function objectsAt(doc: Readonly<SceneDoc>, t: number): Record<string, ObjectPose> {
  const out: Record<string, ObjectPose> = {};
  for (const obj of doc.objects) {
    const pose = objectPoseAt(obj, t);
    const rounded: ObjectPose = { p: round3(pose.p), q: round4(pose.q), s: round3(pose.s) };
    if (pose.clip) {
      rounded.clip = pose.clip;
      rounded.t = r5(t);
    }
    out[obj.id] = rounded;
  }
  return out;
}

function roundCamera(c: CameraSample): CameraSample {
  return { p: round3(c.p), q: round4(normalizeQuat(c.q)), focal: r5(c.focal), focus: c.focus === null ? null : r5(c.focus) };
}

function lerpCamera(a: CameraSample, b: CameraSample, f: number): CameraSample {
  return {
    p: lerp3(a.p, b.p, f),
    q: slerp(a.q, b.q, f),
    focal: lerp(a.focal, b.focal, f),
    focus: a.focus === null || b.focus === null ? (f < 0.5 ? a.focus : b.focus) : lerp(a.focus, b.focus, f),
  };
}

/**
 * Turns live camera samples (at display rate, any timing) into frames at exactly k / fps.
 * The camera is interpolated between the two live samples around each frame time;
 * objects are evaluated at the exact frame time from the scene snapshot taken at the start.
 */
export class TakeRecorder {
  readonly frames: TakeFrame[] = [];
  private prev: { t: number; camera: CameraSample } | null = null;

  constructor(
    readonly fps: number,
    private readonly doc: Readonly<SceneDoc>,
  ) {}

  /** Time of the next frame to be emitted. */
  get nextFrameTime(): number {
    return this.frames.length / this.fps;
  }

  push(t: number, camera: CameraSample): void {
    const prev = this.prev ?? { t, camera };
    while (this.nextFrameTime <= t + 1e-9) {
      const ft = this.nextFrameTime;
      const span = t - prev.t;
      const f = span > 1e-9 ? Math.min(1, Math.max(0, (ft - prev.t) / span)) : 1;
      this.frames.push({ camera: roundCamera(lerpCamera(prev.camera, camera, f)), objects: objectsAt(this.doc, ft) });
    }
    this.prev = { t, camera };
  }

  finish(meta: TakeMeta): Take {
    const take = emptyTake(meta, this.doc);
    take.frames = this.frames;
    take.frameCount = this.frames.length;
    take.duration = this.frames.length ? (this.frames.length - 1) / this.fps : 0;
    return take;
  }
}

const smoothCache = new WeakMap<Take, { smoothing: number; cameras: CameraSample[] }>();

/** Camera samples with the take's smoothing applied (memoized per take and smoothing value). */
export function cameraFrames(take: Take): CameraSample[] {
  if (take.smoothing <= 0) return take.frames.map((f) => f.camera);
  const cached = smoothCache.get(take);
  if (cached && cached.smoothing === take.smoothing) return cached.cameras;
  const cameras = smoothCameras(
    take.frames.map((f) => f.camera),
    take.smoothing,
    take.fps,
  );
  smoothCache.set(take, { smoothing: take.smoothing, cameras });
  return cameras;
}

/**
 * Gaussian smoothing of a camera path. Strength 1 averages over about ±0.5 s.
 * The first and last frames are kept exactly so the shot starts and ends where it was framed.
 */
export function smoothCameras(cams: CameraSample[], strength: number, fps: number): CameraSample[] {
  const radius = Math.round(Math.max(0, Math.min(1, strength)) * fps * 0.5);
  if (radius < 1 || cams.length < 3) return cams.map((c) => ({ ...c }));
  const sigma = radius / 2;
  const weights = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
  return cams.map((c, i) => {
    if (i === 0 || i === cams.length - 1) return { ...c };
    // Shrink the window near the ends so the path is not pulled toward the clamped endpoints.
    const r = Math.min(radius, i, cams.length - 1 - i);
    let wsum = 0;
    const p: Vec3 = [0, 0, 0];
    const q: Quat = [0, 0, 0, 0];
    let focal = 0;
    let focus = 0;
    let focusW = 0;
    for (let j = -r; j <= r; j++) {
      const s = cams[i + j];
      const w = weights[j + radius];
      wsum += w;
      for (let k = 0; k < 3; k++) p[k] += s.p[k] * w;
      // Keep quaternions in the same hemisphere as the centre sample before averaging.
      const sign = s.q[0] * c.q[0] + s.q[1] * c.q[1] + s.q[2] * c.q[2] + s.q[3] * c.q[3] < 0 ? -1 : 1;
      for (let k = 0; k < 4; k++) q[k] += s.q[k] * w * sign;
      focal += s.focal * w;
      if (s.focus !== null) {
        focus += s.focus * w;
        focusW += w;
      }
    }
    return {
      p: [p[0] / wsum, p[1] / wsum, p[2] / wsum],
      q: normalizeQuat(q),
      focal: focal / wsum,
      focus: focusW > 0 ? focus / focusW : null,
    };
  });
}

/**
 * The scene at time t in a take: camera (smoothed if enabled) and object poses,
 * linearly interpolated between frames. At t = k / fps this returns frame k exactly.
 */
export function sampleTake(take: Take, t: number): TakeFrame {
  const n = take.frames.length;
  if (n === 0) throw new Error('Empty take');
  const cams = cameraFrames(take);
  const x = Math.max(0, Math.min(n - 1, t * take.fps));
  const i = Math.floor(x);
  const f = x - i;
  if (f < 1e-9 || i >= n - 1) return { camera: cams[i], objects: take.frames[i].objects };
  const a = take.frames[i];
  const b = take.frames[i + 1];
  const objects: Record<string, ObjectPose> = {};
  for (const id in a.objects) {
    const pa = a.objects[id];
    const pb = b.objects[id] ?? pa;
    const pose: ObjectPose = { p: lerp3(pa.p, pb.p, f), q: slerp(pa.q, pb.q, f), s: lerp3(pa.s, pb.s, f) };
    if (pa.clip) {
      pose.clip = pa.clip;
      pose.t = lerp(pa.t ?? 0, pb.t ?? pa.t ?? 0, f);
    }
    objects[id] = pose;
  }
  return { camera: lerpCamera(cams[i], cams[i + 1], f), objects };
}

/** Camera speed assumed when timing a new keyframe from its distance to the previous one (m/s). */
export const KEY_SPEED = 1;

/**
 * Time for a keyframe appended at `position`: 0 for the first; after that, the previous key's time plus
 * the travel time at KEY_SPEED, at least 1 s, rounded to 0.1 s. Retime keys afterwards to change pacing.
 */
export function nextKeyTime(keys: readonly CameraKey[], position: Vec3): number {
  const last = keys[keys.length - 1];
  if (!last) return 0;
  const d = Math.hypot(position[0] - last.position[0], position[1] - last.position[1], position[2] - last.position[2]);
  return Math.round((last.time + Math.max(1, d / KEY_SPEED)) * 10) / 10;
}

/** Camera state at time t on a keyframed path: Catmull-Rom positions, slerped rotations, linear focal length. */
export function sampleKeyframes(keys: readonly CameraKey[], t: number): Omit<CameraSample, 'focus'> {
  if (keys.length === 0) throw new Error('No keyframes');
  if (keys.length === 1 || t <= keys[0].time) return { p: [...keys[0].position], q: [...keys[0].rotation], focal: keys[0].focalLength };
  const last = keys[keys.length - 1];
  if (t >= last.time) return { p: [...last.position], q: [...last.rotation], focal: last.focalLength };
  let i = 0;
  while (t >= keys[i + 1].time) i++;
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const u = k2.time > k1.time ? (t - k1.time) / (k2.time - k1.time) : 1;
  const k0 = keys[Math.max(0, i - 1)];
  const k3 = keys[Math.min(keys.length - 1, i + 2)];
  return {
    p: catmullRom(k0.position, k1.position, k2.position, k3.position, u),
    q: slerp(k1.rotation, k2.rotation, u),
    focal: lerp(k1.focalLength, k2.focalLength, u),
  };
}

/**
 * Bakes the scene's keyframed camera path into a take: one frame per 1/fps from 0 to the last key.
 * Focus is the manual focus distance, or null with autofocus (there is no geometry to measure here).
 */
export function bakeKeyframes(doc: Readonly<SceneDoc>, meta: Omit<TakeMeta, 'source' | 'fps' | 'sensor' | 'aspect'>): Take {
  const { keyframes, lens } = doc.camera;
  if (keyframes.length < 2) throw new Error('A camera path needs at least two keyframes');
  const fps = lens.fps;
  const rec = new TakeRecorder(fps, doc);
  const end = keyframes[keyframes.length - 1].time;
  const count = Math.round(end * fps) + 1;
  const focus = lens.focusMode === 'manual' ? lens.focusDistance : null;
  for (let k = 0; k < count; k++) {
    const t = k / fps;
    rec.push(t, { ...sampleKeyframes(keyframes, t), focus });
  }
  return rec.finish({ ...meta, fps, sensor: lens.sensor, aspect: lens.aspect, source: 'keyframed' });
}

export class TakeFormatError extends Error {}

export function serializeTake(take: Take): string {
  return JSON.stringify(take);
}

/** Validates an imported take file. */
export function parseTake(input: unknown): Take {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      throw new TakeFormatError('File is not valid JSON.');
    }
  }
  const d = data as Partial<Take> | null;
  if (!d || typeof d !== 'object' || d.format !== 'previzxr.take') throw new TakeFormatError('Not a PrevizXR take file.');
  if (typeof d.version !== 'number' || d.version > TAKE_FORMAT_VERSION) throw new TakeFormatError(`Unsupported take version ${String(d.version)}.`);
  if (typeof d.id !== 'string' || typeof d.name !== 'string') throw new TakeFormatError('Take is missing its id or name.');
  if (typeof d.fps !== 'number' || d.fps <= 0 || d.fps > 120) throw new TakeFormatError('Take has an invalid frame rate.');
  if (!Array.isArray(d.frames) || d.frames.length === 0) throw new TakeFormatError('Take has no frames.');
  if (!d.sensor || !(d.sensor in SENSORS) || !d.aspect || !(d.aspect in ASPECTS)) throw new TakeFormatError('Take has an unknown sensor or aspect ratio.');
  const isN = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  d.frames.forEach((f, i) => {
    const c = f?.camera;
    if (!c || !isN(c.p, 3) || !isN(c.q, 4) || typeof c.focal !== 'number' || (c.focus !== null && typeof c.focus !== 'number')) {
      throw new TakeFormatError(`Frame ${i} has an invalid camera.`);
    }
    if (!f.objects || typeof f.objects !== 'object') throw new TakeFormatError(`Frame ${i} has no objects.`);
    for (const [id, o] of Object.entries(f.objects)) {
      if (!isN(o.p, 3) || !isN(o.q, 4) || !isN(o.s, 3)) throw new TakeFormatError(`Frame ${i}, object ${id} has an invalid pose.`);
      if (o.clip !== undefined && !ACTOR_CLIPS.includes(o.clip)) throw new TakeFormatError(`Frame ${i}, object ${id} has an unknown clip.`);
    }
  });
  const take = structuredClone(d) as Take;
  take.frameCount = take.frames.length;
  take.duration = (take.frameCount - 1) / take.fps;
  take.smoothing = typeof take.smoothing === 'number' ? Math.max(0, Math.min(1, take.smoothing)) : 0;
  take.source = take.source === 'keyframed' ? 'keyframed' : 'handheld';
  take.objects = Array.isArray(take.objects) ? take.objects : [];
  take.sceneId = typeof take.sceneId === 'string' ? take.sceneId : '';
  take.sceneName = typeof take.sceneName === 'string' ? take.sceneName : '';
  take.createdAt = typeof take.createdAt === 'string' ? take.createdAt : new Date().toISOString();
  return take;
}
