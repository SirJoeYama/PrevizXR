import { Euler, Quaternion } from 'three';
import type { DesktopEditor, GizmoMode } from '../desktop/DesktopEditor';
import { snapToFloor } from '../interaction/ops';
import type { Editor } from '../model/Editor';
import { ACTOR_CLIPS, DEFAULT_SPEED, type SceneObject, type Transform } from '../model/scene';
import type { SceneSync } from '../sync/SceneSync';
import { el, section, setValue } from './dom';

const DEG = 180 / Math.PI;
const euler = new Euler(0, 0, 0, 'YXZ');
const quat = new Quaternion();

/** Properties of the selected object: transform, actor clip/path, light settings, actions. */
export class InspectorPanel {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private renderedId: string | null = null;
  private refresh: (() => void) | null = null;

  constructor(
    private readonly editor: Editor,
    private readonly sync: SceneSync,
    private readonly desktop: DesktopEditor,
  ) {
    this.body = el('div', { class: 'stack' });
    this.root = section('Selected', 'sb-inspector', this.body);
    editor.subscribe(() => this.render());
    desktop.onChange(() => this.render(true));
    this.render();
  }

  private render(force = false): void {
    const obj = this.editor.selected;
    if (!obj) {
      this.renderedId = null;
      this.refresh = null;
      this.body.replaceChildren(el('p', { class: 'hint', text: 'Click an object to select it, or add one above.' }));
      return;
    }
    // Rebuild the form only when the selection changes; otherwise update values in place so typing isn't interrupted.
    if (obj.id !== this.renderedId || force) this.build(obj);
    this.refresh?.();
  }

  private build(obj: SceneObject): void {
    this.renderedId = obj.id;
    const id = obj.id;
    const current = () => this.editor.find(id);
    const updaters: Array<() => void> = [];

    const name = el('input', {
      class: 'input',
      type: 'text',
      'aria-label': 'Object name',
      onchange: () => {
        const v = name.value.trim();
        if (v) this.editor.update(id, (o) => (o.name = v));
      },
    });
    updaters.push(() => setValue(name, current()?.name ?? ''));

    const swatch = el('span', { class: 'swatch', title: 'ID color (used by the color_id pass)' });
    updaters.push(() => (swatch.style.background = current()?.color ?? ''));

    const modes: Array<[GizmoMode, string, string]> = [
      ['translate', 'Move', '1'],
      ['rotate', 'Rotate', '2'],
      ['scale', 'Scale', '3'],
    ];
    const modeRow = el(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'Gizmo mode' },
      ...modes.map(([m, label, key]) =>
        el('button', {
          type: 'button',
          class: 'seg-btn',
          text: label,
          title: `${label} (${key})`,
          'aria-pressed': String(this.desktop.mode === m),
          onclick: () => this.desktop.setMode(m),
        }),
      ),
    );

    const fields = this.transformFields(id, updaters);

    const actions = el(
      'div',
      { class: 'row three' },
      el('button', { class: 'btn', type: 'button', text: 'To floor', title: 'Snap to floor (G)', onclick: () => snapToFloor(this.editor, this.sync, id) }),
      el('button', { class: 'btn', type: 'button', text: 'Duplicate', title: 'Duplicate (Ctrl+D)', onclick: () => this.editor.duplicate(id) }),
      el('button', { class: 'btn danger', type: 'button', text: 'Delete', title: 'Delete (Del)', onclick: () => this.editor.remove(id) }),
    );

