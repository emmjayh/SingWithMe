// Manually prepending yin.js content
;(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(function() {
            return (root.yin = factory())
        })
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory()
    } else {
        root.yin = factory()
    }
})(typeof self !== 'undefined' ? self : this, function() {
    var DEFAULT_THRESHOLD = 0.07

    var floor = Math.floor

    function difference(data) {
        var n = data.length
        var results = new Float32Array(n)
        var difference
        var summation
        for (var tau = 0, windowSize = floor(n * 0.5); tau <= windowSize; tau++) {
            summation = 0
            for (var j = 0; j < windowSize; j++) {
                difference = data[j] - data[j + tau]
                summation += difference * difference
            }
            results[tau] = summation
        }
        return results
    }

    function cumulativeMeanNormalizedDifference(data) {
        var n = data.length
        var results = new Float32Array(n)
        var summation

        for (var tau = 0; tau < n; tau++) {
            summation = 0
            for (var j = 0; j <= tau; j++) {
                summation += data[j]
            }
            results[tau] = data[tau] / (summation / tau)
        }
        return results
    }

    function absoluteThreshold(data, threshold) {
        var x
        var k = Number.POSITIVE_INFINITY
        var tau

        for (var i = 0, n = data.length; i < n; i++) {
            x = data[i]
            if (x < threshold) {
                return i
            }
            if (x < k) {
                k = x
                tau = i
            }
        }
        return tau
    }

    function bestLocalEstimate(data, tau) {
        var i = tau + 1
        var n = data.length
        var k = data[tau]
        while (i < n && data[i] < k) {
            k = data[i]
            i++
        }
        return i - 1
    }
    return function(data, sampleRate, aThreshold) {
        var threshold = aThreshold || DEFAULT_THRESHOLD
        var results = cumulativeMeanNormalizedDifference(difference(data))
        var tau = absoluteThreshold(results, threshold)
        return sampleRate / bestLocalEstimate(results, tau)
    }
});


class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pitchData = [];
    this.port.onmessage = (event) => {
      if (event.data.type === 'load-pitch-data') {
        this.pitchData = event.data.pitchData;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    for (let channel = 0; channel < input.length; channel++) {
      output[channel].set(input[channel]);
    }

    if (this.pitchData.length > 0) {
      const inputData = input[0];
      const pitch = yin(inputData, this.sampleRate);

      const frameSize = 128; // default AudioWorklet frame size
      const frameDuration = frameSize / this.sampleRate;
      const frameIndex = Math.floor(this.currentTime / frameDuration);

      if (frameIndex < this.pitchData.length) {
        const targetPitch = this.pitchData[frameIndex];
        const tolerance = 20; // Pitch tolerance in Hz

        if (Math.abs(pitch - targetPitch) < tolerance) {
          this.port.postMessage({ type: 'pitch-match', match: true });
        } else {
          this.port.postMessage({ type: 'pitch-match', match: false });
        }
      }
    }

    return true;
  }
}

registerProcessor('pitch-processor', PitchProcessor);