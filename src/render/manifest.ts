import type { CreditLine } from '../assets/credits';
import { SENSORS } from '../camera/lens';
import type { SceneDoc } from '../model/scene';
import type { Take } from '../model/take';
import { COCO_COLORS, COCO_KEYPOINTS, COCO_LIMBS } from './pose';
import { PASS_INFO, type PassId } from './plan';

export interface PassFiles {
  pass: PassId;
  /** mp4 file name, or the PNG folder. */
  path: string;
  format: 'mp4' | 'png-sequence';
}

export interface ManifestInput {
  take: Take;
  doc: Readonly<SceneDoc>;
  width: number;
  height: number;
  passes: PassFiles[];
  depth: { near: number; far: number };
  credits: CreditLine[];
  /** Actors without a matchable humanoid skeleton (missing from the pose pass). */
  poseUnmatched: string[];
  appVersion: string;
}

/** Describes everything in a render bundle, including how to read each pass. */
export function buildManifest(m: ManifestInput) {
  const { take } = m;
  const encoding: Record<PassId, unknown> = {
    clay: { lighting: 'neutral studio light (scene lights ignored)', material: 'uniform grey', colorSpace: 'sRGB, ACES filmic tone mapping' },
    color_id: {
      background: '#000000 (includes the floor)',
      colorSpace: 'exact sRGB bytes (exact only in PNG; MP4 is lossy)',
      objects: take.objects.map((o) => ({ id: o.id, name: o.name, kind: o.kind, color: o.color })),
    },
    depth: {
      type: 'linear planar view-space depth',
      mapping: 'value = (far - z) / (far - near), clamped; 1 (white) = near, 0 (black) = far or background',
      near_m: m.depth.near,
      far_m: m.depth.far,
    },
    normals: {
      space: 'view (camera) space, OpenGL convention: +X right, +Y up, +Z toward the camera',
      mapping: 'rgb = normal * 0.5 + 0.5',
      background: '#000000',
    },
    pose: {
      format: 'OpenPose COCO-18 (body only), drawn like controlnet_aux on black',
      keypoints: COCO_KEYPOINTS,
      limbs: COCO_LIMBS,
      colors: COCO_COLORS,
      notes: 'Joints come from the actors\' skeletons; eyes, nose and ears are estimated from the head and body orientation. Occluded joints are still drawn.',
      unmatchedActors: m.poseUnmatched,
    },
  };
  return {
    format: 'previzxr.render',
    version: 1,
    generator: `PrevizXR ${m.appVersion}`,
    createdAt: new Date().toISOString(),
    scene: { id: m.doc.id, name: m.doc.name, file: 'scene.json' },
    take: { id: take.id, name: take.name, source: take.source, smoothing: take.smoothing, file: 'take.json' },
    video: {
      width: m.width,
      height: m.height,
      fps: take.fps,
      frameCount: take.frameCount,
      duration_s: take.frameCount / take.fps,
      aspect: take.aspect,
      sensor: SENSORS[take.sensor].label,
      frameZeroTime: 0,
    },
    passes: m.passes.map((p) => ({ id: p.pass, path: p.path, format: p.format, description: PASS_INFO[p.pass].description, encoding: encoding[p.pass] })),
    camera: { json: 'camera.json', gltf: 'camera.glb' },
    credits: { file: 'CREDITS.txt', models: m.credits },
  };
}

export function creditsText(credits: CreditLine[], sceneName: string): string {
  const lines = [
    `Models used in "${sceneName}"`,
    '',
    ...(credits.length ? credits.map((c) => `- "${c.title}" by ${c.author}, ${c.licence}: ${c.url}`) : ['(no third-party models)']),
    '',
    'CC-BY models require crediting the author wherever you publish work made with them.',
    'Rendered with PrevizXR (MIT): https://github.com/SirJoeYama/PrevizXR',
    '',
  ];
  return lines.join('\n');
}
