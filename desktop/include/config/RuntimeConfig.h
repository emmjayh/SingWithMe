#pragma once

#include <string>

namespace singwithme::config
{
struct GateParams
{
    float lookAheadMs{10.0f};
    float attackMs{20.0f};
    float releaseMs{180.0f};
    float holdMs{150.0f};
    float thresholdOn{0.7f};
    float thresholdOff{0.4f};
    int framesOn{3};
    int framesOff{6};
    float duckDb{-18.0f};
};

struct ConfidenceWeights
{
    float vad{0.6f};
    float pitch{0.4f};
    float phraseAware{0.0f};
};

struct RuntimeConfig
{
    double sampleRate{48000.0};
    int bufferSamples{128};
    std::string vadModelPath{"models/vad.onnx"};
    std::string pitchModelPath{"models/crepe_tiny.onnx"};
    ConfidenceWeights weights{};
    GateParams gate{};
};

class ConfigLoader
{
public:
    RuntimeConfig loadFromFile(const std::string& path) const;
    RuntimeConfig loadDefaults() const;
};
} // namespace singwithme::config
