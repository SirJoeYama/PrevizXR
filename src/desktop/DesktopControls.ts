import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const MOVE_SPEED = 3; // metres per second
const FAST_MULTIPLIER = 3;

/**
 * Desktop (non-VR) navigation: orbit with the mouse plus WASD/QE to fly the orbit target.
 * Keys only act while the canvas has focus, so typing in the sidebar never moves the view.
 */
export class DesktopControls {
  readonly orbit: OrbitControls;
  private readonly keys = new Set<string>();
  private saved?: { position: Vector3; target: Vector3 };
  private readonly move = new Vector3();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();

  constructor(
    private readonly camera: PerspectiveCamera,
    dom: HTMLElement,
  ) {
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.target.set(0, 1, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.update();

    dom.addEventListener('keydown', (e) => this.keys.add(e.code));
    dom.addEventListener('keyup', (e) => this.keys.delete(e.code));
    dom.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('pointerdown', () => dom.focus());
  }

  get enabled(): boolean {
    return this.orbit.enabled;
  }

  set enabled(v: boolean) {
    this.orbit.enabled = v;
    if (!v) this.keys.clear();
  }

  saveView(): void {
    this.saved = { position: this.camera.position.clone(), target: this.orbit.target.clone() };
  }

  restoreView(): void {
    if (!this.saved) return;
    this.camera.position.copy(this.saved.position);
    this.camera.quaternion.identity();
    this.camera.scale.set(1, 1, 1);
    this.orbit.target.copy(this.saved.target);
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const k = this.keys;
    this.move.set(0, 0, 0);
    if (k.size > 0) {
      this.camera.getWorldDirection(this.forward);
      this.forward.y = 0;
      this.forward.normalize();
      this.right.crossVectors(this.forward, this.camera.up).normalize();
      if (k.has('KeyW') || k.has('ArrowUp')) this.move.add(this.forward);
      if (k.has('KeyS') || k.has('ArrowDown')) this.move.sub(this.forward);
      if (k.has('KeyD') || k.has('ArrowRight')) this.move.add(this.right);
      if (k.has('KeyA') || k.has('ArrowLeft')) this.move.sub(this.right);
      if (k.has('KeyE')) this.move.y += 1;
      if (k.has('KeyQ')) this.move.y -= 1;
    }
    if (this.move.lengthSq() > 0) {
      const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? FAST_MULTIPLIER : 1;
      this.move.normalize().multiplyScalar(MOVE_SPEED * fast * dt);
      this.camera.position.add(this.move);
      this.orbit.target.add(this.move);
    }
    this.orbit.update();
  }
}
