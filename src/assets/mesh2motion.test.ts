import { describe, expect, it } from 'vitest';
import { objectPoseAt } from '../model/motion';
import { clipSpeed, identityTransform, isTravelClip, type SceneObject } from '../model/scene';
import { createScene } from '../model/scene';
import { parseScene } from '../model/serialize';
import {
  M2M_CHARACTERS,
  M2M_FAMILIES,
  M2M_PROP_LIST,
  clipLabel,
  isOneShotClip,
  m2mCatalogItems,
  m2mClipFile,
  m2mResolveClip,
  propTitle,
} from './mesh2motion';
import { M2M_CLIPS } from './mesh2motionData';

describe('Mesh2Motion catalog', () => {
  it('maps every basic clip of every family to a clip in its first animation file', () => {
    for (const family of Object.values(M2M_FAMILIES)) {
      for (const f of family.animations) expect(M2M_CLIPS[f], f).toBeDefined();
      for (const basic of ['idle', 'walk', 'run', 'sit']) {
        const clip = m2mResolveClip(family, basic);
        expect(M2M_CLIPS[family.animations[0]], `${family.id}.${basic} → ${clip}`).toContain(clip);
      }
    }
  });

  it('only lists CC0 and CC-BY characters, each with a credit', () => {
    for (const c of M2M_CHARACTERS) {
      expect(c.licence, c.key).toMatch(/^(CC0|CC-BY [\d.]+)$/);
      expect(c.creator).not.toBe('');
      expect(M2M_FAMILIES[c.family]).toBeDefined();
    }
    expect(M2M_CHARACTERS.some((c) => c.key === 'human/sophia')).toBe(false); // CC-BY-SA
    const keys = m2mCatalogItems().map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(M2M_PROP_LIST.every((p) => p.fit.size > 0)).toBe(true);
  });

  it('finds which animation file holds a clip', () => {
    const human = M2M_FAMILIES.human;
    expect(m2mClipFile(human, 'Walk')).toBe('human-base-animations.glb');
    expect(m2mClipFile(human, 'Backflip')).toBe('human-addon-animations.glb');
    expect(m2mClipFile(human, 'Salute')).toBe('human-mocap-animations.glb');
    expect(m2mClipFile(human, 'Nope')).toBeUndefined();
    expect(m2mResolveClip(M2M_FAMILIES.kaiju, 'run')).toBe('Walk'); // no run clip: falls back to walk
  });

  it('tells one-shot clips from loops', () => {
    for (const c of ['Death_A', 'Pistol_Shoot', 'Sitting_Enter', 'Jump_Start', 'Salute']) expect(isOneShotClip(c), c).toBe(true);
    for (const c of ['Idle_A', 'Walk', 'Sitting_Idle', 'Swim_Fwd', 'Side winding', 'Pushup', 'Dance Charleston']) expect(isOneShotClip(c), c).toBe(false);
  });

  it('names props and clips readably', () => {
    expect(propTitle('bow_A_withString')).toBe('Bow A with string');
    expect(propTitle('GrenadeLauncher')).toBe('Grenade launcher');
    expect(propTitle('AK')).toBe('AK');
    expect(clipLabel('Sitting_Idle')).toBe('Sitting idle');
    expect(clipLabel('idle')).toBe('Idle');
  });
});

describe('library clips in the scene model', () => {
  const actor = (clip: string): SceneObject => ({
    id: 'a',
    kind: 'actor',
    name: 'Jay',
    asset: { source: 'm2m', id: 'human/jay', title: 'Jay', creator: 'Blender Studio', licence: 'CC-BY 4.0' },
    transform: identityTransform(),
    color: '#ff0000',
    actor: { clip, speed: 2, waypoints: [[4, 0, 0]], loop: false },
  });

  it('keeps library clip names in scene files', () => {
    const doc = { ...createScene(), objects: [actor('Zombie_Walk'), { ...actor(''), id: 'b' }] };
    const parsed = parseScene(JSON.parse(JSON.stringify(doc)));
    expect(parsed.objects[0].actor!.clip).toBe('Zombie_Walk');
    expect(parsed.objects[0].asset).toEqual(doc.objects[0].asset);
    expect(parsed.objects[1].actor!.clip).toBe('idle'); // empty name repaired
  });

  it('stops travelling clips at the end of the path, and suggests speeds', () => {
    expect(objectPoseAt(actor('Zombie_Walk'), 10).clip).toBe('idle');
    expect(objectPoseAt(actor('Zombie_Walk'), 1).clip).toBe('Zombie_Walk');
    expect(objectPoseAt(actor('Dance_Simple'), 10).clip).toBe('Dance_Simple');
    expect(isTravelClip('Swim Horizontal')).toBe(true);
    expect(clipSpeed('Jog')).toBe(3.5);
    expect(clipSpeed('Dance_Simple')).toBeNull();
  });
});
