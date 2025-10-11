#pragma once

#include <string>

namespace juce
{
class File;
class var;
} // namespace juce

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

struct MediaConfig
{
    std::string instrumentPath{"assets/audio/instrument.wav"};
    std::string guidePath{"assets/audio/guide.wav"};
    bool loop{true};
    float instrumentGainDb{0.0f};
    float guideGainDb{0.0f};
    float micMonitorGainDb{-6.0f};
};

struct RuntimeConfig
{
    double sampleRate{48000.0};
    int bufferSamples{128};
    double modelSampleRate{16000.0};
    std::string vadModelPath{"models/vad.onnx"};
    std::string pitchModelPath{"models/crepe_tiny.onnx"};
    ConfidenceWeights weights{};
    GateParams gate{};
    MediaConfig media{};
};

class ConfigLoader
{
public:
    RuntimeConfig loadFromFile(const std::string& path) const;
    RuntimeConfig loadDefaults() const;

private:
    RuntimeConfig loadFromFile(const juce::File& file) const;
    RuntimeConfig applyOverrides(const RuntimeConfig& baseConfig, const juce::var& overrides, const juce::File& parentDirectory) const;
};
} // namespace singwithme::config
