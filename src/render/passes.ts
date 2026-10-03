import {
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Light,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  type Material,
  type Object3D,
  type Scene,
} from 'three';
import type { Editor } from '../model/Editor';
import type { SceneSync } from '../sync/SceneSync';
import { hexToRgb, type PassId } from './plan';

const CLAY_BACKGROUND = new Color(0x8a8a8a);
const BLACK = new Color(0x000000);

/**
 * Linear view-space depth: (far - z) / (far - near), so white is near and black is far.
 * Uses three's skinning/morph chunks so animated actors deform correctly.
 */
const depthVertex = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
varying float vViewZ;
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vViewZ = -mvPosition.z;
}`;

const depthFragment = /* glsl */ `
uniform float near;
uniform float far;
varying float vViewZ;
void main() {
  float d = clamp((far - vViewZ) / (far - near), 0.0, 1.0);
  gl_FragColor = vec4(vec3(d), 1.0);
}`;

/** View-space normals as color: rgb = n * 0.5 + 0.5, flipped on back faces. Skinning-aware. */
const normalVertex = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
varying vec3 vViewNormal;
void main() {
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vViewNormal = transformedNormal;
}`;

const normalFragment = /* glsl */ `
varying vec3 vViewNormal;
void main() {
  vec3 n = normalize(vViewNormal);
  if (!gl_FrontFacing) n = -n;
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}`;

/**
 * Per-pass scene setup. Each pass swaps materials/background/visibility, renders, and restores.
 * Output values are written straight into an 8-bit linear render target, so color_id bytes equal the
 * ID colors exactly and depth bytes are the normalized depth × 255. Clay is tone-mapped separately.
 */
export class Passes {
  readonly clay = new MeshStandardMaterial({ color: 0xbdbdbd, roughness: 0.9, metalness: 0, side: DoubleSide });
  readonly depth = new ShaderMaterial({
    uniforms: { near: { value: 0.5 }, far: { value: 20 } },
    vertexShader: depthVertex,
    fragmentShader: depthFragment,
    side: DoubleSide,
  });
  readonly normals = new ShaderMaterial({ vertexShader: normalVertex, fragmentShader: normalFragment, side: DoubleSide });
  private readonly idMaterials = new Map<string, MeshBasicMaterial>();
  /** Even, soft studio light for clay: the scene's own lights are switched off for this pass. */
  private readonly clayRig = new Group();

  constructor(
    private readonly scene: Scene,
    private readonly floor: Object3D,
    private readonly sync: SceneSync,
    private readonly editor: Editor,
  ) {
    const sky = new HemisphereLight(0xffffff, 0x5a5a5a, 2.2);
    const key = new DirectionalLight(0xffffff, 0.9);
    key.position.set(3, 8, 5);
    this.clayRig.add(sky, key);
  }

  setDepthRange(near: number, far: number): void {
    this.depth.uniforms.near.value = near;
    this.depth.uniforms.far.value = Math.max(far, near + 0.01);
  }

  /** Runs `render` with the scene configured for `pass`, then restores it. */
  run(pass: PassId, render: () => void): void {
    const background = this.scene.background;
    const swapped: Array<[Mesh, Material | Material[]]> = [];
    const floorVisible = this.floor.visible;
    const hiddenLights: Light[] = [];
    try {
      switch (pass) {
        case 'clay':
          this.scene.background = CLAY_BACKGROUND;
          this.scene.overrideMaterial = this.clay;
          this.scene.traverseVisible((o) => {
            if (o instanceof Light) hiddenLights.push(o);
          });
          for (const l of hiddenLights) l.visible = false;
          this.scene.add(this.clayRig);
          break;
        case 'depth':
          this.scene.background = BLACK;
          this.scene.overrideMaterial = this.depth;
          break;
        case 'normals':
          this.scene.background = BLACK;
          this.scene.overrideMaterial = this.normals;
          break;
        case 'pose':
          break; // drawn in 2D by TakeRenderer, no 3D render
        case 'color_id':
          this.scene.background = BLACK;
          this.floor.visible = false;
          for (const [id, root] of this.sync.objectRoots()) {
            const mat = this.idMaterial(id);
            if (!mat) continue;
            root.traverse((o) => {
              if (o instanceof Mesh) {
                swapped.push([o, o.material]);
                o.material = mat;
              }
            });
          }
          break;
      }
      render();
    } finally {
      this.clayRig.removeFromParent();
      for (const l of hiddenLights) l.visible = true;
      this.scene.background = background;
      this.scene.overrideMaterial = null;
      this.floor.visible = floorVisible;
      for (const [mesh, mat] of swapped) mesh.material = mat;
    }
  }

  private idMaterial(id: string): MeshBasicMaterial | undefined {
    const obj = this.editor.find(id);
    if (!obj) return undefined;
    let mat = this.idMaterials.get(id);
    if (!mat) {
      mat = new MeshBasicMaterial({ side: DoubleSide });
      this.idMaterials.set(id, mat);
    }
    // Set the bytes as-is (no sRGB → linear conversion) so the 8-bit output matches the hex exactly.
    const [r, g, b] = hexToRgb(obj.color);
    mat.color.setRGB(r / 255, g / 255, b / 255, LinearSRGBColorSpace);
    return mat;
  }

  dispose(): void {
    this.clay.dispose();
    this.depth.dispose();
    this.normals.dispose();
    for (const m of this.idMaterials.values()) m.dispose();
  }
}
