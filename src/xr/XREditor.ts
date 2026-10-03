import {
  Box3,
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
  type Object3D,
  type Vector2,
} from 'three';
import type { App } from '../app/App';
import { clampFocal } from '../camera/lens';
import type { KeyframePath } from '../camera/KeyframePath';
import type { VirtualCamera } from '../camera/VirtualCamera';
import type { Playback } from '../app/Playback';
import type { Project } from '../app/Project';
import { MENU_SIZES, dominantHand, onPrefs, prefs } from '../app/prefs';
import type { Takes } from '../app/Takes';
import { spawn, type Spawnable } from '../app/spawn';
import { readTransform, snapToFloor } from '../interaction/ops';
import type { Editor } from '../model/Editor';
import { CAMERA_ID, addWaypoint, type Quat, type Transform, type Vec3 } from '../model/scene';
import type { SceneSync } from '../sync/SceneSync';
import type { PathHandles } from '../sync/PathHandles';
import { movePathPoint, type PathPointRef } from '../model/pathEdit';
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
/** A grab only starts moving things once the hand has moved this far (so a click to select never nudges). */
const DRAG_START_METRES = 0.01;
const DRAG_START_RADIANS = (1.2 * Math.PI) / 180;
/** A detached monitor appears this far in front of the eyes and this far below them. */
const MONITOR_DISTANCE = 0.9;
const MONITOR_DROP = 0.15;
/** Go to: stand at least this far from the object. */
const GO_TO_DISTANCE = 1.5;
/** Where the camera sits on the right controller: slightly above and in front, looking along the ray. */
const HOLD_OFFSET = new Matrix4().makeTranslation(0, 0.035, -0.06);

const UP = new Vector3(0, 1, 0);
const floorPlane = new Plane(UP.clone(), 0);

type Button = 'trigger' | 'squeeze' | 'pinch';

interface Grab {
  /** Scene object (or CAMERA_ID) being moved; null for a camera keyframe or the detached monitor (view-only, not in the scene). */
  id: string | null;
  /** Camera keyframe index being moved, or null. */
  key: number | null;
  /** Bézier path point (waypoint or handle) being moved, or null. */
  path: PathPointRef | null;
  target: Object3D;
  /** The button that started the grab; releasing it ends the grab. */
  button: Button;
  offset: Matrix4;
  /** Free rotation (camera, keyframes, or trigger held when gripping); otherwise the object stays upright and only turns about Y. */
  free: boolean;
  startQuat: Quaternion;
  startYaw: number;
  twist: number;
  /** Hand pose when the grab began; nothing moves until the hand leaves it (see DRAG_START_*). */
  startRay: Matrix4;
  dragging: boolean;
}

interface Hand {
  slot: XRInputSlot;
  prev: boolean[];
  line: Line;
  reticle: Mesh;
  grab: Grab | null;
  hitObject: string | null;
  /** Camera keyframe marker under the ray, if any. */
  hitKey: number | null;
  /** The detached camera monitor is under the ray. */
  hitMonitor: boolean;
  /** Bézier path point (waypoint or handle of the selected path) under the ray. */
  hitPath: PathPointRef | null;
  hitPoint: Vector3 | null;
  menuUv: Vector2 | null;
  floorPoint: Vector3 | null;
  /** Tracked hands: index–thumb pinch (the input source's select), current and previous frame. */
  pinch: boolean;
  prevPinch: boolean;
  /** Menu region under this hand's ray, for hover haptics. */
  hoverId: string | null;
}

/** The menu leans back this much on the off-hand controller, with its bottom edge this far above and ahead of the grip. */
const MENU_TILT = -Math.PI / 5;
const MENU_CLEARANCE = { above: 0.07, ahead: 0.02 };
/** With tracked hands the menu floats in front of the user: this far ahead and this far below the eyes. */
const HAND_MENU_DISTANCE = 0.45;
const HAND_MENU_DROP = 0.18;

