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
#else
class VadProcessor
{
public:
    explicit VadProcessor(Ort::Env&) {}

    void loadModel(const std::string&) {}
    void setModelSampleRate(int64_t sampleRate);
    void resetState();
    float processFrame(const float* samples, size_t sampleCount);

private:
    static float computeEnergy(const float* samples, size_t sampleCount);

    float noiseFloor_{1.0e-4f};
    float smoothedProbability_{0.0f};
    int64_t modelSampleRate_{16000};
};
#endif
} // namespace singwithme::dsp
