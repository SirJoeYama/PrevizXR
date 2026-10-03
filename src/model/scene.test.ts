import { describe, expect, it } from 'vitest';
import { CAMERA_ID, SCENE_FORMAT_VERSION, assetKey, createScene, editPath, identityTransform, pathOf, waypointAt } from './scene';
import { idColorAt, nextIdColor } from './idColors';
import { Editor, uniqueName } from './Editor';
import { SceneFormatError, parseScene, serializeScene } from './serialize';

const box = () => ({
  kind: 'prop' as const,
  name: 'Box',
  asset: { source: 'primitive' as const, id: 'box' as const },
  transform: identityTransform(),
});

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

  it('keys poly assets by file so two titles never collide', () => {
    const ref = { source: 'poly' as const, id: 'abc', file: 'uuid-1', title: 'Chair', creator: 'Poly by Google', licence: 'CC-BY 3.0', fit: { axis: 'max' as const, size: 1 } };
    expect(assetKey(ref)).toBe('poly:uuid-1');
    expect(assetKey({ source: 'primitive', id: 'box' })).toBe('primitive:box');
  });
});

describe('ID colors', () => {
  it('produces valid, distinct, non-black colors', () => {
    const colors = Array.from({ length: 36 }, (_, i) => idColorAt(i));
    for (const c of colors) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
      expect(c).not.toBe('#000000');
    }
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('skips colors already in use', () => {
    expect(nextIdColor([idColorAt(0), idColorAt(1)])).toBe(idColorAt(2));
    expect(nextIdColor([idColorAt(1)])).toBe(idColorAt(0));
  });
});

describe('Editor', () => {
  it('adds objects with unique colors and selects them', () => {
    const ed = new Editor();
    const a = ed.add(box());
    const b = ed.add(box());
    expect(ed.doc.objects).toHaveLength(2);
    expect(a.color).not.toBe(b.color);
    expect(ed.selectedId).toBe(b.id);
  });

  it('gives actors default settings', () => {
    const ed = new Editor();
    const a = ed.add({ ...box(), kind: 'actor' });
    expect(a.actor).toEqual({ clip: 'idle', speed: 1.3, waypoints: [], loop: false });
  });

  it('undoes and redoes add, remove and update', () => {
    const ed = new Editor();
    const a = ed.add(box());
    ed.update(a.id, (o) => (o.name = 'Crate'));
    ed.remove(a.id);
    expect(ed.doc.objects).toHaveLength(0);
    expect(ed.selectedId).toBeNull();

    ed.undo();
    expect(ed.find(a.id)?.name).toBe('Crate');
    ed.undo();
    expect(ed.find(a.id)?.name).toBe('Box');
    ed.undo();
    expect(ed.doc.objects).toHaveLength(0);
    expect(ed.canUndo).toBe(false);

    ed.redo();
    ed.redo();
    expect(ed.find(a.id)?.name).toBe('Crate');
    expect(ed.canRedo).toBe(true);
  });

  it('clears redo after a new edit', () => {
    const ed = new Editor();
    const a = ed.add(box());
    ed.undo();
    ed.add(box());
    expect(ed.canRedo).toBe(false);
    expect(ed.find(a.id)).toBeUndefined();
  });

  it('records a drag as a single undo step', () => {
    const ed = new Editor();
    const a = ed.add(box());
    ed.begin();
    for (let i = 1; i <= 10; i++) {
      ed.setTransform(a.id, { ...identityTransform(), position: [i, 0, 0] }, true);
    }
    ed.commit();
    expect(ed.find(a.id)?.transform.position).toEqual([10, 0, 0]);
    ed.undo();
    expect(ed.find(a.id)?.transform.position).toEqual([0, 0, 0]);
    ed.redo();
    expect(ed.find(a.id)?.transform.position).toEqual([10, 0, 0]);
  });

  it('does not record a drag that changed nothing', () => {
    const ed = new Editor();
    ed.add(box());
    ed.undo();
    ed.redo();
    ed.begin();
    ed.commit();
    expect(ed.canRedo).toBe(false);
    ed.undo();
    expect(ed.doc.objects).toHaveLength(0);
  });

  it('duplicates with an offset, a new id, color and name', () => {
    const ed = new Editor();
    const a = ed.add({ ...box(), kind: 'actor' });
    ed.update(a.id, (o) => (o.actor!.waypoints = [[1, 0, 1]]));
    const b = ed.duplicate(a.id)!;
    expect(b.id).not.toBe(a.id);
    expect(b.color).not.toBe(a.color);
    expect(b.name).toBe('Box 2');
    expect(b.transform.position).toEqual([0.5, 0, 0.5]);
    expect(b.actor!.waypoints).toEqual([[1.5, 0, 1.5]]);
  });

  it('gives props a path on first edit and offsets it when duplicating', () => {
    const ed = new Editor();
    const p = ed.add(box());
    expect(pathOf(p)).toBeUndefined();
    ed.update(p.id, (o) => editPath(o).waypoints.push(waypointAt(o, 2, 3)));
    expect(ed.find(p.id)!.motion).toEqual({ speed: 2, waypoints: [[2, 0, 3]], loop: false });
    expect(ed.duplicate(p.id)!.motion!.waypoints).toEqual([[2.5, 0, 3.5]]);
  });

  it('notifies listeners', () => {
    const ed = new Editor();
    const seen: string[] = [];
    ed.subscribe((c) => seen.push(c));
    ed.add(box());
    expect(seen).toContain('doc');
    expect(seen).toContain('selection');
  });
});

describe('camera keyframes', () => {
  it('adds keys at the camera, timed by distance, and keeps them sorted', () => {
    const ed = new Editor();
    ed.addCameraKey();
    ed.setTransform(CAMERA_ID, { position: [3, 1.6, 4], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
    ed.updateLens((l) => (l.focalLength = 50));
    ed.addCameraKey();
    expect(ed.doc.camera.keyframes.map((k) => [k.time, k.position[0], k.focalLength])).toEqual([[0, 0, 35], [3, 3, 50]]);
    ed.editKeys((ks) => (ks[0].time = 5));
    expect(ed.doc.camera.keyframes.map((k) => k.time)).toEqual([3, 5]);
    ed.goToKey(1);
    expect(ed.doc.camera.transform.position).toEqual([0, 1.6, 4]);
    expect(ed.doc.camera.lens.focalLength).toBe(35);
  });
});

describe('uniqueName', () => {
  it('numbers duplicates', () => {
    expect(uniqueName('Chair', [])).toBe('Chair');
    expect(uniqueName('Chair', [{ name: 'Chair' }])).toBe('Chair 2');
    expect(uniqueName('Chair 2', [{ name: 'Chair' }, { name: 'Chair 2' }])).toBe('Chair 3');
  });
});

describe('scene serialization', () => {
  it('round-trips through JSON', () => {
    const ed = new Editor();
    ed.add(box());
    ed.add({ ...box(), kind: 'actor', name: 'Ana' });
    const text = serializeScene(ed.doc);
    expect(parseScene(text)).toEqual(ed.doc);
  });

  it('rejects files that are not scenes', () => {
    expect(() => parseScene('not json')).toThrow(SceneFormatError);
    expect(() => parseScene({ format: 'other' })).toThrow(/Not a PrevizXR scene/);
    expect(() => parseScene({ ...createScene(), version: 99 })).toThrow(/Unsupported scene version/);
  });

  it('rejects invalid objects and duplicate ids', () => {
    const doc = createScene();
    const obj = { id: 'a', kind: 'prop', name: 'A', asset: { source: 'primitive', id: 'box' }, transform: identityTransform(), color: '#ff0000' };
    expect(() => parseScene({ ...doc, objects: [{ ...obj, transform: { position: [0, 0] } }] })).toThrow(/transform/);
    expect(() => parseScene({ ...doc, objects: [{ ...obj, color: 'red' }] })).toThrow(/color/);
    expect(() => parseScene({ ...doc, objects: [obj, obj] })).toThrow(/duplicate/);
  });

  it('repairs bad actor settings instead of failing', () => {
    const doc = createScene();
    const actor = {
      id: 'a', kind: 'actor', name: 'A', asset: { source: 'bundled', id: 'man' }, transform: identityTransform(), color: '#ff0000',
      actor: { clip: 'dance', speed: 'fast', waypoints: [[1, 2]], loop: 1 },
    };
    const parsed = parseScene({ ...doc, objects: [actor] });
    expect(parsed.objects[0].actor).toEqual({ clip: 'idle', speed: 1.3, waypoints: [], loop: true });
    const prop = { ...actor, id: 'p', kind: 'prop', actor: undefined, motion: { speed: null, waypoints: [[1, 0, 2]], loop: 0 } };
    expect(parseScene({ ...doc, objects: [prop] }).objects[0].motion).toEqual({ speed: 2, waypoints: [[1, 0, 2]], loop: false });
  });
});

describe('camera rig', () => {
  it('is part of every new scene with sensible defaults', () => {
    const cam = createScene().camera;
    expect(cam.lens).toMatchObject({ focalLength: 35, sensor: 'super35', aspect: '16:9', fps: 24, focusMode: 'auto' });
    expect(cam.transform.position).toEqual([0, 1.6, 4]);
  });

  it('can be selected and moved like an object, but never scaled', () => {
    const ed = new Editor();
    ed.select(CAMERA_ID);
    expect(ed.cameraSelected).toBe(true);
    expect(ed.selected).toBeUndefined();
    ed.setTransform(CAMERA_ID, { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [5, 5, 5] });
    expect(ed.doc.camera.transform).toEqual({ position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
    ed.undo();
    expect(ed.doc.camera.transform.position).toEqual([0, 1.6, 4]);
    expect(ed.cameraSelected).toBe(true);
  });

  it('ignores delete and duplicate', () => {
    const ed = new Editor();
    ed.remove(CAMERA_ID);
    expect(ed.duplicate(CAMERA_ID)).toBeUndefined();
    expect(ed.canUndo).toBe(false);
  });

  it('records lens changes, with continuous changes as one step', () => {
    const ed = new Editor();
    ed.updateLens((l) => (l.aspect = '2.39:1'));
    ed.begin();
    for (const f of [40, 50, 60]) ed.updateLens((l) => (l.focalLength = f), true);
    ed.commit();
    expect(ed.doc.camera.lens.focalLength).toBe(60);
    ed.undo();
    expect(ed.doc.camera.lens.focalLength).toBe(35);
    expect(ed.doc.camera.lens.aspect).toBe('2.39:1');
  });

  it('is added to older scene files and repaired when invalid', () => {
    const old: Partial<ReturnType<typeof createScene>> = createScene();
    delete old.camera;
    expect(parseScene(old).camera).toEqual(createScene().camera);
    const bad = { ...createScene(), camera: { transform: { position: [0, 1] }, lens: { focalLength: 500, sensor: 'imax', aspect: '4:3', fps: 60, guides: { thirds: false } } } };
    const cam = parseScene(bad).camera;
    expect(cam.transform.position).toEqual([0, 1.6, 4]);
    expect(cam.lens).toMatchObject({ focalLength: 135, sensor: 'super35', aspect: '16:9', fps: 24 });
    expect(cam.lens.guides.thirds).toBe(false);
  });
});
