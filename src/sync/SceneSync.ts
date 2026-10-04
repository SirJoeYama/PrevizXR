import {
  AnimationMixer,
  Box3,
  BoxGeometry,
  Box3Helper,
  BufferGeometry,
  Color,
  ConeGeometry,
  EdgesGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PointLight,

  LoopOnce,
  SphereGeometry,
  SpotLight,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Light,
  type Sprite,
} from 'three';
import type { AssetLoader } from '../assets/AssetLoader';
import { isOneShotClip } from '../assets/mesh2motion';
import type { Editor } from '../model/Editor';
import { polyline, resolveHandles, segments } from '../model/bezier';
import { objectPoseAt, type ObjectPose } from '../model/motion';
import { assetKey, pathOf, type ActorClip, type SceneObject } from '../model/scene';
import { drawLabel, makeLabel } from './labels';

interface Entry {
  id: string;
  root: Group;
  key: string;
  content: Object3D | null;
  /** Bumped on each (re)load so a slow load can't overwrite a newer one. */
  loadToken: number;
  height: number;
  mixer?: AnimationMixer;
  /** Clips by name: basic clips (idle, walk, run, sit) and, for library characters, every clip in their library. */
  actions: Map<ActorClip, AnimationAction>;
  activeClip?: ActorClip;
  activeAction?: AnimationAction;
  /** Library character (Mesh2Motion catalog key) whose further clips load on first use. */
  libraryKey?: string;
  /** Library clips already requested (loaded, loading or missing), so each is fetched once. */
  requestedClips: Set<string>;
  light?: Light;
  label: Sprite;
  labelSig: string;
  path?: Group;
  pathSig: string;
}

/** How basic clips are found in models that come with their own few clips (bundled actors). */
const CLIP_PATTERNS: Record<string, RegExp> = {
  idle: /(^|[|_])idle$/i,
  walk: /(^|[|_])walk(ing)?$/i,
  run: /(^|[|_])run(ning)?$/i,
  sit: /(^|[|_])(sitting|sit_?idle|sit)$/i,
};

export const LIGHT_SPAWN_INTENSITY = { point: 30, spot: 120, directional: 2 };

const placeholderGeo = new EdgesGeometry(new BoxGeometry(0.5, 0.5, 0.5).translate(0, 0.25, 0));
const placeholderMat = new LineBasicMaterial({ color: 0x8b93a5 });
const errorMat = new LineBasicMaterial({ color: 0xff4d4d });
const tmpBox = new Box3();
const pathDotGeo = new SphereGeometry(0.06, 12, 8);

/**
 * Derives the Three.js scene graph from the Editor's SceneDoc. One-way: model → Three.js.
 * Interaction code may move a root directly while dragging but must write the result back to the Editor.
 */
export class SceneSync {
  /** Parent of every object root: the only subtree that export passes render. */
  readonly root = new Group();
  /** Labels, paths and selection outline: visible while editing, never rendered in passes. */
  readonly helpers = new Group();
  private readonly entries = new Map<string, Entry>();
  /** Roots owned elsewhere (the virtual camera) that can still be picked, selected and moved. */
  private readonly external = new Map<string, Object3D>();
  /** Editor-only parts inside object content (light bulbs, loading boxes), hidden in clean renders. */
  readonly inlineHelpers = new Set<Object3D>();
  private readonly loading = new Set<Promise<void>>();
  /** Roots of objects marked "hide in renders" (reference images and the like). */
  readonly renderHidden = new Set<Object3D>();
  private readonly selectionBounds = new Box3();
  /** Precise bounds (skinned meshes included), refreshed every frame for the selected object. */
  private readonly selectionBox = new Box3Helper(this.selectionBounds, 0xffb547);
  private previewTime: number | null = null;
  private frame = 0;
  /** Poses from a take being played back, by object id (overrides model and preview). */
  private takePoses: Record<string, ObjectPose> | null = null;

  constructor(
    private readonly editor: Editor,
    private readonly loader: AssetLoader,
  ) {
    this.root.name = 'SceneObjects';
    this.helpers.name = 'EditorHelpers';
    this.helpers.userData.helper = true;
    this.selectionBox.visible = false;
    this.selectionBox.raycast = () => {};
    this.helpers.add(this.selectionBox);
    editor.subscribe((change) => {
      if (change === 'doc') this.reconcile();
      if (change === 'selection' || change === 'doc') this.updateSelection();
    });
    this.reconcile();
  }

  get previewing(): boolean {
    return this.previewTime !== null;
  }

