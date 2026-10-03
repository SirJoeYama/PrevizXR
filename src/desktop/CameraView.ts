import { Euler, Vector3 } from 'three';
import type { App } from '../app/App';
import { drawGuides } from '../camera/guides';
import { ASPECTS, clampFocal } from '../camera/lens';
import type { VirtualCamera } from '../camera/VirtualCamera';
import type { Editor } from '../model/Editor';
import { CAMERA_ID, type Transform } from '../model/scene';

const PIP_MAX_W = 360;
const PIP_MARGIN = 12;
const LOOK_SPEED = 0.0035; // radians per pixel
const MOVE_SPEED = 2; // m/s
const COMMIT_DELAY = 400; // ms of inactivity that ends a camera move (one undo step)

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Desktop views of the virtual camera:
 * - picture-in-picture monitor in the viewport corner (M)
 * - full camera view with letterboxing (V), where the mouse and WASD/QE fly the camera and the wheel zooms.
 * Both draw frame guides on an overlay canvas.
 */
export class CameraView {
  pip = true;
  throughCamera = false;
  /** Returns true while a take plays back: the camera can't be flown then. */
  locked: () => boolean = () => false;
  private readonly overlay: HTMLCanvasElement;
  private readonly keys = new Set<string>();
  private dragging: { x: number; y: number } | null = null;
  private editing = false;
  private commitTimer = 0;
  private readonly listeners = new Set<() => void>();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly v = new Vector3();

