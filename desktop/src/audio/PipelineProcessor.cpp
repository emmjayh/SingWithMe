
#include "audio/PipelineProcessor.h"

#include <algorithm>
#include <cmath>
#include <memory>

namespace singwithme::audio
{
namespace
{
float dbToLinear(float db)
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
}

PipelineProcessor::Metrics PipelineProcessor::getMetrics() const
{
    const auto coreMetrics = corePipeline_.getMetrics();
    return {coreMetrics.inputRms,
            coreMetrics.outputRms,
            coreMetrics.vad,
            coreMetrics.pitch,
            coreMetrics.confidence,
            coreMetrics.strength,
            coreMetrics.gateDb};
}

void PipelineProcessor::setManualMode(dsp::ManualMode mode)
{
    corePipeline_.setManualMode(mode);
}

dsp::ManualMode PipelineProcessor::manualMode() const
{
    return corePipeline_.manualMode();
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

    coreConfig_ = core::PipelineConfig{
        runtimeConfig.sampleRate,
        runtimeConfig.bufferSamples,
        runtimeConfig.modelSampleRate,
        core::ConfidenceWeights{
            runtimeConfig.weights.vad,
            runtimeConfig.weights.pitch,
            runtimeConfig.weights.phraseAware},
        dsp::GateConfig{
            runtimeConfig.gate.lookAheadMs,
            runtimeConfig.gate.attackMs,
            runtimeConfig.gate.releaseMs,
            runtimeConfig.gate.holdMs,
            runtimeConfig.gate.thresholdOn,
            runtimeConfig.gate.thresholdOff,
            runtimeConfig.gate.framesOn,
            runtimeConfig.gate.framesOff,
            runtimeConfig.gate.duckDb},
        runtimeConfig.media.loop,
        dbToLinear(runtimeConfig.media.instrumentGainDb),
        dbToLinear(runtimeConfig.media.guideGainDb),
        runtimeConfig.media.micMonitorGainDb,
        0.13f,
        runtimeConfig.media.playbackLeakCompensation,
        runtimeConfig.media.crowdCancelAdaptRate,
        runtimeConfig.media.crowdCancelRecoveryRate,
        runtimeConfig.media.crowdCancelClamp,
        runtimeConfig.media.reverbTailMix,
        runtimeConfig.media.reverbTailSeconds,
        runtimeConfig.media.timbreMatchStrength,
        runtimeConfig.media.envelopeHoldMs,
        runtimeConfig.media.envelopeReleaseMs,
        runtimeConfig.media.envelopeReleaseMod};

    corePipeline_.configure(coreConfig_, gate_, vad_, pitch_, calibrator_);
    corePipeline_.setLooping(runtimeConfig.media.loop);
    corePipeline_.setGuideMute(false);
    corePipeline_.setNoiseFloorAmplitude(coreConfig_.noiseFloorAmplitude);
    corePipeline_.setMicMonitorGainDb(runtimeConfig.media.micMonitorGainDb);

    if (!runtimeConfig.media.instrumentPath.empty())
    {
        loadInstrumentFile(resolveFile(runtimeConfig.media.instrumentPath));
    }
    if (!runtimeConfig.media.guidePath.empty())
    {
        loadGuideFile(resolveFile(runtimeConfig.media.guidePath));
    }

    corePipeline_.play();
}

bool PipelineProcessor::loadInstrumentFile(const juce::File& file)
{
    if (!runtimeConfig_)
    {
        return false;
    }

    if (!loadAudioFile(file, backingBuffer_, runtimeConfig_->sampleRate))
    {
        instrumentPath_.clear();
        backingDurationSeconds_ = 0.0;
        corePipeline_.clearBackingTrack();
        return false;
    }

    instrumentPath_ = file.getFullPathName().toStdString();
    backingDurationSeconds_ = backingBuffer_.getNumSamples() / runtimeConfig_->sampleRate;
    pushBackingToCore(backingBuffer_, runtimeConfig_->sampleRate);
    return true;
}

bool PipelineProcessor::loadGuideFile(const juce::File& file)
{
    if (!runtimeConfig_)
    {
        return false;
    }

    if (!loadAudioFile(file, vocalBuffer_, runtimeConfig_->sampleRate))
    {
        guidePath_.clear();
        vocalDurationSeconds_ = 0.0;
        corePipeline_.clearVocalTrack();
        return false;
    }

    guidePath_ = file.getFullPathName().toStdString();
    vocalDurationSeconds_ = vocalBuffer_.getNumSamples() / runtimeConfig_->sampleRate;
    pushGuideToCore(vocalBuffer_, runtimeConfig_->sampleRate);
    return true;
}

std::string PipelineProcessor::instrumentPath() const
{
    return instrumentPath_;
}

std::string PipelineProcessor::guidePath() const
{
    return guidePath_;
}

double PipelineProcessor::instrumentDurationSeconds() const
{
    return backingDurationSeconds_;
}

double PipelineProcessor::guideDurationSeconds() const
{
    return vocalDurationSeconds_;
}

void PipelineProcessor::setNoiseFloorAmplitude(float amp)
{
    corePipeline_.setNoiseFloorAmplitude(amp);
}

float PipelineProcessor::noiseFloorAmplitude() const
{
    return corePipeline_.noiseFloorAmplitude();
}

void PipelineProcessor::setMicMonitorGainDb(float gainDb)
{
    coreConfig_.micMonitorGainDb = gainDb;
    corePipeline_.setMicMonitorGainDb(gainDb);
}

float PipelineProcessor::micMonitorGainDb() const
{
    return corePipeline_.micMonitorGainDb();
}

std::tuple<float, float, float> PipelineProcessor::crowdCancelParameters() const
{
    return {coreConfig_.crowdCancelAdaptRate, coreConfig_.crowdCancelRecoveryRate, coreConfig_.crowdCancelClamp};
}

std::pair<float, float> PipelineProcessor::reverbTailSettings() const
{
    return {coreConfig_.reverbTailMix, coreConfig_.reverbTailSeconds};
}

float PipelineProcessor::timbreMatchStrength() const
{
    return coreConfig_.timbreMatchStrength;
}

std::tuple<float, float, float> PipelineProcessor::envelopeSmoothing() const
{
    return {coreConfig_.envelopeHoldMs, coreConfig_.envelopeReleaseMs, coreConfig_.envelopeReleaseMod};
}

void PipelineProcessor::setCrowdCancelParameters(float adaptRate, float recoveryRate, float clamp)
{
    coreConfig_.crowdCancelAdaptRate = adaptRate;
    coreConfig_.crowdCancelRecoveryRate = recoveryRate;
    coreConfig_.crowdCancelClamp = clamp;
    corePipeline_.setCrowdCancelParameters(adaptRate, recoveryRate, clamp);
}

void PipelineProcessor::setReverbTail(float mix, float tailSeconds)
{
    coreConfig_.reverbTailMix = mix;
    coreConfig_.reverbTailSeconds = tailSeconds;
    corePipeline_.setReverbTail(mix, tailSeconds);
}

void PipelineProcessor::setTimbreMatchStrength(float strength)
{
    coreConfig_.timbreMatchStrength = strength;
    corePipeline_.setTimbreMatchStrength(strength);
}

void PipelineProcessor::setEnvelopeSmoothing(float holdMs, float releaseMs, float releaseMod)
{
    coreConfig_.envelopeHoldMs = holdMs;
    coreConfig_.envelopeReleaseMs = releaseMs;
    coreConfig_.envelopeReleaseMod = releaseMod;
    corePipeline_.setEnvelopeSmoothing(holdMs, releaseMs, releaseMod);
}

void PipelineProcessor::setGuideMute(bool shouldMute)
{
    corePipeline_.setGuideMute(shouldMute);
}

bool PipelineProcessor::guideMuted() const
{
    return corePipeline_.guideMuted();
}

void PipelineProcessor::updateBufferSize(int bufferSamples)
{
    if (!runtimeConfig_ || bufferSamples <= 0 || !gate_ || !vad_ || !pitch_ || !calibrator_)
    {
        return;
    }

    const auto manualMode = corePipeline_.manualMode();
    const auto previousState = corePipeline_.transportState();
    const bool vocalsMuted = corePipeline_.guideMuted();
    coreConfig_.bufferSamples = bufferSamples;
    corePipeline_.configure(coreConfig_, gate_, vad_, pitch_, calibrator_);
    corePipeline_.setLooping(runtimeConfig_->media.loop);
    corePipeline_.setManualMode(manualMode);
    corePipeline_.setMicMonitorGainDb(coreConfig_.micMonitorGainDb);
    corePipeline_.setNoiseFloorAmplitude(coreConfig_.noiseFloorAmplitude);
    corePipeline_.setGuideMute(vocalsMuted);

    if (backingBuffer_.getNumSamples() > 0)
    {
        pushBackingToCore(backingBuffer_, runtimeConfig_->sampleRate);
    }
    if (vocalBuffer_.getNumSamples() > 0)
    {
        pushGuideToCore(vocalBuffer_, runtimeConfig_->sampleRate);
    }

    switch (previousState)
    {
        case core::TransportState::Playing:
            corePipeline_.play();
            break;
        case core::TransportState::Paused:
            corePipeline_.pause();
            break;
        case core::TransportState::Stopped:
        default:
            corePipeline_.stop();
            break;
    }
}

void PipelineProcessor::playTransport()
{
    corePipeline_.play();
}

void PipelineProcessor::pauseTransport()
{
    corePipeline_.pause();
}

void PipelineProcessor::stopTransport()
{
    corePipeline_.stop();
}

bool PipelineProcessor::isTransportPlaying() const
{
    return corePipeline_.isTransportPlaying();
}

PipelineProcessor::TransportState PipelineProcessor::transportState() const
{
    switch (corePipeline_.transportState())
    {
        case core::TransportState::Playing:
            return TransportState::Playing;
        case core::TransportState::Paused:
            return TransportState::Paused;
        case core::TransportState::Stopped:
        default:
            return TransportState::Stopped;
    }
}

void PipelineProcessor::audioDeviceAboutToStart(juce::AudioIODevice* device)
{
    corePipeline_.reset();
    if (calibrator_ && runtimeConfig_)
    {
        const double rate = device ? device->getCurrentSampleRate() : runtimeConfig_->sampleRate;
        calibrator_->start(rate);
    }
    corePipeline_.play();
}

void PipelineProcessor::audioDeviceStopped()
{
    corePipeline_.stop();
}

void PipelineProcessor::audioDeviceIOCallbackWithContext(const float* const* inputChannelData,
                                                         int numInputChannels,
                                                         float* const* outputChannelData,
                                                         int numOutputChannels,
                                                         int numSamples,
                                                         const juce::AudioIODeviceCallbackContext& /*context*/)
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

