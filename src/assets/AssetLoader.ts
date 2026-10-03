import { Box3, Group, Vector3, type AnimationClip, type Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetRef, Fit, PrimitiveId } from '../model/scene';
import { bundledItem, bundledModelUrl } from './catalog';
import { polyModelUrl } from './polyLibrary';
import { buildPrimitive } from './primitives';

export interface LoadedAsset {
  /** Normalized model: base on y=0, centred on x/z, scaled to its Fit. */
  object: Object3D;
  clips: AnimationClip[];
}

/** Loads and caches models. Each call returns an independent clone (skeletons included). */
export class AssetLoader {
  private readonly gltf = new GLTFLoader();
  private readonly cache = new Map<string, Promise<GLTF>>();

  async load(ref: AssetRef): Promise<LoadedAsset> {
    switch (ref.source) {
      case 'primitive':
        return { object: buildPrimitive(ref.id as PrimitiveId), clips: [] };
      case 'light':
        throw new Error('Lights have no model');
      case 'bundled': {
        const item = bundledItem(ref.id);
        return this.loadGlb(bundledModelUrl(ref.id), item?.fit ?? { axis: 'max', size: 1 });
      }
      case 'poly':
        return this.loadGlb(polyModelUrl(ref.file), ref.fit);
    }
  }

  private async loadGlb(url: string, fit: Fit): Promise<LoadedAsset> {
    let pending = this.cache.get(url);
    if (!pending) {
      pending = this.gltf.loadAsync(url);
      this.cache.set(url, pending);
      pending.catch(() => this.cache.delete(url));
    }
    const gltf = await pending;
    const model = cloneSkinned(gltf.scene);
    return { object: normalize(model, fit), clips: gltf.animations };
  }
}

const box = new Box3();
const size = new Vector3();
const center = new Vector3();

/** Wraps the model so that it stands on y=0, centred, at its real-world size. */
export function normalize(model: Object3D, fit: Fit): Group {
  const wrapper = new Group();
  wrapper.name = 'Normalized';
  wrapper.add(model);
  model.updateMatrixWorld(true);
  box.setFromObject(model, true);
  if (box.isEmpty()) return wrapper;
  box.getSize(size);
  const dim = fit.axis === 'height' ? size.y : fit.axis === 'length' ? Math.max(size.x, size.z) : Math.max(size.x, size.y, size.z);
  if (dim > 1e-6) model.scale.multiplyScalar(fit.size / dim);
  model.updateMatrixWorld(true);
  box.setFromObject(model, true);
  box.getCenter(center);
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
  return wrapper;
}
