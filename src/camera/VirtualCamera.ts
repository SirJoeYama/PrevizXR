import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import type { App } from '../app/App';
import type { Editor } from '../model/Editor';
import { CAMERA_ID, type CameraRig } from '../model/scene';
import type { SceneSync } from '../sync/SceneSync';
import { drawGuides } from './guides';
import { ASPECTS, verticalFovDeg } from './lens';

const MONITOR_SIZE = 0.2; // metres, longest side
const MONITOR_PIXELS = 640; // render target, longest side
const FRUSTUM_LENGTH = 1.2; // metres
const AUTOFOCUS_INTERVAL = 0.1; // seconds
const floorPlane = new Plane(new Vector3(0, 1, 0), 0);

/**
 * The scene's virtual camera: a PerspectiveCamera posed from the model's CameraRig, with an
 * editor-only body (housing, lens, frustum lines) and a monitor showing its live view.
 */
export class VirtualCamera {
  readonly root = new Group();
  readonly camera = new PerspectiveCamera(50, 16 / 9, 0.05, 500);
  /** Editor-only parts: never in the shot. */
  readonly body = new Group();
  readonly target = new WebGLRenderTarget(MONITOR_PIXELS, 360);
  /** Live focus distance (metres) for the HUD and takes; null = nothing under the centre (infinity). */
  focusDistance: number | null = null;
  /** Render the on-body monitor (always on in VR; optional on desktop). */
  monitorEnabled = true;

  private readonly monitor: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly overlay: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly overlayCanvas = document.createElement('canvas');
  private readonly overlayTexture: CanvasTexture;
  private readonly frustum: LineSegments;
  private readonly raycaster = new Raycaster();
  private overlaySig = '';
  private lensSig = '';
  private focusTimer = 0;
  private frame = 0;

