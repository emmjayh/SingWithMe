#include "dsp/PitchProcessor.h"

#if TUNETRIX_ONNX_RUNTIME

#include <algorithm>
#include <array>
#include <stdexcept>

namespace singwithme::dsp
{
namespace
{
constexpr const char* kInputName = "audio";
constexpr const char* kOutputName = "probabilities";
constexpr size_t kExpectedHopSamples = 1024; // 64 ms @ 16 kHz
} // namespace

PitchProcessor::PitchProcessor(Ort::Env& env)
    : env_(env)
{
    options_.SetIntraOpNumThreads(1);
    options_.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
}

void PitchProcessor::loadModel(const std::string& modelPath)
{
    session_ = std::make_unique<Ort::Session>(env_, modelPath.c_str(), options_);
    inputBuffer_.resize(kExpectedHopSamples);
    probabilities_.resize(360);
}

float PitchProcessor::processHop(const float* samples, size_t sampleCount)
{
    if (!session_)
    {
        throw std::runtime_error("Pitch model not loaded");
    }

    if (sampleCount != inputBuffer_.size())
    {
        throw std::runtime_error("Unexpected pitch hop length");
    }

    std::copy(samples, samples + sampleCount, inputBuffer_.begin());

    auto memoryInfo = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    std::array<int64_t, 2> shape{1, static_cast<int64_t>(inputBuffer_.size())};

    Ort::Value inputTensor = Ort::Value::CreateTensor<float>(
        memoryInfo,
        inputBuffer_.data(),
        inputBuffer_.size(),
        shape.data(),
        static_cast<size_t>(shape.size()));

    auto outputTensors = session_->Run(
        Ort::RunOptions{nullptr},
        &kInputName,
        &inputTensor,
        1,
        &kOutputName,
        1);

    auto* probs = outputTensors.front().GetTensorMutableData<float>();
    const auto typeInfo = outputTensors.front().GetTensorTypeAndShapeInfo();
    const auto elementCount = static_cast<size_t>(typeInfo.GetElementCount());

    probabilities_.assign(probs, probs + elementCount);
    return *std::max_element(probabilities_.begin(), probabilities_.end());
}
} // namespace singwithme::dsp

#else

#include <algorithm>
#include <cmath>

namespace singwithme::dsp
{
namespace
{
constexpr float kSampleRate = 16000.0f;
constexpr float kMinFrequency = 80.0f;
constexpr float kMaxFrequency = 500.0f;
constexpr float kSmoothing = 0.4f;
} // namespace

float PitchProcessor::processHop(const float* samples, size_t sampleCount)
{
    if (samples == nullptr || sampleCount == 0)
    {
        return 0.0f;
    }

    float sumSquares = 0.0f;
    for (size_t i = 0; i < sampleCount; ++i)
    {
        sumSquares += samples[i] * samples[i];
    }

    if (sumSquares <= 1.0e-8f)
    {
        smoothedConfidence_ *= 0.5f;
        return smoothedConfidence_;
    }

    const float meanSquare = sumSquares / static_cast<float>(sampleCount);
    const int minLag = static_cast<int>(std::floor(kSampleRate / kMaxFrequency));
    const int maxLag = std::min(static_cast<int>(std::ceil(kSampleRate / kMinFrequency)),
                                static_cast<int>(sampleCount) - 1);

    float bestCorrelation = 0.0f;
    for (int lag = minLag; lag <= maxLag; ++lag)
    {
        const float corr = estimateAutocorrelation(samples, sampleCount, lag);
        const float normalised = corr / (meanSquare + 1.0e-8f);
        bestCorrelation = std::max(bestCorrelation, normalised);
    }

    const float confidence = std::clamp(bestCorrelation, 0.0f, 1.0f);
    smoothedConfidence_ = (kSmoothing * confidence) + ((1.0f - kSmoothing) * smoothedConfidence_);
    return smoothedConfidence_;
}

float PitchProcessor::estimateAutocorrelation(const float* samples, size_t sampleCount, int lag)
{
    float correlation = 0.0f;
    const size_t limit = sampleCount - static_cast<size_t>(lag);
    for (size_t i = 0; i < limit; ++i)
    {
        correlation += samples[i] * samples[i + static_cast<size_t>(lag)];
    }

    return correlation / static_cast<float>(limit);
}
} // namespace singwithme::dsp

#endif
