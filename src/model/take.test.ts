import { describe, expect, it } from 'vitest';
import { Editor } from './Editor';
import { slerp } from './math';
import { objectPoseAt } from './motion';
import { identityTransform, type CameraKey, type Quat } from './scene';
import {
  TakeFormatError,
  TakeRecorder,
  bakeKeyframes,
  cameraFrames,
  parseTake,
  sampleKeyframes,
  sampleTake,
  serializeTake,
  smoothCameras,
  type CameraSample,
  type TakeMeta,
} from './take';

const meta: TakeMeta = { id: 't1', name: 'Take 1', sceneId: 's', sceneName: 'Scene', fps: 24, sensor: 'super35', aspect: '16:9', source: 'handheld' };

function sceneWithWalker() {
  const ed = new Editor();
  const a = ed.add({ kind: 'actor', name: 'Ana', asset: { source: 'bundled', id: 'woman' }, transform: identityTransform() });
  ed.update(a.id, (o) => {
    o.actor!.clip = 'walk';
    o.actor!.waypoints = [[2, 0, 0]];
    o.actor!.speed = 1;
  });
  ed.add({ kind: 'prop', name: 'Box', asset: { source: 'primitive', id: 'box' }, transform: { ...identityTransform(), position: [5, 0, 5] } });
  return { ed, actorId: a.id };
}

const cam = (x: number): CameraSample => ({ p: [x, 1.6, 0], q: [0, 0, 0, 1], focal: 35, focus: 3 });

/** Live samples at an uneven display rate, with the camera moving 1 m/s along x. */
function recordUneven(rec: TakeRecorder, seconds: number) {
  let t = 0;
  let i = 0;
  while (t <= seconds) {
    rec.push(t, cam(t));
    t += i++ % 3 === 0 ? 0.011 : 0.0139; // mix of 90 Hz and 72 Hz frames
  }
  rec.push(seconds, cam(seconds));
}

describe('TakeRecorder', () => {
  it('emits frames at exactly k / fps, interpolating the camera between live samples', () => {
    const { ed } = sceneWithWalker();
    const rec = new TakeRecorder(24, ed.doc);
    recordUneven(rec, 1);
    expect(rec.frames.length).toBe(25); // 0 … 1 s inclusive
    rec.frames.forEach((f, k) => expect(f.camera.p[0]).toBeCloseTo(k / 24, 4));
  });

  it('records object poses exactly at frame times', () => {
    const { ed, actorId } = sceneWithWalker();
    const rec = new TakeRecorder(24, ed.doc);
    recordUneven(rec, 1);
    const f12 = rec.frames[12].objects[actorId];
    const exact = objectPoseAt(ed.find(actorId)!, 0.5);
    expect(f12.p[0]).toBeCloseTo(exact.p[0], 5);
    expect(f12.clip).toBe('walk');
    expect(f12.t).toBeCloseTo(0.5, 5);
  });

  it('builds a take with consistent counts and duration', () => {
    const { ed } = sceneWithWalker();
    const rec = new TakeRecorder(25, ed.doc);
    recordUneven(rec, 2);
    const take = rec.finish({ ...meta, fps: 25 });
    expect(take.frameCount).toBe(51);
    expect(take.duration).toBeCloseTo(2, 6);
    expect(take.objects.map((o) => o.name)).toEqual(['Ana', 'Box']);
  });
});

describe('deterministic playback', () => {
  const { ed } = sceneWithWalker();
  const rec = new TakeRecorder(24, ed.doc);
  recordUneven(rec, 2);
  const take = rec.finish(meta);

  it('returns frame k exactly at t = k / fps', () => {
    for (const k of [0, 1, 7, 24, 48]) expect(sampleTake(take, k / 24)).toEqual(take.frames[k]);
  });

  it('gives identical results for identical times', () => {
    expect(sampleTake(take, 1.2345)).toEqual(sampleTake(take, 1.2345));
  });

  it('interpolates between frames and clamps outside the take', () => {
    const mid = sampleTake(take, 0.5 / 24);
    expect(mid.camera.p[0]).toBeCloseTo(0.5 / 24, 4);
    expect(sampleTake(take, -1)).toEqual(take.frames[0]);
    expect(sampleTake(take, 99)).toEqual(take.frames[take.frameCount - 1]);
  });

  it('survives a JSON round trip unchanged', () => {
    expect(parseTake(serializeTake(take))).toEqual(take);
  });
});

