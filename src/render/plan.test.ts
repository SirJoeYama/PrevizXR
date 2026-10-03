import { describe, expect, it } from 'vitest';
import { autoDepthRange, flipRows, hexToRgb, outputName, outputSize } from './plan';

describe('outputSize', () => {
  it('uses the short side and keeps both sides even', () => {
    expect(outputSize('16:9', 1080)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize('16:9', 720)).toEqual({ width: 1280, height: 720 });
    expect(outputSize('9:16', 1080)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize('1:1', 480)).toEqual({ width: 480, height: 480 });
    expect(outputSize('2.39:1', 1080)).toEqual({ width: 2582, height: 1080 });
    const odd = outputSize('16:9', 481);
    expect(odd.width % 2 + odd.height % 2).toBe(0);
  });
});

describe('autoDepthRange', () => {
  it('spans from the closest box surface to the farthest corner', () => {
    const box = { min: [-1, 0, -1] as [number, number, number], max: [1, 2, 1] as [number, number, number] };
    const { near, far } = autoDepthRange([[0, 1, 5]], [box]);
    expect(near).toBeCloseTo(3.6, 2); // 4 m to the front face, minus 10%
    expect(far).toBeGreaterThanOrEqual(Math.hypot(1, 1, 6));
  });

  it('considers every camera position', () => {
    const box = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
    const one = autoDepthRange([[0.5, 0.5, 3]], [box]);
    const two = autoDepthRange([[0.5, 0.5, 3], [0.5, 0.5, 10]], [box]);
    expect(two.far).toBeGreaterThan(one.far);
    expect(two.near).toBe(one.near);
  });

  it('falls back to a sane default with nothing in the scene', () => {
    expect(autoDepthRange([], [])).toEqual({ near: 0.5, far: 20 });
  });
});

describe('helpers', () => {
  it('builds file-system-safe names', () => {
    expect(outputName('My Scene!', 'Take 2', 'depth', 'mp4')).toBe('my-scene_take-2_depth.mp4');
    expect(outputName('', '', 'clay', 'zip')).toBe('untitled_untitled_clay.zip');
  });

  it('flips pixel rows', () => {
    const px = new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]); // 1×3 image
    flipRows(px, 1, 3);
    expect([...px]).toEqual([3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1]);
  });

  it('parses ID colors', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
  });
});
