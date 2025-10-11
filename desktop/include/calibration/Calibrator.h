#pragma once

#include <cstddef>
#include <vector>

namespace singwithme::calibration
{
struct CalibrationResult
{
    float noiseFloorDb{-80.0f};
    float vocalPeakDb{-6.0f};
    bool isValid{false};
};

class Calibrator
{
public:
    void start(double sampleRate, float durationSeconds = 10.0f);
    void processBlock(const float* samples, size_t numSamples);
    bool isComplete() const noexcept;
    CalibrationResult result() const noexcept;

private:
    double sampleRate_{48000.0};
    float targetDuration_{10.0f};
    size_t processedSamples_{0};
    float maxAmplitude_{0.0f};
};
} // namespace singwithme::calibration
