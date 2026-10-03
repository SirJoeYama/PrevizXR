import { add, resolveHandles } from './bezier';
import { CAMERA_ID, editPath, pathOf, type PathHandle, type SceneDoc, type Vec3 } from './scene';

/**
 * Editing Bézier paths point by point: anchors (waypoints, camera keys) and their in/out handles.
 * Object paths have anchors [start, ...waypoints], where the start is the object itself (moved with the
 * object, not here); camera paths have one anchor per keyframe.
 */

export type PathPart = 'anchor' | 'in' | 'out';

/** One draggable point of a path: `owner` is an object id or CAMERA_ID. */
export interface PathPointRef {
  owner: string;
  index: number;
  part: PathPart;
}

export interface PathPoint extends PathPointRef {
  /** World position of the point. */
  position: Vec3;
  /** World position of its anchor (handles draw a line to it). */
  anchor: Vec3;
  /** Handle not edited yet (smooth auto handle). */
  auto: boolean;
}

interface PathData {
  points: Vec3[];
  handles: Array<PathHandle | null | undefined>;
  loop: boolean;
  /** Anchors that can be moved here (object starts move with the object). */
  firstAnchor: number;
}

function pathData(doc: Readonly<SceneDoc>, owner: string): PathData | null {
  if (owner === CAMERA_ID) {
    const keys = doc.camera.keyframes;
    if (keys.length < 2) return keys.length ? { points: keys.map((k) => k.position), handles: [], loop: false, firstAnchor: 0 } : null;
    return { points: keys.map((k) => k.position), handles: keys.map((k) => k.handles), loop: false, firstAnchor: 0 };
  }
  const obj = doc.objects.find((o) => o.id === owner);
  const path = obj && pathOf(obj);
  if (!obj || !path?.waypoints.length) return null;
  return { points: [obj.transform.position, ...path.waypoints], handles: path.handles ?? [], loop: path.loop, firstAnchor: 1 };
}

/**
 * Every editable point of a path. Handles that shape nothing (before the first anchor or after the last
 * on an open path) are left out; `anchors: false` skips anchors (camera keys have their own markers).
 */
export function editablePoints(doc: Readonly<SceneDoc>, owner: string, anchors = true): PathPoint[] {
  const data = pathData(doc, owner);
  if (!data) return [];
  const { points, loop } = data;
  const n = points.length;
  const resolved = resolveHandles(points, data.handles, loop);
  const out: PathPoint[] = [];
  for (let i = 0; i < n; i++) {
    const anchor = points[i];
    const auto = !data.handles[i];
    if (anchors && i >= data.firstAnchor) out.push({ owner, index: i, part: 'anchor', position: [...anchor], anchor, auto: false });
    if (n < 2) continue;
    if (i > 0 || loop) out.push({ owner, index: i, part: 'in', position: add(anchor, resolved[i].in), anchor, auto });
    if (i < n - 1 || loop) out.push({ owner, index: i, part: 'out', position: add(anchor, resolved[i].out), anchor, auto });
  }
  return out;
}

/**
 * Moves one path point to a world position (mutates `doc`; call inside an Editor edit or transient).
 * Anchors carry their handles along. A handle becomes an edited handle and its partner mirrors it, so the
 * curve stays smooth through the anchor. Actors walk on the floor, so their points stay at y = 0.
 */
export function movePathPoint(doc: SceneDoc, ref: PathPointRef, position: Vec3): void {
  const floor = ref.owner !== CAMERA_ID && !!doc.objects.find((o) => o.id === ref.owner)?.actor;
  const p: Vec3 = [round(position[0]), floor ? 0 : round(position[1]), round(position[2])];
  if (ref.owner === CAMERA_ID) {
    const key = doc.camera.keyframes[ref.index];
    if (!key) return;
    if (ref.part === 'anchor') key.position = p;
    else key.handles = mirrored(ref.part, p, key.position);
    return;
  }
  const obj = doc.objects.find((o) => o.id === ref.owner);
  if (!obj || !pathOf(obj)) return;
  const path = editPath(obj);
  const n = path.waypoints.length + 1;
  if (ref.index < 0 || ref.index >= n) return;
  if (ref.part === 'anchor') {
    if (ref.index > 0) path.waypoints[ref.index - 1] = p;
    return;
  }
  const anchor = ref.index === 0 ? obj.transform.position : path.waypoints[ref.index - 1];
  const handles = path.handles ?? [];
  while (handles.length < n) handles.push(null);
  handles[ref.index] = mirrored(ref.part, p, anchor, floor);
  path.handles = handles;
}

/** Back to smooth auto handles everywhere on a path. */
export function smoothPath(doc: SceneDoc, owner: string): void {
  if (owner === CAMERA_ID) {
    for (const k of doc.camera.keyframes) delete k.handles;
    return;
  }
  const obj = doc.objects.find((o) => o.id === owner);
  const path = obj ? (obj.actor ?? obj.motion) : undefined;
  if (path) delete path.handles;
}

/** True when a path has edited (non-auto) handles. */
export function hasEditedHandles(doc: Readonly<SceneDoc>, owner: string): boolean {
  if (owner === CAMERA_ID) return doc.camera.keyframes.some((k) => k.handles);
  const obj = doc.objects.find((o) => o.id === owner);
  return !!(obj && pathOf(obj)?.handles?.some((h) => h));
}

function mirrored(part: 'in' | 'out', p: Vec3, anchor: Vec3, flat = false): PathHandle {
  const off: Vec3 = [round(p[0] - anchor[0]), flat ? 0 : round(p[1] - anchor[1]), round(p[2] - anchor[2])];
  const opp: Vec3 = [-off[0] + 0, -off[1] + 0, -off[2] + 0];
  return part === 'out' ? { in: opp, out: off } : { in: off, out: opp };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
