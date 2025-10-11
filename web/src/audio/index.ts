import * as ort from "onnxruntime-web";
import { ManualMode, useAppStore, CalibrationStage } from "@state/useAppStore";
import { ConfidenceGate, GateConfig, dbToLinear } from "./confidenceGate";
import { Calibrator } from "./calibrator";
import { TelemetryLog } from "./telemetry";

const VAD_FRAME = 480;
const PITCH_FRAME = 960;
const AUDIO_WORKLET_URL = "/worklets/confidence-gate.worklet.js";

interface EngineConfig {
  sampleRate: number;
  bufferSamples: number;
  models: {
    vad: string;
    pitch: string;
  };
  confidenceWeights: {
    vad: number;
    pitch: number;
    phraseAware: number;
  };
  gate: GateConfig;
  latencyTargetMs: number;
}

const defaultConfig: EngineConfig = {
  sampleRate: 48000,
  bufferSamples: 128,
  models: {
    vad: import.meta.env.VITE_MODEL_PATH_VAD ?? "/models/vad.onnx",
    pitch: import.meta.env.VITE_MODEL_PATH_PITCH ?? "/models/crepe_tiny.onnx"
  },
  confidenceWeights: {
    vad: 0.6,
    pitch: 0.4,
    phraseAware: 0
  },
  gate: {
    lookAheadMs: 10,
    attackMs: 20,
    releaseMs: 180,
    holdMs: 150,
    thresholdOn: 0.7,
    thresholdOff: 0.4,
    framesOn: 3,
    framesOff: 6,
    duckDb: -18
  },
  latencyTargetMs: Number(import.meta.env.VITE_LATENCY_TARGET_MS ?? 25)
};

export interface TelemetrySnapshot {
  vad: number;
  pitch: number;
  confidence: number;
  gainDb: number;
}

class AudioEngine {
  private config: EngineConfig = defaultConfig;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private streamSource: MediaStreamAudioSourceNode | null = null;
  private vadSession: ort.InferenceSession | null = null;
  private pitchSession: ort.InferenceSession | null = null;
  private vadBuffer = new Float32Array(VAD_FRAME);
  private pitchBuffer = new Float32Array(PITCH_FRAME);
  private vadOffset = 0;
  private pitchOffset = 0;
  private gate = new ConfidenceGate(defaultConfig.gate);
  private calibrator = new Calibrator();
  private telemetry = new TelemetryLog();
  private queue: Float32Array[] = [];
  private processing = false;
  private initialised = false;
  private manualModeUnsub: (() => void) | null = null;
  private calibrationStageUnsub: (() => void) | null = null;

  private lastVad = 0;
  private lastPitch = 0;
  private lastConfidence = 0;
  private currentGain = 1;
  private calibrating = false;

  async initialise() {
    if (this.initialised) return;

    this.config = defaultConfig;
    this.gate.configure(this.config.sampleRate, this.config.bufferSamples, this.config.gate);

    await this.setupAudioGraph();
    await this.loadModels();
    this.bindStore();

    const store = useAppStore.getState();
    store.setLatency(this.config.latencyTargetMs);

    const storedCalibration = this.calibrator.load();
    if (storedCalibration) {
      store.setCalibrationResult(storedCalibration);
      store.setCalibrationStage("complete");
    }

    this.initialised = true;
  }

