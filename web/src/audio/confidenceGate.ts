import { ManualMode } from "@state/useAppStore";

export interface GateConfig {
  lookAheadMs: number;
  attackMs: number;
  releaseMs: number;
  holdMs: number;
  thresholdOn: number;
  thresholdOff: number;
  framesOn: number;
  framesOff: number;
  duckDb: number;
}

const ZERO_DB = 0;

export class ConfidenceGate {
  private config: GateConfig;
  private sampleRate = 48000;
  private blockSize = 128;
  private gainDb = ZERO_DB;
  private targetDb = ZERO_DB;
  private holdTimerMs = 0;
  private consecutiveOn = 0;
  private consecutiveOff = 0;
  private manualMode: ManualMode = "auto";

  constructor(config: GateConfig) {
    this.config = config;
    this.reset();
  }

  configure(sampleRate: number, blockSize: number, config: GateConfig) {
    this.sampleRate = sampleRate;
    this.blockSize = blockSize;
    this.config = config;
    this.reset();
  }

  setManualMode(mode: ManualMode) {
    this.manualMode = mode;
  }

  reset() {
    this.gainDb = this.config.duckDb;
    this.targetDb = this.config.duckDb;
    this.holdTimerMs = 0;
    this.consecutiveOn = 0;
    this.consecutiveOff = 0;
  }

  update(confidence: number) {
    if (this.manualMode === "always_on") {
      this.targetDb = ZERO_DB;
    } else if (this.manualMode === "always_off") {
      this.targetDb = this.config.duckDb;
    } else {
      if (confidence >= this.config.thresholdOn) {
        this.consecutiveOn += 1;
        this.consecutiveOff = 0;
      } else if (confidence <= this.config.thresholdOff) {
        this.consecutiveOff += 1;
        this.consecutiveOn = 0;
      } else {
        this.consecutiveOn = 0;
      }

      if (this.consecutiveOn >= this.config.framesOn) {
        this.targetDb = ZERO_DB;
        this.holdTimerMs = this.config.holdMs;
      } else if (this.consecutiveOff >= this.config.framesOff && this.holdTimerMs <= 0) {
        this.targetDb = this.config.duckDb;
      }
    }

    const elapsedMs = (this.blockSize / this.sampleRate) * 1000;
    if (this.holdTimerMs > 0) {
      this.holdTimerMs = Math.max(0, this.holdTimerMs - elapsedMs);
    }

    const attackCoef = Math.exp(-elapsedMs / Math.max(this.config.attackMs, 1));
    const releaseCoef = Math.exp(-elapsedMs / Math.max(this.config.releaseMs, 1));

    if (this.gainDb > this.targetDb) {
      this.gainDb = this.targetDb + (this.gainDb - this.targetDb) * attackCoef;
    } else {
      this.gainDb = this.targetDb + (this.gainDb - this.targetDb) * releaseCoef;
    }

    this.gainDb = Math.min(ZERO_DB, Math.max(this.config.duckDb, this.gainDb));
    return this.gainDb;
  }

  currentGain() {
    return this.gainDb;
  }

  currentGainLinear() {
    return dbToLinear(this.gainDb);
  }
}

export function dbToLinear(db: number) {
  return Math.pow(10, db / 20);
}
