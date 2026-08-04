import { deg } from '@/lib/vector';
import { rgbToCss, RGB } from '@/lib/spectrum';
import { HandState } from '@/lib/handModel';

export interface HudData {
  fps: number;
  hands: HandState[];
  wavelength: number;
  spectrum: string;
  color: RGB;
  mode: string;
  charge?: number;
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex justify-between items-center gap-3 py-0.5">
      <span className="text-cyan-300/60 text-[10px] uppercase tracking-wider">{label}</span>
      <span
        className="font-mono text-[11px] tabular-nums"
        style={{ color: accent ?? '#e2f3ff' }}
      >
        {value}
      </span>
    </div>
  );
}

function HandPanel({ hand, color }: { hand: HandState; color: RGB }) {
  const accent = rgbToCss(color);
  const vel = hand.speed;
  return (
    <div className="rounded-lg border border-cyan-400/20 bg-slate-950/60 backdrop-blur-md px-3 py-2 min-w-[150px]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-widest text-cyan-200/80">
          {hand.handedness} Hand
        </span>
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
        />
      </div>
      <Row label="Gesture" value={hand.gesture.toUpperCase()} accent={accent} />
      <Row label="Confidence" value={`${(hand.confidence * 100).toFixed(0)}%`} />
      <Row label="Stability" value={`${(hand.stability * 100).toFixed(0)}%`} />
      <Row label="Palm Rot" value={`${deg(hand.palmRotation).toFixed(0)}°`} />
      <Row label="Hand Spread" value={hand.handSpread.toFixed(3)} />
      <Row label="Finger Dist" value={hand.fingertipDistance.toFixed(3)} />
      <Row label="Velocity" value={vel.toFixed(2)} />
      <div className="mt-1 pt-1 border-t border-cyan-400/10">
        <div className="text-[9px] uppercase tracking-wider text-cyan-300/40 mb-0.5">Finger Angles</div>
        <div className="flex gap-1">
          {hand.fingerAngles.map((a, i) => (
            <span key={i} className="font-mono text-[9px] text-cyan-200/70 tabular-nums">
              {a.toFixed(0)}°
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Hud({ data }: { data: HudData }) {
  const accent = rgbToCss(data.color);
  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none">
      {/* top bar */}
      <div className="absolute top-3 left-3 right-3 flex justify-between items-start gap-2">
        <div className="rounded-lg border border-cyan-400/20 bg-slate-950/60 backdrop-blur-md px-3 py-2">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
            />
            <span className="text-[10px] uppercase tracking-widest text-cyan-200/80">
              {data.mode}
            </span>
          </div>
          <Row label="FPS" value={data.fps.toFixed(0)} accent={data.fps >= 50 ? '#4ade80' : '#facc15'} />
          <Row label="Hands" value={String(data.hands.length)} />
        </div>

        {/* spectrum panel */}
        <div className="rounded-lg border border-cyan-400/20 bg-slate-950/60 backdrop-blur-md px-3 py-2 min-w-[160px]">
          <Row label="Wavelength" value={`${data.wavelength.toFixed(0)} nm`} accent={accent} />
          <Row label="Spectrum" value={data.spectrum} accent={accent} />
          <div className="mt-1 h-1.5 rounded-full overflow-hidden bg-slate-800">
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${((data.wavelength - 380) / (700 - 380)) * 100}%`,
                background: accent,
                boxShadow: `0 0 8px ${accent}`,
              }}
            />
          </div>
          {data.charge !== undefined && (
            <div className="mt-1.5">
              <Row label="Charge" value={`${(data.charge * 100).toFixed(0)}%`} accent="#7dd3fc" />
              <div className="mt-0.5 h-1.5 rounded-full overflow-hidden bg-slate-800">
                <div
                  className="h-full bg-sky-400 transition-all"
                  style={{ width: `${data.charge * 100}%`, boxShadow: '0 0 8px #38bdf8' }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* hand panels */}
      <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-2 justify-center">
        {data.hands.map((h) => (
          <HandPanel key={h.id} hand={h} color={data.color} />
        ))}
        {data.hands.length === 0 && (
          <div className="rounded-lg border border-cyan-400/20 bg-slate-950/60 backdrop-blur-md px-4 py-2 text-cyan-300/60 text-[11px] tracking-wide">
            Show your hands to the camera
          </div>
        )}
      </div>
    </div>
  );
}
