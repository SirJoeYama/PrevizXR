import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type BufferGeometry,
  type Object3D,
} from 'three';
import type { PrimitiveId } from '../model/scene';

const material = new MeshStandardMaterial({ color: 0xb8bcc6, roughness: 0.85, metalness: 0 });
const dark = new MeshStandardMaterial({ color: 0x3a3e46, roughness: 0.9, metalness: 0 });

/** Box with its base (not its centre) at y. */
function block(w: number, h: number, d: number, x = 0, y = 0, z = 0, mat = material): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  return m;
}

function wheel(x: number, z: number): Mesh {
  const geo: BufferGeometry = new CylinderGeometry(0.33, 0.33, 0.24, 20);
  geo.rotateZ(Math.PI / 2);
  const m = new Mesh(geo, dark);
  m.position.set(x, 0.33, z);
  return m;
}

/** Procedural blockout shapes: low-poly, real-world sized, base on the floor, front facing +Z. */
export function buildPrimitive(id: PrimitiveId): Object3D {
  const g = new Group();
  switch (id) {
    case 'box':
      g.add(block(1, 1, 1));
      break;
    case 'cylinder': {
      const m = new Mesh(new CylinderGeometry(0.5, 0.5, 1, 32), material);
      m.position.y = 0.5;
      g.add(m);
      break;
    }
    case 'wall':
      g.add(block(3, 2.7, 0.15));
      break;
    case 'door':
      g.add(block(0.1, 2.2, 0.15, -0.5), block(0.1, 2.2, 0.15, 0.5), block(1.1, 0.1, 0.15, 0, 2.1));
      g.add(block(0.88, 2.08, 0.04, 0, 0.01, 0, dark));
      break;
    case 'chair':
      g.add(block(0.46, 0.05, 0.46, 0, 0.42));
      g.add(block(0.46, 0.45, 0.05, 0, 0.47, -0.205));
      for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) g.add(block(0.04, 0.42, 0.04, x, 0, z));
      break;
    case 'table':
      g.add(block(1.6, 0.05, 0.9, 0, 0.7));
      for (const [x, z] of [[-0.74, -0.39], [0.74, -0.39], [-0.74, 0.39], [0.74, 0.39]]) g.add(block(0.06, 0.7, 0.06, x, 0, z));
      break;
    case 'car':
      g.add(block(1.8, 0.65, 4.5, 0, 0.3));
      g.add(block(1.6, 0.55, 2.3, 0, 0.95, -0.25));
      g.add(wheel(-0.85, 1.4), wheel(0.85, 1.4), wheel(-0.85, -1.4), wheel(0.85, -1.4));
      break;
  }
  return g;
}
