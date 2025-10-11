#include "audio/DeviceManager.h"

namespace singwithme::audio
{
DeviceManager::DeviceManager() = default;

DeviceManager::~DeviceManager()
{
    shutdown();
}

void DeviceManager::initialise(double sampleRate, int bufferSize)
{
    juce::AudioDeviceManager::AudioDeviceSetup setup;
    deviceManager_.initialiseWithDefaultDevices(1, 2);
    deviceManager_.getAudioDeviceSetup(setup);
    setup.sampleRate = sampleRate;
    setup.bufferSize = bufferSize;
    deviceManager_.setAudioDeviceSetup(setup, true);
}

void DeviceManager::shutdown()
{
    deviceManager_.closeAudioDevice();
}
} // namespace singwithme::audio