  async setupAudioGraph() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({
        sampleRate: this.config.sampleRate,
        latencyHint: "interactive"
      });
    }

    await this.audioContext.audioWorklet.addModule(AUDIO_WORKLET_URL);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: this.config.sampleRate
      }
    });

    this.streamSource = this.audioContext.createMediaStreamSource(stream);

    this.workletNode = new AudioWorkletNode(this.audioContext, "confidence-gate-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        bufferSamples: this.config.bufferSamples
      }
    });

    this.workletNode.port.onmessage = (event) => {
      const { data } = event;
      if (data?.type === "block" && data.payload) {
        const buffer = data.payload as ArrayBuffer;
        this.enqueueBlock(new Float32Array(buffer));
      }
    };

    this.streamSource.connect(this.workletNode);
    this.workletNode.connect(this.audioContext.destination);
  }

  async loadModels() {
    this.vadSession = await ort.InferenceSession.create(this.config.models.vad, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all"
    });
    this.pitchSession = await ort.InferenceSession.create(this.config.models.pitch, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all"
    });
  }

  bindStore() {
    const store = useAppStore.getState();
    this.gate.setManualMode(store.manualMode);

    this.manualModeUnsub = useAppStore.subscribe(
      (state) => state.manualMode,
      (mode: ManualMode) => this.gate.setManualMode(mode)
    );

    this.calibrationStageUnsub = useAppStore.subscribe(
      (state) => state.calibrationStage,
      (stage: CalibrationStage) => {
        if (stage === "collecting") {
          this.startCalibration();
        } else if (stage === "idle") {
          this.calibrating = false;
        }
      }
    );
  }

  enqueueBlock(block: Float32Array) {
    this.queue.push(block);
    if (!this.processing) {
      void this.drainQueue();
    }
  }

  async drainQueue() {
    this.processing = true;
    while (this.queue.length > 0) {
      const block = this.queue.shift() as Float32Array;
      await this.processBlock(block);
    }
    this.processing = false;
  }

  async processBlock(block: Float32Array) {
    const store = useAppStore.getState();

    if (this.calibrating) {
      this.calibrator.process(block);
      if (this.calibrator.isComplete()) {
        this.calibrating = false;
        const result = this.calibrator.result();
        this.calibrator.store();
        store.setCalibrationResult(result);
        store.setCalibrationStage("complete");
      }
    }

    const vadJobs: Float32Array[] = [];
    const pitchJobs: Float32Array[] = [];

    for (let i = 0; i < block.length; i += 1) {
      const sample = block[i];

      this.vadBuffer[this.vadOffset++] = sample;
      if (this.vadOffset === this.vadBuffer.length) {
        vadJobs.push(this.vadBuffer.slice());
        this.vadOffset = 0;
      }

      this.pitchBuffer[this.pitchOffset++] = sample;
      if (this.pitchOffset === this.pitchBuffer.length) {
        pitchJobs.push(this.pitchBuffer.slice());
        this.pitchOffset = 0;
      }
    }

    for (const frame of vadJobs) {
      await this.evaluateVad(frame);
    }
    for (const frame of pitchJobs) {
      await this.evaluatePitch(frame);
    }

    this.updateConfidence();

    const gainDb = this.gate.update(this.lastConfidence);
    this.currentGain = dbToLinear(gainDb);
    this.workletNode?.port.postMessage({ type: "gain", value: this.currentGain });

    this.telemetry.record({
      timestamp: performance.now(),
      vad: this.lastVad,
      pitch: this.lastPitch,
      confidence: this.lastConfidence,
      gainDb
    });

    const rms = this.calculateRms(block);
    store.setLevels(rms, Math.min(1, rms * this.currentGain));
    store.setConfidence(this.lastConfidence);
  }

  async evaluateVad(frame: Float32Array) {
    if (!this.vadSession) return;
    try {
      const tensor = new ort.Tensor("float32", frame, [1, frame.length]);
      const output = await this.vadSession.run({ input: tensor });
      const resultTensor = output.output;
      if (resultTensor && Array.isArray(resultTensor.data)) {
        this.lastVad = Number(resultTensor.data[0]) || 0;
      } else if (resultTensor && resultTensor.data instanceof Float32Array) {
        this.lastVad = resultTensor.data[0] ?? 0;
      }
    } catch {
      this.lastVad = 0;
    }
  }

  async evaluatePitch(frame: Float32Array) {
    if (!this.pitchSession) return;
    try {
      const tensor = new ort.Tensor("float32", frame, [1, frame.length]);
      const output = await this.pitchSession.run({ audio: tensor });
      const prob = output.voiced_prob;
      if (prob && prob.data instanceof Float32Array) {
        this.lastPitch = prob.data[0] ?? 0;
      } else if (prob && Array.isArray(prob.data)) {
        this.lastPitch = Number(prob.data[0]) || 0;
      }
    } catch {
      this.lastPitch = 0;
    }
  }

  updateConfidence() {
    const weights = this.config.confidenceWeights;
    const combined = weights.vad * this.lastVad + weights.pitch * this.lastPitch;
    this.lastConfidence = Math.min(1, Math.max(0, combined));
  }

  calculateRms(block: Float32Array) {
    let sum = 0;
    for (let i = 0; i < block.length; i += 1) {
      sum += block[i] * block[i];
    }
    return Math.sqrt(sum / block.length);
  }

  startCalibration() {
    this.calibrator.start(this.config.sampleRate, 10);
    this.calibrating = true;
    this.telemetry.reset();
  }

  resetCalibration() {
    this.calibrating = false;
    useAppStore.getState().setCalibrationStage("idle");
  }

  downloadTelemetry() {
    this.telemetry.download();
  }

  dispose() {
    this.manualModeUnsub?.();
    this.calibrationStageUnsub?.();
    this.workletNode?.disconnect();
    this.streamSource?.disconnect();
    this.audioContext?.close();
    this.initialised = false;
  }
}

export const audioEngine = new AudioEngine();
