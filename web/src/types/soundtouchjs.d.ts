declare module "soundtouchjs" {
  export class PitchShifter {
    constructor(
      context: AudioContext,
      buffer: AudioBuffer,
      bufferSize?: number,
      onEnd?: () => void
    );

    readonly node: AudioNode;
    pitch: number;
    pitchSemitones: number;
    rate: number;
    tempo: number;
    percentagePlayed: number;
    readonly duration: number;
    readonly sampleRate: number;
    readonly timePlayed: number;
  }
}
