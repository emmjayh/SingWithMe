import { create } from "zustand";

export type ManualMode = "auto" | "always_on" | "always_off";
export type CalibrationStage = "idle" | "collecting" | "complete";
export type PlaybackState = "stopped" | "playing" | "paused";

export interface CalibrationResult {
  noiseFloorDb: number;
  vocalPeakDb: number;
}

export interface TrackUrls {
  instrumentUrl: string | null;
  guideUrl: string | null;
}

const defaultInstrumentUrl = import.meta.env.VITE_INSTRUMENT_URL ?? "/media/demo-instrument.wav";
const defaultGuideUrl = import.meta.env.VITE_GUIDE_URL ?? "/media/demo-guide.wav";

interface AppState {
  inputLevel: number;
  outputLevel: number;
  confidence: number;
  latencyMs: number;
  manualMode: ManualMode;
  calibrationStage: CalibrationStage;
  calibrationResult: CalibrationResult | null;
  playbackState: PlaybackState;
  instrumentUrl: string | null;
  guideUrl: string | null;
  setConfidence: (value: number) => void;
  setLevels: (input: number, output: number) => void;
  setLatency: (latencyMs: number) => void;
  setManualMode: (mode: ManualMode) => void;
  setCalibrationStage: (stage: CalibrationStage) => void;
  setCalibrationResult: (result: CalibrationResult | null) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setTrackUrls: (urls: TrackUrls) => void;
  resetTrackUrls: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  inputLevel: 0,
  outputLevel: 0,
  confidence: 0,
  latencyMs: Number(import.meta.env.VITE_LATENCY_TARGET_MS ?? 25),
  manualMode: "auto",
  calibrationStage: "idle",
  calibrationResult: null,
  playbackState: "stopped",
  instrumentUrl: defaultInstrumentUrl,
  guideUrl: defaultGuideUrl,
  setConfidence: (value) => set({ confidence: value }),
  setLevels: (input, output) => set({ inputLevel: input, outputLevel: output }),
  setLatency: (latencyMs) => set({ latencyMs }),
  setManualMode: (manualMode) => set({ manualMode }),
  setCalibrationStage: (calibrationStage) => set({ calibrationStage }),
  setCalibrationResult: (calibrationResult) => set({ calibrationResult }),
  setPlaybackState: (playbackState) => set({ playbackState }),
  setTrackUrls: ({ instrumentUrl, guideUrl }) =>
    set((state) => ({
      instrumentUrl: instrumentUrl ?? state.instrumentUrl,
      guideUrl: guideUrl ?? state.guideUrl
    })),
  resetTrackUrls: () => set({
    instrumentUrl: defaultInstrumentUrl,
    guideUrl: defaultGuideUrl
  })
}));
