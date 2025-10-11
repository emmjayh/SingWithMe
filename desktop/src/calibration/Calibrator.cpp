#include "calibration/Calibrator.h"

#include <algorithm>
#include <cmath>

namespace singwithme::calibration
{
namespace
{
constexpr float epsilon = 1e-6f;
constexpr float referenceDb = -80.0f;
} // namespace

void Calibrator::start(double sampleRate, float durationSeconds)
{
    sampleRate_ = sampleRate;
    targetDuration_ = durationSeconds;
    processedSamples_ = 0;
    maxAmplitude_ = 0.0f;
}

void Calibrator::processBlock(const float* samples, size_t numSamples)
{
    if (isComplete())
    {
        return;
    }

    for (size_t i = 0; i < numSamples; ++i)
    {
        maxAmplitude_ = std::max(maxAmplitude_, std::abs(samples[i]));
    }

    processedSamples_ += numSamples;
}

bool Calibrator::isComplete() const noexcept
{
    const double totalSamplesNeeded = sampleRate_ * targetDuration_;
    return processedSamples_ >= static_cast<size_t>(totalSamplesNeeded);
}

CalibrationResult Calibrator::result() const noexcept
{
    CalibrationResult res;
    res.isValid = processedSamples_ > 0;
    const float amplitude = std::max(maxAmplitude_, epsilon);
    res.vocalPeakDb = 20.0f * std::log10(amplitude);
    res.noiseFloorDb = referenceDb;
    return res;
}
} // namespace singwithme::calibration
