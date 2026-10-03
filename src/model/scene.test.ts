import { describe, expect, it } from 'vitest';
import { SCENE_FORMAT_VERSION, createScene, identityTransform } from './scene';

describe('scene model', () => {
  it('creates an empty, versioned scene', () => {
    const scene = createScene('Test');
    expect(scene.format).toBe('previzxr.scene');
    expect(scene.version).toBe(SCENE_FORMAT_VERSION);
    expect(scene.name).toBe('Test');
    expect(scene.objects).toEqual([]);
    expect(scene.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('gives each scene a unique id', () => {
    expect(createScene().id).not.toBe(createScene().id);
  });

  it('survives a JSON round trip unchanged', () => {
    const scene = createScene();
    scene.objects.push({ id: 'a', kind: 'prop', name: 'Box', transform: identityTransform() });
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
  });
});
