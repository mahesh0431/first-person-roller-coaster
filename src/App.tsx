import { useEffect, useRef, useState } from "react";
import {
  Gauge,
  Pause,
  Play,
  RotateCcw,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from "lucide-react";
import { createCoasterExperience } from "./ride/scene";
import type { RideExperience, RideMetrics, RideSettings } from "./ride/types";

const initialMetrics: RideMetrics = {
  speedKmh: 0,
  altitude: 0,
  gForce: 1,
  progress: 0,
  bankDegrees: 0,
  fps: 60,
  zone: "station",
};

const defaultSettings: RideSettings = {
  audioEnabled: true,
  effectsEnabled: true,
  cameraShake: true,
  horizonLock: false,
  reducedMotion: false,
  vibrationEnabled: false,
  mode: "cinematic",
  audioIntensity: 0.8,
};

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const experienceRef = useRef<RideExperience | null>(null);
  const settingsRef = useRef<RideSettings>(defaultSettings);
  const [settings, setSettingsState] = useState<RideSettings>(defaultSettings);
  const [metrics, setMetrics] = useState<RideMetrics>(initialMetrics);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    settingsRef.current = settings;
    document.documentElement.dataset.effects = settings.effectsEnabled && !settings.reducedMotion ? "on" : "off";
  }, [settings]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const experience = createCoasterExperience(
      canvasRef.current,
      () => settingsRef.current,
      setMetrics,
    );
    experienceRef.current = experience;
    return () => {
      experience.dispose();
      experienceRef.current = null;
    };
  }, []);

  const setSettings = (next: Partial<RideSettings>) => {
    setSettingsState((current) => {
      const merged = { ...current, ...next };
      settingsRef.current = merged;
      return merged;
    });
  };

  const startRide = () => {
    setStarted(true);
    setPaused(false);
    experienceRef.current?.start();
  };

  const togglePause = () => {
    if (!started) {
      startRide();
      return;
    }
    if (paused) {
      experienceRef.current?.resume();
      setPaused(false);
    } else {
      experienceRef.current?.pause();
      setPaused(true);
    }
  };

  const restart = () => {
    setStarted(true);
    setPaused(false);
    experienceRef.current?.restart();
  };

  const emergencyStop = () => {
    experienceRef.current?.emergencyStop();
    setPaused(true);
  };

  const blurStrength = settings.effectsEnabled && !settings.reducedMotion
    ? Math.min(1, Math.max(0, (metrics.speedKmh - 90) / 130))
    : 0;

  return (
    <main className="experience">
      <canvas ref={canvasRef} className="coaster-canvas" aria-label="First-person roller coaster simulation" />

      <div
        className="speed-lines"
        aria-hidden="true"
        style={{ opacity: blurStrength * 0.48 }}
      />
      <div className="vignette" aria-hidden="true" />

      <section className="hud" aria-label="Ride telemetry">
        <div className="hud-primary">
          <Gauge size={18} aria-hidden="true" />
          <strong>{metrics.speedKmh}</strong>
          <span>km/h</span>
        </div>
        <div className="hud-grid">
          <Telemetry label="alt" value={`${metrics.altitude} m`} />
          <Telemetry label="g" value={`${metrics.gForce}`} />
          <Telemetry label="bank" value={`${metrics.bankDegrees}°`} />
          <Telemetry label="fps" value={`${metrics.fps}`} />
        </div>
        <div className="progress">
          <span style={{ width: `${metrics.progress}%` }} />
        </div>
        <div className="ride-zone">{metrics.zone}</div>
      </section>

      <div className="top-controls" aria-label="Ride controls">
        <IconButton label={paused ? "Play" : "Pause"} onClick={togglePause}>
          {paused ? <Play size={19} /> : <Pause size={19} />}
        </IconButton>
        <IconButton label="Restart" onClick={restart}>
          <RotateCcw size={19} />
        </IconButton>
        <IconButton
          label={settings.audioEnabled ? "Mute" : "Unmute"}
          onClick={() => setSettings({ audioEnabled: !settings.audioEnabled })}
        >
          {settings.audioEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}
        </IconButton>
        <IconButton label="Settings" pressed={panelOpen} onClick={() => setPanelOpen((value) => !value)}>
          <Settings size={19} />
        </IconButton>
        <IconButton label="Emergency stop" danger onClick={emergencyStop}>
          <ShieldAlert size={19} />
        </IconButton>
      </div>

      <aside className={`settings-panel ${panelOpen ? "is-open" : ""}`} aria-label="Comfort settings">
        <div className="panel-heading">
          <SlidersHorizontal size={18} aria-hidden="true" />
          <span>Ride feel</span>
        </div>
        <Segmented
          value={settings.mode}
          onChange={(mode) => setSettings({ mode, reducedMotion: mode === "comfort" ? true : settings.reducedMotion })}
        />
        <Toggle label="Effects" checked={settings.effectsEnabled} onChange={(effectsEnabled) => setSettings({ effectsEnabled })} />
        <Toggle label="Shake" checked={settings.cameraShake} onChange={(cameraShake) => setSettings({ cameraShake })} />
        <Toggle label="Lock horizon" checked={settings.horizonLock} onChange={(horizonLock) => setSettings({ horizonLock })} />
        <Toggle label="Reduced motion" checked={settings.reducedMotion} onChange={(reducedMotion) => setSettings({ reducedMotion })} />
        <Toggle label="Vibration" checked={settings.vibrationEnabled} onChange={(vibrationEnabled) => setSettings({ vibrationEnabled })} />
        <label className="slider-row">
          <span>Audio</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.audioIntensity}
            onChange={(event) => setSettings({ audioIntensity: Number(event.currentTarget.value) })}
          />
        </label>
      </aside>

      {!started && (
        <button className="start-gate" onClick={startRide}>
          <Play size={22} aria-hidden="true" />
          <span>Start ride</span>
        </button>
      )}
    </main>
  );
}

function IconButton({
  label,
  children,
  onClick,
  danger = false,
  pressed = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      className={`icon-button ${danger ? "is-danger" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Telemetry({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <em>{label}</em>
      <strong>{value}</strong>
    </span>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}

function Segmented({
  value,
  onChange,
}: {
  value: "cinematic" | "comfort";
  onChange: (mode: "cinematic" | "comfort") => void;
}) {
  return (
    <div className="segmented" role="group" aria-label="Ride mode">
      <button className={value === "cinematic" ? "is-selected" : ""} onClick={() => onChange("cinematic")}>
        Cinematic
      </button>
      <button className={value === "comfort" ? "is-selected" : ""} onClick={() => onChange("comfort")}>
        Comfort
      </button>
    </div>
  );
}

export default App;
