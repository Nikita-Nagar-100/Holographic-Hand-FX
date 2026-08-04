import { useEffect, useRef, useState } from 'react';
import {
  Zap,
  Hand,
  Sparkles,
  Camera,
  Loader2,
  XCircle,
  Globe,
  CloudLightning,
} from 'lucide-react';
import { HandTracker } from '@/lib/handTracker';
import { FaceTracker, FaceState } from '@/lib/faceTracker';
import { BloomPipeline, RenderContext } from '@/lib/bloom';
import { IronManMode } from '@/lib/ironManMode';
import { DoctorStrangeMode } from '@/lib/doctorStrangeMode';
import { SpiderManMode } from '@/lib/spiderManMode';
import { ThorMode } from '@/lib/thorMode';
import { HandEffects } from '@/lib/handEffects';
import { drawStrangeFace, drawIronManFace } from '@/lib/faceMasks';
import { wavelengthToRGB, RGB } from '@/lib/spectrum';
import Hud, { HudData } from './Hud';

export type Mode = 'strange' | 'ironman' | 'spiderman' | 'thor';

const MODE_META: Record<Mode, { label: string; icon: typeof Zap; desc: string }> = {
  strange: { label: 'Dr. Strange', icon: Sparkles, desc: 'Magic circles & portal' },
  ironman: { label: 'Iron Man', icon: Hand, desc: 'Palm repulsor reactor' },
  spiderman: { label: 'Spider-Man', icon: Globe, desc: 'Web shooting & swinging' },
  thor: { label: 'Thor', icon: CloudLightning, desc: 'Lightning & thunder' },
};

