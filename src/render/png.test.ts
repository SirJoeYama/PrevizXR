import { unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { crc32, encodePng } from './png';

describe('encodePng', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a valid PNG whose pixels round-trip exactly', () => {
    const w = 3;
    const h = 2;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 37) % 256);
    const png = encodePng(rgba, w, h);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
    expect(view.getUint32(16)).toBe(w);
    expect(view.getUint32(20)).toBe(h);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
    // Every chunk's CRC matches its type + data
    let o = 8;
    const types: string[] = [];
    while (o < png.length) {
      const len = view.getUint32(o);
      types.push(String.fromCharCode(...png.subarray(o + 4, o + 8)));
      expect(view.getUint32(o + 8 + len)).toBe(crc32(png, o + 4, o + 8 + len));
      if (types.at(-1) === 'IDAT') {
        const raw = unzlibSync(png.subarray(o + 8, o + 8 + len));
        const rows = [0, 1].map((y) => raw.subarray(y * (w * 4 + 1), (y + 1) * (w * 4 + 1)));
        rows.forEach((row, y) => {
          expect(row[0]).toBe(0);
          expect([...row.subarray(1)]).toEqual([...rgba.subarray(y * w * 4, (y + 1) * w * 4)]);
        });
      }
      o += 12 + len;
    }
    expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
  });
});
