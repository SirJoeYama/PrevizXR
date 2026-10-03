import type { SceneDoc } from '../model/scene';
import { IMAGES, run } from '../storage/db';

/**
 * Reference images (storyboards, mood boards, plates) stored in this browser.
 * Images are identified by a hash of their (downscaled) bytes, so importing the same picture twice
 * reuses one record. Scenes reference them by id; exported scene files embed them.
 */

export interface StoredImage {
  id: string;
  name: string;
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
}

/** Longest side kept on import: sharp enough to read, light enough for Quest's GPU memory. */
export const MAX_IMAGE_SIDE = 2048;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const urls = new Map<string, string>();
const listeners = new Set<() => void>();

export function onImagesChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(): void {
  for (const l of listeners) l();
}

/** Size that fits within `max` on the longest side, keeping the aspect ratio (never upscales). */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const s = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/** Image ids used by a scene's picture planes. */
export function sceneImageIds(doc: Readonly<SceneDoc>): string[] {
  return [...new Set(doc.objects.flatMap((o) => (o.asset.source === 'image' ? [o.asset.id] : [])))];
}

async function hashId(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Decodes, downscales (JPEG unless the source is PNG, which may have transparency) and stores an image. */
export async function importImage(file: Blob, name: string): Promise<StoredImage> {
  if (file.type && !IMAGE_TYPES.includes(file.type)) throw new Error(`${name}: use a JPG, PNG or WebP image.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${name}: this image could not be decoded.`);
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_SIDE);
  let blob = file;
  if (width !== bitmap.width || height !== bitmap.height || !file.type) {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
    blob = await canvas.convertToBlob(file.type === 'image/png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.9 });
  }
  bitmap.close();
  const id = await hashId(blob);
  const existing = await getImage(id);
  if (existing) return existing;
  const record: StoredImage = { id, name: name.replace(/\.[a-z0-9]+$/i, '') || 'Image', blob, width, height, createdAt: Date.now() };
  await run(IMAGES, 'readwrite', (s) => s.put(record));
  emit();
  return record;
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
  return run<StoredImage | undefined>(IMAGES, 'readonly', (s) => s.get(id));
}

/** All stored images, newest first. */
export async function listImages(): Promise<StoredImage[]> {
  const all = await run<StoredImage[]>(IMAGES, 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteImage(id: string): Promise<void> {
  await run(IMAGES, 'readwrite', (s) => s.delete(id));
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  emit();
}

/** A long-lived object URL for an image (thumbnails, textures). */
export function imageUrl(img: StoredImage): string {
  let url = urls.get(img.id);
  if (!url) {
    url = URL.createObjectURL(img.blob);
    urls.set(img.id, url);
  }
  return url;
}

/** Images for a scene file: id → data URL. */
export async function embedImages(doc: Readonly<SceneDoc>): Promise<Record<string, { name: string; data: string }>> {
  const out: Record<string, { name: string; data: string }> = {};
  for (const id of sceneImageIds(doc)) {
    const img = await getImage(id);
    if (!img) continue;
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(img.blob);
    });
    out[id] = { name: img.name, data };
  }
  return out;
}

/** Stores images embedded in an imported scene file (keeping their original ids). */
export async function restoreEmbeddedImages(embedded: unknown): Promise<void> {
  if (!embedded || typeof embedded !== 'object') return;
  let added = false;
  for (const [id, value] of Object.entries(embedded as Record<string, { name?: string; data?: string }>)) {
    if (typeof value?.data !== 'string' || !value.data.startsWith('data:image/') || (await getImage(id))) continue;
    const blob = await (await fetch(value.data)).blob();
    const bitmap = await createImageBitmap(blob);
    const record: StoredImage = { id, name: value.name ?? 'Image', blob, width: bitmap.width, height: bitmap.height, createdAt: Date.now() };
    bitmap.close();
    await run(IMAGES, 'readwrite', (s) => s.put(record));
    added = true;
  }
  if (added) emit();
}
