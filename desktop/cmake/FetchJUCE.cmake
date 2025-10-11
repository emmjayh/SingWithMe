include(FetchContent)

if(NOT TARGET juce::juce_gui_extra)
  FetchContent_Declare(
    juce
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        7.0.9
  )
  FetchContent_MakeAvailable(juce)
endif()
