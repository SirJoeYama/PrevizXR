import type { ActorSettings, Vec3 } from './scene';

export interface PathSample {
  /** World position on the floor path. */
  position: Vec3;
  /** Yaw in radians (rotation about +Y) facing the direction of travel; null when not moving. */
  heading: number | null;
  /** True while the actor is travelling (false before start, after the end, or with no path). */
  moving: boolean;
}

/**
 * Deterministic position of an actor at time t (seconds) along the polyline start → waypoints.
 * Pure function of its inputs: playback, recording and rendering all evaluate the same pose for the same t.
 */
export function samplePath(start: Vec3, actor: Pick<ActorSettings, 'waypoints' | 'speed' | 'loop'>, t: number): PathSample {
  const points = [start, ...actor.waypoints];
  if (points.length < 2 || actor.speed <= 0 || t <= 0) {
    return { position: [...start], heading: points.length >= 2 ? yawBetween(points[0], points[1]) : null, moving: false };
  }
  if (actor.loop) points.push(start);

  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const len = dist(points[i], points[i + 1]);
    lengths.push(len);
    total += len;
  }
  if (total === 0) return { position: [...start], heading: null, moving: false };

  let d = t * actor.speed;
  let moving = true;
  if (actor.loop) {
    d %= total;
  } else if (d >= total) {
    d = total;
    moving = false;
  }

  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i];
    if (len === 0) continue;
    if (d <= len || i === lengths.length - 1) {
      const a = points[i];
      const b = points[i + 1];
      const f = Math.min(d / len, 1);
      return {
        position: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f],
        heading: yawBetween(a, b),
        moving,
      };
    }
    d -= len;
  }
  return { position: [...start], heading: null, moving: false };
}

/** Yaw that makes a model facing +Z look from a toward b. */
export function yawBetween(a: Vec3, b: Vec3): number {
  return Math.atan2(b[0] - a[0], b[2] - a[2]);
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}
