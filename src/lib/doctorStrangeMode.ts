import { BloomPipeline, drawGlow, drawGlowLine, RenderContext } from './bloom';
import { drawLightRays, drawVolumetricLight } from './effects';
import { HandState } from './handModel';
import { clamp, dist, Vec2 } from './vector';

const MAGIC = { r: 255, g: 150, b: 40 };
const MAGIC_HOT = { r: 255, g: 200, b: 90 };

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

interface Fragment {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  rotSpeed: number;
  size: number;
  life: number;
  maxLife: number;
}

interface Spell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

interface PortalState {
  open: number;
  active: boolean;
  center: Vec2;
  radius: number;
}

const RUNES = ['◈', '⟁', '✦', '⟐', '⬡', '⊛', '⨁', '☉'];

export class DoctorStrangeMode {
  private ringAngles = [0, 0, 0, 0, 0, 0];
  private sparks: Spark[] = [];
  private portal: PortalState = { open: 0, active: false, center: { x: 0.5, y: 0.5 }, radius: 0 };
  private fragments: Fragment[] = [];
  private spells: Spell[] = [];
  private prevPinch = false;
  private shieldGlow = 0;
  private prevPalmRot = 0;
  private rotSpeed = 0;
  private spinBoost = 0;
  private trails: { x: number; y: number; life: number; maxLife: number }[] = [];
  private prevOpen = false;
  private blastCooldown = 0;
  private lastRenderTime = 0;

  update(dt: number) {
    for (let i = 0; i < this.ringAngles.length; i++) {
      this.ringAngles[i] += dt * (0.6 + i * 0.35) * (i % 2 === 0 ? 1 : -1);
    }

    // sparks
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 0.4 * dt;
      s.life -= dt;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);

