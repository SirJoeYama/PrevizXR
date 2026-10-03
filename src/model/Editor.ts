import { nextIdColor } from './idColors';
import {
  cloneDoc,
  createId,
  createScene,
  defaultActorSettings,
  type SceneDoc,
  type SceneObject,
  type Transform,
} from './scene';

const HISTORY_LIMIT = 100;

export type EditorChange = 'doc' | 'selection' | 'history';
export type EditorListener = (change: EditorChange) => void;

export type NewObject = Omit<SceneObject, 'id' | 'color'> & Partial<Pick<SceneObject, 'id' | 'color'>>;

/**
 * Owns the current SceneDoc, the selection and undo/redo history.
 * All edits go through here. Undo uses whole-document snapshots: scenes are small, and snapshots
 * can't drift out of sync the way hand-written inverse commands can.
 * Continuous edits (dragging) call begin() once, then transient updates, then commit().
 */
export class Editor {
  private current: SceneDoc;
  private past: SceneDoc[] = [];
  private future: SceneDoc[] = [];
  private pending: SceneDoc | null = null;
  private readonly listeners = new Set<EditorListener>();
  selectedId: string | null = null;

  constructor(doc: SceneDoc = createScene()) {
    this.current = doc;
  }

  get doc(): Readonly<SceneDoc> {
    return this.current;
  }

  get selected(): SceneObject | undefined {
    return this.selectedId ? this.find(this.selectedId) : undefined;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  find(id: string): SceneObject | undefined {
    return this.current.objects.find((o) => o.id === id);
  }

  subscribe(listener: EditorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Replaces the whole document (open/import/new). Clears history. */
  load(doc: SceneDoc): void {
    this.current = doc;
    this.past = [];
    this.future = [];
    this.pending = null;
    this.selectedId = null;
    this.emit('doc');
    this.emit('selection');
    this.emit('history');
  }

  select(id: string | null): void {
    if (id !== null && !this.find(id)) id = null;
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.emit('selection');
  }

  /** Applies a mutation as one undoable step. */
  edit(mutate: (doc: SceneDoc) => void): void {
    const before = cloneDoc(this.current);
    const next = cloneDoc(this.current);
    mutate(next);
    this.pushHistory(this.pending ?? before);
    this.pending = null;
    this.current = next;
    this.afterDocChange();
  }

  /** Starts a continuous edit; the pre-edit state becomes one undo step at commit(). */
  begin(): void {
    if (!this.pending) this.pending = cloneDoc(this.current);
  }

  /** Updates without recording history (call between begin() and commit()). */
  transient(mutate: (doc: SceneDoc) => void): void {
    mutate(this.current);
    this.emit('doc');
  }

  commit(): void {
    if (!this.pending) return;
    if (JSON.stringify(this.pending) !== JSON.stringify(this.current)) this.pushHistory(this.pending);
    this.pending = null;
    this.emit('history');
  }

  undo(): void {
    this.commit();
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.current);
    this.current = prev;
    this.afterDocChange();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.current);
    this.current = next;
    this.afterDocChange();
  }

  add(obj: NewObject): SceneObject {
    const full: SceneObject = {
      ...cloneDoc(obj),
      id: obj.id ?? createId(),
      color: obj.color ?? nextIdColor(this.current.objects.map((o) => o.color)),
    };
    if (full.kind === 'actor' && !full.actor) full.actor = defaultActorSettings();
    this.edit((doc) => doc.objects.push(full));
    this.select(full.id);
    return full;
  }

  remove(id: string): void {
    if (!this.find(id)) return;
    this.edit((doc) => {
      doc.objects = doc.objects.filter((o) => o.id !== id);
    });
    if (this.selectedId === id) this.select(null);
  }

  duplicate(id: string, offset: [number, number, number] = [0.5, 0, 0.5]): SceneObject | undefined {
    const src = this.find(id);
    if (!src) return undefined;
    const copy = cloneDoc(src);
    const p = copy.transform.position;
    copy.transform.position = [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]];
    if (copy.actor) copy.actor.waypoints = copy.actor.waypoints.map((w) => [w[0] + offset[0], w[1] + offset[1], w[2] + offset[2]]);
    return this.add({ ...copy, id: undefined, color: undefined, name: uniqueName(src.name, this.current.objects) });
  }

  update(id: string, patch: (obj: SceneObject) => void): void {
    if (!this.find(id)) return;
    this.edit((doc) => {
      const obj = doc.objects.find((o) => o.id === id);
      if (obj) patch(obj);
    });
  }

  /** Sets a transform; pass transient=true while dragging (between begin() and commit()). */
  setTransform(id: string, t: Transform, transient = false): void {
    const apply = (doc: SceneDoc) => {
      const obj = doc.objects.find((o) => o.id === id);
      if (obj) obj.transform = cloneDoc(t);
    };
    if (transient) this.transient(apply);
    else this.edit(apply);
  }

  rename(name: string): void {
    this.edit((doc) => {
      doc.name = name;
    });
  }

  private pushHistory(snapshot: SceneDoc): void {
    this.past.push(snapshot);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  private afterDocChange(): void {
    if (this.selectedId && !this.find(this.selectedId)) {
      this.selectedId = null;
      this.emit('selection');
    }
    this.emit('doc');
    this.emit('history');
  }

  private emit(change: EditorChange): void {
    for (const l of this.listeners) l(change);
  }
}

/** "Chair" → "Chair 2", "Chair 2" → "Chair 3", skipping names already used. */
export function uniqueName(base: string, objects: ReadonlyArray<Pick<SceneObject, 'name'>>): string {
  const stem = base.replace(/\s+\d+$/, '');
  const names = new Set(objects.map((o) => o.name));
  if (!names.has(stem)) return stem;
  for (let i = 2; ; i++) {
    const candidate = `${stem} ${i}`;
    if (!names.has(candidate)) return candidate;
  }
}
