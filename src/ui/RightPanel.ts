import type { Studio } from '../app/Studio';
import { CAMERA_ID } from '../model/scene';
import { CameraPanel } from './CameraPanel';
import { el } from './dom';
import { InspectorPanel } from './InspectorPanel';
import { Outliner } from './Outliner';
import { CameraPathPanel, TakesPanel } from './TakesPanel';

type TabId = 'object' | 'camera' | 'takes';

/** Properties panel: Object (outliner + inspector), Camera (framing, lens, path) and Takes. */
export class RightPanel {
  readonly root: HTMLElement;
  private readonly tabButtons = new Map<TabId, HTMLButtonElement>();
  private readonly panels = new Map<TabId, HTMLElement>();

  constructor(studio: Studio, openRender: (takeId?: string) => void) {
    const { editor } = studio;
    const tabs: Array<[TabId, string]> = [
      ['object', 'Object'],
      ['camera', 'Camera'],
      ['takes', 'Takes'],
    ];
    const tablist = el('div', { class: 'panel-tabs', role: 'tablist', 'aria-label': 'Properties' });
    tabs.forEach(([id, label], i) => {
      const b = el('button', {
        type: 'button',
        role: 'tab',
        id: `rp-tab-${id}`,
        class: 'panel-tab',
        text: label,
        'aria-controls': `rp-panel-${id}`,
        onclick: () => this.show(id),
        onkeydown: (e: KeyboardEvent) => {
          const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
          if (step === undefined) return;
          e.preventDefault();
          this.show(tabs[(i + step + tabs.length) % tabs.length][0], true);
        },
      });
      this.tabButtons.set(id, b);
      tablist.append(b);
    });

    const panel = (id: TabId, ...children: HTMLElement[]) => {
      const p = el('div', { class: 'panel-body', role: 'tabpanel', id: `rp-panel-${id}`, 'aria-labelledby': `rp-tab-${id}` }, ...children);
      this.panels.set(id, p);
      return p;
    };

    this.root = el(
      'div',
      { class: 'right-panel' },
      tablist,
      panel('object', new Outliner(editor).root, new InspectorPanel(editor, studio.sync, studio.desktopEditor, 'object').root),
      panel(
        'camera',
        new InspectorPanel(editor, studio.sync, studio.desktopEditor, 'camera').root,
        new CameraPanel(editor, studio.camera, studio.cameraView).root,
        new CameraPathPanel(editor, studio.takes).root,
      ),
      panel('takes', new TakesPanel(studio.takes, openRender).root),
    );

    // Follow the selection: picking the camera opens Camera, picking an object opens Object.
    editor.subscribe((c) => {
      if (c !== 'selection' || !editor.selectedId) return;
      this.show(editor.selectedId === CAMERA_ID ? 'camera' : 'object');
    });
    studio.takes.onChange(() => {
      if (studio.takes.state === 'recording' || studio.takes.state === 'countdown') this.show('takes');
    });
    this.show('object');
  }

  show(tab: TabId, focus = false): void {
    for (const [id, b] of this.tabButtons) {
      const on = id === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      this.panels.get(id)!.hidden = !on;
    }
    if (focus) this.tabButtons.get(tab)!.focus();
  }
}
