/**
 * The serializable scene model: plain JSON-safe objects, no Three.js types.
 * This is the single source of truth; the Three.js scene graph is derived from it by the sync layer.
 */

import type { AspectId, Fps, SensorId } from '../camera/lens';

export const SCENE_FORMAT_VERSION = 1;

/** Selection id of the scene's virtual camera (it is not in `objects`, so it never gets an ID color). */
export const CAMERA_ID = 'camera';

export type Vec3 = [number, number, number];
/** Quaternion as [x, y, z, w]. */
export type Quat = [number, number, number, number];

export interface Transform {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

export type SceneObjectKind = 'actor' | 'prop' | 'light';

/** Built-in procedural blockout shapes. */
export type PrimitiveId = 'box' | 'cylinder' | 'chair' | 'table' | 'door' | 'wall' | 'car';
export type LightType = 'point' | 'spot' | 'directional';

/**
 * How an imported model is sized: its height, its longest horizontal side, or its largest dimension
 * is scaled to `size` metres. Downloaded models come in arbitrary units, so every model is normalized.
 */
export interface Fit {
  axis: 'height' | 'length' | 'max';
  size: number;
}

/**
 * Where an object's geometry comes from.
 * - primitive: generated in code
 * - bundled: a .glb shipped with the app (see src/assets/catalog.ts)
 * - poly: fetched on demand from the Poly Pizza CDN; title/licence are stored so scene files stay self-describing
 */
export type AssetRef =
  | { source: 'primitive'; id: PrimitiveId }
  | { source: 'bundled'; id: string }
  | { source: 'poly'; id: string; file: string; title: string; creator: string; licence: string; fit: Fit }
  | { source: 'light'; id: LightType }
  /** A picture plane: `id` is the image's content hash in the image library; height 1 m, width = aspect. */
  | { source: 'image'; id: string; aspect: number };

export const ACTOR_CLIPS = ['idle', 'walk', 'run', 'sit'] as const;
export type ActorClip = (typeof ACTOR_CLIPS)[number];

/** Bézier handles of one path anchor, as offsets from the anchor (metres). */
export interface PathHandle {
  in: Vec3;
  out: Vec3;
}

/** A path an object travels along during preview, takes and renders. */
export interface MotionPath {
  /** Metres per second along the waypoint path. */
  speed: number;
  /** World-space points the object passes through after leaving its start position. */
  waypoints: Vec3[];
  /** Return to the start and repeat, instead of stopping at the last waypoint. */
  loop: boolean;
  /**
   * Bézier handles per anchor, aligned with [start, ...waypoints]; a missing or null entry is a smooth
   * auto handle. Absent on paths whose curve was never edited.
   */
  handles?: Array<PathHandle | null>;
}

/** Actors walk their path on the floor, facing the direction of travel. */
export interface ActorSettings extends MotionPath {
  clip: ActorClip;
}

export interface LightSettings {
  color: string;
  intensity: number;
}

export interface SceneObject {
  id: string;
  kind: SceneObjectKind;
  name: string;
  asset: AssetRef;
  transform: Transform;
  /** Flat ID color (#rrggbb) used for labels and the color_id pass. Unique per object. */
  color: string;
  actor?: ActorSettings;
  /** Props and lights: an optional path (actors keep theirs in `actor`). */
  motion?: MotionPath;
  light?: LightSettings;
  /** Editor-only reference (storyboards, mood images): hidden from the camera monitor and render passes. */
  hiddenInRenders?: boolean;
}

export interface Guides {
  thirds: boolean;
  /** Action-safe (93%) and title-safe (90%) frames. */
  safe: boolean;
  center: boolean;
}

export interface LensSettings {
  /** Millimetres, 14–135. */
  focalLength: number;
  sensor: SensorId;
  aspect: AspectId;
  fps: Fps;
  /** auto: focus on whatever is under the frame centre; manual: use focusDistance. */
  focusMode: 'auto' | 'manual';
  /** Metres (used in manual mode). */
  focusDistance: number;
  guides: Guides;
}

/** A keyframe of the dolly/crane camera path. */
export interface CameraKey {
  /** Seconds from the start of the shot. */
  time: number;
  position: Vec3;
  rotation: Quat;
  focalLength: number;
  /** Bézier handles of the path at this key (offsets); absent = smooth auto handles. */
  handles?: PathHandle;
}

/** The virtual camera. Looks down its local -Z axis, +Y up. */
export interface CameraRig {
  transform: Transform;
  lens: LensSettings;
  /** Keyframed path, sorted by time. Empty unless the user builds one. */
  keyframes: CameraKey[];
}

export interface SceneDoc {
  format: 'previzxr.scene';
  version: number;
  id: string;
  name: string;
  objects: SceneObject[];
  camera: CameraRig;
}

export function identityTransform(): Transform {
  return { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
}

export function createId(): string {
  return crypto.randomUUID();
}

export function createScene(name = 'Untitled scene'): SceneDoc {
  return {
    format: 'previzxr.scene',
    version: SCENE_FORMAT_VERSION,
    id: createId(),
    name,
    objects: [],
    camera: defaultCamera(),
  };
}

export function defaultLens(): LensSettings {
  return {
    focalLength: 35,
    sensor: 'super35',
    aspect: '16:9',
    fps: 24,
    focusMode: 'auto',
    focusDistance: 3,
    guides: { thirds: true, safe: false, center: false },
  };
}

/** Eye height, 4 m back from the origin, looking toward it. */
export function defaultCamera(): CameraRig {
  return { transform: { position: [0, 1.6, 4], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, lens: defaultLens(), keyframes: [] };
}

export const DEFAULT_SPEED: Record<ActorClip, number> = { idle: 0, walk: 1.3, run: 3.5, sit: 0 };

export function defaultActorSettings(): ActorSettings {
  return { clip: 'idle', speed: DEFAULT_SPEED.walk, waypoints: [], loop: false };
}

/** Speed of a new prop or light path (m/s). */
export const DEFAULT_MOTION_SPEED = 2;

/** An object's path settings: an actor's own, or a prop's or light's optional motion. */
export function pathOf(obj: Readonly<SceneObject>): Readonly<MotionPath> | undefined {
  return obj.actor ?? obj.motion;
}

/** Path settings to mutate (inside an Editor edit); created on first use for props and lights. */
export function editPath(obj: SceneObject): MotionPath {
  return obj.actor ?? (obj.motion ??= { speed: DEFAULT_MOTION_SPEED, waypoints: [], loop: false });
}

/** Appends a waypoint (with an auto handle) at floor point (x, z); call inside an Editor edit. */
export function addWaypoint(obj: SceneObject, x: number, z: number): void {
  const path = editPath(obj);
  trimHandles(path, path.waypoints.length + 1);
  path.waypoints.push(waypointAt(obj, x, z));
}

/** Removes the last waypoint and its handle. */
export function popWaypoint(obj: SceneObject): void {
  const path = editPath(obj);
  path.waypoints.pop();
  trimHandles(path, path.waypoints.length + 1);
}

/** Removes every waypoint and handle. */
export function clearWaypoints(obj: SceneObject): void {
  const path = editPath(obj);
  path.waypoints = [];
  delete path.handles;
}

/** Keeps handles for the first `count` anchors only, so a new waypoint never inherits a stale handle. */
function trimHandles(path: MotionPath, count: number): void {
  if (path.handles && path.handles.length > count) path.handles.length = count;
}

/**
 * Where a waypoint placed at floor point (x, z) goes: actors walk on the floor; other objects
 * travel at the height they stand at.
 */
export function waypointAt(obj: Readonly<SceneObject>, x: number, z: number): Vec3 {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return [r(x), obj.actor ? 0 : obj.transform.position[1], r(z)];
}

/** Stable key for an asset, used for caching and to detect asset changes. */
export function assetKey(ref: AssetRef): string {
  return ref.source === 'poly' ? `poly:${ref.file}` : `${ref.source}:${ref.id}`;
}

export function cloneDoc<T>(value: T): T {
  return structuredClone(value);
}
