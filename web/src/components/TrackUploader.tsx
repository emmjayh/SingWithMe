import { FormEvent, useMemo, useState } from "react";
import { audioEngine } from "@audio/index";
import { useAppStore } from "@state/useAppStore";

const DEMO_NOTE = "30-second demo stems are preloaded. Upload your own to hear the gate react.";

type UploadState = "idle" | "uploading" | "success" | "error";

interface UploadResponse {
  instrumentUrl: string;
  guideUrl: string;
}

export function TrackUploader() {
  const instrumentUrl = useAppStore((state) => state.instrumentUrl);
  const guideUrl = useAppStore((state) => state.guideUrl);
  const playbackState = useAppStore((state) => state.playbackState);
  const setTrackUrls = useAppStore((state) => state.setTrackUrls);
  const resetTrackUrls = useAppStore((state) => state.resetTrackUrls);

  const [instrumentFile, setInstrumentFile] = useState<File | null>(null);
  const [guideFile, setGuideFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const disableSubmit = useMemo(
    () => !instrumentFile || !guideFile || status === "uploading",
    [instrumentFile, guideFile, status]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!instrumentFile || !guideFile) {
      setErrorMessage("Please choose both instrument and guide files.");
      setStatus("error");
      return;
    }

    const formData = new FormData();
    formData.append("instrument", instrumentFile);
    formData.append("guide", guideFile);

    try {
      setStatus("uploading");
      setErrorMessage(null);

      const response = await fetch("/api/tracks", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message = payload?.error ?? "Upload failed";
        throw new Error(message);
      }

      const payload = (await response.json()) as UploadResponse;
      setTrackUrls({
        instrumentUrl: payload.instrumentUrl,
        guideUrl: payload.guideUrl
      });
      audioEngine.stop();
      setStatus("success");
    } catch (error) {
      setStatus("error");
      setErrorMessage((error as Error).message);
    }
  };

  const handleReset = () => {
    resetTrackUrls();
    audioEngine.stop();
    setInstrumentFile(null);
    setGuideFile(null);
    setStatus("idle");
    setErrorMessage(null);
  };

  const handlePlay = () => audioEngine.play();
  const handlePause = () => audioEngine.pause();
  const handleStop = () => audioEngine.stop();

  return (
    <div className="track-uploader">
      <p className="demo-note">{DEMO_NOTE}</p>
      <form onSubmit={handleSubmit}>
        <label className="upload-field">
          <span>Instrument backing track</span>
          <input
            type="file"
            accept="audio/*"
            onChange={(event) => setInstrumentFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <label className="upload-field">
          <span>Guide vocal</span>
          <input
            type="file"
            accept="audio/*"
            onChange={(event) => setGuideFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <div className="upload-actions">
          <button type="submit" disabled={disableSubmit}>
            {status === "uploading" ? "Uploading" : "Upload"}
          </button>
          <button type="button" className="ghost" onClick={handleReset} disabled={status === "uploading"}>
            Reset to defaults
          </button>
        </div>

        {status === "error" && errorMessage && <p className="upload-error">{errorMessage}</p>}
        {status === "success" && (
          <p className="upload-success">Tracks uploaded. Hit play to audition the ducking.</p>
        )}
      </form>

      <div className="playback-controls">
        <button type="button" onClick={handlePlay} disabled={playbackState === "playing"}>
          Play
        </button>
        <button type="button" onClick={handlePause} disabled={playbackState !== "playing"}>
          Pause
        </button>
        <button type="button" onClick={handleStop} disabled={playbackState === "stopped"}>
          Stop
        </button>
      </div>

      <div className="track-summary">
        <div>
          <span>Instrument URL</span>
          <strong>{instrumentUrl ?? "Not set"}</strong>
        </div>
        <div>
          <span>Guide URL</span>
          <strong>{guideUrl ?? "Not set"}</strong>
        </div>
      </div>
    </div>
  );
}
