import {
  AnimationClip,
  Box3,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  type Object3D,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { M2M_CDN, M2M_FAMILIES, fitClips, m2mCharacter, m2mClipFile, m2mProp, m2mResolveClip, type M2MCharacter } from './mesh2motion';
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
  /**
   * Library characters: every clip is played by name, and these name the clips that stand in for the basic
   * clips (idle, walk, run, sit). Without it, basic clips are found by matching clip names.
   */
  roles?: Record<string, string>;
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
      case 'm2m':
        return this.loadM2M(ref.id);
    }
  }

  /** A Mesh2Motion character (its model plus the family's first animation file) or prop. */
  private async loadM2M(key: string): Promise<LoadedAsset> {
    const prop = m2mProp(key);
    if (prop) return this.loadGlb(M2M_CDN + prop.file, prop.fit);
    const ch = m2mCharacter(key);
    if (!ch) throw new Error(`Unknown Mesh2Motion asset ${key}`);
    const family = M2M_FAMILIES[ch.family];
    const animUrl = M2M_CDN + 'animations/' + family.animations[0];
    const [model, anims] = await Promise.all([this.gltfOf(ch.file ? M2M_CDN + ch.file : animUrl), this.gltfOf(animUrl)]);
    const roles: Record<string, string> = {};
    for (const basic of ['idle', 'walk', 'run', 'sit']) roles[basic] = m2mResolveClip(family, basic);
    return { object: normalize(cloneSkinned(model.scene), ch.fit), clips: this.characterClips(ch, anims.animations), roles };
  }

  /**
   * One clip from a character's other animation files (add-on, mocap), loaded the first time it is needed.
   * Resolves to null when the clip is not in its library.
   */
  async loadM2MClip(key: string, clip: string): Promise<AnimationClip | null> {
    const ch = m2mCharacter(key);
    if (!ch) return null;
    const family = M2M_FAMILIES[ch.family];
    const file = m2mClipFile(family, m2mResolveClip(family, clip));
    if (!file) return null;
    const gltf = await this.gltfOf(M2M_CDN + 'animations/' + file);
    const name = m2mResolveClip(family, clip);
    return this.characterClips(ch, gltf.animations).find((c) => c.name === name) ?? null;
  }

  /** Fitted clips per animation file and pelvis scale (characters with the same scale share them). */
  private readonly fittedClips = new WeakMap<AnimationClip[], Map<number, AnimationClip[]>>();

  /** A family's clips fitted to one character's proportions (see fitClips). */
  private characterClips(ch: M2MCharacter, clips: AnimationClip[]): AnimationClip[] {
    let byScale = this.fittedClips.get(clips);
    if (!byScale) this.fittedClips.set(clips, (byScale = new Map()));
    let out = byScale.get(ch.pelvisScale);
    if (!out) {
      out = fitClips(clips, M2M_FAMILIES[ch.family].trackingBone, ch.pelvisScale, (clip, tracks) => new AnimationClip(clip.name, clip.duration, tracks));
      byScale.set(ch.pelvisScale, out);
    }
    return out;
  }

  private gltfOf(url: string): Promise<GLTF> {
    let pending = this.cache.get(url);
    if (!pending) {
      pending = this.gltf.loadAsync(url);
      this.cache.set(url, pending);
      pending.catch(() => this.cache.delete(url));
    }
    return pending;
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
    const gltf = await this.gltfOf(url);
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
