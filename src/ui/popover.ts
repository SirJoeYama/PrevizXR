import { el } from './dom';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  hint?: string;
  danger?: boolean;
}

/**
 * A button that opens a popover: a menu of actions (`items`) or arbitrary content (`content`).
 * Keyboard: Enter/Space opens, arrows move between menu items, Esc closes and returns focus.
 */
export function popoverButton(
  trigger: HTMLButtonElement,
  options: { items?: () => MenuItem[]; content?: () => HTMLElement; align?: 'left' | 'right'; label: string },
): HTMLElement {
  const pop = el('div', { class: `popover ${options.align === 'left' ? 'align-left' : ''}`, hidden: true, role: options.items ? 'menu' : 'dialog', 'aria-label': options.label });
  const wrap = el('div', { class: 'popover-wrap' }, trigger, pop);
  trigger.setAttribute('aria-haspopup', options.items ? 'menu' : 'dialog');
  trigger.setAttribute('aria-expanded', 'false');

  const close = (focusTrigger = false) => {
    if (pop.hidden) return;
    pop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (focusTrigger) trigger.focus();
  };
  const outside = (e: Event) => {
    if (!wrap.contains(e.target as Node)) close();
  };
  const open = () => {
    if (options.items) {
      pop.replaceChildren(
        ...options.items().map((item) =>
          el(
            'button',
            {
              type: 'button',
              role: 'menuitem',
              class: `menu-item${item.danger ? ' danger' : ''}`,
              onclick: () => {
                close(true);
                item.onSelect();
              },
            },
            el('span', { text: item.label }),
            item.hint ? el('kbd', { text: item.hint }) : null,
          ),
        ),
      );
    } else if (options.content) {
      pop.replaceChildren(options.content());
    }
    pop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    pop.querySelector<HTMLElement>('button, input, select')?.focus();
  };

  trigger.addEventListener('click', () => (pop.hidden ? open() : close()));
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) {
      e.stopPropagation();
      close(true);
    }
    if (options.items && !pop.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const items = [...pop.querySelectorAll<HTMLElement>('.menu-item')];
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  });
  return wrap;
}

/** Modal dialog with a title and a close button. `body` is rebuilt each time it opens. */
export class Modal {
  readonly dialog: HTMLDialogElement;
  private readonly body: HTMLElement;

  constructor(
    title: string,
    private readonly build: () => HTMLElement | Promise<HTMLElement>,
    wide = false,
  ) {
    const id = `modal-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
    this.body = el('div', { class: 'modal-body' });
    this.dialog = el(
      'dialog',
      { class: `dialog${wide ? ' wide' : ''}`, 'aria-labelledby': id },
      el('div', { class: 'dialog-head' }, el('h2', { id, text: title }), el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', text: '✕', onclick: () => this.dialog.close() })),
      this.body,
    );
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.dialog.close(); // click on the backdrop
    });
    document.body.append(this.dialog);
  }

  async open(): Promise<void> {
    this.body.replaceChildren(await this.build());
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    this.dialog.close();
  }
}