  constructor(
    private readonly app: App,
    private readonly editor: Editor,
    private readonly vcam: VirtualCamera,
  ) {
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'guides-overlay';
    this.overlay.setAttribute('aria-hidden', 'true');
    app.renderer.domElement.parentElement!.appendChild(this.overlay);

    app.afterRender.add(() => this.afterRender());
    app.onFrame((dt) => this.fly(dt));
    app.xrSession.addEventListener('change', () => {
      if (app.xrSession.presenting) this.setThroughCamera(false);
      this.clearOverlay();
    });

    const dom = app.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => {
      if (!this.throughCamera || e.button !== 0) return;
      this.dragging = { x: e.clientX, y: e.clientY };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.dragging.x;
      const dy = e.clientY - this.dragging.y;
      this.dragging = { x: e.clientX, y: e.clientY };
      this.look(dx, dy);
    });
    dom.addEventListener('pointerup', () => {
      this.dragging = null;
      this.scheduleCommit();
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.throughCamera) return;
        e.preventDefault();
        if (this.locked()) return;
        this.beginEdit();
        this.editor.updateLens((l) => (l.focalLength = Math.round(clampFocal(l.focalLength * Math.exp(-e.deltaY * 0.001)) * 10) / 10), true);
        this.scheduleCommit();
      },
      { passive: false },
    );
    dom.addEventListener('keydown', (e) => {
      if (this.throughCamera) this.keys.add(e.code);
    });
    dom.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (this.keys.size === 0) this.scheduleCommit();
    });
    dom.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  setPip(on: boolean): void {
    this.pip = on;
    this.emit();
  }

  setThroughCamera(on: boolean): void {
    if (on === this.throughCamera) return;
    this.throughCamera = on;
    this.keys.clear();
    this.app.desktop.enabled = !on && !this.app.xrSession.presenting;
    this.app.mainRender = on ? () => this.renderThroughCamera() : null;
    if (!on) this.commitNow();
    this.app.renderer.domElement.style.cursor = on ? 'grab' : '';
    this.emit();
  }

  /** Puts the virtual camera where the desktop view is, looking the same way. */
  matchView(): void {
    const cam = this.app.camera;
    cam.updateMatrixWorld(true);
    const t: Transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
    cam.getWorldPosition(this.v).toArray(t.position);
    t.rotation = cam.getWorldQuaternion(this.vcam.root.quaternion.clone()).toArray() as Transform['rotation'];
    this.editor.setTransform(CAMERA_ID, t);
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
    if (e.ctrlKey || e.metaKey || e.altKey || this.app.xrSession.presenting) return;
    const key = e.key.toLowerCase();
    if (key === 'v') this.setThroughCamera(!this.throughCamera);
    else if (key === 'm') this.setPip(!this.pip);
    else if (key === 'c') this.editor.select(CAMERA_ID);
    else if (key === 'escape' && this.throughCamera) this.setThroughCamera(false);
    else return;
    e.preventDefault();
  }

  private look(dx: number, dy: number): void {
    if (this.locked()) return;
    this.beginEdit();
    const t = this.currentTransform();
    this.euler.setFromQuaternion(this.vcam.root.quaternion.fromArray(t.rotation), 'YXZ');
    this.euler.y -= dx * LOOK_SPEED;
    this.euler.x = Math.max(-1.5, Math.min(1.5, this.euler.x - dy * LOOK_SPEED));
    this.vcam.root.quaternion.setFromEuler(this.euler);
    t.rotation = this.vcam.root.quaternion.toArray() as Transform['rotation'];
    this.editor.setTransform(CAMERA_ID, t, true);
  }

  private fly(dt: number): void {
    if (!this.throughCamera || this.keys.size === 0 || this.locked()) return;
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const u = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    if (!f && !r && !u) return;
    this.beginEdit();
    const speed = MOVE_SPEED * (k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1) * dt;
    const t = this.currentTransform();
    const q = this.vcam.root.quaternion.fromArray(t.rotation);
    // Move like a dolly: forward/right stay level, Q/E move straight up and down.
    this.euler.setFromQuaternion(q, 'YXZ');
    const yaw = this.euler.y;
    const fwd = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    this.v.fromArray(t.position).addScaledVector(fwd, f * speed).addScaledVector(right, r * speed);
    this.v.y += u * speed;
    t.position = this.v.toArray() as Transform['position'];
    this.editor.setTransform(CAMERA_ID, t, true);
  }

  private currentTransform(): Transform {
    return structuredClone(this.editor.doc.camera.transform);
  }

  private beginEdit(): void {
    if (!this.editing) {
      this.editor.begin();
      this.editing = true;
    }
    clearTimeout(this.commitTimer);
  }

  private scheduleCommit(): void {
    if (!this.editing || this.dragging || this.keys.size) return;
    clearTimeout(this.commitTimer);
    this.commitTimer = window.setTimeout(() => this.commitNow(), COMMIT_DELAY);
  }

  private commitNow(): void {
    clearTimeout(this.commitTimer);
    if (!this.editing) return;
    this.editing = false;
    this.editor.commit();
  }

  /** Largest rectangle of the shot's aspect ratio that fits the canvas (CSS pixels, top-left origin). */
  private letterbox(): Rect {
    const { clientWidth: W, clientHeight: H } = this.app.renderer.domElement;
    const a = ASPECTS[this.editor.doc.camera.lens.aspect];
    const w = Math.min(W, H * a);
    const h = w / a;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  private pipRect(): Rect {
    const { clientWidth: W, clientHeight: H } = this.app.renderer.domElement;
    const a = ASPECTS[this.editor.doc.camera.lens.aspect];
    let w = Math.min(PIP_MAX_W, W * 0.35);
    let h = w / a;
    if (h > H * 0.45) {
      h = H * 0.45;
      w = h * a;
    }
    return { x: W - w - PIP_MARGIN, y: H - h - PIP_MARGIN, w, h };
  }

  private renderThroughCamera(): void {
    const r = this.app.renderer;
    r.setScissorTest(false);
    r.setClearColor(0x000000, 1);
    r.clear();
    this.renderInto(this.letterbox());
  }

  /** Renders the virtual camera into a rectangle of the canvas. */
  private renderInto(rect: Rect): void {
    const r = this.app.renderer;
    const H = r.domElement.clientHeight;
    const y = H - rect.y - rect.h; // WebGL viewports start at the bottom
    r.setViewport(rect.x, y, rect.w, rect.h);
    r.setScissor(rect.x, y, rect.w, rect.h);
    r.setScissorTest(true);
    this.vcam.root.updateMatrixWorld(true);
    this.app.renderClean(this.vcam.camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, r.domElement.clientWidth, H);
  }

  private afterRender(): void {
    const rect = this.throughCamera ? this.letterbox() : this.pip ? this.pipRect() : null;
    if (rect && !this.throughCamera) this.renderInto(rect);
    this.drawOverlay(rect);
  }

  private drawOverlay(rect: Rect | null): void {
    const c = this.overlay;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const W = c.parentElement!.clientWidth;
    const H = c.parentElement!.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!rect) return;
    ctx.scale(dpr, dpr);
    drawGuides(ctx, rect.x, rect.y, rect.w, rect.h, { lens: this.editor.doc.camera.lens, focus: this.vcam.focusDistance, focal: this.vcam.focalLength, status: this.vcam.status() });
    if (this.throughCamera) {
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.textAlign = 'center';
      ctx.fillText('Camera view · drag to aim · WASD/QE to move · wheel to zoom · V or Esc to exit', W / 2, 18);
    }
  }

  private clearOverlay(): void {
    const ctx = this.overlay.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
