#pragma once

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_audio_basics/juce_audio_basics.h>

#include <vector>

#include "calibration/Calibrator.h"
#include "config/RuntimeConfig.h"
#include "dsp/ConfidenceGate.h"
#include "dsp/PitchProcessor.h"
#include "dsp/VadProcessor.h"

namespace singwithme::audio
{
class PipelineProcessor : public juce::AudioIODeviceCallback
{
public:
    PipelineProcessor();
    ~PipelineProcessor() override = default;

    void configure(const config::RuntimeConfig& runtimeConfig,
                   dsp::ConfidenceGate& gate,
                   dsp::VadProcessor& vad,
                   dsp::PitchProcessor& pitch,
                   calibration::Calibrator& calibrator);

    void audioDeviceAboutToStart(juce::AudioIODevice* device) override;
    void audioDeviceStopped() override;
    void audioDeviceIOCallback(const float* const* inputChannelData,
                               int numInputChannels,
                               float* const* outputChannelData,
                               int numOutputChannels,
                               int numSamples) override;

private:
    void resetBuffers();
    void processSamples(const float* const* inputs,
                        int numInputChannels,
                        float* const* outputs,
                        int numOutputChannels,
                        int numSamples);
    void runVad(const float* frame16k);
    void runPitch(const float* frame16k);
    void updateConfidence();
    bool loadMediaBuffers(const config::RuntimeConfig& runtimeConfig);
    float nextInstrumentSample(int channel);
    float nextGuideSample(int channel);
    void advanceMediaPositions();
    static float downsampleAverage(const float* data, size_t offset, size_t factor);
    juce::File resolveFile(const std::string& path) const;
    bool loadAudioFile(const std::string& path, juce::AudioBuffer<float>& destination, double targetSampleRate);

    const config::RuntimeConfig* runtimeConfig_{nullptr};
    dsp::ConfidenceGate* gate_{nullptr};
    dsp::VadProcessor* vad_{nullptr};
    dsp::PitchProcessor* pitch_{nullptr};
    calibration::Calibrator* calibrator_{nullptr};

    std::vector<float> vadFrame48k_;
    std::vector<float> vadFrame16k_;
    std::vector<float> pitchFrame48k_;
    std::vector<float> pitchFrame16k_;

    size_t vadOffset_{0};
    size_t pitchOffset_{0};

    juce::AudioFormatManager formatManager_;
    juce::AudioBuffer<float> instrumentBuffer_;
    juce::AudioBuffer<float> guideBuffer_;
    size_t instrumentPosition_{0};
    size_t guidePosition_{0};
    bool loopMedia_{true};
    float instrumentGain_{1.0f};
    float guideGain_{1.0f};
    float micMonitorGain_{0.5f};

    float vadScore_{0.0f};
    float pitchScore_{0.0f};
    float phraseScore_{0.0f};
    float confidence_{0.0f};
    double sourceSampleRate_{48000.0};
};
} // namespace singwithme::audio
