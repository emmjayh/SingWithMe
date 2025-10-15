#pragma once

#if TUNETRIX_ONNX_RUNTIME
 #include <onnxruntime_cxx_api.h>
#else
#ifndef TUNETRIX_ORT_ENV_STUB
 #define TUNETRIX_ORT_ENV_STUB
  namespace Ort
  {
  struct Env {};
  }
 #endif
#endif

#include <memory>
#include <string>
#include <vector>

namespace singwithme::dsp
{
#if TUNETRIX_ONNX_RUNTIME
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
    std::vector<float> probabilities_;
};
#else
class PitchProcessor
{
public:
    explicit PitchProcessor(Ort::Env&) {}
    void loadModel(const std::string&) {}
    float processHop(const float* samples, size_t sampleCount);

private:
    static float estimateAutocorrelation(const float* samples, size_t sampleCount, int lag);

    float smoothedConfidence_{0.0f};
};
#endif
} // namespace singwithme::dsp
