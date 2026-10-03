import { zipSync } from 'fflate';
import { encodePng } from './png';
import { BufferTarget, Mp4OutputFormat, Output, QUALITY_VERY_HIGH, VideoSample, VideoSampleSource, canEncodeVideo } from 'mediabunny';

/** Receives rendered RGBA frames (top-down rows) for one pass and produces files. */
export interface FrameSink {
  readonly format: 'mp4' | 'png-sequence';
  /** File (mp4) or folder (png) this sink writes, relative to the bundle root. */
  readonly path: string;
  add(pixels: Uint8Array, frame: number): Promise<void>;
  /** Relative path → bytes. */
  finish(): Promise<Record<string, Uint8Array>>;
  cancel(): Promise<void>;
}

/** True when this browser can encode H.264 at this size with WebCodecs. */
export async function canEncodeMp4(width: number, height: number): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  try {
    return await canEncodeVideo('avc', { width, height, quality: QUALITY_VERY_HIGH });
  } catch {
    return false;
  }
}

/** H.264 MP4 via WebCodecs + Mediabunny, constant frame rate. */
export class Mp4Sink implements FrameSink {
  readonly format = 'mp4' as const;
  readonly path: string;
  private readonly output: Output<Mp4OutputFormat, BufferTarget>;
  private readonly source: VideoSampleSource;

  private constructor(
    name: string,
    private readonly width: number,
    private readonly height: number,
    private readonly fps: number,
  ) {
    this.path = `${name}.mp4`;
    this.output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    this.source = new VideoSampleSource({ codec: 'avc', quality: QUALITY_VERY_HIGH, keyFrameInterval: 1 });
    this.output.addVideoTrack(this.source, { frameRate: fps });
  }

  static async create(name: string, width: number, height: number, fps: number): Promise<Mp4Sink> {
    const sink = new Mp4Sink(name, width, height, fps);
    await sink.output.start();
    return sink;
  }

  async add(pixels: Uint8Array, frame: number): Promise<void> {
    const sample = new VideoSample(pixels, {
      format: 'RGBA',
      codedWidth: this.width,
      codedHeight: this.height,
      timestamp: frame / this.fps,
      duration: 1 / this.fps,
    });
    try {
      await this.source.add(sample);
    } finally {
      sample.close();
    }
  }

  async finish(): Promise<Record<string, Uint8Array>> {
    await this.output.finalize();
    return { [this.path]: new Uint8Array(this.output.target.buffer!) };
  }

  async cancel(): Promise<void> {
    if (this.output.state === 'started' || this.output.state === 'pending') await this.output.cancel();
  }
}

/** Fixed zip timestamps keep bundles byte-identical for identical renders. */
export const ZIP_EPOCH = new Date('2000-01-01T00:00:00Z');

/** Zips files: media stored as-is (already compressed), text deflated. */
export function zipFiles(files: Record<string, Uint8Array>): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [name, data] of Object.entries(files)) entries[name] = [data, { level: /\.(json|txt)$/.test(name) ? 6 : 0 }];
  return zipSync(entries, { mtime: ZIP_EPOCH });
}

/** Lossless PNG frames, one file per frame in a folder (also the fallback without WebCodecs). */
export class PngSequenceSink implements FrameSink {
  readonly format = 'png-sequence' as const;
  readonly path: string;
  private readonly files: Record<string, Uint8Array> = {};

  constructor(
    private readonly name: string,
    private readonly width: number,
    private readonly height: number,
  ) {
    this.path = `${name}/`;
  }

  async add(pixels: Uint8Array, frame: number): Promise<void> {
    this.files[`${this.path}${this.name}_${String(frame).padStart(5, '0')}.png`] = encodePng(pixels, this.width, this.height);
  }

  async finish(): Promise<Record<string, Uint8Array>> {
    return this.files;
  }

  async cancel(): Promise<void> {
    for (const k of Object.keys(this.files)) delete this.files[k];
  }
}