describe('smoothing', () => {
  const jittery = Array.from({ length: 49 }, (_, i) => ({ ...cam(i / 24), p: [i / 24, 1.6 + (i % 2 ? 0.02 : -0.02), 0] as [number, number, number] }));

  it('reduces jitter but keeps the start and end frames', () => {
    const smooth = smoothCameras(jittery, 0.5, 24);
    const jitter = (cs: CameraSample[]) => cs.slice(1, -1).reduce((s, c, i) => s + Math.abs(c.p[1] - cs[i].p[1]), 0);
    expect(jitter(smooth)).toBeLessThan(jitter(jittery) * 0.2);
    expect(smooth[0]).toEqual(jittery[0]);
    expect(smooth[48]).toEqual(jittery[48]);
  });

  it('leaves a steady straight move where it is', () => {
    const line = Array.from({ length: 25 }, (_, i) => cam(i / 24));
    smoothCameras(line, 1, 24).forEach((c, i) => expect(c.p[0]).toBeCloseTo(i / 24, 6));
  });

  it('is applied by playback without touching the raw frames', () => {
    const rec = new TakeRecorder(24, new Editor().doc);
    jittery.forEach((c, i) => rec.push(i / 24, c));
    const take = rec.finish(meta);
    take.smoothing = 0.5;
    expect(cameraFrames(take)[10].p[1]).not.toBeCloseTo(take.frames[10].camera.p[1], 3);
    expect(sampleTake(take, 10 / 24).camera).toEqual(cameraFrames(take)[10]);
    take.smoothing = 0;
    expect(sampleTake(take, 10 / 24).camera).toEqual(take.frames[10].camera);
  });
});

describe('keyframed camera', () => {
  const turn: Quat = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)];
  const keys: CameraKey[] = [
    { time: 0, position: [0, 1.6, 4], rotation: [0, 0, 0, 1], focalLength: 24 },
    { time: 2, position: [2, 1.6, 4], rotation: turn, focalLength: 50 },
    { time: 4, position: [4, 3, 4], rotation: turn, focalLength: 50 },
  ];

  it('passes through every keyframe', () => {
    for (const k of keys) {
      const s = sampleKeyframes(keys, k.time);
      expect(s.p).toEqual(k.position);
      expect(s.focal).toBe(k.focalLength);
    }
  });

  it('interpolates rotation and focal length between keys', () => {
    const s = sampleKeyframes(keys, 1);
    expect(s.focal).toBe(37);
    expect(s.q).toEqual(slerp(keys[0].rotation, turn, 0.5));
  });

  it('bakes into a take with one frame per 1/fps up to the last key', () => {
    const ed = new Editor();
    ed.updateLens((l) => (l.fps = 25));
    ed.edit((d) => (d.camera.keyframes = keys));
    const take = bakeKeyframes(ed.doc, { id: 'k', name: 'Path', sceneId: ed.doc.id, sceneName: ed.doc.name });
    expect(take.fps).toBe(25);
    expect(take.frameCount).toBe(101);
    expect(take.source).toBe('keyframed');
    expect(take.frames[50].camera.p).toEqual([2, 1.6, 4]);
    expect(take.frames[100].camera.p).toEqual([4, 3, 4]);
    expect(bakeKeyframes(ed.doc, { id: 'k', name: 'Path', sceneId: ed.doc.id, sceneName: ed.doc.name }).frames).toEqual(take.frames);
  });

  it('needs two keyframes to bake', () => {
    const ed = new Editor();
    expect(() => bakeKeyframes(ed.doc, { id: 'k', name: 'x', sceneId: '', sceneName: '' })).toThrow(/two keyframes/);
  });
});

describe('parseTake', () => {
  it('rejects files that are not takes or are malformed', () => {
    expect(() => parseTake('{')).toThrow(TakeFormatError);
    expect(() => parseTake({ format: 'previzxr.scene' })).toThrow(/Not a PrevizXR take/);
    const rec = new TakeRecorder(24, new Editor().doc);
    rec.push(0, cam(0));
    const take = rec.finish(meta);
    expect(() => parseTake({ ...take, fps: 0 })).toThrow(/frame rate/);
    expect(() => parseTake({ ...take, frames: [{ camera: { p: [0, 0], q: [0, 0, 0, 1], focal: 35, focus: null }, objects: {} }] })).toThrow(/camera/);
  });
});
