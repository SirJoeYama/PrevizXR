import { ASPECTS, type AspectId } from '../camera/lens';
import type { Vec3 } from '../model/scene';

/** Pure planning helpers for rendering takes (no Three.js, unit-tested). */

export const PASSES = ['clay', 'color_id', 'depth'] as const;
export type PassId = (typeof PASSES)[number];

export const PASS_INFO: Record<PassId, { label: string; description: string }> = {
  clay: { label: 'Clay', description: 'Neutral grey materials, soft lighting. Source for video-to-video restyling.' },
  color_id: { label: 'Color ID', description: 'Flat, unlit, unique color per object on black. Masks and regional prompts.' },
  depth: { label: 'Depth', description: 'Normalized linear depth, white = near, black = far. Depth control.' },
};

/** Short side of the output in pixels. */
export const RESOLUTIONS = [480, 720, 1080] as const;

/** Output size for an aspect ratio, with both sides even (required by H.264 4:2:0). */
export function outputSize(aspect: AspectId, shortSide: number): { width: number; height: number } {
  const a = ASPECTS[aspect];
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return a >= 1 ? { width: even(shortSide * a), height: even(shortSide) } : { width: even(shortSide), height: even(shortSide / a) };
}

export interface Box {
  min: Vec3;
  max: Vec3;
}

/**
 * Depth range covering everything the camera might see: near is just in front of the closest object,
 * far just beyond the farthest box corner, over all sampled camera positions. Falls back to 0.5–20 m.
 */
export function autoDepthRange(cameraPositions: Vec3[], boxes: Box[]): { near: number; far: number } {
  if (!cameraPositions.length || !boxes.length) return { near: 0.5, far: 20 };
  let near = Infinity;
  let far = 0;
  for (const c of cameraPositions) {
    for (const b of boxes) {
      // Closest point of the box to the camera
      const dx = Math.max(b.min[0] - c[0], 0, c[0] - b.max[0]);
      const dy = Math.max(b.min[1] - c[1], 0, c[1] - b.max[1]);
      const dz = Math.max(b.min[2] - c[2], 0, c[2] - b.max[2]);
      near = Math.min(near, Math.hypot(dx, dy, dz));
      // Farthest corner
      const fx = Math.max(Math.abs(b.min[0] - c[0]), Math.abs(b.max[0] - c[0]));
      const fy = Math.max(Math.abs(b.min[1] - c[1]), Math.abs(b.max[1] - c[1]));
      const fz = Math.max(Math.abs(b.min[2] - c[2]), Math.abs(b.max[2] - c[2]));
      far = Math.max(far, Math.hypot(fx, fy, fz));
    }
  }
  const n = Math.max(0.05, Math.floor(near * 0.9 * 100) / 100);
  const f = Math.max(n + 0.5, Math.ceil(far * 1.05 * 10) / 10);
  return { near: n, far: f };
}

/** "My scene" + "Take 2" + "depth" → "my-scene_take-2_depth.mp4" */
export function outputName(sceneName: string, takeName: string, pass: string, ext: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
  return `${slug(sceneName)}_${slug(takeName)}_${pass}.${ext}`;
}

/** Flips RGBA rows in place (WebGL reads bottom-up; video frames are top-down). */
export function flipRows(pixels: Uint8Array, width: number, height: number): void {
  const row = width * 4;
  const tmp = new Uint8Array(row);
  for (let y = 0; y < height >> 1; y++) {
    const a = y * row;
    const b = (height - 1 - y) * row;
    tmp.set(pixels.subarray(a, a + row));
    pixels.copyWithin(a, b, b + row);
    pixels.set(tmp, b);
  }
}

/** Converts a #rrggbb ID color to bytes. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
