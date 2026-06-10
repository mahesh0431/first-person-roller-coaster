export type RideMode = "cinematic" | "comfort";

export interface RideSettings {
  audioEnabled: boolean;
  effectsEnabled: boolean;
  cameraShake: boolean;
  horizonLock: boolean;
  reducedMotion: boolean;
  vibrationEnabled: boolean;
  mode: RideMode;
  audioIntensity: number;
}

export interface RideMetrics {
  speedKmh: number;
  altitude: number;
  gForce: number;
  progress: number;
  bankDegrees: number;
  fps: number;
  zone: string;
}

export interface RideExperience {
  start: () => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
  emergencyStop: () => void;
  dispose: () => void;
}
