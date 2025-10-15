#pragma once

#include <tuple>

#include "singwithme/core/PipelineCore.h"
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>

#include <atomic>
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
    struct Metrics
    {
        float inputRms{0.0f};
        float outputRms{0.0f};
        float vad{0.0f};
        float pitch{0.0f};
        float confidence{0.0f};
        float strength{0.0f};
        float gateDb{-80.0f};
    };

    Metrics getMetrics() const;
    void setManualMode(dsp::ManualMode mode);
    dsp::ManualMode manualMode() const;

    enum class TransportState
    {
        Playing,
        Paused,
        Stopped
    };

    bool loadInstrumentFile(const juce::File& file);
    bool loadGuideFile(const juce::File& file);
    std::string instrumentPath() const;
    std::string guidePath() const;
    double instrumentDurationSeconds() const;
    double guideDurationSeconds() const;
    void setNoiseFloorAmplitude(float amp);
    float noiseFloorAmplitude() const;
    void setMicMonitorGainDb(float gainDb);
    float micMonitorGainDb() const;
    void setCrowdCancelParameters(float adaptRate, float recoveryRate, float clamp);
    void setReverbTail(float mix, float tailSeconds);
    void setTimbreMatchStrength(float strength);
    void setEnvelopeSmoothing(float holdMs, float releaseMs, float releaseMod);
    std::tuple<float, float, float> crowdCancelParameters() const;
    std::pair<float, float> reverbTailSettings() const;
    float timbreMatchStrength() const;
    std::tuple<float, float, float> envelopeSmoothing() const;
    void setGuideMute(bool shouldMute);
    bool guideMuted() const;
    void updateBufferSize(int bufferSamples);
    void playTransport();
    void pauseTransport();
    void stopTransport();
    bool isTransportPlaying() const;
    TransportState transportState() const;

    void audioDeviceAboutToStart(juce::AudioIODevice* device) override;
    void audioDeviceStopped() override;
    void audioDeviceIOCallbackWithContext(const float* const* inputChannelData,
                                          int numInputChannels,
                                          float* const* outputChannelData,
                                          int numOutputChannels,
                                          int numSamples,
                                          const juce::AudioIODeviceCallbackContext& context) override;

private:
    juce::File resolveFile(const std::string& path) const;
    bool loadAudioFile(const juce::File& file,
                       juce::AudioBuffer<float>& destination,
                       double targetSampleRate);
    bool loadAudioFile(const std::string& path,
                       juce::AudioBuffer<float>& destination,
                       double targetSampleRate);
    void pushBackingToCore(const juce::AudioBuffer<float>& buffer, double sampleRate);
    void pushGuideToCore(const juce::AudioBuffer<float>& buffer, double sampleRate);
    static std::vector<std::vector<float>> convertBuffer(const juce::AudioBuffer<float>& buffer);

    const config::RuntimeConfig* runtimeConfig_{nullptr};
    dsp::ConfidenceGate* gate_{nullptr};
    dsp::VadProcessor* vad_{nullptr};
    dsp::PitchProcessor* pitch_{nullptr};
    calibration::Calibrator* calibrator_{nullptr};

    juce::AudioFormatManager formatManager_;
    juce::AudioBuffer<float> backingBuffer_;
    juce::AudioBuffer<float> vocalBuffer_;
    core::PipelineCore corePipeline_;
    core::PipelineConfig coreConfig_;

    std::string instrumentPath_;
    std::string guidePath_;
    double backingDurationSeconds_{0.0};
    double vocalDurationSeconds_{0.0};
};
} // namespace singwithme::audio
