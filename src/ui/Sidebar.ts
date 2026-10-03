import type { App } from '../app/App';
import type { XRSupport } from '../xr/XRSessionManager';

const SUPPORT_TEXT: Record<XRSupport, string> = {
  checking: 'Checking…',
  supported: 'Available',
  unsupported: 'Not available',
  insecure: 'Needs HTTPS',
};

const SUPPORT_HINT: Partial<Record<XRSupport, string>> = {
  unsupported: 'Open this page in the Meta Quest browser, or install the Immersive Web Emulator extension on desktop Chrome/Edge.',
  insecure: 'WebXR only works on https:// or localhost.',
};

/** Desktop sidebar. Later milestones add spawn, inspector, camera and render panels here. */
export class Sidebar {
  private readonly vrButton: HTMLButtonElement;
  private readonly vrHint: HTMLParagraphElement;
  private readonly xrStatus: HTMLElement;
  private readonly fpsEl: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly app: App,
  ) {
    root.innerHTML = `
      <div class="brand">
        <img src="${import.meta.env.BASE_URL}favicon.svg" alt="" />
        <h1>PrevizXR</h1>
      </div>
      <section class="section" aria-labelledby="sb-vr">
        <h2 id="sb-vr">Virtual reality</h2>
        <button type="button" class="btn primary" data-ref="vr" disabled>Enter VR</button>
        <p class="hint" data-ref="vr-hint" hidden></p>
      </section>
      <section class="section" aria-labelledby="sb-status">
        <h2 id="sb-status">Status</h2>
        <dl class="status">
          <dt>WebXR</dt><dd data-ref="xr">${SUPPORT_TEXT.checking}</dd>
          <dt>FPS</dt><dd data-ref="fps" aria-live="off">–</dd>
        </dl>
      </section>
      <section class="section" aria-labelledby="sb-keys">
        <h2 id="sb-keys">Desktop navigation</h2>
        <ul class="keys">
          <li>Left drag: orbit · Right drag: pan · Wheel: zoom</li>
          <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Q</kbd><kbd>E</kbd> down/up · <kbd>Shift</kbd> faster</li>
        </ul>
      </section>
    `;
    const ref = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-ref="${name}"]`)!;
    this.vrButton = ref<HTMLButtonElement>('vr');
    this.vrHint = ref<HTMLParagraphElement>('vr-hint');
    this.xrStatus = ref('xr');
    this.fpsEl = ref('fps');

    this.vrButton.addEventListener('click', () => this.onVrClick());
    app.xrSession.addEventListener('change', () => this.refreshXr());
    this.refreshXr();
    window.setInterval(() => {
      this.fpsEl.textContent = app.fps > 0 ? app.fps.toFixed(0) : '–';
    }, 500);
  }

  private async onVrClick(): Promise<void> {
    this.vrButton.disabled = true;
    try {
      await this.app.xrSession.toggle();
    } catch (err) {
      console.warn('Could not start the VR session', err);
      this.vrHint.textContent = `Could not start VR: ${(err as Error).message}`;
      this.vrHint.hidden = false;
    } finally {
      this.refreshXr();
    }
  }

  private refreshXr(): void {
    const { support, presenting } = this.app.xrSession;
    this.xrStatus.textContent = presenting ? 'In session' : SUPPORT_TEXT[support];
    this.vrButton.disabled = support !== 'supported';
    this.vrButton.textContent = presenting ? 'Exit VR' : 'Enter VR';
    const hint = SUPPORT_HINT[support];
    if (hint) {
      this.vrHint.textContent = hint;
      this.vrHint.hidden = false;
    }
  }
}
