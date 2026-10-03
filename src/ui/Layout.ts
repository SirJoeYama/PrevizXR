import { sceneCredits } from '../assets/credits';
import type { Studio } from '../app/Studio';
import { AddPanel } from './AddPanel';
import { announce } from './announce';
import { el, isTyping } from './dom';
import { Modal } from './popover';
import { RenderDialog } from './RenderDialog';
import { RightPanel } from './RightPanel';
import { TopBar } from './TopBar';
import { ViewportOverlay } from './ViewportOverlay';

const LAYOUT_KEY = 'previzxr.layout';

/**
 * Desktop layout: top bar (scene and transport), Add panel (left), 3D viewport with floating tools,
 * and the properties panel (right). Panels collapse to give the viewport room.
 */
export class Layout {
  private readonly app: HTMLElement;

  constructor(private readonly studio: Studio) {
    this.app = document.getElementById('app')!;
    const left = document.getElementById('left-panel')!;
    const right = document.getElementById('right-panel')!;
    const viewport = document.getElementById('viewport')!;
    const { project, playback, takes } = studio;

    const renderDialog = new RenderDialog(() => studio.renderer(), takes, playback);
    const openRender = (id?: string) => void renderDialog.open(id);
    const help = new Modal('Shortcuts and controls', () => helpContent(), true);
    const credits = new Modal('Credits', () => creditsContent(studio));
    const scenes: Modal = new Modal('Open scene', (): Promise<HTMLElement> => this.scenesContent(scenes));

    const fileInput = el('input', {
      type: 'file',
      accept: '.json,application/json',
      hidden: true,
      onchange: async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        try {
          await project.importFile(file);
        } catch (err) {
          alert(`Import failed: ${(err as Error).message}`);
        }
      },
    });

    const top = new TopBar(studio, {
      openScenes: () => void scenes.open(),
      importScene: () => fileInput.click(),
      openHelp: () => void help.open(),
      openRender: () => openRender(),
      toggleLeft: () => this.toggle('left'),
      toggleRight: () => this.toggle('right'),
    });
    // Import from the VR menu: the headset session ends first (file pickers can't open in VR), then this asks for the file.
    const importPrompt: Modal = new Modal('Import scene file', () =>
      el(
        'div',
        { class: 'stack' },
        el('p', { class: 'hint', text: 'Choose a .previz.json scene file. Enter VR again when it has loaded.' }),
        el('div', { class: 'row' }, el('button', { class: 'btn primary', type: 'button', text: 'Choose file…', onclick: () => {
          importPrompt.close();
          fileInput.click();
        } })),
      ),
    );
    studio.xrEditor.requestImport = () => void importPrompt.open();

    document.getElementById('topbar')!.replaceWith(top.root);
    top.root.id = 'topbar';
    top.root.append(fileInput);

    left.replaceChildren(new AddPanel((item) => studio.spawnDesktop(item)).root);
    right.replaceChildren(new RightPanel(studio, openRender).root);
    new ViewportOverlay(viewport, studio, () => void credits.open());

    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as { left?: boolean; right?: boolean };
      if (saved.left === false) this.app.dataset.left = 'closed';
      if (saved.right === false) this.app.dataset.right = 'closed';
    } catch {
      // ignore
    }
    // Small screens start with panels closed.
    if (window.innerWidth < 900) {
      this.app.dataset.left = 'closed';
      this.app.dataset.right = 'closed';
    }

    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?') {
        e.preventDefault();
        void help.open();
      }
    });
    document.querySelector<HTMLAnchorElement>('.skip-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      studio.app.renderer.domElement.focus();
    });
    this.announceChanges();
  }

  private toggle(side: 'left' | 'right'): void {
    const key = side === 'left' ? 'left' : 'right';
    this.app.dataset[key] = this.app.dataset[key] === 'closed' ? 'open' : 'closed';
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ left: this.app.dataset.left !== 'closed', right: this.app.dataset.right !== 'closed' }));
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event('resize'));
  }

  private async scenesContent(modal: Modal): Promise<HTMLElement> {
    const { project, editor } = this.studio;
    await project.flush();
    const list = await project.list();
    if (!list.length) return el('p', { class: 'hint', text: 'No saved scenes yet.' });
    return el(
      'ul',
      { class: 'scene-list' },
      ...list.map((s) =>
        el(
          'li',
          {},
          el(
            'button',
            {
              class: 'scene-row',
              type: 'button',
              'aria-current': s.id === editor.doc.id ? 'true' : undefined,
              onclick: async () => {
                await project.openSaved(s.id);
                modal.close();
              },
            },
            el('span', { class: 'scene-row-name', text: s.name }),
            el('span', { class: 'hint', text: `${s.objectCount} objects · ${new Date(s.updatedAt).toLocaleString()}` }),
          ),
          el('button', {
            class: 'icon-btn',
            type: 'button',
            text: '✕',
            'aria-label': `Delete scene ${s.name}`,
            onclick: async () => {
              if (!confirm(`Delete "${s.name}" and its takes? This can't be undone.`)) return;
              await project.remove(s.id);
              await modal.open();
            },
          }),
        ),
      ),
    );
  }

  /** Screen-reader announcements for changes that happen away from the focused control. */
  private announceChanges(): void {
    const { editor, takes } = this.studio;
    let sceneId = editor.doc.id;
    let names = new Map(editor.doc.objects.map((o) => [o.id, o.name]));
    editor.subscribe((c) => {
      if (c !== 'doc') return;
      const now = new Map(editor.doc.objects.map((o) => [o.id, o.name]));
      if (editor.doc.id !== sceneId) {
        sceneId = editor.doc.id;
        announce(`Opened scene ${editor.doc.name}, ${now.size} objects`);
      } else {
        const added = [...now].filter(([id]) => !names.has(id)).map(([, n]) => n);
        const removed = [...names].filter(([id]) => !now.has(id)).map(([, n]) => n);
        if (added.length) announce(`Added ${added.join(', ')}`);
        else if (removed.length) announce(`Removed ${removed.join(', ')}`);
      }
      names = now;
    });
    let state = takes.state;
    takes.onChange(() => {
      if (takes.state === state) return;
      const was = state;
      state = takes.state;
      if (state === 'countdown') announce('Recording starts in 3 seconds');
      else if (state === 'recording') announce('Recording');
      else if (state === 'playing') announce(`Playing ${takes.current?.name ?? 'take'}`);
      else if (was === 'recording') announce('Recording stopped, take saved');
      else if (was === 'countdown') announce('Recording canceled');
      else announce('Stopped');
    });
  }
}

