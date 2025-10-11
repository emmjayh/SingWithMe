# Web Prototype Setup

## Stack
- **React + TypeScript** via Vite.
- **State Management**: Zustand store for shared audio telemetry and UI state.
- **Audio/DSP**: Web Audio API (AudioContext + future AudioWorklets) for confidence gating.
- **Inference**: ONNX Runtime Web (WebAssembly backend) for VAD + pitch (integration pending).
- **Styling**: Tailwind CSS plus bespoke CSS for the stage-ready palette (#121212 background, lime/amber accents).

## Project Layout
```
web/
  package.json
  vite.config.ts
  tsconfig*.json
  index.html
  src/
    audio/index.ts             # AudioContext + meter scaffolding
    components/*.tsx           # UI modules (meters, toggle, calibration)
    pages/Home.tsx             # Layout + AudioEngine bootstrap
    state/useAppStore.ts       # Zustand store
    styles/global.css          # Tailwind + globals
  public/
    .gitkeep                   # populate with models/icons as they land
  server/
    index.ts                   # Express host for Railway
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

## AudioWorklet Integration Steps
1. Register worklets in `src/audio/index.ts` using `audioContext.audioWorklet.addModule("/worklets/confidence-gate.js")`.
2. Marshal AudioParam automation for attack/release/hold values; update from Zustand store.
3. Share confidence metrics via `MessagePort` to React components for meters and logging.

## Railway Deployment
- Add `server/index.ts` Express host that serves `dist/` static files and exposes a `/healthz` endpoint.
- Environment variables:
  - `PORT` (provided by Railway)
  - `MODEL_PATH_VAD`, `MODEL_PATH_PITCH` (override default `public/models/` paths)
  - `LATENCY_TARGET_MS` (used for telemetry display)
  - `VITE_MODEL_PATH_VAD`, `VITE_MODEL_PATH_PITCH` (client-side inference paths)
- Recommended `Procfile` entry: `web: node dist/server/index.js`.
- Use Railway persistent storage only for text logs; audio uploads disabled by default.

## Next Implementation Steps
1. Wire phrase-aware confidence once streaming ASR/DTW lands (extend weights + node routing).
2. Replace placeholder guide signal with actual stem playback routed through the AudioWorklet.
3. Add error toasts for model loading failures and permissions issues.
4. Gate optional telemetry uploads (signed URLs) when operating in remote support mode.