  constructor(
    private readonly app: App,
    private readonly editor: Editor,
    private readonly sync: SceneSync,
  ) {
    this.root.name = 'VirtualCamera';
    this.camera.name = 'ShotCamera';
    this.root.add(this.camera, this.body);
    this.body.name = 'CameraBody';
    this.body.userData.helper = true;

    const housing = new MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.6, metalness: 0.2 });
    const accent = new MeshStandardMaterial({ color: 0xffb547, roughness: 0.5 });
    const box = new Mesh(new BoxGeometry(0.1, 0.11, 0.18), housing);
    box.position.set(0, 0, 0.1);
    const lens = new Mesh(new CylinderGeometry(0.038, 0.038, 0.09, 24).rotateX(Math.PI / 2), housing);
    lens.position.z = -0.035;
    const ring = new Mesh(new CylinderGeometry(0.041, 0.041, 0.012, 24).rotateX(Math.PI / 2), accent);
    ring.position.z = -0.075;
    this.body.add(box, lens, ring);

    this.target.texture.colorSpace = SRGBColorSpace;
    this.monitor = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: this.target.texture }));
    this.overlayCanvas.width = MONITOR_PIXELS;
    this.overlayCanvas.height = 360;
    this.overlayTexture = new CanvasTexture(this.overlayCanvas);
    this.overlayTexture.colorSpace = SRGBColorSpace;
    this.overlay = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: this.overlayTexture, transparent: true, depthWrite: false }));
    this.overlay.position.z = 0.001;
    this.overlay.raycast = () => {};
    const monitorFrame = new Mesh(new BoxGeometry(1, 1, 0.01), housing);
    monitorFrame.position.z = -0.006;
    monitorFrame.raycast = () => {};
    const monitorGroup = new Group();
    monitorGroup.name = 'Monitor';
    monitorGroup.add(monitorFrame, this.monitor, this.overlay);
    monitorGroup.position.set(0, 0.17, 0.16);
    monitorGroup.rotation.x = -0.3;
    this.body.add(monitorGroup);
    this.monitor.userData.frame = monitorFrame;

    const frustumGeo = new BufferGeometry();
    frustumGeo.setAttribute('position', new Float32BufferAttribute(new Array(16 * 3).fill(0), 3));
    this.frustum = new LineSegments(frustumGeo, new LineBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.6 }));
    this.frustum.raycast = () => {};
    this.body.add(this.frustum);

    app.scene.add(this.root);
    app.addEditorOnly(this.body);
    sync.registerRoot(CAMERA_ID, this.root);
    editor.subscribe((c) => c === 'doc' && this.apply());
    this.apply();
  }

  get rig(): CameraRig {
    return this.editor.doc.camera;
  }

  /** Pose and lens from the model. */
  apply(): void {
    const { transform, lens } = this.rig;
    this.root.position.fromArray(transform.position);
    this.root.quaternion.fromArray(transform.rotation);
    const sig = `${lens.focalLength}|${lens.sensor}|${lens.aspect}`;
    if (sig === this.lensSig) return;
    this.lensSig = sig;

    const aspect = ASPECTS[lens.aspect];
    this.camera.fov = verticalFovDeg(lens.focalLength, lens.sensor, lens.aspect);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    const [mw, mh] = aspect >= 1 ? [MONITOR_SIZE, MONITOR_SIZE / aspect] : [MONITOR_SIZE * aspect, MONITOR_SIZE];
    for (const m of [this.monitor, this.overlay, this.monitor.userData.frame as Mesh]) m.scale.set(mw, mh, 1);
    (this.monitor.userData.frame as Mesh).scale.set(mw + 0.012, mh + 0.012, 1);
    const [pw, ph] = aspect >= 1 ? [MONITOR_PIXELS, Math.round(MONITOR_PIXELS / aspect)] : [Math.round(MONITOR_PIXELS * aspect), MONITOR_PIXELS];
    this.target.setSize(pw, ph);
    this.overlayCanvas.width = pw;
    this.overlayCanvas.height = ph;
    this.overlaySig = '';
    this.updateFrustum();
  }

  /** Per frame: autofocus, HUD overlay and the on-body monitor. Call before the main render. */
  update(dt: number): void {
    this.focusTimer -= dt;
    if (this.focusTimer <= 0) {
      this.focusTimer = AUTOFOCUS_INTERVAL;
      this.focusDistance = this.rig.lens.focusMode === 'manual' ? this.rig.lens.focusDistance : this.measureFocus();
    }
    this.drawOverlay();
    // The monitor renders at half the display rate: plenty for framing, and cheaper on Quest.
    this.frame++;
    if (this.monitorEnabled && this.body.visible && this.frame % 2 === 0) {
      this.root.updateMatrixWorld(true);
      this.app.renderClean(this.camera, this.target);
    }
  }

  /** Distance to whatever is under the frame centre (scene objects or floor), or null. */
  private measureFocus(): number | null {
    this.root.updateMatrixWorld(true);
    this.raycaster.setFromCamera(new Vector2(0, 0), this.camera);
    this.raycaster.far = 500;
    const hit = this.raycaster.intersectObject(this.sync.root, true).find((h) => !this.sync.inlineHelpers.has(h.object));
    let d = hit?.distance ?? Infinity;
    const floor = this.raycaster.ray.intersectPlane(floorPlane, new Vector3());
    if (floor) d = Math.min(d, floor.distanceTo(this.raycaster.ray.origin));
    return Number.isFinite(d) ? d : null;
  }

  private drawOverlay(): void {
    const lens = this.rig.lens;
    const focus = this.focusDistance === null ? '∞' : this.focusDistance.toFixed(2);
    const sig = JSON.stringify(lens) + focus;
    if (sig === this.overlaySig) return;
    this.overlaySig = sig;
    const c = this.overlayCanvas;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    drawGuides(ctx, 0, 0, c.width, c.height, { lens, focus: this.focusDistance });
    this.overlayTexture.needsUpdate = true;
  }

  /** Four edge lines from the lens plus the frame rectangle, FRUSTUM_LENGTH metres out. */
  private updateFrustum(): void {
    const halfH = Math.tan((this.camera.fov * Math.PI) / 360) * FRUSTUM_LENGTH;
    const halfW = halfH * this.camera.aspect;
    const z = -FRUSTUM_LENGTH;
    const c = [
      [-halfW, -halfH, z],
      [halfW, -halfH, z],
      [halfW, halfH, z],
      [-halfW, halfH, z],
    ];
    const pts: number[] = [];
    for (const p of c) pts.push(0, 0, 0, ...p);
    for (let i = 0; i < 4; i++) pts.push(...c[i], ...c[(i + 1) % 4]);
    const attr = this.frustum.geometry.getAttribute('position') as Float32BufferAttribute;
    attr.set(pts);
    attr.needsUpdate = true;
    this.frustum.geometry.computeBoundingSphere();
  }
}
