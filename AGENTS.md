# Repository Guidelines

## Project Structure & Module Organization
- `src/singwithme/` hosts the live pipeline (`vad/`, `pitch/`, `alignment/`, `ducking/`); keep Mic -> VAD -> Pitch -> optional ASR/DTW -> Gate mirrored in code, configs, and tests.
- Assets and tooling live in `models/` (WebRTC VAD, CREPE, phoneme timelines, Git LFS logged in `models/README.md`), `configs/` (latency and show presets), `scripts/` (prep/profile helpers), `tests/` (unit/integration/perf plus `tests/fixtures/audio/`), and `assets/guide_vocals/`.

## Build, Test, and Development Commands
- `python -m venv .venv && .\.venv\Scripts\activate` or `scripts\activate.ps1`, then `pip install -r requirements.txt`.
- `ruff check src tests`, `mypy src`, and `pytest --cov=src/singwithme --cov-report term-missing` keep lint, types, and coverage green.
- `python -m singwithme.demo --mic default --guide assets\guide_vocals\demo.wav` runs the end-to-end ducking demo.

## Coding Style & Naming Conventions
- Python 3.11+, formatted with Black (line length 100), linted with Ruff, and fully type-annotated on public APIs.
- Prefer snake_case for functions/modules, PascalCase for classes, YAML-aligned config keys (e.g., `latency_ms`), allocation-free callbacks, and asset names `<song>-<bpm>-<role>.wav` with any exceptions marked `# realtime:`.

## Testing Guidelines
- Use `pytest` and `pytest-asyncio` with `soundfile` fixtures for streaming snapshots; mirror runtime structure when adding suites.
- Maintain >=85% coverage overall and 100% for `ducking/state_machine.py`, updating limits in `tests/perf/test_latency.py` when timing shifts.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (examples `feat(vad):`, `fix(pitch):`), squash before PRs, and rebase on `main`.
- PRs document latency deltas, dependency changes, manual validation, and link issues; attach short demo audio when behavior is audible.

## Latency Targets & Signal Flow
- Hold total latency under 25 ms using 128-sample I/O buffers (~2.7 ms at 48 kHz), 10 ms VAD frames, 20-40 ms pitch hops, and 5-15 ms gate look-ahead.
- Treat ASR/DTW confidence as advisory in v1, and keep guide stems separate from instrumentals with optional JSON phoneme timelines.

## Guide Ducking & Confidence Logic
- Start with `confidence = 0.6*VAD + 0.4*Pitch + 0.0*PhraseAware`; require `N_on=3` frames to duck and `N_off=6` to release, raising `w3` once ASR ships.
- Duck when confidence >0.7, restore when it drops <0.4, defaulting to a -18 dB safety bed with configurable full mute.
- Configure the envelope for 5-15 ms look-ahead, 15-30 ms attack, 120-250 ms release, 100-300 ms hold, plus hysteresis captured in `configs/latency/`; expose manual override and meters for soundcheck confidence.
