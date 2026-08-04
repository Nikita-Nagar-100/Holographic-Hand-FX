import { BloomPipeline, drawGlow, drawGlowLine, RenderContext } from './bloom';
import { drawLightRays, drawVolumetricLight } from './effects';
import { HandState } from './handModel';
import { clamp, dist, Vec2 } from './vector';

const LIGHTNING = { r: 120, g: 170, b: 255 };
const LIGHTNING_HOT = { r: 200, g: 220, b: 255 };
const LIGHTNING_WHITE = { r: 240, g: 245, b: 255 };

interface Bolt {
  x: number;
  y: number;
  angle: number;
  life: number;
  maxLife: number;
  intensity: number;
  points: { x: number; y: number }[];
}

interface Arc {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  points: { x: number; y: number }[];
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

interface Strike {
  x: number;
  y: number;
  angle: number;
  life: number;
  maxLife: number;
  intensity: number;
  points: { x: number; y: number }[];
}

// Generate a jagged lightning polyline from (x0,y0) to (x1,y1)
function generateBolt(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  displacement: number,
  branches: number,
): { x: number; y: number }[] {
  let pts: { x: number; y: number }[] = [{ x: x0, y: y0 }, { x: x1, y: y1 }];
  for (let iter = 0; iter < 4; iter++) {
    const next: { x: number; y: number }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const mx = (p0.x + p1.x) / 2 + (Math.random() - 0.5) * displacement;
      const my = (p0.y + p1.y) / 2 + (Math.random() - 0.5) * displacement;
      next.push(p0, { x: mx, y: my });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
    displacement *= 0.55;
  }
  void branches;
  return pts;
}

export class ThorMode {
  private bolts: Bolt[] = [];
  private arcs: Arc[] = [];
  private sparks: Spark[] = [];
  private strikes: Strike[] = [];
  private trails: { x: number; y: number; life: number; maxLife: number }[] = [];
  private prevFist = false;
  private prevPunch = false;
  private cooldown = 0;
  private energy = 0;

  update(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    for (const b of this.bolts) b.life -= dt;
    this.bolts = this.bolts.filter((b) => b.life > 0);

    for (const a of this.arcs) a.life -= dt;
    this.arcs = this.arcs.filter((a) => a.life > 0);

    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 0.3 * dt;
      s.life -= dt;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);

    for (const st of this.strikes) st.life -= dt;
    this.strikes = this.strikes.filter((st) => st.life > 0);

    for (const t of this.trails) t.life -= dt;
    this.trails = this.trails.filter((t) => t.life > 0);

    this.energy = clamp(this.energy - dt * 0.5, 0, 1);
  }

