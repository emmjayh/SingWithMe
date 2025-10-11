import * as ort from "onnxruntime-web";
import { ManualMode, useAppStore, CalibrationStage, PlaybackState } from "@state/useAppStore";
import { ConfidenceGate, GateConfig, dbToLinear } from "./confidenceGate";
import { Calibrator } from "./calibrator";
import { TelemetryLog } from "./telemetry";
import { PitchShifter } from "soundtouchjs";
import { shallow } from "zustand/shallow";

const AUDIO_WORKLET_URL = "/worklets/confidence-gate.worklet.js";
const SAMPLE_RATE_TARGET = 16000;
const VAD_FRAME_SOURCE = 480; // 10 ms @ 48 kHz
const VAD_FRAME_TARGET = 160; // 10 ms @ 16 kHz
const PITCH_FRAME_SOURCE = 3072; // 64 ms @ 48 kHz
const PITCH_FRAME_TARGET = 1024; // 64 ms @ 16 kHz

const CREPE_CENTS_MAPPING = new Float32Array(360);
for (let i = 0; i < CREPE_CENTS_MAPPING.length; i += 1) {
  CREPE_CENTS_MAPPING[i] = 1997.3794084376191 + (7180 / 359) * i;
}

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
    micMonitorGainDb: Number.NEGATIVE_INFINITY
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
  private vocalBusNode: GainNode | null = null;
  private guidePitchShifter: PitchShifter | null = null;
  private guidePitchNode: AudioNode | null = null;
  private instrumentBaseGain = 1;
  private guideBaseGain = 1;

  private playbackOffset = 0;
  private playbackStartTime = 0;

  private lastVad = 0;
  private lastPitch = 0;
  private lastPitchHz = 0;
  private lastConfidence = 0;
  private currentGain = 1;
  private calibrating = false;
  private guidePitchTrack: Float32Array = new Float32Array();
  private guidePitchConfidenceTrack: Float32Array = new Float32Array();
  private guidePitchAnalysisToken = 0;
  private currentPitchRatio = 1;

  async initialise() {
    if (this.initialised) return;

    this.config = defaultConfig;
    const trackState = useAppStore.getState();
    this.config.media.instrumentUrl = trackState.instrumentUrl ?? defaultConfig.media.instrumentUrl;
    this.config.media.guideUrl = trackState.guideUrl ?? defaultConfig.media.guideUrl;
    this.gate.configure(this.config.sampleRate, this.config.bufferSamples, this.config.gate);
    this.currentGain = this.gate.currentGainLinear();
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
    const monitorGainLinear = dbToLinear(this.config.media.micMonitorGainDb ?? Number.NEGATIVE_INFINITY);
    this.micGainNode.gain.value = monitorGainLinear;

    this.streamSource.connect(this.workletNode);
    this.workletNode.connect(this.micGainNode);

    this.vocalBusNode?.disconnect();
    this.vocalBusNode = this.audioContext.createGain();
    this.vocalBusNode.gain.value = 1;
    this.vocalBusNode.connect(this.audioContext.destination);

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

    if (this.guideBuffer) {
      await this.analyzeGuidePitch();
    }
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

    if (this.pitchSession && this.guideBuffer) {
      await this.analyzeGuidePitch();
    } else {
      this.resetGuidePitchTrack();
    }
  }

  private resetGuidePitchTrack() {
    this.guidePitchTrack = new Float32Array();
    this.guidePitchConfidenceTrack = new Float32Array();
  }

  private async analyzeGuidePitch() {
    if (!this.guideBuffer || !this.pitchSession) {
      this.resetGuidePitchTrack();
      return;
    }

    const token = ++this.guidePitchAnalysisToken;
    const channelCount = this.guideBuffer.numberOfChannels;
    const totalSamples = this.guideBuffer.length;
    const hopSamples = this.config.bufferSamples;

    if (totalSamples <= 0 || channelCount <= 0) {
      this.resetGuidePitchTrack();
      return;
    }

    const effectiveLength = Math.max(totalSamples, PITCH_FRAME_SOURCE);
    const frameCount = Math.max(
      1,
      Math.ceil((effectiveLength - PITCH_FRAME_SOURCE) / hopSamples) + 1
    );

    const track = new Float32Array(frameCount);
    const confidenceTrack = new Float32Array(frameCount);
    const channelData: Float32Array[] = [];
    for (let channel = 0; channel < channelCount; channel += 1) {
      channelData.push(this.guideBuffer.getChannelData(channel));
    }

    const frame = new Float32Array(PITCH_FRAME_SOURCE);

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const start = frameIndex * hopSamples;
      for (let i = 0; i < PITCH_FRAME_SOURCE; i += 1) {
        const sampleIndex = start + i;
        if (sampleIndex < totalSamples) {
          let sample = 0;
          for (let channel = 0; channel < channelCount; channel += 1) {
            sample += channelData[channel][sampleIndex];
          }
          frame[i] = sample / channelCount;
        } else {
          frame[i] = 0;
        }
      }

      const downsampled = this.downsampleFrame(frame, PITCH_FRAME_TARGET);
      const result = await this.inferPitch(downsampled);

      if (token !== this.guidePitchAnalysisToken) {
        return;
      }

      track[frameIndex] = result?.frequency ?? 0;
      confidenceTrack[frameIndex] = result?.confidence ?? 0;
    }

    if (token !== this.guidePitchAnalysisToken) {
      return;
    }

    this.guidePitchTrack = track;
    this.guidePitchConfidenceTrack = confidenceTrack;
  }

  private guidePitchAtTime(timeSeconds: number) {
    const info = this.guidePitchFrameAtTime(timeSeconds);
    return info.frequency;
  }

  private guidePitchFrameAtTime(timeSeconds: number) {
    if (!this.guideBuffer || this.guidePitchTrack.length === 0) {
      return { frequency: 0, confidence: 0 };
    }

    const hopSeconds = this.config.bufferSamples / this.config.sampleRate;
    if (hopSeconds <= 0) {
      return { frequency: 0, confidence: 0 };
    }

    const loopDuration = this.guideBuffer.duration;
    let normalizedTime = timeSeconds;

    if (this.config.media.loop && loopDuration > 0) {
      normalizedTime = ((normalizedTime % loopDuration) + loopDuration) % loopDuration;
    } else {
      normalizedTime = Math.max(0, Math.min(loopDuration, normalizedTime));
    }

    const frameIndex = Math.min(
      this.guidePitchTrack.length - 1,
      Math.max(0, Math.floor(normalizedTime / hopSeconds))
    );

    return {
      frequency: this.guidePitchTrack[frameIndex] ?? 0,
      confidence: this.guidePitchConfidenceTrack[frameIndex] ?? 0
    };
  }

  private getPlaybackPositionSeconds() {
    if (!this.audioContext) {
      return 0;
    }

    if (this.currentPlaybackState === "playing") {
      return Math.max(0, this.audioContext.currentTime - this.playbackStartTime);
    }

    return this.playbackOffset;
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
      const handleGuideEnd = () => {
        if (this.config.media.loop) {
          if (this.guidePitchShifter) {
            this.guidePitchShifter.percentagePlayed = 0;
          }
        } else {
          this.stop();
        }
      };

      this.guidePitchShifter = new PitchShifter(this.audioContext, this.guideBuffer, undefined, handleGuideEnd);
      const guideNode = this.guidePitchShifter.node;
      this.guidePitchNode = guideNode;
      this.currentPitchRatio = 1;
      this.guidePitchShifter.pitch = this.currentPitchRatio;
      this.guidePitchShifter.rate = 1;
      this.guidePitchShifter.tempo = 1;

      if (guideDuration > 0) {
        const normalized = Math.max(0, Math.min(1, normalizedGuideOffset / guideDuration));
        this.guidePitchShifter.percentagePlayed = normalized;
      }

      this.guideGainNode = this.audioContext.createGain();
      this.guideGainNode.gain.value = this.currentGain * this.guideBaseGain;
      const guideSink: AudioNode = this.vocalBusNode ?? this.audioContext.destination;
      guideNode.connect(this.guideGainNode).connect(guideSink);
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

    if (this.guideGainNode) {
      this.guideGainNode.disconnect();
      this.guideGainNode = null;
    }
    if (this.guidePitchNode) {
      this.guidePitchNode.disconnect();
      this.guidePitchNode = null;
    }
    this.guidePitchShifter = null;
    this.guideSource = null;
    this.currentPitchRatio = 1;
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

    const rms = this.calculateRms(block);
    this.updateConfidence(rms);

    const gainDb = this.gate.update(this.lastConfidence);
    this.currentGain = dbToLinear(gainDb);
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "gain", value: this.currentGain });
    }

    if (this.guideGainNode && this.audioContext) {
      const target = this.currentGain * this.guideBaseGain;
      this.guideGainNode.gain.setTargetAtTime(target, this.audioContext.currentTime, 0.01);
    }

    if (this.guidePitchShifter) {
      const playbackTime = this.getPlaybackPositionSeconds();
      const ratio = this.computeGuidePitchRatio(playbackTime) ?? 1;
      const smoothing = 0.1;
      this.currentPitchRatio += (ratio - this.currentPitchRatio) * smoothing;
      this.guidePitchShifter.pitch = this.currentPitchRatio;
    }

    this.telemetry.record({
      timestamp: performance.now(),
      vad: this.lastVad,
      pitch: this.lastPitch,
      confidence: this.lastConfidence,
      gainDb
    });

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
    const result = await this.inferPitch(frame);
    if (!result) {
      this.lastPitch = 0;
      this.lastPitchHz = 0;
      return;
    }

    this.lastPitch = Math.min(1, Math.max(0, result.confidence));
    this.lastPitchHz = result.frequency;
  }

  private updateConfidence(rms?: number) {
    const weights = this.config.confidenceWeights;
    let combined = weights.vad * this.lastVad + weights.pitch * this.lastPitch + weights.phraseAware * 0;

    combined = Math.max(combined, this.lastVad);

    if (typeof rms === "number") {
      const energyConfidence = Math.min(1, rms / 0.05);
      combined = Math.max(combined, energyConfidence);
    }

    this.lastConfidence = Math.min(1, Math.max(0, combined));
  }

  private calculateRms(block: Float32Array) {
    let sum = 0;
    for (let i = 0; i < block.length; i += 1) {
      sum += block[i] * block[i];
    }
    return Math.sqrt(sum / block.length);
  }

  private computeFrequencyFromSalience(salience: Float32Array) {
    if (salience.length === 0) {
      return { frequency: 0, confidence: 0 };
    }

    let maxIndex = 0;
    let maxValue = salience[0] ?? 0;

    for (let i = 1; i < salience.length; i += 1) {
      const value = salience[i];
      if (value > maxValue) {
        maxValue = value;
        maxIndex = i;
      }
    }

    const windowRadius = 4;
    const start = Math.max(0, maxIndex - windowRadius);
    const end = Math.min(salience.length, maxIndex + windowRadius + 1);

    let weightSum = 0;
    let productSum = 0;

    for (let i = start; i < end; i += 1) {
      const weight = salience[i];
      weightSum += weight;
      productSum += weight * CREPE_CENTS_MAPPING[i];
    }

    const cents = weightSum > 0 ? productSum / weightSum : CREPE_CENTS_MAPPING[maxIndex];
    const frequency = 10 * Math.pow(2, cents / 1200);

    return {
      frequency: Number.isFinite(frequency) ? frequency : 0,
      confidence: Number.isFinite(maxValue) ? maxValue : 0
    };
  }

  private computeGuidePitchRatio(playbackTimeSeconds: number) {
    if (this.lastPitchHz <= 0 || this.lastPitch < 0.2) {
      return null;
    }

    const { frequency: guideFrequency, confidence: guideConfidence } = this.guidePitchFrameAtTime(playbackTimeSeconds);
    if (guideFrequency <= 0 || guideConfidence < 0.1) {
      return null;
    }

    const ratio = this.lastPitchHz / guideFrequency;
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return null;
    }

    return Math.min(2.5, Math.max(0.5, ratio));
  }

  private async inferPitch(frame: Float32Array) {
    if (!this.pitchSession) {
      return null;
    }
    try {
      const tensor = new ort.Tensor("float32", frame, [1, frame.length]);
      const output = await this.pitchSession.run({ audio: tensor });
      const probabilities = output.probabilities;
      let salience: Float32Array | null = null;

      if (probabilities && probabilities.data instanceof Float32Array) {
        salience = probabilities.data;
      } else if (probabilities && Array.isArray(probabilities.data)) {
        salience = Float32Array.from(probabilities.data);
      }

      if (!salience) {
        return null;
      }

      return this.computeFrequencyFromSalience(salience);
    } catch {
      return null;
    }
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
    this.vocalBusNode?.disconnect();
    this.workletNode = null;
    this.micGainNode = null;
    this.streamSource = null;
    this.vocalBusNode = null;

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
    this.lastPitchHz = 0;
    this.lastConfidence = 0;
    this.currentGain = 1;
    this.currentPitchRatio = 1;
    this.calibrating = false;
    this.guidePitchAnalysisToken += 1;
    this.resetGuidePitchTrack();
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
