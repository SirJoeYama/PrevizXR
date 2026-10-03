import { BUNDLED, CATEGORIES, type Category } from '../assets/catalog';
import { loadPolyLibrary, polyAssetRef, polyPageUrl, polyThumbUrl, searchPoly, type PolyEntry } from '../assets/polyLibrary';
import { IMAGE_TYPES, deleteImage, importImage, imageUrl, listImages, onImagesChange, type StoredImage } from '../assets/imageLibrary';
import type { Spawnable } from '../app/spawn';
import { announce } from './announce';
import { el, section } from './dom';

type Tab = Category | 'library' | 'images';

/** Spawnable picture plane for a stored image. */
export function imageItem(img: StoredImage): Spawnable {
  return { title: img.name, kind: 'prop', asset: { source: 'image', id: img.id, aspect: img.width / img.height } };
}

/** Spawn palette: bundled categories plus a searchable Poly by Google library. */
export class AddPanel {
  readonly root: HTMLElement;
  private tab: Tab = 'actors';
  private readonly tabs: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly note: HTMLElement;
  private library: PolyEntry[] | null = null;
  private readonly imageTools: HTMLElement;
  private readonly fileInput: HTMLInputElement;

  constructor(private readonly onSpawn: (item: Spawnable) => void) {
    this.tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Object categories' });
    this.grid = el('div', { class: 'tile-grid', role: 'list', id: 'add-panel-grid', 'aria-label': 'Objects to add' });
    this.search = el('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Search 2,292 Poly models…',
      'aria-label': 'Search the Poly by Google library',
      hidden: true,
      oninput: () => this.renderGrid(),
    });
    this.note = el('p', { class: 'hint', hidden: true });
    this.fileInput = el('input', {
      type: 'file',
      accept: IMAGE_TYPES.join(','),
      multiple: true,
      hidden: true,
      onchange: () => {
        const files = [...(this.fileInput.files ?? [])];
        this.fileInput.value = '';
        void this.importFiles(files, false);
      },
    });
    this.imageTools = el(
      'div',
      { class: 'stack', hidden: true },
      el('button', { class: 'btn', type: 'button', text: 'Import images…', onclick: () => this.fileInput.click() }),
      el('p', { class: 'hint', text: 'Or drop images on the view, or paste (Ctrl+V). They float as reference planes, hidden from renders.' }),
      this.fileInput,
    );
    this.root = section('Add', 'sb-add', this.tabs, this.search, this.imageTools, this.grid, this.note);
    this.renderTabs();
    this.renderGrid();
    onImagesChange(() => this.tab === 'images' && void this.renderImages());

