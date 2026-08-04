import { drawGlow } from './bloom';
import { drawLightRays, drawVolumetricLight, drawLensFlare } from './effects';
import { FaceState } from './faceTracker';
import { Vec2, clamp } from './vector';

/**
 * Cinematic face overlays — original, inspired designs (no copyrighted
 * movie assets or exact character masks).
 *
 * Doctor Strange:  glowing forehead sigil + magical aura
 * Iron Man:        futuristic HUD visor with scanning lines, eye
 *                  highlights, and holographic interface elements
 */

const MAGIC = { r: 255, g: 150, b: 40 };
const MAGIC_HOT = { r: 255, g: 200, b: 90 };
const HUD_BLUE = { r: 120, g: 200, b: 255 };
const HUD_CYAN = { r: 80, g: 220, b: 255 };

const SIGIL_RUNES = ['◈', '⟁', '✦', '⬡', '⊛'];

/* ================================================================== */
/*  Doctor Strange face overlay                                        */
/* ================================================================== */

export function drawStrangeFace(
  ctx: CanvasRenderingContext2D,
  face: FaceState,
  width: number,
  height: number,
  time: number,
) {
  const toPx = (p: Vec2) => ({ x: p.x * width, y: p.y * height });
  const fh = toPx(face.forehead);
  const fw = face.faceWidth * width;
  const auraR = fw * 1.4;
  const sigilR = fw * 0.22;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 1. Magical aura around the whole face
  drawVolumetricLight(ctx, toPx(face.center).x, toPx(face.center).y, auraR, MAGIC, 0.25, time);
  drawGlow(ctx, toPx(face.center).x, toPx(face.center).y, auraR * 0.6, MAGIC, 0.15);

  // 2. Light rays from forehead
  drawLightRays(ctx, fh.x, fh.y, fw * 0.8, MAGIC_HOT, 0.3, time, 5);

  // 3. Forehead sigil — a glowing circular rune pattern
  ctx.save();
  ctx.translate(fh.x, fh.y);
  ctx.rotate(time * 0.3);

  // outer rotating ring
  ctx.beginPath();
  ctx.arc(0, 0, sigilR, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${MAGIC_HOT.r},${MAGIC_HOT.g},${MAGIC_HOT.b},0.6)`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // inner counter-rotating ring
  ctx.save();
  ctx.rotate(-time * 0.6);
  ctx.beginPath();
  ctx.arc(0, 0, sigilR * 0.7, 0, Math.PI * 1.6);
  ctx.strokeStyle = `rgba(${MAGIC.r},${MAGIC.g},${MAGIC.b},0.5)`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // sacred geometry triangle
  ctx.beginPath();
  for (let i = 0; i <= 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    const px = Math.cos(a) * sigilR * 0.55;
    const py = Math.sin(a) * sigilR * 0.55;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = `rgba(${MAGIC_HOT.r},${MAGIC_HOT.g},${MAGIC_HOT.b},0.5)`;
  ctx.lineWidth = 1;
  ctx.stroke();

  // central glowing rune
  const runeIdx = Math.floor(time * 0.5) % SIGIL_RUNES.length;
  ctx.fillStyle = `rgba(255,230,160,${0.6 + Math.sin(time * 3) * 0.2})`;
  ctx.font = `${Math.max(8, sigilR * 0.4)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(SIGIL_RUNES[runeIdx], 0, 0);

  ctx.restore();

  // 4. Central bright glow on the sigil
  drawGlow(ctx, fh.x, fh.y, sigilR * 0.5, MAGIC_HOT, 0.7);
  drawGlow(ctx, fh.x, fh.y, sigilR * 0.2, { r: 255, g: 240, b: 200 }, 0.9);

  ctx.restore();
}

/* ================================================================== */
/*  Iron Man face overlay                                              */
/* ================================================================== */

export function drawIronManFace(
  ctx: CanvasRenderingContext2D,
  face: FaceState,
  width: number,
  height: number,
  time: number,
) {
  const toPx = (p: Vec2) => ({ x: p.x * width, y: p.y * height });
  const le = toPx(face.leftEye);
  const re = toPx(face.rightEye);
  const fc = toPx(face.center);
  const fw = face.faceWidth * width;
  const rot = face.rotation;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 1. Helmet outline — a rounded visor shape aligned to face rotation
  ctx.save();
  ctx.translate(fc.x, fc.y);
  ctx.rotate(rot);
  const visorW = fw * 0.55;
  const visorH = fw * 0.32;

  // outer HUD frame
  ctx.beginPath();
  ctx.ellipse(0, 0, visorW, visorH, 0, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${HUD_BLUE.r},${HUD_BLUE.g},${HUD_BLUE.b},0.3)`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // inner visor fill gradient
  const visorGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, visorW);
  visorGrad.addColorStop(0, `rgba(${HUD_CYAN.r},${HUD_CYAN.g},${HUD_CYAN.b},0.12)`);
  visorGrad.addColorStop(0.6, `rgba(${HUD_BLUE.r},${HUD_BLUE.g},${HUD_BLUE.b},0.06)`);
  visorGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = visorGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, visorW, visorH, 0, 0, Math.PI * 2);
  ctx.fill();

  // 2. Animated scanning lines
  const scanCount = 4;
  for (let i = 0; i < scanCount; i++) {
    const sy = ((time * 0.4 + i / scanCount) % 1) * visorH * 2 - visorH;
    const scanGrad = ctx.createLinearGradient(-visorW, sy, visorW, sy);
    scanGrad.addColorStop(0, `rgba(${HUD_CYAN.r},${HUD_CYAN.g},${HUD_CYAN.b},0)`);
    scanGrad.addColorStop(0.5, `rgba(${HUD_CYAN.r},${HUD_CYAN.g},${HUD_CYAN.b},0.4)`);
    scanGrad.addColorStop(1, `rgba(${HUD_CYAN.r},${HUD_CYAN.g},${HUD_CYAN.b},0)`);
    ctx.fillStyle = scanGrad;
    ctx.fillRect(-visorW, sy - 0.5, visorW * 2, 1.5);
  }

  // 3. HUD grid reticles (crosshair circles)
  const reticles = [
    { x: -visorW * 0.35, y: 0, r: visorW * 0.08 },
    { x: visorW * 0.35, y: 0, r: visorW * 0.08 },
    { x: 0, y: visorH * 0.3, r: visorW * 0.05 },
  ];
  for (const ret of reticles) {
    ctx.beginPath();
    ctx.arc(ret.x, ret.y, ret.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${HUD_CYAN.r},${HUD_CYAN.g},${HUD_CYAN.b},${0.3 + Math.sin(time * 2) * 0.15})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    // crosshair
    ctx.beginPath();
    ctx.moveTo(ret.x - ret.r * 1.5, ret.y);
    ctx.lineTo(ret.x + ret.r * 1.5, ret.y);
    ctx.moveTo(ret.x, ret.y - ret.r * 1.5);
    ctx.lineTo(ret.x, ret.y + ret.r * 1.5);
    ctx.strokeStyle = `rgba(${HUD_BLUE.r},${HUD_BLUE.g},${HUD_BLUE.b},0.25)`;
    ctx.stroke();
  }

  // 4. Holographic data readouts (small text snippets)
  ctx.fillStyle = `rgba(${HUD_CYAN.r},${HUD_CYAN.g},${HUD_CYAN.b},${0.3 + Math.sin(time * 3) * 0.1})`;
  ctx.font = `${Math.max(6, visorW * 0.05)}px monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('PWR 98%', -visorW * 0.85, -visorH * 0.85);
  ctx.fillText('STN OK', visorW * 0.55, -visorH * 0.85);
  ctx.textAlign = 'center';
  ctx.fillText(`${(time * 100).toFixed(0)}%`, 0, visorH * 0.65);

  ctx.restore(); // end visor transform

  // 5. Glowing eye highlights
  const eyeGlow = fw * 0.05;
  for (const eye of [le, re]) {
    // local rotated offset — approximate by drawing at eye position
    drawGlow(ctx, eye.x, eye.y, eyeGlow * 2, HUD_CYAN, 0.5);
    drawGlow(ctx, eye.x, eye.y, eyeGlow, { r: 255, g: 255, b: 255 }, 0.9);
  }

  // 6. Lens flare at face center
  drawLensFlare(ctx, fc.x, fc.y, 0.3, HUD_BLUE, time);

  ctx.restore();
}

export { clamp };
