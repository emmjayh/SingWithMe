#include "ui/MainWindow.h"

namespace singwithme::ui
{
namespace
{
class PlaceholderComponent : public juce::Component
{
public:
    void paint(juce::Graphics& g) override
    {
        g.fillAll(juce::Colour(0xFF121212));
        g.setColour(juce::Colours::white);
        g.setFont(18.0f);
        g.drawFittedText("SingWithMe UI Placeholder", getLocalBounds(), juce::Justification::centred, 1);
    }
};
} // namespace

MainWindow::MainWindow()
    : juce::DocumentWindow("SingWithMe",
                           juce::Colour(0xFF1A1A1A),
                           juce::DocumentWindow::allButtons)
{
    setContentOwned(new PlaceholderComponent(), true);
    setResizable(true, false);
    centreWithSize(900, 600);
    setVisible(true);
}

MainWindow::~MainWindow() = default;

void MainWindow::closeButtonPressed()
{
    juce::JUCEApplicationBase::quit();
}
} // namespace singwithme::ui
