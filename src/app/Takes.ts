import type { HudStatus } from '../camera/guides';
import type { VirtualCamera } from '../camera/VirtualCamera';
import type { Editor } from '../model/Editor';
import { createId, type Quat, type Vec3 } from '../model/scene';
import { MAX_TAKE_SECONDS, TakeRecorder, bakeKeyframes, parseTake, sampleTake, serializeTake, type Take } from '../model/take';
import { deleteTake, listTakes, loadTake, saveTake, type TakeSummary } from '../storage/takeStore';
import type { SceneSync } from '../sync/SceneSync';
import { downloadText, slug } from './download';
import type { Playback } from './Playback';

export type TakeState = 'idle' | 'countdown' | 'recording' | 'playing';

const COUNTDOWN_SECONDS = 3;

/**
 * Records and plays back takes for the current scene.
 * Recording: 3-2-1 countdown with the scene held at t = 0, then the preview clock runs from 0
 * and the live camera is sampled every display frame; TakeRecorder resamples to the lens fps.
 * Playback: poses objects and the camera from the take, interpolated at the display rate.
 */
export class Takes {
  state: TakeState = 'idle';
  /** Takes of the current scene, newest first. */
  list: TakeSummary[] = [];
  /** The take being played back. */
  current: Take | null = null;
  playTime = 0;
  /** Loop playback until stopped. */
  loop = false;
  private countdown = 0;
  private recorder: TakeRecorder | null = null;
  private sceneId = '';
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly editor: Editor,
    private readonly sync: SceneSync,
    private readonly playback: Playback,
    private readonly vcam: VirtualCamera,
  ) {
    vcam.status = () => this.status();
    editor.subscribe((c) => {
      if (c === 'doc' && editor.doc.id !== this.sceneId) {
        this.sceneId = editor.doc.id;
        this.stop();
        void this.refresh();
      }
    });
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  get busy(): boolean {
    return this.state !== 'idle';
  }

  async refresh(): Promise<void> {
    try {
      this.list = await listTakes(this.editor.doc.id);
    } catch (err) {
      console.warn('Could not list takes', err);
      this.list = [];
    }
    this.emit();
  }

  /** Starts the countdown, or stops a recording in progress. */
  toggleRecord(): void {
    if (this.state === 'countdown' || this.state === 'recording') this.stop();
    else this.startCountdown();
  }

  startCountdown(): void {
    this.stop();
    this.countdown = COUNTDOWN_SECONDS;
    this.state = 'countdown';
    this.sync.setPreviewTime(0);
    this.emit();
  }

  /** Stops whatever is happening; a recording in progress is saved. */
  stop(): void {
    const was = this.state;
    this.state = 'idle';
    if (was === 'countdown') this.sync.setPreviewTime(null);
    if (was === 'recording') void this.finishRecording();
    if (was === 'playing') {
      this.current = null;
      this.sync.setTakePoses(null);
      this.vcam.setOverride(null);
    }
    if (was !== 'idle') this.emit();
  }

  async play(id: string): Promise<void> {
    const take = await loadTake(id);
    if (take) this.playTake(take);
  }

  playTake(take: Take): void {
    this.stop();
    this.current = take;
    this.playTime = 0;
    this.state = 'playing';
    this.applySample();
    this.emit();
  }

  /** Per frame, after the preview clock has advanced. */
  update(dt: number): void {
    switch (this.state) {
      case 'countdown':
        this.countdown -= dt;
        if (this.countdown <= 0) this.beginRecording();
        break;
      case 'recording':
        if (!this.playback.playing) {
          this.stop(); // the preview was stopped from elsewhere (Space, menu)
          break;
        }
        this.recorder!.push(this.playback.time, this.cameraSample());
        if (this.playback.time >= MAX_TAKE_SECONDS) this.stop();
        break;
      case 'playing': {
        const take = this.current!;
        this.playTime += dt;
        if (this.playTime > take.duration) {
          if (this.loop && take.duration > 0) this.playTime %= take.duration;
          else {
            this.playTime = take.duration;
            this.applySample();
            this.stop();
            break;
          }
        }
        this.applySample();
        break;
      }
    }
  }

  status(): HudStatus | undefined {
    if (this.state === 'countdown') return { countdown: this.countdown };
    if (this.state === 'recording') return { recording: this.playback.time };
    if (this.state === 'playing' && this.current) return { playing: { name: this.current.name, time: this.playTime } };
    return undefined;
  }

  async rename(id: string, name: string): Promise<void> {
    await this.mutate(id, (t) => (t.name = name));
  }

  async setSmoothing(id: string, smoothing: number): Promise<void> {
    await this.mutate(id, (t) => (t.smoothing = Math.max(0, Math.min(1, smoothing))));
  }

  async remove(id: string): Promise<void> {
    if (this.current?.id === id) this.stop();
    await deleteTake(id);
    await this.refresh();
  }

  async exportTake(id: string): Promise<void> {
    const take = await loadTake(id);
    if (take) downloadText(`${slug(take.sceneName || 'scene')}-${slug(take.name)}.take.json`, serializeTake(take));
  }

  /** Imports a take file into the current scene (objects are matched by id; unknown ones are ignored). */
  async importFile(file: File): Promise<Take> {
    const take = parseTake(await file.text());
    if (await loadTake(take.id)) take.id = createId();
    take.sceneId = this.editor.doc.id;
    await saveTake(take);
    await this.refresh();
    return take;
  }

  /** Bakes the keyframed camera path into a take; saves it, or just plays it as a preview. */
  async bakePath(save: boolean): Promise<Take> {
    const doc = this.editor.doc;
    const take = bakeKeyframes(doc, { id: createId(), name: save ? this.nextName('Path') : 'Path preview', sceneId: doc.id, sceneName: doc.name });
    if (save) {
      await saveTake(take);
      await this.refresh();
    } else {
      this.playTake(take);
    }
    return take;
  }

  private beginRecording(): void {
    const lens = this.editor.doc.camera.lens;
    this.recorder = new TakeRecorder(lens.fps, structuredClone(this.editor.doc));
    this.state = 'recording';
    this.playback.play();
    this.recorder.push(0, this.cameraSample());
    this.emit();
  }

  private async finishRecording(): Promise<void> {
    const rec = this.recorder;
    this.recorder = null;
    if (this.playback.playing) this.playback.stop();
    if (!rec || rec.frames.length < 2) return;
    const doc = this.editor.doc;
    const lens = doc.camera.lens;
    const take = rec.finish({
      id: createId(),
      name: this.nextName('Take'),
      sceneId: doc.id,
      sceneName: doc.name,
      fps: rec.fps,
      sensor: lens.sensor,
      aspect: lens.aspect,
      source: 'handheld',
    });
    try {
      await saveTake(take);
    } catch (err) {
      console.error('Could not save the take', err);
    }
    await this.refresh();
  }

  private cameraSample() {
    const root = this.vcam.root;
    return {
      p: root.position.toArray() as Vec3,
      q: root.quaternion.toArray() as Quat,
      focal: this.editor.doc.camera.lens.focalLength,
      focus: this.vcam.focusDistance,
    };
  }

  private applySample(): void {
    const sample = sampleTake(this.current!, this.playTime);
    this.sync.setTakePoses(sample.objects);
    this.vcam.setOverride(sample.camera);
  }

  private nextName(prefix: string): string {
    let n = 0;
    for (const t of this.list) {
      const m = t.name.match(new RegExp(`^${prefix} (\\d+)$`));
      if (m) n = Math.max(n, +m[1]);
    }
    return `${prefix} ${n + 1}`;
  }

  private async mutate(id: string, change: (t: Take) => void): Promise<void> {
    const take = this.current?.id === id ? this.current : await loadTake(id);
    if (!take) return;
    change(take);
    await saveTake(take);
    await this.refresh();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
