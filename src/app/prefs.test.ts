import { describe, expect, it, vi } from 'vitest';
import { dominantHand, onPrefs, prefs, setPrefs } from './prefs';

describe('prefs', () => {
  it('defaults to right-handed, medium menu, haptics on (even without storage)', () => {
    expect(prefs).toEqual({ leftHanded: false, menuSize: 'medium', haptics: true });
    expect(dominantHand()).toBe('right');
  });

  it('swaps the dominant hand and notifies listeners', () => {
    const cb = vi.fn();
    const off = onPrefs(cb);
    setPrefs({ leftHanded: true });
    expect(dominantHand()).toBe('left');
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    setPrefs({ leftHanded: false });
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
