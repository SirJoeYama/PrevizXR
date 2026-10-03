import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, type Vector2 } from 'three';

export interface Region {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  onClick: () => void;
}

export const PANEL_COLORS = {
  bg: '#171a21ee',
  button: '#262b35',
  hover: '#353c4a',
  active: '#ffb547',
  activeText: '#1a1205',
  text: '#e6e8ee',
  muted: '#8b93a5',
  danger: '#ff6b6b',
};

/**
 * A flat 3D panel drawn with the 2D canvas API (immediate mode).
 * Subclasses implement draw(); while drawing they call button()/region() to register clickable areas.
 * Controllers point at the mesh; the hit's UV maps back to canvas pixels.
 */
export abstract class CanvasPanel {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  protected readonly canvas: HTMLCanvasElement;
  protected readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  protected regions: Region[] = [];
  protected hoverId: string | null = null;
  private dirty = true;

  constructor(
    protected readonly width: number,
    protected readonly height: number,
    worldWidth: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    const worldHeight = (worldWidth * height) / width;
    this.mesh = new Mesh(
      new PlaneGeometry(worldWidth, worldHeight),
      new MeshBasicMaterial({ map: this.texture, transparent: true, side: DoubleSide, toneMapped: false }),
    );
    this.mesh.userData.helper = true;
    this.mesh.renderOrder = 20;
  }

  protected abstract draw(): void;

  /** Marks the panel for redraw on the next update(). */
  invalidate(): void {
    this.dirty = true;
  }

  update(): void {
    if (!this.dirty || !this.mesh.visible) return;
    this.dirty = false;
    this.regions = [];
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.draw();
    this.texture.needsUpdate = true;
  }

  /** Updates hover state from a ray hit UV (or null when not pointing at the panel). */
  pointer(uv: Vector2 | null): void {
    const id = uv ? (this.hit(uv)?.id ?? null) : null;
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.invalidate();
    }
  }

  /** Id of the clickable region under a UV, if any. */
  hitId(uv: Vector2): string | null {
    return this.hit(uv)?.id ?? null;
  }

  click(uv: Vector2): boolean {
    const r = this.hit(uv);
    if (!r) return false;
    r.onClick();
    this.invalidate();
    return true;
  }

  private hit(uv: Vector2): Region | undefined {
    const x = uv.x * this.width;
    const y = (1 - uv.y) * this.height;
    return this.regions.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  }

  protected region(r: Region): void {
    this.regions.push(r);
  }

  protected button(
    id: string,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    onClick: () => void,
    opts: { active?: boolean; disabled?: boolean; danger?: boolean; size?: number } = {},
  ): void {
    const c = this.ctx;
    const hover = this.hoverId === id && !opts.disabled;
    c.fillStyle = opts.active ? PANEL_COLORS.active : hover ? PANEL_COLORS.hover : PANEL_COLORS.button;
    c.beginPath();
    c.roundRect(x, y, w, h, 12);
    c.fill();
    if (hover) {
      c.strokeStyle = PANEL_COLORS.active;
      c.lineWidth = 3;
      c.stroke();
    }
    c.fillStyle = opts.disabled ? PANEL_COLORS.muted : opts.active ? PANEL_COLORS.activeText : opts.danger ? PANEL_COLORS.danger : PANEL_COLORS.text;
    c.font = `600 ${opts.size ?? 26}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, x + w / 2, y + h / 2 + 1, w - 12);
    if (!opts.disabled) this.region({ id, x, y, w, h, onClick });
  }

  protected text(s: string, x: number, y: number, opts: { size?: number; color?: string; align?: CanvasTextAlign; weight?: number; maxWidth?: number } = {}): void {
    const c = this.ctx;
    c.fillStyle = opts.color ?? PANEL_COLORS.text;
    c.font = `${opts.weight ?? 500} ${opts.size ?? 24}px system-ui, sans-serif`;
    c.textAlign = opts.align ?? 'left';
    c.textBaseline = 'middle';
    c.fillText(s, x, y, opts.maxWidth);
  }
}