    // Drop images on the viewport, or paste one from the clipboard: import and place it in front of the view.
    const viewport = document.getElementById('viewport');
    viewport?.addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) {
        e.preventDefault();
        viewport.classList.add('drop-target');
      }
    });
    viewport?.addEventListener('dragleave', () => viewport.classList.remove('drop-target'));
    viewport?.addEventListener('drop', (e) => {
      e.preventDefault();
      viewport.classList.remove('drop-target');
      void this.importFiles([...(e.dataTransfer?.files ?? [])], true);
    });
    window.addEventListener('paste', (e) => {
      if (e.target instanceof HTMLElement && isTypingTarget(e.target)) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        void this.importFiles(files, true);
      }
    });
  }

  /** Imports image files; with `place`, also adds each to the scene. */
  private async importFiles(files: File[], place: boolean): Promise<void> {
    const images = files.filter((f) => !f.type || f.type.startsWith('image/'));
    if (!images.length) return;
    this.setTab('images');
    this.note.hidden = false;
    this.note.textContent = `Importing ${images.length} image${images.length === 1 ? '' : 's'}…`;
    const errors: string[] = [];
    for (const file of images) {
      try {
        const img = await importImage(file, file.name || 'Pasted image');
        if (place) this.onSpawn(imageItem(img));
      } catch (err) {
        errors.push((err as Error).message);
      }
    }
    this.note.textContent = errors.length ? errors.join(' ') : '';
    this.note.hidden = !errors.length;
    announce(errors.length ? `Some images failed: ${errors.join(' ')}` : `Imported ${images.length} image${images.length === 1 ? '' : 's'}`);
    await this.renderImages();
  }

  private async renderImages(): Promise<void> {
    let images: StoredImage[] = [];
    try {
      images = await listImages();
    } catch (err) {
      this.note.hidden = false;
      this.note.textContent = (err as Error).message;
    }
    if (this.tab !== 'images') return;
    this.grid.replaceChildren(
      ...(images.length
        ? images.map((img) =>
            el(
              'div',
              { class: 'tile', role: 'listitem' },
              el(
                'button',
                { type: 'button', class: 'tile-btn', title: `${img.name}\n${img.width} × ${img.height}`, 'aria-label': `Add image ${img.name}`, onclick: () => this.onSpawn(imageItem(img)) },
                el('img', { src: imageUrl(img), alt: '' }),
                el('span', { class: 'tile-label', text: img.name }),
              ),
              el('button', {
                class: 'tile-src tile-del',
                type: 'button',
                text: '✕',
                'aria-label': `Remove ${img.name} from the image library`,
                onclick: () => {
                  if (confirm(`Remove "${img.name}" from this browser's image library? Planes that use it will show an error box.`)) void deleteImage(img.id);
                },
              }),
            ),
          )
        : [el('p', { class: 'hint', text: 'No images yet.' })]),
    );
  }

  private renderTabs(focus = false): void {
    const tabs: Array<{ id: Tab; label: string }> = [...CATEGORIES, { id: 'library', label: 'Library' }, { id: 'images', label: 'Images' }];
    const index = tabs.findIndex((t) => t.id === this.tab);
    const buttons = tabs.map((t) =>
      el('button', {
        class: 'tab',
        type: 'button',
        role: 'tab',
        text: t.label,
        'aria-selected': String(this.tab === t.id),
        'aria-controls': 'add-panel-grid',
        tabindex: this.tab === t.id ? '0' : '-1',
        onclick: () => this.setTab(t.id),
        onkeydown: (e: KeyboardEvent) => {
          const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
          const next = step !== undefined ? (index + step + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
          if (next < 0) return;
          e.preventDefault();
          this.setTab(tabs[next].id, true);
        },
      }),
    );
    this.tabs.replaceChildren(...buttons);
    if (focus) buttons[index].focus();
  }

  private setTab(tab: Tab, fromKeyboard = false): void {
    this.tab = tab;
    this.search.hidden = tab !== 'library';
    this.imageTools.hidden = tab !== 'images';
    this.renderTabs(fromKeyboard);
    this.renderGrid();
    if (tab === 'library') {
      if (!fromKeyboard) this.search.focus();
      void this.ensureLibrary();
    }
  }

  private async ensureLibrary(): Promise<void> {
    if (this.library) return;
    this.note.hidden = false;
    this.note.textContent = 'Loading library…';
    try {
      this.library = await loadPolyLibrary();
    } catch (err) {
      this.note.textContent = (err as Error).message;
      return;
    }
    this.renderGrid();
  }

  private renderGrid(): void {
    if (this.tab === 'images') {
      this.note.hidden = true;
      void this.renderImages();
      return;
    }
    if (this.tab !== 'library') {
      this.note.hidden = true;
      this.grid.replaceChildren(
        ...BUNDLED.filter((i) => i.category === this.tab).map((i) => this.tile(i.title, i.thumb, i, i.credit ? `${i.credit.author} · ${i.credit.licence}` : undefined)),
      );
      return;
    }
    if (!this.library) {
      this.grid.replaceChildren();
      return;
    }
    const results = searchPoly(this.library, this.search.value, 60);
    this.grid.replaceChildren(
      ...results.map((e) =>
        this.tile(e.title, polyThumbUrl(e.file), { title: e.title, kind: 'prop', asset: polyAssetRef(e) }, `Poly by Google · ${e.licence}`, polyPageUrl(e.id)),
      ),
    );
    this.note.hidden = false;
    this.note.replaceChildren(
      `${results.length === 60 ? 'First 60 matches. ' : ''}Models by `,
      el('a', { href: 'https://poly.pizza/u/Poly%20by%20Google', target: '_blank', rel: 'noopener', text: 'Poly by Google' }),
      ' (CC-BY 3.0) via Poly Pizza, loaded on demand. Credits are listed below.',
    );
  }

  private tile(title: string, thumb: string | undefined, item: Spawnable, credit?: string, page?: string): HTMLElement {
    return el(
      'div',
      { class: 'tile', role: 'listitem' },
      el(
        'button',
        { type: 'button', class: 'tile-btn', title: credit ? `${title}\n${credit}` : title, 'aria-label': `Add ${title}`, onclick: () => this.onSpawn(item) },
        thumb ? el('img', { src: thumb, alt: '', loading: 'lazy' }) : el('span', { class: 'tile-icon', text: item.kind === 'light' ? '💡' : '▢', 'aria-hidden': 'true' }),
        el('span', { class: 'tile-label', text: title }),
      ),
      page ? el('a', { class: 'tile-src', href: page, target: '_blank', rel: 'noopener', 'aria-label': `${title} on Poly Pizza`, text: '↗' }) : null,
    );
  }
}

function isTypingTarget(t: HTMLElement): boolean {
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}
