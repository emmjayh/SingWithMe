# Web Prototype Setup

## Stack
- **React + TypeScript** bootstrapped via Vite.
- **State Management**: Zustand (lightweight) with React Context for Audio I/O bindings.
- **Audio/DSP**: Web Audio API with AudioWorklet nodes for VAD and gating logic.
- **Inference**: ONNX Runtime Web (WebAssembly backend) for WebRTC VAD + CREPE-tiny; fallback to TensorFlow.js if WASM fails.
- **Styling**: Tailwind CSS or CSS-in-JS (e.g., styled-components) using the dark stage-ready palette (#121212 background, lime/amber accents).

## Project Layout
```
web/
  package.json
  vite.config.ts
  src/
    audio/
      ConfidenceGateWorklet.ts
      VadNode.ts
      PitchNode.ts
      LatencyMonitor.ts
    components/
      MetersPanel.tsx
      ConfidenceMeter.tsx
      ModeToggle.tsx
      CalibrationWizard.tsx
      LatencyBadge.tsx
    state/
      useAppStore.ts
      selectors.ts
    pages/
      Home.tsx
    index.tsx
    global.css
  public/
    models/
      vad.onnx
      crepe_tiny.onnx
    icons/
      app-icon.svg
  server/
    index.ts           # optional Express wrapper for Railway
```

## Commands
```bash
# bootstrap (inside web/)
pnpm create vite@latest . --template react-ts
pnpm install onnxruntime-web zustand tailwindcss @vitejs/plugin-react
pnpm dlx tailwindcss init -p

# development
pnpm dev

# production
pnpm build
pnpm preview
```

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
- Recommended `Procfile` entry: `web: node dist/server/index.js`.
- Use Railway persistent storage only for text logs; audio uploads disabled by default.

## Next Implementation Steps
1. Scaffold Vite app and set up Tailwind theme matching desktop palette.
2. Implement `ConfidenceGateWorklet` mirroring desktop attack/release/hold logic.
3. Load ONNX Runtime Web models, map output probabilities to UI, and add calibration wizard that captures 10 s noise sample.
4. Wire logging/telemetry panel with download-to-JSON option for debugging.
