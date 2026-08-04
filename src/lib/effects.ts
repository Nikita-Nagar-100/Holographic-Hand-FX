import { RGB } from './spectrum';
import { clamp } from './vector';

/**
 * Procedural cinematic effects: light rays, heat distortion, volumetric
 * lighting, and a temporal jitter buffer.  All canvas 2d + additive blending
 * so they compose cleanly with the existing bloom pipeline.
 */

/* ------------------------------------------------------------------ */
/*  Light rays                                                         */
/* ------------------------------------------------------------------ */

/**
 * Draw god-ray style volumetric light rays emanating from a point.
 * Uses rotating triangular wedges with gradient alpha.
 */
export function drawLightRays(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  color: RGB,
  intensity: number,
  time: number,
  rayCount = 8,
) {
  const a = clamp(intensity, 0, 1);
  if (a < 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const halfSpread = 0.38;
  for (let i = 0; i < rayCount; i++) {
    const baseAngle = (i / rayCount) * Math.PI * 2 + time * 0.08;
    const flick = 0.55 + Math.sin(time * 3 + i * 1.7) * 0.25;
    const grad = ctx.createLinearGradient(
      x,
      y,
      x + Math.cos(baseAngle) * length,
      y + Math.sin(baseAngle) * length,
    );
    grad.addColorStop(0, `rgba(${color.r | 0},${color.g | 0},${color.b | 0},${a * 0.25 * flick})`);
    grad.addColorStop(0.5, `rgba(${color.r | 0},${color.g | 0},${color.b | 0},${a * 0.08 * flick})`);
    grad.addColorStop(1, `rgba(${color.r | 0},${color.g | 0},${color.b | 0},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const tipX = x + Math.cos(baseAngle) * length;
    const tipY = y + Math.sin(baseAngle) * length;
    const s1 = baseAngle + halfSpread;
    const s2 = baseAngle - halfSpread;
    ctx.lineTo(x + Math.cos(s1) * length * 0.15, y + Math.sin(s1) * length * 0.15);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(x + Math.cos(s2) * length * 0.15, y + Math.sin(s2) * length * 0.15);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/*  Volumetric lighting                                                */
/* ------------------------------------------------------------------ */

/**
 * Draw a soft volumetric light cone — a radial gradient with a subtle
 * god-ray shaft.  Good for areas around an energy source.
 */
export function drawVolumetricLight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: RGB,
  intensity: number,
  time: number,
) {
  const a = clamp(intensity, 0, 1);
  if (a < 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // wide soft halo
  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0, `rgba(${color.r | 0},${color.g | 0},${color.b | 0},${a * 0.4})`);
  grad.addColorStop(0.3, `rgba(${color.r | 0},${color.g | 0},${color.b | 0},${a * 0.15})`);
  grad.addColorStop(0.7, `rgba(${color.r | 0},${color.g | 0},${color.b | 0},${a * 0.04})`);
  grad.addColorStop(1, `rgba(${color.r | 0},${color.g | 0},${color.b | 0},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  // subtle breathing shaft
  const breathe = 1 + Math.sin(time * 1.5) * 0.06;
  ctx.globalAlpha = a * 0.3;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.6 * breathe, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/*  Heat distortion                                                     */
/* ------------------------------------------------------------------ */

/**
 * Simulate heat distortion by displacing a small source region.
 * Uses a slice-and-redraw technique: reads horizontal slices of the
 * destination canvas and redraws them with a sine offset.
 * Keep `slices` modest (e.g. 10-16) for performance.
 */
export function drawHeatDistortion(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
  time: number,
  amplitude: number,
  slices = 12,
) {
  const cx = clamp(x, radius, canvas.width - radius);
  const cy = clamp(y, radius, canvas.height - radius);
  const r = Math.max(4, radius);
  ctx.save();
  const sliceH = (r * 2) / slices;
  for (let i = 0; i < slices; i++) {
    const sy = cy - r + i * sliceH;
    const dist01 = i / slices;
    // stronger wobble at center, weaker at edges
    const falloff = Math.sin(dist01 * Math.PI);
    const wobble = Math.sin(time * 6 + i * 0.8) * amplitude * falloff;
    const sliceW = r * 2 * Math.sqrt(Math.max(0, 1 - Math.pow(dist01 * 2 - 1, 2)));
    if (sliceW < 2) continue;
    const sx = cx - sliceW / 2 + wobble;
    ctx.drawImage(
      canvas,
      sx,
      sy,
      sliceW,
      sliceH,
      sx + wobble * 0.5,
      sy,
      sliceW,
      sliceH,
    );
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/*  Temporal jitter buffer (pseudo-TAA)                                 */
/* ------------------------------------------------------------------ */

/**
 * A lightweight temporal accumulation buffer.
 * Blends the current frame with a running history buffer at a small
 * alpha, which smooths flickering edges and reduces jitter — the
 * cheap-man's TAA for a canvas pipeline.
 */
export class TemporalBuffer {
  private history: HTMLCanvasElement;
  private historyCtx: CanvasRenderingContext2D;
  private alpha: number;
  private w = 0;
  private h = 0;

  constructor(alpha = 0.82) {
    this.alpha = alpha;
    this.history = document.createElement('canvas');
    this.history.width = 2;
    this.history.height = 2;
    this.historyCtx = this.history.getContext('2d')!;
  }

  resize(w: number, h: number) {
    if (this.w !== w || this.h !== h) {
      this.w = w;
      this.h = h;
      this.history.width = w;
      this.history.height = h;
    }
  }

  /**
   * Composite `src` onto the history buffer, then blend the history
   * back onto `dest` at `1 - alpha` to produce a temporally smoothed
   * result.  `dest` receives the final image.
   */
  apply(src: CanvasRenderingContext2D, dest: CanvasRenderingContext2D) {
    const w = this.w;
    const h = this.h;
    if (w < 2 || h < 2) return;

    // Save current frame into history with partial alpha
    this.historyCtx.globalCompositeOperation = 'source-over';
    this.historyCtx.globalAlpha = this.alpha;
    this.historyCtx.clearRect(0, 0, w, h);
    this.historyCtx.drawImage(src.canvas, 0, 0, w, h);
    this.historyCtx.globalAlpha = 1;

    // Blend history onto dest for temporal smoothing
    dest.save();
    dest.globalCompositeOperation = 'lighter';
    dest.globalAlpha = 1 - this.alpha;
    dest.drawImage(this.history, 0, 0, w, h);
    dest.globalAlpha = 1;
    dest.restore();
  }

  reset() {
    this.historyCtx.clearRect(0, 0, this.w, this.h);
  }
}

/* ------------------------------------------------------------------ */
/*  Lens flare (multi-element)                                          */
/* ------------------------------------------------------------------ */

/**
 * Draw a multi-element cinematic lens flare at a screen position.
 * Includes circular ghosts, anamorphic streak, and chromatic rings.
 */
export function drawLensFlare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  intensity: number,
  color: RGB,
  time: number,
) {
  const a = clamp(intensity, 0, 1);
  if (a < 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // anamorphic horizontal streak
  const streakLen = 120 * a;
  const streakGrad = ctx.createLinearGradient(x - streakLen, y, x + streakLen, y);
  streakGrad.addColorStop(0, `rgba(${color.r | 0},${color.g | 0},${color.b | 0},0)`);
  streakGrad.addColorStop(0.5, `rgba(${color.r | 0},${color.g | 0},${color.b | 0},${a * 0.35})`);
  streakGrad.addColorStop(1, `rgba(${color.r | 0},${color.g | 0},${color.b | 0},0)`);
  ctx.fillStyle = streakGrad;
  ctx.fillRect(x - streakLen, y - 1.5, streakLen * 2, 3);

  // central bright core
  const coreGrad = ctx.createRadialGradient(x, y, 0, x, y, 30 * a);
  coreGrad.addColorStop(0, `rgba(255,255,255,${a * 0.9})`);
  coreGrad.addColorStop(0.4, `rgba(${color.r | 0},${color.g | 0},${color.b | 0},${a * 0.5})`);
  coreGrad.addColorStop(1, `rgba(${color.r | 0},${color.g | 0},${color.b | 0},0)`);
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(x, y, 30 * a, 0, Math.PI * 2);
  ctx.fill();

  // ghost circles along a diagonal axis
  const axis = time * 0.2;
  const dx = Math.cos(axis);
  const dy = Math.sin(axis);
  const ghosts = [0.4, 0.7, 1.0, 1.4, 1.8];
  for (let i = 0; i < ghosts.length; i++) {
    const off = ghosts[i] * 40 * a;
    const gx = x + dx * off;
    const gy = y + dy * off;
    const gr = (8 + i * 4) * a;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    const chroma = i % 2 === 0 ? color : { r: 255, g: 255, b: 255 };
    g.addColorStop(0, `rgba(${chroma.r | 0},${chroma.g | 0},${chroma.b | 0},${a * 0.3 / (i + 1)})`);
    g.addColorStop(1, `rgba(${chroma.r | 0},${chroma.g | 0},${chroma.b | 0},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(gx, gy, gr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