/**
 * VR editing.
 * Controllers (dominant = right unless left-handed mode): trigger = press menu buttons / select, and
 * hold-and-drag to move what you point at (objects, camera, camera-path keys); grip = grab too
 * (with trigger held: free rotation; both hands = scale); off-hand stick = move, dominant stick = snap
 * turn (or push/pull and twist while grabbing), dominant stick click = hold the camera (trigger then
 * records, or drops a keyframe while drawing a camera path), dominant A/B = to floor / menu, off-hand
 * X/Y = undo / redo. The menu rides on the off-hand controller.
 * Path mode: with an object selected the trigger adds waypoints on the floor; with the camera selected
 * the camera follows the hand and the trigger drops keyframes.
 * Tracked hands: pinch = trigger; pinch on an object and hold = grab; pinch with both = scale;
 * off-hand pinch on empty space = show/hide a menu floating in front of you.
 */
export class XREditor {
  readonly menu: VRMenu;
  pathMode = false;
  /** Selection the path mode was started for (an object id or CAMERA_ID). */
  private pathFor: string | null = null;
  private readonly hands: Hand[];
  private readonly raycaster = new Raycaster();
  private scaling: { id: string; d0: number; s0: Vector3; hand: Hand; button: Button } | null = null;
  /** The hand holding the virtual camera, if any. */
  private holder: Hand | null = null;
  private readonly takes: Takes;
  private turnArmed = true;
  /** Called after leaving the session for Import, so the page can show a file picker (it can't open in VR). */
  requestImport: () => void = () => {};

  private readonly m = new Matrix4();
  private readonly m2 = new Matrix4();
  private readonly v = new Vector3();
  private readonly v2 = new Vector3();
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly s = new Vector3();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');

  constructor(
    private readonly app: App,
    private readonly editor: Editor,
    private readonly sync: SceneSync,
    private readonly playback: Playback,
    private readonly vcam: VirtualCamera,
    takes: Takes,
    private readonly keyPath: KeyframePath,
    project: Project,
    private readonly pathHandles: PathHandles,
  ) {
    this.takes = takes;
    this.menu = new VRMenu(editor, playback, takes, project, {
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
      goTo: (id) => this.goTo(id),
      sessionLabel: () => (app.xrSession.mode === 'ar' ? 'XR' : 'VR'),
      exitSession: () => void app.xrSession.exit(),
      importScene: () => void app.xrSession.exit().then(() => this.requestImport()),
      isMonitorDetached: () => vcam.isMonitorDetached,
      toggleMonitor: () => this.toggleMonitor(),
    });
    this.menu.mesh.visible = false;
    onPrefs(() => {
      this.menu.mesh.scale.setScalar(MENU_SIZES[prefs.menuSize]);
      if (this.menu.mesh.parent && this.menu.mesh.parent !== app.scene) this.placeMenuOnController();
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
      const hand: Hand = {
        slot,
        prev: [],
        line,
        reticle,
        grab: null,
        hitObject: null,
        hitKey: null,
        hitMonitor: false,
        hitPath: null,
        hitPoint: null,
        menuUv: null,
        floorPoint: null,
        pinch: false,
        prevPinch: false,
        hoverId: null,
      };
      // Hands report pinches as the input source's select events (controllers too, but those use the gamepad).
      slot.ray.addEventListener('selectstart', () => (hand.pinch = true));
      slot.ray.addEventListener('selectend', () => (hand.pinch = false));
      slot.ray.addEventListener('disconnected', () => {
        hand.pinch = false;
        this.releaseHand(hand);
      });
      return hand;
    });

    editor.subscribe((c) => {
      if (c === 'selection' && this.pathMode && editor.selectedId !== this.pathFor) this.setPathMode(false);
    });
    app.xrSession.addEventListener('change', () => {
      if (app.xrSession.presenting) this.menu.mesh.visible = true; // show the menu on entering VR
      else {
        this.releaseAll();
        if (vcam.isMonitorDetached) vcam.attachMonitor();
      }
    });
  }

