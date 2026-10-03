import { describe, expect, it } from 'vitest';
import { fileTimestamp, slug } from './download';

describe('file names', () => {
  it('formats local date and time without characters Windows forbids', () => {
    expect(fileTimestamp(new Date(2026, 9, 3, 9, 5, 7))).toBe('2026-10-03_09-05-07');
    expect(fileTimestamp(new Date(2026, 0, 31, 23, 59, 59))).toBe('2026-01-31_23-59-59');
  });

  it('slugs scene names', () => {
    expect(`${slug('My Scene!')}_${fileTimestamp(new Date(2026, 9, 3, 14, 30, 0))}.previz.json`).toBe('my-scene_2026-10-03_14-30-00.previz.json');
  });
});
