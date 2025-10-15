import * as ort from "onnxruntime-web";
import { ManualMode, useAppStore, CalibrationStage, PlaybackState } from "@state/useAppStore";
import { ConfidenceGate, GateConfig, dbToLinear } from "./confidenceGate";
import { Calibrator } from "./calibrator";
import { TelemetryLog } from "./telemetry";
import { PitchShifter } from "soundtouchjs";
import { shallow } from "zustand/shallow";

const AUDIO_WORKLET_URL = "/worklets/confidence-gate.worklet.js";
const SAMPLE_RATE_TARGET = 16000;
const VAD_FRAME_SOURCE = 672; // 14 ms @ 48 kHz (minimum window for Silero VAD)
const VAD_FRAME_TARGET = 224; // 14 ms @ 16 kHz (minimum window for Silero VAD)
const PITCH_FRAME_SOURCE = 3072; // 64 ms @ 48 kHz
const PITCH_FRAME_TARGET = 1024; // 64 ms @ 16 kHz
const MAX_QUEUE_LENGTH = 32;

const CREPE_CENTS_MAPPING = new Float32Array(360);
for (let i = 0; i < CREPE_CENTS_MAPPING.length; i += 1) {
  CREPE_CENTS_MAPPING[i] = 1997.3794084376191 + (7180 / 359) * i;
}

const GUIDE_FLOOR = 0.05;
const STRENGTH_BLEND_BASE = 0.25;
const STRENGTH_BLEND_SCALE = 0.75;
const NOISE_GATE_RISE = 0.12;
const NOISE_GATE_FALL = 0.004;
const NOISE_GATE_HOLD_MS = 28;
const GUIDE_RELEASE_MIN_MS = 10;
const GUIDE_RELEASE_HOLD_MS = 48;
const TIMBRE_LPF_MS = 24;
const VOCAL_STRENGTH_RISE = 0.08;
const VOCAL_STRENGTH_FALL = 0.02;
const VOCAL_STRENGTH_SCALE = 12;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function msToOnePoleCoeff(ms: number, sampleRate: number) {
  if (ms <= 0 || sampleRate <= 0) {
    return 1;
  }
  const seconds = ms / 1000;
  const alpha = Math.exp(-1 / (sampleRate * seconds));
  return 1 - alpha;
}

interface MediaConfig {
  instrumentUrl: string | null;
  guideUrl: string | null;
  loop: boolean;
  instrumentGainDb: number;
  guideGainDb: number;
  micMonitorGainDb: number;
  playbackLeakCompensation: number;
  crowdCancelAdaptRate: number;
  crowdCancelRecoveryRate: number;
  crowdCancelClamp: number;
  reverbTailMix: number;
  reverbTailSeconds: number;
  timbreMatchStrength: number;
  envelopeHoldMs: number;
  envelopeReleaseMs: number;
  envelopeReleaseMod: number;
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
    instrumentUrl: import.meta.env.VITE_INSTRUMENT_URL ?? "/media/braykit-instrument.mp3",
    guideUrl: import.meta.env.VITE_GUIDE_URL ?? "/media/braykit-guide.mp3",
    loop: true,
    instrumentGainDb: 0,
    guideGainDb: 0,
    micMonitorGainDb: Number.NEGATIVE_INFINITY,
    playbackLeakCompensation: 0.6,
    crowdCancelAdaptRate: 0.0005,
    crowdCancelRecoveryRate: 0.00005,
    crowdCancelClamp: 1,
    reverbTailMix: 0.02,
    reverbTailSeconds: 0.32,
    timbreMatchStrength: 1,
    envelopeHoldMs: 70,
    envelopeReleaseMs: 236,
    envelopeReleaseMod: 0.29
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
  private vadFrameSource = VAD_FRAME_SOURCE;
  private pitchFrameSource = PITCH_FRAME_SOURCE;
  private vadFrameTarget = VAD_FRAME_TARGET;
  private pitchFrameTarget = PITCH_FRAME_TARGET;
  private vadBuffer = new Float32Array(this.vadFrameSource);
  private pitchBuffer = new Float32Array(this.pitchFrameSource);
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
  private instrumentGainNode: GainNode | null = null;
  private guideGainNode: GainNode | null = null;
  private vocalBusNode: GainNode | null = null;
  private guidePitchShifter: PitchShifter | null = null;
  private instrumentBaseGain = 1;
  private guideBaseGain = 1;
  private instrumentChannels: Float32Array[] = [];
  private guideChannels: Float32Array[] = [];
  private instrumentLength = 0;
  private guideLength = 0;
  private playbackSampleCursor = 0;
  private playbackLeakComp = 0.6;
  private adaptiveLeakComp = 0.6;
  private crowdCancelAdaptRate = 0.0005;
  private crowdCancelRecoveryRate = 0.00005;
  private crowdCancelClamp = 1;
  private noiseFloorAmplitude = 0.22;
  private vocalStrength = 0;
  private noiseGateState = 0;
  private noiseGateHoldSamples = 1;
  private noiseGateHoldRemaining = 0;
  private guideEnvelope = 0;
  private guideReleaseHoldSamples = 1;
  private guideReleaseHoldRemaining = 0;
  private tailFollower = 0;
  private tailRiseCoeff = 0.05;
  private tailFallCoeff = 0.003;
  private reverbTailMix = 0.02;
  private reverbFeedback = 0.85;
  private timbreMatchStrength = 1;
  private timbreTilt = 0;
  private brightnessLowEnv = 0;
  private brightnessHighEnv = 0;
  private lowpassCoeff = 0.1;
  private envelopeAttackCoeff = 0.001;
  private envelopeReleaseCoeff = 0.001;
  private envelopeReleaseMod = 0.29;
  private envelopeHoldMs = 70;
  private envelopeReleaseMs = 236;
  private micMonitorGainDb = Number.NEGATIVE_INFINITY;
  private micMonitorLinear = 0;
  private currentGuideMix = 0;
  private currentTailMix = 0;
  private lastGateDb = defaultConfig.gate.duckDb;
  private limiterGain = 1;
  private guideLowShelfNode: BiquadFilterNode | null = null;
  private guideHighShelfNode: BiquadFilterNode | null = null;
  private guidePreGainNode: GainNode | null = null;
  private guideDryGainNode: GainNode | null = null;
  private guideReverbInputNode: GainNode | null = null;
  private guideReverbDelayNode: DelayNode | null = null;
  private guideReverbFeedbackNode: GainNode | null = null;
  private guideReverbMixNode: GainNode | null = null;
  private guideSumNode: GainNode | null = null;

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
  private vadShapeWarningLogged = false;
  private lastVadFrameLength = 0;
  private vadFailed = false;
  private settingUnsubs: Array<() => void> = [];
  private resumeListener: ((event: Event) => void) | null = null;
  private readonly resumeEvents = ["pointerdown", "touchstart", "keydown"];
  private pitchAnalysisInProgress = false;

