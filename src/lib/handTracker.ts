import {
  FilesetResolver,
  HandLandmarker,
  HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import {
  KalmanVec2,
  OneEuroFilter,
  ScalarSmoother,
  StabilityTracker,
  Vec2OneEuro,
} from './filters';
import { angle, angleBetween, dist, Vec2 } from './vector';
import {
  detectGesture,
  FINGERTIPS,
  FINGER_GROUPS,
  HandState,
  Landmark,
} from './handModel';

const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private smoothers: { pos: Vec2OneEuro; kalman: KalmanVec2 }[] = [];
  private confidenceFilters: OneEuroFilter[] = [];
  private stability: StabilityTracker[] = [];
  private velocitySmoother: ScalarSmoother[] = [];
  private lastVideoTime = -1;
  private lastTimestamp = 0;
  private lastResults: HandLandmarkerResult | null = null;

  async init(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  private ensureSmoothers(n: number) {
    while (this.smoothers.length < n) {
      this.smoothers.push({
        pos: new Vec2OneEuro(1.2, 0.008, 1.0),
        kalman: new KalmanVec2(0.008, 0.35),
      });
    }
    while (this.confidenceFilters.length < n) {
      this.confidenceFilters.push(new OneEuroFilter(0.8, 0.005, 1.0));
    }
    while (this.stability.length < n) {
      this.stability.push(new StabilityTracker(30));
    }
    while (this.velocitySmoother.length < n) {
      this.velocitySmoother.push(new ScalarSmoother(0.3));
    }
  }

  update(video: HTMLVideoElement, timestampMs: number): HandState[] {
    if (!this.landmarker) return [];
    if (video.readyState < 2) return [];

    let results: HandLandmarkerResult | null = null;
    if (video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      try {
        results = this.landmarker.detectForVideo(video, timestampMs);
      } catch {
        results = null;
      }
      this.lastResults = results;
    } else {
      results = this.lastResults;
    }

    if (!results || !results.landmarks || results.landmarks.length === 0) {
      return [];
    }

    const t = timestampMs / 1000;
    const dt = Math.max(t - this.lastTimestamp, 1e-3);
    this.lastTimestamp = t;

    const hands: HandState[] = [];

    for (let h = 0; h < results.landmarks.length; h++) {
      this.ensureSmoothers(h + 1);
      const raw = results.landmarks[h];
      const worldRaw = results.worldLandmarks?.[h];
      const handed = results.handednesses?.[h]?.[0]?.categoryName ?? 'Right';

      // MediaPipe returns normalized [0..1] with origin top-left.
      // We keep normalized coords and let the renderer map to canvas pixels.
      const smoothed: Landmark[] = [];
      const prevLm = this.smoothers[h].pos;
      for (let i = 0; i < raw.length; i++) {
        const rx = 1 - raw[i].x; // mirror horizontally for selfie view
        const ry = raw[i].y;
        const oneEuro = this.smoothers[h].pos.filter(rx, ry, t);
        const kalman = this.smoothers[h].kalman.filter(oneEuro.x, oneEuro.y);
        smoothed.push({
          x: kalman.x,
          y: kalman.y,
          z: raw[i].z,
          world: worldRaw
            ? { x: worldRaw[i].x, y: worldRaw[i].y }
            : undefined,
        });
        // reset prevLm reference usage to avoid unused warnings
        void prevLm;
      }

      const confRaw = results.handednesses?.[h]?.[0]?.score ?? 0.8;
      const confidence = this.confidenceFilters[h].filter(confRaw, t);
      this.stability[h].push(confidence);

      const palmCenter: Vec2 = {
        x: (smoothed[0].x + smoothed[5].x + smoothed[17].x) / 3,
        y: (smoothed[0].y + smoothed[5].y + smoothed[17].y) / 3,
      };

      const palmRotation = angle(
        { x: smoothed[5].x - smoothed[17].x, y: smoothed[5].y - smoothed[17].y },
      );

      // hand spread = average distance from palm center to fingertips
      const palmWrist = dist(smoothed[0], smoothed[9]);
      let spreadSum = 0;
      for (const tip of FINGERTIPS) {
        spreadSum += dist(palmCenter, smoothed[tip]);
      }
      const handSpread = spreadSum / FINGERTIPS.length;

      // per finger curl angle (PIP joint)
      const fingerAngles: number[] = [];
      const groups = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
      for (const g of groups) {
        const ids = FINGER_GROUPS[g];
        const a = angleBetween(smoothed[ids[0]], smoothed[ids[1]], smoothed[ids[3]]);
        fingerAngles.push((a * 180) / Math.PI);
      }

      const fingertipDistance = dist(smoothed[4], smoothed[8]);

      // velocity estimate from palm center movement
      const velX = (palmCenter.x - (this.prevPalm?.[h]?.x ?? palmCenter.x)) / dt;
      const velY = (palmCenter.y - (this.prevPalm?.[h]?.y ?? palmCenter.y)) / dt;
      if (!this.prevPalm) this.prevPalm = [];
      this.prevPalm[h] = { x: palmCenter.x, y: palmCenter.y };
      const velMag = this.velocitySmoother[h].push(Math.hypot(velX, velY));

      hands.push({
        id: h,
        landmarks: smoothed,
        handedness: handed === 'Left' ? 'Right' : 'Left', // mirror label too
        confidence,
        gesture: detectGesture(smoothed),
        palmCenter,
        palmRotation,
        handSpread,
        fingerAngles,
        fingertipDistance,
        worldScale: palmWrist,
        stability: this.stability[h].getStability(),
        velocity: { x: velX, y: velY },
        speed: velMag,
      });
    }

    return hands;
  }

  private prevPalm: Vec2[] | null = null;

  reset() {
    for (const s of this.smoothers) {
      s.pos.reset();
      s.kalman.reset();
    }
    for (const c of this.confidenceFilters) c.reset();
    for (const s of this.stability) s.reset();
    for (const v of this.velocitySmoother) v.reset();
    this.prevPalm = null;
  }
}
