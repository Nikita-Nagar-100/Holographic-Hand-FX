import { BloomPipeline, drawGlow, drawGlowLine, RenderContext } from './bloom';
import { HandState } from './handModel';
import { clamp, dist, Vec2 } from './vector';

const WEB_COLOR = { r: 220, g: 235, b: 255 };
const WEB_GLOW = { r: 140, g: 190, b: 255 };

interface WebStrand {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  segments: number;
  stretch: number;
  wob: number;
}

interface WebParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

export class SpiderManMode {
  private webs: WebStrand[] = [];
  private particles: WebParticle[] = [];
  private prevShoot = false;
  private cooldown = 0;
  private trail: { x: number; y: number; life: number }[] = [];

  update(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    for (const w of this.webs) {
      w.x += w.vx * dt;
      w.y += w.vy * dt;
      w.vy += 60 * dt; // gravity
      w.stretch = clamp(w.stretch + dt * 3, 1, 4);
      w.life -= dt;
    }
    this.webs = this.webs.filter((w) => w.life > 0);

    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 80 * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const t of this.trail) t.life -= dt;
    this.trail = this.trail.filter((t) => t.life > 0);
  }

  private fireWeb(x: number, y: number, dirAngle: number, speed: number) {
    this.webs.push({
      x,
      y,
      vx: Math.cos(dirAngle) * speed,
      vy: Math.sin(dirAngle) * speed,
      life: 1.2,
      maxLife: 1.2,
      segments: 8,
      stretch: 1,
      wob: Math.random() * Math.PI * 2,
    });
    // muzzle particles
    for (let i = 0; i < 6; i++) {
      const a = dirAngle + (Math.random() - 0.5) * 0.6;
      const sp = 50 + Math.random() * 80;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.3 + Math.random() * 0.3,
        maxLife: 0.6,
      });
    }
  }

  private emitImpact(x: number, y: number) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 100;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 20,
        life: 0.4 + Math.random() * 0.4,
        maxLife: 0.8,
      });
    }
  }

  render(
    hands: HandState[],
    rc: RenderContext,
    bloom: BloomPipeline,
  ): void {
    const { ctx, width, height, time } = rc;
    const toPx = (p: Vec2) => ({ x: p.x * width, y: p.y * height });
    const minDim = Math.min(width, height);

    for (const hand of hands) {
      const palm = toPx(hand.palmCenter);
      const wrist = toPx(hand.landmarks[0]);
      const handSpan = Math.max(
        dist(toPx(hand.landmarks[0]), toPx(hand.landmarks[12])),
        minDim * 0.18,
      );
      const ref = handSpan * 2.0;

      // wrist glow
      drawGlow(ctx, wrist.x, wrist.y, ref * 0.15, WEB_GLOW, 0.4);
      drawGlow(ctx, wrist.x, wrist.y, ref * 0.06, WEB_COLOR, 0.8);
      // subtle palm glow
      drawGlow(ctx, palm.x, palm.y, ref * 0.1, WEB_GLOW, 0.2);

      // web-shooter gesture: "shoot" (index+thumb out, others closed) OR "point"
      const isShoot = hand.gesture === 'shoot' || hand.gesture === 'point';

      // detect flick: high speed + shoot gesture
      const flickSpeed = hand.speed;
      const dirAngle = hand.palmRotation - Math.PI / 2;
      // blend palm normal with velocity direction for natural aim
      const aimAngle = flickSpeed > 0.5
        ? Math.atan2(hand.velocity.y, hand.velocity.x)
        : dirAngle;

      if (isShoot && !this.prevShoot && this.cooldown <= 0) {
        const speed = 600 + clamp(flickSpeed * 200, 0, 400);
        this.fireWeb(wrist.x, wrist.y, aimAngle, speed);
        this.cooldown = 0.2;
      }
      this.prevShoot = isShoot;

      // charge glow when aiming
      if (isShoot) {
        drawGlow(ctx, wrist.x, wrist.y, ref * 0.3, WEB_GLOW, 0.3 + Math.sin(time * 10) * 0.1);
      }

      // hand trail based on movement speed
      this.trail.push({ x: wrist.x, y: wrist.y, life: 0.4 });
      if (this.trail.length > 20) this.trail.shift();
    }

    // draw motion trail (web swing residue)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i < this.trail.length; i++) {
      const p0 = this.trail[i - 1];
      const p1 = this.trail[i];
      const t = p1.life / 0.4;
      drawGlowLine(ctx, p0.x, p0.y, p1.x, p1.y, WEB_GLOW, 1, 6, t * 0.3);
    }
    ctx.restore();

    // draw web strands with stretching + wobble
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const w of this.webs) {
      const t = w.life / w.maxLife;
      // web strand: segmented wavy line from origin to current pos
      const ox = w.x - w.vx * 0.15;
      const oy = w.y - w.vy * 0.15;
      ctx.beginPath();
      for (let s = 0; s <= w.segments; s++) {
        const f = s / w.segments;
        const px = ox + (w.x - ox) * f;
        const py = oy + (w.y - oy) * f;
        // perpendicular wobble
        const dx = w.x - ox;
        const dy = w.y - oy;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const wob = Math.sin(w.wob + f * Math.PI * 3 + time * 8) * 3 * (1 - f) * t;
        const fx = px + nx * wob;
        const fy = py + ny * wob;
        if (s === 0) ctx.moveTo(fx, fy);
        else ctx.lineTo(fx, fy);
      }
      // glow layers
      ctx.strokeStyle = `rgba(${WEB_GLOW.r},${WEB_GLOW.g},${WEB_GLOW.b},${t * 0.3})`;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.strokeStyle = `rgba(${WEB_COLOR.r},${WEB_COLOR.g},${WEB_COLOR.b},${t * 0.8})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${t * 0.9})`;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // web head
      drawGlow(ctx, w.x, w.y, 8 * t, WEB_COLOR, t);
      drawGlow(ctx, w.x, w.y, 3 * t, { r: 255, g: 255, b: 255 }, t);

      // impact when web is fading (hit something)
      if (w.life < 0.3 && w.life > 0.28) {
        this.emitImpact(w.x, w.y);
      }
    }
    ctx.restore();

    // impact splat
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const w of this.webs) {
      if (w.life < 0.3) {
        const t = w.life / 0.3;
        // radial splat pattern
        const splatR = (1 - t) * 30;
        for (let r = 0; r < 6; r++) {
          const a = (r / 6) * Math.PI * 2;
          drawGlowLine(
            ctx,
            w.x,
            w.y,
            w.x + Math.cos(a) * splatR,
            w.y + Math.sin(a) * splatR,
            WEB_COLOR,
            1,
            4,
            t * 0.5,
          );
        }
        drawGlow(ctx, w.x, w.y, splatR, WEB_GLOW, t * 0.3);
      }
    }
    ctx.restore();

    // particles
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const t = p.life / p.maxLife;
      drawGlow(ctx, p.x, p.y, 3 * t + 1, WEB_COLOR, t * 0.7);
    }
    ctx.restore();

    bloom.applyBloom(ctx, ctx, 0.6, 8);
  }
}
