import { create } from "zustand";

export type ManualMode = "auto" | "always_on" | "always_off";
export type CalibrationStage = "idle" | "collecting" | "complete";

export interface CalibrationResult {
  noiseFloorDb: number;
  vocalPeakDb: number;
}

interface AppState {
  inputLevel: number;
  outputLevel: number;
  confidence: number;
  latencyMs: number;
  manualMode: ManualMode;
  calibrationStage: CalibrationStage;
  calibrationResult: CalibrationResult | null;
  setConfidence: (value: number) => void;
  setLevels: (input: number, output: number) => void;
  setLatency: (latencyMs: number) => void;
  setManualMode: (mode: ManualMode) => void;
  setCalibrationStage: (stage: CalibrationStage) => void;
  setCalibrationResult: (result: CalibrationResult | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  inputLevel: 0,
  outputLevel: 0,
  confidence: 0,
  latencyMs: Number(import.meta.env.VITE_LATENCY_TARGET_MS ?? 25),
  manualMode: "auto",
  calibrationStage: "idle",
  calibrationResult: null,
  setConfidence: (value) => set({ confidence: value }),
  setLevels: (input, output) => set({ inputLevel: input, outputLevel: output }),
  setLatency: (latencyMs) => set({ latencyMs }),
  setManualMode: (manualMode) => set({ manualMode }),
  setCalibrationStage: (calibrationStage) => set({ calibrationStage }),
  setCalibrationResult: (calibrationResult) => set({ calibrationResult })
}));
