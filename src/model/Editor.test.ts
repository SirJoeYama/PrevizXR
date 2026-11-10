import { describe, expect, it } from 'vitest';
import { Editor } from './Editor';
import { identityTransform, type Transform } from './scene';

const box = () => ({
  kind: 'prop' as const,
  name: 'Box',
  asset: { source: 'primitive' as const, id: 'box' as const },
  transform: identityTransform(),
});
const at = (x: number): Transform => ({ ...identityTransform(), position: [x, 0, 0] });
const xOf = (ed: Editor, id: string) => ed.find(id)!.transform.position[0];

describe('Editor history', () => {
  it('keeps undo snapshots intact through later edits and drags', () => {
    const ed = new Editor();
    const a = ed.add(box());
    ed.setTransform(a.id, at(1));
    ed.begin();
    ed.setTransform(a.id, at(2), true);
    ed.setTransform(a.id, at(3), true);
    ed.commit();
    ed.setTransform(a.id, at(4));

    ed.undo();
    expect(xOf(ed, a.id)).toBe(3);
    ed.undo();
    expect(xOf(ed, a.id)).toBe(1);
    ed.undo();
    expect(xOf(ed, a.id)).toBe(0);
    ed.redo();
    ed.redo();
    ed.redo();
    expect(xOf(ed, a.id)).toBe(4);
    expect(ed.canRedo).toBe(false);
  });

  it('dragging after an undo does not disturb the state that was undone to', () => {
    const ed = new Editor();
    const a = ed.add(box());
    ed.setTransform(a.id, at(1));
    ed.setTransform(a.id, at(2));
    ed.undo(); // back at 1
    ed.begin();
    ed.setTransform(a.id, at(9), true);
    ed.commit();
    ed.undo();
    expect(xOf(ed, a.id)).toBe(1);
    ed.undo();
    expect(xOf(ed, a.id)).toBe(0);
  });

  it('treats a drag in progress as a new edit when redo is pressed', () => {
    const ed = new Editor();
    const a = ed.add(box());
    ed.setTransform(a.id, at(1));
    ed.undo(); // back at 0, redo would restore 1
    ed.begin();
    ed.setTransform(a.id, at(5), true);
    ed.redo(); // the drag replaced the redo branch
    expect(xOf(ed, a.id)).toBe(5);
    expect(ed.canRedo).toBe(false);
    ed.undo();
    expect(xOf(ed, a.id)).toBe(0);
    ed.redo();
    expect(xOf(ed, a.id)).toBe(5);
  });

  it('records no step for a drag that changes nothing', () => {
    const ed = new Editor();
    const a = ed.add(box());
    ed.begin();
    ed.setTransform(a.id, at(0), true);
    ed.commit();
    ed.undo();
    expect(ed.doc.objects).toHaveLength(0);
  });
});
