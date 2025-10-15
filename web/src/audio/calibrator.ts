const EPSILON = 1e-6;

export interface CalibrationResult {
  noiseFloorDb: number;
  vocalPeakDb: number;
}

export class Calibrator {
  private sampleRate = 48000;
  private targetDuration = 10;
  private processed = 0;
  private maxAmplitude = 0;
  private active = false;

  start(sampleRate: number, durationSeconds = 10) {
    this.sampleRate = sampleRate;
    this.targetDuration = durationSeconds;
    this.processed = 0;
    this.maxAmplitude = 0;
    this.active = true;
  }

  process(frame: Float32Array) {
    if (!this.active) return;
    for (let i = 0; i < frame.length; i += 1) {
      const sample = Math.abs(frame[i]);
      if (sample > this.maxAmplitude) {
        this.maxAmplitude = sample;
      }
    }
    this.processed += frame.length;
    if (this.isComplete()) {
      this.active = false;
    }
  }

  isComplete() {
    return this.processed >= this.sampleRate * this.targetDuration;
  }

  result(): CalibrationResult {
    const amplitude = Math.max(this.maxAmplitude, EPSILON);
    const peakDb = 20 * Math.log10(amplitude);
    return {
      noiseFloorDb: -80,
      vocalPeakDb: peakDb
    };
  }

  store(key = "tunetrix-calibration") {
    const data = this.result();
    localStorage.setItem(key, JSON.stringify({ ...data, timestamp: Date.now() }));
  }

  load(key = "tunetrix-calibration"): CalibrationResult | null {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return {
        noiseFloorDb: parsed.noiseFloorDb ?? -80,
        vocalPeakDb: parsed.vocalPeakDb ?? -12
      };
    } catch {
      return null;
    }
  }
}
