import { Box3, type Object3D } from 'three';
import type { Editor } from '../model/Editor';
import type { Transform } from '../model/scene';
import type { SceneSync } from '../sync/SceneSync';

const box = new Box3();

/** Reads an object root's local transform (roots sit directly under SceneSync.root, so local = world). */
export function readTransform(root: Object3D): Transform {
  return {
    position: root.position.toArray() as Transform['position'],
    rotation: root.quaternion.toArray() as Transform['rotation'],
    scale: root.scale.toArray() as Transform['scale'],
  };
}

/** Moves an object vertically so its lowest point rests on the floor (y = 0). */
export function snapToFloor(editor: Editor, sync: SceneSync, id: string): void {
  const root = sync.rootOf(id);
  const obj = editor.find(id);
  if (!root || !obj || obj.kind === 'light') return;
  root.updateMatrixWorld(true);
  box.setFromObject(root, true);
  if (box.isEmpty()) return;
  const t = readTransform(root);
  t.position[1] -= box.min.y;
  editor.setTransform(id, t);
}

export function deleteSelected(editor: Editor): void {
  if (editor.selectedId) editor.remove(editor.selectedId);
}

export function duplicateSelected(editor: Editor): void {
  if (editor.selectedId) editor.duplicate(editor.selectedId);
}
