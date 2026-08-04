import { Vec2 } from './vector';

export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],          // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],          // index
  [5, 9], [9, 10], [10, 11], [11, 12],     // middle
  [9, 13], [13, 14], [14, 15], [15, 16],   // ring
  [13, 17], [17, 18], [18, 19], [19, 20],  // pinky
  [0, 17],                                 // palm base to pinky base
];

export const FINGER_GROUPS = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
} as const;

export const FINGERTIPS = [4, 8, 12, 16, 20];
export const FINGER_BASES = [2, 5, 9, 13, 17];

export type GestureType =
  | 'open'
  | 'fist'
  | 'shoot'
  | 'pinch'
  | 'point'
  | 'victory'
  | 'unknown';

export type Landmark = Vec2 & { z?: number; world?: Vec2 };

export interface HandState {
  id: number;
  landmarks: Landmark[];
  handedness: 'Left' | 'Right';
  confidence: number;
  gesture: GestureType;
  // derived metrics
  palmCenter: Vec2;
  palmRotation: number; // radians
  handSpread: number;
  fingerAngles: number[]; // per-finger curl in degrees
  fingertipDistance: number; // avg dist thumb-index (pinch spread)
  worldScale: number;
  stability: number;
  // smoothed velocity for motion blur / prediction
  velocity: Vec2;
  speed: number; // smoothed velocity magnitude
}

export function detectGesture(lm: Landmark[]): GestureType {
  if (lm.length < 21) return 'unknown';

  const fingerExtended = (tip: number, pip: number) => {
    const wrist = lm[0];
    const dTip = Math.hypot(lm[tip].x - wrist.x, lm[tip].y - wrist.y);
    const dPip = Math.hypot(lm[pip].x - wrist.x, lm[pip].y - wrist.y);
    return dTip > dPip * 1.12;
  };

  const ext = [
    fingerExtended(4, 2),   // thumb (special)
    fingerExtended(8, 6),
    fingerExtended(12, 10),
    fingerExtended(16, 14),
    fingerExtended(20, 18),
  ];
  const count = ext.filter(Boolean).length;

  // Shoot = index + thumb extended, middle/ring/pinky closed
  if (ext[1] && ext[0] && !ext[2] && !ext[3] && !ext[4]) return 'shoot';
  if (ext[1] && !ext[2] && !ext[3] && !ext[4]) return 'point';
  if (ext[1] && ext[2] && !ext[3] && !ext[4]) return 'victory';
  if (count >= 4) return 'open';
  if (count <= 1) return 'fist';

  // pinch: thumb tip near index tip
  const pinchD = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
  const refD = Math.hypot(lm[0].x - lm[5].x, lm[0].y - lm[5].y) || 1;
  if (pinchD < refD * 0.5 && count <= 2) return 'pinch';

  return 'unknown';
}
