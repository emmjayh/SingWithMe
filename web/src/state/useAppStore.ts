import { create } from "zustand";

export type ManualMode = "auto" | "always_on" | "always_off";

interface AppState {
  inputLevel: number;
  outputLevel: number;
  confidence: number;
  latencyMs: number;
  manualMode: ManualMode;
  calibrationActive: boolean;
  setConfidence: (value: number) => void;
  setLevels: (input: number, output: number) => void;
  setLatency: (latencyMs: number) => void;
  setManualMode: (mode: ManualMode) => void;
  setCalibrationActive: (active: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  inputLevel: 0,
  outputLevel: 0,
  confidence: 0,
  latencyMs: Number(import.meta.env.VITE_LATENCY_TARGET_MS ?? 25),
  manualMode: "auto",
  calibrationActive: false,
  setConfidence: (value) => set({ confidence: value }),
  setLevels: (input, output) => set({ inputLevel: input, outputLevel: output }),
  setLatency: (latencyMs) => set({ latencyMs }),
  setManualMode: (manualMode) => set({ manualMode }),
  setCalibrationActive: (calibrationActive) => set({ calibrationActive })
}));