  private emitSparks(x: number, y: number, count: number, scale: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (50 + Math.random() * 150) * scale;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.3 + Math.random() * 0.4,
        maxLife: 0.7,
      });
    }
  }

  private addArc(x: number, y: number, radius: number) {
    const pts: { x: number; y: number }[] = [];
    const segs = 8;
    let px = x;
    let py = y;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2 + Math.random() * 0.3;
      const r = radius * (0.6 + Math.random() * 0.5);
      const nx = x + Math.cos(a) * r;
      const ny = y + Math.sin(a) * r;
      pts.push({ x: nx, y: ny });
      if (i > 0) {
        // jagged segment
        const mx = (px + nx) / 2 + (Math.random() - 0.5) * radius * 0.3;
        const my = (py + ny) / 2 + (Math.random() - 0.5) * radius * 0.3;
        pts.splice(pts.length - 1, 0, { x: mx, y: my });
      }
      px = nx;
      py = ny;
    }
    this.arcs.push({ x, y, life: 0.15, maxLife: 0.15, points: pts });
  }

  private fireStrike(x: number, y: number, angle: number, intensity: number) {
    const len = 600 * intensity;
    const ex = x + Math.cos(angle) * len;
    const ey = y + Math.sin(angle) * len;
    const pts = generateBolt(x, y, ex, ey, 40, 0);
    this.strikes.push({
      x,
      y,
      angle,
      life: 0.3,
      maxLife: 0.3,
      intensity,
      points: pts,
    });
    this.emitSparks(x, y, 15, intensity);
    this.emitSparks(ex, ey, 10, intensity);
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
      const handSpan = Math.max(
        dist(toPx(hand.landmarks[0]), toPx(hand.landmarks[12])),
        minDim * 0.18,
      );
      const ref = handSpan * 2.0;
      const speed = hand.speed;
      const gesture = hand.gesture;

      // energy builds with movement speed
      this.energy = clamp(this.energy + speed * 0.3, 0, 1);

      // ambient electric arcs around hand — intensity scales with speed
      const arcIntensity = 0.3 + this.energy * 0.5 + speed * 0.2;
      if (Math.random() < 0.3 + speed * 0.5) {
        this.addArc(palm.x, palm.y, ref * 0.3 * (0.5 + arcIntensity));
      }

      // lightning trails on fast movement
      if (speed > 0.3) {
        this.trails.push({ x: palm.x, y: palm.y, life: 0.3, maxLife: 0.3 });
        if (this.trails.length > 30) this.trails.shift();
      }

      // short bolts between fingers when energy high
      if (this.energy > 0.3 && Math.random() < 0.4) {
        const tips = [4, 8, 12, 16, 20];
        const a = tips[Math.floor(Math.random() * tips.length)];
        const b = tips[Math.floor(Math.random() * tips.length)];
        if (a !== b) {
          const pa = toPx(hand.landmarks[a]);
          const pb = toPx(hand.landmarks[b]);
          this.bolts.push({
            x: pa.x,
            y: pa.y,
            angle: 0,
            life: 0.1,
            maxLife: 0.1,
            intensity: this.energy,
            points: generateBolt(pa.x, pa.y, pb.x, pb.y, 10, 0),
          });
        }
      }

      // punch/push detection: fist opening rapidly OR open hand with high forward speed
      const isFist = gesture === 'fist';
      const isPunch = (gesture === 'open' || gesture === 'point') && speed > 1.5;

      // strike on fist release (punch)
      if (isFist && !this.prevFist) {
        // charging
      }
      if (!isFist && this.prevFist && this.cooldown <= 0) {
        const dir = Math.atan2(hand.velocity.y, hand.velocity.x);
        this.fireStrike(palm.x, palm.y, dir, 0.6 + this.energy * 0.4);
        this.cooldown = 0.4;
        this.energy = 0;
      }
      // strike on fast open-hand push
      if (isPunch && !this.prevPunch && this.cooldown <= 0) {
        const dir = Math.atan2(hand.velocity.y, hand.velocity.x);
        this.fireStrike(palm.x, palm.y, dir, 0.5 + speed * 0.2);
        this.cooldown = 0.3;
      }
      this.prevFist = isFist;
      this.prevPunch = isPunch;

      // glow around hand
      drawGlow(ctx, palm.x, palm.y, ref * 0.4 * (0.5 + this.energy * 0.5), LIGHTNING, 0.3 + this.energy * 0.3);
      drawGlow(ctx, palm.x, palm.y, ref * 0.15, LIGHTNING_WHITE, 0.5 + this.energy * 0.3);

      // volumetric lighting
      drawVolumetricLight(ctx, palm.x, palm.y, ref * 1.0, LIGHTNING, 0.2 + this.energy * 0.2, time);

      // light rays on high energy
      if (this.energy > 0.4) {
        drawLightRays(ctx, palm.x, palm.y, ref * 0.7, LIGHTNING_HOT, this.energy * 0.3, time, 5);
      }
    }

    // lightning trails (movement residue)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i < this.trails.length; i++) {
      const p0 = this.trails[i - 1];
      const p1 = this.trails[i];
      const t = p1.life / p1.maxLife;
      drawGlowLine(ctx, p0.x, p0.y, p1.x, p1.y, LIGHTNING, 1, 8, t * 0.4);
      // jagged offset bolt
      if (Math.random() < 0.3) {
        const mx = (p0.x + p1.x) / 2 + (Math.random() - 0.5) * 15;
        const my = (p0.y + p1.y) / 2 + (Math.random() - 0.5) * 15;
        drawGlowLine(ctx, p0.x, p0.y, mx, my, LIGHTNING_HOT, 0.5, 4, t * 0.3);
        drawGlowLine(ctx, mx, my, p1.x, p1.y, LIGHTNING_HOT, 0.5, 4, t * 0.3);
      }
    }
    ctx.restore();

    // electric arcs around hands
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const arc of this.arcs) {
      const t = arc.life / arc.maxLife;
      ctx.beginPath();
      for (let i = 0; i < arc.points.length; i++) {
        if (i === 0) ctx.moveTo(arc.points[i].x, arc.points[i].y);
        else ctx.lineTo(arc.points[i].x, arc.points[i].y);
      }
      ctx.strokeStyle = `rgba(${LIGHTNING_HOT.r},${LIGHTNING_HOT.g},${LIGHTNING_HOT.b},${t * 0.6})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${t * 0.9})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.restore();

    // finger bolts arcs
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.bolts) {
      const t = b.life / b.maxLife;
      ctx.beginPath();
      for (let i = 0; i < b.points.length; i++) {
        if (i === 0) ctx.moveTo(b.points[i].x, b.points[i].y);
        else ctx.lineTo(b.points[i].x, b.points[i].y);
      }
      ctx.strokeStyle = `rgba(${LIGHTNING.r},${LIGHTNING.g},${LIGHTNING.b},${t * 0.5})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${t * 0.9})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();

    // lightning strikes (big bolts)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const st of this.strikes) {
      const t = st.life / st.maxLife;
      ctx.beginPath();
      for (let i = 0; i < st.points.length; i++) {
        if (i === 0) ctx.moveTo(st.points[i].x, st.points[i].y);
        else ctx.lineTo(st.points[i].x, st.points[i].y);
      }
      // outer glow
      ctx.strokeStyle = `rgba(${LIGHTNING.r},${LIGHTNING.g},${LIGHTNING.b},${t * 0.4})`;
      ctx.lineWidth = 12 * st.intensity;
      ctx.stroke();
      ctx.strokeStyle = `rgba(${LIGHTNING_HOT.r},${LIGHTNING_HOT.g},${LIGHTNING_HOT.b},${t * 0.7})`;
      ctx.lineWidth = 5 * st.intensity;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${t * 0.95})`;
      ctx.lineWidth = 2 * st.intensity;
      ctx.stroke();
      // impact flash at origin
      drawGlow(ctx, st.x, st.y, 40 * t * st.intensity, LIGHTNING_WHITE, t * 0.8);
      drawGlow(ctx, st.x, st.y, 20 * t * st.intensity, { r: 255, g: 255, b: 255 }, t);
    }
    ctx.restore();

    // sparks
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      const t = s.life / s.maxLife;
      drawGlow(ctx, s.x, s.y, 4 * t + 1, LIGHTNING_HOT, t * 0.8);
    }
    ctx.restore();

    bloom.applyBloom(ctx, ctx, 0.7, 8);
  }
}