  async initialise() {
    if (this.initialised) return;

    this.config = defaultConfig;
    const trackState = useAppStore.getState();
    this.config.media.instrumentUrl = trackState.instrumentUrl ?? defaultConfig.media.instrumentUrl;
    this.config.media.guideUrl = trackState.guideUrl ?? defaultConfig.media.guideUrl;
    this.updateFrameDimensions(this.config.sampleRate);
    this.gate.configure(this.config.sampleRate, this.config.bufferSamples, this.config.gate);
    this.currentGain = this.gate.currentGainLinear();
    this.instrumentBaseGain = dbToLinear(this.config.media.instrumentGainDb ?? 0);
    this.guideBaseGain = dbToLinear(this.config.media.guideGainDb ?? 0);
    this.micMonitorGainDb = this.config.media.micMonitorGainDb ?? Number.NEGATIVE_INFINITY;
    this.micMonitorLinear = dbToLinear(this.micMonitorGainDb);
    this.playbackLeakComp = clamp(this.config.media.playbackLeakCompensation ?? 0.6, 0, 1);
    this.adaptiveLeakComp = this.playbackLeakComp;
    this.crowdCancelAdaptRate = this.config.media.crowdCancelAdaptRate ?? 0.0005;
    this.crowdCancelRecoveryRate = this.config.media.crowdCancelRecoveryRate ?? 0.00005;
    this.crowdCancelClamp = this.config.media.crowdCancelClamp ?? 1;
    this.reverbTailMix = this.config.media.reverbTailMix ?? 0.02;
    this.envelopeHoldMs = this.config.media.envelopeHoldMs ?? 70;
    this.envelopeReleaseMs = this.config.media.envelopeReleaseMs ?? 236;
    this.envelopeReleaseMod = this.config.media.envelopeReleaseMod ?? 0.29;
    this.timbreMatchStrength = this.config.media.timbreMatchStrength ?? 1;
    this.noiseFloorAmplitude = trackState.noiseFloor ?? 0.22;
    this.updateTimingCoefficients();
    this.updateReverbCoefficients(this.config.media.reverbTailSeconds ?? 0.32);
    this.resetDynamicsState(true);
    this.vadState.fill(0);

    await this.setupAudioGraph();
    this.ensureInteractiveResume();
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
    if (this.audioContext.state !== "running") {
      this.ensureInteractiveResume();
    }
    await this.audioContext.audioWorklet.addModule(AUDIO_WORKLET_URL);

    const actualSampleRate = this.audioContext.sampleRate;
    this.updateFrameDimensions(actualSampleRate);
    if (Math.abs(actualSampleRate - this.config.sampleRate) > 1) {
      this.config.sampleRate = actualSampleRate;
      this.gate.configure(this.config.sampleRate, this.config.bufferSamples, this.config.gate);
      this.updateTimingCoefficients();
    }

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
    this.micGainNode.gain.value = this.micMonitorLinear;

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
      void this.analyzeGuidePitch().catch(() => {
        this.resetGuidePitchTrack();
      });
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

    this.instrumentChannels = [];
    if (this.instrumentBuffer) {
      for (let channel = 0; channel < this.instrumentBuffer.numberOfChannels; channel += 1) {
        this.instrumentChannels.push(this.instrumentBuffer.getChannelData(channel));
      }
    }
    this.instrumentLength = this.instrumentBuffer?.length ?? 0;

    this.guideChannels = [];
    if (this.guideBuffer) {
      for (let channel = 0; channel < this.guideBuffer.numberOfChannels; channel += 1) {
        this.guideChannels.push(this.guideBuffer.getChannelData(channel));
      }
    }
    this.guideLength = this.guideBuffer?.length ?? 0;
    this.resetDynamicsState();
    this.playbackSampleCursor = 0;

    if (this.pitchSession && this.guideBuffer) {
      void this.analyzeGuidePitch().catch(() => {
        this.resetGuidePitchTrack();
      });
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
    const guideSampleRate = this.guideBuffer.sampleRate || this.config.sampleRate;
    const hopSamples = Math.max(
      1,
      Math.round(guideSampleRate * (this.config.bufferSamples / this.config.sampleRate))
    );

    if (totalSamples <= 0 || channelCount <= 0) {
      this.resetGuidePitchTrack();
      return;
    }

    const frameSource = Math.max(this.pitchFrameTarget, Math.round(guideSampleRate * 0.064));
    const effectiveLength = Math.max(totalSamples, frameSource);
    const frameCount = Math.max(
      1,
      Math.ceil((effectiveLength - frameSource) / hopSamples) + 1
    );

    const track = new Float32Array(frameCount);
    const confidenceTrack = new Float32Array(frameCount);
    const channelData: Float32Array[] = [];
    for (let channel = 0; channel < channelCount; channel += 1) {
      channelData.push(this.guideBuffer.getChannelData(channel));
    }

    const frame = new Float32Array(frameSource);
    this.pitchAnalysisInProgress = true;

    try {
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const start = frameIndex * hopSamples;
        for (let i = 0; i < frameSource; i += 1) {
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

        const downsampled = this.downsampleFrame(frame, this.pitchFrameTarget);
        const result = await this.inferPitch(downsampled, { bypassBusyCheck: true });

        if (token !== this.guidePitchAnalysisToken) {
          return;
        }

        track[frameIndex] = result?.frequency ?? 0;
        confidenceTrack[frameIndex] = result?.confidence ?? 0;
        // Yield so realtime pitch/VAD processing keeps the event loop responsive.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      this.pitchAnalysisInProgress = false;
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

  private updateTimingCoefficients() {
    const sampleRate = this.config.sampleRate;
    this.lowpassCoeff = msToOnePoleCoeff(TIMBRE_LPF_MS, sampleRate);
    this.envelopeAttackCoeff = msToOnePoleCoeff(20, sampleRate);
    const releaseMs = Math.max(GUIDE_RELEASE_MIN_MS, this.envelopeReleaseMs);
    this.envelopeReleaseCoeff = msToOnePoleCoeff(releaseMs, sampleRate);
    const holdMs = Math.max(10, this.envelopeHoldMs);
    this.guideReleaseHoldSamples = Math.max(1, Math.round((sampleRate * holdMs) / 1000));
    this.noiseGateHoldSamples = Math.max(1, Math.round((sampleRate * NOISE_GATE_HOLD_MS) / 1000));
  }

  private updateFrameDimensions(sampleRate: number) {
    const newVadSource = VAD_FRAME_SOURCE;
    if (newVadSource !== this.vadFrameSource) {
      this.vadFrameSource = newVadSource;
      this.vadBuffer = new Float32Array(this.vadFrameSource);
      this.vadOffset = 0;
    }

    const newPitchSource = PITCH_FRAME_SOURCE;
    if (newPitchSource !== this.pitchFrameSource) {
      this.pitchFrameSource = newPitchSource;
      this.pitchBuffer = new Float32Array(this.pitchFrameSource);
      this.pitchOffset = 0;
    }
  }

  private updateReverbCoefficients(tailSeconds: number) {
    const seconds = Math.max(0.05, tailSeconds);
    const sampleRate = this.config.sampleRate;
    const feedback = Math.exp(-1 / (sampleRate * seconds));
    this.reverbFeedback = Math.min(feedback, 0.85);
    const fall = 1 - Math.exp(-this.config.bufferSamples / (sampleRate * seconds * 8));
    this.tailFallCoeff = clamp(fall, 0.0005, 0.2);
  }

  private resetDynamicsState(keepLeak = false) {
    if (!keepLeak) {
      this.adaptiveLeakComp = this.playbackLeakComp;
    }
    this.vocalStrength = 0;
    this.noiseGateState = 0;
    this.noiseGateHoldRemaining = 0;
    this.guideEnvelope = 0;
    this.guideReleaseHoldRemaining = 0;
    this.tailFollower = 0;
    this.timbreTilt = 0;
    this.brightnessLowEnv = 0;
    this.brightnessHighEnv = 0;
    this.currentGuideMix = 0;
    this.currentTailMix = 0;
    this.lastGateDb = this.config.gate.duckDb;
    this.limiterGain = 1;
    this.applyGuideProcessing();
  }

  private applyGuideProcessing() {
    if (!this.audioContext) {
      return;
    }
    const now = this.audioContext.currentTime;
    const dryGain = this.currentGuideMix * (1 - this.currentTailMix);

    if (this.guidePreGainNode) {
      this.guidePreGainNode.gain.setTargetAtTime(this.guideBaseGain, now, 0.01);
    }
    if (this.guideDryGainNode) {
      this.guideDryGainNode.gain.setTargetAtTime(dryGain, now, 0.01);
    }
    if (this.guideReverbInputNode) {
      this.guideReverbInputNode.gain.setTargetAtTime(this.currentGuideMix, now, 0.01);
    }
    if (this.guideReverbMixNode) {
      this.guideReverbMixNode.gain.setTargetAtTime(this.currentTailMix, now, 0.02);
    }
    if (this.guideReverbFeedbackNode) {
      this.guideReverbFeedbackNode.gain.setTargetAtTime(this.reverbFeedback, now, 0.05);
    }

    const tiltLow = clamp(1 - this.timbreTilt, 0.2, 2);
    const tiltHigh = clamp(1 + this.timbreTilt, 0.2, 2.5);
    const lowDb = 20 * Math.log10(tiltLow);
    const highDb = 20 * Math.log10(tiltHigh);

    if (this.guideLowShelfNode) {
      this.guideLowShelfNode.gain.setTargetAtTime(lowDb, now, 0.05);
    }
    if (this.guideHighShelfNode) {
      this.guideHighShelfNode.gain.setTargetAtTime(highDb, now, 0.05);
    }
  }

  private applyNoiseFloor(amplitude: number) {
    this.noiseFloorAmplitude = clamp(amplitude, 0, 0.6);
  }

  private applyMicMonitorGain(gainDb: number) {
    const clamped = clamp(gainDb, -60, 6);
    this.micMonitorGainDb = clamped;
    this.micMonitorLinear = dbToLinear(clamped);
    if (this.audioContext && this.micGainNode) {
      this.micGainNode.gain.setTargetAtTime(this.micMonitorLinear, this.audioContext.currentTime, 0.02);
    }
  }

  private applyCrowdCancelStrength(strength: number) {
    const clamped = clamp(strength, 0, 1);
    this.crowdCancelAdaptRate = 0.0001 + clamped * 0.0004;
    this.crowdCancelRecoveryRate = 0.00005 + (1 - clamped) * 0.00025;
    this.crowdCancelClamp = 0.6 + clamped * 0.4;
  }

  private applyReverbStrength(strength: number) {
    const clamped = clamp(strength, 0, 1);
    const mix = 0.02 + clamped * 0.28;
    const seconds = 0.2 + clamped * 0.6;
    this.reverbTailMix = mix;
    this.updateReverbCoefficients(seconds);
    this.applyGuideProcessing();
  }

  private applyTimbreStrength(strength: number) {
    const clamped = clamp(strength, 0, 1);
    this.timbreMatchStrength = 0.2 + clamped * 0.8;
  }

  private applyPhraseSmoothness(strength: number) {
    const clamped = clamp(strength, 0, 1);
    this.envelopeHoldMs = 60 + clamped * 90;
    this.envelopeReleaseMs = 220 + clamped * 160;
    this.envelopeReleaseMod = 0.25 + clamped * 0.4;
    this.updateTimingCoefficients();
  }

  private buildGuideChain(destination: AudioNode) {
    if (!this.audioContext || !this.guidePitchShifter) {
      return;
    }

    this.teardownGuideChain();
    const ctx = this.audioContext;

    this.guideLowShelfNode = ctx.createBiquadFilter();
    this.guideLowShelfNode.type = "lowshelf";
    this.guideLowShelfNode.frequency.value = 380;
    this.guideLowShelfNode.gain.value = 0;

    this.guideHighShelfNode = ctx.createBiquadFilter();
    this.guideHighShelfNode.type = "highshelf";
    this.guideHighShelfNode.frequency.value = 2800;
    this.guideHighShelfNode.gain.value = 0;

    this.guidePreGainNode = ctx.createGain();
    this.guidePreGainNode.gain.value = this.guideBaseGain;

    this.guideDryGainNode = ctx.createGain();
    this.guideDryGainNode.gain.value = 0;

    this.guideReverbInputNode = ctx.createGain();
    this.guideReverbInputNode.gain.value = 0;

    this.guideReverbDelayNode = ctx.createDelay(1);
    this.guideReverbDelayNode.delayTime.value = 0.055;

    this.guideReverbFeedbackNode = ctx.createGain();
    this.guideReverbFeedbackNode.gain.value = this.reverbFeedback;

    this.guideReverbMixNode = ctx.createGain();
    this.guideReverbMixNode.gain.value = 0;

    this.guideSumNode = ctx.createGain();
    this.guideSumNode.gain.value = 1;

    this.guideGainNode = ctx.createGain();
    this.guideGainNode.gain.value = 1;

    this.guidePitchShifter.connect(this.guideLowShelfNode);
    this.guideLowShelfNode.connect(this.guideHighShelfNode);
    this.guideHighShelfNode.connect(this.guidePreGainNode);

    this.guidePreGainNode.connect(this.guideDryGainNode);
    this.guideDryGainNode.connect(this.guideSumNode);

    this.guidePreGainNode.connect(this.guideReverbInputNode);
    this.guideReverbInputNode.connect(this.guideReverbDelayNode);
    this.guideReverbDelayNode.connect(this.guideReverbMixNode);
    this.guideReverbMixNode.connect(this.guideSumNode);
    this.guideReverbDelayNode.connect(this.guideReverbFeedbackNode);
    this.guideReverbFeedbackNode.connect(this.guideReverbDelayNode);

    this.guideSumNode.connect(this.guideGainNode);
    this.guideGainNode.connect(destination);

    this.applyGuideProcessing();
  }

  private teardownGuideChain() {
    const nodes: Array<AudioNode | null> = [
      this.guideLowShelfNode,
      this.guideHighShelfNode,
      this.guidePreGainNode,
      this.guideDryGainNode,
      this.guideReverbInputNode,
      this.guideReverbDelayNode,
      this.guideReverbFeedbackNode,
      this.guideReverbMixNode,
      this.guideSumNode,
      this.guideGainNode
    ];

    for (const node of nodes) {
      try {
        node?.disconnect();
      } catch {
        /* ignore */
      }
    }

    this.guideLowShelfNode = null;
    this.guideHighShelfNode = null;
    this.guidePreGainNode = null;
    this.guideDryGainNode = null;
    this.guideReverbInputNode = null;
    this.guideReverbDelayNode = null;
    this.guideReverbFeedbackNode = null;
    this.guideReverbMixNode = null;
    this.guideSumNode = null;
    this.guideGainNode = null;
  }

  private updateGuideEnvelope(frameMax: number, playing: boolean) {
    let desiredNoiseGate = frameMax > this.noiseFloorAmplitude ? 1 : 0;
    if (desiredNoiseGate >= 0.5) {
      this.noiseGateHoldRemaining = this.noiseGateHoldSamples;
    } else if (this.noiseGateHoldRemaining > 0) {
      desiredNoiseGate = 1;
      this.noiseGateHoldRemaining -= 1;
    }

    const noiseCoeff = desiredNoiseGate > this.noiseGateState ? NOISE_GATE_RISE : NOISE_GATE_FALL;
    this.noiseGateState += (desiredNoiseGate - this.noiseGateState) * noiseCoeff;
    this.noiseGateState = clamp(this.noiseGateState, 0, 1);

    const gainDb = this.gate.update(this.lastConfidence);
    this.currentGain = dbToLinear(gainDb);
    this.lastGateDb = gainDb;
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "gain", value: this.currentGain });
    }

    const duckDb = this.config.gate.duckDb;
    const gateNormalized = clamp((gainDb - duckDb) / (0 - duckDb), 0, 1);
    const gateTarget = (playing ? gateNormalized : 0) * this.noiseGateState;

    if (gateTarget >= this.guideEnvelope) {
      this.guideEnvelope += this.envelopeAttackCoeff * (gateTarget - this.guideEnvelope);
      this.guideReleaseHoldRemaining = this.guideReleaseHoldSamples;
    } else {
      if (this.guideReleaseHoldRemaining > 0) {
        this.guideReleaseHoldRemaining -= 1;
      } else {
        const releaseCoeff = this.envelopeReleaseCoeff * (1 - this.envelopeReleaseMod * this.lastConfidence);
        this.guideEnvelope += releaseCoeff * (gateTarget - this.guideEnvelope);
      }
    }
    this.guideEnvelope = clamp(this.guideEnvelope, 0, 1);

    const envelope = Math.max(GUIDE_FLOOR, this.guideEnvelope);
    const strengthBlend = clamp(STRENGTH_BLEND_BASE + this.vocalStrength * STRENGTH_BLEND_SCALE, 0, 1);
    const guideMix = envelope * strengthBlend;

    if (envelope >= this.tailFollower) {
      this.tailFollower += this.tailRiseCoeff * (envelope - this.tailFollower);
    } else {
      this.tailFollower += this.tailFallCoeff * (envelope - this.tailFollower);
    }
    this.tailFollower = clamp(this.tailFollower, 0, 1);
    const tailMix = clamp(this.reverbTailMix * this.tailFollower * this.tailFollower, 0, 0.4);

    this.currentGuideMix = playing ? guideMix : 0;
    this.currentTailMix = playing ? tailMix : 0;
    this.applyGuideProcessing();
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
      this.currentPitchRatio = 1;
      this.guidePitchShifter.pitch = this.currentPitchRatio;
      this.guidePitchShifter.rate = 1;
      this.guidePitchShifter.tempo = 1;

      if (guideDuration > 0) {
        const normalized = Math.max(0, Math.min(1, normalizedGuideOffset / guideDuration));
        this.guidePitchShifter.percentagePlayed = normalized;
      }

      const guideSink: AudioNode = this.vocalBusNode ?? this.audioContext.destination;
      this.buildGuideChain(guideSink);
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

    this.teardownGuideChain();
    if (this.guidePitchShifter) {
      this.guidePitchShifter.disconnect();
      this.guidePitchShifter = null;
    }
    this.currentPitchRatio = 1;
    this.resetDynamicsState();
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

    await this.audioContext.resume().catch(() => undefined);
    if (this.audioContext.state !== "running") {
      this.ensureInteractiveResume();
      return;
    }
    const offset = this.playbackOffset;
    this.playbackSampleCursor = Math.max(
      0,
      Math.floor(offset * this.config.sampleRate)
    );
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
    this.playbackSampleCursor = Math.max(
      0,
      Math.floor(this.playbackOffset * this.config.sampleRate)
    );
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
    this.playbackSampleCursor = 0;
    this.setPlaybackState("stopped");
  }

  beginCalibration() {
    this.startCalibration();
    useAppStore.getState().setCalibrationStage("collecting");
  }

  private bindStore() {
    this.settingUnsubs.forEach((fn) => fn());
    this.settingUnsubs = [];

    const store = useAppStore.getState();
    this.gate.setManualMode(store.manualMode);
    this.applyNoiseFloor(store.noiseFloor);
    this.applyMicMonitorGain(store.micMonitorGainDb);
    this.applyCrowdCancelStrength(store.crowdCancelStrength);
    this.applyReverbStrength(store.reverbStrength);
    this.applyTimbreStrength(store.timbreStrength);
    this.applyPhraseSmoothness(store.phraseSmoothness);

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

    this.settingUnsubs.push(
      useAppStore.subscribe((state) => state.noiseFloor, (value) => this.applyNoiseFloor(value))
    );
    this.settingUnsubs.push(
      useAppStore.subscribe(
        (state) => state.micMonitorGainDb,
        (value) => this.applyMicMonitorGain(value)
      )
    );
    this.settingUnsubs.push(
      useAppStore.subscribe(
        (state) => state.crowdCancelStrength,
        (value) => this.applyCrowdCancelStrength(value)
      )
    );
    this.settingUnsubs.push(
      useAppStore.subscribe(
        (state) => state.reverbStrength,
        (value) => this.applyReverbStrength(value)
      )
    );
    this.settingUnsubs.push(
      useAppStore.subscribe(
        (state) => state.timbreStrength,
        (value) => this.applyTimbreStrength(value)
      )
    );
    this.settingUnsubs.push(
      useAppStore.subscribe(
        (state) => state.phraseSmoothness,
        (value) => this.applyPhraseSmoothness(value)
      )
    );
  }

  private enqueueBlock(block: Float32Array) {
    this.queue.push(block);
    if (this.queue.length > MAX_QUEUE_LENGTH) {
      this.queue.splice(0, this.queue.length - MAX_QUEUE_LENGTH);
      // eslint-disable-next-line no-console
      console.warn("AudioEngine queue overflow, dropping oldest blocks");
    }
    if (!this.processing) {
      void this.drainQueue();
    }
  }

  private async drainQueue() {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const block = this.queue.shift() as Float32Array;
        try {
          await this.processBlock(block);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error("AudioEngine block processing failed", error);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private ensureInteractiveResume() {
    if (!this.audioContext) {
      this.clearResumeListener();
      return;
    }

    if (this.audioContext.state === "running") {
      this.clearResumeListener();
      return;
    }

    if (this.resumeListener) {
      return;
    }

    const handler = async () => {
      if (!this.audioContext) {
        this.clearResumeListener();
        return;
      }

      try {
        await this.audioContext.resume();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("AudioEngine resume failed", error);
        return;
      }

      if (this.audioContext.state === "running") {
        this.clearResumeListener();
      }
    };

    this.resumeListener = handler;
    for (const event of this.resumeEvents) {
      window.addEventListener(event, handler);
    }
  }

  private clearResumeListener() {
    if (!this.resumeListener) {
      return;
    }

    for (const event of this.resumeEvents) {
      window.removeEventListener(event, this.resumeListener);
    }
    this.resumeListener = null;
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

    const playing = this.currentPlaybackState === "playing";
    let cursor = this.playbackSampleCursor;
    const instrumentLength = this.instrumentLength;
    const instrumentChannels = this.instrumentChannels;
    const instrumentChannelCount = instrumentChannels.length;

    let frameMax = 0;
    let energySum = 0;

    for (let i = 0; i < block.length; i += 1) {
      const sample = block[i];
      energySum += sample * sample;

      let instrumentMono = 0;
      if (playing && instrumentLength > 0 && instrumentChannelCount > 0) {
        const index = cursor % instrumentLength;
        const left = instrumentChannels[0][index] ?? 0;
        const right = instrumentChannelCount > 1 ? instrumentChannels[1][index] : left;
        instrumentMono = 0.5 * (left + right) * this.instrumentBaseGain;
      }

      let detection = sample;
      if (playing && Math.abs(instrumentMono) > 1.0e-4) {
        const leakEstimate = instrumentMono * this.adaptiveLeakComp;
        detection -= leakEstimate;
        this.adaptiveLeakComp += this.crowdCancelAdaptRate * instrumentMono * detection;
        this.adaptiveLeakComp = clamp(this.adaptiveLeakComp, 0, this.crowdCancelClamp);
      } else {
        this.adaptiveLeakComp += this.crowdCancelRecoveryRate * (this.playbackLeakComp - this.adaptiveLeakComp);
      }
      detection = clamp(detection, -1, 1);

      const absDetection = Math.abs(detection);
      frameMax = Math.max(frameMax, absDetection);

      const lifted = Math.max(0, absDetection - this.noiseFloorAmplitude);
      const strengthSample = Math.min(1, lifted * VOCAL_STRENGTH_SCALE);
      const strengthCoeff = strengthSample > this.vocalStrength ? VOCAL_STRENGTH_RISE : VOCAL_STRENGTH_FALL;
      this.vocalStrength += strengthCoeff * (strengthSample - this.vocalStrength);
      this.vocalStrength = clamp(this.vocalStrength, 0, 1);

      this.brightnessLowEnv += this.lowpassCoeff * (absDetection - this.brightnessLowEnv);
      const highInstant = Math.abs(detection - this.brightnessLowEnv);
      this.brightnessHighEnv += (this.lowpassCoeff * 0.5) * (highInstant - this.brightnessHighEnv);
      const brightnessDelta = this.brightnessHighEnv - this.brightnessLowEnv;
      const tiltTarget = clamp(brightnessDelta * this.timbreMatchStrength, -this.timbreMatchStrength, this.timbreMatchStrength);
      this.timbreTilt += 0.05 * (tiltTarget - this.timbreTilt);
      this.timbreTilt = clamp(this.timbreTilt, -1, 1);

      this.vadBuffer[this.vadOffset++] = sample;
      if (this.vadOffset === this.vadFrameSource) {
        vadJobs.push(this.downsampleFrame(this.vadBuffer, this.vadFrameTarget));
        this.vadOffset = 0;
      }

      this.pitchBuffer[this.pitchOffset++] = sample;
      if (this.pitchOffset === this.pitchFrameSource) {
        pitchJobs.push(this.downsampleFrame(this.pitchBuffer, this.pitchFrameTarget));
        this.pitchOffset = 0;
      }

      if (playing) {
        cursor += 1;
      }
    }

    for (const frame of vadJobs) {
      await this.evaluateVad(frame);
    }
    for (const frame of pitchJobs) {
      await this.evaluatePitch(frame);
    }

    const rms = block.length > 0 ? Math.sqrt(energySum / block.length) : 0;
    this.updateConfidence(rms);

    this.updateGuideEnvelope(frameMax, playing);

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
      gainDb: this.lastGateDb
    });

    const guideContribution = rms * this.currentGuideMix * this.guideBaseGain;
    const outputRms = Math.min(1, Math.sqrt(guideContribution ** 2 + this.instrumentBaseGain ** 2));
    store.setLevels(rms, outputRms);
    store.setConfidence(this.lastConfidence);

    if (playing) {
      const wrapLength = Math.max(this.instrumentLength, this.guideLength);
      if (wrapLength > 0) {
        this.playbackSampleCursor = cursor % wrapLength;
      } else {
        this.playbackSampleCursor = cursor;
      }
    }
  }

  private prepareVadFrame(frame: Float32Array) {
    if (frame.length === this.vadFrameTarget) {
      return frame;
    }

    const normalized = new Float32Array(this.vadFrameTarget);
    const copyLength = Math.min(frame.length, this.vadFrameTarget);
    for (let i = 0; i < copyLength; i += 1) {
      normalized[i] = frame[i];
    }

    return normalized;
  }

  private async evaluateVad(frame: Float32Array) {
    if (!this.vadSession || this.vadFailed) return;
    this.lastVadFrameLength = frame.length;
    if (frame.length !== this.vadFrameTarget) {
      if (!this.vadShapeWarningLogged) {
        this.vadShapeWarningLogged = true;
        // eslint-disable-next-line no-console
        console.warn(`Skipping VAD inference for unexpected frame length ${frame.length}`);
      }
      this.lastVad = 0;
      return;
    }
    try {
      const preparedFrame = this.prepareVadFrame(frame);
      const inputTensor = new ort.Tensor("float32", preparedFrame, [1, preparedFrame.length]);
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
    } catch (error) {
      if (!this.vadFailed) {
        this.vadFailed = true;
        // eslint-disable-next-line no-console
        console.warn("VAD inference failed, falling back to energy-based gating", error);
      }
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
    const energy = Number.isFinite(rms) ? Math.max(0, rms ?? 0) : 0;
    const ENERGY_SILENCE_FLOOR = 0.0005; // ~-66 dB
    const ENERGY_FULL_SCALE = 0.02; // ~-34 dB
    const energyGate = clamp((energy - ENERGY_SILENCE_FLOOR) / (ENERGY_FULL_SCALE - ENERGY_SILENCE_FLOOR), 0, 1);

    if (energyGate <= 0.01) {
      this.lastPitch = 0;
      this.lastPitchHz = 0;
    } else if (energyGate < 0.2) {
      this.lastPitch *= energyGate;
    }

    const vadComponent = this.lastVad * energyGate;
    const pitchComponent = this.lastPitch * energyGate;

    let combined = weights.vad * vadComponent + weights.pitch * pitchComponent + weights.phraseAware * 0;

    combined = Math.max(combined, vadComponent);

    this.lastConfidence = clamp(combined, 0, 1);
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

  private async inferPitch(
    frame: Float32Array,
    options: { bypassBusyCheck?: boolean } = {}
  ) {
    const { bypassBusyCheck = false } = options;
    if (!this.pitchSession) {
      return null;
    }

    if (!bypassBusyCheck && this.pitchAnalysisInProgress) {
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
    this.settingUnsubs.forEach((fn) => fn());
    this.manualModeUnsub = null;
    this.calibrationStageUnsub = null;
    this.trackUrlUnsub = null;
    this.settingUnsubs = [];
    this.clearResumeListener();

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
    this.instrumentChannels = [];
    this.instrumentLength = 0;
    this.guideChannels = [];
    this.guideLength = 0;
    this.vadSession = null;
    this.pitchSession = null;
    this.queue = [];
    this.processing = false;
    this.playbackOffset = 0;
    this.playbackStartTime = 0;
    this.playbackSampleCursor = 0;
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
    this.pitchAnalysisInProgress = false;
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

(window as any).audioEngine = audioEngine;


