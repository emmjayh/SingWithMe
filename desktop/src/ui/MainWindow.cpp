#include "ui/MainWindow.h"

#include "ui/MainComponent.h"

#include <utility>

namespace singwithme::ui
{

MainWindow::MainWindow(audio::PipelineProcessor& pipeline,
                       audio::DeviceManager& deviceManager,
                       std::function<bool(int)> onBufferSizeChanged)
    : juce::DocumentWindow("TuneTrix",
                           juce::Colour(0xFF1A1A1A),
                           juce::DocumentWindow::allButtons)
{
    setUsingNativeTitleBar(true);
    setContentOwned(new MainComponent(pipeline, deviceManager, std::move(onBufferSizeChanged)), true);
    setResizeLimits(1080, 780, 1920, 1200);
    setResizable(true, true);
    centreWithSize(1280, 900);
    if (auto* mainComponent = dynamic_cast<MainComponent*>(getContentComponent()))
    {
        mainComponent->grabKeyboardFocus();
    }
    setVisible(true);
}

MainWindow::~MainWindow() = default;

void MainWindow::closeButtonPressed()
{
    juce::JUCEApplicationBase::quit();
}
} // namespace singwithme::ui
