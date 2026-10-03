import { describe, expect, it } from 'vitest';
import { samplePath, yawBetween } from './motion';
import type { Vec3 } from './scene';

const start: Vec3 = [0, 0, 0];
const path = { waypoints: [[4, 0, 0], [4, 0, 3]] as Vec3[], speed: 2, loop: false };

describe('samplePath', () => {
  it('stays at the start at t=0 and with no waypoints', () => {
    expect(samplePath(start, path, 0).position).toEqual([0, 0, 0]);
    expect(samplePath(start, path, 0).moving).toBe(false);
    expect(samplePath([1, 0, 1], { ...path, waypoints: [] }, 5).position).toEqual([1, 0, 1]);
  });

  it('moves at the given speed along each segment', () => {
    expect(samplePath(start, path, 1).position).toEqual([2, 0, 0]);
    expect(samplePath(start, path, 2).position).toEqual([4, 0, 0]);
    const s = samplePath(start, path, 2.5);
    expect(s.position[0]).toBeCloseTo(4);
    expect(s.position[2]).toBeCloseTo(1);
    expect(s.moving).toBe(true);
  });

  it('faces the direction of travel', () => {
    expect(samplePath(start, path, 1).heading).toBeCloseTo(Math.PI / 2); // +X
    expect(samplePath(start, path, 3).heading).toBeCloseTo(0); // +Z
  });

  it('stops at the end when not looping', () => {
    const s = samplePath(start, path, 100);
    expect(s.position).toEqual([4, 0, 3]);
    expect(s.moving).toBe(false);
  });

  it('returns to the start and repeats when looping', () => {
    // Loop length = 4 + 3 + 5 = 12 m, so 6 s at 2 m/s.
    const loop = { ...path, loop: true };
    expect(samplePath(start, loop, 6).position.map((v) => +v.toFixed(6))).toEqual([0, 0, 0]);
    expect(samplePath(start, loop, 7).position.map((v) => +v.toFixed(6))).toEqual([2, 0, 0]);
  });

  it('is deterministic for the same t', () => {
    expect(samplePath(start, path, 1.2345)).toEqual(samplePath(start, path, 1.2345));
  });
});

describe('yawBetween', () => {
  it('is 0 toward +Z and π/2 toward +X', () => {
    expect(yawBetween([0, 0, 0], [0, 0, 1])).toBeCloseTo(0);
    expect(yawBetween([0, 0, 0], [1, 0, 0])).toBeCloseTo(Math.PI / 2);
  });
});
