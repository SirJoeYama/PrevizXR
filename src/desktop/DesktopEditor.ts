import { Box3, Plane, Raycaster, Vector2, Vector3, type Object3D } from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { App } from '../app/App';
import type { Playback } from '../app/Playback';
import { deleteSelected, duplicateSelected, readTransform, snapToFloor } from '../interaction/ops';
import type { KeyframePath } from '../camera/KeyframePath';
import type { Editor } from '../model/Editor';
import { movePathPoint, type PathPointRef } from '../model/pathEdit';
import { CAMERA_ID, addWaypoint, type Vec3 } from '../model/scene';
import type { PathHandles } from '../sync/PathHandles';
import type { SceneSync } from '../sync/SceneSync';
import { announce } from '../ui/announce';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

const CLICK_SLOP_PX = 5;
const UP = new Vector3(0, 1, 0);
const floorPlane = new Plane(UP.clone(), 0);
/** Below this view steepness a horizontal drag plane is too grazing to use; drag vertically instead. */
const MIN_PLANE_GRAZE = 0.15;

/**
 * Desktop scene editing: click to select, TransformControls gizmo, keyboard shortcuts,
 * waypoint drawing (click the floor) while path mode is on, and Bézier path editing: drag a waypoint,
 * handle or camera key directly (across the ground; Shift: up and down), or click it and use the gizmo.
 */
export class DesktopEditor {
  readonly gizmo: TransformControls;
  /** When true, clicks on the floor add waypoints to the selected object's path. */
  pathMode = false;
  /** Returns true while another mode (camera view) owns the mouse: no picking, no gizmo. */
  suspended: () => boolean = () => false;
  /** What Space does (preview by default; Studio routes it to take playback when busy). */
  onSpace: () => void = () => this.playback.toggle();
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private down: { x: number; y: number; onGizmo: boolean } | null = null;
  private readonly listeners = new Set<() => void>();
  /** Path point being edited with the gizmo (instead of the selected object), if any. */
  private activePath: PathPointRef | null = null;
  /** Gizmo mode for objects; path points always translate. */
  private userMode: GizmoMode = 'translate';
  /** A path point being dragged directly with the mouse. */
  private drag: { ref: PathPointRef; plane: Plane; offset: Vector3; pointerId: number } | null = null;
  private hovering = false;

