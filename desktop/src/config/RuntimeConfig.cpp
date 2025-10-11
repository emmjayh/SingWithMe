#include "config/RuntimeConfig.h"

#include <filesystem>
#include <stdexcept>

namespace singwithme::config
{
namespace
{
RuntimeConfig makeDefaults()
{
    RuntimeConfig cfg;
    cfg.sampleRate = 48000.0;
    cfg.bufferSamples = 128;
    cfg.vadModelPath = "models/vad.onnx";
    cfg.pitchModelPath = "models/crepe_tiny.onnx";
    cfg.weights = ConfidenceWeights{0.6f, 0.4f, 0.0f};
    cfg.gate = GateParams{10.0f, 20.0f, 180.0f, 150.0f, 0.7f, 0.4f, 3, 6, -18.0f};
    return cfg;
}
} // namespace

RuntimeConfig ConfigLoader::loadDefaults() const
{
    return makeDefaults();
}

RuntimeConfig ConfigLoader::loadFromFile(const std::string& path) const
{
    if (!std::filesystem::exists(path))
    {
        return loadDefaults();
    }

    // TODO: Parse YAML; returning defaults for now to allow early integration
    return loadDefaults();
}
} // namespace singwithme::config
