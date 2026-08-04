import { BloomPipeline, drawEnergyFlow, drawGlow, drawGlowLine, RenderContext } from './bloom';
import { HandState, HAND_CONNECTIONS, FINGERTIPS } from './handModel';
import { mixRGB, rgbToCss, spectrumLabel, wavelengthToRGB, RGB } from './spectrum';
import { clamp, deg, dist, Vec2 } from './vector';

const WAVELENGTH_MIN = 380;
const WAVELENGTH_MAX = 700;

export class LaserHandMode {
  private currentNm = 530;
  private targetNm = 530;

  // Smoothly animate wavelength toward target.
  private updateWavelength(fingertipDistanceNorm: number) {
    // small distance -> violet/short wavelength; large distance -> red/long
    this.targetNm =
      WAVELENGTH_MIN +
      clamp(fingertipDistanceNorm, 0, 1) * (WAVELENGTH_MAX - WAVELENGTH_MIN);
    this.currentNm += (this.targetNm - this.currentNm) * 0.08;
  }

  getWavelength() {
    return this.currentNm;
  }

  render(
    hands: HandState[],
    rc: RenderContext,
    bloom: BloomPipeline,
  ): RGB {
    const { ctx, width, height, time } = rc;
    const color = wavelengthToRGB(this.currentNm);

    for (const hand of hands) {
      // update wavelength from this hand's pinch spread, normalized by hand size
      const ref = hand.worldScale || 0.1;
      this.updateWavelength(hand.fingertipDistance / (ref * 2.5));
    }

    const toPx = (p: Vec2) => ({ x: p.x * width, y: p.y * height });

    for (const hand of hands) {
      const lm = hand.landmarks.map(toPx);
      const c = wavelengthToRGB(this.currentNm);

      // motion-blur trails: draw a few offset copies fading along velocity
      const vel = hand.speed;
      const blurSteps = clamp(Math.floor(vel * 40), 0, 4);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let s = 1; s <= blurSteps; s++) {
        const off = s * 0.012;
        const ox = -hand.velocity.x * off * width * 0.02;
        const oy = -hand.velocity.y * off * height * 0.02;
        ctx.globalAlpha = 0.18 / s;
        this.drawSkeleton(ctx, lm, c, time, ox, oy, hand);
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // main skeleton
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      this.drawSkeleton(ctx, lm, c, time, 0, 0, hand);
      ctx.restore();
    }

    // dynamic brightness based on stability
    const stabilityAvg =
      hands.length > 0
        ? hands.reduce((a, h) => a + h.stability, 0) / hands.length
        : 0.7;
    const intensity = 0.7 + stabilityAvg * 0.6;
    bloom.applyBloom(ctx, ctx, intensity, 8);

    return color;
  }

  private drawSkeleton(
    ctx: CanvasRenderingContext2D,
    lm: { x: number; y: number }[],
    color: RGB,
    time: number,
    ox: number,
    oy: number,
    hand: HandState,
  ) {
    const ref = hand.worldScale * 800 || 60;

    // beams between connected landmarks
    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = { x: lm[a].x + ox, y: lm[a].y + oy };
      const p2 = { x: lm[b].x + ox, y: lm[b].y + oy };
      const segLen = dist(p1, p2);
      const coreW = clamp(ref * 0.012, 1, 4);
      const glowW = clamp(ref * 0.05, 4, 18);
      drawGlowLine(ctx, p1.x, p1.y, p2.x, p2.y, color, coreW, glowW, 0.95);
      drawEnergyFlow(ctx, p1.x, p1.y, p2.x, p2.y, color, time, 0.6, 3, coreW * 1.4);
      void segLen;
    }

    // crystal energy nodes at each landmark
    for (let i = 0; i < lm.length; i++) {
      const p = { x: lm[i].x + ox, y: lm[i].y + oy };
      const isTip = FINGERTIPS.includes(i);
      const nodeR = isTip ? ref * 0.05 : ref * 0.03;
      // outer crystal glow
      drawGlow(ctx, p.x, p.y, nodeR * 2.2, color, 0.6);
      // bright core
      drawGlow(ctx, p.x, p.y, nodeR * 0.6, { r: 255, g: 255, b: 255 }, 0.9);
      // crystal facets for fingertips
      if (isTip) {
        this.drawCrystalNode(ctx, p.x, p.y, nodeR, color, time + i);
      }
    }
  }

  private drawCrystalNode(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    color: RGB,
    time: number,
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * 0.5);
    ctx.globalCompositeOperation = 'lighter';
    const sides = 6;
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const rr = r * (0.8 + Math.sin(time * 2 + i) * 0.1);
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(255,255,255,0.9)`);
    g.addColorStop(0.5, rgbToCss(color, 0.6));
    g.addColorStop(1, rgbToCss(color, 0));
    ctx.fillStyle = g;
    ctx.fill();
    // edge ring
    ctx.strokeStyle = rgbToCss(color, 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  getMetrics() {
    const nm = this.currentNm;
    const color = wavelengthToRGB(nm);
    return {
      wavelength: nm,
      spectrum: spectrumLabel(nm),
      colorCss: rgbToCss(color),
      color,
    };
  }
}

// mix used externally if needed
export { mixRGB, deg };
