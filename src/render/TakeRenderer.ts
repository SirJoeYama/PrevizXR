import { Box3, HalfFloatType, PerspectiveCamera, WebGLRenderTarget } from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { App } from '../app/App';
import { verticalFovDeg } from '../camera/lens';
import type { Editor } from '../model/Editor';
import type { Vec3 } from '../model/scene';
import { cameraFrames, sampleTake, type Take } from '../model/take';
import type { SceneSync } from '../sync/SceneSync';
import { Passes } from './passes';
import { autoDepthRange, flipRows, outputName, outputSize, type Box, type PassId } from './plan';
import { Mp4Sink, PngZipSink, canEncodeMp4, type FrameSink } from './sinks';

export interface RenderOptions {
  take: Take;
  shortSide: number;
  passes: PassId[];
  depthNear: number;
  depthFar: number;
  /** mp4: H.264 (falls back to png when WebCodecs can't encode); png: lossless PNG sequence in a zip. */
  format: 'mp4' | 'png';
}

export interface RenderOutput {
  pass: PassId;
  filename: string;
  blob: Blob;
}

export interface RenderProgress {
  frame: number;
  total: number;
  /** Frames rendered per second so far. */
  rate: number;
}

/**
 * Offline, deterministic renderer for takes. Frame k shows the scene at exactly t = k / fps
 * (sampleTake), rendered offscreen at the output resolution for every selected pass, and encoded
 * to H.264 MP4 (or a PNG-sequence zip when WebCodecs can't encode H.264).
 * The interactive loop is paused while it runs.
 */
export class TakeRenderer {
  constructor(
    private readonly app: App,
    private readonly sync: SceneSync,
    private readonly editor: Editor,
  ) {}

  /** Near/far that cover every object from every camera position in the take. */
  autoDepth(take: Take): { near: number; far: number } {
    const boxes: Box[] = [];
    const box = new Box3();
    for (const [, root] of this.sync.objectRoots()) {
      box.setFromObject(root, true);
      if (!box.isEmpty()) boxes.push({ min: box.min.toArray() as Vec3, max: box.max.toArray() as Vec3 });
    }
    const cams = cameraFrames(take);
    const step = Math.max(1, Math.floor(cams.length / 60));
    const positions = cams.filter((_, i) => i % step === 0).map((c) => c.p);
    return autoDepthRange(positions, boxes);
  }

  async willUseMp4(take: Take, shortSide: number): Promise<boolean> {
    const { width, height } = outputSize(take.aspect, shortSide);
    return canEncodeMp4(width, height);
  }

  async render(opts: RenderOptions, onProgress: (p: RenderProgress) => void, signal: AbortSignal): Promise<RenderOutput[]> {
    const { take, passes: passIds } = opts;
    if (!passIds.length) throw new Error('Choose at least one pass.');
    if (this.app.xrSession.presenting) throw new Error('Rendering runs on desktop. Exit VR first.');
    const { width, height } = outputSize(take.aspect, opts.shortSide);
    const total = take.frameCount;
    const r = this.app.renderer;

    await this.sync.whenLoaded();
    const useMp4 = opts.format === 'mp4' && (await canEncodeMp4(width, height));
    const sinks = new Map<PassId, FrameSink>();
    for (const pass of passIds) {
      sinks.set(pass, useMp4 ? await Mp4Sink.create(width, height, take.fps) : new PngZipSink(width, height, pass));
    }

    const camera = new PerspectiveCamera(50, width / height, 0.05, 2000);
    const passes = new Passes(this.app.scene, this.app.floor, this.sync, this.editor);
    passes.setDepthRange(opts.depthNear, opts.depthFar);
    // Clay renders in HDR with 4× MSAA, then gets tone-mapped and sRGB-encoded into the 8-bit read target.
    const hdr = new WebGLRenderTarget(width, height, { type: HalfFloatType, samples: 4 });
    const read = new WebGLRenderTarget(width, height);
    const outputPass = new OutputPass();

    this.app.pause();
    const prevTarget = r.getRenderTarget();
    const started = performance.now();
    try {
      for (let k = 0; k < total; k++) {
        if (signal.aborted) throw new DOMException('Render canceled', 'AbortError');
        const sample = sampleTake(take, k / take.fps);
        this.sync.setTakePoses(sample.objects);
        camera.position.fromArray(sample.camera.p);
        camera.quaternion.fromArray(sample.camera.q);
        camera.fov = verticalFovDeg(sample.camera.focal, take.sensor, take.aspect);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();

        for (const pass of passIds) {
          this.app.withEditorHidden(() =>
            passes.run(pass, () => {
              if (pass === 'clay') {
                r.setRenderTarget(hdr);
                r.render(this.app.scene, camera);
                outputPass.render(r, read, hdr, 0, false);
              } else {
                r.setRenderTarget(read);
                r.render(this.app.scene, camera);
              }
            }),
          );
          // Synchronous read: the async variant polls with setTimeout, which background tabs throttle to a crawl.
          const pixels = new Uint8Array(width * height * 4);
          r.readRenderTargetPixels(read, 0, 0, width, height, pixels);
          flipRows(pixels, width, height);
          await sinks.get(pass)!.add(pixels, k);
        }
        onProgress({ frame: k + 1, total, rate: (k + 1) / ((performance.now() - started) / 1000) });
      }

      const outputs: RenderOutput[] = [];
      for (const [pass, sink] of sinks) {
        outputs.push({ pass, filename: outputName(take.sceneName || this.editor.doc.name, take.name, pass, sink.extension), blob: await sink.finish() });
      }
      return outputs;
    } catch (err) {
      for (const sink of sinks.values()) await sink.cancel().catch(() => {});
      throw err;
    } finally {
      r.setRenderTarget(prevTarget);
      hdr.dispose();
      read.dispose();
      outputPass.dispose();
      passes.dispose();
      this.sync.setTakePoses(null);
      this.app.resume();
    }
  }
}
