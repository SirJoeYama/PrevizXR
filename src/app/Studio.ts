import { AssetLoader } from '../assets/AssetLoader';
import { KeyframePath } from '../camera/KeyframePath';
import { VirtualCamera } from '../camera/VirtualCamera';
import { CameraView } from '../desktop/CameraView';
import { DesktopEditor } from '../desktop/DesktopEditor';
import { Editor } from '../model/Editor';
import { SceneSync } from '../sync/SceneSync';
import type { TakeRenderer } from '../render/TakeRenderer';
import { XREditor } from '../xr/XREditor';
import type { App } from './App';
import { Playback } from './Playback';
import { Project } from './Project';
import { spawn, type Spawnable } from './spawn';
import { Takes } from './Takes';

/** Wires the scene model, sync layer, editors and persistence onto the App. */
export class Studio {
  readonly editor = new Editor();
  readonly loader = new AssetLoader();
  readonly sync: SceneSync;
  readonly playback: Playback;
  readonly project: Project;
  readonly desktopEditor: DesktopEditor;
  readonly xrEditor: XREditor;
  readonly camera: VirtualCamera;
  readonly cameraView: CameraView;
  readonly takes: Takes;
  private rendererPromise: Promise<TakeRenderer> | null = null;

  constructor(readonly app: App) {
    this.sync = new SceneSync(this.editor, this.loader);
    app.scene.add(this.sync.root, this.sync.helpers);
    this.playback = new Playback(this.sync);
    this.project = new Project(this.editor);
    this.camera = new VirtualCamera(app, this.editor, this.sync);
    this.takes = new Takes(this.editor, this.sync, this.playback, this.camera);
    this.desktopEditor = new DesktopEditor(app, this.editor, this.sync, this.playback);
    this.xrEditor = new XREditor(app, this.editor, this.sync, this.playback, this.camera, this.takes);
    this.cameraView = new CameraView(app, this.editor, this.camera);
    this.desktopEditor.suspended = () => this.cameraView.throughCamera || this.takes.busy;
    this.desktopEditor.onSpace = () => (this.takes.busy ? this.takes.stop() : this.playback.toggle());
    this.cameraView.locked = () => this.takes.state === 'playing';
    this.cameraView.onChange(() => this.desktopEditor.refresh());
    this.takes.onChange(() => this.desktopEditor.refresh());

    const path = new KeyframePath(this.editor);
    app.scene.add(path.group);
    app.addEditorOnly(path.group);

    // Everything the shot must never show.
    app.addEditorOnly(this.sync.helpers);
    app.addEditorOnly(() => this.sync.inlineHelpers);
    for (const slot of app.xrInput.slots) {
      app.addEditorOnly(slot.ray);
      app.addEditorOnly(slot.grip);
      app.addEditorOnly(slot.hand);
    }

    // Adaptive quality in VR: step the camera monitor down while the headset misses its frame rate.
    let perfTimer = 0;
    let goodChecks = 0;
    app.xrSession.addEventListener('change', () => this.camera.setMonitorQuality(app.xrSession.presenting ? 1 : 0));
    app.onFrame((dt) => {
      if (app.renderer.xr.isPresenting && (perfTimer += dt) > 2) {
        perfTimer = 0;
        if (app.fps < 66) {
          this.camera.setMonitorQuality(this.camera.monitorQuality + 1);
          goodChecks = 0;
        } else if (app.fps > 71 && ++goodChecks >= 3 && this.camera.monitorQuality > 1) {
          this.camera.setMonitorQuality(this.camera.monitorQuality - 1);
          goodChecks = 0;
        }
      }
    });

    app.onFrame((dt) => {
      this.xrEditor.update(dt);
      this.playback.tick(dt);
      this.takes.update(dt);
      this.sync.tick(dt);
      this.camera.update(dt);
    });
  }

  /** The offline renderer, loaded on first use (keeps Mediabunny out of the initial bundle for VR). */
  renderer(): Promise<TakeRenderer> {
    this.rendererPromise ??= import('../render/TakeRenderer').then((m) => new m.TakeRenderer(this.app, this.sync, this.editor));
    return this.rendererPromise;
  }

  /** Adds an item in front of the desktop view. */
  spawnDesktop(item: Spawnable): void {
    const { at, yaw } = this.desktopEditor.spawnPoint();
    spawn(this.editor, item, at, yaw);
    this.app.renderer.domElement.focus();
  }
}
