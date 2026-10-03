import {
  AxesHelper,
  CircleGeometry,
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
} from 'three';

/**
 * Stage furniture that is not part of the user's scene model: floor, grid and default lighting.
 * Tagged with userData.helper so export passes can exclude it.
 */
export function buildEnvironment(): Group {
  const env = new Group();
  env.name = 'Environment';

  const floor = new Mesh(
    new CircleGeometry(30, 64),
    new MeshStandardMaterial({ color: 0x2a2e36, roughness: 1, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'Floor';
  env.add(floor);

  const major = new GridHelper(20, 20, 0x5a6273, 0x3c4250);
  major.position.y = 0.001;
  major.name = 'GridMajor';
  env.add(major);

  const minor = new GridHelper(4, 16, 0x3a404d, 0x323743);
  minor.position.y = 0.0005;
  minor.name = 'GridMinor';
  env.add(minor);

  const axes = new AxesHelper(0.5);
  axes.position.y = 0.002;
  axes.name = 'Origin';
  env.add(axes);

  const hemi = new HemisphereLight(0xdfe8ff, 0x2a2420, 1.2);
  hemi.name = 'Sky';
  env.add(hemi);

  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(4, 8, 3);
  sun.name = 'Key';
  env.add(sun);

  env.traverse((o) => (o.userData.helper = true));
  return env;
}
