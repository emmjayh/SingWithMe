# Desktop Build Guide

## Toolchain
- **JUCE**: 7.x (CMake module). Either install globally or add as git submodule under `third_party/JUCE`.
- **CMake**: 3.21+ with the **JUCE** CMake scripts available in `CMAKE_PREFIX_PATH`.
- **Compiler**:
  - Windows: MSVC 2022 (17.x) with C++20 enabled and Windows 10 SDK, ASIO SDK optional for low-latency drivers.
  - macOS: Xcode 15+ with Clang C++20, hardened runtime enabled for signing.
- **ONNX Runtime**: CPU package (shared library) placed in `third_party/onnxruntime` or installed via package manager. GPU/TensorRT builds guarded by `ENABLE_GPU=ON`.

## Project Layout
```
desktop/
  CMakeLists.txt
  cmake/
    FetchJUCE.cmake
  include/
    audio/
      DeviceManager.h
      PipelineProcessor.h
    calibration/
      Calibrator.h
    config/
      RuntimeConfig.h
    dsp/
      ConfidenceGate.h
      VadProcessor.h
      PitchProcessor.h
    ui/
      MainWindow.h
  src/
    main.cpp
    audio/
      DeviceManager.cpp
      PipelineProcessor.cpp
    calibration/Calibrator.cpp
    config/RuntimeConfig.cpp
    dsp/
      ConfidenceGate.cpp
      VadProcessor.cpp
      PitchProcessor.cpp
    ui/MainWindow.cpp
  resources/
    icons/AppIcon.png
    fonts/Montserrat-Regular.ttf
```

## Configuration Options
- Runtime config files live under `configs/` and use JSON (default `configs/defaults.json`).
- `-DENABLE_ASIO=ON` toggles ASIO support (Windows only) when ASIO SDK is available.
- `-DENABLE_GPU=ON` enables CUDA/TensorRT/TorchScript integration; requires additional libraries in `third_party/gpu/`.
- `-DENABLE_ONNX_RUNTIME=OFF` allows CMake configure to succeed without local ONNX binaries (inference disabled).

## Build Commands
```bash
# Configure
cmake -S desktop -B build/desktop -G "Visual Studio 17 2022" ^
  -DJUCE_PATH=C:/SDKs/JUCE ^
  -DONNXRUNTIME_ROOT=C:/SDKs/onnxruntime ^
  -DENABLE_ASIO=ON

# Build
cmake --build build/desktop --config Release

# Run
build/desktop/Release/SingWithMeApp.exe
```

## Packaging
- **Windows**: Use `cmake --build build/desktop --target PACKAGE` to emit WiX/NSIS scripts, or run `scripts/package_windows.ps1` after build.
- **macOS**: `cmake --build build/desktop --target SingWithMeApp` then package with `scripts/package_macos.sh` (creates signed `.dmg`).
- Bundle `models/*.onnx`, `configs/*.json`, and show stems from `assets/audio/` beside the executable.

## Operational Notes
- The pipeline expects 48 kHz I/O. Audio for VAD/pitch is downsampled to 16 kHz before hitting the ONNX models (Silero VAD + CREPE tiny export).
- Instrument and guide stems are loaded from `configs/*.json` (`media.instrumentPath`, `media.guidePath`). Provide your own WAV/MP3 files under `assets/audio/` (git-ignored) or update the config paths.
- Confidence gating drives the guide stem only; instrument playback stays full scale. Manual override and calibration hooks are surfaced via the UI scaffolding in `ui/MainWindow.cpp`.
- Override the config at runtime by setting `SINGWITHME_CONFIG` to a different JSON preset (e.g., `configs/desktop/stage.json`).
