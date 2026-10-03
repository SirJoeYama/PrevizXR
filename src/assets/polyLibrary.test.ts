import { describe, expect, it } from 'vitest';
import { polyAssetRef, searchPoly, type PolyEntry } from './polyLibrary';

const e = (title: string): PolyEntry => ({ id: title, file: `f-${title}`, title, licence: 'CC-BY 3.0' });
const entries = ['Armchair', 'Chair', 'Wood chair', 'Car', 'Police car', 'Chairlift'].map(e);

describe('searchPoly', () => {
  it('matches every word, case-insensitively', () => {
    expect(searchPoly(entries, 'CHAIR').map((x) => x.title)).toEqual(['Chair', 'Chairlift', 'Armchair', 'Wood chair']);
    expect(searchPoly(entries, 'police car').map((x) => x.title)).toEqual(['Police car']);
  });

  it('returns the first entries for an empty query and respects the limit', () => {
    expect(searchPoly(entries, '  ', 2)).toHaveLength(2);
    expect(searchPoly(entries, 'chair', 1).map((x) => x.title)).toEqual(['Chair']);
  });
});

describe('polyAssetRef', () => {
  it('stores attribution and a size guess in the scene', () => {
    expect(polyAssetRef(e('Police car'))).toMatchObject({
      source: 'poly',
      creator: 'Poly by Google',
      licence: 'CC-BY 3.0',
      fit: { axis: 'length', size: 4.8 },
    });
    expect(polyAssetRef(e('Unicycle')).fit).toEqual({ axis: 'max', size: 1 });
  });
});
