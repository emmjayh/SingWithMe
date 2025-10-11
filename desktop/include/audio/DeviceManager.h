#pragma once

#include <juce_audio_devices/juce_audio_devices.h>

namespace singwithme::audio
{
class DeviceManager
{
public:
    DeviceManager();
    ~DeviceManager();

    void initialise(double sampleRate, int bufferSize);
    void shutdown();

    juce::AudioDeviceManager& manager() noexcept { return deviceManager_; }

private:
    juce::AudioDeviceManager deviceManager_;
};
} // namespace singwithme::audio
