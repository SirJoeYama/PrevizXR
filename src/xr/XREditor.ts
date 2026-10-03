import {
  Euler,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Quaternion,
  Raycaster,
  RingGeometry,
  Vector3,
  type Vector2,
} from 'three';
import type { App } from '../app/App';
import { clampFocal } from '../camera/lens';
import type { VirtualCamera } from '../camera/VirtualCamera';
import type { Playback } from '../app/Playback';
import { MENU_SIZES, dominantHand, onPrefs, prefs } from '../app/prefs';
import type { Takes } from '../app/Takes';
import { spawn, type Spawnable } from '../app/spawn';
import { readTransform, snapToFloor } from '../interaction/ops';
import type { Editor } from '../model/Editor';
import { CAMERA_ID, type Transform, type Vec3 } from '../model/scene';
import type { SceneSync } from '../sync/SceneSync';
import { VRMenu } from '../ui/vr/VRMenu';
import type { XRInputSlot } from './XRInput';

// xr-standard gamepad mapping (Quest Touch controllers)
const TRIGGER = 0;
const SQUEEZE = 1;
const STICK_PRESS = 3;
const BUTTON_LOWER = 4; // A (right) / X (left)
const BUTTON_UPPER = 5; // B (right) / Y (left)
const AXIS_X = 2;
const AXIS_Y = 3;

const DEADZONE = 0.2;
const MOVE_SPEED = 2; // m/s
const SNAP_TURN = Math.PI / 6;
const PUSH_SPEED = 2; // m/s along the ray while grabbing
const TWIST_SPEED = 2.5; // rad/s while grabbing
const RAY_LENGTH = 5;
const MAX_PICK = 30;
const SPAWN_DISTANCE = 1.6;
const ZOOM_SPEED = 1.2; // focal length ×e per second at full stick
/** Where the camera sits on the right controller: slightly above and in front, looking along the ray. */
const HOLD_OFFSET = new Matrix4().makeTranslation(0, 0.035, -0.06);

const UP = new Vector3(0, 1, 0);
const floorPlane = new Plane(UP.clone(), 0);

interface Grab {
  id: string;
  offset: Matrix4;
  /** Free rotation (trigger held when grabbing); otherwise the object stays upright and only turns about Y. */
  free: boolean;
  startQuat: Quaternion;
  startYaw: number;
  twist: number;
}

interface Hand {
  slot: XRInputSlot;
  prev: boolean[];
  line: Line;
  reticle: Mesh;
  grab: Grab | null;
  hitObject: string | null;
  hitPoint: Vector3 | null;
  menuUv: Vector2 | null;
  floorPoint: Vector3 | null;
  /** Tracked hands: index–thumb pinch (the input source's select), current and previous frame. */
  pinch: boolean;
  prevPinch: boolean;
  /** Menu region under this hand's ray, for hover haptics. */
  hoverId: string | null;
}

const MENU_ON_CONTROLLER = { position: new Vector3(0, 0.12, -0.06), rotationX: -Math.PI / 5 };
/** With tracked hands the menu floats in front of the user: this far ahead and this far below the eyes. */
const HAND_MENU_DISTANCE = 0.45;
const HAND_MENU_DROP = 0.18;

/**
 * VR editing.
 * Controllers (dominant = right unless left-handed mode): trigger = select / press menu buttons / place
 * waypoints, grip = grab (both grips = scale), off-hand stick = move, dominant stick = snap turn (or
 * push/pull and twist while grabbing), dominant stick click = hold the camera (trigger then records),
 * dominant A/B = to floor / menu, off-hand X/Y = undo / redo. The menu rides on the off-hand controller.
 * Tracked hands: pinch = trigger; pinch on an object and hold = grab; pinch with both = scale;
 * off-hand pinch on empty space = show/hide a menu floating in front of you.
 */
