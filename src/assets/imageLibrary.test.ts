import { describe, expect, it } from 'vitest';
import { Editor } from '../model/Editor';
import { identityTransform } from '../model/scene';
import { parseScene } from '../model/serialize';
import { fitWithin, sceneImageIds } from './imageLibrary';

describe('fitWithin', () => {
  it('downscales the longest side and keeps the aspect ratio', () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(1080, 1920, 2048)).toEqual({ width: 1080, height: 1920 });
    expect(fitWithin(3000, 1000, 1000)).toEqual({ width: 1000, height: 333 });
  });
});

describe('picture planes in scenes', () => {
  const picture = (id: string) => ({
    kind: 'prop' as const,
    name: 'Board',
    asset: { source: 'image' as const, id, aspect: 16 / 9 },
    transform: identityTransform(),
    hiddenInRenders: true,
  });

  it('lists each referenced image once', () => {
    const ed = new Editor();
    ed.add(picture('a'));
    ed.add(picture('a'));
    ed.add(picture('b'));
    ed.add({ kind: 'prop', name: 'Box', asset: { source: 'primitive', id: 'box' }, transform: identityTransform() });
    expect(sceneImageIds(ed.doc)).toEqual(['a', 'b']);
  });

  it('round-trips through scene files and repairs a bad aspect', () => {
    const ed = new Editor();
    const p = ed.add(picture('a'));
    const parsed = parseScene(JSON.parse(JSON.stringify(ed.doc)));
    expect(parsed.objects[0]).toMatchObject({ asset: { source: 'image', id: 'a' }, hiddenInRenders: true });
    const broken = JSON.parse(JSON.stringify(ed.doc));
    broken.objects[0].asset.aspect = -2;
    broken.objects[0].hiddenInRenders = 'yes';
    const repaired = parseScene(broken).objects.find((o) => o.id === p.id)!;
    expect(repaired.asset).toMatchObject({ aspect: 1 });
    expect(repaired.hiddenInRenders).toBe(true);
  });
});
