#include "audio/PipelineProcessor.h"

#include <juce_audio_basics/juce_audio_basics.h>

#include <algorithm>

namespace singwithme::audio
{
namespace
{
constexpr size_t kVadSamples = 480;  // 10 ms @ 48 kHz
constexpr size_t kPitchSamples = 960; // 20 ms @ 48 kHz

inline float dbToLinear(float db)
{
    return juce::Decibels::decibelsToGain(db);
}
} // namespace

PipelineProcessor::PipelineProcessor()
{
    vadFrame_.resize(kVadSamples, 0.0f);
    pitchFrame_.resize(kPitchSamples, 0.0f);
}

void PipelineProcessor::configure(const config::RuntimeConfig& runtimeConfig,
                                  dsp::ConfidenceGate& gate,
                                  dsp::VadProcessor& vad,
                                  dsp::PitchProcessor& pitch,
                                  calibration::Calibrator& calibrator)
{
    runtimeConfig_ = &runtimeConfig;
    gate_ = &gate;
    vad_ = &vad;
    pitch_ = &pitch;
    calibrator_ = &calibrator;

    gate_->configure(static_cast<float>(runtimeConfig.sampleRate),
                     static_cast<size_t>(runtimeConfig.bufferSamples),
                     dsp::GateConfig{
                         runtimeConfig.gate.lookAheadMs,
                         runtimeConfig.gate.attackMs,
                         runtimeConfig.gate.releaseMs,
                         runtimeConfig.gate.holdMs,
                         runtimeConfig.gate.thresholdOn,
                         runtimeConfig.gate.thresholdOff,
                         runtimeConfig.gate.framesOn,
                         runtimeConfig.gate.framesOff,
                         runtimeConfig.gate.duckDb});

    guideBuffer_.resize(static_cast<size_t>(runtimeConfig.bufferSamples));
    resetBuffers();
}

void PipelineProcessor::audioDeviceAboutToStart(juce::AudioIODevice*)
{
    resetBuffers();
    if (calibrator_)
    {
        calibrator_->start(runtimeConfig_ ? runtimeConfig_->sampleRate : 48000.0);
    }
}

void PipelineProcessor::audioDeviceStopped()
{
    resetBuffers();
}

void PipelineProcessor::audioDeviceIOCallback(const float* const* inputChannelData,
                                              int numInputChannels,
                                              float* const* outputChannelData,
                                              int numOutputChannels,
                                              int numSamples)
{
    if (numInputChannels <= 0 || inputChannelData == nullptr || outputChannelData == nullptr)
    {
        return;
    }

    const float* input = inputChannelData[0];
    float* output = outputChannelData[0];

    if (output != nullptr)
    {
        std::fill(output, output + numSamples, 0.0f);
    }

    processSamples(input, output, numSamples);

    // Copy processed guide buffer into channel 1 if available (placeholder for guide track).
    if (numOutputChannels > 1 && outputChannelData[1] != nullptr)
    {
        auto* guideOut = outputChannelData[1];
        std::copy(guideBuffer_.begin(), guideBuffer_.begin() + numSamples, guideOut);
    }
}

void PipelineProcessor::resetBuffers()
{
    vadOffset_ = 0;
    pitchOffset_ = 0;
    vadScore_ = 0.0f;
    pitchScore_ = 0.0f;
    phraseScore_ = 0.0f;
    confidence_ = 0.0f;

    std::fill(vadFrame_.begin(), vadFrame_.end(), 0.0f);
    std::fill(pitchFrame_.begin(), pitchFrame_.end(), 0.0f);
    std::fill(guideBuffer_.begin(), guideBuffer_.end(), 0.0f);
}

void PipelineProcessor::processSamples(const float* input, float* output, int numSamples)
{
    if (runtimeConfig_ == nullptr || gate_ == nullptr || vad_ == nullptr || pitch_ == nullptr)
    {
        if (output != nullptr)
        {
            std::copy(input, input + numSamples, output);
        }
        return;
    }

    const int bufferSamples = runtimeConfig_->bufferSamples;

    for (int i = 0; i < numSamples; ++i)
    {
        float sample = input != nullptr ? input[i] : 0.0f;

        if (calibrator_)
        {
            float sampleCopy = sample;
            calibrator_->processBlock(&sampleCopy, 1);
        }

        if (vadOffset_ < kVadSamples)
        {
            vadFrame_[vadOffset_++] = sample;
        }
        if (pitchOffset_ < kPitchSamples)
        {
            pitchFrame_[pitchOffset_++] = sample;
        }

        if (vadOffset_ == kVadSamples)
        {
            runVad(vadFrame_.data());
            vadOffset_ = 0;
        }

        if (pitchOffset_ == kPitchSamples)
        {
            runPitch(pitchFrame_.data());
            pitchOffset_ = 0;
        }

        updateConfidence();

        const float gainDb = gate_->update(confidence_, vadScore_, pitchScore_);
        const float gainLin = dbToLinear(gainDb);

        if (i < bufferSamples)
        {
            guideBuffer_[static_cast<size_t>(i)] = sample * gainLin;
        }

        if (output != nullptr)
        {
            output[i] = sample; // pass-through mic input to main output for monitoring
        }
    }
}

void PipelineProcessor::runVad(const float* frame)
{
    try
    {
        vadScore_ = vad_->processFrame(frame, kVadSamples);
    }
    catch (...)
    {
        vadScore_ = 0.0f;
    }
}

void PipelineProcessor::runPitch(const float* frame)
{
    try
    {
        pitchScore_ = pitch_->processHop(frame, kPitchSamples);
    }
    catch (...)
    {
        pitchScore_ = 0.0f;
    }
}

void PipelineProcessor::updateConfidence()
{
    if (!runtimeConfig_)
    {
        confidence_ = 0.0f;
        return;
    }

    const auto& weights = runtimeConfig_->weights;
    confidence_ = (weights.vad * vadScore_) + (weights.pitch * pitchScore_) + (weights.phraseAware * phraseScore_);
    confidence_ = std::clamp(confidence_, 0.0f, 1.0f);
}
} // namespace singwithme::audio
