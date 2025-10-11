# Architecture Overview

## Shared Signal Flow
- Capture mono mic input at 48 kHz into 128-sample buffers (≈2.7 ms); optionally expose 256-sample fallback for unstable devices.
- Run WebRTC VAD or Picovoice Cobra on 10 ms frames to derive speech probability, and CREPE-tiny (or PESTO in future) for voiced-pitch probability on overlapping 20-40 ms hops.
- Combine confidences: `confidence = 0.6 * vad + 0.4 * pitch + w3 * phraseAware`; `w3` defaults to `0.0` until Streaming ASR/DTW is integrated.
- Feed confidence into the look-ahead sidechain gate: 5-15 ms look-ahead, attack 15-30 ms, release 120-250 ms, hold 100-300 ms, hysteresis tuned via config. Default duck target is -18 dB with option for full mute.
- Provide manual override (`Always On`, `Always Off`, `Auto`), telemetry meters (VAD, pitch, confidence), and a logging mode that records confidence, gate state, and latency metrics for calibration.

## Desktop App (JUCE/C++)

### Core Modules
- `audio::DeviceManager`: wraps JUCE `AudioDeviceManager` with WASAPI/CoreAudio handling, ASIO fallback on Windows.
- `dsp::VadProcessor`: integrates WebRTC VAD via ONNX Runtime; batches audio into 10 ms frames.
- `dsp::PitchProcessor`: hosts CREPE-tiny via ONNX Runtime; maintains hop ring buffer for look-ahead.
- `dsp::ConfidenceGate`: implements hysteresis thresholds, attack/release envelope, and manual override logic.
- `ui::MainWindow`: JUCE Components for meters, toggles, calibration wizard, latency monitor, and debug console.
- `telemetry::Recorder`: asynchronous logger writing CSV/JSON into `%APPDATA%/SingWithMe/logs` or `~/Library/Application Support/SingWithMe/logs`.

### Project Layout
- Use JUCE Projucer/CMake structure under `desktop/` with targets:
  - `SingWithMeApp` (GUI executable)
  - `SingWithMeAudioLib` (static library for DSP)
- Third-party deps: ONNX Runtime (CPU build), WebRTC VAD, optional TorchScript/TensorRT adapters behind feature flags.

### Platform Packaging
- Windows: CMake -> MSVC build; package via Inno Setup (installer) and ZIP (portable). Offer ASIO driver detection.
- macOS: CMake -> Xcode bundle; sign/notarize `.app`, wrap in `.dmg`. Integrate Sparkle for auto-updates.

## Web Prototype (React + Web Audio)

### Frontend Structure
- `web/` workspace using Vite + React + TypeScript.
- `src/audio/` contains `VadNode` (WebAssembly-compiled WebRTC VAD), `PitchNode` (CREPE TF.js or ONNX Runtime Web), `ConfidenceGateWorklet` (custom AudioWorklet with envelope smoothing).
- `src/components/`: 
  - `MetersPanel` (input/output levels)
  - `ConfidenceMeter` (lime/amber bar)
  - `ModeToggle` (`Auto`, `Always On`, `Always Off`)
  - `CalibrationWizard` (10 s noise floor capture)
  - `LatencyMonitor` (WebRTC stats + buffer estimator)
- `src/state/` uses Zustand or Redux Toolkit to share latency stats, confidence, and settings.

### Deployment
- Build static assets via `pnpm build` or `npm run build`.
- Railway configuration:
  - Host static build via Node/Express server in `web/server/`.
  - Environment variables: `MODEL_PATH_VAD`, `MODEL_PATH_PITCH`, `LATENCY_TARGET_MS`, `PORT`, optional `RAILWAY_STATIC_URL`.
  - Store lightweight ONNX/TF.js models in `public/models/` (<50 MB); larger variants sourced from GitHub Releases/HF at runtime.
- Logging uses browser `indexedDB` or WebAssembly FS for short-term storage; optional upload endpoint in Express for aggregated logs (disabled by default).

## Next Steps
1. Initialize CMake/JUCE project under `desktop/` with stub modules and ONNX Runtime integration hooks.
2. Scaffold Vite React app in `web/` with AudioWorklet placeholder and ONNX Runtime Web loader.
3. Draft configuration schema shared across platforms (`configs/defaults.yaml`) and CLI tooling for calibration export.
4. Implement calibration and latency measurement routines, then integrate manual override UI/UX.
