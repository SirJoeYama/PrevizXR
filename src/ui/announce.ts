/** Screen-reader announcements through a visually hidden polite live region. */

let region: HTMLElement | null = null;
let timer = 0;

export function announce(message: string): void {
  if (!region) {
    region = document.createElement('div');
    region.className = 'sr-only';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }
  // Clear first so repeating the same message is announced again.
  region.textContent = '';
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (region) region.textContent = message;
  }, 50);
}
