set(DESKTOP_SOURCES
  main.cpp
  audio/DeviceManager.cpp
  dsp/VadProcessor.cpp
  dsp/PitchProcessor.cpp
  dsp/ConfidenceGate.cpp
  ui/MainWindow.cpp
)

set(DESKTOP_HEADERS
  ${CMAKE_CURRENT_LIST_DIR}/../include/audio/DeviceManager.h
  ${CMAKE_CURRENT_LIST_DIR}/../include/dsp/VadProcessor.h
  ${CMAKE_CURRENT_LIST_DIR}/../include/dsp/PitchProcessor.h
  ${CMAKE_CURRENT_LIST_DIR}/../include/dsp/ConfidenceGate.h
  ${CMAKE_CURRENT_LIST_DIR}/../include/ui/MainWindow.h
)

set(APP_ICON_BIG "")
set(APP_ICON_SMALL "")

set(ICON_PATH ${CMAKE_CURRENT_LIST_DIR}/../resources/icons/AppIcon.png)
if(EXISTS "${ICON_PATH}")
  set(APP_ICON_BIG ${ICON_PATH})
  set(APP_ICON_SMALL ${ICON_PATH})
endif()

juce_add_gui_app(SingWithMeApp
  PRODUCT_NAME "SingWithMe"
  COMPANY_NAME "SingWithMe"
  VERSION 0.1.0
  BUNDLE_ID com.singwithme.app
  ICON_BIG ${APP_ICON_BIG}
  ICON_SMALL ${APP_ICON_SMALL}
  SOURCES ${DESKTOP_SOURCES} ${DESKTOP_HEADERS}
)

target_include_directories(SingWithMeApp PRIVATE ${CMAKE_CURRENT_LIST_DIR}/../include)

if(ENABLE_ASIO AND WIN32)
  target_compile_definitions(SingWithMeApp PRIVATE ENABLE_ASIO)
endif()

if(ENABLE_GPU)
  target_compile_definitions(SingWithMeApp PRIVATE ENABLE_GPU)
endif()

target_compile_definitions(SingWithMeApp PRIVATE
  JUCE_MODAL_LOOPS_PERMITTED=1
  JUCE_STRICT_REFCOUNTEDPOINTER=1
  JUCE_WEB_BROWSER=0
)

find_path(ONNXRUNTIME_INCLUDE_DIR onnxruntime_cxx_api.h HINTS ${ONNXRUNTIME_ROOT}/include ENV ONNXRUNTIME_ROOT)
find_library(ONNXRUNTIME_LIBRARY onnxruntime HINTS ${ONNXRUNTIME_ROOT}/lib ENV ONNXRUNTIME_ROOT)

if(NOT ONNXRUNTIME_INCLUDE_DIR OR NOT ONNXRUNTIME_LIBRARY)
  message(FATAL_ERROR "ONNX Runtime not found. Set ONNXRUNTIME_ROOT.")
endif()

target_include_directories(SingWithMeApp PRIVATE ${ONNXRUNTIME_INCLUDE_DIR})
target_link_libraries(SingWithMeApp PRIVATE ${ONNXRUNTIME_LIBRARY} juce::juce_gui_extra)
