#pragma once

#include <cstddef>

namespace singwithme::dsp
{
enum class ManualMode
{
    Auto,
    AlwaysOn,
    AlwaysOff
};

struct GateConfig
{
    float lookAheadMs{10.0f};
    float attackMs{20.0f};
    float releaseMs{180.0f};
    float holdMs{150.0f};
    float thresholdOn{0.7f};
    float thresholdOff{0.4f};
    int framesOn{3};
    int framesOff{6};
    float duckDb{-80.0f};
};

class ConfidenceGate
{
public:
    void configure(float sampleRate, size_t blockSize, GateConfig config);
    void setManualMode(ManualMode mode);
    ManualMode manualMode() const noexcept { return manualMode_; }
    float update(float confidence, float vad, float pitch);
    float currentGainDb() const noexcept { return gainDb_; }

private:
    GateConfig config_{};
    float sampleRate_{48000.0f};
    size_t blockSize_{128};
    float gainDb_{-80.0f};
    float targetDb_{-80.0f};
    float holdTimerMs_{0.0f};
    int consecutiveOn_{0};
    int consecutiveOff_{0};
    ManualMode manualMode_{ManualMode::Auto};
};
} // namespace singwithme::dsp
