import type { CatalogItem } from '../assets/catalog';
import { uniqueName, type Editor } from '../model/Editor';
import { identityTransform, type Vec3 } from '../model/scene';
import { LIGHT_SPAWN_INTENSITY } from '../sync/SceneSync';

export type Spawnable = Pick<CatalogItem, 'title' | 'kind' | 'asset'>;

const LIGHT_HEIGHT = 2.6;

/** Adds a catalog item to the scene at a floor position, facing `yaw` (radians about +Y). Returns its id. */
export function spawn(editor: Editor, item: Spawnable, at: Vec3, yaw = 0): string {
  const transform = identityTransform();
  transform.position = [at[0], item.kind === 'light' ? LIGHT_HEIGHT : at[1], at[2]];
  transform.rotation = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const obj = editor.add({
    kind: item.kind,
    name: uniqueName(item.title, editor.doc.objects),
    asset: item.asset,
    transform,
    light:
      item.asset.source === 'light'
        ? { color: '#ffffff', intensity: LIGHT_SPAWN_INTENSITY[item.asset.id] }
        : undefined,
  });
  return obj.id;
}