    const parts: Array<HTMLElement | null> = [
      el('div', { class: 'name-row' }, swatch, name),
      modeRow,
      fields,
      obj.actor ? this.actorFields(id, updaters) : null,
      obj.light ? this.lightFields(id, updaters) : null,
      actions,
      obj.asset.source === 'poly' ? el('p', { class: 'hint', text: `“${obj.asset.title}” by ${obj.asset.creator}, ${obj.asset.licence}` }) : null,
    ];
    this.body.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
    this.refresh = () => updaters.forEach((u) => u());
  }

  private transformFields(id: string, updaters: Array<() => void>): HTMLElement {
    const commit = (mutate: (t: Transform) => void) => {
      const obj = this.editor.find(id);
      if (!obj) return;
      const t = structuredClone(obj.transform);
      mutate(t);
      this.editor.setTransform(id, t);
    };
    const num = (label: string, step: number, read: (o: SceneObject) => number, write: (t: Transform, v: number) => void) => {
      const input = el('input', {
        class: 'input num',
        type: 'number',
        step: String(step),
        'aria-label': label,
        onchange: () => {
          const v = parseFloat(input.value);
          if (Number.isFinite(v)) commit((t) => write(t, v));
        },
      });
      updaters.push(() => {
        const o = this.editor.find(id);
        if (o) setValue(input, String(+read(o).toFixed(3)));
      });
      return input;
    };
    const yaw = (o: SceneObject) => euler.setFromQuaternion(quat.fromArray(o.transform.rotation), 'YXZ').y * DEG;
    const setYaw = (t: Transform, deg: number) => {
      euler.setFromQuaternion(quat.fromArray(t.rotation), 'YXZ');
      euler.y = deg / DEG;
      t.rotation = quat.setFromEuler(euler).toArray() as Transform['rotation'];
    };

    return el(
      'div',
      { class: 'grid-fields' },
      el('span', { class: 'field-label', text: 'Position' }),
      num('Position X (m)', 0.1, (o) => o.transform.position[0], (t, v) => (t.position[0] = v)),
      num('Position Y (m)', 0.1, (o) => o.transform.position[1], (t, v) => (t.position[1] = v)),
      num('Position Z (m)', 0.1, (o) => o.transform.position[2], (t, v) => (t.position[2] = v)),
      el('span', { class: 'field-label', text: 'Turn °' }),
      num('Rotation about vertical axis (degrees)', 15, yaw, setYaw),
      el('span', { class: 'field-label', text: 'Scale' }),
      num('Uniform scale', 0.1, (o) => o.transform.scale[1], (t, v) => (t.scale = [v, v, v])),
    );
  }

  private actorFields(id: string, updaters: Array<() => void>): HTMLElement {
    const clip = el('select', {
      class: 'input',
      'aria-label': 'Animation clip',
      onchange: () =>
        this.editor.update(id, (o) => {
          const c = clip.value as (typeof ACTOR_CLIPS)[number];
          o.actor!.clip = c;
          if (DEFAULT_SPEED[c] > 0) o.actor!.speed = DEFAULT_SPEED[c];
        }),
    }, ...ACTOR_CLIPS.map((c) => el('option', { value: c, text: c[0].toUpperCase() + c.slice(1) })));
    const speed = el('input', {
      class: 'input num',
      type: 'number',
      step: '0.1',
      min: '0',
      'aria-label': 'Path speed (metres per second)',
      onchange: () => {
        const v = parseFloat(speed.value);
        if (Number.isFinite(v) && v >= 0) this.editor.update(id, (o) => (o.actor!.speed = v));
      },
    });
    const loop = el('input', { type: 'checkbox', onchange: () => this.editor.update(id, (o) => (o.actor!.loop = loop.checked)) });
    const pathBtn = el('button', {
      class: 'btn',
      type: 'button',
      title: 'Click the floor to add waypoints (P, Esc to finish)',
      onclick: () => this.desktop.setPathMode(!this.desktop.pathMode),
    });
    const clearBtn = el('button', { class: 'btn', type: 'button', onclick: () => this.editor.update(id, (o) => (o.actor!.waypoints = [])) });
    const undoPoint = el('button', { class: 'btn', type: 'button', text: '− Last', title: 'Remove the last waypoint', onclick: () => this.editor.update(id, (o) => o.actor!.waypoints.pop()) });

    updaters.push(() => {
      const a = this.editor.find(id)?.actor;
      if (!a) return;
      setValue(clip, a.clip);
      setValue(speed, String(a.speed));
      loop.checked = a.loop;
      pathBtn.textContent = this.desktop.pathMode ? 'Done drawing' : 'Draw path';
      pathBtn.setAttribute('aria-pressed', String(this.desktop.pathMode));
      clearBtn.textContent = `Clear (${a.waypoints.length})`;
      clearBtn.disabled = undoPoint.disabled = a.waypoints.length === 0;
    });

    return el(
      'div',
      { class: 'stack' },
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Clip' }), clip),
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Speed m/s' }), speed),
      el('div', { class: 'row three' }, pathBtn, undoPoint, clearBtn),
      el('label', { class: 'check' }, loop, ' Loop path back to start'),
      el('p', { class: 'hint', text: 'Waypoints play back with Preview (Space).' }),
    );
  }

  private lightFields(id: string, updaters: Array<() => void>): HTMLElement {
    const color = el('input', { type: 'color', class: 'color', 'aria-label': 'Light color', onchange: () => this.editor.update(id, (o) => (o.light!.color = color.value)) });
    const intensity = el('input', {
      class: 'input num',
      type: 'number',
      step: '5',
      min: '0',
      'aria-label': 'Light intensity (candela)',
      onchange: () => {
        const v = parseFloat(intensity.value);
        if (Number.isFinite(v) && v >= 0) this.editor.update(id, (o) => (o.light!.intensity = v));
      },
    });
    updaters.push(() => {
      const l = this.editor.find(id)?.light;
      if (!l) return;
      setValue(color, l.color);
      setValue(intensity, String(l.intensity));
    });
    return el(
      'div',
      { class: 'stack' },
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Color' }), color),
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Intensity' }), intensity),
    );
  }
}
