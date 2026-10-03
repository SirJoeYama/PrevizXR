import type { Takes } from '../app/Takes';
import { formatTime } from '../camera/guides';
import type { Editor } from '../model/Editor';
import type { CameraKey } from '../model/scene';
import { el, isTyping, section, setValue } from './dom';

/** Record, play, smooth, rename, import and export takes (R records). */
export class TakesPanel {
  readonly root: HTMLElement;
  private readonly recordBtn: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly list: HTMLElement;
  private readonly details: HTMLElement;
  private readonly error: HTMLElement;
  private selectedId: string | null = null;

  constructor(
    private readonly takes: Takes,
    private readonly onRender: (takeId?: string) => void,
  ) {
    this.recordBtn = el('button', { class: 'btn record', type: 'button', title: 'Record a take with a 3-second countdown (R)', onclick: () => takes.toggleRecord() });
    this.status = el('span', { class: 'time', 'aria-live': 'polite' });
    this.list = el('ul', { class: 'take-list' });
    this.details = el('div', { class: 'stack' });
    this.error = el('p', { class: 'hint error', role: 'alert', hidden: true });
    const loop = el('input', { type: 'checkbox', onchange: () => (takes.loop = loop.checked) });
    const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: () => void this.importFile(fileInput) });

    this.root = section(
      'Takes',
      'sb-takes',
      el(
        'div',
        { class: 'row' },
        this.recordBtn,
        this.status,
        el('button', { class: 'btn', type: 'button', text: 'Render…', title: 'Render passes to video', onclick: () => onRender(this.selectedId ?? undefined) }),
      ),
      el('p', { class: 'hint', text: 'Actors play from the start while the camera is captured at the lens frame rate.' }),
      this.list,
      this.details,
      el(
        'div',
        { class: 'row' },
        el('label', { class: 'check' }, loop, ' Loop playback'),
        el('button', { class: 'btn', type: 'button', text: 'Import take', onclick: () => fileInput.click() }),
      ),
      fileInput,
      this.error,
    );

    takes.onChange(() => this.render());
    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'r') return;
      e.preventDefault();
      takes.toggleRecord();
    });
    window.setInterval(() => {
      if (takes.busy) this.renderStatus();
    }, 100);
    this.render();
  }

  private renderStatus(): void {
    const t = this.takes;
    const s = t.status();
    this.recordBtn.textContent = t.state === 'countdown' ? 'Cancel' : t.state === 'recording' ? '■ Stop' : '● Record';
    this.recordBtn.setAttribute('aria-pressed', String(t.state === 'recording' || t.state === 'countdown'));
    this.status.textContent =
      s?.countdown !== undefined ? `in ${Math.ceil(s.countdown)}…` : s?.recording !== undefined ? `REC ${formatTime(s.recording)}` : s?.playing ? formatTime(s.playing.time) : '';
  }

  private render(): void {
    this.renderStatus();
    const t = this.takes;
    if (this.selectedId && !t.list.some((x) => x.id === this.selectedId)) this.selectedId = null;
    this.list.replaceChildren(
      ...(t.list.length
        ? t.list.map((take) => {
            const playing = t.state === 'playing' && t.current?.id === take.id;
            return el(
              'li',
              { class: take.id === this.selectedId ? 'selected' : '' },
              el('button', {
                class: 'icon-btn play',
                type: 'button',
                text: playing ? '■' : '▶',
                'aria-label': playing ? `Stop ${take.name}` : `Play ${take.name}`,
                onclick: () => (playing ? t.stop() : void t.play(take.id)),
              }),
              el('button', {
                class: 'link',
                type: 'button',
                text: take.name,
                'aria-current': take.id === this.selectedId ? 'true' : undefined,
                onclick: () => {
                  this.selectedId = take.id;
                  this.render();
                },
              }),
              el('span', { class: 'take-meta', text: `${take.duration.toFixed(1)}s · ${take.fps}fps${take.source === 'keyframed' ? ' · path' : ''}` }),
            );
          })
        : [el('li', { class: 'hint', text: 'No takes for this scene yet.' })]),
    );
    this.renderDetails();
  }

  private renderDetails(): void {
    const take = this.takes.list.find((x) => x.id === this.selectedId);
    if (!take) {
      this.details.replaceChildren();
      return;
    }
    const name = el('input', {
      class: 'input',
      type: 'text',
      value: take.name,
      'aria-label': 'Take name',
      onchange: () => name.value.trim() && void this.takes.rename(take.id, name.value.trim()),
    });
    const smoothLabel = el('span', { class: 'time', text: `${Math.round(take.smoothing * 100)}%` });
    const smooth = el('input', {
      type: 'range',
      class: 'range',
      min: '0',
      max: '100',
      step: '5',
      value: String(Math.round(take.smoothing * 100)),
      'aria-label': 'Camera path smoothing',
      oninput: () => (smoothLabel.textContent = `${smooth.value}%`),
      onchange: () => void this.takes.setSmoothing(take.id, +smooth.value / 100),
    });
    this.details.replaceChildren(
      name,
      el('div', { class: 'focal-row' }, el('span', { class: 'field-label', text: 'Smoothing' }), smooth, smoothLabel),
      el('p', { class: 'hint', text: `${take.frameCount} frames, recorded ${new Date(take.createdAt).toLocaleString()}. Smoothing is applied on playback and render; the raw take is kept.` }),
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn primary', type: 'button', text: 'Render…', onclick: () => this.onRender(take.id) }),
        el('button', { class: 'btn', type: 'button', text: 'Export JSON', onclick: () => void this.takes.exportTake(take.id) }),
        el('button', {
          class: 'btn danger',
          type: 'button',
          text: 'Delete',
          onclick: () => {
            if (confirm(`Delete "${take.name}"?`)) void this.takes.remove(take.id);
          },
        }),
      ),
    );
  }

  private async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.hidden = true;
    try {
      const take = await this.takes.importFile(file);
      this.selectedId = take.id;
      this.render();
    } catch (err) {
      this.error.textContent = `Import failed: ${(err as Error).message}`;
      this.error.hidden = false;
    }
  }
}

