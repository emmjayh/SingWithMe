import { create } from "zustand";
import { resolveAssetUrl } from "@utils/assetPaths";

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

const defaultInstrumentUrl =
  resolveAssetUrl(import.meta.env.VITE_INSTRUMENT_URL ?? "/media/braykit-instrument.mp3")!;
const defaultGuideUrl =
  resolveAssetUrl(import.meta.env.VITE_GUIDE_URL ?? "/media/braykit-guide.mp3")!;
const sampleInstrumentUrl = resolveAssetUrl("/media/demo-instrument.mp3")!;
const sampleGuideUrl = resolveAssetUrl("/media/demo-guide.mp3")!;

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
  noiseFloor: number;
  micMonitorGainDb: number;
  crowdCancelStrength: number;
  reverbStrength: number;
  timbreStrength: number;
  phraseSmoothness: number;
  setConfidence: (value: number) => void;
  setLevels: (input: number, output: number) => void;
  setLatency: (latencyMs: number) => void;
  setManualMode: (mode: ManualMode) => void;
  setCalibrationStage: (stage: CalibrationStage) => void;
  setCalibrationResult: (result: CalibrationResult | null) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setTrackUrls: (urls: TrackUrls) => void;
  resetTrackUrls: () => void;
  loadSampleTracks: () => void;
  setNoiseFloor: (value: number) => void;
  setMicMonitorGainDb: (value: number) => void;
  setCrowdCancelStrength: (value: number) => void;
  setReverbStrength: (value: number) => void;
  setTimbreStrength: (value: number) => void;
  setPhraseSmoothness: (value: number) => void;
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
  noiseFloor: 0.22,
  micMonitorGainDb: -6,
  crowdCancelStrength: 1,
  reverbStrength: 0,
  timbreStrength: 1,
  phraseSmoothness: 0.1,
  setConfidence: (value) => set({ confidence: value }),
  setLevels: (input, output) => set({ inputLevel: input, outputLevel: output }),
  setLatency: (latencyMs) => set({ latencyMs }),
  setManualMode: (manualMode) => set({ manualMode }),
  setCalibrationStage: (calibrationStage) => set({ calibrationStage }),
  setCalibrationResult: (calibrationResult) => set({ calibrationResult }),
  setPlaybackState: (playbackState) => set({ playbackState }),
  setTrackUrls: ({ instrumentUrl, guideUrl }) =>
    set((state) => ({
      instrumentUrl: instrumentUrl
        ? resolveAssetUrl(instrumentUrl) ?? instrumentUrl
        : state.instrumentUrl,
      guideUrl: guideUrl ? resolveAssetUrl(guideUrl) ?? guideUrl : state.guideUrl
    })),
  resetTrackUrls: () =>
    set({
      instrumentUrl: defaultInstrumentUrl,
      guideUrl: defaultGuideUrl
    }),
  loadSampleTracks: () =>
    set({
      instrumentUrl: sampleInstrumentUrl,
      guideUrl: sampleGuideUrl
    }),
  setNoiseFloor: (noiseFloor) => set({ noiseFloor }),
  setMicMonitorGainDb: (micMonitorGainDb) => set({ micMonitorGainDb }),
  setCrowdCancelStrength: (crowdCancelStrength) => set({ crowdCancelStrength }),
  setReverbStrength: (reverbStrength) => set({ reverbStrength }),
  setTimbreStrength: (timbreStrength) => set({ timbreStrength }),
  setPhraseSmoothness: (phraseSmoothness) => set({ phraseSmoothness })
}));

