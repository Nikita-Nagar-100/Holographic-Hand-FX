import { BloomPipeline, drawGlow, drawGlowLine, RenderContext } from './bloom';
import { drawLensFlare, drawLightRays, drawVolumetricLight } from './effects';
import { HandState } from './handModel';
import { clamp, dist, Vec2 } from './vector';

const PLASMA = { r: 120, g: 180, b: 255 };
const PLASMA_CORE = { r: 220, g: 240, b: 255 };

interface Beam {
  handId: number;
  x: number;
  y: number;
  angle: number;
  life: number;
  maxLife: number;
  intensity: number;
}

export class IronManMode {
  private charge = 0;
  private beams: Beam[] = [];
  private shootCooldown = 0;
  private wasFist = false;
  private ringAngle = 0;
  private shake = 0;
  private sparks: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number }[] = [];
  private smoke: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number }[] = [];

  update(dt: number) {
    this.ringAngle += dt * (1 + this.charge * 6);
    this.shake = Math.max(0, this.shake - dt * 3);
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);

    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);

    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 0.5 * dt;
      s.life -= dt;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);

    for (const sm of this.smoke) {
      sm.x += sm.vx * dt;
      sm.y += sm.vy * dt;
      sm.vx *= 0.96;
      sm.vy *= 0.96;
      sm.life -= dt;
      sm.size += dt * 20;
    }
    this.smoke = this.smoke.filter((s) => s.life > 0);
  }

  private emitSparks(x: number, y: number, count: number, scale: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (60 + Math.random() * 140) * scale;
      this.sparks.push({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 0.3 + Math.random() * 0.4,
        maxLife: 0.7,
      });
    }
  }

  private emitSmoke(x: number, y: number, count: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.push({
        x, y,
        vx: Math.cos(a) * 30,
        vy: Math.sin(a) * 30 - 20,
        life: 0.8 + Math.random() * 0.8,
        maxLife: 1.6,
        size: 8 + Math.random() * 12,
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

    let anyCharging = false;

    for (const hand of hands) {
      const palm = toPx(hand.palmCenter);
      const handSpan = Math.max(
        dist(toPx(hand.landmarks[0]), toPx(hand.landmarks[12])),
        minDim * 0.18,
      );
      const ref = handSpan * 2.0;
      const gesture = hand.gesture;

      if (gesture === 'fist') {
        this.charge = clamp(this.charge + 0.025, 0, 1);
        anyCharging = true;
        this.wasFist = true;
      } else {
        // open palm charges continuously (brighter over time)
        if (gesture === 'open') {
          this.charge = clamp(this.charge + 0.02, 0, 1);
        } else {
          this.charge = clamp(this.charge - 0.015, 0, 1);
        }
        // fire on thrust-forward: high speed while open/shoot after charging
        if (
          this.wasFist && this.shootCooldown <= 0 && (gesture === 'shoot' || gesture === 'open')
        ) {
          this.fireBeam(hand, palm, ref);
          this.shootCooldown = 0.35;
          this.shake = 1;
          this.emitSparks(palm.x, palm.y, 12, ref / 100);
          this.emitSmoke(palm.x, palm.y, 5);
        }
        // thrust-forward fire: open hand with high speed and charged
        if (
          gesture === 'open' && hand.speed > 1.0 && this.charge > 0.3 && this.shootCooldown <= 0
        ) {
          this.fireBeam(hand, palm, ref);
          this.shootCooldown = 0.3;
          this.shake = 1.2;
          this.emitSparks(palm.x, palm.y, 16, ref / 100);
          this.emitSmoke(palm.x, palm.y, 6);
        }
        this.wasFist = false;
      }

      if (gesture === 'open' || gesture === 'shoot' || this.charge > 0.05) {
        this.drawReactor(ctx, palm.x, palm.y, ref, time, this.charge);

        // volumetric lighting
        drawVolumetricLight(ctx, palm.x, palm.y, ref * 1.5, PLASMA, 0.3 + this.charge * 0.2, time);

        // light rays when charging
        if (this.charge > 0.1) {
          drawLightRays(ctx, palm.x, palm.y, ref * 0.9, PLASMA_CORE, this.charge * 0.4, time, 6);
        }

        // lens flare at reactor
        drawLensFlare(ctx, palm.x, palm.y, 0.3 + this.charge * 0.4, PLASMA, time);
      }
    }

    void anyCharging;

    // beams
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const beam of this.beams) {
      this.drawBeam(ctx, beam, width, height, time);
    }
    ctx.restore();

    // smoke particles
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const sm of this.smoke) {
      const t = sm.life / sm.maxLife;
      drawGlow(ctx, sm.x, sm.y, sm.size, { r: 80, g: 90, b: 110 }, t * 0.12);
    }
    ctx.restore();

    // sparks
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      const t = s.life / s.maxLife;
      drawGlow(ctx, s.x, s.y, 4 * t + 1, { r: 220, g: 230, b: 255 }, t * 0.8);
    }
    ctx.restore();

    // camera shake via bloom offset
    const sx = (Math.random() - 0.5) * this.shake * 12;
    const sy = (Math.random() - 0.5) * this.shake * 12;
    ctx.save();
    ctx.translate(sx, sy);
    bloom.applyBloom(ctx, ctx, 0.7, 8);
    ctx.restore();
  }

  private fireBeam(hand: HandState, palm: { x: number; y: number }, ref: number) {
    // beam fires in the direction of palm thrust — blend palm normal with velocity
    const palmDir = hand.palmRotation - Math.PI / 2;
    const velDir = Math.atan2(hand.velocity.y, hand.velocity.x);
    const dir = hand.speed > 0.5 ? velDir : palmDir;
    const intensity = 0.6 + this.charge * 0.4;
    this.beams.push({
      handId: hand.id,
      x: palm.x,
      y: palm.y,
      angle: dir,
      life: 0.6,
      maxLife: 0.6,
      intensity,
    });
    this.charge = 0;
    void ref;
  }

  private drawReactor(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    ref: number,
    time: number,
    charge: number,
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = 'lighter';

    const baseR = ref * 0.32;
    const glow = 0.6 + charge * 0.4;

    // outer heat haze glow
    drawGlow(ctx, 0, 0, baseR * 2.4, PLASMA, 0.3 + charge * 0.3);
    drawGlow(ctx, 0, 0, baseR * 1.6, PLASMA, 0.4 + charge * 0.3);

    // dynamic reflections — metallic arcs that simulate light reflecting off metal
    for (let i = 0; i < 3; i++) {
      const a = this.ringAngle * 0.5 + (i / 3) * Math.PI * 2;
      const arcLen = 0.3 + charge * 0.2;
      ctx.beginPath();
      ctx.arc(0, 0, baseR * 1.1, a, a + arcLen);
      ctx.strokeStyle = `rgba(255,255,255,${0.2 + charge * 0.3})`;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // concentric mechanical rings
    const rings = 4; // added one more ring for detail
    for (let r = 0; r < rings; r++) {
      const radius = baseR * (0.55 + r * 0.18);
      const segCount = 18 + r * 6;
      const rot = this.ringAngle * (r % 2 === 0 ? 1 : -1) * (1 + charge * 2);
      ctx.save();
      ctx.rotate(rot);
      for (let s = 0; s < segCount; s++) {
        const a0 = (s / segCount) * Math.PI * 2;
        const a1 = a0 + (Math.PI * 2) / segCount * 0.6;
        const lit = (Math.sin(time * 4 + s * 0.7 + r) + 1) * 0.5;
        ctx.beginPath();
        ctx.arc(0, 0, radius, a0, a1);
        ctx.strokeStyle = `rgba(${PLASMA.r},${PLASMA.g},${PLASMA.b},${0.3 + lit * 0.5 * glow})`;
        ctx.lineWidth = Math.max(1, baseR * 0.04);
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${PLASMA_CORE.r},${PLASMA_CORE.g},${PLASMA_CORE.b},${0.15 + charge * 0.2})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    // energy coils (spiral)
    ctx.save();
    ctx.rotate(this.ringAngle * 2);
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 8; a += 0.2) {
      const rr = (a / (Math.PI * 8)) * baseR * 0.5;
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = `rgba(${PLASMA_CORE.r},${PLASMA_CORE.g},${PLASMA_CORE.b},${0.4 + charge * 0.4})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // animated light segments — radial spokes
    const spokes = 8;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2 + this.ringAngle * 0.5;
      const lit = (Math.sin(time * 5 + i) + 1) * 0.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * baseR * 0.15, Math.sin(a) * baseR * 0.15);
      ctx.lineTo(Math.cos(a) * baseR * 0.5, Math.sin(a) * baseR * 0.5);
      ctx.strokeStyle = `rgba(${PLASMA_CORE.r},${PLASMA_CORE.g},${PLASMA_CORE.b},${(0.2 + lit * 0.4) * glow})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // plasma core
    const coreR = baseR * (0.28 + charge * 0.15);
    drawGlow(ctx, 0, 0, coreR * 1.4, PLASMA_CORE, 0.9);
    drawGlow(ctx, 0, 0, coreR * 0.7, { r: 255, g: 255, b: 255 }, 1);

    // electric sparks
    if (charge > 0.2 || Math.random() < 0.3) {
      const sparks = 4 + Math.floor(charge * 6);
      for (let i = 0; i < sparks; i++) {
        const a = Math.random() * Math.PI * 2;
        const r1 = baseR * (0.3 + Math.random() * 0.3);
        const r2 = r1 + (Math.random() - 0.5) * baseR * 0.5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        const mid = (r1 + r2) / 2;
        ctx.lineTo(
          Math.cos(a) * mid + (Math.random() - 0.5) * 8,
          Math.sin(a) * mid + (Math.random() - 0.5) * 8,
        );
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.strokeStyle = `rgba(255,255,255,${0.4 + charge * 0.4})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private drawBeam(
    ctx: CanvasRenderingContext2D,
    beam: Beam,
    width: number,
    height: number,
    time: number,
  ) {
    const len = Math.hypot(width, height);
    const ex = beam.x + Math.cos(beam.angle) * len;
    const ey = beam.y + Math.sin(beam.angle) * len;
    const lifeT = beam.life / beam.maxLife;
    const intensity = beam.intensity * lifeT;

    // smoke trail (soft particles trailing behind origin)
    for (let i = 0; i < 6; i++) {
      const t = i / 6;
      const sx = beam.x + Math.cos(beam.angle) * len * t * 0.15;
      const sy = beam.y + Math.sin(beam.angle) * len * t * 0.15;
      drawGlow(ctx, sx, sy, 30 + i * 6, { r: 90, g: 90, b: 100 }, 0.1 * intensity);
    }

    // volumetric beam layers — scaled to screen
    const beamScale = Math.min(width, height) * 0.06;
    drawGlowLine(ctx, beam.x, beam.y, ex, ey, PLASMA, beamScale * 0.5, beamScale * 2, intensity * 0.5);
    drawGlowLine(ctx, beam.x, beam.y, ex, ey, PLASMA_CORE, beamScale * 0.25, beamScale, intensity * 0.8);
    drawGlowLine(ctx, beam.x, beam.y, ex, ey, { r: 255, g: 255, b: 255 }, beamScale * 0.1, beamScale * 0.3, intensity);

    // energy particles flowing along beam
    const flowCount = 12;
    for (let i = 0; i < flowCount; i++) {
      const t = ((i / flowCount) + time * 0.8) % 1;
      const px = beam.x + (ex - beam.x) * t;
      const py = beam.y + (ey - beam.y) * t;
      drawGlow(ctx, px, py, 4 * intensity, PLASMA_CORE, 0.6 * intensity);
    }

    // electric arcs along beam
    const arcCount = 8;
    for (let i = 0; i < arcCount; i++) {
      const t = (i / arcCount + time * 0.5) % 1;
      const px = beam.x + (ex - beam.x) * t;
      const py = beam.y + (ey - beam.y) * t;
      const off = (Math.random() - 0.5) * 20 * intensity;
      const nx = -Math.sin(beam.angle) * off;
      const ny = Math.cos(beam.angle) * off;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + nx, py + ny);
      ctx.strokeStyle = `rgba(200,220,255,${0.6 * intensity})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // impact flash at muzzle
    const flashScale = Math.min(width, height) * 0.12;
    drawGlow(ctx, beam.x, beam.y, flashScale * intensity, { r: 255, g: 255, b: 255 }, intensity);
    drawGlow(ctx, beam.x, beam.y, flashScale * 1.6 * intensity, PLASMA, intensity * 0.6);

    // impact flash at target end
    drawGlow(ctx, ex, ey, flashScale * 0.8 * intensity, PLASMA_CORE, intensity * 0.5);
  }

  getCharge() {
    return this.charge;
  }
}
