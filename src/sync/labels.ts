import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';

const W = 512;
const H = 112;
const WORLD_HEIGHT = 0.14;

/** Name tag sprite: the object's ID color as background, readable text on top. */
export function makeLabel(text: string, color: string): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.raycast = () => {}; // labels never block picking
  sprite.renderOrder = 10;
  sprite.userData.helper = true;
  drawLabel(sprite, text, color);
  return sprite;
}

export function drawLabel(sprite: Sprite, text: string, color: string): void {
  const texture = sprite.material.map as CanvasTexture;
  const canvas = texture.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 52px system-ui, sans-serif';
  const textW = Math.min(ctx.measureText(text).width, W - 48);
  const boxW = textW + 48;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect((W - boxW) / 2, 8, boxW, H - 16, 24);
  ctx.fill();
  ctx.fillStyle = luminance(color) > 0.55 ? '#111' : '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2 + 2, W - 48);
  texture.needsUpdate = true;
  sprite.scale.set((WORLD_HEIGHT * W) / H, WORLD_HEIGHT, 1);
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}
