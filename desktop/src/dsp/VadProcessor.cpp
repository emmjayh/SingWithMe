#include "dsp/VadProcessor.h"

#if TUNETRIX_ONNX_RUNTIME

#include <algorithm>
#include <array>
#include <stdexcept>

namespace singwithme::dsp
{
namespace
{
constexpr const char* kInputName = "input";
constexpr const char* kStateName = "state";
constexpr const char* kSampleRateName = "sr";
constexpr const char* kOutputName = "output";
constexpr const char* kStateOutputName = "stateN";
constexpr size_t kStateChannels = 2;
constexpr size_t kStateHiddenSize = 128;
constexpr size_t kExpectedFrameSamples = 160; // 10 ms @ 16 kHz
} // namespace

VadProcessor::VadProcessor(Ort::Env& env)
    : env_(env)
{
    options_.SetIntraOpNumThreads(1);
    options_.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
}

void VadProcessor::loadModel(const std::string& modelPath)
{
    session_ = std::make_unique<Ort::Session>(env_, modelPath.c_str(), options_);
    inputBuffer_.resize(kExpectedFrameSamples);
    stateBuffer_.assign(kStateChannels * kStateHiddenSize, 0.0f);
}

void VadProcessor::setModelSampleRate(int64_t sampleRate)
{
    modelSampleRate_ = sampleRate;
}

void VadProcessor::resetState()
{
    std::fill(stateBuffer_.begin(), stateBuffer_.end(), 0.0f);
}

float VadProcessor::processFrame(const float* samples, size_t sampleCount)
{
    if (!session_)
    {
        throw std::runtime_error("VAD model not loaded");
    }

    if (sampleCount != kExpectedFrameSamples)
    {
        throw std::runtime_error("Unexpected VAD frame length");
    }

    std::copy(samples, samples + sampleCount, inputBuffer_.begin());
    return runModel(inputBuffer_.data(), inputBuffer_.size());
}

float VadProcessor::runModel(const float* downsampled, size_t sampleCount)
{
    auto memoryInfo = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);

    std::array<int64_t, 2> inputShape{1, static_cast<int64_t>(sampleCount)};
    Ort::Value inputTensor = Ort::Value::CreateTensor<float>(
        memoryInfo,
        const_cast<float*>(downsampled),
        sampleCount,
        inputShape.data(),
        static_cast<size_t>(inputShape.size()));

    std::array<int64_t, 3> stateShape{
        static_cast<int64_t>(kStateChannels),
        1,
        static_cast<int64_t>(kStateHiddenSize)};

    Ort::Value stateTensor = Ort::Value::CreateTensor<float>(
        memoryInfo,
        stateBuffer_.data(),
        stateBuffer_.size(),
        stateShape.data(),
        static_cast<size_t>(stateShape.size()));

    int64_t sr = modelSampleRate_;
    Ort::Value srTensor = Ort::Value::CreateTensor<int64_t>(
        memoryInfo,
        &sr,
        1,
        nullptr,
        0);

    const char* inputNames[] = {kInputName, kStateName, kSampleRateName};
    Ort::Value inputTensors[] = {std::move(inputTensor), std::move(stateTensor), std::move(srTensor)};

    const char* outputNames[] = {kOutputName, kStateOutputName};

    auto outputTensors = session_->Run(
        Ort::RunOptions{nullptr},
        inputNames,
        inputTensors,
        std::size(inputTensors),
        outputNames,
        std::size(outputNames));

    float probability = outputTensors[0].GetTensorMutableData<float>()[0];

    float* updatedState = outputTensors[1].GetTensorMutableData<float>();
    std::copy(updatedState, updatedState + static_cast<long long>(stateBuffer_.size()), stateBuffer_.begin());

    return probability;
}
} // namespace singwithme::dsp

#else

#include <algorithm>
#include <cmath>

namespace singwithme::dsp
{
namespace
{
constexpr float kMinFloor = 1.0e-7f;
constexpr float kNoiseAdaptFast = 0.02f;
constexpr float kNoiseAdaptSlow = 0.002f;
constexpr float kSmoothing = 0.45f;
constexpr float kLogisticSlope = 0.9f;
constexpr float kLogisticOffsetDb = -1.5f;
constexpr float kLevelFloorDb = -80.0f;
constexpr float kLevelCeilDb = -30.0f;
} // namespace

void VadProcessor::setModelSampleRate(int64_t sampleRate)
{
    modelSampleRate_ = sampleRate;
}

void VadProcessor::resetState()
{
    noiseFloor_ = 1.0e-4f;
    smoothedProbability_ = 0.0f;
}

float VadProcessor::processFrame(const float* samples, size_t sampleCount)
{
    if (samples == nullptr || sampleCount == 0)
    {
        return 0.0f;
    }

    const float frameEnergy = computeEnergy(samples, sampleCount);

    const bool likelyNoise = frameEnergy <= noiseFloor_ * 1.5f;
    const float adapt = likelyNoise ? kNoiseAdaptFast : kNoiseAdaptSlow;
    noiseFloor_ = std::max(kMinFloor, ((1.0f - adapt) * noiseFloor_) + (adapt * frameEnergy));

    const float snr = frameEnergy / std::max(noiseFloor_, kMinFloor);
    const float snrDb = 10.0f * std::log10(std::max(snr, 1.0e-6f));
    const float logisticProb = 1.0f / (1.0f + std::exp(-kLogisticSlope * (snrDb - kLogisticOffsetDb)));

    const float rms = std::sqrt(frameEnergy);
    const float rmsDb = 20.0f * std::log10(std::max(rms, 1.0e-6f));
    const float levelProb = std::clamp((rmsDb - kLevelFloorDb) / (kLevelCeilDb - kLevelFloorDb), 0.0f, 1.0f);

    const float probability = std::max(logisticProb, levelProb);

    smoothedProbability_ = (kSmoothing * probability) + ((1.0f - kSmoothing) * smoothedProbability_);
    return std::clamp(smoothedProbability_, 0.0f, 1.0f);
}

float VadProcessor::computeEnergy(const float* samples, size_t sampleCount)
{
    float sumSquares = 0.0f;
    for (size_t i = 0; i < sampleCount; ++i)
    {
        sumSquares += samples[i] * samples[i];
    }

    return sumSquares / static_cast<float>(sampleCount);
}
} // namespace singwithme::dsp

#endif
