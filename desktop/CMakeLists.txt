cmake_minimum_required(VERSION 3.21)
project(TuneTrixDesktop VERSION 0.1.0 LANGUAGES C CXX)

option(ENABLE_ASIO "Enable ASIO support on Windows" ON)
option(ENABLE_GPU "Enable GPU acceleration for ONNX Runtime" OFF)
option(ENABLE_ONNX_RUNTIME "Enable ONNX Runtime inference" ON)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

if(NOT DEFINED JUCE_PATH)
  set(JUCE_PATH "" CACHE PATH "Path to JUCE sources")
endif()

if(JUCE_PATH STREQUAL "")
  include(cmake/FetchJUCE.cmake)
endif()

find_package(JUCE CONFIG REQUIRED)

add_subdirectory(src)