  /** Root Object3D of a scene object or registered external root (moves with its transform). */
  rootOf(id: string): Object3D | undefined {
    return this.entries.get(id)?.root ?? this.external.get(id);
  }

  /** Resolves once every object's model has finished loading (or failed). */
  async whenLoaded(): Promise<void> {
    while (this.loading.size) await Promise.allSettled([...this.loading]);
  }

  /** Scene object roots by id (for render passes that swap materials per object). */
  objectRoots(): Array<[string, Object3D]> {
    return [...this.entries].map(([id, e]) => [id, e.root]);
  }

  /** Makes an externally managed root pickable and selectable under `id`. */
  registerRoot(id: string, root: Object3D): void {
    root.userData.objectId = id;
    this.external.set(id, root);
  }

  /** Everything a pointer can select. */
  get pickRoots(): Object3D[] {
    return [this.root, ...this.external.values()];
  }

  /** Scene object id that owns a hit object, or null. */
  objectIdOf(obj: Object3D | null): string | null {
    for (let o = obj; o; o = o.parent) if (typeof o.userData.objectId === 'string') return o.userData.objectId;
    return null;
  }

  /**
   * Shows the scene as it is at time t (seconds): actors follow their paths with clip times set exactly.
   * Pass null to go back to editing (live animation, actors at their start marks).
   */
  setPreviewTime(t: number | null): void {
    this.previewTime = t;
    for (const obj of this.editor.doc.objects) this.applyPose(obj);
  }

  /**
   * Shows recorded poses (take playback). Objects missing from the take keep their scene pose.
   * Pass null to go back to the model.
   */
  setTakePoses(poses: Record<string, ObjectPose> | null): void {
    this.takePoses = poses;
    for (const obj of this.editor.doc.objects) this.applyPose(obj);
  }

  /** Per-frame update while editing (live clips, labels, selection box). */
  tick(dt: number): void {
    for (const e of this.entries.values()) {
      if (e.mixer && this.previewTime === null && !this.takePoses) e.mixer.update(dt);
      this.placeLabel(e);
    }
    // Precise bounds walk every vertex (skinned ones on the CPU): refresh a few times a second, not every frame.
    if (++this.frame % 6 === 0) {
      const sel = this.editor.selectedId ? this.entries.get(this.editor.selectedId)?.root : undefined;
      if (sel) this.selectionBounds.setFromObject(sel, true);
    }
  }

  private reconcile(): void {
    const seen = new Set<string>();
    for (const obj of this.editor.doc.objects) {
      seen.add(obj.id);
      let e = this.entries.get(obj.id);
      if (!e) {
        e = this.create(obj);
        this.entries.set(obj.id, e);
      }
      const key = assetKey(obj.asset);
      if (e.key !== key) {
        e.key = key;
        const p = this.loadContent(e, obj);
        this.loading.add(p);
        void p.finally(() => this.loading.delete(p));
      }
      this.applyLight(e, obj);
      const sig = `${obj.name}|${obj.color}`;
      if (sig !== e.labelSig) {
        e.labelSig = sig;
        drawLabel(e.label, obj.name, obj.color);
      }
      this.updatePath(e, obj);
      if (obj.hiddenInRenders) this.renderHidden.add(e.root);
      else this.renderHidden.delete(e.root);
      this.applyPose(obj);
    }
    for (const [id, e] of this.entries) if (!seen.has(id)) this.destroy(e);
  }

  private create(obj: SceneObject): Entry {
    const root = new Group();
    root.name = obj.name;
    root.userData.objectId = obj.id;
    this.root.add(root);
    const label = makeLabel(obj.name, obj.color);
    this.helpers.add(label);
    return { id: obj.id, root, key: '', content: null, loadToken: 0, height: 0.5, actions: new Map(), requestedClips: new Set(), label, labelSig: '', pathSig: '' };
  }

  private destroy(e: Entry): void {
    this.setContent(e, null);
    this.renderHidden.delete(e.root);
    e.root.removeFromParent();
    e.label.removeFromParent();
    e.label.material.map?.dispose();
    e.label.material.dispose();
    this.removePath(e);
    e.mixer?.stopAllAction();
    this.entries.delete(e.id);
  }

