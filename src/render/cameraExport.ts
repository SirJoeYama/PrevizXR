import { AnimationClip, Euler, Group, PerspectiveCamera, Quaternion, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { SENSORS, imageArea, verticalFovDeg } from '../camera/lens';
import { r5 } from '../model/math';
import { cameraFrames, type Take } from '../model/take';

/**
 * The take's camera as plain JSON: per frame position, rotation, lens and pinhole intrinsics
 * for the rendered resolution. Uses the same smoothed samples as the rendered passes.
 */
export function cameraTrackJson(take: Take, width: number, height: number) {
  const area = imageArea(take.sensor, take.aspect);
  const sensor = SENSORS[take.sensor];
  const q = new Quaternion();
  const e = new Euler(0, 0, 0, 'YXZ');
  const deg = 180 / Math.PI;
  return {
    format: 'previzxr.camera',
    version: 1,
    coordinateSystem: {
      up: '+Y',
      handedness: 'right',
      units: 'metres',
      cameraLooksAlong: '-Z (glTF / three.js convention); +X is screen right, +Y screen up',
      eulerOrder: 'YXZ (pan about Y, then tilt about X, then roll about Z), degrees',
    },
    fps: take.fps,
    frameCount: take.frameCount,
    smoothing: take.smoothing,
    resolution: { width, height },
    sensor: { name: sensor.label, width_mm: sensor.width, height_mm: sensor.height },
    imageArea_mm: { width: r5(area.width), height: r5(area.height), aspect: take.aspect },
    principalPoint: 'image centre',
    pixels: 'square; intrinsics are in pixels of the rendered resolution',
    frames: cameraFrames(take).map((c, k) => {
      e.setFromQuaternion(q.fromArray(c.q), 'YXZ');
      // The render uses the vertical FOV and square pixels, so the horizontal FOV follows the pixel grid
      // (even-rounded widths make it differ from the sensor ratio by a hair).
      const vfov = verticalFovDeg(c.focal, take.sensor, take.aspect);
      const f = height / 2 / Math.tan((vfov * Math.PI) / 360);
      return {
        frame: k,
        time: r5(k / take.fps),
        position: c.p,
        quaternion: c.q,
        euler: { pan: r5(e.y * deg) || 0, tilt: r5(e.x * deg) || 0, roll: r5(e.z * deg) || 0 },
        focalLength_mm: c.focal,
        focusDistance_m: c.focus,
        fovVertical_deg: r5(vfov),
        fovHorizontal_deg: r5((2 * Math.atan(width / 2 / f) * 180) / Math.PI),
        intrinsics: { fx: r5(f), fy: r5(f), cx: width / 2, cy: height / 2 },
      };
    }),
  };
}

/**
 * Animated camera as binary glTF: one node "PrevizXR_Camera" with a perspective camera, keyed every frame.
 * glTF cannot animate field of view, so the camera uses the first frame's FOV and the per-frame
 * focal lengths are stored in the camera node's extras (and in camera.json).
 */
export async function cameraGlb(take: Take): Promise<Uint8Array> {
  const cams = cameraFrames(take);
  const rig = new Group();
  rig.name = 'PrevizXR_Camera';
  const area = imageArea(take.sensor, take.aspect);
  const cam = new PerspectiveCamera(verticalFovDeg(cams[0].focal, take.sensor, take.aspect), area.width / area.height, 0.05, 1000);
  cam.name = 'Lens';
  rig.add(cam);
  rig.position.fromArray(cams[0].p);
  rig.quaternion.fromArray(cams[0].q);
  rig.userData = {
    fps: take.fps,
    sensor: take.sensor,
    aspect: take.aspect,
    focalLength_mm: cams.map((c) => c.focal),
    focusDistance_m: cams.map((c) => c.focus),
  };
  const times = cams.map((_, k) => k / take.fps);
  const clip = new AnimationClip(take.name, -1, [
    new VectorKeyframeTrack('PrevizXR_Camera.position', times, cams.flatMap((c) => c.p)),
    new QuaternionKeyframeTrack('PrevizXR_Camera.quaternion', times, cams.flatMap((c) => c.q)),
  ]);
  const result = await new GLTFExporter().parseAsync(rig, { binary: true, animations: [clip] });
  return new Uint8Array(result as ArrayBuffer);
}
