import type { Editor } from '../model/Editor';
import { CAMERA_ID, type SceneObject } from '../model/scene';
import { el } from './dom';
import { icon, type IconName } from './icons';

const KIND_ICON = (o: SceneObject): IconName => (o.asset.source === 'image' ? 'image' : o.kind === 'actor' ? 'person' : o.kind === 'light' ? 'bulb' : 'cube');

/** Everything in the scene as a list: click to select. The camera is always first. */
export class Outliner {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly count: HTMLElement;

  constructor(private readonly editor: Editor) {
    this.count = el('span', { class: 'count' });
    this.list = el('ul', { class: 'outliner', 'aria-label': 'Scene objects' });
    this.root = el('div', { class: 'group' }, el('h3', { class: 'group-title' }, 'Scene ', this.count), this.list);
    editor.subscribe((c) => c !== 'history' && this.render());
    this.render();
  }

  private render(): void {
    const { objects } = this.editor.doc;
    this.count.textContent = String(objects.length);
    const row = (id: string, name: string, iconName: IconName, color?: string, hidden?: boolean) =>
      el(
        'li',
        {},
        el(
          'button',
          {
            type: 'button',
            class: 'outliner-item',
            'aria-current': this.editor.selectedId === id ? 'true' : undefined,
            onclick: () => this.editor.select(id),
          },
          color ? el('span', { class: 'swatch-sm', style: `background:${color}`, 'aria-hidden': 'true' }) : el('span', { class: 'swatch-sm none', 'aria-hidden': 'true' }),
          icon(iconName, 15),
          el('span', { class: 'outliner-name', text: name }),
          hidden ? el('span', { class: 'outliner-flag', title: 'Hidden in renders', 'aria-label': 'hidden in renders' }, icon('eyeOff', 14)) : null,
        ),
      );
    this.list.replaceChildren(row(CAMERA_ID, 'Camera', 'camera'), ...objects.map((o) => row(o.id, o.name, KIND_ICON(o), o.color, o.hiddenInRenders)));
    this.list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }
}
