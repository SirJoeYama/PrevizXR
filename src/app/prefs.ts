/** Per-device preferences (localStorage). Never part of scene files. */

export const MENU_SIZES = { small: 0.85, medium: 1, large: 1.3 } as const;
export type MenuSize = keyof typeof MENU_SIZES;

export interface Prefs {
  /** Swap hands: the menu goes on the right controller and the pointer/camera hand is the left. */
  leftHanded: boolean;
  menuSize: MenuSize;
  haptics: boolean;
}

const KEY = 'previzxr.prefs';
const DEFAULTS: Prefs = { leftHanded: false, menuSize: 'medium', haptics: true };
const listeners = new Set<() => void>();

function read(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return {
      leftHanded: typeof p.leftHanded === 'boolean' ? p.leftHanded : DEFAULTS.leftHanded,
      menuSize: p.menuSize && p.menuSize in MENU_SIZES ? p.menuSize : DEFAULTS.menuSize,
      haptics: typeof p.haptics === 'boolean' ? p.haptics : DEFAULTS.haptics,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export const prefs: Prefs = read();

export function setPrefs(patch: Partial<Prefs>): void {
  Object.assign(prefs, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked: preferences last for this session only.
  }
  for (const l of listeners) l();
}

export function onPrefs(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The hand that points, picks and holds the camera. */
export function dominantHand(): XRHandedness {
  return prefs.leftHanded ? 'left' : 'right';
}
