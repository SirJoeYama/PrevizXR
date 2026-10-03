/**
 * The serializable scene model: plain JSON-safe objects, no Three.js types.
 * This is the single source of truth; the Three.js scene graph is derived from it by the sync layer.
 */

export const SCENE_FORMAT_VERSION = 1;

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
  | { source: 'light'; id: LightType };

export const ACTOR_CLIPS = ['idle', 'walk', 'run', 'sit'] as const;
export type ActorClip = (typeof ACTOR_CLIPS)[number];

export interface ActorSettings {
  clip: ActorClip;
  /** Metres per second along the waypoint path. */
  speed: number;
  /** World-space floor points the actor walks through after leaving its start position. */
  waypoints: Vec3[];
  /** Return to the start and repeat, instead of stopping at the last waypoint. */
  loop: boolean;
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
  light?: LightSettings;
}

export interface SceneDoc {
  format: 'previzxr.scene';
  version: number;
  id: string;
  name: string;
  objects: SceneObject[];
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
  };
}

export const DEFAULT_SPEED: Record<ActorClip, number> = { idle: 0, walk: 1.3, run: 3.5, sit: 0 };

export function defaultActorSettings(): ActorSettings {
  return { clip: 'idle', speed: DEFAULT_SPEED.walk, waypoints: [], loop: false };
}

/** Stable key for an asset, used for caching and to detect asset changes. */
export function assetKey(ref: AssetRef): string {
  return ref.source === 'poly' ? `poly:${ref.file}` : `${ref.source}:${ref.id}`;
}

export function cloneDoc<T>(value: T): T {
  return structuredClone(value);
}
