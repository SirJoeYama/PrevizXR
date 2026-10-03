import { ASPECT_IDS, FOCAL_MAX, FOCAL_MIN, FOCAL_PRESETS, FPS_OPTIONS, SENSORS, clampFocal, horizontalFovDeg, verticalFovDeg, type SensorId } from '../camera/lens';
import type { VirtualCamera } from '../camera/VirtualCamera';
import type { CameraView } from '../desktop/CameraView';
import type { Editor } from '../model/Editor';
import { CAMERA_ID, type LensSettings } from '../model/scene';
import { el, section, setValue } from './dom';

/** Virtual camera: views, lens, format and guides. */
export class CameraPanel {
  readonly root: HTMLElement;
  private readonly refreshers: Array<() => void> = [];

  constructor(
    editor: Editor,
    vcam: VirtualCamera,
    view: CameraView,
  ) {
    const lens = () => editor.doc.camera.lens;
    const set = (mutate: (l: LensSettings) => void) => editor.updateLens(mutate);

    const viewBtn = el('button', { class: 'btn', type: 'button', title: 'Look through the camera (V)', onclick: () => view.setThroughCamera(!view.throughCamera) });
    const pipBtn = el('button', { class: 'btn', type: 'button', title: 'Monitor in the corner of the viewport (M)', onclick: () => view.setPip(!view.pip) });
    this.refreshers.push(() => {
      viewBtn.textContent = view.throughCamera ? 'Exit camera view' : 'Camera view';
      viewBtn.setAttribute('aria-pressed', String(view.throughCamera));
      pipBtn.textContent = 'Monitor';
      pipBtn.setAttribute('aria-pressed', String(view.pip));
    });

    // Focal length: slider + number + presets
    let sliding = false;
    const slider = el('input', {
      type: 'range',
      class: 'range',
      min: String(FOCAL_MIN),
      max: String(FOCAL_MAX),
      step: '0.5',
      'aria-label': 'Focal length (millimetres)',
      oninput: () => {
        if (!sliding) {
          editor.begin();
          sliding = true;
        }
        editor.updateLens((l) => (l.focalLength = +slider.value), true);
      },
      onchange: () => {
        sliding = false;
        editor.commit();
      },
    });
    const focal = el('input', {
      class: 'input num',
      type: 'number',
      min: String(FOCAL_MIN),
      max: String(FOCAL_MAX),
      step: '1',
      'aria-label': 'Focal length in millimetres',
      onchange: () => {
        const v = parseFloat(focal.value);
        if (Number.isFinite(v)) set((l) => (l.focalLength = clampFocal(v)));
      },
    });
    const presets = el(
      'div',
      { class: 'chips', role: 'group', 'aria-label': 'Focal length presets' },
      ...FOCAL_PRESETS.map((f) => {
        const b = el('button', { type: 'button', class: 'chip', text: String(f), 'aria-label': `${f} millimetres`, onclick: () => set((l) => (l.focalLength = f)) });
        this.refreshers.push(() => b.setAttribute('aria-pressed', String(lens().focalLength === f)));
        return b;
      }),
    );
    const fov = el('p', { class: 'hint' });
    this.refreshers.push(() => {
      const l = lens();
      if (!sliding) setValue(slider, String(l.focalLength));
      setValue(focal, String(l.focalLength));
      fov.textContent = `Field of view ${horizontalFovDeg(l.focalLength, l.sensor, l.aspect).toFixed(1)}° × ${verticalFovDeg(l.focalLength, l.sensor, l.aspect).toFixed(1)}°`;
    });

    const sensor = el(
      'select',
      { class: 'input', 'aria-label': 'Sensor', onchange: () => set((l) => (l.sensor = sensor.value as SensorId)) },
      ...Object.values(SENSORS).map((s) => el('option', { value: s.id, text: `${s.label} (${s.width} × ${s.height} mm)` })),
    );
    this.refreshers.push(() => setValue(sensor, lens().sensor));

    const segmented = <T extends string | number>(label: string, values: readonly T[], read: () => T, write: (v: T) => void) => {
      const group = el('div', { class: 'seg', role: 'group', 'aria-label': label });
      for (const v of values) {
        const b = el('button', { type: 'button', class: 'seg-btn', text: String(v), onclick: () => write(v) });
        this.refreshers.push(() => b.setAttribute('aria-pressed', String(read() === v)));
        group.append(b);
      }
      return group;
    };
    const aspect = segmented('Aspect ratio', ASPECT_IDS, () => lens().aspect, (v) => set((l) => (l.aspect = v)));
    const fps = segmented('Frame rate', FPS_OPTIONS, () => lens().fps, (v) => set((l) => (l.fps = v)));

    const autofocus = el('input', {
      type: 'checkbox',
      onchange: () =>
        set((l) => {
          l.focusMode = autofocus.checked ? 'auto' : 'manual';
          if (!autofocus.checked && vcam.focusDistance !== null) l.focusDistance = Math.round(vcam.focusDistance * 100) / 100;
        }),
    });
    const focusDist = el('input', {
      class: 'input num',
      type: 'number',
      min: '0.1',
      step: '0.1',
      'aria-label': 'Manual focus distance (metres)',
      onchange: () => {
        const v = parseFloat(focusDist.value);
        if (Number.isFinite(v) && v > 0) set((l) => (l.focusDistance = v));
      },
    });
    const focusLive = el('span', { class: 'hint', 'aria-live': 'off' });
    this.refreshers.push(() => {
      const l = lens();
      autofocus.checked = l.focusMode === 'auto';
      focusDist.disabled = l.focusMode === 'auto';
      setValue(focusDist, l.focusMode === 'auto' && vcam.focusDistance !== null ? vcam.focusDistance.toFixed(2) : String(l.focusDistance));
      focusLive.textContent = vcam.focusDistance === null ? '∞' : `${vcam.focusDistance.toFixed(2)} m`;
    });

    const guide = (key: keyof LensSettings['guides'], label: string) => {
      const box = el('input', { type: 'checkbox', onchange: () => set((l) => (l.guides[key] = box.checked)) });
      this.refreshers.push(() => (box.checked = lens().guides[key]));
      return el('label', { class: 'check' }, box, ` ${label}`);
    };

    this.root = section(
      'Camera',
      'sb-camera',
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn', type: 'button', text: 'Select', title: 'Select the camera (C)', onclick: () => editor.select(CAMERA_ID) }),
        viewBtn,
      ),
      el(
        'div',
        { class: 'row' },
        pipBtn,
        el('button', { class: 'btn', type: 'button', text: 'Match view', title: 'Move the camera to the current viewport position', onclick: () => view.matchView() }),
      ),
      el('div', { class: 'focal-row' }, el('span', { class: 'field-label', text: 'Focal mm' }), slider, focal),
      presets,
      fov,
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Sensor' }), sensor),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Aspect' }), aspect),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'FPS' }), fps),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Focus' }), el('div', { class: 'focus-row' }, el('label', { class: 'check' }, autofocus, ' Auto'), focusDist, focusLive)),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Guides' }), el('div', { class: 'checks' }, guide('thirds', 'Thirds'), guide('safe', 'Safe areas'), guide('center', 'Centre'))),
    );

    editor.subscribe((c) => c !== 'history' && this.refresh());
    view.onChange(() => this.refresh());
    window.setInterval(() => {
      if (lens().focusMode === 'auto') this.refresh();
    }, 250);
    this.refresh();
  }

  private refresh(): void {
    for (const r of this.refreshers) r();
  }
}
