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

export interface SceneObject {
  id: string;
  kind: SceneObjectKind;
  name: string;
  transform: Transform;
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
