import * as ort from "onnxruntime-web";
import { ManualMode, useAppStore, CalibrationStage, PlaybackState } from "@state/useAppStore";
import { ConfidenceGate, GateConfig, dbToLinear } from "./confidenceGate";
import { Calibrator } from "./calibrator";
import { TelemetryLog } from "./telemetry";
import { shallow } from "zustand/shallow";

const AUDIO_WORKLET_URL = "/worklets/confidence-gate.worklet.js";
const SAMPLE_RATE_TARGET = 16000;
const VAD_FRAME_SOURCE = 480; // 10 ms @ 48 kHz
const VAD_FRAME_TARGET = 160; // 10 ms @ 16 kHz
const PITCH_FRAME_SOURCE = 3072; // 64 ms @ 48 kHz
const PITCH_FRAME_TARGET = 1024; // 64 ms @ 16 kHz

interface MediaConfig {
  instrumentUrl: string | null;
  guideUrl: string | null;
  loop: boolean;
  instrumentGainDb: number;
  guideGainDb: number;
  micMonitorGainDb: number;
}

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
  media: MediaConfig;
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
    duckDb: -80
  },
  media: {
    instrumentUrl: import.meta.env.VITE_INSTRUMENT_URL ?? "/media/demo-instrument.wav",
    guideUrl: import.meta.env.VITE_GUIDE_URL ?? "/media/demo-guide.wav",
    loop: true,
    instrumentGainDb: 0,
    guideGainDb: 0,
    micMonitorGainDb: -6
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
  private micGainNode: GainNode | null = null;
  private streamSource: MediaStreamAudioSourceNode | null = null;
  private vadSession: ort.InferenceSession | null = null;
  private pitchSession: ort.InferenceSession | null = null;
  private vadBuffer = new Float32Array(VAD_FRAME_SOURCE);
  private pitchBuffer = new Float32Array(PITCH_FRAME_SOURCE);
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
  private trackUrlUnsub: (() => void) | null = null;

  private vadState = new Float32Array(2 * 128);
  private instrumentBuffer: AudioBuffer | null = null;
  private guideBuffer: AudioBuffer | null = null;
  private instrumentSource: AudioBufferSourceNode | null = null;
  private guideSource: AudioBufferSourceNode | null = null;
  private instrumentGainNode: GainNode | null = null;
  private guideGainNode: GainNode | null = null;
  private instrumentBaseGain = 1;
  private guideBaseGain = 1;

  private playbackOffset = 0;
  private playbackStartTime = 0;

  private lastVad = 0;
  private lastPitch = 0;
  private lastConfidence = 0;
  private currentGain = 1;
  private calibrating = false;

  async initialise() {
    if (this.initialised) return;

    this.config = defaultConfig;
    const trackState = useAppStore.getState();
    this.config.media.instrumentUrl = trackState.instrumentUrl ?? defaultConfig.media.instrumentUrl;
    this.config.media.guideUrl = trackState.guideUrl ?? defaultConfig.media.guideUrl;
    this.gate.configure(this.config.sampleRate, this.config.bufferSamples, this.config.gate);
    this.instrumentBaseGain = dbToLinear(this.config.media.instrumentGainDb ?? 0);
    this.guideBaseGain = dbToLinear(this.config.media.guideGainDb ?? 0);
    this.vadState.fill(0);

    await this.setupAudioGraph();
    await this.loadModels();
    await this.loadMedia();
    this.playbackOffset = 0;
    this.stopMedia();
    this.setPlaybackState("stopped");
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

  private async setupAudioGraph() {
    if (!this.audioContext || this.audioContext.state === "closed") {
      this.audioContext = new AudioContext({
        sampleRate: this.config.sampleRate,
        latencyHint: "interactive"
      });
    }

    await this.audioContext.resume().catch(() => undefined);
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

    this.micGainNode = this.audioContext.createGain();
    this.micGainNode.gain.value = dbToLinear(this.config.media.micMonitorGainDb ?? -6);

    this.streamSource.connect(this.workletNode);
    this.workletNode.connect(this.micGainNode);
    this.micGainNode.connect(this.audioContext.destination);
  }

  private async loadModels() {
    this.vadSession = await ort.InferenceSession.create(this.config.models.vad, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all"
    });
    this.pitchSession = await ort.InferenceSession.create(this.config.models.pitch, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all"
    });
  }

  private async loadMedia() {
    if (!this.audioContext) return;

    const fetchBuffer = async (url: string | null): Promise<AudioBuffer | null> => {
      if (!url) {
        return null;
      }
      try {
        const response = await fetch(url);
        if (!response.ok) {
          return null;
        }
        const arrayBuffer = await response.arrayBuffer();
        return await this.audioContext!.decodeAudioData(arrayBuffer);
      } catch {
        return null;
      }
    };

    const state = useAppStore.getState();
    const instrumentUrl = state.instrumentUrl ?? this.config.media.instrumentUrl;
    const guideUrl = state.guideUrl ?? this.config.media.guideUrl;

    this.instrumentBuffer = await fetchBuffer(instrumentUrl);
    this.guideBuffer = await fetchBuffer(guideUrl);
  }

  private startMedia(offsetSeconds = 0) {
    if (!this.audioContext) {
      return;
    }

    this.stopMedia();

    const instrumentDuration = this.instrumentBuffer?.duration ?? 0;
    const guideDuration = this.guideBuffer?.duration ?? 0;
    const normalizedInstrumentOffset = this.normalizeOffset(offsetSeconds, instrumentDuration);
    const normalizedGuideOffset = this.normalizeOffset(offsetSeconds, guideDuration);

    if (this.instrumentBuffer) {
      this.instrumentSource = this.audioContext.createBufferSource();
      this.instrumentSource.buffer = this.instrumentBuffer;
      this.instrumentSource.loop = this.config.media.loop;

      this.instrumentGainNode = this.audioContext.createGain();
      this.instrumentGainNode.gain.value = this.instrumentBaseGain;
      this.instrumentSource.connect(this.instrumentGainNode).connect(this.audioContext.destination);
      this.instrumentSource.start(0, normalizedInstrumentOffset);
    }

    if (this.guideBuffer) {
      this.guideSource = this.audioContext.createBufferSource();
      this.guideSource.buffer = this.guideBuffer;
      this.guideSource.loop = this.config.media.loop;

      this.guideGainNode = this.audioContext.createGain();
      this.guideGainNode.gain.value = this.guideBaseGain;
      this.guideSource.connect(this.guideGainNode).connect(this.audioContext.destination);
      this.guideSource.start(0, normalizedGuideOffset);
    }
  }

  private stopMedia() {
    if (this.instrumentSource) {
      try {
        this.instrumentSource.stop();
      } catch {
        /* ignore */
      }
      this.instrumentSource.disconnect();
      this.instrumentSource = null;
    }
    if (this.instrumentGainNode) {
      this.instrumentGainNode.disconnect();
      this.instrumentGainNode = null;
    }

    if (this.guideSource) {
      try {
        this.guideSource.stop();
      } catch {
        /* ignore */
      }
      this.guideSource.disconnect();
      this.guideSource = null;
    }
    if (this.guideGainNode) {
      this.guideGainNode.disconnect();
      this.guideGainNode = null;
    }
  }

  private setPlaybackState(state: PlaybackState) {
    useAppStore.getState().setPlaybackState(state);
  }

  private get currentPlaybackState() {
    return useAppStore.getState().playbackState;
  }

  async play() {
    if (!this.audioContext) {
      return;
    }

    if (!this.instrumentBuffer && !this.guideBuffer) {
      await this.loadMedia();
    }

    if (!this.instrumentBuffer && !this.guideBuffer) {
      return;
    }

    if (this.currentPlaybackState === "playing") {
      return;
    }

    await this.audioContext.resume();
    const offset = this.playbackOffset;
    this.startMedia(offset);
    this.playbackStartTime = this.audioContext.currentTime - offset;
    this.setPlaybackState("playing");
  }

  pause() {
    if (!this.audioContext) {
      return;
    }
    if (this.currentPlaybackState !== "playing") {
      return;
    }

    this.playbackOffset = Math.max(0, this.audioContext.currentTime - this.playbackStartTime);
    this.stopMedia();
    this.setPlaybackState("paused");
  }

  stop() {
    if (!this.audioContext) {
      return;
    }

    this.stopMedia();
    this.playbackOffset = 0;
    this.playbackStartTime = this.audioContext.currentTime;
    this.setPlaybackState("stopped");
  }

  beginCalibration() {
    this.startCalibration();
    useAppStore.getState().setCalibrationStage("collecting");
  }

  private bindStore() {
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

    this.trackUrlUnsub = useAppStore.subscribe(
      (state) => [state.instrumentUrl, state.guideUrl] as const,
      async ([instrumentUrl, guideUrl]) => {
        const resolvedInstrument = instrumentUrl ?? defaultConfig.media.instrumentUrl;
        const resolvedGuide = guideUrl ?? defaultConfig.media.guideUrl;

        const mediaChanged =
          this.config.media.instrumentUrl !== resolvedInstrument ||
          this.config.media.guideUrl !== resolvedGuide;

        this.config.media.instrumentUrl = resolvedInstrument;
        this.config.media.guideUrl = resolvedGuide;

        if (mediaChanged && this.initialised) {
          const wasPlaying = this.currentPlaybackState === "playing";
          await this.loadMedia();
          this.playbackOffset = 0;
          if (wasPlaying) {
            await this.play();
          } else {
            this.stopMedia();
            this.setPlaybackState("stopped");
          }
        }
      },
      { equalityFn: shallow }
    );
  }

  private enqueueBlock(block: Float32Array) {
    this.queue.push(block);
    if (!this.processing) {
      void this.drainQueue();
    }
  }

  private async drainQueue() {
    this.processing = true;
    while (this.queue.length > 0) {
      const block = this.queue.shift() as Float32Array;
      await this.processBlock(block);
    }
    this.processing = false;
  }

  private async processBlock(block: Float32Array) {
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
      if (this.vadOffset === VAD_FRAME_SOURCE) {
        vadJobs.push(this.downsampleFrame(this.vadBuffer, VAD_FRAME_TARGET));
        this.vadOffset = 0;
      }

      this.pitchBuffer[this.pitchOffset++] = sample;
      if (this.pitchOffset === PITCH_FRAME_SOURCE) {
        pitchJobs.push(this.downsampleFrame(this.pitchBuffer, PITCH_FRAME_TARGET));
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
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "gain", value: this.currentGain });
    }

    if (this.guideGainNode && this.audioContext) {
      const target = this.currentGain * this.guideBaseGain;
      this.guideGainNode.gain.setTargetAtTime(target, this.audioContext.currentTime, 0.01);
    }

    this.telemetry.record({
      timestamp: performance.now(),
      vad: this.lastVad,
      pitch: this.lastPitch,
      confidence: this.lastConfidence,
      gainDb
    });

    const rms = this.calculateRms(block);
    const outputRms = Math.min(1, Math.sqrt((rms * this.currentGain * this.guideBaseGain) ** 2 + this.instrumentBaseGain ** 2));
    store.setLevels(rms, outputRms);
    store.setConfidence(this.lastConfidence);
  }

  private async evaluateVad(frame: Float32Array) {
    if (!this.vadSession) return;
    try {
      const inputTensor = new ort.Tensor("float32", frame, [1, frame.length]);
      const stateTensor = new ort.Tensor("float32", this.vadState, [2, 1, 128]);
      const srTensor = new ort.Tensor("int64", new BigInt64Array([BigInt(SAMPLE_RATE_TARGET)]));

      const feeds: Record<string, ort.Tensor> = {
        input: inputTensor,
        state: stateTensor,
        sr: srTensor
      };

      const outputs = await this.vadSession.run(feeds);
      const outputTensor = outputs.output;
      const stateN = outputs.stateN;

      if (outputTensor && outputTensor.data instanceof Float32Array) {
        this.lastVad = outputTensor.data[0] ?? 0;
      } else if (outputTensor && Array.isArray(outputTensor.data)) {
        this.lastVad = Number(outputTensor.data[0]) || 0;
      }

      if (stateN && stateN.data instanceof Float32Array) {
        this.vadState.set(stateN.data);
      }
    } catch {
      this.lastVad = 0;
    }
  }

  private async evaluatePitch(frame: Float32Array) {
    if (!this.pitchSession) return;
    try {
      const tensor = new ort.Tensor("float32", frame, [1, frame.length]);
      const output = await this.pitchSession.run({ audio: tensor });
      const probabilities = output.probabilities;

      if (probabilities && probabilities.data instanceof Float32Array) {
        this.lastPitch = probabilities.data.reduce((max, value) => (value > max ? value : max), 0);
      } else if (probabilities && Array.isArray(probabilities.data)) {
        this.lastPitch = probabilities.data.reduce((max: number, value: number) => (value > max ? value : max), 0);
      }
    } catch {
      this.lastPitch = 0;
    }
  }

  private updateConfidence() {
    const weights = this.config.confidenceWeights;
    const combined = weights.vad * this.lastVad + weights.pitch * this.lastPitch + weights.phraseAware * 0;
    this.lastConfidence = Math.min(1, Math.max(0, combined));
  }

  private calculateRms(block: Float32Array) {
    let sum = 0;
    for (let i = 0; i < block.length; i += 1) {
      sum += block[i] * block[i];
    }
    return Math.sqrt(sum / block.length);
  }

  private startCalibration() {
    this.calibrator.start(this.config.sampleRate, 10);
    this.calibrating = true;
    this.telemetry.reset();
  }

  resetCalibration() {
    this.calibrating = false;
    useAppStore.getState().setCalibrationResult(null);
    useAppStore.getState().setCalibrationStage("idle");
    this.telemetry.reset();
  }

  downloadTelemetry() {
    this.telemetry.download();
  }

  dispose() {
    this.manualModeUnsub?.();
    this.calibrationStageUnsub?.();
    this.trackUrlUnsub?.();
    this.manualModeUnsub = null;
    this.calibrationStageUnsub = null;
    this.trackUrlUnsub = null;

    this.stop();
    this.workletNode?.disconnect();
    this.micGainNode?.disconnect();
    this.streamSource?.disconnect();
    this.workletNode = null;
    this.micGainNode = null;
    this.streamSource = null;

    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;

    this.instrumentBuffer = null;
    this.guideBuffer = null;
    this.vadSession = null;
    this.pitchSession = null;
    this.queue = [];
    this.processing = false;
    this.playbackOffset = 0;
    this.playbackStartTime = 0;
    this.lastVad = 0;
    this.lastPitch = 0;
    this.lastConfidence = 0;
    this.currentGain = 1;
    this.calibrating = false;
    this.initialised = false;
  }

  private normalizeOffset(offset: number, duration: number) {
    if (!isFinite(offset) || duration <= 0) {
      return 0;
    }
    const normalized = offset % duration;
    return normalized < 0 ? normalized + duration : normalized;
  }

  private downsampleFrame(source: Float32Array, targetLength: number): Float32Array {
    const factor = source.length / targetLength;
    const result = new Float32Array(targetLength);

    for (let i = 0; i < targetLength; i += 1) {
      const start = Math.floor(i * factor);
      const end = Math.min(source.length, Math.floor((i + 1) * factor));
      const count = Math.max(1, end - start);
      let sum = 0;
      for (let j = 0; j < count; j += 1) {
        sum += source[start + j];
      }
      result[i] = sum / count;
    }

    return result;
  }
}

export const audioEngine = new AudioEngine();
