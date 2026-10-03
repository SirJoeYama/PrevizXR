import {
  Box3,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  type AnimationClip,
  type Object3D,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetRef, Fit, PrimitiveId } from '../model/scene';
import { bundledItem, bundledModelUrl } from './catalog';
import { getImage } from './imageLibrary';
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
  private readonly textures = new Map<string, Promise<Texture>>();
  private readonly backMaterial = new MeshStandardMaterial({ color: 0x3a3e46, roughness: 1 });

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
      case 'image':
        return { object: await this.buildPicture(ref.id, ref.aspect), clips: [] };
    }
  }

  /** Picture plane: 1 m tall, `aspect` wide, bottom edge at y = 0, unlit image in front and a dark back. */
  private async buildPicture(id: string, aspect: number): Promise<Object3D> {
    let pending = this.textures.get(id);
    if (!pending) {
      pending = (async () => {
        const img = await getImage(id);
        if (!img) throw new Error(`Image ${id} is not in this browser's image library`);
        const bitmap = await createImageBitmap(img.blob, { imageOrientation: 'flipY' });
        const texture = new Texture(bitmap);
        texture.flipY = false; // already flipped by createImageBitmap
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        return texture;
      })();
      this.textures.set(id, pending);
      pending.catch(() => this.textures.delete(id));
    }
    const texture = await pending;
    const geometry = new PlaneGeometry(aspect, 1).translate(0, 0.5, 0);
    const front = new Mesh(geometry, new MeshBasicMaterial({ map: texture, toneMapped: false }));
    const back = new Mesh(geometry, this.backMaterial);
    back.rotation.y = Math.PI;
    const group = new Group();
    group.name = 'Picture';
    group.add(front, back);
    return group;
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
