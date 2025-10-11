# Repository Guidelines

## Project Structure & Module Organization
- `src/singwithme/` houses runtime modules (`vad/`, `pitch/`, `alignment/`, `ducking/`). Mirror the Mic ? VAD ? Pitch ? (optional) ASR/DTW ? Gate flow in code, configs, and tests.
- Shared assets: `models/` contains Silero VAD + CREPE tiny ONNX exports, `configs/` holds JSON presets (per-target overrides in nested folders), `assets/audio/` is reserved for local stems (git-ignored), `scripts/` carries helper tooling, and `tests/` mirrors the runtime tree.

## Build, Test, and Development Commands
- Activate a virtualenv then `pip install -r requirements.txt` for Python tooling; `cmake` + JUCE drive the desktop build, `pnpm install` powers the web workspace.
- `ruff check src tests`, `mypy src`, and `pytest --cov=src/singwithme --cov-report term-missing` keep lint, types, and coverage healthy.
- Desktop: configure with CMake (`cmake -S desktop ...`), run from `build/desktop/Release/SingWithMeApp.exe`. Web: `pnpm dev` for local dev, `pnpm build` for production assets.

## Coding Style & Naming Conventions
- Python 3.11+, Black (line length 100) and Ruff; type-annotate public APIs. C++ follows JUCE style with minimal heap work inside audio callbacks.
- Config keys use lowerCamelCase in JSON, code uses `snake_case` for functions/modules and `PascalCase` for types.
- Keep real-time paths allocation-free (`// realtime:` comment any unavoidable work) and name stem files `<song>-<bpm>-<role>.wav` where possible.

## Testing Guidelines
- Python: `pytest` + `pytest-asyncio` with short audio fixtures under `tests/fixtures/audio/`.
- Aim for =85% overall coverage and 100% on the gating state machine; keep latency regression tests updated (`tests/perf/test_latency.py`).
- Web: add Playwright/React Testing Library coverage for UI logic once the interface hardens.

## Commit & Pull Request Guidelines
- Use Conventional Commits (`feat(vad):`, `fix(pipeline):`, etc.). Rebase onto `main`, squash WIP, and document latency deltas, dependency changes, and manual validation in the PR body.
- Attach short audio clips or screenshots whenever gating behaviour, latency, or UI changes are audible/visible.

## Latency Targets & Signal Flow
- Budget <25 ms end-to-end: 128-sample I/O buffers (~2.7 ms @48 kHz), 10 ms VAD windows (downsampled to 16 kHz), 64 ms pitch hops (overlapping), and 5–15 ms gate look-ahead.
- ASR/DTW confidence remains advisory in v1; the system must degrade gracefully when phrase awareness drops out.
- Keep guide stems logically separate from instruments. Config JSON (`media.instrumentPath`, `media.guidePath`) or env vars (`VITE_INSTRUMENT_URL`, `VITE_GUIDE_URL`) point to the assets per show.

## Guide Ducking & Confidence Logic
- Baseline weighting: `confidence = 0.6 * vad + 0.4 * pitch + 0.0 * phraseAware`; require `N_on = 3` consecutive frames to duck, `N_off = 6` to restore.
- Default gate envelope: look-ahead 10 ms, attack 20 ms, release 180 ms, hold 150 ms, duck to -18 dB (safety bed) unless a show preset overrides.
- Manual overrides (`auto`, `always_on`, `always_off`), calibration UI, and telemetry logging should stay wired in across platforms so front-of-house can trust the system quickly.
