import { describe, expect, it } from 'vitest';
import { createScene, identityTransform, type AssetRef, type SceneObject } from '../model/scene';
import { sceneCredits } from './credits';

const obj = (id: string, asset: AssetRef): SceneObject => ({ id, kind: 'prop', name: id, asset, transform: identityTransform(), color: '#ff0000' });
const poly: AssetRef = { source: 'poly', id: 'abc', file: 'f1', title: 'Balloon', creator: 'Poly by Google', licence: 'CC-BY 3.0', fit: { axis: 'max', size: 1 } };

describe('sceneCredits', () => {
  it('lists each bundled and downloaded model once, skipping primitives and lights', () => {
    const doc = createScene();
    doc.objects = [
      obj('a', poly),
      obj('b', poly),
      obj('c', { source: 'bundled', id: 'car' }),
      obj('d', { source: 'bundled', id: 'man' }),
      obj('e', { source: 'primitive', id: 'box' }),
      obj('f', { source: 'light', id: 'point' }),
    ];
    expect(sceneCredits(doc)).toEqual([
      { title: 'Balloon', author: 'Poly by Google', licence: 'CC-BY 3.0', url: 'https://poly.pizza/m/abc' },
      { title: 'Car', author: 'Poly by Google', licence: 'CC-BY 3.0', url: 'https://poly.pizza/m/eRu2kPYOCa7' },
      { title: 'Man', author: 'Quaternius', licence: 'CC0 1.0', url: 'https://poly.pizza/m/fjHyMd5Wxw' },
    ]);
  });
});
