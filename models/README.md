# Models

- ad.onnx — Silero VAD (v6, 16 kHz) exported from https://github.com/snakers4/silero-vad.
- crepe_tiny.onnx — CREPE tiny exported via torchcrepe to ONNX (opset 13) for 16 kHz pitch tracking.

The desktop build loads these from models/ and the web build serves copies from web/public/models/. Update the config/env paths if you provide alternative weights.
