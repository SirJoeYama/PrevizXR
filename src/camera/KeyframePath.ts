import {
  BufferGeometry,
  ConeGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
  type Sprite,
} from 'three';
import type { Editor } from '../model/Editor';
import { sampleKeyframes } from '../model/take';
import { drawLabel, makeLabel } from '../sync/labels';

const SAMPLES_PER_SECOND = 20;
const COLOR = 0x7cc4ff;
const HIGHLIGHT = 0xffb547;
const LABEL_COLOR = '#7cc4ff';
const LABEL_HIGHLIGHT = '#ffb547';
const PICK_RADIUS = 0.08;

interface Marker {
  group: Group;
  cone: Mesh<ConeGeometry, MeshBasicMaterial>;
  label: Sprite;
}

/**
 * Editor-only line showing the keyframed dolly/crane path, with a numbered marker per keyframe.
 * Markers point where the camera looks and can be picked (VR grabs them to move keys); they are
 * updated in place so a marker being dragged survives the model updates it causes.
 */
export class KeyframePath {
  readonly group = new Group();
  /** Pickable markers; each carries `userData.keyIndex`. */
  readonly markers = new Group();
  private readonly list: Marker[] = [];
  private line: Line | null = null;
  private sig = '';
  private highlighted: number | null = null;
  private readonly lineMaterial = new LineBasicMaterial({ color: COLOR });
  /** Pyramid with its apex at the key, opening along -Z (the camera's view direction). */
  private readonly coneGeometry = new ConeGeometry(0.045, 0.09, 4, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).translate(0, 0, -0.045);
  private readonly pickGeometry = new SphereGeometry(PICK_RADIUS, 8, 6);
  private readonly pickMaterial = new MeshBasicMaterial({ visible: false });

  constructor(private readonly editor: Editor) {
    this.group.name = 'CameraPath';
    this.group.userData.helper = true;
    this.group.add(this.markers);
    editor.subscribe((c) => c === 'doc' && this.update());
    this.update();
  }

  /** Index of the keyframe whose marker contains `obj`, or null. */
  keyIndexOf(obj: Object3D | null): number | null {
    for (let o = obj; o && o !== this.markers; o = o.parent) if (typeof o.userData.keyIndex === 'number') return o.userData.keyIndex;
    return null;
  }

  /** The marker of keyframe i (its world pose is the key's pose). */
  marker(i: number): Object3D | undefined {
    return this.list[i]?.group;
  }

  /** Highlights one marker (hovered or grabbed in VR); null clears. */
  highlight(i: number | null): void {
    if (i === this.highlighted) return;
    this.paint(this.highlighted, false);
    this.highlighted = i;
    this.paint(i, true);
  }

  private paint(i: number | null, on: boolean): void {
    const m = i === null ? undefined : this.list[i];
    if (!m) return;
    m.cone.material.color.set(on ? HIGHLIGHT : COLOR);
    drawLabel(m.label, String(i! + 1), on ? LABEL_HIGHLIGHT : LABEL_COLOR);
    m.label.scale.multiplyScalar(0.6);
  }

  private update(): void {
    const keys = this.editor.doc.camera.keyframes;
    const sig = JSON.stringify(keys);
    if (sig === this.sig) return;
    this.sig = sig;

    while (this.list.length < keys.length) this.list.push(this.createMarker(this.list.length));
    while (this.list.length > keys.length) {
      const m = this.list.pop()!;
      m.group.removeFromParent();
      m.cone.material.dispose();
      m.label.material.map?.dispose();
      m.label.material.dispose();
    }
    if (this.highlighted !== null && this.highlighted >= keys.length) this.highlighted = null;
    keys.forEach((k, i) => {
      const g = this.list[i].group;
      g.position.fromArray(k.position);
      g.quaternion.fromArray(k.rotation);
    });

    if (this.line) {
      this.line.removeFromParent();
      this.line.geometry.dispose();
      this.line = null;
    }
    if (keys.length < 2) return;
    const end = keys[keys.length - 1].time;
    const n = Math.max(2, Math.ceil(end * SAMPLES_PER_SECOND));
    const points: Vector3[] = [];
    for (let i = 0; i <= n; i++) points.push(new Vector3().fromArray(sampleKeyframes(keys, (end * i) / n).p));
    this.line = new Line(new BufferGeometry().setFromPoints(points), this.lineMaterial);
    this.line.raycast = () => {};
    this.group.add(this.line);
  }

  private createMarker(i: number): Marker {
    const group = new Group();
    group.userData.keyIndex = i;
    const cone = new Mesh(this.coneGeometry, new MeshBasicMaterial({ color: COLOR }));
    cone.raycast = () => {};
    const pick = new Mesh(this.pickGeometry, this.pickMaterial);
    const label = makeLabel(String(i + 1), LABEL_COLOR);
    label.scale.multiplyScalar(0.6);
    label.position.y = 0.09;
    group.add(cone, pick, label);
    this.markers.add(group);
    return { group, cone, label };
  }
}