  private async loadContent(e: Entry, obj: SceneObject): Promise<void> {
    const token = ++e.loadToken;
    this.setContent(e, null);
    e.mixer?.stopAllAction();
    e.mixer = undefined;
    e.actions.clear();
    e.activeClip = undefined;
    e.activeAction = undefined;
    e.requestedClips.clear();
    e.libraryKey = obj.asset.source === 'm2m' ? obj.asset.id : undefined;

    if (obj.asset.source === 'light') {
      this.setContent(e, this.buildLight(e, obj));
      return;
    }

    const placeholder = new LineSegments(placeholderGeo, placeholderMat);
    placeholder.userData.helper = true;
    this.setContent(e, placeholder);
    try {
      const { object, clips, roles } = await this.loader.load(obj.asset);
      if (token !== e.loadToken || !this.entries.has(e.id)) return;
      this.setContent(e, object);
      if (clips.length) this.setupClips(e, object, clips, roles);
      const current = this.editor.find(e.id);
      if (current) this.applyPose(current);
    } catch (err) {
      if (token !== e.loadToken) return;
      console.warn(`Could not load ${obj.name}`, err);
      const failed = new LineSegments(placeholderGeo, errorMat);
      failed.userData.helper = true;
      this.setContent(e, failed);
    }
  }

  private setContent(e: Entry, content: Object3D | null): void {
    if (e.content) {
      e.root.remove(e.content);
      e.content.traverse((o) => this.inlineHelpers.delete(o));
    }
    e.content = content;
    if (!content) return;
    e.root.add(content);
    content.traverse((o) => {
      if (o.userData.helper) this.inlineHelpers.add(o);
    });
    tmpBox.setFromObject(content, true);
    e.height = tmpBox.isEmpty() ? 0.5 : Math.max(tmpBox.max.y, 0.2);
  }

  private setupClips(e: Entry, model: Object3D, clips: AnimationClip[], roles?: Record<string, string>): void {
    e.mixer = new AnimationMixer(model);
    if (roles) {
      for (const c of clips) this.addAction(e, c);
      for (const [basic, name] of Object.entries(roles)) {
        const action = e.actions.get(name);
        if (action) e.actions.set(basic, action);
      }
      return;
    }
    for (const [clip, pattern] of Object.entries(CLIP_PATTERNS)) {
      const match = clips.find((c) => pattern.test(c.name));
      if (match) e.actions.set(clip, e.mixer.clipAction(match));
    }
  }

