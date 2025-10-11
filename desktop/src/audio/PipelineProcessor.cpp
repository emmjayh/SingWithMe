#include "audio/PipelineProcessor.h"

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_audio_formats/juce_audio_formats.h>

#include <algorithm>\\n#include <cmath>

namespace singwithme::audio
{
namespace
{
constexpr size_t kVadFrameSamples48k = 480;   // 10 ms @ 48 kHz
constexpr size_t kVadFrameSamples16k = 160;   // 10 ms @ 16 kHz
constexpr size_t kPitchFrameSamples48k = 3072; // 64 ms @ 48 kHz
constexpr size_t kPitchFrameSamples16k = 1024; // 64 ms @ 16 kHz
constexpr int kMaxOutputChannels = 2;

inline float dbToLinear(float db)
{
    return juce::Decibels::decibelsToGain(db);
}

juce::File resolveToWorkingDirectory(const std::string& path)
{
    juce::File file(path);
    if (file.existsAsFile())
    {
        return file;
    }
    return juce::File::getCurrentWorkingDirectory().getChildFile(path);
}
} // namespace

PipelineProcessor::PipelineProcessor()
{
    formatManager_.registerBasicFormats();
    vadFrame48k_.resize(kVadFrameSamples48k, 0.0f);
    vadFrame16k_.resize(kVadFrameSamples16k, 0.0f);
    pitchFrame48k_.resize(kPitchFrameSamples48k, 0.0f);
    pitchFrame16k_.resize(kPitchFrameSamples16k, 0.0f);
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
    sourceSampleRate_ = runtimeConfig.sampleRate;

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

    vad_->setModelSampleRate(static_cast<int64_t>(runtimeConfig.modelSampleRate));
    vad_->resetState();
    instrumentGain_ = dbToLinear(runtimeConfig.media.instrumentGainDb);
    guideGain_ = dbToLinear(runtimeConfig.media.guideGainDb);
    micMonitorGain_ = dbToLinear(runtimeConfig.media.micMonitorGainDb);
    loopMedia_ = runtimeConfig.media.loop;

    loadMediaBuffers(runtimeConfig);
    resetBuffers();
}

void PipelineProcessor::audioDeviceAboutToStart(juce::AudioIODevice*)
{
    resetBuffers();
    vad_->resetState();
    instrumentPosition_ = 0;
    guidePosition_ = 0;

    if (calibrator_ && runtimeConfig_)
    {
        calibrator_->start(runtimeConfig_->sampleRate);
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
    if (outputChannelData == nullptr || numOutputChannels <= 0)
    {
        return;
    }

    for (int ch = 0; ch < numOutputChannels; ++ch)
    {
        if (outputChannelData[ch] != nullptr)
        {
            std::fill(outputChannelData[ch], outputChannelData[ch] + numSamples, 0.0f);
        }
    }

    processSamples(inputChannelData, numInputChannels, outputChannelData, numOutputChannels, numSamples);
}

void PipelineProcessor::resetBuffers()
{
    vadOffset_ = 0;
    pitchOffset_ = 0;
    vadScore_ = 0.0f;
    pitchScore_ = 0.0f;
    phraseScore_ = 0.0f;
    confidence_ = 0.0f;

    std::fill(vadFrame48k_.begin(), vadFrame48k_.end(), 0.0f);
    std::fill(vadFrame16k_.begin(), vadFrame16k_.end(), 0.0f);
    std::fill(pitchFrame48k_.begin(), pitchFrame48k_.end(), 0.0f);
    std::fill(pitchFrame16k_.begin(), pitchFrame16k_.end(), 0.0f);
}

void PipelineProcessor::processSamples(const float* const* inputs,
                                       int numInputChannels,
                                       float* const* outputs,
                                       int numOutputChannels,
                                       int numSamples)
{
    if (!runtimeConfig_ || !gate_ || !vad_ || !pitch_)
    {
        return;
    }

    const float* micInput = (numInputChannels > 0 && inputs != nullptr) ? inputs[0] : nullptr;
    const int bufferSamples = runtimeConfig_->bufferSamples;
    const double ratio = runtimeConfig_->modelSampleRate > 0.0 ? sourceSampleRate_ / runtimeConfig_->modelSampleRate : 3.0;
    const size_t downsampleFactor = std::max<size_t>(1, static_cast<size_t>(std::round(ratio)));

    for (int i = 0; i < numSamples; ++i)
    {
        const float micSample = micInput ? micInput[i] : 0.0f;

        if (calibrator_)
        {
            float sampleCopy = micSample;
            calibrator_->processBlock(&sampleCopy, 1);
        }

        if (vadOffset_ < kVadFrameSamples48k)
        {
            vadFrame48k_[vadOffset_] = micSample;
        }
        if (pitchOffset_ < kPitchFrameSamples48k)
        {
            pitchFrame48k_[pitchOffset_] = micSample;
        }

        ++vadOffset_;
        ++pitchOffset_;

        if (vadOffset_ == kVadFrameSamples48k)
        {
            for (size_t j = 0; j < kVadFrameSamples16k; ++j)
            {
                const size_t offset = j * downsampleFactor;
                const size_t samplesRemaining = kVadFrameSamples48k - offset;
                const size_t count = std::min(downsampleFactor, samplesRemaining);
                vadFrame16k_[j] = downsampleAverage(vadFrame48k_.data(), offset, count);
            }
            runVad(vadFrame16k_.data());
            vadOffset_ = 0;
        }

        if (pitchOffset_ == kPitchFrameSamples48k)
        {
            for (size_t j = 0; j < kPitchFrameSamples16k; ++j)
            {
                const size_t offset = j * downsampleFactor;
                const size_t samplesRemaining = kPitchFrameSamples48k - offset;
                const size_t count = std::min(downsampleFactor, samplesRemaining);
                pitchFrame16k_[j] = downsampleAverage(pitchFrame48k_.data(), offset, count);
            }
            runPitch(pitchFrame16k_.data());
            pitchOffset_ = 0;
        }

        updateConfidence();
        const float gateGainDb = gate_->update(confidence_, vadScore_, pitchScore_);
        const float gateGainLinear = dbToLinear(gateGainDb);

        const float instrumentLeft = nextInstrumentSample(0);
        const float instrumentRight = nextInstrumentSample(1);
        const float guideLeft = nextGuideSample(0) * gateGainLinear;
        const float guideRight = nextGuideSample(1) * gateGainLinear;
        const float micContribution = micSample * micMonitorGain_;

        if (numOutputChannels > 0 && outputs[0])
        {
            outputs[0][i] += instrumentLeft + (guideLeft * guideGain_) + micContribution;
        }

        if (numOutputChannels > 1 && outputs[1])
        {
            outputs[1][i] += instrumentRight + (guideRight * guideGain_) + micContribution;
        }

        for (int ch = 2; ch < std::min(numOutputChannels, kMaxOutputChannels); ++ch)
        {
            if (outputs[ch])
            {
                outputs[ch][i] += micContribution;
            }
        }

        advanceMediaPositions();
    }
}

void PipelineProcessor::runVad(const float* frame16k)
{
    try
    {
        vadScore_ = vad_->processFrame(frame16k, kVadFrameSamples16k);
    }
    catch (...)
    {
        vadScore_ = 0.0f;
    }
}

void PipelineProcessor::runPitch(const float* frame16k)
{
    try
    {
        pitchScore_ = pitch_->processHop(frame16k, kPitchFrameSamples16k);
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

bool PipelineProcessor::loadMediaBuffers(const config::RuntimeConfig& runtimeConfig)
{
    bool loaded = false;
    if (loadAudioFile(runtimeConfig.media.instrumentPath, instrumentBuffer_, runtimeConfig.sampleRate))
    {
        instrumentPosition_ = 0;
        loaded = true;
    }

    if (loadAudioFile(runtimeConfig.media.guidePath, guideBuffer_, runtimeConfig.sampleRate))
    {
        guidePosition_ = 0;
        loaded = true;
    }

    return loaded;
}

float PipelineProcessor::nextInstrumentSample(int channel)
{
    if (instrumentBuffer_.getNumSamples() == 0)
    {
        return 0.0f;
    }

    const int channelToUse = std::min(channel, instrumentBuffer_.getNumChannels() - 1);
    const float sample = instrumentBuffer_.getSample(channelToUse, static_cast<int>(instrumentPosition_));
    return sample * instrumentGain_;
}

float PipelineProcessor::nextGuideSample(int channel)
{
    if (guideBuffer_.getNumSamples() == 0)
    {
        return 0.0f;
    }

    const int channelToUse = std::min(channel, guideBuffer_.getNumChannels() - 1);
    const float sample = guideBuffer_.getSample(channelToUse, static_cast<int>(guidePosition_));
    return sample;
}

void PipelineProcessor::advanceMediaPositions()
{
    if (instrumentBuffer_.getNumSamples() > 0)
    {
        ++instrumentPosition_;
        if (instrumentPosition_ >= static_cast<size_t>(instrumentBuffer_.getNumSamples()))
        {
            instrumentPosition_ = loopMedia_ ? 0 : instrumentBuffer_.getNumSamples() - 1;
        }
    }

    if (guideBuffer_.getNumSamples() > 0)
    {
        ++guidePosition_;
        if (guidePosition_ >= static_cast<size_t>(guideBuffer_.getNumSamples()))
        {
            guidePosition_ = loopMedia_ ? 0 : guideBuffer_.getNumSamples() - 1;
        }
    }
}

float PipelineProcessor::downsampleAverage(const float* data, size_t offset, size_t count)
{
    if (count == 0)
    {
        return 0.0f;
    }

    float sum = 0.0f;
    for (size_t i = 0; i < count; ++i)
    {
        sum += data[offset + i];
    }
    return sum / static_cast<float>(count);
}

juce::File PipelineProcessor::resolveFile(const std::string& path) const
{
    return resolveToWorkingDirectory(path);
}

bool PipelineProcessor::loadAudioFile(const std::string& path, juce::AudioBuffer<float>& destination, double targetSampleRate)
{
    juce::File file = resolveFile(path);
    if (!file.existsAsFile())
    {
        destination.setSize(0, 0);
        return false;
    }

    std::unique_ptr<juce::AudioFormatReader> reader(formatManager_.createReaderFor(file));
    if (reader == nullptr)
    {
        destination.setSize(0, 0);
        return false;
    }

    const int numChannels = static_cast<int>(reader->numChannels);
    const int64_t totalSamples = static_cast<int64_t>(reader->lengthInSamples);
    juce::AudioBuffer<float> tempBuffer(numChannels, static_cast<int>(totalSamples));
    reader->read(&tempBuffer, 0, static_cast<int>(totalSamples), 0, true, true);

    if (std::abs(reader->sampleRate - targetSampleRate) < 1e-3)
    {
        destination = std::move(tempBuffer);
        return true;
    }

    const double ratio = reader->sampleRate / targetSampleRate;
    const int resampledSamples = static_cast<int>(std::ceil(totalSamples / ratio));
    destination.setSize(numChannels, resampledSamples);

    juce::LagrangeInterpolator interpolator;
    for (int ch = 0; ch < numChannels; ++ch)
    {
        interpolator.reset();
        interpolator.process(ratio, tempBuffer.getReadPointer(ch), destination.getWritePointer(ch), resampledSamples);
    }

    return true;
}
} // namespace singwithme::audio
