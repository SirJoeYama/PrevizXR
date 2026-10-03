import { AssetLoader } from '../assets/AssetLoader';
import { VirtualCamera } from '../camera/VirtualCamera';
import { CameraView } from '../desktop/CameraView';
import { DesktopEditor } from '../desktop/DesktopEditor';
import { Editor } from '../model/Editor';
import { SceneSync } from '../sync/SceneSync';
import { XREditor } from '../xr/XREditor';
import type { App } from './App';
import { Playback } from './Playback';
import { Project } from './Project';
import { spawn, type Spawnable } from './spawn';

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

  constructor(readonly app: App) {
    this.sync = new SceneSync(this.editor, this.loader);
    app.scene.add(this.sync.root, this.sync.helpers);
    this.playback = new Playback(this.sync);
    this.project = new Project(this.editor);
    this.camera = new VirtualCamera(app, this.editor, this.sync);
    this.desktopEditor = new DesktopEditor(app, this.editor, this.sync, this.playback);
    this.xrEditor = new XREditor(app, this.editor, this.sync, this.playback, this.camera);
    this.cameraView = new CameraView(app, this.editor, this.camera);
    this.desktopEditor.suspended = () => this.cameraView.throughCamera;
    this.cameraView.onChange(() => this.desktopEditor.refresh());

    // Everything the shot must never show.
    app.addEditorOnly(this.sync.helpers);
    app.addEditorOnly(() => this.sync.inlineHelpers);
    for (const slot of app.xrInput.slots) {
      app.addEditorOnly(slot.ray);
      app.addEditorOnly(slot.grip);
      app.addEditorOnly(slot.hand);
    }

    app.onFrame((dt) => {
      this.xrEditor.update(dt);
      this.playback.tick(dt);
      this.sync.tick(dt);
      this.camera.update(dt);
    });
  }

  /** Adds an item in front of the desktop view. */
  spawnDesktop(item: Spawnable): void {
    const { at, yaw } = this.desktopEditor.spawnPoint();
    spawn(this.editor, item, at, yaw);
    this.app.renderer.domElement.focus();
  }
}