export class XREditor {
  readonly menu: VRMenu;
  pathMode = false;
  private readonly hands: Hand[];
  private readonly raycaster = new Raycaster();
  private scaling: { id: string; d0: number; s0: Vector3 } | null = null;
  /** The hand holding the virtual camera, if any. */
  private holder: Hand | null = null;
  private readonly takes: Takes;
  private turnArmed = true;

  private readonly m = new Matrix4();
  private readonly m2 = new Matrix4();
  private readonly v = new Vector3();
  private readonly v2 = new Vector3();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');

  constructor(
    private readonly app: App,
    private readonly editor: Editor,
    private readonly sync: SceneSync,
    private readonly playback: Playback,
    private readonly vcam: VirtualCamera,
    takes: Takes,
  ) {
    this.takes = takes;
    this.menu = new VRMenu(editor, playback, takes, {
      isHoldingCamera: () => this.holder !== null,
      toggleHoldCamera: () => this.toggleHold(this.dominant() ?? this.hands[1]),
      bringCamera: () => this.bringCamera(),
      focusDistance: () => this.vcam.focusDistance,
      fps: () => this.app.fps,
      monitorQuality: () => this.vcam.monitorQuality,
      spawn: (item) => this.spawnInFront(item),
      isPathMode: () => this.pathMode,
      setPathMode: (on) => this.setPathMode(on),
      snapSelected: () => {
        if (editor.selectedId) snapToFloor(editor, sync, editor.selectedId);
      },
    });
    this.menu.mesh.visible = false;
    onPrefs(() => {
      this.menu.mesh.scale.setScalar(MENU_SIZES[prefs.menuSize]);
      this.menu.invalidate();
    });
    this.menu.mesh.scale.setScalar(MENU_SIZES[prefs.menuSize]);

    const reticleGeo = new RingGeometry(0.012, 0.02, 24).rotateX(-Math.PI / 2);
    this.hands = app.xrInput.slots.map((slot) => {
      const line = slot.ray.getObjectByName('Ray') as Line;
      line.material = (line.material as LineBasicMaterial).clone();
      const reticle = new Mesh(reticleGeo, new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
      reticle.userData.helper = true;
      reticle.renderOrder = 30;
      reticle.visible = false;
      app.scene.add(reticle);
      app.addEditorOnly(reticle);
      const hand: Hand = { slot, prev: [], line, reticle, grab: null, hitObject: null, hitPoint: null, menuUv: null, floorPoint: null, pinch: false, prevPinch: false, hoverId: null };
      // Hands report pinches as the input source's select events (controllers too, but those use the gamepad).
      slot.ray.addEventListener('selectstart', () => (hand.pinch = true));
      slot.ray.addEventListener('selectend', () => (hand.pinch = false));
      slot.ray.addEventListener('disconnected', () => {
        hand.pinch = false;
        if (hand.grab) this.onRelease(hand);
      });
      return hand;
    });

    editor.subscribe((c) => {
      if (c === 'selection' && this.pathMode && editor.selected?.kind !== 'actor') this.setPathMode(false);
    });
    app.xrSession.addEventListener('change', () => {
      if (!app.xrSession.presenting) this.releaseAll();
    });
  }

  setPathMode(on: boolean): void {
    this.pathMode = on && this.editor.selected?.kind === 'actor';
    this.menu.invalidate();
  }

  update(dt: number): void {
    if (!this.app.renderer.xr.isPresenting) return;
    this.attachMenu();
    for (const hand of this.hands) {
      if (hand.slot.connected && hand.slot.isHand) this.updateTrackedHand(hand, dt);
      else this.updateHand(hand, dt);
    }
    this.updateScaling();
    this.menu.update();
  }

  /** The dominant-hand slot, if connected. */
  private dominant(): Hand | undefined {
    return this.hands.find((h) => h.slot.connected && h.slot.handedness === dominantHand());
  }

  private isOffHand(hand: Hand): boolean {
    return hand.slot.handedness !== dominantHand();
  }

  /** On the off-hand controller when there is one; otherwise (tracked hands) floating in the world. */
  private attachMenu(): void {
    const mesh = this.menu.mesh;
    const off = this.hands.find((h) => h.slot.connected && !h.slot.isHand && this.isOffHand(h));
    if (off) {
      if (mesh.parent !== off.slot.grip) {
        off.slot.grip.add(mesh);
        mesh.position.copy(MENU_ON_CONTROLLER.position);
        mesh.rotation.set(MENU_ON_CONTROLLER.rotationX, 0, 0);
      }
    } else if (mesh.parent && mesh.parent !== this.app.scene) {
      mesh.removeFromParent();
      mesh.visible = false;
    }
  }

  /** Shows the floating menu in front of the user (tracked hands), or hides it. */
  private toggleWorldMenu(): void {
    const mesh = this.menu.mesh;
    if (mesh.visible && mesh.parent === this.app.scene) {
      mesh.visible = false;
      return;
    }
    const head = this.v.setFromMatrixPosition(this.app.camera.matrixWorld);
    const yaw = this.yawOf(this.app.camera.matrixWorld);
    this.app.scene.add(mesh);
    mesh.position.set(head.x - Math.sin(yaw) * HAND_MENU_DISTANCE, head.y - HAND_MENU_DROP, head.z - Math.cos(yaw) * HAND_MENU_DISTANCE);
    mesh.rotation.set(-0.35, yaw, 0, 'YXZ');
    mesh.visible = true;
  }

  /** Short vibration on controllers (no-op for hands or when haptics are off). */
  private pulse(hand: Hand, intensity: number, ms: number): void {
    if (!prefs.haptics) return;
    const actuator = hand.slot.gamepad?.hapticActuators?.[0] as { pulse?: (v: number, d: number) => unknown } | undefined;
    void actuator?.pulse?.(intensity, ms);
  }

  /** Tracked hand: pinch is the only button. */
  private updateTrackedHand(hand: Hand, dt: number): void {
    hand.line.visible = true;
    hand.reticle.visible = false;
    this.cast(hand);
    const down = hand.pinch && !hand.prevPinch;
    const up = !hand.pinch && hand.prevPinch;
    hand.prevPinch = hand.pinch;
    if (down) this.onPinch(hand);
    if (up) this.onRelease(hand);
    if (this.holder === hand) this.updateHold(hand, 0, dt);
    else if (hand.grab) this.updateGrab(hand, 0, 0, dt);
  }

  private onPinch(hand: Hand): void {
    if (hand.menuUv) {
      this.menu.click(hand.menuUv);
      return;
    }
    if (this.holder === hand) {
      this.takes.toggleRecord();
      return;
    }
    const other = this.hands.find((h) => h !== hand && h.grab);
    if (hand.hitObject || other) {
      this.onSqueeze(hand, false); // grab, or scale with the other hand
      return;
    }
    if (this.pathMode && hand.floorPoint) {
      this.onTrigger(hand);
      return;
    }
    if (this.isOffHand(hand)) this.toggleWorldMenu();
    else this.editor.select(null);
  }

  private updateHand(hand: Hand, dt: number): void {
    const { slot } = hand;
    const pad = slot.gamepad;
    const active = slot.connected && !!pad;
    hand.line.visible = active;
    hand.reticle.visible = false;
    if (!active || !pad) return;

    this.cast(hand);
    const pressed = (i: number) => !!pad.buttons[i]?.pressed;
    const down = (i: number) => pressed(i) && !hand.prev[i];
    const up = (i: number) => !pressed(i) && !!hand.prev[i];
    const isOff = this.isOffHand(hand);

    const holding = this.holder === hand;
    if (down(STICK_PRESS) && !isOff) this.toggleHold(hand);
    if (down(SQUEEZE) && !holding) {
      this.onSqueeze(hand, pressed(TRIGGER));
      if (hand.grab) this.pulse(hand, 0.4, 30);
    }
    if (up(SQUEEZE)) this.onRelease(hand);
    // Holding the camera, the trigger is the record button (unless pointing at the menu).
    if (down(TRIGGER) && holding && !hand.menuUv) {
      this.takes.toggleRecord();
      this.pulse(hand, 0.8, 60);
    } else if (down(TRIGGER) && !hand.grab) this.onTrigger(hand);
    if (down(BUTTON_LOWER)) {
      if (isOff) this.editor.undo();
      else if (this.editor.selectedId) snapToFloor(this.editor, this.sync, this.editor.selectedId);
    }
    if (down(BUTTON_UPPER)) {
      if (isOff) this.editor.redo();
      else this.menu.mesh.visible = !this.menu.mesh.visible;
    }

    const ax = dz(pad.axes[AXIS_X] ?? 0);
    const ay = dz(pad.axes[AXIS_Y] ?? 0);
    if (holding) this.updateHold(hand, ay, dt);
    else if (hand.grab) this.updateGrab(hand, ax, ay, dt);
    else if (isOff) this.locomote(ax, ay, dt);
    else this.snapTurn(ax);

    hand.prev = pad.buttons.map((b) => b.pressed);
  }

  /** Raycasts against the menu, scene objects and floor; updates the ray length, reticle and menu hover. */
  private cast(hand: Hand): void {
    const ray = hand.slot.ray;
    ray.updateMatrixWorld();
    this.m.identity().extractRotation(ray.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(ray.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.m);
    this.raycaster.far = MAX_PICK;

    hand.menuUv = null;
    hand.hitObject = null;
    hand.hitPoint = null;
    hand.floorPoint = this.raycaster.ray.intersectPlane(floorPlane, new Vector3());
    let dist = Infinity;

    const holdsMenu = this.menu.mesh.parent === hand.slot.grip;
    if (this.menu.mesh.visible && this.menu.mesh.parent && !holdsMenu) {
      const hit = this.raycaster.intersectObject(this.menu.mesh, false)[0];
      if (hit?.uv) {
        hand.menuUv = hit.uv;
        dist = hit.distance;
      }
    }
    this.menu.pointer(this.hands.find((h) => h.menuUv)?.menuUv ?? null);
    const hoverId = hand.menuUv ? this.menu.hitId(hand.menuUv) : null;
    if (hoverId && hoverId !== hand.hoverId) this.pulse(hand, 0.15, 12);
    hand.hoverId = hoverId;

    if (!hand.menuUv && !hand.grab) {
      const hit = this.raycaster.intersectObjects(this.sync.pickRoots, true)[0];
      if (hit) {
        hand.hitObject = this.sync.objectIdOf(hit.object);
        hand.hitPoint = hit.point;
        dist = hit.distance;
      } else if (hand.floorPoint) {
        dist = this.raycaster.ray.origin.distanceTo(hand.floorPoint);
      }
    }

    const material = hand.line.material as LineBasicMaterial;
    material.color.set(hand.menuUv ? 0xffffff : hand.hitObject ? 0x7cc4ff : 0xffb547);
    hand.line.scale.z = Math.min(dist, RAY_LENGTH);
    const point = hand.hitPoint ?? (!hand.menuUv && this.pathMode ? hand.floorPoint : null);
    if (point && !hand.grab) {
      hand.reticle.position.copy(point);
      hand.reticle.position.y += 0.005;
      hand.reticle.visible = true;
    }
  }

  private onTrigger(hand: Hand): void {
    if (hand.menuUv) {
      if (this.menu.click(hand.menuUv)) this.pulse(hand, 0.5, 25);
      return;
    }
    const sel = this.editor.selected;
    if (this.pathMode && sel?.actor && hand.floorPoint) {
      const p: Vec3 = [round(hand.floorPoint.x), 0, round(hand.floorPoint.z)];
      this.editor.update(sel.id, (o) => o.actor!.waypoints.push(p));
      return;
    }
    this.editor.select(hand.hitObject);
  }

  private onSqueeze(hand: Hand, triggerHeld: boolean): void {
    const other = this.hands.find((h) => h !== hand && h.grab);
    if (other?.grab && other.grab.id !== CAMERA_ID && (!hand.hitObject || hand.hitObject === other.grab.id)) {
      const root = this.sync.rootOf(other.grab.id);
      if (!root) return;
      this.scaling = { id: other.grab.id, d0: this.handDistance(), s0: root.scale.clone() };
      return;
    }
    if (!hand.hitObject || this.playback.playing || this.takes.busy) return;
    const root = this.sync.rootOf(hand.hitObject);
    if (!root) return;
    this.editor.select(hand.hitObject);
    this.editor.begin();
    hand.grab = {
      id: hand.hitObject,
      offset: new Matrix4(),
      free: triggerHeld || hand.hitObject === CAMERA_ID,
      startQuat: new Quaternion(),
      startYaw: 0,
      twist: 0,
    };
    this.rebaseGrab(hand);
  }

  /** Recomputes the grab offset from the current controller and object poses. */
  private rebaseGrab(hand: Hand): void {
    const g = hand.grab;
    const root = g ? this.sync.rootOf(g.id) : undefined;
    if (!g || !root) return;
    root.updateMatrixWorld();
    g.offset.copy(hand.slot.ray.matrixWorld).invert().multiply(root.matrixWorld);
    g.startQuat.copy(root.quaternion);
    g.startYaw = this.yawOf(hand.slot.ray.matrixWorld);
    g.twist = 0;
  }

  private updateGrab(hand: Hand, ax: number, ay: number, dt: number): void {
    const g = hand.grab!;
    const root = this.sync.rootOf(g.id);
    if (!root || this.scaling) return;
    if (ay) g.offset.premultiply(this.m2.makeTranslation(0, 0, ay * PUSH_SPEED * dt));
    if (ax) g.twist -= ax * TWIST_SPEED * dt;

    this.m.copy(hand.slot.ray.matrixWorld).multiply(g.offset);
    this.m.decompose(this.v, this.q, this.s);
    root.position.copy(this.v);
    if (g.free) {
      root.quaternion.copy(this.q);
      if (g.twist) root.quaternion.premultiply(this.q.setFromAxisAngle(UP, g.twist));
    } else {
      const yaw = this.yawOf(hand.slot.ray.matrixWorld) - g.startYaw + g.twist;
      root.quaternion.setFromAxisAngle(UP, yaw).multiply(g.startQuat);
    }
    this.editor.setTransform(g.id, readTransform(root), true);
  }

  private updateScaling(): void {
    if (!this.scaling) return;
    const root = this.sync.rootOf(this.scaling.id);
    if (!root) return;
    const f = Math.max(this.handDistance() / Math.max(this.scaling.d0, 1e-3), 0.01);
    root.scale.copy(this.scaling.s0).multiplyScalar(f);
    this.editor.setTransform(this.scaling.id, readTransform(root), true);
  }

  private onRelease(hand: Hand): void {
    if (this.scaling && !hand.grab) {
      // Second hand let go: keep scaling result, continue the one-hand grab from here.
      this.scaling = null;
      const holder = this.hands.find((h) => h.grab);
      if (holder) this.rebaseGrab(holder);
      return;
    }
    if (!hand.grab) return;
    this.scaling = null;
    hand.grab = null;
    this.editor.commit();
  }

  private releaseAll(): void {
    for (const h of this.hands) if (h.grab) this.onRelease(h);
    this.scaling = null;
    if (this.holder) this.toggleHold(this.holder);
  }

  /** Takes the camera into a hand (it follows the controller and points along its ray), or lets go. */
  private toggleHold(hand: Hand): void {
    if (this.holder) {
      this.holder = null;
      this.editor.commit();
    } else {
      if (hand.grab || this.playback.playing || this.takes.state === 'playing') return;
      this.holder = hand;
      this.editor.begin();
      this.editor.select(CAMERA_ID);
    }
    this.menu.invalidate();
  }

  private updateHold(hand: Hand, ay: number, dt: number): void {
    this.m.copy(hand.slot.ray.matrixWorld).multiply(HOLD_OFFSET);
    this.m.decompose(this.v, this.q, this.s);
    const t: Transform = { position: this.v.toArray() as Vec3, rotation: this.q.toArray() as Transform['rotation'], scale: [1, 1, 1] };
    this.editor.setTransform(CAMERA_ID, t, true);
    if (ay) {
      // Stick up zooms in (longer focal length).
      this.editor.updateLens((l) => (l.focalLength = Math.round(clampFocal(l.focalLength * Math.exp(-ay * ZOOM_SPEED * dt)) * 10) / 10), true);
    }
  }

  /** Puts the camera in front of the user at eye height, looking where they look. */
  private bringCamera(): void {
    if (this.holder) return;
    const head = new Vector3().setFromMatrixPosition(this.app.camera.matrixWorld);
    const yaw = this.yawOf(this.app.camera.matrixWorld);
    const pos: Vec3 = [round(head.x - Math.sin(yaw) * 0.6), round(head.y - 0.1), round(head.z - Math.cos(yaw) * 0.6)];
    this.q.setFromAxisAngle(UP, yaw);
    this.editor.setTransform(CAMERA_ID, { position: pos, rotation: this.q.toArray() as Transform['rotation'], scale: [1, 1, 1] });
    this.editor.select(CAMERA_ID);
  }

  private locomote(ax: number, ay: number, dt: number): void {
    if (!ax && !ay) return;
    const yaw = this.yawOf(this.app.camera.matrixWorld);
    const fwd = this.v.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = this.v2.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this.app.rig.position.addScaledVector(fwd, -ay * MOVE_SPEED * dt).addScaledVector(right, ax * MOVE_SPEED * dt);
  }

  private snapTurn(ax: number): void {
    if (Math.abs(ax) < 0.6) {
      this.turnArmed = true;
      return;
    }
    if (!this.turnArmed) return;
    this.turnArmed = false;
    const angle = ax > 0 ? -SNAP_TURN : SNAP_TURN;
    // Rotate the rig about the head so the user turns in place.
    const head = this.v.setFromMatrixPosition(this.app.camera.matrixWorld);
    const rig = this.app.rig;
    rig.position.sub(head).applyAxisAngle(UP, angle).add(head);
    rig.rotateOnWorldAxis(UP, angle);
  }

  private spawnInFront(item: Spawnable): void {
    const head = new Vector3().setFromMatrixPosition(this.app.camera.matrixWorld);
    const yaw = this.yawOf(this.app.camera.matrixWorld);
    const at: Vec3 = [round(head.x - Math.sin(yaw) * SPAWN_DISTANCE), 0, round(head.z - Math.cos(yaw) * SPAWN_DISTANCE)];
    spawn(this.editor, item, at, Math.atan2(head.x - at[0], head.z - at[2]));
  }

  private handDistance(): number {
    const [a, b] = this.hands;
    return this.v.setFromMatrixPosition(a.slot.ray.matrixWorld).distanceTo(this.v2.setFromMatrixPosition(b.slot.ray.matrixWorld));
  }

  /** Heading (rotation about +Y) of a world matrix's forward axis. */
  private yawOf(matrix: Matrix4): number {
    this.q.setFromRotationMatrix(this.m2.extractRotation(matrix));
    return this.euler.setFromQuaternion(this.q, 'YXZ').y;
  }
}

function dz(v: number): number {
  return Math.abs(v) < DEADZONE ? 0 : v;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
