import type { Takes } from '../app/Takes';
import type { Playback } from '../app/Playback';
import type { Take } from '../model/take';
import { PASSES, PASS_INFO, RESOLUTIONS, outputSize, type PassId } from '../render/plan';
import type { RenderResult, TakeRenderer } from '../render/TakeRenderer';
import { loadTake } from '../storage/takeStore';
import { el } from './dom';

const LAST_SETTINGS = 'previzxr.render';

type Format = 'mp4' | 'png';

interface Settings {
  shortSide: number;
  passes: PassId[];
  format: Format;
}

/** Modal for rendering a take: resolution, passes, depth range, progress with cancel, downloads. */
export class RenderDialog {
  readonly dialog: HTMLDialogElement;
  private readonly takeSelect: HTMLSelectElement;
  private readonly resGroup: HTMLElement;
  private readonly formatGroup: HTMLElement;
  private formatChoice: Format = 'mp4';
  private readonly passBoxes = new Map<PassId, HTMLInputElement>();
  private readonly near: HTMLInputElement;
  private readonly far: HTMLInputElement;
  private readonly format: HTMLElement;
  private readonly progress: HTMLProgressElement;
  private readonly progressText: HTMLElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly results: HTMLElement;
  private readonly error: HTMLElement;
  private take: Take | null = null;
  private shortSide = 720;
  private abort: AbortController | null = null;
  private urls: string[] = [];
  private renderer!: TakeRenderer;

