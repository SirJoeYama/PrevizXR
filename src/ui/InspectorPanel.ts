import { Euler, Quaternion } from 'three';
import type { DesktopEditor } from '../desktop/DesktopEditor';
import type { Editor } from '../model/Editor';
import { hasEditedHandles, smoothPath } from '../model/pathEdit';
import { ACTOR_CLIPS, CAMERA_ID, DEFAULT_SPEED, clearWaypoints, editPath, pathOf, popWaypoint, type SceneObject, type Transform } from '../model/scene';
import type { SceneSync } from '../sync/SceneSync';
import { el, section, setValue } from './dom';
import { icon } from './icons';

const DEG = 180 / Math.PI;
const euler = new Euler(0, 0, 0, 'YXZ');
const quat = new Quaternion();

/**
 * Properties panel. 'object' mode edits the selected object (transform, actor clip/path, light, render
 * visibility); 'camera' mode always shows the camera's position and orientation.
 */
export class InspectorPanel {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private renderedId: string | null = null;
  private refresh: (() => void) | null = null;

  constructor(
    private readonly editor: Editor,
    _sync: SceneSync,
    private readonly desktop: DesktopEditor,
    private readonly mode: 'object' | 'camera' = 'object',
  ) {
    this.body = el('div', { class: 'stack' });
    this.root = mode === 'camera' ? section('Position', 'rp-camera-position', this.body) : el('div', { class: 'group' }, this.body);
    editor.subscribe(() => this.render());
    desktop.onChange(() => this.render(true));
    this.render();
  }

  private render(force = false): void {
    if (this.mode === 'camera') {
      if (this.renderedId !== CAMERA_ID || force) this.buildCamera();
      this.refresh?.();
      return;
    }
    const obj = this.editor.selected;
    if (!obj) {
      if (this.renderedId === null && !force && this.body.childElementCount) return;
      this.renderedId = null;
      this.refresh = null;
      this.body.replaceChildren(
        el('p', { class: 'empty-hint', text: this.editor.cameraSelected ? 'The camera is selected. Its settings are in the Camera tab.' : 'Select an object in the view or the list above to edit it.' }),
      );
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
      class: 'input name-input',
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

    const fields = this.transformFields(id, updaters);
    const action = (label: string, iconName: 'copy' | 'trash', onclick: () => void, danger = false) =>
      el('button', { class: `icon-btn${danger ? ' danger' : ''}`, type: 'button', title: label, 'aria-label': label, onclick }, icon(iconName, 16));

    const hidden = el('input', { type: 'checkbox', onchange: () => this.editor.update(id, (o) => (o.hiddenInRenders = hidden.checked || undefined)) });
    updaters.push(() => (hidden.checked = !!current()?.hiddenInRenders));
    const hiddenRow = el('label', { class: 'check', title: 'Reference only: not shown on the camera monitor or in rendered passes' }, hidden, ' Hide in renders');

    const parts: Array<HTMLElement | null> = [
      el(
        'div',
        { class: 'name-row' },
        swatch,
        name,
        action('Duplicate (Ctrl+D)', 'copy', () => this.editor.duplicate(id)),
        action('Delete (Del)', 'trash', () => this.editor.remove(id), true),
      ),
      fields,
      obj.actor ? this.clipField(id, updaters) : null,
      this.pathFields(id, updaters),
      obj.light ? this.lightFields(id, updaters) : null,
      hiddenRow,
      obj.asset.source === 'poly' ? el('p', { class: 'hint', text: `“${obj.asset.title}” by ${obj.asset.creator}, ${obj.asset.licence}` }) : null,
    ];
    this.body.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
    this.refresh = () => updaters.forEach((u) => u());
  }

  /**
   * Position plus rotation fields. Objects get turn (yaw) and uniform scale; the camera gets pan, tilt and roll.
   */
  private transformFields(id: string, updaters: Array<() => void>, camera = false): HTMLElement {
    const read = (): Transform | undefined => (id === CAMERA_ID ? this.editor.doc.camera.transform : this.editor.find(id)?.transform);
    const commit = (mutate: (t: Transform) => void) => {
      const current = read();
      if (!current) return;
      const t = structuredClone(current);
      mutate(t);
      this.editor.setTransform(id, t);
    };
    const num = (label: string, step: number, get: (t: Transform) => number, set: (t: Transform, v: number) => void, wide = false) => {
      const input = el('input', {
        class: wide ? 'input num wide' : 'input num',
        type: 'number',
        step: String(step),
        'aria-label': label,
        onchange: () => {
          const v = parseFloat(input.value);
          if (Number.isFinite(v)) commit((t) => set(t, v));
        },
      });
      updaters.push(() => {
        const t = read();
        if (t) setValue(input, String(+get(t).toFixed(camera ? 1 : 3)));
      });
      return input;
    };
    const angle = (axis: 'x' | 'y' | 'z') => ({
      get: (t: Transform) => euler.setFromQuaternion(quat.fromArray(t.rotation), 'YXZ')[axis] * DEG,
      set: (t: Transform, deg: number) => {
        euler.setFromQuaternion(quat.fromArray(t.rotation), 'YXZ');
        euler[axis] = deg / DEG;
        t.rotation = quat.setFromEuler(euler).toArray() as Transform['rotation'];
      },
    });
    const pan = angle('y');
    const tilt = angle('x');
    const roll = angle('z');

    return el(
      'div',
      { class: 'grid-fields' },
      el('span', { class: 'field-label', text: 'Position' }),
      num('Position X (m)', 0.1, (t) => t.position[0], (t, v) => (t.position[0] = v)),
      num('Position Y (m)', 0.1, (t) => t.position[1], (t, v) => (t.position[1] = v)),
      num('Position Z (m)', 0.1, (t) => t.position[2], (t, v) => (t.position[2] = v)),
      ...(camera
        ? [
            el('span', { class: 'field-label', text: 'Pan Tilt Roll' }),
            num('Pan (degrees)', 5, pan.get, pan.set),
            num('Tilt (degrees)', 5, tilt.get, tilt.set),
            num('Roll / dutch angle (degrees)', 5, roll.get, roll.set),
          ]
        : [
            el('span', { class: 'field-label', text: 'Turn °' }),
            num('Rotation about vertical axis (degrees)', 15, pan.get, pan.set, true),
            el('span', { class: 'field-label', text: 'Scale' }),
            num('Uniform scale', 0.1, (t) => t.scale[1], (t, v) => (t.scale = [v, v, v]), true),
          ]),
    );
  }

  private buildCamera(): void {
    this.renderedId = CAMERA_ID;
    const updaters: Array<() => void> = [];
    const level = () => {
      const t = structuredClone(this.editor.doc.camera.transform);
      euler.setFromQuaternion(quat.fromArray(t.rotation), 'YXZ');
      euler.x = 0;
      euler.z = 0;
      t.rotation = quat.setFromEuler(euler).toArray() as Transform['rotation'];
      this.editor.setTransform(CAMERA_ID, t);
    };
    const eye = () => {
      const t = structuredClone(this.editor.doc.camera.transform);
      t.position[1] = 1.6;
      this.editor.setTransform(CAMERA_ID, t);
    };
    this.body.replaceChildren(
      this.transformFields(CAMERA_ID, updaters, true),
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn', type: 'button', text: 'Level', title: 'Remove tilt and roll', onclick: level }),
        el('button', { class: 'btn', type: 'button', text: 'Eye height', title: 'Lens at 1.6 m', onclick: eye }),
        el('button', { class: 'btn', type: 'button', text: 'Select', title: 'Select the camera to move it with the gizmo (C)', onclick: () => this.editor.select(CAMERA_ID) }),
      ),
    );
    this.refresh = () => updaters.forEach((u) => u());
  }

