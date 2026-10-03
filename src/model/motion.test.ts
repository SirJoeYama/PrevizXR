import { describe, expect, it } from 'vitest';
import { multiplyQuat, quatFromYaw } from './math';
import { objectPoseAt, samplePath, yawBetween } from './motion';
import { identityTransform, type SceneObject, type Vec3 } from './scene';

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

describe('objectPoseAt', () => {
  const car = (): SceneObject => ({
    id: 'c',
    kind: 'prop',
    name: 'Car',
    asset: { source: 'primitive', id: 'car' },
    color: '#ff0000',
    transform: { ...identityTransform(), position: [0, 0.5, 0], rotation: quatFromYaw(0.3) },
    motion: { speed: 2, waypoints: [[4, 0.5, 0], [4, 0.5, 3]], loop: false },
  });

  it('moves props along their path and keeps their orientation until the path turns', () => {
    const obj = car();
    expect(objectPoseAt(obj, 0).q).toEqual(obj.transform.rotation);
    const p = objectPoseAt(obj, 1);
    expect(p.p).toEqual([2, 0.5, 0]);
    expect(p.q.map((v) => +v.toFixed(6))).toEqual(obj.transform.rotation.map((v) => +v.toFixed(6)));
    expect(p.clip).toBeUndefined();
    // After the corner (+X → +Z) the car has turned by -90° about Y on top of its own rotation.
    const turned = multiplyQuat(quatFromYaw(-Math.PI / 2), obj.transform.rotation);
    expect(objectPoseAt(obj, 3).q.map((v) => +v.toFixed(6))).toEqual(turned.map((v) => +v.toFixed(6)));
  });

  it('leaves objects without a path at their transform', () => {
    const obj = car();
    delete obj.motion;
    expect(objectPoseAt(obj, 5).p).toEqual([0, 0.5, 0]);
  });
});

describe('yawBetween', () => {
  it('is 0 toward +Z and π/2 toward +X', () => {
    expect(yawBetween([0, 0, 0], [0, 0, 1])).toBeCloseTo(0);
    expect(yawBetween([0, 0, 0], [1, 0, 0])).toBeCloseTo(Math.PI / 2);
  });
});
