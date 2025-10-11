#include "dsp/VadProcessor.h"

#include <stdexcept>

namespace singwithme::dsp
{
namespace
{
constexpr const char* kInputName = "input";
constexpr const char* kOutputName = "output";
constexpr size_t kExpectedFrameSamples = 480; // 10 ms @ 48 kHz
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

    auto memoryInfo = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    Ort::Value inputTensor = Ort::Value::CreateTensor<float>(
        memoryInfo,
        inputBuffer_.data(),
        inputBuffer_.size(),
        std::array<int64_t, 2>{1, static_cast<int64_t>(inputBuffer_.size())}.data(),
        2);

    auto outputTensors = session_->Run(
        Ort::RunOptions{nullptr},
        &kInputName,
        &inputTensor,
        1,
        &kOutputName,
        1);

    return outputTensors.front().GetTensorMutableData<float>()[0];
}
} // namespace singwithme::dsp
