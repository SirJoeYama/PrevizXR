import { BUNDLED, CATEGORIES, type Category } from '../../assets/catalog';
import { loadPolyLibrary, polyAssetRef, polyThumbUrl, searchPoly, type PolyEntry } from '../../assets/polyLibrary';
import type { Playback } from '../../app/Playback';
import type { Spawnable } from '../../app/spawn';
import type { Editor } from '../../model/Editor';
import { ACTOR_CLIPS } from '../../model/scene';
import { CanvasPanel, PANEL_COLORS } from './CanvasPanel';

export interface VRMenuHost {
  spawn(item: Spawnable): void;
  isPathMode(): boolean;
  setPathMode(on: boolean): void;
  snapSelected(): void;
}

type Tab = Category | 'library';

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
  private page = 0;
  private libraryQuery = LIBRARY_PRESETS[0];
  private library: PolyEntry[] | null = null;
  private libraryError = '';
  private readonly images = new Map<string, HTMLImageElement>();

  constructor(
    private readonly editor: Editor,
    private readonly playback: Playback,
    private readonly host: VRMenuHost,
  ) {
    super(W, H, 0.3);
    this.mesh.name = 'VRMenu';
    editor.subscribe(() => this.invalidate());
    playback.onChange(() => this.invalidate());
  }

  protected draw(): void {
    const c = this.ctx;
    c.fillStyle = PANEL_COLORS.bg;
    c.beginPath();
    c.roundRect(0, 0, W, H, 28);
    c.fill();

    this.text('PrevizXR', PAD, 40, { size: 30, weight: 700, color: PANEL_COLORS.active });
    this.text(this.editor.doc.name, W - PAD, 40, { size: 22, color: PANEL_COLORS.muted, align: 'right', maxWidth: 420 });

    const tabs: Array<{ id: Tab; label: string }> = [...CATEGORIES, { id: 'library', label: 'Library' }];
    const tabW = (W - PAD * 2 - 8 * 4) / 5;
    tabs.forEach((t, i) => {
      const x = PAD + (i % 5) * (tabW + 8);
      const y = 76 + Math.floor(i / 5) * 60;
      this.button(`tab-${t.id}`, t.label, x, y, tabW, 52, () => this.setTab(t.id), { active: this.tab === t.id, size: 22 });
    });

    let gridTop = 208;
    if (this.tab === 'library') gridTop = this.drawLibraryPresets(gridTop);
    this.drawGrid(this.tiles(), gridTop, 836 - gridTop);
    this.drawSelection(900);
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
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

  private tiles(): Tile[] {
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

  private drawSelection(top: number): void {
    const c = this.ctx;
    c.fillStyle = '#2a2f3a';
    c.fillRect(PAD, top - 20, W - PAD * 2, 2);
    const sel = this.editor.selected;
    const bw = (W - PAD * 2 - 16) / 3;
    const row = (i: number) => top + i * 62;

    if (sel) {
      c.fillStyle = sel.color;
      c.beginPath();
      c.arc(PAD + 12, row(0) + 22, 12, 0, Math.PI * 2);
      c.fill();
      this.text(sel.name, PAD + 36, row(0) + 22, { size: 26, weight: 600, maxWidth: W - PAD * 2 - 40 });
      this.button('dup', 'Duplicate', PAD, row(0) + 48, bw, 50, () => this.editor.duplicate(sel.id));
      this.button('floor', 'To floor', PAD + bw + 8, row(0) + 48, bw, 50, () => this.host.snapSelected());
      this.button('del', 'Delete', PAD + (bw + 8) * 2, row(0) + 48, bw, 50, () => this.editor.remove(sel.id), { danger: true });
      if (sel.actor) {
        const cw = (W - PAD * 2 - 24) / 4;
        ACTOR_CLIPS.forEach((clip, i) => {
          this.button(`clip-${clip}`, clip[0].toUpperCase() + clip.slice(1), PAD + i * (cw + 8), row(1) + 50, cw, 50, () => {
            this.editor.update(sel.id, (o) => (o.actor!.clip = clip));
          }, { active: sel.actor!.clip === clip });
        });
        const wp = sel.actor.waypoints.length;
        this.button('path', this.host.isPathMode() ? 'Placing path…' : 'Draw path', PAD, row(2) + 50, bw, 50, () => this.host.setPathMode(!this.host.isPathMode()), { active: this.host.isPathMode() });
        this.button('clearpath', `Clear (${wp})`, PAD + bw + 8, row(2) + 50, bw, 50, () => this.editor.update(sel.id, (o) => (o.actor!.waypoints = [])), { disabled: wp === 0 });
        this.button('loop', sel.actor.loop ? 'Loop: on' : 'Loop: off', PAD + (bw + 8) * 2, row(2) + 50, bw, 50, () => this.editor.update(sel.id, (o) => (o.actor!.loop = !o.actor!.loop)), { active: sel.actor.loop });
      }
    } else {
      this.text('Point and pull the trigger to select. Squeeze grip to grab.', W / 2, row(0) + 40, { size: 22, color: PANEL_COLORS.muted, align: 'center', maxWidth: W - PAD * 2 });
    }

    const y = H - PAD - 56;
    this.button('undo', 'Undo', PAD, y, bw, 56, () => this.editor.undo(), { disabled: !this.editor.canUndo });
    this.button('redo', 'Redo', PAD + bw + 8, y, bw, 56, () => this.editor.redo(), { disabled: !this.editor.canRedo });
    this.button('play', this.playback.playing ? '■ Stop' : '▶ Preview', PAD + (bw + 8) * 2, y, bw, 56, () => this.playback.toggle(), { active: this.playback.playing });
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
