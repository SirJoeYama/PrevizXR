import type { Project } from '../app/Project';
import type { Editor } from '../model/Editor';
import { el, section, setValue } from './dom';

const STATUS_TEXT: Record<Project['status'], string> = {
  saved: 'Saved in this browser',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  error: 'Could not save (storage blocked?)',
};

/** Scene name, autosave status, saved-scene list, new/import/export. */
export class ScenePanel {
  readonly root: HTMLElement;
  private readonly name: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly list: HTMLElement;
  private readonly error: HTMLElement;

  constructor(
    private readonly editor: Editor,
    private readonly project: Project,
  ) {
    this.name = el('input', {
      class: 'input',
      type: 'text',
      'aria-label': 'Scene name',
      onchange: () => {
        const v = this.name.value.trim();
        if (v && v !== editor.doc.name) editor.rename(v);
      },
    });
    this.status = el('p', { class: 'hint', 'aria-live': 'polite' });
    this.error = el('p', { class: 'hint error', role: 'alert', hidden: true });
    this.list = el('ul', { class: 'scene-list', hidden: true });
    const fileInput = el('input', {
      type: 'file',
      accept: '.json,application/json',
      hidden: true,
      onchange: () => void this.importFile(fileInput),
    });

    this.root = section(
      'Scene',
      'sb-scene',
      this.name,
      this.status,
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn', type: 'button', text: 'New', onclick: () => project.newScene() }),
        el('button', { class: 'btn', type: 'button', text: 'Open…', 'aria-expanded': 'false', onclick: (e: Event) => void this.toggleList(e.currentTarget as HTMLButtonElement) }),
      ),
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn', type: 'button', text: 'Import', onclick: () => fileInput.click() }),
        el('button', { class: 'btn', type: 'button', text: 'Export', onclick: () => void project.exportFile() }),
      ),
      fileInput,
      this.list,
      this.error,
    );

    editor.subscribe((c) => c === 'doc' && this.render());
    project.onStatus(() => this.render());
    this.render();
  }

  private render(): void {
    setValue(this.name, this.editor.doc.name);
    this.status.textContent = STATUS_TEXT[this.project.status];
    this.status.classList.toggle('error', this.project.status === 'error');
  }

  private async toggleList(button: HTMLButtonElement): Promise<void> {
    const open = this.list.hidden;
    this.list.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) await this.renderList();
  }

  private async renderList(): Promise<void> {
    await this.project.flush();
    const scenes = await this.project.list();
    this.list.replaceChildren(
      ...(scenes.length
        ? scenes.map((s) =>
            el(
              'li',
              {},
              el('button', {
                class: 'link',
                type: 'button',
                text: s.name,
                title: `${s.objectCount} objects · ${new Date(s.updatedAt).toLocaleString()}`,
                'aria-current': s.id === this.editor.doc.id ? 'true' : undefined,
                onclick: () => void this.project.openSaved(s.id).then(() => this.renderList()),
              }),
              el('button', {
                class: 'icon-btn',
                type: 'button',
                text: '✕',
                'aria-label': `Delete scene ${s.name}`,
                onclick: async () => {
                  if (!confirm(`Delete "${s.name}"? This can't be undone.`)) return;
                  await this.project.remove(s.id);
                  await this.renderList();
                },
              }),
            ),
          )
        : [el('li', { class: 'hint', text: 'No saved scenes yet.' })]),
    );
  }

  private async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.hidden = true;
    try {
      await this.project.importFile(file);
    } catch (err) {
      this.error.textContent = `Import failed: ${(err as Error).message}`;
      this.error.hidden = false;
    }
  }
}
