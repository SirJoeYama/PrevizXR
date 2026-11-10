import { measure, resolveHandles, segments, type MeasuredPath } from './bezier';
import { multiplyQuat, quatFromYaw } from './math';
import { isTravelClip, pathOf, type ActorClip, type MotionPath, type Quat, type SceneObject, type Vec3 } from './scene';

export interface PathSample {
  /** World position on the floor path. */
  position: Vec3;
  /** Yaw in radians (rotation about +Y) facing the direction of travel; null when not moving. */
  heading: number | null;
  /** True while the actor is travelling (false before start, after the end, or with no path). */
  moving: boolean;
  /** Heading at the start of the path (null without one). */
  startHeading: number | null;
}

/**
 * Deterministic position of an object at time t (seconds) along the Bézier path start → waypoints, at
 * constant speed. Pure function of its inputs: playback, recording and rendering all evaluate the same
 * pose for the same t.
 */
export function samplePath(start: Vec3, path: Readonly<MotionPath>, t: number): PathSample {
  if (!path.waypoints.length) return { position: [...start], heading: null, moving: false, startHeading: null };
  const { curve, startHeading } = measuredPath(start, path);
  if (path.speed <= 0 || t <= 0 || curve.length === 0) return { position: [...start], heading: startHeading, moving: false, startHeading };

  let d = t * path.speed;
  let moving = true;
  if (path.loop) {
    d %= curve.length;
  } else if (d >= curve.length) {
    d = curve.length;
    moving = false;
  }
  const s = curve.at(d);
  return { position: s.position, heading: headingOf(s.tangent) ?? startHeading, moving, startHeading };
}

interface MeasuredCurve {
  /** The geometry the curve was measured from, flattened (see pathNumbers). */
  key: number[];
  curve: MeasuredPath;
  startHeading: number | null;
}

/**
 * Measured curves by path object. Measuring samples every segment densely, far too much to redo for every
 * object on every frame of a preview or recording, so the result is kept until the path's geometry changes.
 * Dragging mutates a path in place, hence the comparison by value rather than by identity alone.
 */
const measured = new WeakMap<object, MeasuredCurve>();

function measuredPath(start: Vec3, path: Readonly<MotionPath>): MeasuredCurve {
  const hit = measured.get(path);
  if (hit && sameGeometry(hit.key, start, path)) return hit;
  const points = [start, ...path.waypoints];
  const curve = measure(segments(points, resolveHandles(points, path.handles, path.loop), path.loop));
  const entry: MeasuredCurve = { key: pathNumbers(start, path), curve, startHeading: headingOf(curve.at(0).tangent) };
  measured.set(path, entry);
  return entry;
}

/** Everything the curve's shape depends on (speed only sets how fast it is travelled). */
function pathNumbers(start: Vec3, path: Readonly<MotionPath>): number[] {
  const out = [path.loop ? 1 : 0, path.waypoints.length, start[0], start[1], start[2]];
  for (const w of path.waypoints) out.push(w[0], w[1], w[2]);
  for (let i = 0; i <= path.waypoints.length; i++) {
    const h = path.handles?.[i];
    if (h) out.push(1, h.in[0], h.in[1], h.in[2], h.out[0], h.out[1], h.out[2]);
    else out.push(0);
  }
  return out;
}

/** pathNumbers(start, path) equals `key`, compared without allocating (this runs per object per frame). */
function sameGeometry(key: readonly number[], start: Vec3, path: Readonly<MotionPath>): boolean {
  const n = path.waypoints.length;
  if (key[0] !== (path.loop ? 1 : 0) || key[1] !== n || key[2] !== start[0] || key[3] !== start[1] || key[4] !== start[2]) return false;
  let k = 5;
  for (let i = 0; i < n; i++) {
    const w = path.waypoints[i];
    if (key[k++] !== w[0] || key[k++] !== w[1] || key[k++] !== w[2]) return false;
  }
  for (let i = 0; i <= n; i++) {
    const h = path.handles?.[i];
    if (!h) {
      if (key[k++] !== 0) return false;
    } else if (key[k++] !== 1 || key[k++] !== h.in[0] || key[k++] !== h.in[1] || key[k++] !== h.in[2] || key[k++] !== h.out[0] || key[k++] !== h.out[1] || key[k++] !== h.out[2]) {
      return false;
    }
  }
  return k === key.length;
}

/** Yaw of a direction of travel (null when it is vertical). */
function headingOf(v: Vec3): number | null {
  return Math.hypot(v[0], v[2]) < 1e-9 ? null : Math.atan2(v[0], v[2]);
}

/** Yaw that makes a model facing +Z look from a toward b. */
export function yawBetween(a: Vec3, b: Vec3): number {
  return Math.atan2(b[0] - a[0], b[2] - a[2]);
}

/** Pose of one object at scene time t: what preview, recording and rendering all agree on. */
export interface ObjectPose {
  p: Vec3;
  q: Quat;
  s: Vec3;
  /** Actors only: active clip and its playback time in seconds. */
  clip?: ActorClip;
  t?: number;
}

/**
 * Deterministic pose at time t. Actors with waypoints follow their path facing the direction of travel,
 * and switch from walk/run to idle when they arrive. Props and lights with a path keep their own
 * orientation and turn with the path at each corner. Everything else stays at its scene transform.
 */
export function objectPoseAt(obj: SceneObject, t: number): ObjectPose {
  const { position, rotation, scale } = obj.transform;
  const pose: ObjectPose = { p: [...position], q: [...rotation], s: [...scale] };
  const actor = obj.actor;
  const path = pathOf(obj);
  let moving = false;
  if (path?.waypoints.length) {
    const s = samplePath(position, path, t);
    pose.p = s.position;
    moving = s.moving;
    if (s.heading !== null) {
      pose.q = actor ? quatFromYaw(s.heading) : multiplyQuat(quatFromYaw(s.heading - (s.startHeading ?? s.heading)), rotation);
    }
  }
  if (!actor) return pose;
  let clip = actor.clip;
  if (actor.waypoints.length && !moving && t > 0 && isTravelClip(clip)) clip = 'idle';
  pose.clip = clip;
  pose.t = t;
  return pose;
}
