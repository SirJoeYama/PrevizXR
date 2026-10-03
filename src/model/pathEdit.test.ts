import { describe, expect, it } from 'vitest';
import { Editor } from './Editor';
import { editablePoints, hasEditedHandles, movePathPoint, smoothPath } from './pathEdit';
import { CAMERA_ID, addWaypoint, clearWaypoints, identityTransform, popWaypoint } from './scene';
import { sampleKeyframes } from './take';

function sceneWithPath(kind: 'prop' | 'actor' = 'prop') {
  const ed = new Editor();
  const o = ed.add({ kind, name: 'Car', asset: { source: 'primitive', id: 'car' }, transform: { ...identityTransform(), position: [0, 0.5, 0] } });
  ed.update(o.id, (obj) => {
    addWaypoint(obj, 4, 0);
    addWaypoint(obj, 4, 3);
  });
  return { ed, id: o.id };
}

describe('path editing', () => {
  it('lists waypoint anchors and the handles that shape the curve', () => {
    const { ed, id } = sceneWithPath();
    const pts = editablePoints(ed.doc, id);
    // Start: out only (it moves with the object); middle: anchor, in, out; end: anchor, in.
    expect(pts.map((p) => `${p.index}${p.part[0]}`)).toEqual(['0o', '1a', '1i', '1o', '2a', '2i']);
    expect(pts.every((p) => p.part === 'anchor' || p.auto)).toBe(true);
    expect(pts.find((p) => p.index === 1 && p.part === 'anchor')!.position).toEqual([4, 0.5, 0]);
  });

  it('mirrors the partner handle and keeps the edit', () => {
    const { ed, id } = sceneWithPath();
    ed.edit((d) => movePathPoint(d, { owner: id, index: 1, part: 'out' }, [5, 0.5, 1]));
    const h = ed.find(id)!.motion!.handles!;
    expect(h[1]).toEqual({ out: [1, 0, 1], in: [-1, 0, -1] });
    expect(h[0]).toBeNull();
    expect(hasEditedHandles(ed.doc, id)).toBe(true);
    // Moving the anchor carries its handles.
    ed.edit((d) => movePathPoint(d, { owner: id, index: 1, part: 'anchor' }, [3, 0.5, 0]));
    expect(editablePoints(ed.doc, id).find((p) => p.index === 1 && p.part === 'out')!.position).toEqual([4, 0.5, 1]);
    ed.edit((d) => smoothPath(d, id));
    expect(hasEditedHandles(ed.doc, id)).toBe(false);
  });

  it('keeps actor paths on the floor', () => {
    const { ed, id } = sceneWithPath('actor');
    ed.edit((d) => movePathPoint(d, { owner: id, index: 2, part: 'anchor' }, [4, 1.2, 3]));
    ed.edit((d) => movePathPoint(d, { owner: id, index: 1, part: 'in' }, [3, 0.7, 0]));
    const a = ed.find(id)!.actor!;
    expect(a.waypoints[1]).toEqual([4, 0, 3]);
    expect(a.handles![1]).toEqual({ in: [-1, 0, 0], out: [1, 0, 0] });
  });

  it('never gives a new waypoint a stale handle', () => {
    const { ed, id } = sceneWithPath();
    ed.edit((d) => movePathPoint(d, { owner: id, index: 2, part: 'in' }, [4, 0.5, 2]));
    ed.update(id, (o) => popWaypoint(o));
    ed.update(id, (o) => addWaypoint(o, 0, 5));
    expect(ed.find(id)!.motion!.handles!.length).toBeLessThanOrEqual(2);
    ed.update(id, (o) => clearWaypoints(o));
    expect(ed.find(id)!.motion).toEqual({ speed: 2, waypoints: [], loop: false });
  });

  it('edits camera key handles and the camera path follows them', () => {
    const ed = new Editor();
    ed.editKeys((ks) => ks.push({ time: 0, position: [0, 1.6, 0], rotation: [0, 0, 0, 1], focalLength: 35 }, { time: 2, position: [4, 1.6, 0], rotation: [0, 0, 0, 1], focalLength: 35 }));
    expect(editablePoints(ed.doc, CAMERA_ID, false).map((p) => `${p.index}${p.part[0]}`)).toEqual(['0o', '1i']);
    expect(sampleKeyframes(ed.doc.camera.keyframes, 1).p[2]).toBeCloseTo(0);
    ed.edit((d) => movePathPoint(d, { owner: CAMERA_ID, index: 0, part: 'out' }, [1, 1.6, 2]));
    expect(ed.doc.camera.keyframes[0].handles).toEqual({ out: [1, 0, 2], in: [-1, 0, -2] });
    expect(sampleKeyframes(ed.doc.camera.keyframes, 1).p[2]).toBeGreaterThan(0.5);
  });
});