    // fragments
    for (const f of this.fragments) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.a += f.rotSpeed * dt;
      f.vy += 0.15 * dt;
      f.life -= dt;
    }
    this.fragments = this.fragments.filter((f) => f.life > 0);

    // spells
    for (const s of this.spells) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
    }
    this.spells = this.spells.filter((s) => s.life > 0);

    // portal open/close
    if (this.portal.active) {
      this.portal.open = clamp(this.portal.open + dt * 1.2, 0, 1);
    } else {
      this.portal.open = clamp(this.portal.open - dt * 1.5, 0, 1);
    }

    // shield glow smoothing
    this.shieldGlow = clamp(this.shieldGlow - dt * 1.5, 0, 1);
    // spin boost decays
    this.spinBoost = clamp(this.spinBoost - dt * 0.8, 0, 3);
    this.blastCooldown = Math.max(0, this.blastCooldown - dt);
    // movement trails
    for (const t of this.trails) t.life -= dt;
    this.trails = this.trails.filter((t) => t.life > 0);
  }

  private emitSparks(x: number, y: number, count: number, scale: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (40 + Math.random() * 120) * scale;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 30,
        life: 0.5 + Math.random() * 0.6,
        maxLife: 1.1,
      });
    }
  }

  private emitFragments(x: number, y: number, count: number, scale: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (20 + Math.random() * 60) * scale;
      const size = (3 + Math.random() * 8) * scale;
      this.fragments.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 20,
        a: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 4,
        size,
        life: 1.0 + Math.random() * 1.5,
        maxLife: 2.5,
      });
    }
  }

  private fireSpell(x: number, y: number, angle: number, scale: number) {
    const speed = 400 + Math.random() * 200;
    this.spells.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.8,
      maxLife: 0.8,
    });
    this.emitSparks(x, y, 6, scale / 100);
    this.emitFragments(x, y, 4, scale / 100);
  }

  render(
    hands: HandState[],
    rc: RenderContext,
    bloom: BloomPipeline,
  ): void {
    const { ctx, width, height, time } = rc;
    const toPx = (p: Vec2) => ({ x: p.x * width, y: p.y * height });
    const minDim = Math.min(width, height);
    const rdt = Math.min(0.05, time - this.lastRenderTime) || 0.016;
    this.lastRenderTime = time;

    // determine portal state: both hands open
    const openHands = hands.filter((h) => h.gesture === 'open');
    if (openHands.length === 2) {
      const a = toPx(openHands[0].palmCenter);
      const b = toPx(openHands[1].palmCenter);
      this.portal.active = true;
      this.portal.center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.portal.radius = dist(a, b) * 0.8;
    } else {
      this.portal.active = false;
    }

    // draw shields + handle spell casting
    for (const hand of hands) {
      if (hand.gesture === 'open' || hand.gesture === 'pinch') {
        const palm = toPx(hand.palmCenter);
        const handSpan = Math.max(
          dist(toPx(hand.landmarks[0]), toPx(hand.landmarks[12])),
          minDim * 0.18,
        );
        const ref = handSpan * 2.0;
        this.shieldGlow = clamp(this.shieldGlow + 0.05, 0, 1);

        // wrist rotation -> spin speed boost
        const rotDelta = hand.palmRotation - this.prevPalmRot;
        this.prevPalmRot = hand.palmRotation;
        const rotAbs = Math.abs(rotDelta);
        this.rotSpeed = this.rotSpeed * 0.8 + rotAbs * 0.2;
        if (rotAbs > 0.02) {
          this.spinBoost = clamp(this.spinBoost + rotAbs * 2, 0, 3);
        }
        // apply boosted spin to ring angles
        const spinMul = 1 + this.spinBoost;
        for (let i = 0; i < this.ringAngles.length; i++) {
          this.ringAngles[i] += rdt * (0.6 + i * 0.35) * (i % 2 === 0 ? 1 : -1) * spinMul;
        }

        // movement energy trail
        if (hand.speed > 0.15) {
          this.trails.push({ x: palm.x, y: palm.y, life: 0.5, maxLife: 0.5 });
          if (this.trails.length > 25) this.trails.shift();
        }

        this.drawShield(ctx, palm.x, palm.y, ref, time, hand.palmRotation, this.shieldGlow);

        // light rays
        drawLightRays(ctx, palm.x, palm.y, ref * 0.8, MAGIC_HOT, 0.4, time, 7);

        // volumetric lighting
        drawVolumetricLight(ctx, palm.x, palm.y, ref * 1.2, MAGIC, 0.3, time);

        // sparks + fragments
        if (Math.random() < 0.5) this.emitSparks(palm.x, palm.y, 2, ref / 200);
        if (Math.random() < 0.15) this.emitFragments(palm.x, palm.y, 1, ref / 200);

        // spell casting: pinch release fires a spell
        const isPinch = hand.gesture === 'pinch';
        if (isPinch && !this.prevPinch) {
          const spellAngle = hand.palmRotation - Math.PI / 2;
          this.fireSpell(palm.x, palm.y, spellAngle, ref);
        }
        this.prevPinch = isPinch;

        // push-forward blast: open hand thrusting forward (high speed)
        const isOpen = hand.gesture === 'open';
        if (isOpen && hand.speed > 1.2 && this.blastCooldown <= 0 && !this.prevOpen) {
          const blastAngle = Math.atan2(hand.velocity.y, hand.velocity.x);
          this.fireSpell(palm.x, palm.y, blastAngle, ref * 1.5);
          this.emitSparks(palm.x, palm.y, 12, ref / 100);
          this.blastCooldown = 0.4;
        }
        this.prevOpen = isOpen;
      }
    }

    // movement energy trails
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i < this.trails.length; i++) {
      const p0 = this.trails[i - 1];
      const p1 = this.trails[i];
      const t = p1.life / p1.maxLife;
      drawGlowLine(ctx, p0.x, p0.y, p1.x, p1.y, MAGIC_HOT, 1, 8, t * 0.4);
      drawGlow(ctx, p1.x, p1.y, 6 * t, MAGIC, t * 0.3);
    }
    ctx.restore();

    // portal between hands
    if (this.portal.open > 0.01) {
      this.drawPortal(ctx, this.portal.center.x, this.portal.center.y, this.portal.radius, time, this.portal.open);
      if (this.portal.open > 0.3 && Math.random() < 0.6) {
        this.emitSparks(
          this.portal.center.x + (Math.random() - 0.5) * this.portal.radius,
          this.portal.center.y + (Math.random() - 0.5) * this.portal.radius,
          3,
          this.portal.radius / 200,
        );
      }
      // volumetric fog around portal
      drawVolumetricLight(ctx, this.portal.center.x, this.portal.center.y, this.portal.radius * 2, MAGIC, 0.2 * this.portal.open, time);
      // light rays from portal
      drawLightRays(ctx, this.portal.center.x, this.portal.center.y, this.portal.radius * 1.5, MAGIC_HOT, 0.3 * this.portal.open, time, 8);
    }

    // spells render with glowing trails
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.spells) {
      const t = s.life / s.maxLife;
      // trail
      const tx = s.x - s.vx * 0.05;
      const ty = s.y - s.vy * 0.05;
      drawGlowLine(ctx, tx, ty, s.x, s.y, MAGIC_HOT, 4, 16, t * 0.8);
      // head
      drawGlow(ctx, s.x, s.y, 14 * t, MAGIC_HOT, t);
      drawGlow(ctx, s.x, s.y, 6 * t, { r: 255, g: 255, b: 255 }, t);
      // impact sparks
      if (Math.random() < 0.3) this.emitSparks(s.x, s.y, 1, 0.5);
    }
    ctx.restore();

    // sparks render
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      const t = s.life / s.maxLife;
      drawGlow(ctx, s.x, s.y, 6 * t + 2, MAGIC_HOT, t);
    }
    ctx.restore();

    // floating glowing fragments
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.fragments) {
      const t = f.life / f.maxLife;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.a);
      // shard shape
      ctx.beginPath();
      ctx.moveTo(-f.size, 0);
      ctx.lineTo(0, -f.size * 0.6);
      ctx.lineTo(f.size, 0);
      ctx.lineTo(0, f.size * 0.6);
      ctx.closePath();
      const g = ctx.createLinearGradient(-f.size, 0, f.size, 0);
      g.addColorStop(0, `rgba(${MAGIC.r},${MAGIC.g},${MAGIC.b},${t * 0.7})`);
      g.addColorStop(0.5, `rgba(${MAGIC_HOT.r},${MAGIC_HOT.g},${MAGIC_HOT.b},${t * 0.9})`);
      g.addColorStop(1, `rgba(${MAGIC.r},${MAGIC.g},${MAGIC.b},${t * 0.7})`);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = `rgba(255,230,160,${t * 0.5})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      // glow halo
      drawGlow(ctx, f.x, f.y, f.size * 1.5, MAGIC, t * 0.3);
    }
    ctx.restore();

    bloom.applyBloom(ctx, ctx, 0.7, 8);
  }

  private drawShield(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    ref: number,
    time: number,
    palmRot: number,
    glow: number,
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(palmRot);
    ctx.globalCompositeOperation = 'lighter';

    const baseR = ref * 0.65;

    // 6 independent rotating rings
    const ringSpecs = [
      { r: baseR, w: 2.5, segs: 36 },
      { r: baseR * 0.85, w: 2, segs: 28 },
      { r: baseR * 0.68, w: 1.5, segs: 22 },
      { r: baseR * 0.5, w: 1.5, segs: 16 },
      { r: baseR * 0.35, w: 1, segs: 12 },
      { r: baseR * 0.2, w: 1, segs: 8 },
    ];

    ringSpecs.forEach((spec, idx) => {
      ctx.save();
      ctx.rotate(this.ringAngles[idx % this.ringAngles.length]);
      // base ring
      ctx.beginPath();
      ctx.arc(0, 0, spec.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${MAGIC.r},${MAGIC.g},${MAGIC.b},${0.4 + glow * 0.2})`;
      ctx.lineWidth = spec.w;
      ctx.stroke();

      // animated glowing segments
      for (let s = 0; s < spec.segs; s++) {
        const a0 = (s / spec.segs) * Math.PI * 2;
        const a1 = a0 + (Math.PI * 2 / spec.segs) * 0.5;
        const pulse = (Math.sin(time * 3 + s * 0.5 + idx) + 1) * 0.5;
        if (pulse > 0.5) {
          ctx.beginPath();
          ctx.arc(0, 0, spec.r, a0, a1);
          ctx.strokeStyle = `rgba(${MAGIC_HOT.r},${MAGIC_HOT.g},${MAGIC_HOT.b},${(0.3 + pulse * 0.5) * (0.5 + glow * 0.5)})`;
          ctx.lineWidth = spec.w * 2;
          ctx.stroke();
        }
      }

      // runes on first 4 rings
      if (idx < 4) {
        const runeCount = 6 + idx * 2;
        for (let r = 0; r < runeCount; r++) {
          const a = (r / runeCount) * Math.PI * 2;
          const rx = Math.cos(a) * spec.r;
          const ry = Math.sin(a) * spec.r;
          ctx.save();
          ctx.translate(rx, ry);
          ctx.rotate(a + Math.PI / 2);
          ctx.fillStyle = `rgba(${MAGIC_HOT.r},${MAGIC_HOT.g},${MAGIC_HOT.b},${(0.6 + Math.sin(time * 2 + r) * 0.2) * (0.5 + glow * 0.5)})`;
          ctx.font = `${Math.max(10, spec.r * 0.12)}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(RUNES[(r + idx) % RUNES.length], 0, 0);
          ctx.restore();
        }
      }
      ctx.restore();
    });

    // sacred geometry: hexagram (two overlapping triangles)
    ctx.save();
    ctx.rotate(this.ringAngles[0] * 0.5);
    for (let dir = 0; dir < 2; dir++) {
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = (i / 3) * Math.PI * 2 + (dir * Math.PI) / 3;
        const px = Math.cos(a) * baseR * 0.5;
        const py = Math.sin(a) * baseR * 0.5;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = `rgba(${MAGIC_HOT.r},${MAGIC_HOT.g},${MAGIC_HOT.b},${0.5 * (0.5 + glow * 0.5)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // inner pentagon
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(a) * baseR * 0.28;
      const py = Math.sin(a) * baseR * 0.28;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = `rgba(255,230,160,${0.4 * (0.5 + glow * 0.5)})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // central glow
    drawGlow(ctx, 0, 0, baseR * 0.4, MAGIC_HOT, 0.7 * (0.5 + glow * 0.5));
    drawGlow(ctx, 0, 0, baseR * 0.15, { r: 255, g: 240, b: 200 }, 0.9 * (0.5 + glow * 0.5));

    // outer shield dome glow
    drawGlow(ctx, 0, 0, baseR * 1.3, MAGIC, 0.15 * glow);

    ctx.restore();
  }

  private drawPortal(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    time: number,
    open: number,
  ) {
    const r = radius * open;
    if (r < 1) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = 'lighter';

    // outer volumetric fog
    drawGlow(ctx, 0, 0, r * 2.0, MAGIC, 0.2 * open);
    drawGlow(ctx, 0, 0, r * 1.4, MAGIC_HOT, 0.25 * open);

    // swirling vortex rings (more layers for depth)
    const rings = 18;
    for (let i = 0; i < rings; i++) {
      const rr = r * (1 - i / rings);
      const rot = time * (2 + i * 0.3) * (i % 2 ? 1 : -1);
      ctx.save();
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 1.7);
      const fade = 1 - i / rings;
      ctx.strokeStyle = `rgba(${MAGIC.r},${MAGIC.g},${MAGIC.b},${0.35 * open * fade})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // particle vortex (more particles)
    const particles = 60;
    for (let i = 0; i < particles; i++) {
      const baseA = (i / particles) * Math.PI * 2;
      const spiral = time * 1.5 + i * 0.3;
      const rr = r * (0.25 + ((spiral % 2) / 2) * 0.75);
      const a = baseA + spiral;
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      drawGlow(ctx, px, py, 5 * open, MAGIC_HOT, 0.6 * open);
    }

    // depth core (dark center with hot rim) — real depth
    const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.7);
    coreGrad.addColorStop(0, `rgba(10,2,0,${0.7 * open})`);
    coreGrad.addColorStop(0.4, `rgba(40,15,0,${0.5 * open})`);
    coreGrad.addColorStop(0.7, `rgba(100,40,0,${0.3 * open})`);
    coreGrad.addColorStop(1, `rgba(${MAGIC.r},${MAGIC.g},${MAGIC.b},0)`);
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
    ctx.fill();

    // inner swirling energy
    for (let i = 0; i < 20; i++) {
      const a = time * 3 + i * 0.5;
      const rr = r * 0.3 * (0.5 + Math.sin(a) * 0.5);
      drawGlow(ctx, Math.cos(a) * rr, Math.sin(a) * rr, 6 * open, MAGIC_HOT, 0.4 * open);
    }

    // hot rim
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${MAGIC_HOT.r},${MAGIC_HOT.g},${MAGIC_HOT.b},${0.6 * open})`;
    ctx.lineWidth = 4;
    ctx.stroke();

    // outer rotating rune ring
    ctx.save();
    ctx.rotate(time * 0.5);
    const runeCount = 12;
    for (let r2 = 0; r2 < runeCount; r2++) {
      const a = (r2 / runeCount) * Math.PI * 2;
      const rx = Math.cos(a) * r * 1.05;
      const ry = Math.sin(a) * r * 1.05;
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = `rgba(${MAGIC_HOT.r},${MAGIC_HOT.g},${MAGIC_HOT.b},${0.5 * open})`;
      ctx.font = `${Math.max(8, r * 0.06)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(RUNES[r2 % RUNES.length], 0, 0);
      ctx.restore();
    }
    ctx.restore();

    ctx.restore();
  }
}
