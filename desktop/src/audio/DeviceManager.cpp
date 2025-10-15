#include "audio/DeviceManager.h"

#include <algorithm>

namespace singwithme::audio
{
namespace
{
void addIfUnique(std::vector<juce::String>& list, const juce::String& name)
{
    if (name.isEmpty())
    {
        return;
    }
    if (std::find(list.begin(), list.end(), name) == list.end())
    {
        list.emplace_back(name);
    }
}
} // namespace

DeviceManager::DeviceManager() = default;

DeviceManager::~DeviceManager()
{
    shutdown();
}

void DeviceManager::initialise(double sampleRate, int bufferSize)
{
    sampleRate_ = sampleRate;
    bufferSize_ = bufferSize;
    deviceManager_.initialise(1, 2, nullptr, true, {}, nullptr);
    applyCurrentSettings();
}

void DeviceManager::shutdown()
{
    deviceManager_.closeAudioDevice();
}

std::vector<juce::String> DeviceManager::availableOutputDevices()
{
    std::vector<juce::String> names;
    juce::OwnedArray<juce::AudioIODeviceType> types;
    deviceManager_.createAudioDeviceTypes(types);
    for (auto* type : types)
    {
        if (type == nullptr)
        {
            continue;
        }
        type->scanForDevices();
        const auto deviceNames = type->getDeviceNames(false);
        for (const auto& name : deviceNames)
        {
            addIfUnique(names, name);
        }
    }
    return names;
}

std::vector<juce::String> DeviceManager::availableInputDevices()
{
    std::vector<juce::String> names;
    juce::OwnedArray<juce::AudioIODeviceType> types;
    deviceManager_.createAudioDeviceTypes(types);
    for (auto* type : types)
    {
        if (type == nullptr)
        {
            continue;
        }
        type->scanForDevices();
        const auto deviceNames = type->getDeviceNames(true);
        for (const auto& name : deviceNames)
        {
            addIfUnique(names, name);
        }
    }
    return names;
}

juce::String DeviceManager::currentOutputDevice() const
{
    juce::AudioDeviceManager::AudioDeviceSetup setup;
    deviceManager_.getAudioDeviceSetup(setup);
    return setup.outputDeviceName;
}

juce::String DeviceManager::currentInputDevice() const
{
    juce::AudioDeviceManager::AudioDeviceSetup setup;
    deviceManager_.getAudioDeviceSetup(setup);
    return setup.inputDeviceName;
}

bool DeviceManager::setOutputDevice(const juce::String& deviceName)
{
    if (deviceName.isEmpty())
    {
        return false;
    }

    juce::AudioDeviceManager::AudioDeviceSetup setup;
    deviceManager_.getAudioDeviceSetup(setup);
    if (setup.outputDeviceName == deviceName)
    {
        return true;
    }

    setup.outputDeviceName = deviceName;
    setup.useDefaultOutputChannels = true;
    setup.sampleRate = sampleRate_;
    setup.bufferSize = bufferSize_;

    const juce::String error = deviceManager_.setAudioDeviceSetup(setup, true);
    return error.isEmpty();
}

bool DeviceManager::setInputDevice(const juce::String& deviceName)
{
    if (deviceName.isEmpty())
    {
        return false;
    }

    juce::AudioDeviceManager::AudioDeviceSetup setup;
    deviceManager_.getAudioDeviceSetup(setup);
    if (setup.inputDeviceName == deviceName)
    {
        return true;
    }

    setup.inputDeviceName = deviceName;
    setup.useDefaultInputChannels = true;
    setup.sampleRate = sampleRate_;
    setup.bufferSize = bufferSize_;

    const juce::String error = deviceManager_.setAudioDeviceSetup(setup, true);
    return error.isEmpty();
}

bool DeviceManager::setBufferSize(int newBufferSize)
{
    if (newBufferSize <= 0)
    {
        return false;
    }

    bufferSize_ = newBufferSize;

    juce::AudioDeviceManager::AudioDeviceSetup setup;
    deviceManager_.getAudioDeviceSetup(setup);
    setup.bufferSize = bufferSize_;
    setup.sampleRate = sampleRate_;

    const juce::String error = deviceManager_.setAudioDeviceSetup(setup, true);
    if (error.isNotEmpty())
    {
        return false;
    }

    deviceManager_.getAudioDeviceSetup(setup);
    bufferSize_ = setup.bufferSize;
    sampleRate_ = setup.sampleRate;
    return true;
}

void DeviceManager::applyCurrentSettings()
{
    juce::AudioDeviceManager::AudioDeviceSetup setup;
    deviceManager_.getAudioDeviceSetup(setup);
    setup.sampleRate = sampleRate_;
    setup.bufferSize = bufferSize_;
    setup.useDefaultInputChannels = true;
    setup.useDefaultOutputChannels = true;
    deviceManager_.setAudioDeviceSetup(setup, true);
}
} // namespace singwithme::audio
