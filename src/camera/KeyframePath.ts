import { BufferGeometry, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, OctahedronGeometry, Vector3 } from 'three';
import type { Editor } from '../model/Editor';
import { sampleKeyframes } from '../model/take';

const SAMPLES_PER_SECOND = 20;

/** Editor-only line showing the keyframed dolly/crane path, with a marker per keyframe. */
export class KeyframePath {
  readonly group = new Group();
  private sig = '';
  private readonly lineMaterial = new LineBasicMaterial({ color: 0x7cc4ff });
  private readonly markerGeometry = new OctahedronGeometry(0.05);
  private readonly markerMaterial = new MeshBasicMaterial({ color: 0x7cc4ff });

  constructor(private readonly editor: Editor) {
    this.group.name = 'CameraPath';
    this.group.userData.helper = true;
    editor.subscribe((c) => c === 'doc' && this.update());
    this.update();
  }

  private update(): void {
    const keys = this.editor.doc.camera.keyframes;
    const sig = JSON.stringify(keys);
    if (sig === this.sig) return;
    this.sig = sig;
    for (const child of [...this.group.children]) {
      child.removeFromParent();
      if (child instanceof Line) child.geometry.dispose();
    }
    for (const k of keys) {
      const m = new Mesh(this.markerGeometry, this.markerMaterial);
      m.position.fromArray(k.position);
      m.raycast = () => {};
      this.group.add(m);
    }
    if (keys.length < 2) return;
    const end = keys[keys.length - 1].time;
    const n = Math.max(2, Math.ceil(end * SAMPLES_PER_SECOND));
    const points: Vector3[] = [];
    for (let i = 0; i <= n; i++) points.push(new Vector3().fromArray(sampleKeyframes(keys, (end * i) / n).p));
    const line = new Line(new BufferGeometry().setFromPoints(points), this.lineMaterial);
    line.raycast = () => {};
    this.group.add(line);
  }
}
