import { drawGlow, drawGlowLine, drawEnergyFlow } from './bloom';
import { drawLightRays, drawVolumetricLight } from './effects';
import { HandState, FINGERTIPS, HAND_CONNECTIONS } from './handModel';
import { RGB } from './spectrum';
import { Vec2, clamp, dist } from './vector';

/**
 * Universal hand power effects applied whenever a power is active:
 *  - glowing energy around fingers
 *  - flowing energy between fingertips
 *  - small sparks
 *  - light rays
 *  - dynamic glow around palm
 *  - natural light illumination on the hand
 */

interface HandSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

export class HandEffects {
  private sparks: HandSpark[] = [];

  update(dt: number) {
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 0.3 * dt;
      s.life -= dt;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
  }

  private emitSparks(x: number, y: number, count: number, scale: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (30 + Math.random() * 90) * scale;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 20,
        life: 0.3 + Math.random() * 0.4,
        maxLife: 0.7,
      });
    }
  }

  /**
   * Render full hand power effects.
   * @param toPx function converting normalized Vec2 to canvas pixels
   */
  render(
    hand: HandState,
    color: RGB,
    time: number,
    width: number,
    height: number,
    ctx: CanvasRenderingContext2D,
    toPx: (p: Vec2) => { x: number; y: number },
    intensity = 1,
  ) {
    const lm = hand.landmarks.map(toPx);
    const palm = toPx(hand.palmCenter);
    const minDim = Math.min(width, height);
    const handSpan = Math.max(dist(lm[0], lm[12]), minDim * 0.18);
    const i = clamp(intensity, 0, 1);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 1. Glowing energy around each finger segment
    for (const [a, b] of HAND_CONNECTIONS) {
      drawGlowLine(ctx, lm[a].x, lm[a].y, lm[b].x, lm[b].y, color, 2, 14, 0.5 * i);
    }

    // 2. Flowing energy between fingertips (pentagram-style links)
    for (let fi = 0; fi < FINGERTIPS.length; fi++) {
      const tipA = lm[FINGERTIPS[fi]];
      const tipB = lm[FINGERTIPS[(fi + 2) % FINGERTIPS.length]];
      drawEnergyFlow(ctx, tipA.x, tipA.y, tipB.x, tipB.y, color, time, 0.5, 2, 3);
    }

    // 3. Finger-tip glow orbs
    for (const tip of FINGERTIPS) {
      const p = lm[tip];
      drawGlow(ctx, p.x, p.y, handSpan * 0.06 * i, color, 0.7 * i);
      drawGlow(ctx, p.x, p.y, handSpan * 0.02 * i, { r: 255, g: 255, b: 255 }, 0.9 * i);
    }

    // 4. Small sparks emanating from fingertips
    if (Math.random() < 0.3 * i) {
      const tip = FINGERTIPS[Math.floor(Math.random() * FINGERTIPS.length)];
      const p = lm[tip];
      this.emitSparks(p.x, p.y, 1, handSpan / 200);
    }

    // 5. Light rays from palm
    drawLightRays(ctx, palm.x, palm.y, handSpan * 1.5, color, 0.3 * i, time, 6);

    // 6. Dynamic glow around palm
    drawVolumetricLight(ctx, palm.x, palm.y, handSpan * 0.8, color, 0.4 * i, time);
    drawGlow(ctx, palm.x, palm.y, handSpan * 0.15, { r: 255, g: 255, b: 255 }, 0.5 * i);

    ctx.restore();
  }

  /** Render accumulated sparks (call after all hands drawn). */
  renderSparks(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      const t = s.life / s.maxLife;
      drawGlow(ctx, s.x, s.y, 4 * t + 1, { r: 255, g: 240, b: 200 }, t * 0.8);
    }
    ctx.restore();
  }
}
