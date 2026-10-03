import type { Studio } from '../app/Studio';
import type { GizmoMode } from '../desktop/DesktopEditor';
import { snapToFloor } from '../interaction/ops';
import { el } from './dom';
import { icon, type IconName } from './icons';

/** Floating viewport toolbar, a mode banner, a status line and an empty-scene hint. */
export class ViewportOverlay {
  constructor(
    host: HTMLElement,
    studio: Studio,
    onCredits: () => void,
  ) {
    const { editor, desktopEditor: de, cameraView: cv, app, sync } = studio;

    const tool = (name: IconName, label: string, onclick: () => void) =>
      el('button', { class: 'tool', type: 'button', title: label, 'aria-label': label, onclick }, icon(name));
    const modes: Array<[GizmoMode, IconName, string]> = [
      ['translate', 'move', 'Move (1)'],
      ['rotate', 'rotate', 'Rotate (2)'],
      ['scale', 'scale', 'Scale (3)'],
    ];
    const modeBtns = modes.map(([m, i, l]) => [m, tool(i, l, () => de.setMode(m))] as const);
    const floorBtn = tool('floor', 'Snap selection to the floor (G)', () => editor.selectedId && snapToFloor(editor, sync, editor.selectedId));
    const focusBtn = tool('focus', 'Focus the view on the selection (F)', () => de.focusSelected());
    const camBtn = tool('camera', 'Look through the camera (V)', () => cv.setThroughCamera(!cv.throughCamera));
    const monBtn = tool('monitor', 'Camera monitor in the corner (M)', () => cv.setPip(!cv.pip));

    const toolbar = el(
      'div',
      { class: 'vp-toolbar', role: 'toolbar', 'aria-label': 'Viewport tools' },
      el('div', { class: 'tool-group' }, ...modeBtns.map(([, b]) => b)),
      el('div', { class: 'tool-group' }, floorBtn, focusBtn),
      el('div', { class: 'tool-group' }, camBtn, monBtn),
    );
    const banner = el('div', { class: 'vp-banner', role: 'status', hidden: true });
    const status = el('div', { class: 'vp-status' });
    const fps = el('span');
    const objects = el('span');
    status.append(objects, el('span', { class: 'dot-sep', text: '·' }), fps, el('span', { class: 'dot-sep', text: '·' }), el('button', { class: 'linkish', type: 'button', text: 'Credits', onclick: onCredits }));
    const empty = el(
      'div',
      { class: 'vp-empty', hidden: true },
      el('p', { class: 'vp-empty-title', text: 'Start blocking out your scene' }),
      el('p', { text: 'Add actors and props from the left panel, drop reference images here, then press V to look through the camera.' }),
    );
    host.append(toolbar, banner, status, empty);

    const refresh = () => {
      const sel = editor.selectedId;
      const hasObject = !!editor.selected;
      for (const [m, b] of modeBtns) {
        b.setAttribute('aria-pressed', String(de.mode === m));
        b.disabled = !sel || cv.throughCamera;
      }
      floorBtn.disabled = !hasObject;
      focusBtn.disabled = !sel;
      camBtn.setAttribute('aria-pressed', String(cv.throughCamera));
      monBtn.setAttribute('aria-pressed', String(cv.pip));
      monBtn.disabled = cv.throughCamera;
      const n = editor.doc.objects.length;
      objects.textContent = `${n} object${n === 1 ? '' : 's'}`;
      empty.hidden = n > 0;
      const msg = de.pathMode ? 'Drawing a path: click the floor to add waypoints. Esc or P to finish.' : cv.throughCamera ? 'Camera view: drag to aim, W A S D / Q E to move, wheel to zoom. V or Esc to exit.' : '';
      banner.textContent = msg;
      banner.hidden = !msg;
    };
    editor.subscribe(refresh);
    de.onChange(refresh);
    cv.onChange(refresh);
    window.setInterval(() => (fps.textContent = app.fps > 0 ? `${Math.round(app.fps)} fps` : '– fps'), 500);
    refresh();
  }
}
