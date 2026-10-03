import type { Editor } from '../model/Editor';
import { createScene, type SceneDoc } from '../model/scene';
import { parseScene, serializeScene } from '../model/serialize';
import { deleteScene, listScenes, loadScene, saveScene, type SceneSummary } from '../storage/sceneStore';
import { deleteTakesOfScene } from '../storage/takeStore';
import { embedImages, restoreEmbeddedImages } from '../assets/imageLibrary';
import { downloadText, fileTimestamp, slug } from './download';

const LAST_SCENE_KEY = 'previzxr.lastScene';
const AUTOSAVE_DELAY = 800;

/**
 * Scene lifecycle: autosaves the current scene to IndexedDB, reopens the last scene on startup,
 * and handles new/open/delete/import/export.
 */
export class Project {
  private saveTimer = 0;
  private readonly listeners = new Set<() => void>();
  status: 'saved' | 'saving' | 'unsaved' | 'error' = 'saved';

  constructor(private readonly editor: Editor) {
    editor.subscribe((change) => {
      if (change === 'doc') this.scheduleSave();
    });
    window.addEventListener('pagehide', () => void this.flush());
  }

  onStatus(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Opens the last scene, or starts a new one. */
  async restore(): Promise<void> {
    const last = readLast();
    if (last) {
      try {
        const doc = await loadScene(last);
        if (doc) {
          this.editor.load(doc);
          this.setStatus('saved');
          return;
        }
      } catch (err) {
        console.warn('Could not reopen the last scene', err);
      }
    }
    this.newScene();
  }

  newScene(): void {
    void this.flush();
    this.open(createScene());
  }

  async openSaved(id: string): Promise<void> {
    await this.flush();
    const doc = await loadScene(id);
    if (doc) this.open(doc);
  }

  list(): Promise<SceneSummary[]> {
    return listScenes();
  }

  async remove(id: string): Promise<void> {
    await deleteScene(id);
    await deleteTakesOfScene(id);
    if (id === this.editor.doc.id) this.newScene();
  }

  /** Imports a scene file. A scene with the same id as an existing one gets a fresh id so nothing is overwritten. */
  async importFile(file: File): Promise<void> {
    const text = await file.text();
    const doc = parseScene(text);
    await restoreEmbeddedImages((JSON.parse(text) as { embeddedImages?: unknown }).embeddedImages);
    const existing = await listScenes();
    if (existing.some((s) => s.id === doc.id)) doc.id = crypto.randomUUID();
    await this.flush();
    this.open(doc);
    this.scheduleSave();
  }

  /** Downloads the scene as JSON, with its reference images embedded so the file is self-contained. */
  async exportFile(): Promise<void> {
    const doc = this.editor.doc;
    const embeddedImages = await embedImages(doc);
    const text = Object.keys(embeddedImages).length
      ? JSON.stringify({ ...JSON.parse(serializeScene(doc)), embeddedImages }, null, 2)
      : serializeScene(doc);
    downloadText(`${slug(doc.name) || 'scene'}_${fileTimestamp()}.previz.json`, text);
  }

  async flush(): Promise<void> {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    await this.save();
  }

  private open(doc: SceneDoc): void {
    this.editor.load(doc);
    writeLast(doc.id);
    this.setStatus('saved');
  }

  private scheduleSave(): void {
    this.setStatus('unsaved');
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0;
      void this.save();
    }, AUTOSAVE_DELAY);
  }

  private async save(): Promise<void> {
    this.setStatus('saving');
    try {
      await saveScene(this.editor.doc as SceneDoc);
      writeLast(this.editor.doc.id);
      this.setStatus('saved');
    } catch (err) {
      console.error('Autosave failed', err);
      this.setStatus('error');
    }
  }

  private setStatus(s: Project['status']): void {
    this.status = s;
    for (const l of this.listeners) l();
  }
}

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_SCENE_KEY);
  } catch {
    return null;
  }
}

function writeLast(id: string): void {
  try {
    localStorage.setItem(LAST_SCENE_KEY, id);
  } catch {
    // Storage blocked (private mode): the scene is still in IndexedDB, it just won't auto-reopen.
  }
}
