#include <juce_gui_extra/juce_gui_extra.h>

#include <onnxruntime_cxx_api.h>

#include "audio/DeviceManager.h"
#include "audio/PipelineProcessor.h"
#include "calibration/Calibrator.h"
#include "config/RuntimeConfig.h"
#include "dsp/ConfidenceGate.h"
#include "dsp/PitchProcessor.h"
#include "dsp/VadProcessor.h"
#include "ui/MainWindow.h"

namespace
{
singwithme::dsp::GateConfig makeGateConfig(const singwithme::config::GateParams& params)
{
    singwithme::dsp::GateConfig gateCfg;
    gateCfg.lookAheadMs = params.lookAheadMs;
    gateCfg.attackMs = params.attackMs;
    gateCfg.releaseMs = params.releaseMs;
    gateCfg.holdMs = params.holdMs;
    gateCfg.thresholdOn = params.thresholdOn;
    gateCfg.thresholdOff = params.thresholdOff;
    gateCfg.framesOn = params.framesOn;
    gateCfg.framesOff = params.framesOff;
    gateCfg.duckDb = params.duckDb;
    return gateCfg;
}

class SingWithMeApplication : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override { return "SingWithMe"; }
    const juce::String getApplicationVersion() override { return "0.1.0"; }
    bool moreThanOneInstanceAllowed() override { return true; }

    void initialise(const juce::String&) override
    {
        runtimeConfig_ = configLoader_.loadFromFile("configs/defaults.yaml");

        deviceManager_.initialise(runtimeConfig_.sampleRate, runtimeConfig_.bufferSamples);

        vad_ = std::make_unique<singwithme::dsp::VadProcessor>(ortEnv_);
        vad_->loadModel(runtimeConfig_.vadModelPath);

        pitch_ = std::make_unique<singwithme::dsp::PitchProcessor>(ortEnv_);
        pitch_->loadModel(runtimeConfig_.pitchModelPath);

        gate_.configure(static_cast<float>(runtimeConfig_.sampleRate),
                        static_cast<size_t>(runtimeConfig_.bufferSamples),
                        makeGateConfig(runtimeConfig_.gate));

        pipelineProcessor_.configure(runtimeConfig_, gate_, *vad_, *pitch_, calibrator_);
        deviceManager_.manager().addAudioCallback(&pipelineProcessor_);

        mainWindow_ = std::make_unique<singwithme::ui::MainWindow>();
    }

    void shutdown() override
    {
        deviceManager_.manager().removeAudioCallback(&pipelineProcessor_);
        mainWindow_.reset();
        pitch_.reset();
        vad_.reset();
        deviceManager_.shutdown();
    }

    void systemRequestedQuit() override
    {
        quit();
    }

    void anotherInstanceStarted(const juce::String&) override {}

private:
    std::unique_ptr<singwithme::ui::MainWindow> mainWindow_;
    singwithme::audio::DeviceManager deviceManager_;
    singwithme::audio::PipelineProcessor pipelineProcessor_;
    Ort::Env ortEnv_{ORT_LOGGING_LEVEL_WARNING, "SingWithMe"};
    std::unique_ptr<singwithme::dsp::VadProcessor> vad_;
    std::unique_ptr<singwithme::dsp::PitchProcessor> pitch_;
    singwithme::dsp::ConfidenceGate gate_;
    singwithme::config::ConfigLoader configLoader_;
    singwithme::config::RuntimeConfig runtimeConfig_;
    singwithme::calibration::Calibrator calibrator_;
};
} // namespace

START_JUCE_APPLICATION(SingWithMeApplication)
