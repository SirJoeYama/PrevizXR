type Props = Record<string, unknown> & { class?: string; text?: string; style?: string };
type Child = Node | string | null | undefined | false;

/** Tiny element factory: el('button', { class: 'btn', onclick: fn }, 'Label'). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'style') node.setAttribute('style', String(value));
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value as EventListener);
    else if (key in node && typeof value !== 'string') (node as unknown as Record<string, unknown>)[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

export function section(title: string, id: string, ...children: Child[]): HTMLElement {
  return el('section', { class: 'section', 'aria-labelledby': id }, el('h2', { id, text: title }), ...children);
}

/** Sets an input's value unless the user is editing it. */
export function setValue(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  if (document.activeElement !== input && input.value !== value) input.value = value;
}