/** Keyframed dolly/crane path for the camera (desktop): add keys from the camera, retime, preview, bake (K adds a key). */
export class CameraPathPanel {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly previewBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly error: HTMLElement;

  constructor(
    private readonly editor: Editor,
    private readonly takes: Takes,
  ) {
    this.list = el('ul', { class: 'take-list keys-list' });
    this.error = el('p', { class: 'hint error', role: 'alert', hidden: true });
    this.previewBtn = el('button', { class: 'btn', type: 'button', text: 'Preview', onclick: () => void this.bake(false) });
    this.saveBtn = el('button', { class: 'btn', type: 'button', text: 'Save as take', onclick: () => void this.bake(true) });
    this.root = section(
      'Camera path',
      'sb-path',
      el('p', { class: 'hint', text: 'A smooth dolly/crane move: place the camera, add a key, repeat.' }),
      el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', text: '+ Key from camera', title: 'Add a keyframe at the camera (K)', onclick: () => this.addKey() })),
      this.list,
      el('div', { class: 'row' }, this.previewBtn, this.saveBtn),
      this.error,
    );
    editor.subscribe((c) => c === 'doc' && this.render());
    takes.onChange(() => this.render());
    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      this.addKey();
    });
    this.render();
  }

  private get keys(): CameraKey[] {
    return this.editor.doc.camera.keyframes;
  }

  private addKey(): void {
    if (!this.takes.busy) this.editor.addCameraKey();
  }

  private setKeys(mutate: (keys: CameraKey[]) => void): void {
    this.editor.editKeys(mutate);
  }

  private render(): void {
    const keys = this.keys;
    this.previewBtn.disabled = this.saveBtn.disabled = keys.length < 2 || this.takes.busy;
    this.list.replaceChildren(
      ...(keys.length
        ? keys.map((k, i) => {
            const time = el('input', {
              class: 'input num',
              type: 'number',
              min: '0',
              step: '0.1',
              'aria-label': `Keyframe ${i + 1} time (seconds)`,
              onchange: () => {
                const v = parseFloat(time.value);
                if (Number.isFinite(v) && v >= 0) this.setKeys((ks) => (ks[i].time = v));
              },
            });
            setValue(time, String(k.time));
            return el(
              'li',
              {},
              el('span', { class: 'take-meta', text: `${i + 1}` }),
              time,
              el('span', { class: 'take-meta', text: `s · ${Math.round(k.focalLength)}mm` }),
              el('button', {
                class: 'icon-btn',
                type: 'button',
                text: '⌖',
                title: 'Move the camera to this key',
                'aria-label': `Go to keyframe ${i + 1}`,
                onclick: () => this.editor.goToKey(i),
              }),
              el('button', {
                class: 'icon-btn',
                type: 'button',
                text: '⟳',
                title: 'Replace this key with the current camera',
                'aria-label': `Update keyframe ${i + 1} from the camera`,
                onclick: () => this.setKeys((ks) => (ks[i] = this.editor.cameraKey(k.time))),
              }),
              el('button', { class: 'icon-btn', type: 'button', text: '✕', 'aria-label': `Delete keyframe ${i + 1}`, onclick: () => this.setKeys((ks) => ks.splice(i, 1)) }),
            );
          })
        : [el('li', { class: 'hint', text: 'No keyframes.' })]),
    );
  }

  private async bake(save: boolean): Promise<void> {
    this.error.hidden = true;
    try {
      await this.takes.bakePath(save);
    } catch (err) {
      this.error.textContent = (err as Error).message;
      this.error.hidden = false;
    }
  }
}
