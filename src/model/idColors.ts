/**
 * Distinct flat ID colors for the color_id pass and labels.
 * Hues step by the golden angle so consecutive objects are far apart; saturation and lightness cycle
 * through a few levels so more than ~12 objects stay distinguishable. Black is reserved for background.
 */

const GOLDEN_ANGLE = 137.50776405;
const LEVELS: Array<[number, number]> = [
  [0.85, 0.55],
  [0.65, 0.4],
  [0.9, 0.7],
];

export function idColorAt(index: number): string {
  const hue = (index * GOLDEN_ANGLE) % 360;
  const [s, l] = LEVELS[Math.floor(index / 12) % LEVELS.length];
  return hslToHex(hue, s, l);
}

/** First color in the sequence that no existing object uses. */
export function nextIdColor(used: Iterable<string>): string {
  const taken = new Set([...used].map((c) => c.toLowerCase()));
  for (let i = 0; ; i++) {
    const c = idColorAt(i);
    if (!taken.has(c)) return c;
  }
}

export function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
