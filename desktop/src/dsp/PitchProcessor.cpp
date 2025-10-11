#include "dsp/PitchProcessor.h"

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
