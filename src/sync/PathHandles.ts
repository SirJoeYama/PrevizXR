import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  type Object3D,
} from 'three';
import type { Editor } from '../model/Editor';
import { editablePoints, type PathPoint, type PathPointRef } from '../model/pathEdit';
import { CAMERA_ID } from '../model/scene';

const ANCHOR_RADIUS = 0.055;
const HANDLE_RADIUS = 0.032;
/** Invisible pick spheres, larger than the dots so they are easy to point at in VR. */
const PICK_RADIUS = 0.08;
const HANDLE_COLOR = 0xe6e8ee;
const AUTO_COLOR = 0x8b93a5;
const CAMERA_COLOR = 0x7cc4ff;
const HIGHLIGHT = 0xffb547;

interface Dot {
  group: Group;
  mesh: Mesh<SphereGeometry, MeshBasicMaterial>;
  point: PathPoint | null;
}

/**
 * Editable Bézier points of the selected path: waypoint anchors and in/out handles of the selected object,
 * or the handles of the camera path when the camera is selected (its keys have their own markers).
 * Dots are pooled and updated in place, so one being dragged survives the model updates the drag causes.
 * Each pickable carries `userData.pathRef`.
 */
export class PathHandles {
  readonly group = new Group();
  /** Pick targets (raycast this). */
  readonly pickables = new Group();
  private readonly dots: Dot[] = [];
  private readonly lines: LineSegments;
  private sig = '';
  private highlighted: string | null = null;
  private readonly anchorGeometry = new SphereGeometry(ANCHOR_RADIUS, 14, 10);
  private readonly handleGeometry = new SphereGeometry(HANDLE_RADIUS, 12, 8);
  private readonly pickGeometry = new SphereGeometry(PICK_RADIUS, 8, 6);
  private readonly pickMaterial = new MeshBasicMaterial({ visible: false });

  constructor(private readonly editor: Editor) {
    this.group.name = 'PathHandles';
    this.group.userData.helper = true;
    this.lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: HANDLE_COLOR, transparent: true, opacity: 0.7 }));
    this.lines.raycast = () => {};
    this.group.add(this.lines, this.pickables);
    editor.subscribe((c) => (c === 'doc' || c === 'selection') && this.update());
    this.update();
  }

  /** The path point a picked object belongs to, or null. */
  refOf(obj: Object3D | null): PathPointRef | null {
    for (let o = obj; o && o !== this.pickables; o = o.parent) {
      const ref = o.userData.pathRef as PathPointRef | undefined;
      if (ref) return { ...ref };
    }
    return null;
  }

  /** The dot of a path point (its world position is the point's). */
  objectFor(ref: PathPointRef): Object3D | undefined {
    return this.dots.find((d) => d.point && sameRef(d.point, ref))?.group;
  }

  /** Highlights one point (hovered, grabbed or being edited); null clears. */
  highlight(ref: PathPointRef | null): void {
    const key = ref ? refKey(ref) : null;
    if (key === this.highlighted) return;
    this.highlighted = key;
    for (const d of this.dots) if (d.point) this.paint(d);
  }

  private owner(): string | null {
    const id = this.editor.selectedId;
    if (id === CAMERA_ID) return this.editor.doc.camera.keyframes.length >= 2 ? id : null;
    return id;
  }

  private update(): void {
    const owner = this.owner();
    const points = owner ? editablePoints(this.editor.doc, owner, owner !== CAMERA_ID) : [];
    const sig = JSON.stringify(points);
    if (sig === this.sig) return;
    this.sig = sig;

    while (this.dots.length < points.length) this.dots.push(this.createDot());
    this.dots.forEach((d, i) => {
      const p = points[i] ?? null;
      d.point = p;
      // Raycasts ignore visibility: unused dots leave the scene graph instead of hiding.
      if (!p) {
        d.group.removeFromParent();
        d.group.userData.pathRef = undefined;
        return;
      }
      if (!d.group.parent) this.pickables.add(d.group);
      d.group.userData.pathRef = { owner: p.owner, index: p.index, part: p.part } satisfies PathPointRef;
      d.group.position.fromArray(p.position);
      d.mesh.geometry = p.part === 'anchor' ? this.anchorGeometry : this.handleGeometry;
      this.paint(d);
    });

    const pos: number[] = [];
    for (const p of points) if (p.part !== 'anchor') pos.push(...p.anchor, ...p.position);
    this.lines.geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.lines.geometry.computeBoundingSphere();
    this.lines.visible = pos.length > 0;
  }

  private paint(d: Dot): void {
    const p = d.point!;
    const color =
      this.highlighted === refKey(p)
        ? HIGHLIGHT
        : p.part === 'anchor'
          ? (this.editor.find(p.owner)?.color ?? HANDLE_COLOR)
          : p.owner === CAMERA_ID && !p.auto
            ? CAMERA_COLOR
            : p.auto
              ? AUTO_COLOR
              : HANDLE_COLOR;
    d.mesh.material.color.set(color);
  }

  private createDot(): Dot {
    const group = new Group();
    const mesh = new Mesh(this.handleGeometry, new MeshBasicMaterial({ color: HANDLE_COLOR, depthTest: false, transparent: true }));
    mesh.renderOrder = 25;
    mesh.raycast = () => {};
    group.add(mesh, new Mesh(this.pickGeometry, this.pickMaterial));
    this.pickables.add(group);
    return { group, mesh, point: null };
  }
}

function refKey(r: PathPointRef): string {
  return `${r.owner}|${r.index}|${r.part}`;
}

export function sameRef(a: PathPointRef, b: PathPointRef): boolean {
  return a.owner === b.owner && a.index === b.index && a.part === b.part;
}
