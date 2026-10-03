import type { Studio } from '../app/Studio';
import type { XRSupport } from '../xr/XRSessionManager';
import { AddPanel } from './AddPanel';
import { CreditsPanel } from './CreditsPanel';
import { el, section } from './dom';
import { InspectorPanel } from './InspectorPanel';
import { ScenePanel } from './ScenePanel';

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

/** Desktop sidebar: VR entry, scene management, spawn palette, inspector, preview, credits, help. */
export class Sidebar {
  private readonly vrButton: HTMLButtonElement;
  private readonly vrHint: HTMLParagraphElement;
  private readonly xrStatus: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly timeEl: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly studio: Studio,
  ) {
    const { app, editor, playback } = studio;

    this.vrButton = el('button', { type: 'button', class: 'btn primary', disabled: true, text: 'Enter VR', onclick: () => void this.onVrClick() });
    this.vrHint = el('p', { class: 'hint', hidden: true });
    this.xrStatus = el('dd', { text: SUPPORT_TEXT.checking });
    this.fpsEl = el('dd', { text: '–' });
    this.playButton = el('button', { type: 'button', class: 'btn', title: 'Play actor paths and clips from the start (Space)', onclick: () => playback.toggle() });
    this.timeEl = el('span', { class: 'time', 'aria-live': 'off' });

    root.replaceChildren(
      el('div', { class: 'brand' }, el('img', { src: `${import.meta.env.BASE_URL}favicon.svg`, alt: '' }), el('h1', { text: 'PrevizXR' })),
      section('Virtual reality', 'sb-vr', this.vrButton, this.vrHint),
      new ScenePanel(editor, studio.project).root,
      new AddPanel((item) => studio.spawnDesktop(item)).root,
      new InspectorPanel(editor, studio.sync, studio.desktopEditor).root,
      section('Preview', 'sb-preview', el('div', { class: 'row' }, this.playButton, this.timeEl)),
      new CreditsPanel(editor).root,
      section(
        'Status',
        'sb-status',
        el('dl', { class: 'status' }, el('dt', { text: 'WebXR' }), this.xrStatus, el('dt', { text: 'FPS' }), this.fpsEl, el('dt', { text: 'Objects' }), el('dd', { 'data-ref': 'count' })),
      ),
      section(
        'Shortcuts',
        'sb-keys',
        el(
          'ul',
          { class: 'keys' },
          el('li', { text: 'Left drag: orbit · Right drag: pan · Wheel: zoom' }),
          keys(['W', 'A', 'S', 'D'], 'move · ', ['Q', 'E'], 'down/up · ', ['Shift'], 'faster'),
          keys(['1'], 'move · ', ['2'], 'rotate · ', ['3'], 'scale'),
          keys(['G'], 'to floor · ', ['F'], 'focus · ', ['P'], 'draw path'),
          keys(['Ctrl', 'D'], 'duplicate · ', ['Del'], 'delete'),
          keys(['Ctrl', 'Z'], 'undo · ', ['Ctrl', 'Y'], 'redo · ', ['Space'], 'preview'),
        ),
      ),
      section(
        'VR controls',
        'sb-vrkeys',
        el(
          'ul',
          { class: 'keys' },
          el('li', { text: 'Trigger: select, press menu buttons, place waypoints' }),
          el('li', { text: 'Grip: grab (stays upright) · grip + trigger: free rotate · both grips: scale' }),
          el('li', { text: 'While grabbing, stick: push/pull and turn' }),
          el('li', { text: 'Left stick: move · Right stick: snap turn' }),
          el('li', { text: 'A: to floor · B: menu · X: undo · Y: redo' }),
        ),
      ),
    );

    const count = root.querySelector<HTMLElement>('[data-ref="count"]')!;
    const refreshCount = () => (count.textContent = String(editor.doc.objects.length));
    editor.subscribe((c) => c === 'doc' && refreshCount());
    refreshCount();

    app.xrSession.addEventListener('change', () => this.refreshXr());
    playback.onChange(() => this.refreshPlay());
    this.refreshXr();
    this.refreshPlay();
    window.setInterval(() => {
      this.fpsEl.textContent = app.fps > 0 ? app.fps.toFixed(0) : '–';
      if (playback.playing) this.timeEl.textContent = `${playback.time.toFixed(1)} s`;
    }, 250);
  }

  private async onVrClick(): Promise<void> {
    this.vrButton.disabled = true;
    try {
      await this.studio.app.xrSession.toggle();
    } catch (err) {
      console.warn('Could not start the VR session', err);
      this.vrHint.textContent = `Could not start VR: ${(err as Error).message}`;
      this.vrHint.hidden = false;
    } finally {
      this.refreshXr();
    }
  }

  private refreshXr(): void {
    const { support, presenting } = this.studio.app.xrSession;
    this.xrStatus.textContent = presenting ? 'In session' : SUPPORT_TEXT[support];
    this.vrButton.disabled = support !== 'supported';
    this.vrButton.textContent = presenting ? 'Exit VR' : 'Enter VR';
    const hint = SUPPORT_HINT[support];
    if (hint) {
      this.vrHint.textContent = hint;
      this.vrHint.hidden = false;
    }
  }

  private refreshPlay(): void {
    const playing = this.studio.playback.playing;
    this.playButton.textContent = playing ? '■ Stop' : '▶ Preview';
    this.playButton.setAttribute('aria-pressed', String(playing));
    this.timeEl.textContent = playing ? '0.0 s' : '';
  }
}

/** Shortcut line: alternating key groups and descriptions. */
function keys(...parts: Array<string[] | string>): HTMLElement {
  return el('li', {}, ...parts.flatMap((p) => (Array.isArray(p) ? [...p.map((k) => el('kbd', { text: k })), ' '] : [p])));
}
