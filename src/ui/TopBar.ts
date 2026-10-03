import { MENU_SIZES, onPrefs, prefs, setPrefs, type MenuSize } from '../app/prefs';
import type { Studio } from '../app/Studio';
import { formatTime } from '../camera/guides';
import type { XRSupport } from '../xr/XRSessionManager';
import { el } from './dom';
import { icon, type IconName } from './icons';
import { popoverButton } from './popover';

const STATUS_TEXT = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Could not save (storage blocked?)' } as const;

const VR_UNAVAILABLE: Partial<Record<XRSupport, string>> = {
  unsupported: 'VR needs the Meta Quest browser, or the Immersive Web Emulator extension on desktop Chrome/Edge.',
  insecure: 'VR needs https:// or localhost.',
  checking: 'Checking for VR support…',
};

export interface TopBarActions {
  openScenes: () => void;
  importScene: () => void;
  openHelp: () => void;
  openRender: () => void;
  toggleLeft: () => void;
  toggleRight: () => void;
}

/** Scene-wide actions: scene name and menu, history, preview/record/render, help, settings, VR. */
export class TopBar {
  readonly root: HTMLElement;
  private readonly name: HTMLInputElement;
  private readonly saveDot: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly recordBtn: HTMLButtonElement;
  private readonly vrBtn: HTMLButtonElement;

  constructor(
    private readonly studio: Studio,
    actions: TopBarActions,
  ) {
    const { editor, project, playback, takes, app } = studio;

    this.name = el('input', {
      class: 'scene-name',
      type: 'text',
      'aria-label': 'Scene name',
      spellcheck: false,
      onchange: () => {
        const v = this.name.value.trim();
        if (v && v !== editor.doc.name) editor.rename(v);
        else this.name.value = editor.doc.name;
      },
      onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && this.name.blur(),
    });
    this.saveDot = el('span', { class: 'save-dot', role: 'status' });

    const sceneMenu = popoverButton(iconButton('more', 'Scene menu'), {
      label: 'Scene',
      align: 'left',
      items: () => [
        { label: 'New scene', onSelect: () => project.newScene() },
        { label: 'Open…', onSelect: actions.openScenes },
        { label: 'Import scene file…', onSelect: actions.importScene },
        { label: 'Export scene file', onSelect: () => void project.exportFile() },
      ],
    });

    this.undoBtn = iconButton('undo', 'Undo (Ctrl+Z)', () => editor.undo());
    this.redoBtn = iconButton('redo', 'Redo (Ctrl+Y)', () => editor.redo());
    this.playBtn = el('button', { class: 'tb-btn', type: 'button', title: 'Preview actor paths and clips from the start (Space)', onclick: () => (takes.busy ? takes.stop() : playback.toggle()) });
    this.recordBtn = el('button', { class: 'tb-btn record', type: 'button', title: 'Record a take: 3-second countdown, then the camera is captured (R)', onclick: () => takes.toggleRecord() });
    const renderBtn = el('button', { class: 'tb-btn', type: 'button', title: 'Render passes to video', onclick: actions.openRender }, icon('render'), el('span', { class: 'label', text: 'Render' }));

    const settings = popoverButton(iconButton('settings', 'Settings'), { label: 'VR settings', content: () => this.settingsContent() });
    this.vrBtn = el('button', { class: 'tb-btn primary', type: 'button', onclick: () => void this.toggleVr() }, icon('vr'), el('span', { class: 'label', text: 'Enter VR' }));

    this.root = el(
      'header',
      { class: 'topbar' },
      el(
        'div',
        { class: 'tb-group' },
        iconButton('panelLeft', 'Show or hide the Add panel', actions.toggleLeft),
        el('div', { class: 'brand' }, el('img', { src: `${import.meta.env.BASE_URL}favicon.svg`, alt: '' }), el('span', { text: 'PrevizXR' })),
        el('span', { class: 'tb-sep', 'aria-hidden': 'true' }),
        el('div', { class: 'scene-title' }, this.name, this.saveDot),
        sceneMenu,
      ),
      el('div', { class: 'tb-group center' }, this.undoBtn, this.redoBtn, el('span', { class: 'tb-sep', 'aria-hidden': 'true' }), this.playBtn, this.recordBtn, renderBtn),
      el('div', { class: 'tb-group right' }, iconButton('help', 'Shortcuts and controls (?)', actions.openHelp), settings, this.vrBtn, iconButton('panelRight', 'Show or hide the properties panel', actions.toggleRight)),
    );

    editor.subscribe(() => this.refresh());
    project.onStatus(() => this.refresh());
    playback.onChange(() => this.refresh());
    takes.onChange(() => this.refresh());
    app.xrSession.addEventListener('change', () => this.refresh());
    window.setInterval(() => (playback.playing || takes.busy) && this.refresh(), 100);
    this.refresh();
  }