  /** Path mode for the selection: waypoints for an object, keyframes (camera in hand) for the camera. */
  setPathMode(on: boolean): void {
    const id = on ? this.editor.selectedId : null;
    const wasCamera = this.pathMode && this.pathFor === CAMERA_ID;
    this.pathMode = id !== null;
    this.pathFor = id;
    if (id === CAMERA_ID && !this.holder) this.toggleHold(this.dominant() ?? this.hands[1]);
    else if (!this.pathMode && wasCamera && this.holder) this.toggleHold(this.holder);
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
    this.updateKeyHighlight();
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
        this.placeMenuOnController();
      }
    } else if (mesh.parent && mesh.parent !== this.app.scene) {
      mesh.removeFromParent();
      mesh.visible = false;
    }
  }

  /** Tilts the menu back and lifts it so its bottom edge clears the controller, whatever the menu size. */
  private placeMenuOnController(): void {
    const mesh = this.menu.mesh;
    mesh.geometry.computeBoundingBox();
    const half = mesh.geometry.boundingBox!.max.y * mesh.scale.y;
    // The panel's local up axis after tilting about X is (0, cos, sin); its centre sits half a height along it.
    mesh.position.set(0, MENU_CLEARANCE.above + half * Math.cos(MENU_TILT), -MENU_CLEARANCE.ahead + half * Math.sin(MENU_TILT));
    mesh.rotation.set(MENU_TILT, 0, 0);
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
    if (up) this.onButtonUp(hand, 'pinch');
    if (this.holder === hand) this.updateHold(hand, 0, dt);
    else if (hand.grab) this.updateGrab(hand, 0, 0, dt);
  }

  private onPinch(hand: Hand): void {
    if (hand.menuUv) {
      this.menu.click(hand.menuUv);
      return;
    }
    if (this.holder === hand) {
      this.holderTrigger(hand);
      return;
    }
    if (this.placeWaypoint(hand)) return;
    if (this.canGrab(hand)) {
      this.startGrab(hand, 'pinch', false); // grab, or scale with the other hand
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
    if (down(SQUEEZE) && !holding && !hand.grab) {
      this.startGrab(hand, 'squeeze', pressed(TRIGGER));
      if (hand.grab) this.pulse(hand, 0.4, 30);
    }
    if (up(SQUEEZE)) this.onButtonUp(hand, 'squeeze');
    if (down(TRIGGER) && !hand.grab) {
      // Holding the camera, the trigger records or drops a keyframe (unless pointing at the menu).
      if (holding && !hand.menuUv) this.holderTrigger(hand);
      else this.onTrigger(hand);
    }
    if (up(TRIGGER)) this.onButtonUp(hand, 'trigger');
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

  /** Raycasts against the menu, scene objects, camera-path keys and floor; updates the ray, reticle and menu hover. */
  private cast(hand: Hand): void {
    const ray = hand.slot.ray;
    ray.updateMatrixWorld();
    this.m.identity().extractRotation(ray.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(ray.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.m);
    this.raycaster.far = MAX_PICK;

    hand.menuUv = null;
    hand.hitObject = null;
    hand.hitKey = null;
    hand.hitMonitor = false;
    hand.hitPath = null;
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

    if (!hand.menuUv && !hand.grab && this.holder !== hand) {
      const keyHit = this.keyPath.group.visible ? this.raycaster.intersectObject(this.keyPath.markers, true)[0] : undefined;
      const pathHit = this.raycaster.intersectObject(this.pathHandles.pickables, true)[0];
      const hit = this.raycaster.intersectObjects(this.sync.pickRoots, true)[0];
      const monitorHit = this.vcam.isMonitorDetached ? this.raycaster.intersectObject(this.vcam.monitorGroup, true)[0] : undefined;
      if (monitorHit && (!hit || monitorHit.distance <= hit.distance) && (!keyHit || monitorHit.distance <= keyHit.distance)) {
        hand.hitMonitor = true;
        hand.hitPoint = monitorHit.point;
        dist = monitorHit.distance;
      } else if (pathHit && (!hit || pathHit.distance <= hit.distance + 0.05) && (!keyHit || pathHit.distance <= keyHit.distance)) {
        // Path points are small: prefer them, like keys, when about as close as what is behind.
        hand.hitPath = this.pathHandles.refOf(pathHit.object);
        hand.hitPoint = pathHit.point;
        dist = pathHit.distance;
      } else if (keyHit && (!hit || keyHit.distance <= hit.distance + 0.05)) {
        // Keys are small and sit on the path: prefer them when they are about as close as the object behind.
        hand.hitKey = this.keyPath.keyIndexOf(keyHit.object);
        hand.hitPoint = keyHit.point;
        dist = keyHit.distance;
      } else if (hit) {
        hand.hitObject = this.sync.objectIdOf(hit.object);
        hand.hitPoint = hit.point;
        dist = hit.distance;
      } else if (hand.floorPoint) {
        dist = this.raycaster.ray.origin.distanceTo(hand.floorPoint);
      }
    }

    const material = hand.line.material as LineBasicMaterial;
    material.color.set(hand.menuUv || hand.hitMonitor ? 0xffffff : hand.hitKey !== null || hand.hitPath ? 0xffb547 : hand.hitObject ? 0x7cc4ff : 0xffb547);
    hand.line.scale.z = Math.min(dist, RAY_LENGTH);
    const placing = this.pathMode && this.pathFor !== CAMERA_ID;
    const point = placing && !hand.menuUv ? hand.floorPoint : hand.hitPoint;
    if (point && !hand.grab) {
      hand.reticle.position.copy(point);
      hand.reticle.position.y += 0.005;
      hand.reticle.visible = true;
    }
  }

  /** Grabbed key, else a key under a ray, else the key picked in the menu. */
  private updateKeyHighlight(): void {
    const grabbed = this.hands.find((h) => h.grab && h.grab.key !== null)?.grab?.key;
    this.keyPath.highlight(grabbed ?? this.hands.find((h) => h.hitKey !== null)?.hitKey ?? this.menu.selectedKey);
    this.pathHandles.highlight(this.hands.find((h) => h.grab?.path)?.grab?.path ?? this.hands.find((h) => h.hitPath)?.hitPath ?? null);
  }

  private onTrigger(hand: Hand): void {
    if (hand.menuUv) {
      if (this.menu.click(hand.menuUv)) this.pulse(hand, 0.5, 25);
      return;
    }
    if (this.placeWaypoint(hand)) {
      this.pulse(hand, 0.5, 25);
      return;
    }
    if (this.canGrab(hand)) {
      this.startGrab(hand, 'trigger', false);
      if (hand.grab) this.pulse(hand, 0.4, 30);
      return;
    }
    this.editor.select(null);
  }

  /** Path mode on an object: adds a waypoint where the ray meets the floor. */
  private placeWaypoint(hand: Hand): boolean {
    const sel = this.editor.selected;
    if (!this.pathMode || !sel || sel.id !== this.pathFor || !hand.floorPoint) return false;
    const { x, z } = hand.floorPoint;
    this.editor.update(sel.id, (o) => addWaypoint(o, x, z));
    return true;
  }

  /** Trigger or pinch on the hand holding the camera: drop a keyframe while drawing a path, else record. */
  private holderTrigger(hand: Hand): void {
    if (this.pathMode && this.pathFor === CAMERA_ID) {
      if (this.takes.busy) return;
      this.editor.addCameraKey();
      this.editor.begin(); // keep holding as one continuous edit
      this.pulse(hand, 0.6, 40);
      return;
    }
    this.takes.toggleRecord();
    this.pulse(hand, 0.8, 60);
  }

  private canGrab(hand: Hand): boolean {
    return !!hand.hitObject || hand.hitKey !== null || hand.hitMonitor || !!hand.hitPath || this.hands.some((h) => h !== hand && h.grab);
  }

  /** Grabs what the ray points at, or (second hand, while the other grabs an object) starts scaling it. */
  private startGrab(hand: Hand, button: Button, freeRotation: boolean): void {
    const other = this.hands.find((h) => h !== hand && h.grab)?.grab;
    if (other?.id && other.id !== CAMERA_ID && hand.hitKey === null && !hand.hitMonitor && !hand.hitPath && (!hand.hitObject || hand.hitObject === other.id)) {
      const root = this.sync.rootOf(other.id);
      if (root) this.scaling = { id: other.id, d0: this.handDistance(), s0: root.scale.clone(), hand, button };
      return;
    }
    let target: Object3D | undefined;
    let id: string | null = null;
    const key = hand.hitPath ? null : hand.hitKey;
    const path = hand.hitPath;
    // The monitor can be moved any time (watching a preview is the point); scene edits wait for playback to end.
    if (hand.hitMonitor) target = this.vcam.monitorGroup;
    else if (this.playback.playing || this.takes.busy) return;
    else if (path) target = this.pathHandles.objectFor(path);
    else if (key !== null) {
      target = this.keyPath.marker(key);
      this.menu.selectedKey = key;
      this.editor.select(CAMERA_ID); // shows the path's handles
    } else if (hand.hitObject) {
      id = hand.hitObject;
      target = this.sync.rootOf(id);
      this.editor.select(id);
    }
    if (!target) return;
    this.editor.begin();
    hand.grab = {
      id,
      key,
      path,
      target,
      button,
      offset: new Matrix4(),
      free: freeRotation || id === CAMERA_ID || key !== null || hand.hitMonitor,
      startQuat: new Quaternion(),
      startYaw: 0,
      twist: 0,
      startRay: hand.slot.ray.matrixWorld.clone(),
      dragging: false,
    };
    this.rebaseGrab(hand);
  }

  /** Recomputes the grab offset from the current controller and object poses. */
  private rebaseGrab(hand: Hand): void {
    const g = hand.grab;
    if (!g) return;
    g.target.updateMatrixWorld();
    g.offset.copy(hand.slot.ray.matrixWorld).invert().multiply(g.target.matrixWorld);
    g.startQuat.copy(g.target.quaternion);
    g.startYaw = this.yawOf(hand.slot.ray.matrixWorld);
    g.twist = 0;
  }

  private updateGrab(hand: Hand, ax: number, ay: number, dt: number): void {
    const g = hand.grab!;
    const root = g.target;
    if (this.scaling) return;
    if (!g.dragging) {
      if (!ax && !ay && !this.movedFrom(g.startRay, hand.slot.ray.matrixWorld)) return;
      g.dragging = true;
    }
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
    if (g.path) {
      const ref = g.path;
      const p = root.position.toArray() as Vec3;
      this.editor.transient((d) => movePathPoint(d, ref, p));
    } else if (g.key !== null) {
      const i = g.key;
      const p = root.position.toArray().map(round) as Vec3;
      const q = root.quaternion.toArray() as Quat;
      this.editor.transient((d) => {
        const k = d.camera.keyframes[i];
        if (!k) return;
        k.position = p;
        k.rotation = q;
      });
    } else if (g.id) {
      this.editor.setTransform(g.id, readTransform(root), true);
    }
  }

  /** True once the hand has moved or turned past the drag thresholds since `start`. */
  private movedFrom(start: Matrix4, now: Matrix4): boolean {
    if (this.v.setFromMatrixPosition(start).distanceTo(this.v2.setFromMatrixPosition(now)) > DRAG_START_METRES) return true;
    this.q.setFromRotationMatrix(this.m2.extractRotation(start));
    this.q2.setFromRotationMatrix(this.m2.extractRotation(now));
    return this.q.angleTo(this.q2) > DRAG_START_RADIANS;
  }

  private updateScaling(): void {
    if (!this.scaling) return;
    const root = this.sync.rootOf(this.scaling.id);
    if (!root) return;
    const f = Math.max(this.handDistance() / Math.max(this.scaling.d0, 1e-3), 0.01);
    root.scale.copy(this.scaling.s0).multiplyScalar(f);
    this.editor.setTransform(this.scaling.id, readTransform(root), true);
  }

  /** A button came up: ends the scaling or grab it started. */
  private onButtonUp(hand: Hand, button: Button): void {
    if (this.scaling?.hand === hand && this.scaling.button === button) {
      // Second hand let go: keep the scaling result, continue the one-hand grab from here.
      this.scaling = null;
      const holder = this.hands.find((h) => h.grab);
      if (holder) this.rebaseGrab(holder);
      return;
    }
    if (hand.grab?.button === button) this.releaseHand(hand);
  }

  private releaseHand(hand: Hand): void {
    if (this.scaling?.hand === hand) {
      this.scaling = null;
      const holder = this.hands.find((h) => h.grab);
      if (holder) this.rebaseGrab(holder);
    }
    if (!hand.grab) return;
    this.scaling = null;
    hand.grab = null;
    this.editor.commit();
  }

  private releaseAll(): void {
    for (const h of this.hands) this.releaseHand(h);
    this.scaling = null;
    if (this.pathMode) this.setPathMode(false);
    if (this.holder) this.toggleHold(this.holder);
  }

  /** Takes the camera into a hand (it follows the controller and points along its ray), or lets go. */
  private toggleHold(hand: Hand): void {
    if (this.holder) {
      this.holder = null;
      this.editor.commit();
      if (this.pathMode && this.pathFor === CAMERA_ID) this.setPathMode(false);
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

  /** Detaches the camera monitor in front of the user (grab it to move it), or puts it back on the camera. */
  private toggleMonitor(): void {
    if (this.vcam.isMonitorDetached) {
      for (const h of this.hands) if (h.grab?.target === this.vcam.monitorGroup) this.releaseHand(h);
      this.vcam.attachMonitor();
    } else {
      const head = this.v.setFromMatrixPosition(this.app.camera.matrixWorld);
      const yaw = this.yawOf(this.app.camera.matrixWorld);
      const pos = new Vector3(head.x - Math.sin(yaw) * MONITOR_DISTANCE, head.y - MONITOR_DROP, head.z - Math.cos(yaw) * MONITOR_DISTANCE);
      this.q.setFromEuler(this.euler.set(-0.1, yaw, 0, 'YXZ'));
      this.vcam.detachMonitor(pos, this.q);
    }
    this.menu.invalidate();
  }

  /** Moves the user next to an object (or the camera), turned to face it. */
  private goTo(id: string): void {
    const root = this.sync.rootOf(id);
    if (!root) return;
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root);
    const target = box.isEmpty() ? new Vector3().setFromMatrixPosition(root.matrixWorld) : box.getCenter(new Vector3());
    const radius = box.isEmpty() ? 0 : box.getSize(this.v2).length() / 2;
    const head = new Vector3().setFromMatrixPosition(this.app.camera.matrixWorld);
    const dir = new Vector3(head.x - target.x, 0, head.z - target.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    // Turn about the head so the object is straight ahead, then step to GO_TO_DISTANCE (or more for big things).
    const rig = this.app.rig;
    const angle = Math.atan2(dir.x, dir.z) - this.yawOf(this.app.camera.matrixWorld);
    rig.position.sub(head).applyAxisAngle(UP, angle).add(head);
    rig.rotateOnWorldAxis(UP, angle);
    const d = Math.max(GO_TO_DISTANCE, radius * 2);
    rig.position.x += target.x + dir.x * d - head.x;
    rig.position.z += target.z + dir.z * d - head.z;
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
    // Picture planes float centred at eye level, a bit closer; everything else stands on the floor.
    const image = item.asset.source === 'image';
    const d = image ? 1.2 : SPAWN_DISTANCE;
    const at: Vec3 = [round(head.x - Math.sin(yaw) * d), image ? round(Math.max(0.05, head.y - 0.5)) : 0, round(head.z - Math.cos(yaw) * d)];
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
