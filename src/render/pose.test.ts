import { describe, expect, it } from 'vitest';
import { COCO_COLORS, COCO_KEYPOINTS, COCO_LIMBS, JOINT_BONES, cocoKeypoints, normalizeBoneName, type BodyJoints } from './pose';

// Joint positions of the bundled "Man" actor at rest (facing +Z), measured in the app.
const man: BodyJoints = {
  head: [0, 1.554, 0],
  rShoulder: [-0.175, 1.393, 0.02],
  rElbow: [-0.217, 1.147, -0.004],
  rWrist: [-0.24, 0.842, 0.002],
  lShoulder: [0.178, 1.393, 0.015],
  lElbow: [0.217, 1.147, -0.004],
  lWrist: [0.24, 0.842, 0.002],
  rHip: [-0.117, 0.781, 0.01],
  rKnee: [-0.134, 0.479, 0.058],
  rAnkle: [-0.14, 0.07, -0.05],
  lHip: [0.117, 0.781, 0.01],
  lKnee: [0.134, 0.479, 0.058],
  lAnkle: [0.14, 0.07, -0.05],
};

describe('COCO-18 tables', () => {
  it('has 18 keypoints, 17 limbs and 18 colors', () => {
    expect(COCO_KEYPOINTS).toHaveLength(18);
    expect(COCO_LIMBS).toHaveLength(17);
    expect(COCO_COLORS).toHaveLength(18);
    for (const [a, b] of COCO_LIMBS) expect(Math.max(a, b)).toBeLessThan(18);
  });
});

describe('cocoKeypoints', () => {
  const kp = cocoKeypoints(man);

  it('passes bone joints through and puts the neck between the shoulders', () => {
    expect(kp[2]).toEqual(man.rShoulder);
    expect(kp[10]).toEqual(man.rAnkle);
    expect(kp[1][0]).toBeCloseTo(0.0015, 4);
    expect(kp[1][1]).toBeCloseTo(1.393, 3);
  });

  it('places the face on the front of the head, above the neck', () => {
    const [nose, , , , , , , , , , , , , , rEye, lEye, rEar, lEar] = kp;
    expect(nose[2]).toBeGreaterThan(man.head[2] + 0.05); // in front (+Z, the way he faces)
    expect(nose[1]).toBeGreaterThan(man.head[1]);
    expect(nose[1]).toBeLessThan(1.78); // below the top of the head
    expect(rEye[0]).toBeLessThan(0); // the person's right is -X when facing +Z
    expect(lEye[0]).toBeGreaterThan(0);
    expect(rEye[1]).toBeGreaterThan(nose[1]);
    expect(rEar[0]).toBeLessThan(rEye[0]);
    expect(lEar[0]).toBeGreaterThan(lEye[0]);
  });

  it('turns the face with the body', () => {
    // Same body rotated 180° about Y: faces -Z, right side at +X.
    const turned = Object.fromEntries(Object.entries(man).map(([k, p]) => [k, [-p[0], p[1], -p[2]]])) as unknown as BodyJoints;
    const t = cocoKeypoints(turned);
    expect(t[0][2]).toBeLessThan(turned.head[2] - 0.05);
    expect(t[14][0]).toBeGreaterThan(0);
  });
});

describe('bone names', () => {
  it('normalizes Blender, glTF-sanitized and Mixamo names to the same candidates', () => {
    expect(normalizeBoneName('UpperArm.R')).toBe('upperarmr');
    expect(normalizeBoneName('UpperArmR')).toBe('upperarmr');
    expect(normalizeBoneName('mixamorig:RightForeArm')).toBe('rightforearm');
    expect(JOINT_BONES.rElbow).toContain(normalizeBoneName('mixamorig:RightForeArm'));
    expect(JOINT_BONES.rWrist).toContain(normalizeBoneName('Palm.R'));
  });
});
