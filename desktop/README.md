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
  CMakeLists.txt            # root entry point
  cmake/
    FetchJUCE.cmake         # helper to pull JUCE if not provided
  include/
    audio/
      DeviceManager.h
    dsp/
      VadProcessor.h
      PitchProcessor.h
      ConfidenceGate.h
    ui/
      MainWindow.h
  src/
    main.cpp
    audio/DeviceManager.cpp
    dsp/VadProcessor.cpp
    dsp/PitchProcessor.cpp
    dsp/ConfidenceGate.cpp
    ui/MainWindow.cpp
  resources/
    icons/AppIcon.png
    fonts/Montserrat-Regular.ttf
```

## Configuration Options
- `-DENABLE_ASIO=ON` toggles ASIO support (Windows only) when ASIO SDK is available.
- `-DENABLE_GPU=ON` enables CUDA/TensorRT/TorchScript integration; requires additional libraries in `third_party/gpu/`.
- `-DCONFIG_PRESET=stage` selects config file under `configs/desktop/stage.yaml`.

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
- Both platforms should bundle model assets from `models/` and config presets from `configs/desktop/`.

## Next Implementation Steps
1. Implement `ConfidenceGate` envelope with look-ahead buffer, attack/release, hold, and hysteresis toggled via YAML config.
2. Integrate ONNX Runtime session loading in `VadProcessor` and `PitchProcessor`; add unit tests under `tests/unit/dsp/`.
3. Build JUCE UI with meters, confidence bar, calibration wizard, and manual override controls.
