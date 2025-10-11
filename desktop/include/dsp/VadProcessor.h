#pragma once

#include <onnxruntime_cxx_api.h>
#include <memory>
#include <string>
#include <vector>

namespace singwithme::dsp
{
class VadProcessor
{
public:
    explicit VadProcessor(Ort::Env& env);

    void loadModel(const std::string& modelPath);
    void setModelSampleRate(int64_t sampleRate);
    void resetState();
    float processFrame(const float* samples, size_t sampleCount);

private:
    float runModel(const float* downsampled, size_t sampleCount);

    int64_t modelSampleRate_{16000};
    Ort::Env& env_;
    std::unique_ptr<Ort::Session> session_;
    Ort::SessionOptions options_;
    std::vector<float> inputBuffer_;
    std::vector<float> stateBuffer_;
};
} // namespace singwithme::dsp