  constructor(
    private readonly loadRenderer: () => Promise<TakeRenderer>,
    private readonly takes: Takes,
    private readonly playback: Playback,
  ) {
    const saved = readSettings();
    this.shortSide = saved.shortSide;
    this.formatChoice = saved.format;
    this.formatGroup = el('div', { class: 'seg', role: 'group', 'aria-label': 'File format' });

    this.takeSelect = el('select', { class: 'input', id: 'render-take', onchange: () => void this.selectTake(this.takeSelect.value) });
    this.resGroup = el('div', { class: 'seg', role: 'group', 'aria-label': 'Resolution' });
    const passList = el(
      'div',
      { class: 'stack' },
      ...PASSES.map((p) => {
        const box = el('input', { type: 'checkbox', checked: saved.passes.includes(p), onchange: () => this.saveSettings() });
        this.passBoxes.set(p, box);
        return el('label', { class: 'pass-option' }, box, el('span', {}, el('strong', { text: ` ${PASS_INFO[p].label}` }), el('span', { class: 'hint', text: ` ${PASS_INFO[p].description}` })));
      }),
    );
    this.near = el('input', { class: 'input num', type: 'number', min: '0.01', step: '0.1', 'aria-label': 'Depth near (metres)' });
    this.far = el('input', { class: 'input num', type: 'number', min: '0.1', step: '0.5', 'aria-label': 'Depth far (metres)' });
    this.format = el('p', { class: 'hint' });
    this.progress = el('progress', { max: 1, value: 0, hidden: true });
    this.progressText = el('p', { class: 'hint', 'aria-live': 'polite' });
    this.results = el('div', { class: 'stack' });
    this.error = el('p', { class: 'hint error', role: 'alert', hidden: true });
    this.startBtn = el('button', { class: 'btn primary', type: 'button', text: 'Render', onclick: () => void this.start() });
    this.closeBtn = el('button', { class: 'btn', type: 'button', text: 'Close', onclick: () => this.close() });

    this.dialog = el(
      'dialog',
      { class: 'dialog', 'aria-labelledby': 'render-title' },
      el('h2', { id: 'render-title', text: 'Render take' }),
      el('label', { class: 'field', for: 'render-take' }, el('span', { class: 'field-label', text: 'Take' }), this.takeSelect),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Resolution' }), this.resGroup),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Format' }), this.formatGroup),
      el('fieldset', { class: 'fieldset' }, el('legend', { class: 'field-label', text: 'Passes' }), passList),
      el(
        'div',
        { class: 'field' },
        el('span', { class: 'field-label', text: 'Depth m' }),
        el(
          'div',
          { class: 'depth-row' },
          this.near,
          el('span', { class: 'hint', text: 'to' }),
          this.far,
          el('button', { class: 'btn', type: 'button', text: 'Auto', title: 'Fit near/far to the scene as seen from this take', onclick: () => this.autoDepth() }),
        ),
      ),
      this.format,
      this.progress,
      this.progressText,
      this.error,
      this.results,
      el('div', { class: 'row' }, this.closeBtn, this.startBtn),
    );
    this.dialog.addEventListener('cancel', (e) => {
      if (this.abort) e.preventDefault(); // Esc doesn't close mid-render; use Cancel
    });
    document.body.append(this.dialog);
  }

  async open(takeId?: string): Promise<void> {
    this.renderer = await this.loadRenderer();
    if (this.takes.busy) this.takes.stop();
    if (this.playback.playing) this.playback.stop();
    const list = this.takes.list;
    this.takeSelect.replaceChildren(...list.map((t) => el('option', { value: t.id, text: `${t.name} · ${t.duration.toFixed(1)} s · ${t.fps} fps` })));
    this.clearResults();
    this.error.hidden = true;
    this.progress.hidden = true;
    this.progressText.textContent = '';
    this.dialog.showModal();
    const id = takeId ?? list[0]?.id;
    if (!id) {
      this.startBtn.disabled = true;
      this.format.textContent = 'Record a take first (R, or the trigger while holding the camera in VR).';
      return;
    }
    this.takeSelect.value = id;
    await this.selectTake(id);
  }

  close(): void {
    if (this.abort) return;
    this.dialog.close();
  }

  private async selectTake(id: string): Promise<void> {
    this.take = await loadTake(id);
    this.startBtn.disabled = !this.take;
    if (!this.take) return;
    this.renderResolutions();
    this.renderFormats();
    this.autoDepth();
    await this.updateFormat();
  }

  private renderFormats(): void {
    const options: Array<[Format, string, string]> = [
      ['mp4', 'MP4 (H.264)', 'Small files for video tools. Lossy: color_id edges and exact colors shift slightly.'],
      ['png', 'PNG sequence', 'Lossless frames in a zip: exact ID colors and depth values. Much larger.'],
    ];
    this.formatGroup.replaceChildren(
      ...options.map(([f, label, title]) =>
        el('button', {
          type: 'button',
          class: 'seg-btn',
          text: label,
          title,
          'aria-pressed': String(this.formatChoice === f),
          onclick: () => {
            this.formatChoice = f;
            this.saveSettings();
            this.renderFormats();
            void this.updateFormat();
          },
        }),
      ),
    );
  }

  private renderResolutions(): void {
    const take = this.take!;
    this.resGroup.replaceChildren(
      ...RESOLUTIONS.map((s) => {
        const { width, height } = outputSize(take.aspect, s);
        return el('button', {
          type: 'button',
          class: 'seg-btn',
          text: `${s}p`,
          title: `${width} × ${height}`,
          'aria-pressed': String(this.shortSide === s),
          onclick: () => {
            this.shortSide = s;
            this.saveSettings();
            this.renderResolutions();
            void this.updateFormat();
          },
        });
      }),
    );
  }

  private autoDepth(): void {
    if (!this.take) return;
    const { near, far } = this.renderer.autoDepth(this.take);
    this.near.value = String(near);
    this.far.value = String(far);
  }

  private async updateFormat(): Promise<void> {
    const take = this.take!;
    const { width, height } = outputSize(take.aspect, this.shortSide);
    const canMp4 = await this.renderer.willUseMp4(take, this.shortSide);
    const result =
      this.formatChoice === 'png'
        ? 'lossless PNG sequence (zip) per pass'
        : canMp4
          ? 'H.264 MP4 per pass'
          : 'PNG sequence zip per pass (this browser cannot encode H.264 at this size; try Chrome/Edge or a lower resolution)';
    this.format.textContent = `${width} × ${height}, ${take.fps} fps, ${take.frameCount} frames → ${result}${take.smoothing > 0 ? `, camera smoothing ${Math.round(take.smoothing * 100)}%` : ''}.`;
  }

  private selectedPasses(): PassId[] {
    return PASSES.filter((p) => this.passBoxes.get(p)!.checked);
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(LAST_SETTINGS, JSON.stringify({ shortSide: this.shortSide, passes: this.selectedPasses(), format: this.formatChoice } satisfies Settings));
    } catch {
      // Storage blocked: settings just won't be remembered.
    }
  }

  private async start(): Promise<void> {
    const take = this.take;
    if (!take || this.abort) return;
    const near = parseFloat(this.near.value);
    const far = parseFloat(this.far.value);
    this.error.hidden = true;
    if (!(near > 0) || !(far > near)) {
      this.showError('Depth far must be greater than near, and near greater than 0.');
      return;
    }
    const passes = this.selectedPasses();
    if (!passes.length) {
      this.showError('Choose at least one pass.');
      return;
    }
    this.clearResults();
    const started = performance.now();
    this.abort = new AbortController();
    this.setRunning(true);
    try {
      const result = await this.renderer.render({ take, shortSide: this.shortSide, passes, depthNear: near, depthFar: far, format: this.formatChoice }, (p) => {
        this.progress.value = p.frame / p.total;
        const eta = (p.total - p.frame) / Math.max(p.rate, 0.01);
        this.progressText.textContent = `Frame ${p.frame} / ${p.total} · ${p.rate.toFixed(1)} frames/s · about ${Math.ceil(eta)} s left`;
      }, this.abort.signal);
      this.progressText.textContent = `Done in ${formatSeconds((performance.now() - started) / 1000)}.`;
      this.showResults(result);
    } catch (err) {
      if ((err as Error).name === 'AbortError') this.progressText.textContent = 'Render canceled.';
      else {
        console.error(err);
        this.showError(`Render failed: ${(err as Error).message}`);
      }
    } finally {
      this.abort = null;
      this.setRunning(false);
    }
  }

  private setRunning(running: boolean): void {
    if (running) {
      this.progress.value = 0;
      this.progress.hidden = false;
    }
    this.startBtn.textContent = running ? 'Cancel' : 'Render';
    this.startBtn.classList.toggle('primary', !running);
    this.startBtn.onclick = running ? () => this.abort?.abort() : () => void this.start();
    this.closeBtn.disabled = running;
    this.takeSelect.disabled = running;
  }

  private showResults(result: RenderResult): void {
    const link = (f: { name: string; blob: Blob }, cls: string) => {
      const url = URL.createObjectURL(f.blob);
      this.urls.push(url);
      return el('a', { class: cls, href: url, download: f.name, text: `⤓ ${f.name} (${formatSize(f.blob.size)})` });
    };
    this.results.replaceChildren(
      link(result.bundle, 'btn primary download-bundle'),
      el('p', { class: 'hint', text: 'The bundle holds every pass, camera.json, camera.glb, the take and scene files, manifest.json and CREDITS.txt.' }),
      ...result.files.map((f) => link(f, 'download')),
    );
  }

  private clearResults(): void {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
    this.results.replaceChildren();
  }

  private showError(msg: string): void {
    this.error.textContent = msg;
    this.error.hidden = false;
  }
}

function formatSize(bytes: number): string {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}

function formatSeconds(s: number): string {
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

function readSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(LAST_SETTINGS) ?? 'null') as Partial<Settings> | null;
    if (s && RESOLUTIONS.includes(s.shortSide as never) && Array.isArray(s.passes)) {
      return { shortSide: s.shortSide!, passes: s.passes.filter((p): p is PassId => PASSES.includes(p)), format: s.format === 'png' ? 'png' : 'mp4' };
    }
  } catch {
    // ignore
  }
  return { shortSide: 720, passes: ['clay', 'color_id', 'depth', 'pose'], format: 'mp4' };
}