    const float* micInput = (inputChannelData && numInputChannels > 0) ? inputChannelData[0] : nullptr;
    corePipeline_.process(micInput,
                          numSamples,
                          const_cast<float**>(outputChannelData),
                          numOutputChannels);
}

juce::File PipelineProcessor::resolveFile(const std::string& path) const
{
    return resolveToWorkingDirectory(path);
}

bool PipelineProcessor::loadAudioFile(const juce::File& file,
                                      juce::AudioBuffer<float>& destination,
                                      double targetSampleRate)
{
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
    if (numChannels <= 0 || totalSamples <= 0)
    {
        destination.setSize(0, 0);
        return false;
    }

    juce::AudioBuffer<float> tempBuffer(numChannels, static_cast<int>(totalSamples));
    const bool ok = reader->read(&tempBuffer, 0, static_cast<int>(totalSamples), 0, true, true);
    if (!ok)
    {
        destination.setSize(0, 0);
        return false;
    }

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
        interpolator.process(ratio,
                             tempBuffer.getReadPointer(ch),
                             destination.getWritePointer(ch),
                             resampledSamples);
    }

    return true;
}

bool PipelineProcessor::loadAudioFile(const std::string& path,
                                      juce::AudioBuffer<float>& destination,
                                      double targetSampleRate)
{
    return loadAudioFile(resolveFile(path), destination, targetSampleRate);
}

void PipelineProcessor::pushBackingToCore(const juce::AudioBuffer<float>& buffer, double sampleRate)
{
    corePipeline_.loadBackingTrack(convertBuffer(buffer),
                                   static_cast<int>(std::round(sampleRate)));
}

void PipelineProcessor::pushGuideToCore(const juce::AudioBuffer<float>& buffer, double sampleRate)
{
    corePipeline_.loadVocalTrack(convertBuffer(buffer),
                                 static_cast<int>(std::round(sampleRate)));
}

std::vector<std::vector<float>> PipelineProcessor::convertBuffer(const juce::AudioBuffer<float>& buffer)
{
    const int channels = std::max(1, buffer.getNumChannels());
    const int samples = buffer.getNumSamples();
    std::vector<std::vector<float>> result(static_cast<size_t>(channels),
                                           std::vector<float>(static_cast<size_t>(samples), 0.0f));

    for (int ch = 0; ch < channels; ++ch)
    {
        const float* source = buffer.getNumChannels() > ch ? buffer.getReadPointer(ch) : nullptr;
        auto& dest = result[static_cast<size_t>(ch)];
        if (source != nullptr)
        {
            std::copy(source, source + samples, dest.begin());
        }
    }

    return result;
}

} // namespace singwithme::audio
