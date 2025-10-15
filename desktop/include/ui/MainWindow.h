#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

#include <functional>

namespace singwithme::audio
{
class PipelineProcessor;
class DeviceManager;
}

namespace singwithme::ui
{
class MainWindow : public juce::DocumentWindow
{
public:
    explicit MainWindow(audio::PipelineProcessor& pipeline,
                       audio::DeviceManager& deviceManager,
                       std::function<bool(int)> onBufferSizeChanged);
    ~MainWindow() override;

    void closeButtonPressed() override;
};
} // namespace singwithme::ui
