import type { Vec3 } from '../model/scene';

/**
 * OpenPose COCO-18 skeletons from actor bones. Pure math and drawing, no Three.js.
 *
 * Keypoint order: 0 nose, 1 neck, 2 R shoulder, 3 R elbow, 4 R wrist, 5 L shoulder, 6 L elbow, 7 L wrist,
 * 8 R hip, 9 R knee, 10 R ankle, 11 L hip, 12 L knee, 13 L ankle, 14 R eye, 15 L eye, 16 R ear, 17 L ear.
 * "Right" is the person's right. Neck is the midpoint of the shoulders, as in OpenPose.
 * Eyes, nose and ears have no bones: they are placed on the head from the body's orientation
 * and a head size proportional to the torso.
 */

export const COCO_KEYPOINTS = [
  'nose', 'neck', 'r_shoulder', 'r_elbow', 'r_wrist', 'l_shoulder', 'l_elbow', 'l_wrist',
  'r_hip', 'r_knee', 'r_ankle', 'l_hip', 'l_knee', 'l_ankle', 'r_eye', 'l_eye', 'r_ear', 'l_ear',
] as const;

/** Limb pairs (keypoint indices) in OpenPose drawing order. */
export const COCO_LIMBS: Array<[number, number]> = [
  [1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10],
  [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17],
];

/** Standard OpenPose colors, indexed by keypoint (and by limb for limbs). */
export const COCO_COLORS: Array<[number, number, number]> = [
  [255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0], [0, 255, 85],
  [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255],
  [255, 0, 170], [255, 0, 85],
];

/** Joints read from the skeleton (world positions). */
export interface BodyJoints {
  head: Vec3;
  rShoulder: Vec3;
  rElbow: Vec3;
  rWrist: Vec3;
  lShoulder: Vec3;
  lElbow: Vec3;
  lWrist: Vec3;
  rHip: Vec3;
  rKnee: Vec3;
  rAnkle: Vec3;
  lHip: Vec3;
  lKnee: Vec3;
  lAnkle: Vec3;
}

export type JointName = keyof BodyJoints;

/**
 * Bone-name candidates per joint, compared after lowercasing and removing non-alphanumerics
 * (GLTFLoader strips dots, so "UpperArm.R" arrives as "UpperArmR"). Covers Quaternius and Mixamo-style rigs.
 */
export const JOINT_BONES: Record<JointName, string[]> = {
  head: ['head'],
  rShoulder: ['upperarmr', 'rightarm', 'upperarmright', 'rupperarm'],
  rElbow: ['lowerarmr', 'rightforearm', 'forearmr', 'lowerarmright'],
  rWrist: ['palmr', 'wristr', 'righthand', 'handr'],
  lShoulder: ['upperarml', 'leftarm', 'upperarmleft', 'lupperarm'],
  lElbow: ['lowerarml', 'leftforearm', 'forearml', 'lowerarmleft'],
  lWrist: ['palml', 'wristl', 'lefthand', 'handl'],
  rHip: ['upperlegr', 'rightupleg', 'thighr', 'upperlegright'],
  rKnee: ['lowerlegr', 'rightleg', 'shinr', 'calfr', 'lowerlegright'],
  rAnkle: ['footr', 'rightfoot', 'footright'],
  lHip: ['upperlegl', 'leftupleg', 'thighl', 'upperlegleft'],
  lKnee: ['lowerlegl', 'leftleg', 'shinl', 'calfl', 'lowerlegleft'],
  lAnkle: ['footl', 'leftfoot', 'footleft'],
};

export function normalizeBoneName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^mixamorig\d*/, '');
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const mid = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1));
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const combine = (base: Vec3, ...terms: Array<[Vec3, number]>): Vec3 => terms.reduce((p, [v, s]) => add(p, scale(v, s)), base);

/** The 18 COCO keypoints (world space) for one body. */
export function cocoKeypoints(j: BodyJoints): Vec3[] {
  const neck = mid(j.rShoulder, j.lShoulder);
  const midHip = mid(j.rHip, j.lHip);
  const right = norm(sub(j.rShoulder, j.lShoulder)); // toward the person's right
  const up = norm(sub(neck, midHip));
  const forward = norm(cross(up, right)); // the way the person faces
  const hs = 0.38 * len(sub(neck, midHip)); // head height ≈ 0.38 × torso length
  const center = combine(j.head, [up, 0.45 * hs]);
  const nose = combine(center, [forward, 0.45 * hs], [up, -0.05 * hs]);
  const eye = (side: number) => combine(center, [up, 0.08 * hs], [forward, 0.38 * hs], [right, side * 0.15 * hs]);
  const ear = (side: number) => combine(center, [up, 0.02 * hs], [forward, -0.02 * hs], [right, side * 0.42 * hs]);
  return [
    nose, neck, j.rShoulder, j.rElbow, j.rWrist, j.lShoulder, j.lElbow, j.lWrist,
    j.rHip, j.rKnee, j.rAnkle, j.lHip, j.lKnee, j.lAnkle, eye(1), eye(-1), ear(1), ear(-1),
  ];
}

/** A keypoint in pixels, or null when it is behind the camera. */
export type Point2 = [number, number] | null;

/**
 * Draws skeletons the way OpenPose / controlnet_aux does: limbs as 60%-strength sticks, then joints as
 * full-color dots. Sizes follow the 512 px reference (stick width 4, dot radius 4) scaled to the frame height.
 */
export function drawPoses(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, people: Point2[][], width: number, height: number): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  const s = Math.max(1, height / 512);
  ctx.lineCap = 'round';
  ctx.lineWidth = 8 * s;
  for (const kp of people) {
    COCO_LIMBS.forEach(([a, b], i) => {
      const pa = kp[a];
      const pb = kp[b];
      if (!pa || !pb) return;
      const [r, g, bl] = COCO_COLORS[i];
      ctx.strokeStyle = `rgba(${r},${g},${bl},0.6)`;
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
    });
  }
  for (const kp of people) {
    kp.forEach((p, i) => {
      if (!p) return;
      const [r, g, b] = COCO_COLORS[i];
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 4 * s, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}