export default function HandFXApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const faceTrackerRef = useRef<FaceTracker | null>(null);
  const bloomRef = useRef<BloomPipeline | null>(null);
  const ironRef = useRef(new IronManMode());
  const strangeRef = useRef(new DoctorStrangeMode());
  const spiderRef = useRef(new SpiderManMode());
  const thorRef = useRef(new ThorMode());
  const handFxRef = useRef(new HandEffects());
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef(0);
  const fpsRef = useRef({ frames: 0, last: 0, fps: 0 });
  const modeRef = useRef<Mode>('strange');
  const faceEnabledRef = useRef(true);

  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('strange');
  const [faceEnabled, setFaceEnabled] = useState(true);
  const [hud, setHud] = useState<HudData>({
    fps: 0,
    hands: [],
    wavelength: 620,
    spectrum: 'Orange',
    color: wavelengthToRGB(620),
    mode: MODE_META.strange.label,
  });

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    faceEnabledRef.current = faceEnabled;
  }, [faceEnabled]);

  const start = async () => {
    setLoading(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      const tracker = new HandTracker();
      await tracker.init();
      trackerRef.current = tracker;

      // Face tracker — optional, non-fatal if it fails
      try {
        const faceTracker = new FaceTracker();
        await faceTracker.init();
        faceTrackerRef.current = faceTracker;
      } catch (e) {
        console.warn('Face tracker init failed, continuing without face masks', e);
      }

      setStarted(true);
      setLoading(false);
      requestAnimationFrame(loop);
    } catch (e) {
      console.error(e);
      setError(
        e instanceof Error
          ? e.message
          : 'Failed to start camera. Allow camera access and retry.',
      );
      setLoading(false);
    }
  };

  const loop = (ts: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const tracker = trackerRef.current;
    if (!video || !canvas || !tracker) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }

    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (!bloomRef.current) {
      bloomRef.current = new BloomPipeline(w, h, 0.5);
    } else {
      bloomRef.current.resize(w, h);
    }

    // FPS
    const fpsState = fpsRef.current;
    fpsState.frames++;
    if (ts - fpsState.last > 500) {
      fpsState.fps = (fpsState.frames * 1000) / (ts - fpsState.last);
      fpsState.frames = 0;
      fpsState.last = ts;
    }

    const t = ts / 1000;
    const dt = Math.min(0.05, t - lastTimeRef.current);
    lastTimeRef.current = t;

    const hands = tracker.update(video, ts);

    // face tracking update
    let face: FaceState | null = null;
    if (faceEnabledRef.current && faceTrackerRef.current) {
      face = faceTrackerRef.current.update(video, ts);
    }

    // draw camera feed
    ctx.save();
    ctx.scale(-1, 1); // mirror
    ctx.drawImage(video, -w, 0, w, h);
    ctx.restore();

    // dark cinematic grade over feed
    ctx.save();
    ctx.fillStyle = 'rgba(5,8,20,0.35)';
    ctx.fillRect(0, 0, w, h);
    // subtle vignette
    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const rc: RenderContext = { ctx, width: w, height: h, time: t, dpr };
    const m = modeRef.current;
    const handFx = handFxRef.current;
    const toPx = (p: { x: number; y: number }) => ({ x: p.x * w, y: p.y * h });

    let wlColor: RGB = wavelengthToRGB(620);
    let wl = 620;
    let spectrum = 'Orange';
    let charge: number | undefined;

    // update hand effects (sparks etc)
    handFx.update(dt);

    if (m === 'ironman') {
      ironRef.current.update(dt);
      // hand power effects (draw before mode so reactor is on top)
      for (const hand of hands) {
        handFx.render(hand, wavelengthToRGB(460), t, w, h, ctx, toPx, 0.6 + ironRef.current.getCharge() * 0.4);
      }
      ironRef.current.render(hands, rc, bloomRef.current);
      handFx.renderSparks(ctx);
      charge = ironRef.current.getCharge();
      wl = 460;
      spectrum = 'Blue';
      wlColor = wavelengthToRGB(460);
    } else if (m === 'spiderman') {
      spiderRef.current.update(dt);
      for (const hand of hands) {
        handFx.render(hand, wavelengthToRGB(480), t, w, h, ctx, toPx, 0.5);
      }
      spiderRef.current.render(hands, rc, bloomRef.current);
      handFx.renderSparks(ctx);
      wl = 480;
      spectrum = 'Cyan';
      wlColor = wavelengthToRGB(480);
    } else if (m === 'thor') {
      thorRef.current.update(dt);
      for (const hand of hands) {
        handFx.render(hand, wavelengthToRGB(440), t, w, h, ctx, toPx, 0.6);
      }
      thorRef.current.render(hands, rc, bloomRef.current);
      handFx.renderSparks(ctx);
      wl = 440;
      spectrum = 'Violet';
      wlColor = wavelengthToRGB(440);
    } else {
      strangeRef.current.update(dt);
      // hand power effects
      for (const hand of hands) {
        handFx.render(hand, wavelengthToRGB(620), t, w, h, ctx, toPx, 0.6);
      }
      strangeRef.current.render(hands, rc, bloomRef.current);
      handFx.renderSparks(ctx);
      wl = 620;
      spectrum = 'Orange';
      wlColor = wavelengthToRGB(620);
    }

    // face mask overlay
    if (face && faceEnabledRef.current) {
      if (m === 'strange') {
        drawStrangeFace(ctx, face, w, h, t);
      } else if (m === 'ironman') {
        drawIronManFace(ctx, face, w, h, t);
      }
    }

    // update HUD
    setHud({
      fps: fpsState.fps,
      hands,
      wavelength: wl,
      spectrum,
      color: wlColor,
      mode: MODE_META[m].label,
      charge,
    });

    rafRef.current = requestAnimationFrame(loop);
  };

  useEffect(() => {
    const v = videoRef.current;
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (v && v.srcObject) {
        (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      <video
        ref={videoRef}
        muted
        className="absolute inset-0 w-full h-full object-cover opacity-0"
      />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />

      {started && <Hud data={hud} />}

      {started && (
        <>
          <ModeSelector mode={mode} onChange={setMode} />
          <FaceToggle enabled={faceEnabled} onToggle={setFaceEnabled} />
        </>
      )}

      {!started && (
        <StartScreen
          loading={loading}
          error={error}
          onStart={start}
        />
      )}
    </div>
  );
}

function ModeSelector({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex gap-2 pointer-events-auto">
      {(Object.keys(MODE_META) as Mode[]).map((m) => {
        const Meta = MODE_META[m];
        const Icon = Meta.icon;
        const active = mode === m;
        return (
          <button
            key={m}
            onClick={() => onChange(m)}
            className={`group flex items-center gap-2 px-4 py-2 rounded-full border transition-all backdrop-blur-md ${
              active
                ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-100 shadow-[0_0_20px_rgba(34,211,238,0.4)]'
                : 'border-white/10 bg-slate-950/50 text-white/60 hover:text-white/90 hover:border-white/20'
            }`}
          >
            <Icon className="w-4 h-4" />
            <span className="text-xs font-medium tracking-wide">{Meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function FaceToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onToggle(!enabled)}
      className={`absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs backdrop-blur-md transition-all ${
        enabled
          ? 'border-amber-400/50 bg-amber-500/15 text-amber-100'
          : 'border-white/10 bg-slate-950/50 text-white/50'
      }`}
    >
      <Sparkles className="w-3.5 h-3.5" />
      {enabled ? 'Face FX On' : 'Face FX Off'}
    </button>
  );
}

function StartScreen({
  loading,
  error,
  onStart,
}: {
  loading: boolean;
  error: string | null;
  onStart: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-black">
      <div className="absolute inset-0 opacity-30" style={{
        backgroundImage: 'radial-gradient(circle at 50% 40%, rgba(34,211,238,0.15), transparent 60%)',
      }} />
      <div className="relative text-center px-6 max-w-md">
        <div className="mb-6 flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 blur-2xl bg-cyan-500/30 rounded-full" />
            <div className="relative w-20 h-20 rounded-2xl border border-cyan-400/40 bg-slate-950/60 flex items-center justify-center">
              <Hand className="w-10 h-10 text-cyan-300" />
            </div>
          </div>
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight mb-2">
          Holographic Hand FX
        </h1>
        <p className="text-cyan-200/60 text-sm mb-8 leading-relaxed">
          Real-time hand tracking with cinematic superhero effects.
          Doctor Strange, Iron Man, Spider-Man, and Thor — powered by MediaPipe Hands.
        </p>

        {error && (
          <div className="mb-5 flex items-start gap-2 rounded-lg border border-red-400/30 bg-red-950/40 px-4 py-3 text-left">
            <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <span className="text-red-200/90 text-sm">{error}</span>
          </div>
        )}

        <button
          onClick={onStart}
          disabled={loading}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-cyan-500/90 hover:bg-cyan-400 text-slate-950 font-semibold tracking-wide transition-all shadow-[0_0_30px_rgba(34,211,238,0.5)] disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Camera className="w-5 h-5" />
          )}
          {loading ? 'Initializing…' : 'Start Camera'}
        </button>
        <p className="mt-6 text-xs text-white/30">
          Allow camera access when prompted. Works best in good lighting.
        </p>
      </div>
    </div>
  );
}
