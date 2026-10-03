import { measure, resolveHandles, segments } from './bezier';
import { multiplyQuat, quatFromYaw } from './math';
import { pathOf, type ActorClip, type MotionPath, type Quat, type SceneObject, type Vec3 } from './scene';

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
  const points = [start, ...path.waypoints];
  if (points.length < 2) return { position: [...start], heading: null, moving: false, startHeading: null };
  const curve = measure(segments(points, resolveHandles(points, path.handles, path.loop), path.loop));
  const startHeading = headingOf(curve.at(0).tangent);
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
  if (actor.waypoints.length && !moving && t > 0 && (clip === 'walk' || clip === 'run')) clip = 'idle';
  pose.clip = clip;
  pose.t = t;
  return pose;
}
