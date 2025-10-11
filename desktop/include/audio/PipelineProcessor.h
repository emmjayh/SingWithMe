#pragma once

#include <juce_audio_devices/juce_audio_devices.h>

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
    void processSamples(const float* input, float* output, int numSamples);
    void runVad(const float* frame);
    void runPitch(const float* frame);
    void updateConfidence();

    const config::RuntimeConfig* runtimeConfig_{nullptr};
    dsp::ConfidenceGate* gate_{nullptr};
    dsp::VadProcessor* vad_{nullptr};
    dsp::PitchProcessor* pitch_{nullptr};
    calibration::Calibrator* calibrator_{nullptr};

    std::vector<float> vadFrame_;
    std::vector<float> pitchFrame_;
    std::vector<float> guideBuffer_;

    size_t vadOffset_{0};
    size_t pitchOffset_{0};

    float vadScore_{0.0f};
    float pitchScore_{0.0f};
    float phraseScore_{0.0f};
    float confidence_{0.0f};
};
} // namespace singwithme::audio
