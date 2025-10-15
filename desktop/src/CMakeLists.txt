set(DESKTOP_SOURCES
  main.cpp
  audio/DeviceManager.cpp
  audio/PipelineProcessor.cpp
  ../../core/src/PipelineCore.cpp
  dsp/VadProcessor.cpp
  dsp/PitchProcessor.cpp
  dsp/ConfidenceGate.cpp
  config/RuntimeConfig.cpp
  calibration/Calibrator.cpp
  ui/MainWindow.cpp
  ui/MainComponent.cpp
)

set(DESKTOP_HEADERS
  ${CMAKE_CURRENT_LIST_DIR}/../include/audio/DeviceManager.h
  ${CMAKE_CURRENT_LIST_DIR}/../include/audio/PipelineProcessor.h
  ${CMAKE_CURRENT_LIST_DIR}/../../core/include/singwithme/core/PipelineCore.h
  ${CMAKE_CURRENT_LIST_DIR}/../include/dsp/VadProcessor.h
  ${CMAKE_CURRENT_LIST_DIR}/../include/dsp/PitchProcessor.h
  ${CMAKE_CURRENT_LIST_DIR}/../include/dsp/ConfidenceGate.h
  ${CMAKE_CURRENT_LIST_DIR}/../include/ui/MainWindow.h
  ${CMAKE_CURRENT_LIST_DIR}/../include/ui/MainComponent.h
  ${CMAKE_CURRENT_LIST_DIR}/../include/config/RuntimeConfig.h
  ${CMAKE_CURRENT_LIST_DIR}/../include/calibration/Calibrator.h
)

set(APP_ICON_BIG "")
set(APP_ICON_SMALL "")

set(ICON_PATH ${CMAKE_CURRENT_LIST_DIR}/../resources/icons/AppIcon.png)
if(EXISTS "${ICON_PATH}")
  set(APP_ICON_BIG ${ICON_PATH})
  set(APP_ICON_SMALL ${ICON_PATH})
endif()

juce_add_gui_app(TuneTrixApp
  PRODUCT_NAME "TuneTrix"
  COMPANY_NAME "TuneTrix"
  VERSION 0.1.0
  BUNDLE_ID com.tunetrix.app
  ICON_BIG ${APP_ICON_BIG}
  ICON_SMALL ${APP_ICON_SMALL}
)

target_sources(TuneTrixApp PRIVATE
  ${DESKTOP_SOURCES}
  ${DESKTOP_HEADERS}
)

target_include_directories(TuneTrixApp PRIVATE
  ${CMAKE_CURRENT_LIST_DIR}/../include
  ${CMAKE_CURRENT_LIST_DIR}/../../core/include)

if(ENABLE_ASIO AND WIN32)
  target_compile_definitions(TuneTrixApp PRIVATE ENABLE_ASIO)
endif()

if(ENABLE_GPU)
  target_compile_definitions(TuneTrixApp PRIVATE ENABLE_GPU)
endif()

target_compile_definitions(TuneTrixApp PRIVATE
  JUCE_MODAL_LOOPS_PERMITTED=1
  JUCE_STRICT_REFCOUNTEDPOINTER=1
  JUCE_WEB_BROWSER=0
  JUCE_USE_MP3AUDIOFORMAT=1
)

if(ENABLE_ONNX_RUNTIME)
  find_path(ONNXRUNTIME_INCLUDE_DIR onnxruntime_cxx_api.h HINTS ${ONNXRUNTIME_ROOT}/include ENV ONNXRUNTIME_ROOT)
  find_library(ONNXRUNTIME_LIBRARY onnxruntime HINTS ${ONNXRUNTIME_ROOT}/lib ENV ONNXRUNTIME_ROOT)

  if(NOT ONNXRUNTIME_INCLUDE_DIR OR NOT ONNXRUNTIME_LIBRARY)
    message(FATAL_ERROR "ONNX Runtime not found. Set ONNXRUNTIME_ROOT or disable ENABLE_ONNX_RUNTIME.")
  endif()

  target_compile_definitions(TuneTrixApp PRIVATE TUNETRIX_ONNX_RUNTIME=1)
  target_include_directories(TuneTrixApp PRIVATE ${ONNXRUNTIME_INCLUDE_DIR})
  target_link_libraries(TuneTrixApp PRIVATE ${ONNXRUNTIME_LIBRARY} juce::juce_gui_extra juce::juce_audio_formats juce::juce_audio_devices juce::juce_audio_basics juce::juce_audio_utils)
else()
  message(WARNING "Building without ONNX Runtime support; inference will be disabled.")
  target_compile_definitions(TuneTrixApp PRIVATE TUNETRIX_ONNX_RUNTIME=0)
  target_link_libraries(TuneTrixApp PRIVATE juce::juce_gui_extra juce::juce_audio_formats juce::juce_audio_devices juce::juce_audio_basics juce::juce_audio_utils)
endif()
