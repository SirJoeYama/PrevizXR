import { Vector3, type Bone, type Camera, type Object3D } from 'three';
import type { Editor } from '../model/Editor';
import type { Vec3 } from '../model/scene';
import type { SceneSync } from '../sync/SceneSync';
import { JOINT_BONES, cocoKeypoints, normalizeBoneName, type BodyJoints, type JointName, type Point2 } from './pose';

type BoneMap = Record<JointName, Bone>;

/** Where along knee → foot bone the ankle sits when the foot bone is a detached IK target on the ground. */
const IK_ANKLE = 0.88;

/** Finds each actor's joint bones once per render and projects COCO-18 keypoints per frame. */
export class PoseExtractor {
  private readonly rigs: Array<{ id: string; bones: BoneMap }> = [];
  private readonly v = new Vector3();
  /** Actors whose skeleton could not be matched (reported in the manifest). */
  readonly unmatched: string[] = [];

  constructor(sync: SceneSync, editor: Editor) {
    for (const obj of editor.doc.objects) {
      if (obj.kind !== 'actor') continue;
      const root = sync.rootOf(obj.id);
      const bones = root ? findBones(root) : null;
      if (bones) this.rigs.push({ id: obj.id, bones });
      else this.unmatched.push(obj.name);
    }
  }

  get actorCount(): number {
    return this.rigs.length;
  }

  /** Keypoints in pixels for every actor (null where a point is behind the camera or beyond its range). */
  project(camera: Camera, width: number, height: number): Point2[][] {
    return this.rigs.map(({ bones }) =>
      cocoKeypoints(this.joints(bones)).map((p) => {
        this.v.fromArray(p).project(camera);
        if (this.v.z < -1 || this.v.z > 1) return null;
        return [((this.v.x + 1) / 2) * width, ((1 - this.v.y) / 2) * height];
      }),
    );
  }

  private joints(b: BoneMap): BodyJoints {
    const w = (bone: Bone): Vec3 => bone.getWorldPosition(this.v).toArray() as Vec3;
    const ankle = (knee: Bone, foot: Bone): Vec3 => {
      const k = w(knee);
      const f = w(foot);
      if (foot.parent === knee) return f;
      return [k[0] + (f[0] - k[0]) * IK_ANKLE, k[1] + (f[1] - k[1]) * IK_ANKLE, k[2] + (f[2] - k[2]) * IK_ANKLE];
    };
    return {
      head: w(b.head),
      rShoulder: w(b.rShoulder),
      rElbow: w(b.rElbow),
      rWrist: w(b.rWrist),
      lShoulder: w(b.lShoulder),
      lElbow: w(b.lElbow),
      lWrist: w(b.lWrist),
      rHip: w(b.rHip),
      rKnee: w(b.rKnee),
      rAnkle: ankle(b.rKnee, b.rAnkle),
      lHip: w(b.lHip),
      lKnee: w(b.lKnee),
      lAnkle: ankle(b.lKnee, b.lAnkle),
    };
  }
}

/** Matches bones to joints by name; null if any joint is missing. */
export function findBones(root: Object3D): BoneMap | null {
  const byName = new Map<string, Bone>();
  root.traverse((o) => {
    if ((o as Bone).isBone) {
      const n = normalizeBoneName(o.name);
      if (!byName.has(n)) byName.set(n, o as Bone);
    }
  });
  const out: Partial<BoneMap> = {};
  for (const [joint, candidates] of Object.entries(JOINT_BONES) as Array<[JointName, string[]]>) {
    const bone = candidates.map((c) => byName.get(c)).find(Boolean);
    if (!bone) return null;
    out[joint] = bone;
  }
  return out as BoneMap;
}
