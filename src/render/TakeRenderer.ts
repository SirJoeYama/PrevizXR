import { Box3, HalfFloatType, PerspectiveCamera, WebGLRenderTarget } from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { App } from '../app/App';
import { sceneCredits } from '../assets/credits';
import { verticalFovDeg } from '../camera/lens';
import type { Editor } from '../model/Editor';
import type { Vec3 } from '../model/scene';
import { serializeScene } from '../model/serialize';
import { cameraFrames, sampleTake, serializeTake, type Take } from '../model/take';
import type { SceneSync } from '../sync/SceneSync';
import { cameraGlb, cameraTrackJson } from './cameraExport';
import { buildManifest, creditsText } from './manifest';
import { Passes } from './passes';
import { autoDepthRange, flipRows, outputName, outputSize, type Box, type PassId } from './plan';
import { drawPoses } from './pose';
import { PoseExtractor } from './poseExtractor';
import { Mp4Sink, PngSequenceSink, canEncodeMp4, zipFiles, type FrameSink } from './sinks';

export interface RenderOptions {
  take: Take;
  shortSide: number;
  passes: PassId[];
  depthNear: number;
  depthFar: number;
  /** mp4: H.264 (falls back to png when WebCodecs can't encode); png: lossless PNG sequences. */
  format: 'mp4' | 'png';
}

export interface RenderFile {
  name: string;
  blob: Blob;
}

export interface RenderResult {
  /** Everything for the take in one zip, with manifest.json. */
  bundle: RenderFile;
  /** Individually downloadable files (MP4 passes and the camera exports). */
  files: RenderFile[];
}

export interface RenderProgress {
  frame: number;
  total: number;
  /** Frames rendered per second so far. */
  rate: number;
}

const encoder = new TextEncoder();
const json = (v: unknown) => encoder.encode(JSON.stringify(v, null, 2));
const blob = (bytes: Uint8Array, type: string) => new Blob([bytes as Uint8Array<ArrayBuffer>], { type });

/**
 * Offline, deterministic renderer for takes. Frame k shows the scene at exactly t = k / fps
 * (sampleTake), rendered offscreen at the output resolution for every selected pass, encoded
 * to H.264 MP4 or PNG sequences, and bundled with the camera, take, scene, manifest and credits.
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

  async render(opts: RenderOptions, onProgress: (p: RenderProgress) => void, signal: AbortSignal): Promise<RenderResult> {
    const { take, passes: passIds } = opts;
    if (!passIds.length) throw new Error('Choose at least one pass.');
    if (this.app.xrSession.presenting) throw new Error('Rendering runs on desktop. Exit VR first.');
    const { width, height } = outputSize(take.aspect, opts.shortSide);
    const total = take.frameCount;
    const r = this.app.renderer;
    const doc = structuredClone(this.editor.doc);
    const sceneName = take.sceneName || doc.name;

    this.sync.prepareClips(take.frames); // library clips the take uses but nobody has played yet
    await this.sync.whenLoaded();
    const useMp4 = opts.format === 'mp4' && (await canEncodeMp4(width, height));
    const sinks = new Map<PassId, FrameSink>();
    for (const pass of passIds) {
      sinks.set(pass, useMp4 ? await Mp4Sink.create(pass, width, height, take.fps) : new PngSequenceSink(pass, width, height));
    }

    const camera = new PerspectiveCamera(50, width / height, 0.05, 2000);
    const passes = new Passes(this.app.scene, this.app.floor, this.sync, this.editor);
    passes.setDepthRange(opts.depthNear, opts.depthFar);
    const pose = passIds.includes('pose') ? new PoseExtractor(this.sync, this.editor) : null;
    const poseCtx = pose ? new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })! : null;
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
        this.app.scene.updateMatrixWorld();

        for (const pass of passIds) {
          let pixels: Uint8Array;
          if (pass === 'pose') {
            drawPoses(poseCtx!, pose!.project(camera, width, height), width, height);
            pixels = new Uint8Array(poseCtx!.getImageData(0, 0, width, height).data.buffer);
          } else {
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
            pixels = new Uint8Array(width * height * 4);
            r.readRenderTargetPixels(read, 0, 0, width, height, pixels);
            flipRows(pixels, width, height);
          }
          await sinks.get(pass)!.add(pixels, k);
        }
        onProgress({ frame: k + 1, total, rate: (k + 1) / ((performance.now() - started) / 1000) });
      }

      // Bundle: passes + camera + take + scene + manifest + credits, in a folder named after the take.
      const folder = outputName(sceneName, take.name, 'previz', 'x').slice(0, -2);
      const content: Record<string, Uint8Array> = {};
      const individual: RenderFile[] = [];
      for (const sink of sinks.values()) {
        for (const [path, bytes] of Object.entries(await sink.finish())) {
          content[path] = bytes;
          if (sink.format === 'mp4') individual.push({ name: outputName(sceneName, take.name, path.replace(/\.mp4$/, ''), 'mp4'), blob: blob(bytes, 'video/mp4') });
        }
      }
      const credits = sceneCredits(doc);
      content['camera.json'] = json(cameraTrackJson(take, width, height));
      content['camera.glb'] = await cameraGlb(take);
      content['take.json'] = encoder.encode(serializeTake(take));
      content['scene.json'] = encoder.encode(serializeScene(doc));
      content['CREDITS.txt'] = encoder.encode(creditsText(credits, doc.name));
      content['manifest.json'] = json(
        buildManifest({
          take,
          doc,
          width,
          height,
          passes: [...sinks].map(([pass, sink]) => ({ pass, path: sink.path, format: sink.format })),
          depth: { near: opts.depthNear, far: opts.depthFar },
          credits,
          poseUnmatched: pose?.unmatched ?? [],
          appVersion: __APP_VERSION__,
        }),
      );
      individual.push(
        { name: outputName(sceneName, take.name, 'camera', 'json'), blob: blob(content['camera.json'], 'application/json') },
        { name: outputName(sceneName, take.name, 'camera', 'glb'), blob: blob(content['camera.glb'], 'model/gltf-binary') },
      );
      const prefixed: Record<string, Uint8Array> = {};
      for (const [path, bytes] of Object.entries(content)) prefixed[`${folder}/${path}`] = bytes;
      return { bundle: { name: `${folder}.zip`, blob: blob(zipFiles(prefixed), 'application/zip') }, files: individual };
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