  constructor(
    private readonly app: App,
    private readonly editor: Editor,
    private readonly sync: SceneSync,
    private readonly playback: Playback,
    private readonly keyPath: KeyframePath,
    private readonly pathHandles: PathHandles,
  ) {
    const dom = app.renderer.domElement;
    this.gizmo = new TransformControls(app.camera, dom);
    this.gizmo.setSize(0.9);
    const helper = this.gizmo.getHelper();
    helper.traverse((o) => (o.userData.helper = true));
    app.scene.add(helper);
    app.addEditorOnly(helper);

    this.gizmo.addEventListener('dragging-changed', (e) => {
      app.desktop.orbit.enabled = !e.value;
      if (e.value) editor.begin();
      else editor.commit();
    });
    this.gizmo.addEventListener('objectChange', () => {
      const ref = this.activePath;
      if (ref) {
        const target = this.gizmo.object;
        if (target) {
          const p = target.position.toArray() as Vec3;
          editor.transient((d) => movePathPoint(d, ref, p));
        }
        return;
      }
      const id = editor.selectedId;
      const root = id ? sync.rootOf(id) : undefined;
      if (id && root) editor.setTransform(id, readTransform(root), true);
    });

    editor.subscribe((c) => {
      if (c === 'selection' || c === 'doc') this.attach();
      if (c === 'selection' && this.pathMode && !editor.selected) this.setPathMode(false);
      if (c === 'selection' && this.activePath && this.activePath.owner !== editor.selectedId) this.setActivePath(null);
    });
    playback.onChange(() => this.attach());
    app.xrSession.addEventListener('change', () => this.attach());

    // Capture phase: a press on a path point must reach us before the orbit controls and the gizmo.
    dom.addEventListener('pointerdown', (e) => this.startPointDrag(e), { capture: true });
    dom.addEventListener('pointermove', (e) => this.onPointerMove(e));
    dom.addEventListener('pointerup', (e) => this.endPointDrag(e), { capture: true });
    dom.addEventListener('pointercancel', (e) => this.endPointDrag(e), { capture: true });
    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.down = { x: e.clientX, y: e.clientY, onGizmo: this.gizmo.axis !== null };
    });
    dom.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || d.onGizmo || e.button !== 0 || this.suspended()) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return;
      this.onClick(e);
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  get mode(): GizmoMode {
    return this.userMode;
  }

  setMode(mode: GizmoMode): void {
    if (mode !== this.userMode) announce({ translate: 'Move', rotate: 'Rotate', scale: 'Scale' }[mode] + ' mode');
    this.userMode = mode;
    this.setActivePath(null);
    this.applyGizmoMode();
    this.emit();
  }

  private applyGizmoMode(): void {
    const mode = this.activePath ? 'translate' : this.userMode;
    this.gizmo.setMode(mode);
    this.gizmo.setSpace(mode === 'translate' ? 'world' : 'local');
  }

  /** Edits one path point with the gizmo (null goes back to the selected object). */
  private setActivePath(ref: PathPointRef | null): void {
    if (!ref && !this.activePath) return;
    this.activePath = ref;
    this.pathHandles.highlight(ref);
    this.keyPath.highlight(ref?.owner === CAMERA_ID && ref.part === 'anchor' ? ref.index : null);
    if (ref) announce(ref.part === 'anchor' ? 'Editing a path point: drag the gizmo, Esc to finish' : 'Editing a curve handle: drag the gizmo, Esc to finish');
    this.applyGizmoMode();
    this.attach();
  }

  setPathMode(on: boolean): void {
    const was = this.pathMode;
    this.pathMode = on && !!this.editor.selected;
    if (this.pathMode) this.setActivePath(null);
    if (this.pathMode !== was) announce(this.pathMode ? 'Drawing path: click the floor to add waypoints, Escape to finish' : 'Path drawing off');
    this.app.renderer.domElement.style.cursor = this.pathMode ? 'crosshair' : '';
    this.emit();
  }

  /** Floor point under the middle of the view, for placing new objects. */
  spawnPoint(): { at: Vec3; yaw: number } {
    const target = this.app.desktop.orbit.target;
    const cam = this.app.camera.position;
    const at: Vec3 = [round(target.x), 0, round(target.z)];
    return { at, yaw: Math.atan2(cam.x - at[0], cam.z - at[2]) };
  }

  /** Orbits the view around the selected object, framing it. */
  focusSelected(): void {
    const id = this.editor.selectedId;
    const root = id ? this.sync.rootOf(id) : undefined;
    if (!root) return;
    const box = new Box3().setFromObject(root, true);
    const center = box.getCenter(new Vector3());
    const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.5);
    const orbit = this.app.desktop.orbit;
    const dir = this.app.camera.position.clone().sub(orbit.target).normalize();
    orbit.target.copy(center);
    this.app.camera.position.copy(center).addScaledVector(dir, radius * 2.8);
    orbit.update();
  }

  /** Re-evaluates whether the gizmo should be attached (call when a mode changes). */
  refresh(): void {
    this.attach();
  }

  private attach(): void {
    const id = this.editor.selectedId;
    const ref = this.activePath;
    const root = ref ? this.pointObject(ref) : id ? this.sync.rootOf(id) : undefined;
    const usable = root && !this.playback.playing && !this.app.xrSession.presenting && !this.suspended();
    if (usable) {
      if (this.gizmo.object !== root) this.gizmo.attach(root);
    } else if (this.gizmo.object) {
      this.gizmo.detach();
    }
  }

  /** The 3D object standing for a path point (a handle dot, or a camera key marker). */
  private pointObject(ref: PathPointRef): Object3D | undefined {
    return ref.owner === CAMERA_ID && ref.part === 'anchor' ? this.keyPath.marker(ref.index) : this.pathHandles.objectFor(ref);
  }

  private setRay(e: PointerEvent): void {
    const rect = this.app.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.app.camera);
  }

  /** Path point under the ray (waypoints and handles of the selected path, then camera keys). */
  private pickPathPoint(): PathPointRef | null {
    const pathHit = this.raycaster.intersectObject(this.pathHandles.pickables, true)[0];
    const keyHit = this.raycaster.intersectObject(this.keyPath.markers, true)[0];
    if (pathHit && (!keyHit || pathHit.distance <= keyHit.distance)) return this.pathHandles.refOf(pathHit.object);
    const keyIndex = keyHit ? this.keyPath.keyIndexOf(keyHit.object) : null;
    return keyIndex === null ? null : { owner: CAMERA_ID, index: keyIndex, part: 'anchor' };
  }

  /** Press on a path point: drag it across a horizontal plane at its height (Shift: a vertical plane facing the view). */
  private startPointDrag(e: PointerEvent): void {
    if (e.button !== 0 || this.pathMode || this.suspended() || this.playback.playing || this.app.xrSession.presenting) return;
    if (this.gizmo.dragging || this.gizmo.axis !== null) return; // the gizmo's own arrows win
    this.setRay(e);
    const ref = this.pickPathPoint();
    if (!ref) return;
    e.stopImmediatePropagation(); // keep the orbit controls and the gizmo out of this press
    if (ref.owner === CAMERA_ID) this.editor.select(CAMERA_ID);
    this.setActivePath(ref);
    const target = this.pointObject(ref);
    if (!target) return;
    const p = target.getWorldPosition(new Vector3());
    const plane = new Plane();
    if (e.shiftKey || Math.abs(this.raycaster.ray.direction.y) < MIN_PLANE_GRAZE) {
      const n = this.raycaster.ray.direction.clone().setY(0);
      if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
      plane.setFromNormalAndCoplanarPoint(n.normalize(), p);
    } else {
      plane.setFromNormalAndCoplanarPoint(UP, p);
    }
    const hit = this.raycaster.ray.intersectPlane(plane, new Vector3());
    if (!hit) return;
    this.drag = { ref, plane, offset: p.sub(hit), pointerId: e.pointerId };
    this.app.renderer.domElement.setPointerCapture(e.pointerId);
    this.editor.begin();
  }

  private onPointerMove(e: PointerEvent): void {
    const drag = this.drag;
    if (drag) {
      this.setRay(e);
      const hit = this.raycaster.ray.intersectPlane(drag.plane, new Vector3());
      if (!hit) return;
      const p = hit.add(drag.offset).toArray() as Vec3;
      this.editor.transient((d) => movePathPoint(d, drag.ref, p));
      return;
    }
    // Hover feedback: a grab cursor over draggable path points.
    if (e.buttons || this.pathMode || this.suspended()) return;
    this.setRay(e);
    const over = this.pickPathPoint() !== null;
    if (over !== this.hovering) {
      this.hovering = over;
      this.app.renderer.domElement.style.cursor = over ? 'grab' : '';
    }
  }

  private endPointDrag(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    e.stopImmediatePropagation();
    const dom = this.app.renderer.domElement;
    if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
    this.drag = null;
    this.down = null;
    this.editor.commit();
  }

  private onClick(e: PointerEvent): void {
    this.setRay(e);

    if (this.pathMode) {
      const sel = this.editor.selected;
      const hit = this.raycaster.ray.intersectPlane(floorPlane, new Vector3());
      if (sel && hit) this.editor.update(sel.id, (o) => addWaypoint(o, hit.x, hit.z));
      return;
    }

    // Path points (waypoints, handles, camera keys) sit on top of objects: try them first.
    const ref = this.pickPathPoint();
    if (ref) {
      if (ref.owner === CAMERA_ID) this.editor.select(CAMERA_ID);
      this.setActivePath(ref);
      return;
    }
    this.setActivePath(null);
    const hits = this.raycaster.intersectObjects(this.sync.pickRoots, true);
    const id = hits.length ? this.sync.objectIdOf(hits[0].object) : null;
    this.editor.select(id);
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
    if (this.app.xrSession.presenting) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && key === 'z') {
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && key === 'y') {
      this.redo();
    } else if (mod && key === 'd') {
      duplicateSelected(this.editor);
    } else if (mod) {
      return;
    } else if (key === 'delete' || key === 'backspace') {
      deleteSelected(this.editor);
    } else if (key === '1') {
      this.setMode('translate');
    } else if (key === '2') {
      this.setMode('rotate');
    } else if (key === '3') {
      this.setMode('scale');
    } else if (key === 'g') {
      if (this.editor.selectedId) snapToFloor(this.editor, this.sync, this.editor.selectedId);
    } else if (key === 'f') {
      this.focusSelected();
    } else if (key === 'p') {
      this.setPathMode(!this.pathMode);
    } else if (key === ' ') {
      this.onSpace();
    } else if (key === 'escape') {
      if (this.activePath) this.setActivePath(null);
      else if (this.pathMode) this.setPathMode(false);
      else this.editor.select(null);
    } else {
      return;
    }
    e.preventDefault();
  }

  private undo(): void {
    if (!this.editor.canUndo) return announce('Nothing to undo');
    this.editor.undo();
    announce('Undone');
  }

  private redo(): void {
    if (!this.editor.canRedo) return announce('Nothing to redo');
    this.editor.redo();
    announce('Redone');
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

/** Rounds to millimetres to keep scene files tidy. */
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
