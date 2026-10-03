import {
  ACESFilmicToneMapping,
  Color,
  Group,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
  type Camera,
  type Object3D,
  type WebGLRenderTarget,
} from 'three';
import { DesktopControls } from '../desktop/DesktopControls';
import { XRSessionManager } from '../xr/XRSessionManager';
import { XRInput } from '../xr/XRInput';
import { buildEnvironment } from './environment';

export type FrameCallback = (dt: number, time: number, frame?: XRFrame) => void;

/** An editor-only object, or a function returning the current ones (for sets that change). */
export type EditorOnly = Object3D | (() => Iterable<Object3D>);

/** Owns the renderer, the Three.js scene graph and the interactive frame loop. */
export class App {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  /** Player origin. The viewer camera and XR controllers are children, so locomotion moves the rig. */
  readonly rig = new Group();
  readonly camera: PerspectiveCamera;
  readonly desktop: DesktopControls;
  readonly xrSession: XRSessionManager;
  readonly xrInput: XRInput;
  /** The stage floor: appears in clay and depth passes, hidden in color_id. */
  readonly floor: Object3D;

  private readonly frameCallbacks = new Set<FrameCallback>();
  /** Objects hidden by renderClean(): grid, labels, gizmos, controllers, menus, camera body… */
  private readonly editorOnly = new Set<EditorOnly>();
  /** Replaces the default desktop render (e.g. looking through the virtual camera). Ignored in XR. */
  mainRender: (() => void) | null = null;
  /** Runs after the desktop render (e.g. picture-in-picture monitor). Not called in XR. */
  readonly afterRender = new Set<() => void>();
  private lastTime = -1;
  private fpsAccum = 0;
  private fpsFrames = 0;
  /** Frames per second, averaged over the last half second. */
  fps = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    // Strongest fixed foveation: lower resolution in the periphery, a big win on Quest.
    this.renderer.xr.setFoveation(1);
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('role', 'application');
    this.renderer.domElement.setAttribute('aria-roledescription', '3D viewport');
    this.renderer.domElement.setAttribute(
      'aria-label',
      '3D scene. Use the sidebar to add and edit objects; with this view focused, W A S D moves, Q and E go down and up, and the shortcuts listed in the sidebar apply.',
    );
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(0x1b1e24);
    this.scene.name = 'PrevizXR';

    this.camera = new PerspectiveCamera(50, 1, 0.05, 200);
    this.camera.name = 'Viewer';
    this.camera.position.set(3, 2.2, 5);
    this.rig.name = 'Rig';
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    const env = buildEnvironment();
    this.scene.add(env.group);
    this.floor = env.floor;
    for (const o of env.editorOnly) this.editorOnly.add(o);

    this.desktop = new DesktopControls(this.camera, this.renderer.domElement);
    this.xrSession = new XRSessionManager(this.renderer);
    this.xrInput = new XRInput(this.renderer, this.rig);

    this.xrSession.addEventListener('beforestart', () => this.desktop.saveView());
    this.xrSession.addEventListener('change', () => {
      this.desktop.enabled = !this.xrSession.presenting;
      if (!this.xrSession.presenting) {
        this.desktop.restoreView();
        this.resize();
      }
    });

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  start(): void {
    this.lastTime = -1;
    this.renderer.setAnimationLoop((time, frame) => this.tick(time, frame));
  }

  /** Stops the interactive loop (offline rendering takes over the renderer). */
  pause(): void {
    this.renderer.setAnimationLoop(null);
  }

  resume(): void {
    this.start();
  }

  onFrame(cb: FrameCallback): () => void {
    this.frameCallbacks.add(cb);
    return () => this.frameCallbacks.delete(cb);
  }

  /** Marks objects to hide in clean renders (camera monitor, export passes). */
  addEditorOnly(o: EditorOnly): void {
    this.editorOnly.add(o);
  }

  /**
   * Renders the scene as the shot sees it: every editor-only object hidden.
   * With a target, renders offscreen (safe to call inside an XR frame); without one, renders to the canvas.
   */
  renderClean(camera: Camera, target: WebGLRenderTarget | null = null): void {
    this.withEditorHidden(() => {
      const r = this.renderer;
      if (target) {
        const xr = r.xr.enabled;
        const prev = r.getRenderTarget();
        r.xr.enabled = false;
        r.setRenderTarget(target);
        r.render(this.scene, camera);
        r.setRenderTarget(prev);
        r.xr.enabled = xr;
      } else {
        r.render(this.scene, camera);
      }
    });
  }

  /** Runs fn with every editor-only object hidden, then restores their visibility. */
  withEditorHidden<T>(fn: () => T): T {
    const hidden: Object3D[] = [];
    for (const e of this.editorOnly) {
      for (const o of typeof e === 'function' ? e() : [e]) {
        if (o.visible) {
          o.visible = false;
          hidden.push(o);
        }
      }
    }
    try {
      return fn();
    } finally {
      for (const o of hidden) o.visible = true;
    }
  }

  private resize(): void {
    if (this.renderer.xr.isPresenting) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private tick(timeMs: number, frame?: XRFrame): void {
    const time = timeMs / 1000;
    // Clamp dt so a backgrounded tab doesn't produce a huge step on resume.
    const dt = this.lastTime < 0 ? 0 : Math.min(time - this.lastTime, 0.1);
    this.lastTime = time;
    this.updateFps(dt);

    if (!this.renderer.xr.isPresenting) this.desktop.update(dt);
    for (const cb of this.frameCallbacks) cb(dt, time, frame);

    if (this.renderer.xr.isPresenting) {
      // Passthrough: the real floor replaces the virtual one (the grid stays to show the stage).
      // Three.js clears to transparent for alpha-blend sessions; the monitor still renders the floor.
      const passthrough = this.xrSession.mode === 'ar';
      if (passthrough) this.floor.visible = false;
      this.renderer.render(this.scene, this.camera);
      if (passthrough) this.floor.visible = true;
      return;
    }
    if (this.mainRender) this.mainRender();
    else this.renderer.render(this.scene, this.camera);
    for (const cb of this.afterRender) cb();
  }

  private updateFps(dt: number): void {
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
  }
}
