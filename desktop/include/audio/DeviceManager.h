#pragma once

#include <juce_audio_devices/juce_audio_devices.h>

#include <vector>

namespace singwithme::audio
{
class DeviceManager
{
public:
    DeviceManager();
    ~DeviceManager();

    void initialise(double sampleRate, int bufferSize);
    void shutdown();

    std::vector<juce::String> availableOutputDevices();
    std::vector<juce::String> availableInputDevices();
    juce::String currentOutputDevice() const;
    juce::String currentInputDevice() const;
    bool setOutputDevice(const juce::String& deviceName);
    bool setInputDevice(const juce::String& deviceName);
    bool setBufferSize(int newBufferSize);
    double sampleRate() const noexcept { return sampleRate_; }
    int bufferSize() const noexcept { return bufferSize_; }

    juce::AudioDeviceManager& manager() noexcept { return deviceManager_; }

private:
    void applyCurrentSettings();

    juce::AudioDeviceManager deviceManager_;
    double sampleRate_{48000.0};
    int bufferSize_{512};
};
} // namespace singwithme::audio
