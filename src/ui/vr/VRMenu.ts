import { BUNDLED, CATEGORIES, type Category } from '../../assets/catalog';
import { imageUrl, listImages, onImagesChange, type StoredImage } from '../../assets/imageLibrary';
import { loadPolyLibrary, polyAssetRef, polyThumbUrl, searchPoly, type PolyEntry } from '../../assets/polyLibrary';
import type { Playback } from '../../app/Playback';
import type { Project } from '../../app/Project';
import type { SceneSummary } from '../../storage/sceneStore';
import type { Takes } from '../../app/Takes';
import { MENU_SIZES, prefs, setPrefs, type MenuSize } from '../../app/prefs';
import { formatTime } from '../../camera/guides';
import type { Spawnable } from '../../app/spawn';
import type { Editor } from '../../model/Editor';
import { ASPECT_IDS, FOCAL_PRESETS, FPS_OPTIONS, SENSORS, clampFocal, horizontalFovDeg, verticalFovDeg, type SensorId } from '../../camera/lens';
import { hasEditedHandles, smoothPath } from '../../model/pathEdit';
import { ACTOR_CLIPS, CAMERA_ID, clearWaypoints, editPath, pathOf, type CameraKey, type SceneObject } from '../../model/scene';
import { CanvasPanel, PANEL_COLORS } from './CanvasPanel';

export interface VRMenuHost {
  spawn(item: Spawnable): void;
  isPathMode(): boolean;
  setPathMode(on: boolean): void;
  snapSelected(): void;
  isHoldingCamera(): boolean;
  toggleHoldCamera(): void;
  bringCamera(): void;
  focusDistance(): number | null;
  fps(): number;
  /** Camera monitor quality level (0 = best); stepped automatically in VR. */
  monitorQuality(): number;
  /** Moves the user next to an object (or the camera), facing it. */
  goTo(id: string): void;
  /** 'VR' or 'XR' (passthrough), for the exit button. */
  sessionLabel(): string;
  exitSession(): void;
  /** Leaves the session and asks for a scene file (file pickers can't open inside VR). */
  importScene(): void;
  isMonitorDetached(): boolean;
  /** Detaches the camera monitor to float in front of the user, or puts it back on the camera. */
  toggleMonitor(): void;
}

const SAVE_STATUS = { saved: 'All changes saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Could not save' } as const;

type Tab = Category | 'library' | 'images' | 'scene' | 'camera' | 'path' | 'takes' | 'settings';
/** Tabs that are not object categories under Add. */
const MAIN_TABS: Tab[] = ['scene', 'camera', 'path', 'takes', 'settings'];

const W = 768;
const H = 1280;
const PAD = 24;
const COLS = 3;
const ROWS = 3;
const PER_PAGE = COLS * ROWS;
/** Keyboard-free library search in VR: tap a preset query. */
const LIBRARY_PRESETS = ['chair', 'table', 'couch', 'car', 'truck', 'tree', 'plant', 'lamp', 'house', 'dog'];

interface Tile {
  key: string;
  title: string;
  thumb?: string;
  item: Spawnable;
}

/** Controller-attached spawn and edit menu for VR (the desktop equivalent is the sidebar). */
export class VRMenu extends CanvasPanel {
  private tab: Tab = 'actors';
  /** Category shown when returning to Add. */
  private lastAddTab: Tab = 'actors';
  private page = 0;
  private libraryQuery = LIBRARY_PRESETS[0];
  private library: PolyEntry[] | null = null;
  private libraryError = '';
  private readonly images = new Map<string, HTMLImageElement>();
  private shownFocus: number | null | undefined;
  private takesPage = 0;
  private shownFps = -1;
  private storedImages: StoredImage[] = [];
  private scenePage = 0;
  private keysPage = 0;
  /** Selection last shown on the Scene tab (its page follows selections made in the world). */
  private shownSelection: string | null = null;
  /** Camera keyframe picked in the Cam path list (its marker is highlighted in the world). */
  selectedKey: number | null = null;
  /** Scene tab: the outliner, or the list of saved scenes to open. */
  private sceneView: 'objects' | 'open' = 'objects';
  private savedScenes: SceneSummary[] | null = null;
  private openPage = 0;
  private fileNote = '';

  constructor(
    private readonly editor: Editor,
    private readonly playback: Playback,
    private readonly takes: Takes,
    private readonly project: Project,
    private readonly host: VRMenuHost,
  ) {
    super(W, H, 0.3);
    this.mesh.name = 'VRMenu';
    editor.subscribe(() => this.invalidate());
    project.onStatus(() => this.invalidate());
    playback.onChange(() => this.invalidate());
    takes.onChange(() => this.invalidate());
    onImagesChange(() => void this.loadImages());
    void this.loadImages();
  }

  override update(): void {
    const fps = Math.round(this.host.fps());
    if (fps !== this.shownFps) {
      this.shownFps = fps;
      this.invalidate();
    }
    // Countdown and timers tick without events: redraw every frame while busy on the Takes tab.
    if (this.tab === 'takes' && this.takes.busy) this.invalidate();
    if (this.tab === 'camera') {
      // Autofocus changes without model edits: redraw when the readout would change.
      const f = this.host.focusDistance();
      const shown = f === null ? null : Math.round(f * 100);
      if (shown !== this.shownFocus) {
        this.shownFocus = shown;
        this.invalidate();
      }
    }
    super.update();
  }

