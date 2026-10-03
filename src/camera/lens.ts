/**
 * Cinema lens math. Pure functions, no Three.js.
 *
 * The recorded image is the largest area of the chosen aspect ratio that fits on the sensor
 * (landscape ratios use the full sensor width, tall or square ratios use the full height).
 * Field of view follows from that image area and the focal length: fov = 2·atan(size / 2f).
 */

export type SensorId = 'super35' | 'fullframe';
export type AspectId = '16:9' | '9:16' | '2.39:1' | '1:1';
export type Fps = 24 | 25 | 30;

export interface Sensor {
  id: SensorId;
  label: string;
  /** Millimetres. */
  width: number;
  height: number;
}

/** Super 35 uses the common 24.89 × 18.66 mm (4-perf) gate; full frame is 36 × 24 mm. */
export const SENSORS: Record<SensorId, Sensor> = {
  super35: { id: 'super35', label: 'Super 35', width: 24.89, height: 18.66 },
  fullframe: { id: 'fullframe', label: 'Full frame', width: 36, height: 24 },
};

export const ASPECTS: Record<AspectId, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '2.39:1': 2.39,
  '1:1': 1,
};

export const ASPECT_IDS = Object.keys(ASPECTS) as AspectId[];
export const FPS_OPTIONS: Fps[] = [24, 25, 30];
export const FOCAL_PRESETS = [14, 18, 24, 35, 50, 85, 100, 135];
export const FOCAL_MIN = 14;
export const FOCAL_MAX = 135;

export function clampFocal(mm: number): number {
  return Math.min(FOCAL_MAX, Math.max(FOCAL_MIN, mm));
}

/** Width and height (mm) of the recorded image on the sensor. */
export function imageArea(sensor: SensorId, aspect: AspectId): { width: number; height: number } {
  const s = SENSORS[sensor];
  const a = ASPECTS[aspect];
  return s.width / a <= s.height ? { width: s.width, height: s.width / a } : { width: s.height * a, height: s.height };
}

/** Field of view in degrees across a dimension of `size` mm. */
export function fovDeg(size: number, focalLength: number): number {
  return (2 * Math.atan(size / (2 * focalLength)) * 180) / Math.PI;
}

export function verticalFovDeg(focalLength: number, sensor: SensorId, aspect: AspectId): number {
  return fovDeg(imageArea(sensor, aspect).height, focalLength);
}

export function horizontalFovDeg(focalLength: number, sensor: SensorId, aspect: AspectId): number {
  return fovDeg(imageArea(sensor, aspect).width, focalLength);
}

/** Focal length that gives a vertical field of view (inverse of verticalFovDeg). */
export function focalForVerticalFov(fov: number, sensor: SensorId, aspect: AspectId): number {
  return imageArea(sensor, aspect).height / (2 * Math.tan((fov * Math.PI) / 360));
}