  private clipField(id: string, updaters: Array<() => void>): HTMLElement {
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
    updaters.push(() => {
      const a = this.editor.find(id)?.actor;
      if (a) setValue(clip, a.clip);
    });
    return el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Clip' }), clip);
  }

  /** Waypoint path: actors walk it; props and lights travel it at their own height. */
  private pathFields(id: string, updaters: Array<() => void>): HTMLElement {
    const speed = el('input', {
      class: 'input num',
      type: 'number',
      step: '0.1',
      min: '0',
      'aria-label': 'Path speed (metres per second)',
      onchange: () => {
        const v = parseFloat(speed.value);
        if (Number.isFinite(v) && v >= 0) this.editor.update(id, (o) => (editPath(o).speed = v));
      },
    });
    const loop = el('input', { type: 'checkbox', onchange: () => this.editor.update(id, (o) => (editPath(o).loop = loop.checked)) });
    const pathBtn = el('button', {
      class: 'btn',
      type: 'button',
      title: 'Click the floor to add waypoints (P, Esc to finish)',
      onclick: () => this.desktop.setPathMode(!this.desktop.pathMode),
    });
    const clearBtn = el('button', { class: 'btn', type: 'button', onclick: () => this.editor.update(id, (o) => clearWaypoints(o)) });
    const undoPoint = el('button', { class: 'btn', type: 'button', text: '− Last', title: 'Remove the last waypoint', onclick: () => this.editor.update(id, (o) => popWaypoint(o)) });
    const smoothBtn = el('button', { class: 'btn', type: 'button', text: 'Smooth curve', title: 'Reset every edited curve handle to a smooth curve', onclick: () => this.editor.edit((d) => smoothPath(d, id)) });

    updaters.push(() => {
      const obj = this.editor.find(id);
      if (!obj) return;
      const a = pathOf(obj) ?? editPath(structuredClone(obj));
      setValue(speed, String(a.speed));
      loop.checked = a.loop;
      pathBtn.textContent = this.desktop.pathMode ? 'Done drawing' : 'Draw path';
      pathBtn.setAttribute('aria-pressed', String(this.desktop.pathMode));
      clearBtn.textContent = `Clear (${a.waypoints.length})`;
      clearBtn.disabled = undoPoint.disabled = a.waypoints.length === 0;
      smoothBtn.disabled = !hasEditedHandles(this.editor.doc, id);
    });

    return el(
      'div',
      { class: 'stack' },
      el('span', { class: 'field-label', text: 'Path' }),
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Speed m/s' }), speed),
      el('div', { class: 'row three' }, pathBtn, undoPoint, clearBtn),
      el('label', { class: 'check' }, loop, ' Loop path back to start'),
      el('div', { class: 'row' }, smoothBtn),
      el('p', { class: 'hint', text: 'Click a waypoint or curve handle in the view to drag it. Paths play back with Preview (Space).' }),
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
