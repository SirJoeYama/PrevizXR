import type { LensSettings } from '../model/scene';
import { SENSORS } from './lens';

/** Recording/playback state shown on every monitor. */
export interface HudStatus {
  /** Seconds left before recording starts. */
  countdown?: number;
  /** Seconds recorded so far. */
  recording?: number;
  /** Take being played back and its current time. */
  playing?: { name: string; time: number };
}

export interface GuideInfo {
  lens: LensSettings;
  /** Live focus distance in metres; null when nothing is under the frame centre. */
  focus: number | null;
  /** Focal length actually in use (differs from the lens settings while a take plays back). */
  focal?: number;
  status?: HudStatus;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

/**
 * Draws frame guides and the lens readout over a frame rectangle (canvas pixels).
 * Shared by the VR monitor overlay and the desktop picture-in-picture / camera view.
 */
export function drawGuides(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, info: GuideInfo): void {
  const { lens } = info;
  const unit = Math.max(1, Math.min(w, h) / 360);
  ctx.save();
  ctx.lineWidth = unit;

  if (lens.guides.thirds) {
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    for (const f of [1 / 3, 2 / 3]) {
      ctx.moveTo(x + w * f, y);
      ctx.lineTo(x + w * f, y + h);
      ctx.moveTo(x, y + h * f);
      ctx.lineTo(x + w, y + h * f);
    }
    ctx.stroke();
  }

  if (lens.guides.safe) {
    ctx.setLineDash([6 * unit, 4 * unit]);
    for (const [f, color] of [
      [0.93, 'rgba(255,181,71,0.8)'],
      [0.9, 'rgba(124,196,255,0.8)'],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.strokeRect(x + (w * (1 - f)) / 2, y + (h * (1 - f)) / 2, w * f, h * f);
    }
    ctx.setLineDash([]);
  }

  if (lens.guides.center) {
    const s = 10 * unit;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.moveTo(x + w / 2 - s, y + h / 2);
    ctx.lineTo(x + w / 2 + s, y + h / 2);
    ctx.moveTo(x + w / 2, y + h / 2 - s);
    ctx.lineTo(x + w / 2, y + h / 2 + s);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.strokeRect(x + unit / 2, y + unit / 2, w - unit, h - unit);

  const size = Math.round(11 * unit);
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textBaseline = 'bottom';
  const pad = 6 * unit;
  const left = `${Math.round(info.focal ?? lens.focalLength)}mm · ${SENSORS[lens.sensor].label} · ${lens.aspect} · ${lens.fps}fps`;
  const focus = info.focus === null ? '∞' : `${info.focus.toFixed(info.focus < 10 ? 2 : 1)} m`;
  const right = `${lens.focusMode === 'auto' ? 'AF' : 'MF'} ${focus}`;
  for (const [text, align, tx] of [
    [left, 'left', x + pad],
    [right, 'right', x + w - pad],
  ] as const) {
    ctx.textAlign = align;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const tw = ctx.measureText(text).width;
    const bx = align === 'left' ? tx - 3 * unit : tx - tw - 3 * unit;
    ctx.fillRect(bx, y + h - pad - size - 3 * unit, tw + 6 * unit, size + 6 * unit);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, tx, y + h - pad);
  }

  const st = info.status;
  if (st?.recording !== undefined || st?.playing) {
    const label = st.playing ? `▶ ${st.playing.name}  ${formatTime(st.playing.time)}` : `REC  ${formatTime(st.recording!)}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width;
    const top = y + pad;
    const boxH = size + 8 * unit;
    const dot = st.playing ? 0 : boxH * 0.5;
    ctx.fillStyle = st.playing ? 'rgba(0,0,0,0.55)' : 'rgba(150,0,0,0.75)';
    ctx.fillRect(x + pad, top, tw + dot + 12 * unit, boxH);
    if (!st.playing) {
      ctx.fillStyle = '#ff3b3b';
      ctx.beginPath();
      ctx.arc(x + pad + 6 * unit + dot / 2, top + boxH / 2, dot / 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + pad + 6 * unit + dot, top + boxH / 2 + unit);
  }
  if (st?.countdown !== undefined) {
    const n = Math.max(1, Math.ceil(st.countdown));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(h * 0.4)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillText(String(n), x + w / 2 + 3 * unit, y + h / 2 + 3 * unit);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(String(n), x + w / 2, y + h / 2);
  }
  ctx.restore();
}
