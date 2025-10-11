# Architecture Overview

## Shared Signal Flow
- Capture mono mic input at 48 kHz in 128-sample callbacks (~2.7 ms). Instrument and guide stems are streamed from disk/web separately and summed downstream.
- Downsample mic audio to 16 kHz for inference: Silero VAD (stateful, 10 ms frames) and CREPE tiny (64 ms hops) both exported to ONNX.
- Confidence score: `confidence = 0.6 * vad + 0.4 * pitch + w3 * phraseAware` (with `w3 = 0` in the current build). Optional phrase-aware weighting arrives once streaming ASR / DTW alignment lands.
- Feed confidence into the look-ahead gate (5–15 ms look-ahead, 15–30 ms attack, 120–250 ms release, 100–300 ms hold, hysteresis) to duck only the guide stem while leaving instruments untouched.
- Manual overrides (`auto`, `always_on`, `always_off`), calibration (10 s noise-floor capture), and telemetry logging are exposed to help front-of-house engineers tune thresholds quickly.

## Desktop App (JUCE / C++)
- `audio::PipelineProcessor` mixes mic + stems, performs downsampling, runs ONNX inference (Silero VAD + CREPE tiny), and applies the gate envelope to the guide stem.
- `config::RuntimeConfig` parses JSON presets (`configs/*.json`) for device/sample settings, gate parameters, model paths, and media locations.
- `dsp::VadProcessor` and `dsp::PitchProcessor` wrap ONNX Runtime sessions; Silero state tensors are preserved between frames.
- `calibration::Calibrator` tracks peak/noise levels during the calibration pass; results can be logged or surfaced in the UI.
- The JUCE UI (placeholder today) is responsible for meters, calibration triggers, and manual override toggles.
- Models (`models/vad.onnx`, `models/crepe_tiny.onnx`) and stems (`assets/audio/`) live beside the binary; configs describe which files to load.

## Web Prototype (React + Web Audio)
- WebAudio `AudioContext` manages the mic AudioWorklet, instrument/guide `AudioBufferSourceNode`s, and gain structure (mic monitor gain + guide gain ducking).
- ONNX Runtime Web (WASM) runs the same Silero + CREPE exports; state tensors are retained in JS to mirror desktop behaviour.
- Zustand store keeps telemetry (levels, confidence, calibration stage); React components render meters, mode toggles, and the calibration wizard.
- Assets mirror the desktop layout: `public/models/` for ONNX files and `public/media/` for stems. Env vars (`VITE_*`) let deployments repoint to CDN/asset hosts.
- Railway deployment wraps the static build in Express, exposing `/healthz` plus configurable model/media URLs.

## Notable Differences & Shared Expectations
- Both runtimes share the same gate defaults (`configs/defaults.json`), model weights, and calibration flow to keep behaviour consistent across platforms.
- Desktop leans on JUCE for low-latency audio device management (including ASIO/CoreAudio); the web build targets quick demos and Railway-hosted prototypes with slightly higher latency.
- Phrase-aware gating, richer UI, and telemetry upload hooks are earmarked for future releases once streaming ASR/alignment modules are integrated.
