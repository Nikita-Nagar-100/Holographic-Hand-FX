import { RGB } from './spectrum';

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  time: number;
  dpr: number;
}

// Offscreen canvases for multi-pass bloom.
export class BloomPipeline {
  private bright: HTMLCanvasElement;
  private brightCtx: CanvasRenderingContext2D;
  private blurA: HTMLCanvasElement;
  private blurACtx: CanvasRenderingContext2D;
  private blurB: HTMLCanvasElement;
  private blurBCtx: CanvasRenderingContext2D;
  private scale: number;

  constructor(width: number, height: number, scale = 0.5) {
    this.scale = scale;
    const bw = Math.max(1, Math.floor(width * scale));
    const bh = Math.max(1, Math.floor(height * scale));
    this.bright = document.createElement('canvas');
    this.bright.width = bw;
    this.bright.height = bh;
    this.brightCtx = this.bright.getContext('2d')!;
    this.blurA = document.createElement('canvas');
    this.blurA.width = bw;
    this.blurA.height = bh;
    this.blurACtx = this.blurA.getContext('2d')!;
    this.blurB = document.createElement('canvas');
    this.blurB.width = bw;
    this.blurB.height = bh;
    this.blurBCtx = this.blurB.getContext('2d')!;
  }

  resize(width: number, height: number) {
    const bw = Math.max(1, Math.floor(width * this.scale));
    const bh = Math.max(1, Math.floor(height * this.scale));
    if (this.bright.width !== bw || this.bright.height !== bh) {
      this.bright.width = bw;
      this.bright.height = bh;
      this.blurA.width = bw;
      this.blurA.height = bh;
      this.blurB.width = bw;
      this.blurB.height = bh;
    }
  }

  // Bright-pass: keep only luminance above threshold, amplify.
  private brightPass(src: CanvasRenderingContext2D) {
    const w = this.bright.width;
    const h = this.bright.height;
    this.brightCtx.globalCompositeOperation = 'source-over';
    this.brightCtx.clearRect(0, 0, w, h);
    this.brightCtx.filter = 'brightness(1.4) contrast(1.15) saturate(1.1)';
    this.brightCtx.drawImage(src.canvas, 0, 0, w, h);
    this.brightCtx.filter = 'none';
    // subtract a dark base so only bright areas remain
    this.brightCtx.globalCompositeOperation = 'destination-out';
    this.brightCtx.fillStyle = 'rgba(0,0,0,0.55)';
    this.brightCtx.fillRect(0, 0, w, h);
    this.brightCtx.globalCompositeOperation = 'source-over';
  }

  // Separable Gaussian-ish blur via downsample + canvas filter blur.
  private blurPass(src: CanvasRenderingContext2D, radius: number) {
    const w = this.blurA.width;
    const h = this.blurA.height;
    // horizontal
    this.blurACtx.clearRect(0, 0, w, h);
    this.blurACtx.filter = `blur(${radius}px)`;
    this.blurACtx.drawImage(src.canvas, 0, 0);
    // vertical (re-blur for wider spread)
    this.blurBCtx.clearRect(0, 0, w, h);
    this.blurBCtx.filter = `blur(${radius * 1.6}px)`;
    this.blurBCtx.drawImage(this.blurA, 0, 0);
    this.blurACtx.filter = 'none';
    this.blurBCtx.filter = 'none';
  }

  // Composite bloom over destination with additive blending.
  applyBloom(
    dest: CanvasRenderingContext2D,
    src: CanvasRenderingContext2D,
    intensity = 1.0,
    radius = 6,
  ) {
    this.brightPass(src);
    this.blurPass(this.brightCtx, radius);

    dest.save();
    dest.globalCompositeOperation = 'lighter';
    dest.globalAlpha = Math.max(0, intensity);
    // upscale bloom back to full res
    const sw = dest.canvas.width;
    const sh = dest.canvas.height;
    dest.drawImage(this.blurB, 0, 0, sw, sh);
    dest.globalAlpha = 1;
    dest.restore();
  }

  getBlurCanvas() {
    return this.blurB;
  }
}

// Helper: draw a radial glow blob (soft particle) with additive blending.
export function drawGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: RGB,
  intensity = 1,
) {
  const r = Math.max(0.5, radius);
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
  const a = Math.max(0, Math.min(1, intensity));
  grad.addColorStop(0, `rgba(${color.r | 0},${color.g | 0},${color.b | 0},${a})`);
  grad.addColorStop(0.4, `rgba(${color.r | 0},${color.g | 0},${color.b | 0},${a * 0.5})`);
  grad.addColorStop(1, `rgba(${color.r | 0},${color.g | 0},${color.b | 0},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Soft additive line with glow halo.
export function drawGlowLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: RGB,
  coreWidth: number,
  glowWidth: number,
  intensity = 1,
) {
  const a = Math.max(0, Math.min(1, intensity));
  // outer glow
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(${color.r | 0},${color.g | 0},${color.b | 0},${a * 0.25})`;
  ctx.lineWidth = Math.max(0.5, glowWidth);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  // mid glow
  ctx.strokeStyle = `rgba(${color.r | 0},${color.g | 0},${color.b | 0},${a * 0.55})`;
  ctx.lineWidth = Math.max(0.5, glowWidth * 0.5);
  ctx.stroke();
  // bright core
  ctx.strokeStyle = `rgba(255,255,255,${a * 0.85})`;
  ctx.lineWidth = Math.max(0.4, coreWidth);
  ctx.stroke();
  ctx.restore();
}

// Animated energy flow dots along a segment.
export function drawEnergyFlow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: RGB,
  time: number,
  speed: number,
  count: number,
  size: number,
) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  for (let i = 0; i < count; i++) {
    const t = ((time * speed + i / count) % 1);
    const px = x1 + dx * t;
    const py = y1 + dy * t;
    const fade = Math.sin(t * Math.PI); // brightest in middle
    drawGlow(ctx, px, py, size * (0.6 + fade * 0.6), color, 0.9 * fade);
  }
  ctx.restore();
  void len;
}
