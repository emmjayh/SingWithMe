# Web Prototype Setup

## Stack
- **React + TypeScript** via Vite.
- **State Management**: Zustand store for shared telemetry and UI state.
- **Audio/DSP**: Web Audio API with an AudioWorklet tap for mic ingest; instrument and guide stems run as buffer sources.
- **Inference**: ONNX Runtime Web (WASM) for Silero VAD + CREPE tiny (exported locally to ONNX).
- **Styling**: Tailwind CSS + custom CSS for the dark stage palette (#121212 background, lime/amber accents).

## Project Layout
```
web/
  package.json
  vite.config.ts
  tsconfig*.json
  index.html
  public/
    models/
      vad.onnx
      crepe_tiny.onnx
    media/
      .gitkeep            # drop instrument / guide stems here
    worklets/
      confidence-gate.worklet.js
  src/
    audio/index.ts        # Audio engine (mic + stems + ONNX inference)
    audio/*.ts            # Gate/calibrator/telemetry helpers
    components/*.tsx      # UI widgets (meters, toggle, calibration)
    pages/Home.tsx        # Layout + engine bootstrap
    state/useAppStore.ts  # Zustand store
    styles/global.css
  server/index.ts         # Express wrapper for Railway
```

## Commands
| Action | Command |
| --- | --- |
| Install deps | `pnpm install` |
| Local dev server | `pnpm dev` |
| Lint | `pnpm lint` |
| Build (client + server) | `pnpm build` |
| Preview static build | `pnpm preview` |
| Railway start command | `pnpm start` |

## Media & Models
- Place show stems under `web/public/media/` (e.g., `instrument.mp3`, `guide.mp3`). They are ignored by git but can be addressed via `VITE_INSTRUMENT_URL` / `VITE_GUIDE_URL`.
- A 30-second demo pair (`demo-instrument.wav`, `demo-guide.wav`) ships in `public/media/` so users can audition the gate immediately.
- ONNX models live in `web/public/models/` (`vad.onnx`, `crepe_tiny.onnx`). Update env vars `VITE_MODEL_PATH_VAD` / `VITE_MODEL_PATH_PITCH` if you host elsewhere.

## Runtime Behaviour
- Microphone buffers (48 kHz) are downsampled to 16 kHz before hitting Silero VAD and CREPE tiny; guide gain automation mirrors the desktop gate defaults.
- Instrument stems bypass the gate; guide stems are multiplied by the gate envelope and the configured base gain.
- Playback controls (play/pause/stop) drive the instrument/guide stems so engineers can audition ducking quickly.
- Calibration captures 10 seconds of mic audio, persists results to `localStorage`, and updates the meter overlays.

## Railway Deployment
- `server/index.ts` serves the Vite build and exposes `/healthz` (returns latency target).
- Suggested environment variables:
  - `PORT` (assigned by Railway)
  - `MODEL_PATH_VAD`, `MODEL_PATH_PITCH` (server-side copies if you host elsewhere)
  - `VITE_MODEL_PATH_VAD`, `VITE_MODEL_PATH_PITCH`, `VITE_INSTRUMENT_URL`, `VITE_GUIDE_URL`
  - `LATENCY_TARGET_MS` / `VITE_LATENCY_TARGET_MS`
- Use persistent storage only for lightweight logs; stream stems/models from static hosting or Railway assets.

## Next Implementation Steps
1. Add phrase-aware weighting once streaming ASR or DTW alignment is available.
2. Surface upload/select controls so engineers can swap stems without editing env vars.
3. Add user-facing error toasts for permission denials or failed model fetches.
4. Gate optional telemetry uploads (signed URLs) for remote support/debug sessions.
