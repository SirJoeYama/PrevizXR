import {
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  type Group,
  type WebGLRenderer,
  type XRGripSpace,
  type XRHandSpace,
  type XRTargetRaySpace,
} from 'three';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';

export interface XRInputSlot {
  index: number;
  handedness: XRHandedness;
  connected: boolean;
  /** True when this slot is a tracked hand rather than a controller. */
  isHand: boolean;
  ray: XRTargetRaySpace;
  grip: XRGripSpace;
  hand: XRHandSpace;
  gamepad: Gamepad | null;
}

const RAY_LENGTH = 5;

/**
 * Sets up both XR input slots (controller ray, grip with controller model, hand model).
 * Controllers are the primary input; tracked hands are shown but not yet interactive.
 */
export class XRInput {
  readonly slots: XRInputSlot[] = [];

  constructor(renderer: WebGLRenderer, rig: Group) {
    const controllerModels = new XRControllerModelFactory();
    const handModels = new XRHandModelFactory();
    const rayGeometry = new BufferGeometry();
    rayGeometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3));
    const rayMaterial = new LineBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.7 });

    for (let i = 0; i < 2; i++) {
      const ray = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const hand = renderer.xr.getHand(i);

      const line = new Line(rayGeometry, rayMaterial);
      line.name = 'Ray';
      line.scale.z = RAY_LENGTH;
      ray.add(line);

      grip.add(controllerModels.createControllerModel(grip));
      hand.add(handModels.createHandModel(hand, 'mesh'));

      const slot: XRInputSlot = {
        index: i,
        handedness: 'none',
        connected: false,
        isHand: false,
        ray,
        grip,
        hand,
        gamepad: null,
      };

      ray.addEventListener('connected', (e) => {
        const source = e.data;
        slot.connected = true;
        slot.handedness = source.handedness;
        slot.isHand = !!source.hand;
        slot.gamepad = source.gamepad ?? null;
        line.visible = !slot.isHand;
      });
      ray.addEventListener('disconnected', () => {
        slot.connected = false;
        slot.gamepad = null;
      });

      rig.add(ray, grip, hand);
      this.slots.push(slot);
    }
  }

  /** Returns the slot for a given hand, if connected. */
  get(handedness: XRHandedness): XRInputSlot | undefined {
    return this.slots.find((s) => s.connected && s.handedness === handedness);
  }
}
