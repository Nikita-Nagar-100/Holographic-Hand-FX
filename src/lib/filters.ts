import { clamp, lerpNum } from './vector';

export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev = 0;
  private dxPrev = 0;
  private tPrev = 0;
  private inited = false;

  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, t: number): number {
    if (!this.inited) {
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrev = t;
      this.inited = true;
      return x;
    }
    const dt = clamp(t - this.tPrev, 0, 0.1) || 1e-3;
    const dx = (x - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const dxHat = lerpNum(this.dxPrev, dx, aD);
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = lerpNum(this.xPrev, x, a);
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = t;
    return xHat;
  }

  reset() {
    this.inited = false;
  }
}

export class Vec2OneEuro {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;

  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.fx = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.fy = new OneEuroFilter(minCutoff, beta, dCutoff);
  }

  filter(x: number, y: number, t: number) {
    return { x: this.fx.filter(x, t), y: this.fy.filter(y, t) };
  }

  reset() {
    this.fx.reset();
    this.fy.reset();
  }
}

export class Kalman1D {
  private q: number; // process noise
  private r: number; // measurement noise
  private x = 0; // estimate
  private p = 1; // uncertainty
  private k = 0; // gain
  private inited = false;

  constructor(processNoise = 0.01, measurementNoise = 0.4) {
    this.q = processNoise;
    this.r = measurementNoise;
  }

  filter(z: number): number {
    if (!this.inited) {
      this.x = z;
      this.p = 1;
      this.inited = true;
      return z;
    }
    this.p = this.p + this.q;
    this.k = this.p / (this.p + this.r);
    this.x = this.x + this.k * (z - this.x);
    this.p = (1 - this.k) * this.p;
    return this.x;
  }

  reset() {
    this.inited = false;
    this.x = 0;
    this.p = 1;
  }
}

export class KalmanVec2 {
  private kx: Kalman1D;
  private ky: Kalman1D;

  constructor(processNoise = 0.01, measurementNoise = 0.4) {
    this.kx = new Kalman1D(processNoise, measurementNoise);
    this.ky = new Kalman1D(processNoise, measurementNoise);
  }

  filter(x: number, y: number) {
    return { x: this.kx.filter(x), y: this.ky.filter(y) };
  }

  reset() {
    this.kx.reset();
    this.ky.reset();
  }
}

export class ScalarSmoother {
  private value = 0;
  private inited = false;
  constructor(private smoothing = 0.2) {}

  push(v: number) {
    if (!this.inited) {
      this.value = v;
      this.inited = true;
    } else {
      this.value = lerpNum(this.value, v, this.smoothing);
    }
    return this.value;
  }

  get() {
    return this.value;
  }

  reset() {
    this.inited = false;
    this.value = 0;
  }
}

export class StabilityTracker {
  private history: number[] = [];
  constructor(private window = 30) {}

  push(confidence: number) {
    this.history.push(confidence);
    if (this.history.length > this.window) this.history.shift();
  }

  getStability(): number {
    if (this.history.length === 0) return 0;
    const avg = this.history.reduce((a, b) => a + b, 0) / this.history.length;
    const variance =
      this.history.reduce((a, b) => a + (b - avg) ** 2, 0) / this.history.length;
    return clamp(1 - Math.sqrt(variance) * 4, 0, 1);
  }

  reset() {
    this.history = [];
  }
}
