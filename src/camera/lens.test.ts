import { describe, expect, it } from 'vitest';
import { clampFocal, focalForVerticalFov, horizontalFovDeg, imageArea, verticalFovDeg } from './lens';

describe('imageArea', () => {
  it('uses the full sensor width for landscape ratios', () => {
    expect(imageArea('fullframe', '16:9')).toEqual({ width: 36, height: 20.25 });
    const scope = imageArea('fullframe', '2.39:1');
    expect(scope.width).toBe(36);
    expect(scope.height).toBeCloseTo(15.063, 3);
  });

  it('uses the full sensor height for tall and square ratios', () => {
    expect(imageArea('fullframe', '1:1')).toEqual({ width: 24, height: 24 });
    expect(imageArea('fullframe', '9:16')).toEqual({ width: 13.5, height: 24 });
    const s35 = imageArea('super35', '9:16');
    expect(s35.height).toBe(18.66);
    expect(s35.width).toBeCloseTo(10.496, 3);
  });
});

describe('field of view', () => {
  it('matches known full-frame values', () => {
    // 50 mm on 36 × 24 mm: 39.6° horizontal; at 16:9 the 20.25 mm image height gives 22.9° vertical.
    expect(horizontalFovDeg(50, 'fullframe', '16:9')).toBeCloseTo(39.6, 1);
    expect(verticalFovDeg(50, 'fullframe', '16:9')).toBeCloseTo(22.9, 1);
    // 24 mm on full frame 3:2 height: 53.1° vertical (here at 1:1, which uses the full 24 mm height).
    expect(verticalFovDeg(24, 'fullframe', '1:1')).toBeCloseTo(53.13, 2);
  });

  it('is wider on full frame than Super 35 at the same focal length', () => {
    expect(horizontalFovDeg(35, 'fullframe', '16:9')).toBeGreaterThan(horizontalFovDeg(35, 'super35', '16:9'));
  });

  it('narrows as focal length grows', () => {
    expect(verticalFovDeg(14, 'super35', '16:9')).toBeGreaterThan(verticalFovDeg(135, 'super35', '16:9'));
  });

  it('round-trips through focalForVerticalFov', () => {
    for (const f of [14, 35, 85, 135]) {
      expect(focalForVerticalFov(verticalFovDeg(f, 'super35', '2.39:1'), 'super35', '2.39:1')).toBeCloseTo(f, 6);
    }
  });

  it('clamps focal lengths to the supported range', () => {
    expect(clampFocal(5)).toBe(14);
    expect(clampFocal(500)).toBe(135);
    expect(clampFocal(42)).toBe(42);
  });
});
