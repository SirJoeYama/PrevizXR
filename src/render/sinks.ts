import { zipSync } from 'fflate';
import { encodePng } from './png';
import { BufferTarget, Mp4OutputFormat, Output, QUALITY_VERY_HIGH, VideoSample, VideoSampleSource, canEncodeVideo } from 'mediabunny';

/** Receives rendered RGBA frames (top-down rows) for one pass and produces a file. */
export interface FrameSink {
  readonly extension: 'mp4' | 'zip';
  add(pixels: Uint8Array, frame: number): Promise<void>;
  finish(): Promise<Blob>;
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
  readonly extension = 'mp4' as const;
  private readonly output: Output<Mp4OutputFormat, BufferTarget>;
  private readonly source: VideoSampleSource;

  private constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly fps: number,
  ) {
    this.output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    this.source = new VideoSampleSource({ codec: 'avc', quality: QUALITY_VERY_HIGH, keyFrameInterval: 1 });
    this.output.addVideoTrack(this.source, { frameRate: fps });
  }

  static async create(width: number, height: number, fps: number): Promise<Mp4Sink> {
    const sink = new Mp4Sink(width, height, fps);
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

  async finish(): Promise<Blob> {
    await this.output.finalize();
    return new Blob([this.output.target.buffer!], { type: 'video/mp4' });
  }

  async cancel(): Promise<void> {
    if (this.output.state === 'started' || this.output.state === 'pending') await this.output.cancel();
  }
}

const ZIP_EPOCH = new Date('2000-01-01T00:00:00Z');

/** Lossless PNG frames in a zip (also the fallback without WebCodecs). */
export class PngZipSink implements FrameSink {
  readonly extension = 'zip' as const;
  private readonly files: Record<string, Uint8Array> = {};

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly prefix: string,
  ) {}

  async add(pixels: Uint8Array, frame: number): Promise<void> {
    this.files[`${this.prefix}_${String(frame).padStart(5, '0')}.png`] = encodePng(pixels, this.width, this.height);
  }

  async finish(): Promise<Blob> {
    // PNGs are already compressed: store them without deflating again.
    // Fixed timestamps keep the archive byte-identical for identical renders.
    const zipped = zipSync(this.files, { level: 0, mtime: ZIP_EPOCH });
    return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
  }

  async cancel(): Promise<void> {
    for (const k of Object.keys(this.files)) delete this.files[k];
  }
}
