import { Box3, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { App } from '../app/App';
import type { Playback } from '../app/Playback';
import { deleteSelected, duplicateSelected, readTransform, snapToFloor } from '../interaction/ops';
import type { Editor } from '../model/Editor';
import type { Vec3 } from '../model/scene';
import type { SceneSync } from '../sync/SceneSync';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

const CLICK_SLOP_PX = 5;
const floorPlane = new Plane(new Vector3(0, 1, 0), 0);

/**
 * Desktop scene editing: click to select, TransformControls gizmo, keyboard shortcuts,
 * and waypoint drawing (click the floor) while path mode is on.
 */
export class DesktopEditor {
  readonly gizmo: TransformControls;
  /** When true, clicks on the floor add waypoints to the selected actor. */
  pathMode = false;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private down: { x: number; y: number; onGizmo: boolean } | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly app: App,
    private readonly editor: Editor,
    private readonly sync: SceneSync,
    private readonly playback: Playback,
  ) {
    const dom = app.renderer.domElement;
    this.gizmo = new TransformControls(app.camera, dom);
    this.gizmo.setSize(0.9);
    const helper = this.gizmo.getHelper();
    helper.traverse((o) => (o.userData.helper = true));
    app.scene.add(helper);

    this.gizmo.addEventListener('dragging-changed', (e) => {
      app.desktop.orbit.enabled = !e.value;
      if (e.value) editor.begin();
      else editor.commit();
    });
    this.gizmo.addEventListener('objectChange', () => {
      const id = editor.selectedId;
      const root = id ? sync.rootOf(id) : undefined;
      if (id && root) editor.setTransform(id, readTransform(root), true);
    });

    editor.subscribe((c) => {
      if (c === 'selection' || c === 'doc') this.attach();
      if (c === 'selection' && this.pathMode && editor.selected?.kind !== 'actor') this.setPathMode(false);
    });
    playback.onChange(() => this.attach());
    app.xrSession.addEventListener('change', () => this.attach());

    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.down = { x: e.clientX, y: e.clientY, onGizmo: this.gizmo.axis !== null };
    });
    dom.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || d.onGizmo || e.button !== 0) return;
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
    return this.gizmo.mode as GizmoMode;
  }

  setMode(mode: GizmoMode): void {
    this.gizmo.setMode(mode);
    this.gizmo.setSpace(mode === 'translate' ? 'world' : 'local');
    this.emit();
  }

  setPathMode(on: boolean): void {
    this.pathMode = on && this.editor.selected?.kind === 'actor';
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

  private attach(): void {
    const id = this.editor.selectedId;
    const root = id ? this.sync.rootOf(id) : undefined;
    const usable = root && !this.playback.playing && !this.app.xrSession.presenting;
    if (usable) {
      if (this.gizmo.object !== root) this.gizmo.attach(root);
    } else if (this.gizmo.object) {
      this.gizmo.detach();
    }
  }

  private onClick(e: PointerEvent): void {
    const rect = this.app.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.app.camera);

    if (this.pathMode) {
      const sel = this.editor.selected;
      const hit = this.raycaster.ray.intersectPlane(floorPlane, new Vector3());
      if (sel?.actor && hit) {
        const point: Vec3 = [round(hit.x), 0, round(hit.z)];
        this.editor.update(sel.id, (o) => o.actor!.waypoints.push(point));
      }
      return;
    }

    const hits = this.raycaster.intersectObject(this.sync.root, true);
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
      if (e.shiftKey) this.editor.redo();
      else this.editor.undo();
    } else if (mod && key === 'y') {
      this.editor.redo();
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
      this.playback.toggle();
    } else if (key === 'escape') {
      if (this.pathMode) this.setPathMode(false);
      else this.editor.select(null);
    } else {
      return;
    }
    e.preventDefault();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

/** Rounds to millimetres to keep scene files tidy. */
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