  private refresh(): void {
    const { editor, project, playback, takes, app } = this.studio;
    if (document.activeElement !== this.name) this.name.value = editor.doc.name;
    this.saveDot.dataset.state = project.status;
    this.saveDot.title = STATUS_TEXT[project.status];
    this.saveDot.setAttribute('aria-label', STATUS_TEXT[project.status]);
    this.undoBtn.disabled = !editor.canUndo;
    this.redoBtn.disabled = !editor.canRedo;

    const playingTake = takes.state === 'playing';
    const playing = playback.playing && !takes.busy;
    const s = takes.status();
    this.playBtn.replaceChildren(
      icon(playing || playingTake ? 'stop' : 'play'),
      el('span', { class: 'label', text: playingTake && s?.playing ? formatTime(s.playing.time) : playing ? formatTime(playback.time) : 'Preview' }),
    );
    this.playBtn.setAttribute('aria-pressed', String(playing || playingTake));

    const rec = takes.state === 'recording' || takes.state === 'countdown';
    this.recordBtn.replaceChildren(
      icon(rec ? 'stop' : 'record'),
      el('span', { class: 'label', text: s?.countdown !== undefined ? `in ${Math.ceil(s.countdown)}` : s?.recording !== undefined ? formatTime(s.recording) : 'Record' }),
    );
    this.recordBtn.setAttribute('aria-pressed', String(rec));
    this.recordBtn.classList.toggle('live', rec);

    const { support, presenting } = app.xrSession;
    this.vrBtn.disabled = support !== 'supported';
    this.vrBtn.title = VR_UNAVAILABLE[support] ?? (presenting ? 'Leave VR' : 'Enter VR on the headset');
    (this.vrBtn.querySelector('.label') as HTMLElement).textContent = presenting ? 'Exit VR' : 'Enter VR';
  }

  private async toggleVr(): Promise<void> {
    try {
      await this.studio.app.xrSession.toggle();
    } catch (err) {
      console.warn('Could not start the VR session', err);
      this.vrBtn.title = `Could not start VR: ${(err as Error).message}`;
    }
  }

  private settingsContent(): HTMLElement {
    const left = el('input', { type: 'checkbox', checked: prefs.leftHanded, onchange: () => setPrefs({ leftHanded: left.checked }) });
    const haptics = el('input', { type: 'checkbox', checked: prefs.haptics, onchange: () => setPrefs({ haptics: haptics.checked }) });
    const size = el(
      'select',
      { class: 'input', onchange: () => setPrefs({ menuSize: size.value as MenuSize }) },
      ...(Object.keys(MENU_SIZES) as MenuSize[]).map((s) => el('option', { value: s, text: s[0].toUpperCase() + s.slice(1), selected: prefs.menuSize === s })),
    );
    const off = onPrefs(() => {
      left.checked = prefs.leftHanded;
      haptics.checked = prefs.haptics;
      size.value = prefs.menuSize;
    });
    const box = el(
      'div',
      { class: 'stack settings-pop' },
      el('h3', { text: 'VR settings' }),
      el('label', { class: 'check' }, left, ' Left-handed (left hand points and holds the camera)'),
      el('label', { class: 'check' }, haptics, ' Controller vibration'),
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Menu size' }), size),
    );
    // Stop listening once the popover content is replaced.
    new MutationObserver((_, obs) => {
      if (!box.isConnected) {
        off();
        obs.disconnect();
      }
    }).observe(document.body, { childList: true, subtree: true });
    return box;
  }
}

export function iconButton(name: IconName, label: string, onclick?: () => void): HTMLButtonElement {
  return el('button', { class: 'icon-btn', type: 'button', title: label, 'aria-label': label, onclick }, icon(name));
}