  /** Library clips: one-shots (deaths, attacks, transitions) play once and hold their last pose. */
  private addAction(e: Entry, clip: AnimationClip): void {
    const action = e.mixer!.clipAction(clip);
    if (isOneShotClip(clip.name)) {
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    e.actions.set(clip.name, action);
  }

  /** Loads a library clip the actor doesn't have yet (add-on and mocap files load on first use). */
  private requestClip(e: Entry, clip: ActorClip): void {
    const key = e.libraryKey;
    if (!key || e.requestedClips.has(clip)) return;
    e.requestedClips.add(clip);
    const token = e.loadToken;
    const p = this.loader
      .loadM2MClip(key, clip)
      .then((loaded) => {
        if (!loaded || token !== e.loadToken || !e.mixer) return;
        this.addAction(e, loaded);
        if (loaded.name !== clip) e.actions.set(clip, e.actions.get(loaded.name)!);
        e.activeClip = undefined; // replay with the real clip
        const obj = this.editor.find(e.id);
        if (obj) this.applyPose(obj);
      })
      .catch((err) => console.warn(`Could not load clip ${clip}`, err));
    this.loading.add(p);
    void p.finally(() => this.loading.delete(p));
  }

  /** Makes sure every clip a take uses is loaded (call before rendering it, then await whenLoaded()). */
  prepareClips(frames: ReadonlyArray<{ objects: Record<string, ObjectPose> }>): void {
    const wanted = new Map<string, Set<string>>();
    for (const f of frames) {
      for (const [id, pose] of Object.entries(f.objects)) {
        if (!pose.clip) continue;
        let set = wanted.get(id);
        if (!set) wanted.set(id, (set = new Set()));
        set.add(pose.clip);
      }
    }
    for (const [id, clips] of wanted) {
      const e = this.entries.get(id);
      if (e?.mixer) for (const c of clips) if (!e.actions.has(c)) this.requestClip(e, c);
    }
  }

  private buildLight(e: Entry, obj: SceneObject): Object3D {
    const group = new Group();
    const type = obj.asset.id;
    const color = obj.light?.color ?? '#ffffff';
    const intensity = obj.light?.intensity ?? LIGHT_SPAWN_INTENSITY.point;
    let light: Light;
    if (type === 'spot') {
      const spot = new SpotLight(color, intensity, 0, Math.PI / 6, 0.4, 2);
      spot.target.position.set(0, -1, 0);
      group.add(spot.target);
      light = spot;
      const cone = new Mesh(new ConeGeometry(0.08, 0.16, 16, 1, true), new MeshBasicMaterial({ color, wireframe: true }));
      cone.position.y = -0.08;
      cone.userData.helper = true;
      group.add(cone);
    } else {
      light = new PointLight(color, intensity, 0, 2);
    }
    group.add(light);
    const bulb = new Mesh(new SphereGeometry(0.06, 16, 12), new MeshBasicMaterial({ color }));
    bulb.userData.helper = true;
    group.add(bulb);
    e.light = light;
    return group;
  }

  private applyLight(e: Entry, obj: SceneObject): void {
    if (!e.light || !obj.light) return;
    e.light.color.set(obj.light.color);
    e.light.intensity = obj.light.intensity;
    e.content?.traverse((o) => {
      if (o instanceof Mesh && o.material instanceof MeshBasicMaterial) o.material.color = new Color(obj.light!.color);
    });
  }

  private applyPose(obj: SceneObject): void {
    const e = this.entries.get(obj.id);
    if (!e) return;
    const recorded = this.takePoses?.[obj.id];
    const pose = recorded ?? (this.previewTime !== null ? objectPoseAt(obj, this.previewTime) : null);
    const { position, rotation, scale } = obj.transform;
    e.root.position.fromArray(pose?.p ?? position);
    e.root.quaternion.fromArray(pose?.q ?? rotation);
    e.root.scale.fromArray(pose?.s ?? scale);
    if (!obj.actor) return;
    this.playClip(e, pose?.clip ?? obj.actor.clip);
    if (pose?.t !== undefined && e.mixer) {
      // A one-shot that finished is paused; scrubbing back must play it again.
      if (e.activeAction) e.activeAction.paused = false;
      e.mixer.setTime(pose.t);
    }
  }

  private playClip(e: Entry, clip: ActorClip): void {
    if (e.activeClip === clip || !e.mixer) return;
    if (!e.actions.has(clip)) this.requestClip(e, clip);
    const action = e.actions.get(clip) ?? e.actions.get('idle');
    if (!action) return;
    e.mixer.stopAllAction();
    action.reset().play();
    e.activeClip = clip;
    e.activeAction = action;
  }

  /** The path drawn as its Bézier curve, with a dot per waypoint. */
  private updatePath(e: Entry, obj: SceneObject): void {
    const path = pathOf(obj);
    const points = path && path.waypoints.length ? [obj.transform.position, ...path.waypoints] : [];
    const sig = `${obj.color}|${JSON.stringify(points)}|${path?.loop}|${JSON.stringify(path?.handles ?? null)}`;
    if (sig === e.pathSig) return;
    e.pathSig = sig;
    this.removePath(e);
    if (!path || !points.length) return;

    const group = new Group();
    group.userData.helper = true;
    const curve = polyline(segments(points, resolveHandles(points, path.handles, path.loop), path.loop));
    const lineGeo = new BufferGeometry().setFromPoints(curve.map((p) => new Vector3(p[0], p[1] + 0.02, p[2])));
    const line = new Line(lineGeo, new LineBasicMaterial({ color: obj.color }));
    line.raycast = () => {};
    group.add(line);
    const dotMat = new MeshBasicMaterial({ color: obj.color });
    path.waypoints.forEach((w) => {
      const dot = new Mesh(pathDotGeo, dotMat);
      dot.position.set(w[0], w[1] + 0.02, w[2]);
      dot.raycast = () => {};
      group.add(dot);
    });
    e.path = group;
    this.helpers.add(group);
  }

  private removePath(e: Entry): void {
    if (!e.path) return;
    e.path.removeFromParent();
    // Paths rebuild every frame while a point is dragged: free what each build allocated.
    e.path.traverse((o) => {
      if (o instanceof Line) o.geometry.dispose();
      if (o instanceof Line || o instanceof Mesh) (o.material as MeshBasicMaterial).dispose();
    });
    e.path = undefined;
  }

  private placeLabel(e: Entry): void {
    e.label.position.copy(e.root.position);
    e.label.position.y += e.height * e.root.scale.y + 0.18;
  }

  private updateSelection(): void {
    // External roots (the camera) show their own selection cues: gizmo and frustum lines.
    const sel = this.editor.selectedId ? this.entries.get(this.editor.selectedId)?.root : undefined;
    this.selectionBox.visible = !!sel;
    if (sel) this.selectionBounds.setFromObject(sel, true);
  }
}
