import type { SceneSync } from '../sync/SceneSync';

/**
 * Scene preview clock: plays actor paths and clips from t = 0.
 * Time only advances in tick(), and the scene is evaluated from the time value alone,
 * so the same t always produces the same pose (milestone 4 reuses this for takes).
 */
export class Playback {
  time = 0;
  playing = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly sync: SceneSync) {}

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  play(): void {
    this.time = 0;
    this.playing = true;
    this.sync.setPreviewTime(0);
    this.emit();
  }

  stop(): void {
    this.playing = false;
    this.time = 0;
    this.sync.setPreviewTime(null);
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.stop();
    else this.play();
  }

  tick(dt: number): void {
    if (!this.playing) return;
    this.time += dt;
    this.sync.setPreviewTime(this.time);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
