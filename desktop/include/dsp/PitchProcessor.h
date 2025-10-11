#pragma once

#include <onnxruntime_cxx_api.h>
#include <memory>
#include <string>
#include <vector>

namespace singwithme::dsp
{
class PitchProcessor
{
public:
    explicit PitchProcessor(Ort::Env& env);

    void loadModel(const std::string& modelPath);
    float processHop(const float* samples, size_t sampleCount);

private:
    Ort::Env& env_;
    std::unique_ptr<Ort::Session> session_;
    Ort::SessionOptions options_;
    std::vector<float> inputBuffer_;
};
} // namespace singwithme::dsp
