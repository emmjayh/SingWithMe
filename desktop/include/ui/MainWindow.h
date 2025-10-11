#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

namespace singwithme::ui
{
class MainWindow : public juce::DocumentWindow
{
public:
    MainWindow();
    ~MainWindow() override;

    void closeButtonPressed() override;
};
} // namespace singwithme::ui
