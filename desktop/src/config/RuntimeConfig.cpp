#include "config/RuntimeConfig.h"

#include <juce_data_structures/juce_data_structures.h>

namespace singwithme::config
{
namespace
{
RuntimeConfig makeDefaults()
{
    RuntimeConfig cfg;
    cfg.sampleRate = 48000.0;
    cfg.bufferSamples = 128;
    cfg.modelSampleRate = 16000.0;
    cfg.vadModelPath = "models/vad.onnx";
    cfg.pitchModelPath = "models/crepe_tiny.onnx";
    cfg.weights = ConfidenceWeights{0.6f, 0.4f, 0.0f};
    cfg.gate = GateParams{10.0f, 20.0f, 180.0f, 150.0f, 0.7f, 0.4f, 3, 6, -18.0f};
    cfg.media = MediaConfig{};
    return cfg;
}

juce::File resolvePath(const std::string& path)
{
    juce::File file(path);
    if (file.existsAsFile())
    {
        return file;
    }
    return juce::File::getCurrentWorkingDirectory().getChildFile(path);
}

double getDouble(const juce::DynamicObject& object, const juce::Identifier& key, double fallback)
{
    if (!object.hasProperty(key))
    {
        return fallback;
    }
    return static_cast<double>(object.getProperty(key));
}

float getFloat(const juce::DynamicObject& object, const juce::Identifier& key, float fallback)
{
    if (!object.hasProperty(key))
    {
        return fallback;
    }
    return static_cast<float>(object.getProperty(key));
}

int getInt(const juce::DynamicObject& object, const juce::Identifier& key, int fallback)
{
    if (!object.hasProperty(key))
    {
        return fallback;
    }
    return static_cast<int>(object.getProperty(key));
}

bool getBool(const juce::DynamicObject& object, const juce::Identifier& key, bool fallback)
{
    if (!object.hasProperty(key))
    {
        return fallback;
    }
    return static_cast<bool>(object.getProperty(key));
}

std::string getString(const juce::DynamicObject& object, const juce::Identifier& key, const std::string& fallback)
{
    if (!object.hasProperty(key))
    {
        return fallback;
    }
    return object.getProperty(key).toString().toStdString();
}
} // namespace

RuntimeConfig ConfigLoader::loadDefaults() const
{
    return makeDefaults();
}

RuntimeConfig ConfigLoader::loadFromFile(const juce::File& file) const
{
    if (!file.existsAsFile())
    {
        return loadDefaults();
    }

    juce::String content = file.loadFileAsString();
    juce::var parsed;
    if (!juce::JSON::parse(content, parsed))
    {
        return loadDefaults();
    }

    RuntimeConfig base = loadDefaults();
    return applyOverrides(base, parsed, file.getParentDirectory());
}

RuntimeConfig ConfigLoader::applyOverrides(const RuntimeConfig& baseConfig, const juce::var& overrides, const juce::File& parentDirectory) const
{
    RuntimeConfig config = baseConfig;

    if (auto* object = overrides.getDynamicObject())
    {
        if (object->hasProperty("extends"))
        {
            const auto extendsPath = object->getProperty("extends").toString();
            const juce::File extendsFile = parentDirectory.getChildFile(extendsPath);
            config = loadFromFile(extendsFile);
        }

        if (object->hasProperty("sampleRateHz"))
        {
            config.sampleRate = getDouble(*object, "sampleRateHz", config.sampleRate);
        }

        if (object->hasProperty("bufferSamples"))
        {
            config.bufferSamples = getInt(*object, "bufferSamples", config.bufferSamples);
        }

        if (object->hasProperty("models"))
        {
            if (auto* models = object->getProperty("models").getDynamicObject())
            {
                config.vadModelPath = getString(*models, "vad", config.vadModelPath);
                config.pitchModelPath = getString(*models, "pitch", config.pitchModelPath);
                config.modelSampleRate = getDouble(*models, "modelSampleRateHz", config.modelSampleRate);
            }
        }

        if (object->hasProperty("confidenceWeights"))
        {
            if (auto* weights = object->getProperty("confidenceWeights").getDynamicObject())
            {
                config.weights.vad = getFloat(*weights, "vad", config.weights.vad);
                config.weights.pitch = getFloat(*weights, "pitch", config.weights.pitch);
                config.weights.phraseAware = getFloat(*weights, "phraseAware", config.weights.phraseAware);
            }
        }

        if (object->hasProperty("gate"))
        {
            if (auto* gate = object->getProperty("gate").getDynamicObject())
            {
                config.gate.lookAheadMs = getFloat(*gate, "lookAheadMs", config.gate.lookAheadMs);
                config.gate.attackMs = getFloat(*gate, "attackMs", config.gate.attackMs);
                config.gate.releaseMs = getFloat(*gate, "releaseMs", config.gate.releaseMs);
                config.gate.holdMs = getFloat(*gate, "holdMs", config.gate.holdMs);
                config.gate.thresholdOn = getFloat(*gate, "thresholdOn", config.gate.thresholdOn);
                config.gate.thresholdOff = getFloat(*gate, "thresholdOff", config.gate.thresholdOff);
                config.gate.framesOn = getInt(*gate, "framesOn", config.gate.framesOn);
                config.gate.framesOff = getInt(*gate, "framesOff", config.gate.framesOff);
                config.gate.duckDb = getFloat(*gate, "duckDb", config.gate.duckDb);
            }
        }

        if (object->hasProperty("media"))
        {
            if (auto* media = object->getProperty("media").getDynamicObject())
            {
                config.media.instrumentPath = getString(*media, "instrumentPath", config.media.instrumentPath);
                config.media.guidePath = getString(*media, "guidePath", config.media.guidePath);
                config.media.loop = getBool(*media, "loop", config.media.loop);
                config.media.instrumentGainDb = getFloat(*media, "instrumentGainDb", config.media.instrumentGainDb);
                config.media.guideGainDb = getFloat(*media, "guideGainDb", config.media.guideGainDb);
                config.media.micMonitorGainDb = getFloat(*media, "micMonitorGainDb", config.media.micMonitorGainDb);
            }
        }
    }

    return config;
}

RuntimeConfig ConfigLoader::loadFromFile(const std::string& path) const
{
    return loadFromFile(resolvePath(path));
}
} // namespace singwithme::config
