import { describe, expect, it } from 'vitest';
import { Editor } from '../model/Editor';
import { TakeRecorder, type CameraSample } from '../model/take';
import { cameraTrackJson } from './cameraExport';
import { buildManifest, creditsText } from './manifest';

function take(focal = 50) {
  const ed = new Editor();
  ed.add({ kind: 'prop', name: 'Box', asset: { source: 'primitive', id: 'box' }, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } });
  const rec = new TakeRecorder(24, ed.doc);
  const cam = (x: number): CameraSample => ({ p: [x, 1.6, 4], q: [0, 0, 0, 1], focal, focus: 4 });
  for (let k = 0; k <= 24; k++) rec.push(k / 24, cam(k / 24));
  return { doc: ed.doc, take: rec.finish({ id: 't', name: 'Take 1', sceneId: ed.doc.id, sceneName: 'S', fps: 24, sensor: 'fullframe', aspect: '16:9', source: 'handheld' }) };
}

describe('cameraTrackJson', () => {
  it('writes one entry per frame with lens data and pinhole intrinsics', () => {
    const { take: t } = take(50);
    const json = cameraTrackJson(t, 1920, 1080);
    expect(json.frames).toHaveLength(25);
    const f = json.frames[12];
    expect(f.frame).toBe(12);
    expect(f.time).toBeCloseTo(0.5, 5);
    expect(f.position[0]).toBeCloseTo(0.5, 4);
    // 50 mm on a 36 × 20.25 mm image area at 1920 × 1080 px
    expect(f.intrinsics.fx).toBeCloseTo(2666.667, 2);
    expect(f.intrinsics.fy).toBeCloseTo(2666.667, 2);
    expect(f.intrinsics.cx).toBe(960);
    expect(f.fovHorizontal_deg).toBeCloseTo(39.6, 1);
    expect(f.euler).toEqual({ pan: 0, tilt: 0, roll: 0 });
  });
});

describe('manifest', () => {
  it('describes the video, passes, encodings and credits', () => {
    const { take: t, doc } = take();
    const m = buildManifest({
      take: t,
      doc,
      width: 1280,
      height: 720,
      passes: [
        { pass: 'depth', path: 'depth.mp4', format: 'mp4' },
        { pass: 'color_id', path: 'color_id/', format: 'png-sequence' },
      ],
      depth: { near: 0.5, far: 12 },
      credits: [{ title: 'Car', author: 'Poly by Google', licence: 'CC-BY 3.0', url: 'https://poly.pizza/m/x' }],
      poseUnmatched: [],
      appVersion: '0.1.0',
    });
    expect(m.video).toMatchObject({ width: 1280, height: 720, fps: 24, frameCount: 25 });
    expect(m.passes.map((p) => p.id)).toEqual(['depth', 'color_id']);
    expect(m.passes[0].encoding).toMatchObject({ near_m: 0.5, far_m: 12 });
    expect((m.passes[1].encoding as { objects: unknown[] }).objects).toHaveLength(1);
    expect(m.credits.models[0].author).toBe('Poly by Google');
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });

  it('writes human-readable credits', () => {
    const text = creditsText([{ title: 'Car', author: 'Poly by Google', licence: 'CC-BY 3.0', url: 'https://poly.pizza/m/x' }], 'My scene');
    expect(text).toContain('"Car" by Poly by Google, CC-BY 3.0: https://poly.pizza/m/x');
  });
});