  protected draw(): void {
    const c = this.ctx;
    c.fillStyle = PANEL_COLORS.bg;
    c.beginPath();
    c.roundRect(0, 0, W, H, 28);
    c.fill();

    this.text('PrevizXR', PAD, 40, { size: 30, weight: 700, color: PANEL_COLORS.active });
    const fps = Math.round(this.host.fps());
    const exitW = 150;
    this.button('exit', `Exit ${this.host.sessionLabel()}`, W - PAD - exitW, 16, exitW, 48, () => this.host.exitSession(), { danger: true, size: 22 });
    this.text(`${fps} fps`, W - PAD - exitW - 14, 40, { size: 22, align: 'right', color: fps > 0 && fps < 66 ? PANEL_COLORS.danger : PANEL_COLORS.muted });
    this.text(this.editor.doc.name, W - PAD - exitW - 110, 40, { size: 22, color: PANEL_COLORS.muted, align: 'right', maxWidth: 260 });

    // Primary tabs; "Add" opens the object categories as a second row.
    const isAdd = !MAIN_TABS.includes(this.tab);
    const primary: Array<{ id: Tab; label: string }> = [
      { id: this.lastAddTab, label: 'Add' },
      { id: 'scene', label: 'Scene' },
      { id: 'camera', label: 'Camera' },
      { id: 'path', label: 'Cam path' },
      { id: 'takes', label: 'Takes' },
      { id: 'settings', label: 'Settings' },
    ];
    const pw = (W - PAD * 2 - 8 * (primary.length - 1)) / primary.length;
    primary.forEach((t, i) => {
      const active = i === 0 ? isAdd : this.tab === t.id;
      this.button(`tab-${i === 0 ? 'add' : t.id}`, t.label, PAD + i * (pw + 8), 74, pw, 58, () => this.setTab(t.id), { active, size: 21 });
    });

    let gridTop = 150;
    if (isAdd) {
      const cats: Array<{ id: Tab; label: string }> = [...CATEGORIES, { id: 'library', label: 'Library' }, { id: 'images', label: 'Images' }];
      const perRow = 5;
      const cw = (W - PAD * 2 - 8 * (perRow - 1)) / perRow;
      cats.forEach((t, i) => {
        const x = PAD + (i % perRow) * (cw + 8);
        const y = 146 + Math.floor(i / perRow) * 50;
        this.button(`cat-${t.id}`, t.label, x, y, cw, 42, () => this.setTab(t.id), { active: this.tab === t.id, size: 19 });
      });
      gridTop = 250;
    }

    if (this.tab === 'scene') {
      this.drawScene(gridTop);
    } else if (this.tab === 'path') {
      this.drawPath(gridTop);
    } else if (this.tab === 'camera') {
      this.drawCamera(gridTop);
    } else if (this.tab === 'takes') {
      this.drawTakes(gridTop);
    } else if (this.tab === 'settings') {
      this.drawSettings(gridTop);
    } else {
      if (this.tab === 'library') gridTop = this.drawLibraryPresets(gridTop);
      this.drawGrid(this.tiles(), gridTop, 836 - gridTop);
    }
    this.drawSelection(900);
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    if (!MAIN_TABS.includes(tab)) this.lastAddTab = tab;
    this.page = 0;
    if (tab === 'library') void this.ensureLibrary();
  }

  private async ensureLibrary(): Promise<void> {
    if (this.library) return;
    try {
      this.library = await loadPolyLibrary();
      this.libraryError = '';
    } catch (err) {
      this.libraryError = (err as Error).message;
    }
    this.invalidate();
  }

  private drawLibraryPresets(top: number): number {
    const w = (W - PAD * 2 - 8 * 4) / 5;
    LIBRARY_PRESETS.forEach((q, i) => {
      const x = PAD + (i % 5) * (w + 8);
      const y = top + Math.floor(i / 5) * 52;
      this.button(`q-${q}`, q, x, y, w, 44, () => {
        this.libraryQuery = q;
        this.page = 0;
      }, { active: this.libraryQuery === q, size: 20 });
    });
    return top + 112;
  }

  private async loadImages(): Promise<void> {
    try {
      this.storedImages = await listImages();
    } catch {
      this.storedImages = [];
    }
    this.invalidate();
  }

  private tiles(): Tile[] {
    if (this.tab === 'images') {
      return this.storedImages.map((img) => ({
        key: `img-${img.id}`,
        title: img.name,
        thumb: imageUrl(img),
        item: { title: img.name, kind: 'prop', asset: { source: 'image', id: img.id, aspect: img.width / img.height } },
      }));
    }
    if (this.tab !== 'library') {
      return BUNDLED.filter((i) => i.category === this.tab).map((i) => ({ key: i.key, title: i.title, thumb: i.thumb, item: i }));
    }
    if (!this.library) return [];
    return searchPoly(this.library, this.libraryQuery, 90).map((e) => ({
      key: `poly-${e.id}`,
      title: e.title,
      thumb: polyThumbUrl(e.file),
      item: { title: e.title, kind: 'prop', asset: polyAssetRef(e) },
    }));
  }

