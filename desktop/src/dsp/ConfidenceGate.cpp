#include "dsp/ConfidenceGate.h"

#include <algorithm>
#include <cmath>

namespace singwithme::dsp
{
namespace
{
constexpr float kZeroDb = 0.0f;
constexpr float kMuteDb = -80.0f;
} // namespace

void ConfidenceGate::configure(float sampleRate, size_t blockSize, GateConfig config)
{
    sampleRate_ = sampleRate;
    blockSize_ = blockSize;
    config_ = config;
    gainDb_ = config_.duckDb;
    targetDb_ = config_.duckDb;
    holdTimerMs_ = 0.0f;
    consecutiveOn_ = 0;
    consecutiveOff_ = 0;
}

void ConfidenceGate::setManualMode(ManualMode mode)
{
    manualMode_ = mode;
}

float ConfidenceGate::update(float confidence, float vad, float pitch)
{
    (void)vad;
    (void)pitch;

    if (manualMode_ == ManualMode::AlwaysOn)
    {
        targetDb_ = kZeroDb;
    }
    else if (manualMode_ == ManualMode::AlwaysOff)
    {
        targetDb_ = config_.duckDb;
    }
    else
    {
        if (confidence >= config_.thresholdOn)
        {
            consecutiveOn_++;
            consecutiveOff_ = 0;
        }
        else if (confidence <= config_.thresholdOff)
        {
            consecutiveOff_++;
            consecutiveOn_ = 0;
        }
        else
        {
            consecutiveOn_ = 0;
        }

        if (consecutiveOn_ >= config_.framesOn)
        {
            targetDb_ = kZeroDb;
            holdTimerMs_ = config_.holdMs;
        }
        else if (consecutiveOff_ >= config_.framesOff && holdTimerMs_ <= 0.0f)
        {
            targetDb_ = config_.duckDb;
        }
    }

    const float elapsedMs = static_cast<float>(blockSize_) / sampleRate_ * 1000.0f;
    if (holdTimerMs_ > 0.0f)
    {
        holdTimerMs_ = std::max(0.0f, holdTimerMs_ - elapsedMs);
    }

    const float attackCoef = std::exp(-elapsedMs / std::max(config_.attackMs, 1.0f));
    const float releaseCoef = std::exp(-elapsedMs / std::max(config_.releaseMs, 1.0f));

    if (gainDb_ > targetDb_)
    {
        gainDb_ = targetDb_ + (gainDb_ - targetDb_) * attackCoef;
    }
    else
    {
        gainDb_ = targetDb_ + (gainDb_ - targetDb_) * releaseCoef;
    }

    gainDb_ = std::clamp(gainDb_, config_.duckDb, kZeroDb);
    return gainDb_;
}
} // namespace singwithme::dsp
