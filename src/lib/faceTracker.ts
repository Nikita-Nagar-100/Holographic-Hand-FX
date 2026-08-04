import {
  FilesetResolver,
  FaceLandmarker,
  FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { OneEuroFilter, Vec2OneEuro, ScalarSmoother } from './filters';
import { Vec2, clamp } from './vector';

/**
 * Face tracking wrapper around MediaPipe FaceLandmarker.
 * Produces a smoothed set of facial landmark points (468) plus derived
 * face metrics: center, forehead position, eye positions, face width,
 * rotation, and confidence.  Uses One Euro + scalar smoothers to
 * eliminate jitter.
 */

const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Key MediaPipe Face mesh canonical indices
const FACE_CENTER = 159; // nose area
const FOREHEAD = 10; // top of forehead
const LEFT_EYE = 33;
const RIGHT_EYE = 263;
const LEFT_TEMPLE = 234;
const RIGHT_TEMPLE = 454;
const CHIN = 152;

export interface FaceState {
  landmarks: Vec2[];
  center: Vec2;
  forehead: Vec2;
  leftEye: Vec2;
  rightEye: Vec2;
  faceWidth: number;
  rotation: number;
  confidence: number;
  visible: boolean;
}

export class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private posFilter: Vec2OneEuro = new Vec2OneEuro(1.2, 0.01, 1.0);
  private confFilter: ScalarSmoother = new ScalarSmoother(0.3);
  private rotFilter: OneEuroFilter = new OneEuroFilter(1.0, 0.01, 1.0);
  private lastVideoTime = -1;
  private lastResults: FaceLandmarkerResult | null = null;
  private smoothLandmarks: Vec2[] = [];
  private inited = false;

  async init(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    this.landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.4,
      minFacePresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
  }

  update(video: HTMLVideoElement, timestampMs: number): FaceState | null {
    if (!this.landmarker) return null;
    if (video.readyState < 2) return null;

    let results: FaceLandmarkerResult | null = null;
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

    if (!results || !results.faceLandmarks || results.faceLandmarks.length === 0) {
      return null;
    }

    const raw = results.faceLandmarks[0];
    const t = timestampMs / 1000;

    // Smooth all landmarks with One Euro (initialize on first frame)
    if (!this.inited || this.smoothLandmarks.length !== raw.length) {
      this.smoothLandmarks = raw.map((p) => ({
        x: 1 - p.x,
        y: p.y,
      }));
      this.inited = true;
    } else {
      for (let i = 0; i < raw.length; i++) {
        const rx = 1 - raw[i].x; // mirror for selfie
        const ry = raw[i].y;
        // Light smoothing — reuse a shared filter approximation by
        // lerping toward the new value. This avoids 468 separate filters.
        this.smoothLandmarks[i].x += (rx - this.smoothLandmarks[i].x) * 0.45;
        this.smoothLandmarks[i].y += (ry - this.smoothLandmarks[i].y) * 0.45;
      }
    }

    const get = (idx: number): Vec2 => {
      const lm = this.smoothLandmarks[idx];
      return lm ? { x: lm.x, y: lm.y } : { x: 0.5, y: 0.5 };
    };

    const center = this.posFilter.filter(get(FACE_CENTER).x, get(FACE_CENTER).y, t);
    const forehead = get(FOREHEAD);
    const leftEye = get(LEFT_EYE);
    const rightEye = get(RIGHT_EYE);
    const leftTemple = get(LEFT_TEMPLE);
    const rightTemple = get(RIGHT_TEMPLE);
    void CHIN;

    const faceWidth = Math.hypot(
      rightTemple.x - leftTemple.x,
      rightTemple.y - leftTemple.y,
    );

    // rotation from eye line
    const rawRot = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
    const rotation = this.rotFilter.filter(rawRot, t);

    const confRaw = results.faceBlendshapes?.[0]?.categories?.[0]?.score ?? 0.7;
    const confidence = this.confFilter.push(confRaw);

    return {
      landmarks: this.smoothLandmarks,
      center,
      forehead,
      leftEye,
      rightEye,
      faceWidth,
      rotation,
      confidence,
      visible: true,
    };
  }

  reset() {
    this.posFilter.reset();
    this.confFilter.reset();
    this.rotFilter.reset();
    this.inited = false;
  }
}

export { clamp };