  private drawGrid(tiles: Tile[], top: number, height: number): void {
    if (this.tab === 'library' && !this.library) {
      this.text(this.libraryError || 'Loading library…', W / 2, top + 80, { align: 'center', color: PANEL_COLORS.muted });
      return;
    }
    const pages = Math.max(1, Math.ceil(tiles.length / PER_PAGE));
    this.page = Math.min(this.page, pages - 1);
    const pagerH = 52;
    const gap = 12;
    const tileW = (W - PAD * 2 - gap * (COLS - 1)) / COLS;
    const tileH = (height - pagerH - gap * ROWS) / ROWS;
    tiles.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE).forEach((t, i) => {
      const x = PAD + (i % COLS) * (tileW + gap);
      const y = top + Math.floor(i / COLS) * (tileH + gap);
      this.drawTile(t, x, y, tileW, tileH);
    });
    const py = top + height - pagerH;
    this.button('prev', '◀', PAD, py, 120, pagerH, () => this.page--, { disabled: this.page === 0 });
    this.text(`${this.page + 1} / ${pages}`, W / 2, py + pagerH / 2, { align: 'center', color: PANEL_COLORS.muted });
    this.button('next', '▶', W - PAD - 120, py, 120, pagerH, () => this.page++, { disabled: this.page >= pages - 1 });
  }

  private drawTile(t: Tile, x: number, y: number, w: number, h: number): void {
    const c = this.ctx;
    const id = `tile-${t.key}`;
    c.fillStyle = this.hoverId === id ? PANEL_COLORS.hover : PANEL_COLORS.button;
    c.beginPath();
    c.roundRect(x, y, w, h, 14);
    c.fill();
    const img = t.thumb ? this.image(t.thumb) : null;
    const imgH = h - 44;
    if (img?.complete && img.naturalWidth) {
      const s = Math.min((w - 12) / img.naturalWidth, (imgH - 6) / img.naturalHeight);
      const iw = img.naturalWidth * s;
      const ih = img.naturalHeight * s;
      c.save();
      c.beginPath();
      c.roundRect(x + (w - iw) / 2, y + 6, iw, ih, 10);
      c.clip();
      c.drawImage(img, x + (w - iw) / 2, y + 6, iw, ih);
      c.restore();
    } else {
      this.text(t.item.kind === 'light' ? '💡' : '▢', x + w / 2, y + imgH / 2, { size: 56, align: 'center', color: PANEL_COLORS.muted });
    }
    this.text(t.title, x + w / 2, y + h - 22, { size: 22, align: 'center', maxWidth: w - 12 });
    if (this.hoverId === id) {
      c.strokeStyle = PANEL_COLORS.active;
      c.lineWidth = 3;
      c.beginPath();
      c.roundRect(x, y, w, h, 14);
      c.stroke();
    }
    this.region({ id, x, y, w, h, onClick: () => this.host.spawn(t.item) });
  }

  private drawCamera(top: number): void {
    const lens = this.editor.doc.camera.lens;
    const set = (mutate: (l: typeof lens) => void) => this.editor.updateLens(mutate);
    const inner = W - PAD * 2;
    const v = verticalFovDeg(lens.focalLength, lens.sensor, lens.aspect);
    const hz = horizontalFovDeg(lens.focalLength, lens.sensor, lens.aspect);
    this.text(`${lens.focalLength.toFixed(lens.focalLength % 1 ? 1 : 0)} mm`, PAD, top + 20, { size: 34, weight: 700 });
    this.text(`${hz.toFixed(1)}° × ${v.toFixed(1)}°`, W - PAD, top + 20, { size: 22, color: PANEL_COLORS.muted, align: 'right' });

    let y = top + 50;
    const bw4 = (inner - 32) / 5;
    FOCAL_PRESETS.forEach((f, i) => {
      this.button(`focal-${f}`, `${f}`, PAD + (i % 4) * (bw4 + 8), y + Math.floor(i / 4) * 56, bw4, 48, () => set((l) => (l.focalLength = f)), { active: lens.focalLength === f });
    });
    y += 112;
    (
      [
        ['−5', -5],
        ['−1', -1],
        ['+1', 1],
        ['+5', 5],
      ] as const
    ).forEach(([label, d], i) => {
      this.button(`fstep-${i}`, label, PAD + i * (bw4 + 8), y, bw4, 48, () => set((l) => (l.focalLength = clampFocal(Math.round(l.focalLength) + d))));
    });
    y += 64;

    const row = (label: string, draw: (x: number, w: number) => void) => {
      this.text(label, PAD, y + 24, { size: 22, color: PANEL_COLORS.muted });
      draw(PAD + 120, inner - 120);
      y += 58;
    };
    const options = <T,>(id: string, values: readonly T[], current: T, labelOf: (v: T) => string, onPick: (v: T) => void) => (x: number, w: number) => {
      const bw = (w - 8 * (values.length - 1)) / values.length;
      values.forEach((val, i) => this.button(`${id}-${i}`, labelOf(val), x + i * (bw + 8), y, bw, 48, () => onPick(val), { active: val === current, size: 22 }));
    };
    row('Sensor', options<SensorId>('sensor', ['super35', 'fullframe'], lens.sensor, (s) => SENSORS[s].label, (s) => set((l) => (l.sensor = s))));
    row('Aspect', options('aspect', ASPECT_IDS, lens.aspect, (a) => a, (a) => set((l) => (l.aspect = a))));
    row('FPS', options('fps', FPS_OPTIONS, lens.fps, (f) => String(f), (f) => set((l) => (l.fps = f))));
    row('Guides', (x, w) => {
      const bw = (w - 16) / 3;
      (['thirds', 'safe', 'center'] as const).forEach((g, i) =>
        this.button(`guide-${g}`, g[0].toUpperCase() + g.slice(1), x + i * (bw + 8), y, bw, 48, () => set((l) => (l.guides[g] = !l.guides[g])), { active: lens.guides[g], size: 22 }),
      );
    });
    const focus = this.host.focusDistance();
    row('Focus', (x, w) => {
      const bw = (w - 8) / 2;
      this.button('af', lens.focusMode === 'auto' ? 'Auto' : 'Manual', x, y, bw, 48, () => set((l) => {
        l.focusMode = l.focusMode === 'auto' ? 'manual' : 'auto';
        if (l.focusMode === 'manual' && focus !== null) l.focusDistance = Math.round(focus * 100) / 100;
      }), { active: lens.focusMode === 'auto', size: 22 });
      this.text(focus === null ? '∞' : `${focus.toFixed(2)} m`, x + bw + 8 + bw / 2, y + 24, { size: 24, align: 'center' });
    });
    const bw3 = (inner - 16) / 3;
    const holding = this.host.isHoldingCamera();
    this.button('hold', holding ? 'Let go' : 'Hold camera', PAD, y, bw3, 52, () => this.host.toggleHoldCamera(), { active: holding, size: 22 });
    this.button('bring', 'Bring here', PAD + bw3 + 8, y, bw3, 52, () => this.host.bringCamera(), { disabled: holding, size: 22 });
    this.button('selcam', 'Select', PAD + (bw3 + 8) * 2, y, bw3, 52, () => this.editor.select('camera'), { active: this.editor.cameraSelected, size: 22 });
    const detached = this.host.isMonitorDetached();
    this.button('monitor', detached ? 'Attach monitor' : 'Detach monitor', PAD, y + 64, inner, 52, () => this.host.toggleMonitor(), { active: detached, size: 22 });
    this.text('Stick click: hold/let go · stick up/down: zoom · Cam path tab: keyframes', W / 2, y + 140, { size: 18, color: PANEL_COLORS.muted, align: 'center' });
  }

  private drawSettings(top: number): void {
    const inner = W - PAD * 2;
    let y = top;
    const row = (label: string, options: Array<[string, boolean, () => void]>) => {
      this.text(label, PAD, y + 26, { size: 22, color: PANEL_COLORS.muted });
      const x0 = PAD + 190;
      const bw = (inner - 190 - 8 * (options.length - 1)) / options.length;
      options.forEach(([text, active, onClick], i) => this.button(`set-${label}-${i}`, text, x0 + i * (bw + 8), y, bw, 52, () => {
        onClick();
        this.invalidate();
      }, { active, size: 22 }));
      y += 66;
    };
    row('Pointer hand', [
      ['Right', !prefs.leftHanded, () => setPrefs({ leftHanded: false })],
      ['Left', prefs.leftHanded, () => setPrefs({ leftHanded: true })],
    ]);
    row('Menu size', (Object.keys(MENU_SIZES) as MenuSize[]).map((s) => [s[0].toUpperCase() + s.slice(1), prefs.menuSize === s, () => setPrefs({ menuSize: s })]));
    row('Vibration', [
      ['On', prefs.haptics, () => setPrefs({ haptics: true })],
      ['Off', !prefs.haptics, () => setPrefs({ haptics: false })],
    ]);
    const q = this.host.monitorQuality();
    this.text(`Monitor quality: ${['best', 'high', 'medium', 'low'][q] ?? q} (adjusts automatically to hold 72 fps)`, PAD, y + 20, { size: 20, color: PANEL_COLORS.muted, maxWidth: inner });
    y += 56;
    const lines = [
      'The pointer hand points: trigger selects, hold the trigger (or grip) to drag. Stick click holds the camera. The other hand carries this menu, walks (stick) and undoes (X/Y).',
      'Hands without controllers: pinch to click or grab, pinch with both hands to scale, pinch the other hand on empty space to show or hide this menu.',
    ];
    for (const l of lines) {
      this.wrapText(l, PAD, y, inner, 20);
      y += 76;
    }
  }

  /** Simple word wrap for help text (up to 3 lines). */
  private wrapText(text: string, x: number, y: number, maxWidth: number, size: number): void {
    const c = this.ctx;
    c.font = `500 ${size}px system-ui, sans-serif`;
    const words = text.split(' ');
    let line = '';
    let ly = y;
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (c.measureText(next).width > maxWidth && line) {
        this.text(line, x, ly, { size, color: PANEL_COLORS.muted });
        line = w;
        ly += size * 1.3;
      } else line = next;
    }
    if (line) this.text(line, x, ly, { size, color: PANEL_COLORS.muted });
  }

  private drawTakes(top: number): void {
    const t = this.takes;
    const inner = W - PAD * 2;
    const recLabel = t.state === 'countdown' ? 'Cancel' : t.state === 'recording' ? '■ Stop' : '● Record';
    this.button('record', recLabel, PAD, top, inner * 0.55, 72, () => t.toggleRecord(), { active: t.state === 'recording' || t.state === 'countdown', size: 30 });
    const status = t.status();
    const line =
      status?.countdown !== undefined
        ? `Starting in ${Math.ceil(status.countdown)}…`
        : status?.recording !== undefined
          ? `Recording ${formatTime(status.recording)}`
          : status?.playing
            ? `▶ ${status.playing.name} ${formatTime(status.playing.time)}`
            : `${this.editor.doc.camera.lens.fps} fps · ${t.list.length} take${t.list.length === 1 ? '' : 's'}`;
    this.text(line, PAD + inner * 0.55 + 16, top + 36, { size: 24, maxWidth: inner * 0.45 - 16, color: t.state === 'recording' ? '#ff6b6b' : PANEL_COLORS.text });
    this.text('Holding the camera, the trigger also starts and stops recording.', PAD, top + 100, { size: 19, color: PANEL_COLORS.muted });

    const bw = (inner - 8) / 2;
    this.button('stopplay', '■ Stop playback', PAD, top + 124, bw, 52, () => t.stop(), { disabled: t.state !== 'playing', size: 22 });
    this.button('loop', t.loop ? 'Loop: on' : 'Loop: off', PAD + bw + 8, top + 124, bw, 52, () => (t.loop = !t.loop), { active: t.loop, size: 22 });

    const rowsTop = top + 196;
    const rowH = 62;
    const perPage = 6;
    const pages = Math.max(1, Math.ceil(t.list.length / perPage));
    this.takesPage = Math.min(this.takesPage, pages - 1);
    if (!t.list.length) this.text('No takes yet.', W / 2, rowsTop + 40, { align: 'center', color: PANEL_COLORS.muted });
    t.list.slice(this.takesPage * perPage, (this.takesPage + 1) * perPage).forEach((take, i) => {
      const y = rowsTop + i * rowH;
      const playing = t.state === 'playing' && t.current?.id === take.id;
      this.button(`take-${take.id}`, `${playing ? '■' : '▶'}  ${take.name}`, PAD, y, inner * 0.62, rowH - 10, () => (playing ? t.stop() : void t.play(take.id)), { active: playing, size: 24 });
      this.text(`${take.duration.toFixed(1)} s · ${take.fps} fps${take.source === 'keyframed' ? ' · path' : ''}`, W - PAD, y + (rowH - 10) / 2, { size: 20, align: 'right', color: PANEL_COLORS.muted });
    });
    const py = rowsTop + perPage * rowH + 4;
    this.button('tprev', '◀', PAD, py, 120, 48, () => this.takesPage--, { disabled: this.takesPage === 0 });
    this.text(`${this.takesPage + 1} / ${pages}`, W / 2, py + 24, { align: 'center', color: PANEL_COLORS.muted });
    this.button('tnext', '▶', W - PAD - 120, py, 120, 48, () => this.takesPage++, { disabled: this.takesPage >= pages - 1 });
  }

  /** Outliner: the camera and every object; pick one to select it. */
  private drawScene(top: number): void {
    // Scene files: new, save, open, export, import.
    const inner = W - PAD * 2;
    const fw = (inner - 32) / 5;
    const files: Array<[string, string, () => void, boolean?]> = [
      ['fnew', 'New', () => {
        this.project.newScene();
        this.fileNote = 'New scene. The previous one is under Open.';
      }],
      ['fsave', 'Save', () => {
        void this.project.flush().then(() => this.note('Saved in this browser.'));
      }],
      ['fopen', 'Open', () => this.showSavedScenes(), this.sceneView === 'open'],
      ['fexport', 'Export', () => {
        void this.project.exportFile().then(() => this.note('Exported to Downloads.'));
      }],
      ['fimport', 'Import', () => this.host.importScene()],
    ];
    files.forEach(([id, label, onClick, active], i) =>
      this.button(id, label, PAD + i * (fw + 8), top, fw, 50, () => {
        this.fileNote = '';
        onClick();
      }, { active, size: 22 }),
    );
    this.text(this.fileNote || SAVE_STATUS[this.project.status], PAD, top + 74, { size: 19, color: this.project.status === 'error' ? PANEL_COLORS.danger : PANEL_COLORS.muted, maxWidth: inner });
    top += 98;
    if (this.sceneView === 'open') {
      this.drawSavedScenes(top);
      return;
    }

    const objects = this.editor.doc.objects;
    const rowH = 62;
    const perPage = 8;
    const rows: Array<{ id: string; name: string; color: string; meta: string }> = [
      { id: CAMERA_ID, name: 'Camera', color: PANEL_COLORS.active, meta: `${Math.round(this.editor.doc.camera.lens.focalLength)} mm · ${this.editor.doc.camera.keyframes.length} keys` },
      ...objects.map((o) => ({ id: o.id, name: o.name, color: o.color, meta: objectMeta(o) })),
    ];
    const pages = Math.max(1, Math.ceil(rows.length / perPage));
    const sel = this.editor.selectedId;
    if (sel !== this.shownSelection) {
      // Follow selections made by pointing in the world.
      this.shownSelection = sel;
      const i = rows.findIndex((r) => r.id === sel);
      if (i >= 0) this.scenePage = Math.floor(i / perPage);
    }
    this.scenePage = Math.max(0, Math.min(this.scenePage, pages - 1));
    rows.slice(this.scenePage * perPage, (this.scenePage + 1) * perPage).forEach((r, i) => {
      this.listRow(`row-${r.id}`, PAD, top + i * rowH, W - PAD * 2, rowH - 8, r.id === sel, r.color, r.name, r.meta, () => this.editor.select(r.id === sel ? null : r.id));
    });
    if (!objects.length) this.text('Add objects from the Add tab.', W / 2, top + rowH * 1.6, { align: 'center', color: PANEL_COLORS.muted, size: 22 });
    const py = top + perPage * rowH + 2;
    this.button('sprev', '◀', PAD, py, 120, 48, () => this.scenePage--, { disabled: this.scenePage === 0 });
    this.text(`${this.scenePage + 1} / ${pages}`, W / 2, py + 24, { align: 'center', color: PANEL_COLORS.muted });
    this.button('snext', '▶', W - PAD - 120, py, 120, 48, () => this.scenePage++, { disabled: this.scenePage >= pages - 1 });
  }

  /** One-line feedback under the file buttons. */
  private note(text: string): void {
    this.fileNote = text;
    this.invalidate();
  }

  private showSavedScenes(): void {
    if (this.sceneView === 'open') {
      this.sceneView = 'objects';
      return;
    }
    this.sceneView = 'open';
    this.savedScenes = null;
    this.openPage = 0;
    void this.project
      .flush()
      .then(() => this.project.list())
      .then((list) => (this.savedScenes = list))
      .catch(() => (this.savedScenes = []))
      .finally(() => this.invalidate());
  }

  /** Saved scenes, newest first: pick one to open it. */
  private drawSavedScenes(top: number): void {
    const list = this.savedScenes;
    if (!list) {
      this.text('Loading scenes…', W / 2, top + 40, { align: 'center', color: PANEL_COLORS.muted });
      return;
    }
    const rowH = 62;
    const perPage = 8;
    const pages = Math.max(1, Math.ceil(list.length / perPage));
    this.openPage = Math.max(0, Math.min(this.openPage, pages - 1));
    if (!list.length) this.text('No saved scenes yet.', W / 2, top + 40, { align: 'center', color: PANEL_COLORS.muted });
    list.slice(this.openPage * perPage, (this.openPage + 1) * perPage).forEach((s, i) => {
      const current = s.id === this.editor.doc.id;
      const meta = `${s.objectCount} object${s.objectCount === 1 ? '' : 's'} · ${new Date(s.updatedAt).toLocaleDateString()}`;
      this.listRow(`scene-${s.id}`, PAD, top + i * rowH, W - PAD * 2, rowH - 8, current, PANEL_COLORS.muted, s.name, current ? 'open now' : meta, () => {
        this.sceneView = 'objects';
        if (!current) void this.project.openSaved(s.id).then(() => this.note(`Opened “${s.name}”.`));
      });
    });
    const py = top + perPage * rowH + 2;
    this.button('oprev', '◀', PAD, py, 120, 48, () => this.openPage--, { disabled: this.openPage === 0 });
    this.button('oback', 'Back to scene', W / 2 - 110, py, 220, 48, () => (this.sceneView = 'objects'), { size: 22 });
    this.button('onext', '▶', W - PAD - 120, py, 120, 48, () => this.openPage++, { disabled: this.openPage >= pages - 1 });
  }

  /** A selectable list row: color dot, name and a right-aligned detail. */
  private listRow(id: string, x: number, y: number, w: number, h: number, active: boolean, color: string, name: string, meta: string, onClick: () => void): void {
    const c = this.ctx;
    const hover = this.hoverId === id;
    c.fillStyle = active ? PANEL_COLORS.active : hover ? PANEL_COLORS.hover : PANEL_COLORS.button;
    c.beginPath();
    c.roundRect(x, y, w, h, 12);
    c.fill();
    if (hover) {
      c.strokeStyle = PANEL_COLORS.active;
      c.lineWidth = 3;
      c.stroke();
    }
    c.fillStyle = color;
    c.beginPath();
    c.arc(x + 26, y + h / 2, 11, 0, Math.PI * 2);
    c.fill();
    if (active) {
      c.strokeStyle = PANEL_COLORS.activeText;
      c.lineWidth = 2;
      c.stroke();
    }
    const text = active ? PANEL_COLORS.activeText : PANEL_COLORS.text;
    this.text(name, x + 50, y + h / 2, { size: 24, weight: 600, color: text, maxWidth: w * 0.55 });
    this.text(meta, x + w - 16, y + h / 2, { size: 19, color: active ? PANEL_COLORS.activeText : PANEL_COLORS.muted, align: 'right', maxWidth: w * 0.38 });
    this.region({ id, x, y, w, h, onClick });
  }

  /** Keyframed camera path: draw it with the camera in hand, then retime, revisit or replace keys. */
  private drawPath(top: number): void {
    const keys = this.editor.doc.camera.keyframes;
    const busy = this.takes.busy;
    const inner = W - PAD * 2;
    if (this.selectedKey !== null && this.selectedKey >= keys.length) this.selectedKey = null;
    const duration = keys.length ? keys[keys.length - 1].time : 0;
    this.text('Camera path', PAD, top + 18, { size: 28, weight: 700 });
    this.text(`${keys.length} key${keys.length === 1 ? '' : 's'} · ${duration.toFixed(1)} s`, W - PAD, top + 18, { size: 22, color: PANEL_COLORS.muted, align: 'right' });

    const drawing = this.host.isPathMode() && this.editor.cameraSelected;
    const bw3 = (inner - 16) / 3;
    let y = top + 46;
    this.button('kdraw', drawing ? 'Done drawing' : 'Draw path', PAD, y, bw3, 56, () => {
      if (drawing) this.host.setPathMode(false);
      else {
        this.editor.select(CAMERA_ID);
        this.host.setPathMode(true);
      }
    }, { active: drawing, disabled: busy && !drawing, size: 22 });
    this.button('kadd', '+ Key at camera', PAD + bw3 + 8, y, bw3, 56, () => this.editor.addCameraKey(), { disabled: busy, size: 22 });
    this.button('kclear', 'Clear all', PAD + (bw3 + 8) * 2, y, bw3, 56, () => {
      this.selectedKey = null;
      this.editor.editKeys((ks) => ks.splice(0));
    }, { disabled: busy || !keys.length, danger: true, size: 22 });
    y += 70;
    this.wrapText(
      drawing
        ? 'The camera follows your hand: frame the shot on its monitor and pull the trigger to drop a key. Stick zooms.'
        : 'Draw path puts the camera in your hand; each trigger pull drops a key. Grab a numbered marker or a curve handle to reshape.',
      PAD,
      y + 10,
      inner,
      19,
    );
    y += 64;

    const rowH = 60;
    const perPage = 6;
    const pages = Math.max(1, Math.ceil(keys.length / perPage));
    this.keysPage = Math.max(0, Math.min(this.keysPage, pages - 1));
    if (!keys.length) this.text('No keyframes yet.', W / 2, y + 40, { align: 'center', color: PANEL_COLORS.muted });
    const sb = 54;
    keys.slice(this.keysPage * perPage, (this.keysPage + 1) * perPage).forEach((k, j) => {
      const i = this.keysPage * perPage + j;
      const ry = y + j * rowH;
      const h = rowH - 8;
      const active = this.selectedKey === i;
      const c = this.ctx;
      c.fillStyle = active ? '#3a3220' : PANEL_COLORS.button;
      c.beginPath();
      c.roundRect(PAD, ry, inner, h, 12);
      c.fill();
      if (active || this.hoverId === `key-${i}`) {
        c.strokeStyle = PANEL_COLORS.active;
        c.lineWidth = 3;
        c.stroke();
      }
      this.text(`${i + 1}`, PAD + 26, ry + h / 2, { size: 24, weight: 700, align: 'center', color: active ? PANEL_COLORS.active : PANEL_COLORS.text });
      this.text(`${k.time.toFixed(1)} s`, PAD + 102, ry + h / 2, { size: 23, align: 'center' });
      let x = PAD + 150;
      this.button(`kless-${i}`, '−', x, ry + 4, sb, h - 8, () => this.retime(i, -0.5), { disabled: busy || k.time <= 0, size: 26 });
      x += sb + 6;
      this.button(`kmore-${i}`, '+', x, ry + 4, sb, h - 8, () => this.retime(i, 0.5), { disabled: busy, size: 26 });
      x += sb + 12;
      this.text(`${Math.round(k.focalLength)} mm`, x + 40, ry + h / 2, { size: 20, align: 'center', color: PANEL_COLORS.muted });
      x += 92;
      const bw = (PAD + inner - 6 - x - 12) / 3;
      this.button(`kgo-${i}`, 'Go', x, ry + 4, bw, h - 8, () => {
        this.selectedKey = i;
        this.editor.goToKey(i);
      }, { disabled: busy || this.host.isHoldingCamera(), size: 21 });
      this.button(`kset-${i}`, 'Set', x + bw + 6, ry + 4, bw, h - 8, () => {
        this.selectedKey = i;
        this.editor.editKeys((ks) => (ks[i] = this.editor.cameraKey(ks[i].time)));
      }, { disabled: busy, size: 21 });
      this.button(`kdel-${i}`, '✕', x + (bw + 6) * 2, ry + 4, bw, h - 8, () => {
        this.selectedKey = null;
        this.editor.editKeys((ks) => ks.splice(i, 1));
      }, { disabled: busy, danger: true, size: 21 });
      // Registered last so the buttons above win: the rest of the row picks the key.
      this.region({ id: `key-${i}`, x: PAD, y: ry, w: inner, h, onClick: () => (this.selectedKey = active ? null : i) });
    });
    const py = y + perPage * rowH + 2;
    this.button('kprev', '◀', PAD, py, 120, 46, () => this.keysPage--, { disabled: this.keysPage === 0 });
    this.text(`${this.keysPage + 1} / ${pages}`, W / 2, py + 23, { align: 'center', color: PANEL_COLORS.muted });
    this.button('knext', '▶', W - PAD - 120, py, 120, 46, () => this.keysPage++, { disabled: this.keysPage >= pages - 1 });

    const by = py + 58;
    const bw4 = (inner - 24) / 4;
    const playingPath = this.takes.state === 'playing' && this.takes.current?.source === 'keyframed';
    const canBake = keys.length >= 2 && (!busy || playingPath);
    this.button('kpreview', playingPath ? '■ Stop' : '▶ Preview', PAD, by, bw4, 56, () => (playingPath ? this.takes.stop() : void this.takes.bakePath(false)), { active: playingPath, disabled: !canBake, size: 22 });
    this.button('ksave', 'Save take', PAD + bw4 + 8, by, bw4, 56, () => void this.takes.bakePath(true).then(() => this.setTab('takes')), { disabled: !canBake || busy, size: 22 });
    this.button('kslow', 'Slower', PAD + (bw4 + 8) * 2, by, bw4, 56, () => this.scaleTimes(1.25), { disabled: busy || keys.length < 2, size: 22 });
    this.button('kfast', 'Faster', PAD + (bw4 + 8) * 3, by, bw4, 56, () => this.scaleTimes(0.8), { disabled: busy || keys.length < 2, size: 22 });
    this.button('ksmooth', 'Smooth', PAD + (bw4 + 8) * 4, by, bw4, 56, () => this.editor.edit((d) => smoothPath(d, CAMERA_ID)), { disabled: busy || !hasEditedHandles(this.editor.doc, CAMERA_ID), size: 22 });
  }

  /** Shifts keyframe i by `delta` seconds (never below 0), keeping it picked after re-sorting. */
  private retime(i: number, delta: number): void {
    const key = this.editor.doc.camera.keyframes[i];
    if (!key) return;
    const time = Math.max(0, Math.round((key.time + delta) * 10) / 10);
    const moved: { key?: CameraKey } = {};
    this.editor.editKeys((ks) => {
      ks[i].time = time;
      moved.key = ks[i];
    });
    const index = moved.key ? this.editor.doc.camera.keyframes.indexOf(moved.key) : -1;
    this.selectedKey = index >= 0 ? index : i;
    this.keysPage = Math.floor(this.selectedKey / 6);
  }

  /** Stretches (factor > 1) or compresses the whole path's timing. */
  private scaleTimes(factor: number): void {
    this.editor.editKeys((ks) => ks.forEach((k) => (k.time = Math.round(k.time * factor * 10) / 10)));
  }

  private drawSelection(top: number): void {
    const c = this.ctx;
    c.fillStyle = '#2a2f3a';
    c.fillRect(PAD, top - 20, W - PAD * 2, 2);
    const sel = this.editor.selected;
    const inner = W - PAD * 2;
    const bw = (inner - 16) / 3;
    const row = (i: number) => top + i * 62;
    const goW = 130;

    if (sel) {
      c.fillStyle = sel.color;
      c.beginPath();
      c.arc(PAD + 12, row(0) + 22, 12, 0, Math.PI * 2);
      c.fill();
      this.text(sel.name, PAD + 36, row(0) + 22, { size: 26, weight: 600, maxWidth: inner - goW - 50 });
      this.button('goto', 'Go to', W - PAD - goW, row(0), goW, 44, () => this.host.goTo(sel.id), { size: 20 });
      this.button('dup', 'Duplicate', PAD, row(0) + 52, bw, 50, () => this.editor.duplicate(sel.id));
      this.button('floor', 'To floor', PAD + bw + 8, row(0) + 52, bw, 50, () => this.host.snapSelected());
      this.button('del', 'Delete', PAD + (bw + 8) * 2, row(0) + 52, bw, 50, () => this.editor.remove(sel.id), { danger: true });
      let pathRow = row(1) + 54;
      if (sel.actor) {
        const cw = (inner - 24) / 4;
        ACTOR_CLIPS.forEach((clip, i) => {
          this.button(`clip-${clip}`, clip[0].toUpperCase() + clip.slice(1), PAD + i * (cw + 8), row(1) + 54, cw, 50, () => {
            this.editor.update(sel.id, (o) => (o.actor!.clip = clip));
          }, { active: sel.actor!.clip === clip });
        });
        pathRow = row(2) + 54;
      }
      this.drawObjectPath(sel, pathRow);
    } else if (this.editor.cameraSelected) {
      const holding = this.host.isHoldingCamera();
      const drawing = this.host.isPathMode();
      this.text('Camera', PAD, row(0) + 22, { size: 26, weight: 600 });
      this.button('goto', 'Go to', W - PAD - goW, row(0), goW, 44, () => this.host.goTo(CAMERA_ID), { size: 20, disabled: holding });
      this.button('selhold', holding ? 'Let go' : 'Hold camera', PAD, row(0) + 52, bw, 50, () => this.host.toggleHoldCamera(), { active: holding, size: 22 });
      this.button('selbring', 'Bring here', PAD + bw + 8, row(0) + 52, bw, 50, () => this.host.bringCamera(), { disabled: holding, size: 22 });
      this.button('selpath', drawing ? 'Done drawing' : 'Draw path', PAD + (bw + 8) * 2, row(0) + 52, bw, 50, () => this.host.setPathMode(!drawing), { active: drawing, disabled: this.takes.busy && !drawing, size: 22 });
      const detached = this.host.isMonitorDetached();
      this.button('selmonitor', detached ? 'Attach monitor' : 'Detach monitor', PAD, row(1) + 54, bw, 50, () => this.host.toggleMonitor(), { active: detached, size: 20 });
      this.text(
        drawing ? 'Trigger drops a keyframe. Edit keys in Cam path.' : 'Hold the trigger to drag it, or a stick click to hold it.',
        PAD + bw + 16,
        row(1) + 79,
        { size: 18, color: PANEL_COLORS.muted, maxWidth: inner - bw - 16 },
      );
    } else {
      this.text('Point and pull the trigger to select; hold it to drag.', W / 2, row(0) + 30, { size: 22, color: PANEL_COLORS.muted, align: 'center', maxWidth: inner });
      this.text('Pick from the list in the Scene tab.', W / 2, row(0) + 66, { size: 22, color: PANEL_COLORS.muted, align: 'center', maxWidth: inner });
    }

    const y = H - PAD - 56;
    this.button('undo', 'Undo', PAD, y, bw, 56, () => this.editor.undo(), { disabled: !this.editor.canUndo });
    this.button('redo', 'Redo', PAD + bw + 8, y, bw, 56, () => this.editor.redo(), { disabled: !this.editor.canRedo });
    this.button('play', this.playback.playing ? '■ Stop' : '▶ Preview', PAD + (bw + 8) * 2, y, bw, 56, () => this.playback.toggle(), { active: this.playback.playing });
  }

  /** Waypoint path controls for any object: draw, clear, loop and speed. */
  private drawObjectPath(sel: SceneObject, y: number): void {
    const path = pathOf(sel);
    const wp = path?.waypoints.length ?? 0;
    const speed = path?.speed ?? editPath(structuredClone(sel)).speed;
    const drawing = this.host.isPathMode();
    const h = 50;
    let x = PAD;
    this.button('path', drawing ? 'Done' : 'Draw path', x, y, 142, h, () => this.host.setPathMode(!drawing), { active: drawing, size: 21 });
    x += 148;
    this.button('clearpath', `Clear (${wp})`, x, y, 112, h, () => this.editor.update(sel.id, (o) => clearWaypoints(o)), { disabled: wp === 0, size: 20 });
    x += 118;
    this.button('smoothpath', 'Smooth', x, y, 100, h, () => this.editor.edit((d) => smoothPath(d, sel.id)), { disabled: !hasEditedHandles(this.editor.doc, sel.id), size: 20 });
    x += 106;
    const loop = !!path?.loop;
    this.button('pathloop', loop ? 'Loop: on' : 'Loop: off', x, y, 108, h, () => this.editor.update(sel.id, (o) => (editPath(o).loop = !loop)), { active: loop, size: 20 });
    x += 114;
    const step = (d: number) => this.editor.update(sel.id, (o) => (editPath(o).speed = Math.max(0, Math.round((speed + d) * 100) / 100)));
    this.button('slower', '−', x, y, 54, h, () => step(-0.25), { disabled: speed <= 0, size: 26 });
    this.text(`${speed.toFixed(2)} m/s`, (x + 54 + W - PAD - 54) / 2, y + h / 2, { size: 17, align: 'center', color: PANEL_COLORS.muted });
    this.button('faster', '+', W - PAD - 54, y, 54, h, () => step(0.25), { size: 26 });
    this.text(
      drawing ? 'Point at the floor and pull the trigger to add waypoints.' : wp ? 'Grab a waypoint or a curve handle (small dot) to reshape the path.' : '',
      W / 2,
      y + h + 22,
      { size: 19, color: PANEL_COLORS.muted, align: 'center' },
    );
  }

  private image(url: string): HTMLImageElement {
    let img = this.images.get(url);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => this.invalidate();
      img.src = url;
      this.images.set(url, img);
    }
    return img;
  }
}

/** Kind and path summary for an outliner row. */
function objectMeta(o: SceneObject): string {
  const n = pathOf(o)?.waypoints.length ?? 0;
  return [o.kind, n ? `path ${n}` : '', o.hiddenInRenders ? 'hidden' : ''].filter(Boolean).join(' · ');
}
