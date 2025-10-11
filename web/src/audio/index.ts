import { useAppStore } from "@state/useAppStore";

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private analyserIn: AnalyserNode | null = null;
  private analyserOut: AnalyserNode | null = null;
  private meterTimer: number | undefined;

  async initialise() {
    if (this.audioContext) {
      return;
    }

    this.audioContext = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 48000 } });
    const source = this.audioContext.createMediaStreamSource(stream);
    this.analyserIn = this.audioContext.createAnalyser();
    this.analyserIn.fftSize = 1024;
    source.connect(this.analyserIn);

    this.analyserOut = this.audioContext.createAnalyser();
    this.analyserOut.fftSize = 1024;

    this.startMeters();
  }

  startMeters() {
    const store = useAppStore.getState();
    const inputBuffer = new Uint8Array(256);
    const outputBuffer = new Uint8Array(256);

    const sample = () => {
      if (this.analyserIn) {
        this.analyserIn.getByteTimeDomainData(inputBuffer);
        const rmsIn = Math.sqrt(inputBuffer.reduce((acc, value) => acc + (value - 128) ** 2, 0) / inputBuffer.length);
        store.setLevels(rmsIn / 128, store.outputLevel);
      }
      if (this.analyserOut) {
        this.analyserOut.getByteTimeDomainData(outputBuffer);
        const rmsOut = Math.sqrt(outputBuffer.reduce((acc, value) => acc + (value - 128) ** 2, 0) / outputBuffer.length);
        store.setLevels(store.inputLevel, rmsOut / 128);
      }
      this.meterTimer = window.setTimeout(sample, 80);
    };

    sample();
  }

  dispose() {
    if (this.meterTimer) {
      window.clearTimeout(this.meterTimer);
    }
    this.analyserIn?.disconnect();
    this.analyserOut?.disconnect();
    this.audioContext?.close();
    this.audioContext = null;
  }
}