function keyRow(keys: string[], action: string): HTMLElement {
  return el('tr', {}, el('td', {}, ...keys.flatMap((k, i) => [i ? ' ' : '', el('kbd', { text: k })])), el('td', { text: action }));
}

function table(title: string, rows: HTMLElement[]): HTMLElement {
  return el('section', { class: 'help-section' }, el('h3', { text: title }), el('table', { class: 'keys-table' }, el('tbody', {}, ...rows)));
}

function helpContent(): HTMLElement {
  return el(
    'div',
    { class: 'help-grid' },
    table('View', [
      keyRow(['Drag'], 'Orbit · right-drag pans · wheel zooms'),
      keyRow(['W', 'A', 'S', 'D'], 'Move (click the view first)'),
      keyRow(['Q', 'E'], 'Down / up · Shift for faster'),
      keyRow(['F'], 'Focus the selection'),
      keyRow(['V'], 'Look through the camera'),
      keyRow(['M'], 'Camera monitor on/off'),
    ]),
    table('Edit', [
      keyRow(['1', '2', '3'], 'Move / rotate / scale gizmo'),
      keyRow(['G'], 'Snap to the floor'),
      keyRow(['Ctrl', 'D'], 'Duplicate'),
      keyRow(['Del'], 'Delete'),
      keyRow(['Ctrl', 'Z'], 'Undo · Ctrl+Y redo'),
      keyRow(['P'], 'Draw a path for the selection · Esc ends'),
      keyRow(['Click'], 'A waypoint or curve handle: drag it with the gizmo · Esc ends'),
      keyRow(['Ctrl', 'V'], 'Paste an image as a reference plane'),
    ]),
    table('Shots', [
      keyRow(['Space'], 'Preview from the start / stop'),
      keyRow(['R'], 'Record a take / stop'),
      keyRow(['C'], 'Select the camera'),
      keyRow(['K'], 'Add a camera-path keyframe'),
      keyRow(['?'], 'This help'),
    ]),
    table('VR controllers', [
      keyRow(['Trigger'], 'Select · hold to drag · press menu buttons · place waypoints'),
      keyRow(['Grip'], 'Grab (stays upright) · + trigger: free rotate · both: scale'),
      keyRow(['Stick'], 'Walk (off hand) · snap turn (pointer hand)'),
      keyRow(['Stick click'], 'Hold the camera · stick up/down zooms · trigger records (or drops a path key)'),
      keyRow(['A', 'B'], 'Snap to floor · menu'),
      keyRow(['X', 'Y'], 'Undo · redo'),
    ]),
    table('VR hands', [
      keyRow(['Pinch'], 'Press, select, or grab and hold'),
      keyRow(['Both pinch'], 'Scale the grabbed object'),
      keyRow(['Off-hand pinch'], 'Show / hide the floating menu'),
    ]),
  );
}

function creditsContent(studio: Studio): HTMLElement {
  const credits = sceneCredits(studio.editor.doc);
  return el(
    'div',
    { class: 'stack' },
    el('p', { class: 'hint', text: 'CC-BY models require crediting the author wherever you publish renders made with them. Render bundles include CREDITS.txt.' }),
    credits.length
      ? el('ul', { class: 'credits' }, ...credits.map((c) => el('li', {}, el('a', { href: c.url, target: '_blank', rel: 'noopener', text: c.title }), ` by ${c.author} (${c.licence})`)))
      : el('p', { text: 'No third-party models in this scene.' }),
  );
}
