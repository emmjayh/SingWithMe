class ConfidenceGateProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const params = options?.processorOptions ?? {};
    this.bufferSamples = params.bufferSamples ?? 128;
    this.currentGain = params.initialGain ?? 0;
    this.targetGain = params.initialGain ?? 0;
    this.smoothing = 0.2;

    this.port.onmessage = (event) => {
      const { data } = event;
      if (data?.type === "gain" && typeof data.value === "number") {
        this.targetGain = data.value;
      } else if (data?.type === "reset" && typeof data.value === "number") {
        this.currentGain = data.value;
        this.targetGain = data.value;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output) return true;

    const inputChannel = input[0];
    const mainOut = output[0];
    const guideOut = output[1];

    if (!inputChannel || !mainOut) {
      return true;
    }

    for (let i = 0; i < inputChannel.length; i += 1) {
      const sample = inputChannel[i];
      this.currentGain += (this.targetGain - this.currentGain) * this.smoothing;
      mainOut[i] = sample;
      if (guideOut) {
        guideOut[i] = sample;
      }
    }

    const payload = new Float32Array(inputChannel.length);
    payload.set(inputChannel);
    this.port.postMessage({ type: "block", payload: payload.buffer }, [payload.buffer]);

    return true;
  }
}

registerProcessor("confidence-gate-processor", ConfidenceGateProcessor);
