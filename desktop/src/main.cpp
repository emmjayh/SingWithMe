#include <juce_gui_extra/juce_gui_extra.h>

#include "audio/DeviceManager.h"
#include "dsp/ConfidenceGate.h"
#include "dsp/PitchProcessor.h"
#include "dsp/VadProcessor.h"
#include "ui/MainWindow.h"

namespace
{
class SingWithMeApplication : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override { return "SingWithMe"; }
    const juce::String getApplicationVersion() override { return "0.1.0"; }
    bool moreThanOneInstanceAllowed() override { return true; }

    void initialise(const juce::String&) override
    {
        mainWindow_ = std::make_unique<singwithme::ui::MainWindow>();
    }

    void shutdown() override
    {
        mainWindow_.reset();
    }

    void systemRequestedQuit() override
    {
        quit();
    }

    void anotherInstanceStarted(const juce::String&) override {}

private:
    std::unique_ptr<singwithme::ui::MainWindow> mainWindow_;
};
} // namespace

START_JUCE_APPLICATION(SingWithMeApplication)
