import {
  ACESFilmicToneMapping,
  Color,
  Group,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
} from 'three';
import { DesktopControls } from '../desktop/DesktopControls';
import { XRSessionManager } from '../xr/XRSessionManager';
import { XRInput } from '../xr/XRInput';
import { buildEnvironment } from './environment';

export type FrameCallback = (dt: number, time: number, frame?: XRFrame) => void;

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

  private readonly frameCallbacks = new Set<FrameCallback>();
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
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(0x1b1e24);
    this.scene.name = 'PrevizXR';

    this.camera = new PerspectiveCamera(50, 1, 0.05, 200);
    this.camera.name = 'Viewer';
    this.camera.position.set(3, 2.2, 5);
    this.rig.name = 'Rig';
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    this.scene.add(buildEnvironment());

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
    this.renderer.setAnimationLoop((time, frame) => this.tick(time, frame));
  }

  onFrame(cb: FrameCallback): () => void {
    this.frameCallbacks.add(cb);
    return () => this.frameCallbacks.delete(cb);
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

    this.renderer.render(this.scene, this.camera);
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
