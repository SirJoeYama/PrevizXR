import type { PathHandle, Vec3 } from './scene';

/**
 * Cubic Bézier paths through a list of anchor points. Each anchor has an in and an out handle, stored as
 * offsets from the anchor; a missing handle is "auto": a smooth tangent from its neighbours, the same
 * curve a uniform Catmull-Rom spline would draw (so paths without edited handles stay smooth).
 */

export type Segment = [Vec3, Vec3, Vec3, Vec3];

/** Auto handle for anchor i: a sixth of the vector from the previous to the next anchor (Catmull-Rom). */
export function autoHandle(points: readonly Vec3[], i: number, loop: boolean): PathHandle {
  const n = points.length;
  const prev = i > 0 ? points[i - 1] : loop ? points[n - 1] : points[i];
  const next = i < n - 1 ? points[i + 1] : loop ? points[0] : points[i];
  const out: Vec3 = [(next[0] - prev[0]) / 6, (next[1] - prev[1]) / 6, (next[2] - prev[2]) / 6];
  return { in: [-out[0], -out[1], -out[2]], out };
}

/** Handles for every anchor: the stored one, or auto where missing. */
export function resolveHandles(points: readonly Vec3[], handles: ReadonlyArray<PathHandle | null | undefined> | undefined, loop: boolean): PathHandle[] {
  return points.map((_, i) => handles?.[i] ?? autoHandle(points, i, loop));
}

/** Control points of every segment (anchor i → anchor i+1, plus last → first when looping). */
export function segments(points: readonly Vec3[], handles: readonly PathHandle[], loop: boolean): Segment[] {
  const out: Segment[] = [];
  const n = points.length;
  const count = loop && n > 1 ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n;
    out.push([points[i], add(points[i], handles[i].out), add(points[j], handles[j].in), points[j]]);
  }
  return out;
}

export function bezierPoint([p0, c0, c1, p1]: Segment, t: number): Vec3 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * c0[0] + c * c1[0] + d * p1[0], a * p0[1] + b * c0[1] + c * c1[1] + d * p1[1], a * p0[2] + b * c0[2] + c * c1[2] + d * p1[2]];
}

/** Derivative (direction of travel); falls back to the chord where handles are zero-length. */
export function bezierTangent(seg: Segment, t: number): Vec3 {
  const [p0, c0, c1, p1] = seg;
  const u = 1 - t;
  const d: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) d[k] = 3 * u * u * (c0[k] - p0[k]) + 6 * u * t * (c1[k] - c0[k]) + 3 * t * t * (p1[k] - c1[k]);
  if (Math.hypot(d[0], d[1], d[2]) > 1e-9) return d;
  return [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
}

const SAMPLES_PER_SEGMENT = 48;

/** A path measured by arc length, for travelling along it at constant speed. */
export interface MeasuredPath {
  length: number;
  /** Position and direction of travel at distance d (clamped to the path). */
  at(d: number): { position: Vec3; tangent: Vec3 };
}

/**
 * Arc-length table over the segments: positions are interpolated between dense samples (exact on
 * straight segments), and the direction comes from the curve's derivative.
 */
export function measure(segs: readonly Segment[]): MeasuredPath {
  const pts: Vec3[] = [];
  const dist: number[] = [];
  const segOf: number[] = [];
  const tOf: number[] = [];
  let total = 0;
  segs.forEach((seg, s) => {
    for (let k = s === 0 ? 0 : 1; k <= SAMPLES_PER_SEGMENT; k++) {
      const t = k / SAMPLES_PER_SEGMENT;
      const p = bezierPoint(seg, t);
      if (pts.length) total += Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1], p[2] - pts[pts.length - 1][2]);
      pts.push(p);
      dist.push(total);
      segOf.push(s);
      tOf.push(t);
    }
  });
  return {
    length: total,
    at(d: number) {
      if (!pts.length) return { position: [0, 0, 0], tangent: [0, 0, 1] };
      const x = Math.max(0, Math.min(total, d));
      // Binary search for the sample interval containing x.
      let lo = 0;
      let hi = dist.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (dist[mid] <= x) lo = mid;
        else hi = mid;
      }
      const span = dist[hi] - dist[lo];
      const f = span > 0 ? (x - dist[lo]) / span : 0;
      const a = pts[lo];
      const b = pts[hi];
      const position: Vec3 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      // Interval crossing a segment boundary: the hi sample belongs to the next segment at t>0, lo ends the previous one.
      const seg = segOf[hi];
      const t0 = segOf[lo] === seg ? tOf[lo] : 0;
      const tangent = bezierTangent(segs[seg], t0 + (tOf[hi] - t0) * f);
      return { position, tangent };
    },
  };
}

/** Points along the whole path for drawing it (`perSegment` samples per segment). */
export function polyline(segs: readonly Segment[], perSegment = 16): Vec3[] {
  const out: Vec3[] = [];
  segs.forEach((seg, s) => {
    for (let k = s === 0 ? 0 : 1; k <= perSegment; k++) out.push(bezierPoint(seg, k / perSegment));
  });
  return out;
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
