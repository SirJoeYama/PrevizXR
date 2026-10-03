import { BUNDLED, CATEGORIES, type Category } from '../assets/catalog';
import { loadPolyLibrary, polyAssetRef, polyPageUrl, polyThumbUrl, searchPoly, type PolyEntry } from '../assets/polyLibrary';
import type { Spawnable } from '../app/spawn';
import { el, section } from './dom';

type Tab = Category | 'library';

/** Spawn palette: bundled categories plus a searchable Poly by Google library. */
export class AddPanel {
  readonly root: HTMLElement;
  private tab: Tab = 'actors';
  private readonly tabs: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly note: HTMLElement;
  private library: PolyEntry[] | null = null;

  constructor(private readonly onSpawn: (item: Spawnable) => void) {
    this.tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Object categories' });
    this.grid = el('div', { class: 'tile-grid', role: 'list' });
    this.search = el('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Search 2,292 Poly models…',
      'aria-label': 'Search the Poly by Google library',
      hidden: true,
      oninput: () => this.renderGrid(),
    });
    this.note = el('p', { class: 'hint', hidden: true });
    this.root = section('Add', 'sb-add', this.tabs, this.search, this.grid, this.note);
    this.renderTabs();
    this.renderGrid();
  }

  private renderTabs(): void {
    const tabs: Array<{ id: Tab; label: string }> = [...CATEGORIES, { id: 'library', label: 'Library' }];
    this.tabs.replaceChildren(
      ...tabs.map((t) =>
        el('button', {
          class: 'tab',
          type: 'button',
          role: 'tab',
          text: t.label,
          'aria-selected': String(this.tab === t.id),
          onclick: () => this.setTab(t.id),
        }),
      ),
    );
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.search.hidden = tab !== 'library';
    this.renderTabs();
    this.renderGrid();
    if (tab === 'library') {
      this.search.focus();
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
        thumb ? el('img', { src: thumb, alt: '', loading: 'lazy', crossorigin: 'anonymous' }) : el('span', { class: 'tile-icon', text: item.kind === 'light' ? '💡' : '▢', 'aria-hidden': 'true' }),
        el('span', { class: 'tile-label', text: title }),
      ),
      page ? el('a', { class: 'tile-src', href: page, target: '_blank', rel: 'noopener', 'aria-label': `${title} on Poly Pizza`, text: '↗' }) : null,
    );
  }
}
