import { describe, expect, it } from 'vitest';
import { multiplyQuat, quatFromYaw } from './math';
import { objectPoseAt, samplePath, yawBetween } from './motion';
import { identityTransform, type PathHandle, type SceneObject, type Vec3 } from './scene';

const start: Vec3 = [0, 0, 0];
/** Zero-length handles: straight segments, so distances are easy to check. */
const sharp = (n: number): PathHandle[] => Array.from({ length: n }, () => ({ in: [0, 0, 0], out: [0, 0, 0] }));
const path = { waypoints: [[4, 0, 0], [4, 0, 3]] as Vec3[], speed: 2, loop: false, handles: sharp(3) };
const close = (v: Vec3) => v.map((x) => +x.toFixed(6) + 0);

describe('samplePath', () => {
  it('stays at the start at t=0 and with no waypoints', () => {
    expect(samplePath(start, path, 0).position).toEqual([0, 0, 0]);
    expect(samplePath(start, path, 0).moving).toBe(false);
    expect(samplePath([1, 0, 1], { ...path, waypoints: [] }, 5).position).toEqual([1, 0, 1]);
  });

  it('moves at the given speed along each segment', () => {
    expect(close(samplePath(start, path, 1).position)).toEqual([2, 0, 0]);
    expect(close(samplePath(start, path, 2).position)).toEqual([4, 0, 0]);
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
    expect(close(s.position)).toEqual([4, 0, 3]);
    expect(s.moving).toBe(false);
  });

  it('curves smoothly through the waypoints with auto handles, at constant speed', () => {
    const smooth = { ...path, handles: undefined };
    // Rounds the corner: halfway along, it is off the straight legs.
    const end = samplePath(start, smooth, 100);
    expect(close(end.position)).toEqual([4, 0, 3]);
    const mid = samplePath(start, smooth, 1.5).position;
    expect(Math.abs(mid[2])).toBeGreaterThan(0.01);
    // Equal times cover equal distances.
    const a = samplePath(start, smooth, 0.5).position;
    const b = samplePath(start, smooth, 1).position;
    const c = samplePath(start, smooth, 1.5).position;
    const d1 = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const d2 = Math.hypot(c[0] - b[0], c[2] - b[2]);
    expect(d1).toBeCloseTo(d2, 1);
    // Heading turns gradually from +X toward +Z.
    const h = samplePath(start, smooth, 1.5).heading!;
    expect(h).toBeLessThan(Math.PI / 2);
    expect(h).toBeGreaterThan(0);
  });

  it('follows edited handles', () => {
    const bent = { waypoints: [[4, 0, 0]] as Vec3[], speed: 1, loop: false, handles: [{ in: [0, 0, 0] as Vec3, out: [1, 0, 2] as Vec3 }, { in: [-1, 0, 2] as Vec3, out: [1, 0, -2] as Vec3 }] };
    const s = samplePath(start, bent, 2);
    expect(s.position[2]).toBeGreaterThan(1); // bulges toward +Z
    expect(samplePath(start, bent, 0).heading).toBeCloseTo(Math.atan2(1, 2));
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
    motion: { speed: 2, waypoints: [[4, 0.5, 0], [4, 0.5, 3]], loop: false, handles: sharp(3) },
  });

  it('moves props along their path and keeps their orientation until the path turns', () => {
    const obj = car();
    expect(objectPoseAt(obj, 0).q).toEqual(obj.transform.rotation);
    const p = objectPoseAt(obj, 1);
    expect(close(p.p)).toEqual([2, 0.5, 0]);
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
